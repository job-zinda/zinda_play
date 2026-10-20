import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { memoryDatabase } from "../test-support/memory-database.js";
import { initializeEngagement, reactionTypes, registerEngagementRoutes } from "./engagement.js";

async function fixture(t) {
  const db = memoryDatabase();
  await initializeEngagement(db);
  for (const id of ["normal", "simply", "private"]) await db.collection("videos").insertOne({ _id: id, ownerId: "owner", title: id });
  const app = express();
  app.use(express.json());
  const sessionFor = req => {
    const userId = req.get("authorization");
    return userId ? { userId, username: userId } : null;
  };
  registerEngagementRoutes(app, {
    getDb: () => db,
    asyncRoute: handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next),
    requireAccount(req, res, next) {
      req.session = sessionFor(req);
      if (!req.session) return res.status(401).json({ error: "Sign in required." });
      next();
    },
    limit: (_req, _res, next) => next(), sessionFor,
    availableVideo: req => req.params.id === "private" ? null : db.collection("videos").findOne({ _id: req.params.id })
  });
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (path, method = "GET", body, user = "viewer") => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/videos/${path}`, {
      method, headers: { "Content-Type": "application/json", ...(user ? { Authorization: user } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, body: await response.json() };
  };
  return { db, request };
}

for (const video of ["normal", "simply"]) {
  test(`${video}: reactions replace, remove, count and preserve legacy likes`, async t => {
    const f = await fixture(t);
    await f.db.collection("videoLikes").insertOne({ videoId: video, userId: "legacy" });
    for (const reaction of reactionTypes) {
      const result = await f.request(`${video}/reaction`, "POST", { reaction });
      assert.equal(result.status, 200);
      assert.equal(result.body.reaction, reaction);
      assert.equal(result.body.likeCount, 2);
      assert.equal(result.body.reactions[reaction], reaction === "like" ? 2 : 1);
    }
    const removed = (await f.request(`${video}/reaction`, "POST", { reaction: "angry" })).body;
    assert.equal(removed.reaction, null);
    assert.equal(removed.likeCount, 1);
    assert.equal((await f.request(`${video}/like`, "POST")).body.reaction, "like");
    assert.equal((await f.request(`${video}/like`, "POST")).body.liked, false);
    const guest = (await f.request(`${video}/interactions`, "GET", null, null)).body;
    assert.equal(guest.reaction, null);
    assert.equal(guest.reactions.like, 1);
    assert.equal(await f.db.collection("notifications").countDocuments({ type: "video_like" }), 2);
  });
}

test("nested replies stay with their parent and comment reactions are per viewer", async t => {
  const f = await fixture(t);
  const root = (await f.request("normal/comments", "POST", { text: "Root" }, "author")).body;
  const reply = (await f.request("normal/comments", "POST", { text: "Reply", parentId: root.id.toUpperCase() })).body;
  assert.equal(reply.parentId, root.id);
  const nested = (await f.request("normal/comments", "POST", { text: "Nested", parentId: reply.id }, "third")).body;
  assert.equal(nested.parentId, reply.id);
  const reacted = await f.request(`normal/comments/${reply.id}/reaction`, "POST", { reaction: "love" });
  assert.equal(reacted.body.reactions.love, 1);
  await f.request(`normal/comments/${reply.id}/reaction`, "POST", { reaction: "wow" });
  await f.request(`normal/comments/${reply.id}/reaction`, "POST", { reaction: "like" }, "third");
  const page = (await f.request(`normal/comments?parentId=${root.id}`)).body;
  assert.equal(page.comments.length, 1);
  assert.equal(page.comments[0].replyCount, 1);
  assert.equal(page.comments[0].reaction, "wow");
  assert.equal(page.comments[0].reactionCount, 2);
  assert.equal(page.comments[0].reactions.love, 0);
  assert.ok(!("userId" in page.comments[0]));
  const interactions = (await f.request("normal/interactions")).body;
  assert.equal(interactions.commentCount, 3);
  assert.equal(interactions.comments.length, 1);
  assert.equal(interactions.comments[0].replyCount, 1);
  assert.equal((await f.request(`normal/comments/${reply.id}/reaction`, "POST", { reaction: "wow" })).body.reactionCount, 1);
  assert.equal(await f.db.collection("notifications").countDocuments({ recipientId: "author", type: "video_comment" }), 1);
});

test("root and reply pages are bounded and have stable cursors", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 23; i++) await f.request("normal/comments", "POST", { text: `Root ${i}` });
  const first = (await f.request("normal/interactions")).body;
  assert.equal(first.comments.length, 20);
  const rest = (await f.request(`normal/comments?before=${first.commentsNextCursor}`)).body;
  assert.equal(rest.comments.length, 3);
  assert.equal(rest.nextCursor, null);
  assert.equal(new Set([...first.comments, ...rest.comments].map(row => row.id)).size, 23);
  const parentId = first.comments[0].id;
  for (let i = 0; i < 21; i++) await f.request("normal/comments", "POST", { text: `Reply ${i}`, parentId });
  const replies = (await f.request(`normal/comments?parentId=${parentId}`)).body;
  assert.equal(replies.comments.length, 20);
  assert.equal((await f.request(`normal/comments?parentId=${parentId}&before=${replies.nextCursor}`)).body.comments.length, 1);
});

test("invalid inputs, cross-video comments, guests and unavailable videos are rejected", async t => {
  const f = await fixture(t);
  const root = (await f.request("normal/comments", "POST", { text: "Root" })).body;
  for (const reaction of ["invalid", {}, null]) {
    assert.equal((await f.request("normal/reaction", "POST", { reaction })).status, 400);
    assert.equal((await f.request(`normal/comments/${root.id}/reaction`, "POST", { reaction })).status, 400);
  }
  for (const text of ["", " ".repeat(3), "x".repeat(1001), {}]) {
    assert.equal((await f.request("normal/comments", "POST", { text })).status, 400);
  }
  assert.equal((await f.request("normal/comments", "POST", { text: "Reply", parentId: {} })).status, 400);
  assert.equal((await f.request("simply/comments", "POST", { text: "Reply", parentId: root.id })).status, 404);
  assert.equal((await f.request(`simply/comments/${root.id}/reaction`, "POST", { reaction: "like" })).status, 404);
  assert.equal((await f.request("normal/comments?before=bad")).status, 400);
  assert.equal((await f.request("normal/comments?parentId=bad")).status, 400);
  assert.equal((await f.request("normal/reaction", "POST", { reaction: "like" }, null)).status, 401);
  assert.equal((await f.request("normal/comments", "POST", { text: "Guest" }, null)).status, 401);
  for (const path of ["interactions", "comments", "reaction"]) {
    assert.equal((await f.request(`private/${path}`, path === "reaction" ? "POST" : "GET", path === "reaction" ? { reaction: "like" } : undefined)).status, 404);
  }
});
