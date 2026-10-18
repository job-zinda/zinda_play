import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import express from "express";
import { ObjectId } from "mongodb";
import { memoryDatabase } from "../test-support/memory-database.js";
import { accountAccessGuard, accountDeletionHandler } from "./account-deletion.js";

async function fixture(t, role = "creator") {
  const db = memoryDatabase();
  const id = new ObjectId();
  const other = new ObjectId();
  const photo = new ObjectId();
  const videoImage = new ObjectId();
  const user = { _id: id, username: "Owner", accountType: role, passwordHash: "stored", profilePhotoImageId: photo.toString() };
  await db.collection("users").insertOne(user);
  await db.collection("users").insertOne({ _id: other, username: "Other" });
  await db.collection("videos").insertOne({ _id: "owned", ownerId: id.toString(), title: "Private title", bunnyVideoId: "bunny", thumbnailImageId: videoImage.toString(), published: true, views: 10 });
  await db.collection("videos").insertOne({ _id: "other", ownerId: other.toString(), title: "Other", published: true });
  await db.collection("ads").insertOne({ creatorVideoId: "owned", creatorId: id.toString(), active: true, targetUrl: "https://example.com" });
  await db.collection("ads").insertOne({ creatorId: other.toString(), active: true });
  for (const [bucket, fileId] of [["creatorProfilePhotos", photo], ["videoThumbnails", videoImage]]) {
    await db.collection(`${bucket}.files`).insertOne({ _id: fileId });
    await db.collection(`${bucket}.chunks`).insertOne({ files_id: fileId, data: "bytes" });
  }
  for (const name of ["videoLikes", "videoComments", "savedShorts", "shortReports"]) {
    await db.collection(name).insertOne({ userId: id.toString(), videoId: "other" });
    await db.collection(name).insertOne({ userId: other.toString(), videoId: "owned" });
    await db.collection(name).insertOne({ userId: other.toString(), videoId: "other" });
  }
  await db.collection("sessions").insertOne({ userId: id.toString() });
  await db.collection("sessions").insertOne({ userId: id.toString() });
  await db.collection("sessions").insertOne({ userId: other.toString() });
  await db.collection("membershipPayments").insertOne({ creatorId: id.toString(), username: "Owner", amountRupees: 199, proofId: new ObjectId(), status: "approved" });
  await db.collection("adCompletedViews").insertOne({ creatorId: id.toString(), videoId: "owned", earningMilliRupees: 200 });
  await db.collection("notifications").insertOne({ recipientId: other.toString(), type: "video_like", message: 'Owner liked "Other video".' });
  await db.collection("notifications").insertOne({ recipientId: other.toString(), type: "video_comment", message: 'Someone commented on "Other video".' });
  let failMedia = false;
  const revoked = [];
  const app = express();
  app.use(express.json());
  const handler = accountDeletionHandler({
    getDb: () => db,
    passwordMatches: async (password, found) => password === "correct-password" && found.passwordHash === "stored",
    deleteVideoMedia: async () => { if (failMedia) throw new Error("CDN unavailable. Retry deletion."); },
    revokeSessions: async userId => { revoked.push(userId); }
  });
  app.delete("/account", (req, res, next) => {
    if (!["member", "creator", "business", "promoter"].includes(req.get("x-role"))) return res.sendStatus(401);
    req.session = { userId: id.toString() };
    next();
  }, (req, res, next) => handler(req, res).catch(next));
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (body, suppliedRole = role) => fetch(`http://127.0.0.1:${server.address().port}/account`, {
    method: "DELETE", headers: { "Content-Type": "application/json", "x-role": suppliedRole }, body: JSON.stringify(body)
  });
  return { db, id, other, request, revoked, fail: value => { failMedia = value; } };
}

test("deletion requires an account session, current password and explicit confirmation", async t => {
  const f = await fixture(t);
  assert.equal((await f.request({}, "admin")).status, 401);
  assert.equal((await f.request({}, "")).status, 401);
  assert.equal((await f.request({ password: "correct-password", confirmation: "delete" })).status, 400);
  assert.equal((await f.request({ password: "wrong", confirmation: "DELETE" })).status, 403);
  assert.equal((await f.db.collection("users").findOne({ _id: f.id })).deletionStartedAt, undefined);
  assert.equal((await f.db.collection("videos").findOne({ _id: "owned" })).published, true);
});

test("creator deletion removes profile/media/social data, revokes all sessions and preserves financial evidence", async t => {
  const f = await fixture(t);
  assert.equal((await f.request({ password: "correct-password", confirmation: "DELETE" })).status, 204);
  assert.equal(await f.db.collection("users").findOne({ _id: f.id }), null);
  assert.ok(await f.db.collection("users").findOne({ _id: f.other }));
  const video = await f.db.collection("videos").findOne({ _id: "owned" });
  assert.equal(video.published, false);
  assert.equal(video.title, "Deleted video");
  assert.equal(video.bunnyVideoId, undefined);
  assert.equal(video.thumbnailImageId, undefined);
  assert.equal((await f.db.collection("videos").findOne({ _id: "other" })).published, true);
  assert.equal((await f.db.collection("ads").findOne({ creatorVideoId: "owned" })).active, false);
  assert.equal((await f.db.collection("ads").findOne({ creatorId: f.other.toString() })).active, true);
  for (const name of ["videoLikes", "videoComments", "savedShorts", "shortReports"]) {
    assert.equal(await f.db.collection(name).countDocuments({}), 1);
  }
  for (const bucket of ["creatorProfilePhotos", "videoThumbnails"]) {
    assert.equal(await f.db.collection(`${bucket}.files`).countDocuments({}), 0);
    assert.equal(await f.db.collection(`${bucket}.chunks`).countDocuments({}), 0);
  }
  assert.equal(await f.db.collection("sessions").countDocuments({ userId: f.id.toString() }), 0);
  assert.equal(await f.db.collection("sessions").countDocuments({ userId: f.other.toString() }), 1);
  assert.deepEqual(f.revoked, [f.id.toString()]);
  const payment = await f.db.collection("membershipPayments").findOne({ creatorId: f.id.toString() });
  assert.equal(payment.amountRupees, 199);
  assert.equal(payment.username, "Deleted account");
  assert.ok(payment.proofId);
  assert.equal(await f.db.collection("adCompletedViews").countDocuments({ creatorId: f.id.toString() }), 1);
  assert.equal(await f.db.collection("notifications").countDocuments({}), 1);
});

test("provider failure disables videos/ads and permits idempotent deletion retry", async t => {
  const f = await fixture(t);
  f.fail(true);
  assert.equal((await f.request({ password: "correct-password", confirmation: "DELETE" })).status, 500);
  const pending = await f.db.collection("users").findOne({ _id: f.id });
  assert.ok(pending.deletionStartedAt);
  assert.equal(pending.approvalStatus, "deleted");
  assert.equal((await f.db.collection("videos").findOne({ _id: "owned" })).published, false);
  assert.equal((await f.db.collection("ads").findOne({ creatorVideoId: "owned" })).active, false);
  assert.equal(f.revoked.length, 0);
  f.fail(false);
  assert.equal((await f.request({ password: "correct-password", confirmation: "DELETE" })).status, 204);
  assert.equal(await f.db.collection("users").findOne({ _id: f.id }), null);
});

test("business deletion stops paid ads and removes creative media but retains payment proof", async t => {
  const f = await fixture(t, "business");
  const media = new ObjectId();
  const proof = new ObjectId();
  await f.db.collection("businessAdSubmissions").insertOne({ businessId: f.id.toString(), title: "Paid", videoId: media, proofId: proof, amountRupees: 500 });
  await f.db.collection("businessAdVideos.files").insertOne({ _id: media });
  await f.db.collection("businessAdVideos.chunks").insertOne({ files_id: media });
  await f.db.collection("businessAdProofs.files").insertOne({ _id: proof });
  await f.db.collection("ads").insertOne({ businessId: f.id.toString(), active: true, mediaUrl: "/business-ads/media" });
  assert.equal((await f.request({ password: "correct-password", confirmation: "DELETE" })).status, 204);
  assert.equal(await f.db.collection("businessAdVideos.files").countDocuments({}), 0);
  assert.equal(await f.db.collection("businessAdVideos.chunks").countDocuments({}), 0);
  assert.equal(await f.db.collection("businessAdProofs.files").countDocuments({}), 1);
  const ad = await f.db.collection("ads").findOne({ businessId: f.id.toString() });
  assert.equal(ad.active, false);
  assert.equal(ad.mediaUrl, undefined);
  const submission = await f.db.collection("businessAdSubmissions").findOne({ businessId: f.id.toString() });
  assert.equal(submission.amountRupees, 500);
  assert.equal(submission.videoId, undefined);
});

test("pending deletion blocks normal requests but permits retry; missing users cannot use stale sessions", async () => {
  const db = memoryDatabase();
  const id = new ObjectId();
  await db.collection("users").insertOne({ _id: id, deletionStartedAt: "now" });
  const guard = accountAccessGuard({ getDb: () => db, sessionFor: () => ({ userId: id.toString() }) });
  let status, nextCalled;
  const res = { status(value) { status = value; return this; }, json(value) { return value; } };
  for (const [method, path, expected] of [
    ["GET", "/api/account", 409], ["POST", "/api/creator/videos", 409],
    ["DELETE", "/api/account", undefined], ["POST", "/api/auth/logout", undefined]
  ]) {
    status = undefined; nextCalled = false;
    await guard({ method, path }, res, () => { nextCalled = true; });
    assert.equal(status, expected);
    assert.equal(nextCalled, expected === undefined);
  }
  await db.collection("users").deleteOne({ _id: id });
  await guard({ method: "GET", path: "/api/account" }, res, () => assert.fail("Deleted user must not pass"));
  assert.equal(status, 401);
});

test("viewer and promoter accounts can delete themselves without creator approval", async t => {
  for (const role of ["member", "promoter"]) {
    const f = await fixture(t, role);
    assert.equal((await f.request({ password: "correct-password", confirmation: "DELETE", userId: f.other.toString() })).status, 204);
    assert.equal(await f.db.collection("users").findOne({ _id: f.id }), null);
    assert.ok(await f.db.collection("users").findOne({ _id: f.other }));
  }
});
