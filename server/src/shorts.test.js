import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { memoryDatabase } from "../test-support/memory-database.js";
import { deleteShortRecords, initializeShorts, registerShortRoutes, shortMetadata, shortProcessingFields, shortUpload, shortsCdnOrigin } from "./shorts.js";
import { creatorWallet } from "./creator-wallet.js";

const publicQuery = { published: true, approvalStatus: { $nin: ["pending", "rejected"] }, processingStatus: "ready" };
async function fixture(t) {
  const db = memoryDatabase();
  await initializeShorts(db);
  let time = Date.now();
  const app = express();
  app.use(express.json());
  const sessionFor = req => {
    const token = req.get("authorization");
    return token && token !== "Bearer guest" ? { userId: token.slice(7), username: token.slice(7) } : null;
  };
  const requireAccount = (req, res, next) => {
    req.session = sessionFor(req);
    if (!req.session) return res.status(401).json({ error: "Sign in required" });
    next();
  };
  const limit = registerShortRoutes(app, {
    getDb: () => db, asyncRoute: handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next),
    requireAccount, requireAdmin: (req, res, next) => req.get("authorization") === "Bearer admin" ? next() : res.sendStatus(401),
    publicVideoQuery: publicQuery, availableInCity: async video => video.targetCity !== "Elsewhere",
    withCreatorProfiles: async videos => videos.map(({ _id, ...video }) => ({ id: _id, ...video })),
    sessionFor, cdnOrigin: () => "https://test.b-cdn.net", now: () => time
  });
  app.post("/api/test/:id/engagement", requireAccount, limit, (_req, res) => res.json({ ok: true }));
  app.post("/api/test/follows/:creatorId", requireAccount, limit, (_req, res) => res.json({ ok: true }));
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const original = process.env.VIEW_IP_HASH_SECRET;
  process.env.VIEW_IP_HASH_SECRET = "shorts-test-secret-not-real";
  t.after(() => { if (original === undefined) delete process.env.VIEW_IP_HASH_SECRET; else process.env.VIEW_IP_HASH_SECRET = original; });
  async function request(path, method = "GET", body, user = "guest") {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${user}` },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, body: response.status === 401 ? null : await response.json() };
  }
  async function video(id = "short-1", fields = {}) {
    await db.collection("videos").insertOne({
      _id: id, title: id, videoType: "short", shortValidated: true, published: true, approvalStatus: "approved",
      processingStatus: "ready", durationSeconds: 30, width: 1080, height: 1920, bunnyVideoId: `bunny-${id}`,
      createdAt: "2026-10-18T00:00:00.000Z", ownerId: "creator", views: 0, ...fields
    });
  }
  return { db, request, video, advance: ms => { time += ms; } };
}

test("Shorts verify duration and portrait dimensions from authoritative Bunny metadata", () => {
  for (const length of [0, -1, 60.01, Infinity, undefined]) assert.ok(shortMetadata({ length, width: 1080, height: 1920 }).error);
  assert.equal(shortMetadata({ length: 60, width: 1080, height: 1920 }).fields.durationSeconds, 60);
  assert.ok(shortMetadata({ length: 10, width: 1920, height: 1080 }).error);
  assert.ok(shortMetadata({ length: 10, width: 500, height: 500 }).error);
  assert.equal(shortMetadata({ length: 10, width: 1920, height: 1080, rotation: 90 }).error, undefined);
  assert.deepEqual(shortProcessingFields({ videoType: "regular" }, {}, "ready"), {});
  assert.equal(shortProcessingFields({ videoType: "short" }, { length: 61, width: 1080, height: 1920 }, "ready").processingStatus, "error");
  assert.equal(shortProcessingFields({ videoType: "short" }, { length: 30, width: 1080, height: 1920 }, "ready").shortValidated, true);
  assert.deepEqual(shortProcessingFields({ videoType: "short" }, {}, "processing"), {});
});

test("Simply snapshots the current proportional rate and zero while paused without rewriting or replaying earnings", async t => {
  const f = await fixture(t);
  for (const [id, enabled, rateRupees] of [["default", true, 25], ["changed", true, 40], ["paused", false, 900]]) {
    await f.video(id);
    const start = (await f.request(`/shorts/${id}/view-start`, "POST")).body;
    await f.db.collection("siteContent").updateOne({ _id: "reward-settings" }, {
      $set: { creatorSimplyViews: { enabled, rateRupees } }
    }, { upsert: true });
    f.advance(3000);
    assert.equal((await f.request(`/shorts/${id}/view`, "POST", { ticket: start.ticket })).body.counted, true);
  }
  await f.db.collection("siteContent").updateOne({ _id: "reward-settings" }, {
    $set: { creatorSimplyViews: { enabled: true, rateRupees: 100 } }
  });
  for (const id of ["default", "changed", "paused"]) {
    const start = (await f.request(`/shorts/${id}/view-start`, "POST")).body;
    f.advance(3000);
    assert.equal((await f.request(`/shorts/${id}/view`, "POST", { ticket: start.ticket })).body.counted, false);
  }
  const ledger = await f.db.collection("shortViews").find().toArray();
  assert.deepEqual(ledger.map(row => row.earningMilliRupees), [25, 40, 0]);
  const wallet = await creatorWallet(f.db, "creator");
  assert.equal(wallet.estimatedEarningsRupees, 0.07);
  assert.equal(wallet.eligibleViews, 3);
  assert.equal(wallet.simplyRateRupees, 100);
});

test("Shorts uploads validate headers without trusting client validation for publication", () => {
  const headers = {
    "X-Video-Type": "short", "Content-Type": "video/mp4", "X-Upload-Size": "10000",
    "X-Video-Duration": "60", "X-Video-Width": "1080", "X-Video-Height": "1920",
    "X-Short-Caption": encodeURIComponent("My short"), "X-Short-Hashtags": encodeURIComponent('["zinda","learn"]')
  };
  const req = { get: key => headers[key] };
  assert.equal(shortUpload(req).fields.shortValidated, false);
  assert.deepEqual(shortUpload(req).fields.hashtags, ["zinda", "learn"]);
  for (const [key, value] of [
    ["Content-Type", "video/avi"], ["X-Upload-Size", String(151 * 1024 * 1024)],
    ["X-Video-Duration", "61"], ["X-Short-Caption", "%bad"], ["X-Short-Hashtags", encodeURIComponent('["bad tag"]')]
  ]) assert.ok(shortUpload({ get: name => name === key ? value : headers[name] }).error);
  assert.deepEqual(shortUpload({ get: () => undefined }).fields, {});
});

test("feed pagination is bounded, stable on tied timestamps and excludes private, invalid and regular videos", async t => {
  const f = await fixture(t);
  for (const id of ["a", "b", "c", "d"]) await f.video(id);
  await f.video("private", { published: false });
  await f.video("unreviewed", { approvalStatus: "pending" });
  await f.video("invalid", { shortValidated: false });
  await f.video("regular", { videoType: "regular" });
  const first = await f.request("/shorts?limit=2");
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.items.map(item => item.id), ["d", "c"]);
  assert.match(first.body.items[0].streamUrl, /^https:\/\/test.b-cdn.net\/bunny-d\/playlist.m3u8$/);
  const second = await f.request(`/shorts?limit=2&cursor=${first.body.nextCursor}`);
  assert.deepEqual(second.body.items.map(item => item.id), ["b", "a"]);
  assert.equal(second.body.nextCursor, null);
  assert.equal((await f.request("/shorts?limit=1000")).status, 400);
  assert.equal((await f.request("/shorts?cursor=bad")).status, 400);
});

test("location-filtered empty page still returns a cursor to reach eligible Shorts", async t => {
  const f = await fixture(t);
  await f.video("a");
  await f.video("b", { targetCity: "Elsewhere" });
  const first = await f.request("/shorts?limit=1");
  assert.deepEqual(first.body.items, []);
  assert.ok(first.body.nextCursor);
  const second = await f.request(`/shorts?limit=1&cursor=${first.body.nextCursor}`);
  assert.equal(second.body.items[0].id, "a");
  assert.equal((await f.request("/shorts/b/view-start", "POST")).status, 404);
});

test("saved Shorts persist per account and idempotent save/un-save preserve public access checks", async t => {
  const f = await fixture(t);
  await f.video();
  assert.equal((await f.request("/shorts/short-1/saved", "PUT", {})).status, 401);
  for (let i = 0; i < 2; i++) assert.equal((await f.request("/shorts/short-1/saved", "PUT", {}, "alice")).body.saved, true);
  assert.equal(f.db.collection("savedShorts").documents.length, 1);
  assert.equal((await f.request("/shorts/saved", "GET", null, "alice")).body.items.length, 1);
  assert.equal((await f.request("/shorts/saved", "GET", null, "bob")).body.items.length, 0);
  assert.equal((await f.request("/shorts/short-1/state", "GET", null, "alice")).body.saved, true);
  assert.equal((await f.request("/shorts/short-1/saved", "DELETE", null, "alice")).body.saved, false);
  assert.equal((await f.request("/shorts/short-1/state", "GET", null, "alice")).body.saved, false);
  await f.video("pending", { published: false });
  assert.equal((await f.request("/shorts/pending/saved", "PUT", {}, "alice")).status, 404);
});

test("view tickets require elapsed watch time, reject tampering and count once per IP/video including concurrent replays", async t => {
  const f = await fixture(t);
  await f.video();
  const start = await f.request("/shorts/short-1/view-start", "POST");
  assert.equal(start.body.minimumWatchMs, 3000);
  assert.equal((await f.request("/shorts/short-1/view", "POST", { ticket: start.body.ticket })).status, 400);
  f.advance(3500);
  const results = await Promise.all(Array.from({ length: 5 }, () => f.request("/shorts/short-1/view", "POST", { ticket: start.body.ticket })));
  assert.equal(results.filter(result => result.body.counted).length, 1);
  assert.equal(f.db.collection("videos").documents[0].views, 1);
  assert.equal(f.db.collection("shortViews").documents.length, 1);
  assert.equal(f.db.collection("uniqueVideoViews").documents.length, 0);
  assert.equal((await f.request("/shorts/short-1/view", "POST", { ticket: `${start.body.ticket}x` })).status, 400);
  f.advance(300001);
  assert.equal((await f.request("/shorts/short-1/view", "POST", { ticket: start.body.ticket })).status, 400);
});

test("creator self views do not inflate Shorts views", async t => {
  const f = await fixture(t);
  await f.video();
  const start = await f.request("/shorts/short-1/view-start", "POST");
  f.advance(4000);
  const result = await f.request("/shorts/short-1/view", "POST", { ticket: start.body.ticket }, "creator");
  assert.equal(result.body.counted, false);
  assert.equal(f.db.collection("videos").documents[0].views, 0);
});

test("only new qualifying Simply views earn once, including retries after failed counter writes", async t => {
  const f = await fixture(t);
  await f.video();
  const start = await f.request("/shorts/short-1/view-start", "POST");
  assert.equal((await f.request("/shorts/short-1/view", "POST", { ticket: start.body.ticket })).status, 400);
  assert.equal((await creatorWallet(f.db, "creator")).estimatedEarningsRupees, 0);
  f.advance(4000);
  const videos = f.db.collection("videos");
  const original = videos.updateOne;
  videos.updateOne = async () => { throw new Error("Counter unavailable"); };
  assert.equal((await f.request("/shorts/short-1/view", "POST", { ticket: start.body.ticket })).status, 500);
  videos.updateOne = original;
  for (let i = 0; i < 2; i++) await f.request("/shorts/short-1/view", "POST", { ticket: start.body.ticket });
  const ledger = f.db.collection("shortViews").documents;
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].creatorId, "creator");
  assert.equal(ledger[0].earningMilliRupees, 25);
  assert.equal((await creatorWallet(f.db, "creator")).estimatedEarningsRupees, 0.03);
});

test("existing unpaid ledger entries stay unpaid on replay and self views do not earn", async t => {
  const f = await fixture(t);
  await f.video();
  const start = await f.request("/shorts/short-1/view-start", "POST");
  f.advance(4000);
  await f.request("/shorts/short-1/view", "POST", { ticket: start.body.ticket });
  const row = f.db.collection("shortViews").documents[0];
  delete row.earningMilliRupees; delete row.creatorId;
  await f.request("/shorts/short-1/view", "POST", { ticket: start.body.ticket });
  assert.equal((await creatorWallet(f.db, "creator")).estimatedEarningsRupees, 0);
  await f.video("self", { ownerId: "alice" });
  const self = await f.request("/shorts/self/view-start", "POST", null, "alice");
  f.advance(4000);
  await f.request("/shorts/self/view", "POST", { ticket: self.body.ticket }, "alice");
  assert.equal((await creatorWallet(f.db, "alice")).eligibleViews, 0);
});

test("a view retry repairs its counter if the first counter write failed", async t => {
  const f = await fixture(t);
  await f.video();
  const start = await f.request("/shorts/short-1/view-start", "POST");
  f.advance(4000);
  const videos = f.db.collection("videos");
  const original = videos.updateOne;
  videos.updateOne = async () => { throw new Error("Simulated counter outage"); };
  assert.equal((await f.request("/shorts/short-1/view", "POST", { ticket: start.body.ticket })).status, 500);
  videos.updateOne = original;
  const retry = await f.request("/shorts/short-1/view", "POST", { ticket: start.body.ticket });
  assert.equal(retry.body.counted, false);
  assert.equal(retry.body.views, 1);
  assert.equal(f.db.collection("shortViews").documents.length, 1);
});

test("admin report moderation can dismiss or unpublish without deleting regular video data", async t => {
  const f = await fixture(t);
  await f.video();
  await f.video("regular", { videoType: "regular" });
  await f.request("/shorts/short-1/report", "POST", { reason: "spam" }, "alice");
  const report = f.db.collection("shortReports").documents[0];
  assert.equal((await f.request(`/admin/shorts/reports/${report._id}`, "PATCH", { action: "unpublish" }, "alice")).status, 401);
  assert.equal((await f.request(`/admin/shorts/reports/${report._id}`, "PATCH", { action: "bad" }, "admin")).status, 400);
  assert.equal((await f.request(`/admin/shorts/reports/${report._id}`, "PATCH", { action: "unpublish" }, "admin")).status, 200);
  assert.equal((await f.db.collection("videos").findOne({ _id: "short-1" })).published, false);
  assert.equal((await f.db.collection("videos").findOne({ _id: "regular" })).published, true);
  assert.equal((await f.request("/shorts/short-1")).status, 404);
  assert.equal((await f.request("/admin/shorts/reports", "GET", null, "admin")).body.length, 0);
  await f.video("short-2");
  await f.request("/shorts/short-2/report", "POST", { reason: "other" }, "alice");
  const second = f.db.collection("shortReports").documents.find(row => row.videoId === "short-2");
  assert.equal((await f.request(`/admin/shorts/reports/${second._id}`, "PATCH", { action: "dismiss" }, "admin")).status, 200);
  assert.equal((await f.db.collection("videos").findOne({ _id: "short-2" })).published, true);
});

test("follow limits apply across creators and deleted Shorts remove only their own records", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 20; i++) assert.equal((await f.request(`/test/follows/creator-${i}`, "POST", {}, "alice")).status, 200);
  assert.equal((await f.request("/test/follows/other", "POST", {}, "alice")).status, 429);
  for (const name of ["savedShorts", "shortReports", "shortViews"]) {
    await f.db.collection(name).insertOne({ videoId: "deleted", userId: "alice", viewerHash: "ip" });
    await f.db.collection(name).insertOne({ videoId: "retained", userId: "alice", viewerHash: "ip" });
  }
  await deleteShortRecords(f.db, "deleted");
  for (const name of ["savedShorts", "shortReports", "shortViews"]) assert.deepEqual(f.db.collection(name).documents.map(row => row.videoId), ["retained"]);
});

test("reports are authenticated and deduplicated, notify admin, and engagement is rate-limited", async t => {
  const f = await fixture(t);
  await f.video();
  assert.equal((await f.request("/shorts/short-1/report", "POST", { reason: "spam" })).status, 401);
  assert.equal((await f.request("/shorts/short-1/report", "POST", { reason: "invalid" }, "alice")).status, 400);
  for (let i = 0; i < 2; i++) assert.equal((await f.request("/shorts/short-1/report", "POST", { reason: "spam" }, "alice")).status, 200);
  assert.equal(f.db.collection("shortReports").documents.length, 1);
  assert.equal(f.db.collection("notifications").documents.length, 1);
  assert.equal((await f.request("/admin/shorts/reports", "GET", null, "alice")).status, 401);
  assert.equal((await f.request("/admin/shorts/reports", "GET", null, "admin")).body.length, 1);
  for (let i = 0; i < 30; i++) assert.equal((await f.request("/test/short-1/engagement", "POST", {}, "alice")).status, 200);
  assert.equal((await f.request("/test/short-1/engagement", "POST", {}, "alice")).status, 429);
  f.advance(60000);
  assert.equal((await f.request("/test/short-1/engagement", "POST", {}, "alice")).status, 200);
});

test("CDN configuration requires HTTPS without credentials or paths", () => {
  const original = process.env.BUNNY_STREAM_CDN_HOSTNAME;
  try {
    for (const value of ["", "http://cdn.example.com", "https://user:secret@cdn.example.com", "https://cdn.example.com/private"]) {
      process.env.BUNNY_STREAM_CDN_HOSTNAME = value;
      assert.throws(shortsCdnOrigin);
    }
    process.env.BUNNY_STREAM_CDN_HOSTNAME = "test.b-cdn.net";
    assert.equal(shortsCdnOrigin(), "https://test.b-cdn.net");
  } finally {
    if (original === undefined) delete process.env.BUNNY_STREAM_CDN_HOSTNAME;
    else process.env.BUNNY_STREAM_CDN_HOSTNAME = original;
  }
});
