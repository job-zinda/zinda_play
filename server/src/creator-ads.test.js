import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { ObjectId } from "mongodb";
import { memoryDatabase } from "../test-support/memory-database.js";
import { creatorWallet } from "./creator-wallet.js";
import {
  createAdminAdHandler, creatorAdAdminReports, creatorAdEditError, creatorAdSourceAvailable,
  initializeCreatorAds, prepareCreatorAd, registerCreatorAdRoutes
} from "./creator-ads.js";

async function fixture(t, options = {}) {
  const db = memoryDatabase();
  await initializeCreatorAds(db);
  let time = 1800000000000;
  let failMedia = false;
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
  const sessionFor = req => {
    const token = req.get("authorization")?.replace(/^Bearer /, "");
    return token ? { userId: token } : null;
  };
  const requireAdmin = (req, res, next) => sessionFor(req)?.userId === "admin" ? next() : res.sendStatus(401);
  const requireCreator = (req, res, next) => {
    if (!sessionFor(req)) return res.sendStatus(401);
    req.creatorId = sessionFor(req).userId;
    next();
  };
  const cdnOrigin = () => "https://test.b-cdn.net";
  const metadata = async video => ({ length: video.verifiedDuration ?? video.durationSeconds, status: video.bunnyStatus ?? 4 });
  const serializeAd = ad => ({ ...ad, id: ad._id.toString() });
  app.post("/api/admin/ads", requireAdmin, wrap(createAdminAdHandler({
    getDb: () => db, loadMetadata: metadata, cdnOrigin, now: () => time, serializeAd,
    normalizeAd: body => {
      if (!body.title) return { error: "Title required" };
      return { fields: {
        title: body.title, type: body.type, mediaUrl: body.mediaUrl, targetUrl: body.targetUrl,
        active: body.active !== false, frequency: body.frequency || 1,
        targetViews: body.targetViews || 0, skippable: body.skippable !== false, skipAfterSeconds: body.skipAfterSeconds || 20
      } };
    }
  })));
  const routes = registerCreatorAdRoutes(app, {
    getDb: () => db, asyncRoute: wrap, requireAdmin, requireCreator, sessionFor,
    withCreatorProfiles: async videos => videos.map(({ _id, ownerId, ...video }) => ({ id: _id, ...video })),
    cdnOrigin, now: () => time, availableInCity: async ad => ad.targetCity !== "Elsewhere",
    deleteMedia: async () => { if (failMedia) throw new Error("CDN unavailable"); },
    ...options
  });
  app.post("/api/ads/:id/impression", wrap(routes.claimImpression));
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const oldSecret = process.env.VIEW_IP_HASH_SECRET;
  process.env.VIEW_IP_HASH_SECRET = "creator-ad-test-secret";
  t.after(() => { if (oldSecret === undefined) delete process.env.VIEW_IP_HASH_SECRET; else process.env.VIEW_IP_HASH_SECRET = oldSecret; });
  async function request(path, method = "GET", body, user, ip = "198.51.100.1") {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: {
        "Content-Type": "application/json", "X-Forwarded-For": ip, ...(user ? { Authorization: `Bearer ${user}` } : {})
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: response.status === 204 || response.status === 401 ? null : await response.json() };
  }
  async function video(id = "source", fields = {}) {
    const video = {
      _id: id, ownerId: "creator", title: id, videoType: "regular", bunnyVideoId: `bunny-${id}`,
      published: true, approvalStatus: "approved", processingStatus: "ready", durationSeconds: 10,
      shortValidated: true, createdAt: "2026-10-18T00:00:00.000Z", ...fields
    };
    await db.collection("videos").insertOne(video);
    return video;
  }
  async function ad(videoId = "source", fields = {}) {
    const prepared = await prepareCreatorAd(db, { title: "Creator ad", type: "video", creatorVideoId: videoId, targetUrl: "https://shop.example" }, { loadMetadata: metadata, cdnOrigin });
    assert.equal(prepared.error, undefined);
    const ad = { _id: new ObjectId(), ...prepared.fields, mediaUrl: prepared.body.mediaUrl, type: "video", active: true, impressions: 0, ...fields };
    await db.collection("ads").insertOne(ad);
    return ad;
  }
  const claim = (ad, ticket, user, ip) => request(`/ads/${ad._id}/impression`, "POST", { ticket }, user, ip);
  const start = async (ad, user, ip) => {
    const response = await request(`/ads/${ad._id}/view-start`, "POST", {}, user, ip);
    if (response.body?.ticket) assert.equal((await claim(ad, response.body.ticket, user, ip)).body.accepted, true);
    return response;
  };
  const complete = (ad, ticket, user, ip) => request(`/ads/${ad._id}/view`, "POST", { ticket }, user, ip);
  return { db, request, video, ad, start, claim, complete, advance: ms => { time += ms; }, failMedia: value => { failMedia = value; } };
}

test("admin candidate and create handlers authorize, derive native HLS and immutable rates from a verified source", async t => {
  const f = await fixture(t);
  await f.video("regular", { durationSeconds: 0, verifiedDuration: 12 });
  await f.video("simply", { videoType: "short" });
  await f.video("pending", { approvalStatus: "pending" });
  await f.video("hidden", { published: false });
  await f.video("processing", { processingStatus: "processing" });
  await f.video("business", { ownerBusinessId: "business" });
  await f.video("deleted", { deletedAt: "2026-10-17", published: false });
  assert.equal((await f.request("/admin/creator-ad-videos")).status, 401);
  const candidates = await f.request("/admin/creator-ad-videos", "GET", undefined, "admin");
  assert.deepEqual(candidates.body.map(video => video.id).sort(), ["regular", "simply"]);
  assert.equal(candidates.body[0].creatorId, "creator");
  for (const [id, rate] of [["regular", 200], ["simply", 100]]) {
    const response = await f.request("/admin/ads", "POST", {
      title: `${id} ad`, type: "video", creatorVideoId: id, targetUrl: "https://shop.example/product",
      mediaUrl: "https://untrusted.example/replacement.mp4", frequency: 5, targetViews: 100, skippable: false
    }, "admin");
    assert.equal(response.status, 201);
    assert.equal(response.body.mediaUrl, `https://test.b-cdn.net/bunny-${id}/playlist.m3u8`);
    assert.equal(response.body.creditRateRupees, rate);
    assert.equal(response.body.earningMilliRupees, rate);
    assert.equal(response.body.creatorId, "creator");
    assert.equal(response.body.creatorVideoType, id === "simply" ? "short" : "regular");
    assert.equal(response.body.frequency, 5);
    assert.equal(response.body.skippable, false);
    assert.equal(response.body.durationSeconds, id === "regular" ? 12 : 10);
  }
  for (const id of ["pending", "hidden", "processing", "business", "deleted", "missing"]) {
    assert.equal((await f.request("/admin/ads", "POST", { title: "Ad", type: "video", creatorVideoId: id, targetUrl: "https://shop.example" }, "admin")).status, 400);
  }
  assert.equal((await f.request("/admin/ads", "POST", { title: "Ad", type: "video", creatorVideoId: "simply", targetUrl: "javascript:alert(1)" }, "admin")).status, 400);
  assert.equal((await f.request("/admin/ads", "POST", { title: "Ad", type: "video", creatorVideoId: "simply", targetUrl: "https://shop.example", earningMilliRupees: 999 }, "admin")).status, 400);
  assert.equal((await f.request("/admin/ads", "POST", { title: "Ad", type: "video", earningMilliRupees: 999 }, "admin")).status, 400);
  const uploaded = await f.request("/admin/ads", "POST", { title: "Uploaded ad", type: "video", creatorVideoId: "", mediaUrl: "/ads/media/111111111111111111111111", targetUrl: "" }, "admin");
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.creatorVideoId, undefined);
});

test("full-watch handlers reject premature, forged, wrong IP/account/ad, and expired tickets without crediting impressions", async t => {
  const f = await fixture(t);
  await f.video();
  const ad = await f.ad("source", { impressions: 1000 });
  assert.equal((await creatorWallet(f.db, "creator")).estimatedEarningsRupees, 0);
  const ticket = (await f.start(ad, "member")).body.ticket;
  assert.equal((await f.complete(ad, ticket, "member")).status, 400);
  f.advance(10000);
  assert.equal((await f.complete(ad, `${ticket}bad`, "member")).status, 400);
  assert.equal((await f.complete(ad, ticket, "member", "198.51.100.2")).status, 400);
  assert.equal((await f.complete(ad, ticket, "different")).status, 400);
  assert.equal((await f.complete(ad, ticket)).status, 400);
  const other = await f.ad();
  assert.equal((await f.complete(other, ticket, "member")).status, 400);
  assert.equal((await f.complete(ad, "malformed", "member")).status, 400);
  f.advance(300001);
  assert.equal((await f.complete(ad, ticket, "member")).status, 400);
  assert.equal(f.db.collection("adCompletedViews").documents.length, 0);
});

test("completed unique IP/ad earns precisely 100/1000 for Simply and 200/1000 for regular; self and concurrent retries cannot double-credit", async t => {
  const f = await fixture(t);
  await f.video("regular");
  await f.video("simply", { videoType: "short" });
  for (const [id, rate] of [["regular", 0.2], ["simply", 0.1]]) {
    const ad = await f.ad(id);
    assert.equal((await f.start(ad, "creator")).body.eligible, false);
    const tickets = await Promise.all([f.start(ad, "viewer"), f.start(ad, "viewer")]);
    assert.equal(tickets[0].body.minimumWatchMs, 10000);
    f.advance(10000);
    const results = await Promise.all(tickets.map(result => f.complete(ad, result.body.ticket, "viewer")));
    assert.equal(results.filter(result => result.body.counted).length, 1);
    assert.equal(results.reduce((sum, result) => sum + result.body.earningRupees, 0), rate);
    assert.equal((await f.complete(ad, tickets[0].body.ticket, "viewer")).body.counted, false);
    const again = await f.start(ad, "second-account");
    f.advance(10000);
    assert.equal((await f.complete(ad, again.body.ticket, "second-account")).body.counted, false);
    const anotherIp = await f.start(ad, "viewer", "198.51.100.3");
    f.advance(10000);
    assert.equal((await f.complete(ad, anotherIp.body.ticket, "viewer", "198.51.100.3")).body.counted, true);
  }
  const wallet = await creatorWallet(f.db, "creator");
  assert.equal(wallet.adEligibleViews, 4);
  assert.equal(wallet.adEstimatedEarningsRupees, 0.6);
  assert.equal(wallet.estimatedEarningsRupees, 0.6);
  assert.equal(wallet.videos.find(row => row.id === "regular").adEstimatedEarningsRupees, 0.4);
  assert.equal(wallet.videos.find(row => row.id === "simply").adEstimatedEarningsRupees, 0.2);
});

test("a final accepted impression does not discard an already-started full-watch ticket", async t => {
  const f = await fixture(t);
  await f.video();
  const ad = await f.ad("source", { targetViews: 1 });
  const ticket = (await f.start(ad)).body.ticket;
  assert.equal((await f.db.collection("ads").findOne({ _id: ad._id })).impressions, 1);
  const retried = await f.claim(ad, ticket);
  assert.equal(retried.body.accepted, true);
  assert.equal(retried.body.duplicate, true);
  assert.equal((await f.start(ad)).status, 404);
  f.advance(10000);
  assert.equal((await f.complete(ad, ticket)).body.counted, true);
});

test("signed-in source owners receive a deliverable ticket and count impressions but never earn credit", async t => {
  const f = await fixture(t);
  await f.video();
  const ad = await f.ad();
  const started = await f.request(`/ads/${ad._id}/view-start`, "POST", {}, "creator");
  assert.equal(started.status, 200);
  assert.equal(started.body.eligible, false);
  assert.equal(typeof started.body.ticket, "string");
  assert.equal(started.body.minimumWatchMs, 10000);
  const delivery = await f.claim(ad, started.body.ticket, "creator");
  assert.equal(delivery.body.accepted, true);
  f.advance(10000);
  const completion = await f.complete(ad, started.body.ticket, "creator");
  assert.equal(completion.status, 200);
  assert.equal(completion.body.counted, false);
  assert.equal(completion.body.earningRupees, 0);
  assert.equal((await f.db.collection("ads").findOne({ _id: ad._id })).impressions, 1);
  assert.equal(f.db.collection("adCompletedViews").documents.length, 0);
  assert.equal((await creatorWallet(f.db, "creator")).estimatedEarningsRupees, 0);
});

test("a start ticket without an accepted delivery cannot earn and rejected capped tickets never acquire credit", async t => {
  const f = await fixture(t);
  await f.video();
  const ad = await f.ad("source", { targetViews: 1 });
  const unclaimed = (await f.request(`/ads/${ad._id}/view-start`, "POST", {})).body.ticket;
  f.advance(10000);
  assert.equal((await f.complete(ad, unclaimed)).status, 409);
  assert.equal((await creatorWallet(f.db, "creator")).adEstimatedEarningsRupees, 0);
  const winner = (await f.request(`/ads/${ad._id}/view-start`, "POST", {})).body.ticket;
  assert.equal((await f.claim(ad, winner)).body.accepted, true);
  assert.equal((await f.claim(ad, unclaimed)).body.accepted, false);
  f.advance(10000);
  assert.equal((await f.complete(ad, unclaimed)).status, 409);
  assert.equal((await f.complete(ad, winner)).body.counted, true);
  assert.equal((await f.db.collection("ads").findOne({ _id: ad._id })).impressions, 1);
});

test("concurrent delivery retries consume one nonce and one impression and bind full watch time to successful delivery", async t => {
  const f = await fixture(t);
  await f.video();
  const ad = await f.ad();
  const ticket = (await f.request(`/ads/${ad._id}/view-start`, "POST", {})).body.ticket;
  f.advance(10000);
  const claims = await Promise.all(Array.from({ length: 10 }, () => f.claim(ad, ticket)));
  assert.ok(claims.every(row => row.body.accepted));
  assert.equal(claims.filter(row => !row.body.duplicate).length, 1);
  assert.equal((await f.db.collection("ads").findOne({ _id: ad._id })).impressions, 1);
  assert.equal((await f.complete(ad, ticket)).status, 400);
  f.advance(10000);
  assert.equal((await f.complete(ad, ticket)).body.counted, true);
  await f.db.collection("ads").updateOne({ _id: ad._id }, { $set: { active: false } });
  assert.equal((await f.claim(ad, ticket)).status, 404);
  assert.equal((await f.complete(ad, ticket)).status, 404);
});

test("different delivery tickets compete atomically for the last impression and an interrupted claim can retry without incrementing twice", async t => {
  const f = await fixture(t);
  await f.video();
  const ad = await f.ad("source", { targetViews: 1 });
  const tickets = await Promise.all(Array.from({ length: 5 }, () => f.request(`/ads/${ad._id}/view-start`, "POST", {})));
  const ads = f.db.collection("ads");
  const originalClaim = ads.findOneAndUpdate.bind(ads);
  let interrupt = true;
  ads.findOneAndUpdate = async (...args) => {
    const result = await originalClaim(...args);
    if (result && args[1].$inc?.impressions && interrupt) {
      interrupt = false;
      throw new Error("Response interrupted after committed claim");
    }
    return result;
  };
  const results = await Promise.all(tickets.map(ticket => f.claim(ad, ticket.body.ticket)));
  assert.equal(results.filter(result => result.status === 500).length, 1);
  assert.equal(results.filter(result => result.body.accepted === false).length, 4);
  const winner = tickets[results.findIndex(result => result.status === 500)].body.ticket;
  const retry = await f.claim(ad, winner);
  assert.equal(retry.body.accepted, true);
  assert.equal(retry.body.duplicate, true);
  assert.equal((await ads.findOne({ _id: ad._id })).impressions, 1);
  f.advance(10000);
  assert.equal((await f.complete(ad, winner)).body.counted, true);
});

test("expired delivery markers are pruned without allowing old tickets to claim or complete again", async t => {
  const f = await fixture(t);
  await f.video();
  const ad = await f.ad();
  const old = (await f.start(ad)).body.ticket;
  assert.equal(Object.keys((await f.db.collection("ads").findOne({ _id: ad._id })).watchDeliveries).length, 1);
  f.advance(310001);
  assert.equal((await f.claim(ad, old)).status, 400);
  assert.equal((await f.complete(ad, old)).status, 400);
  await f.start(ad);
  const updated = await f.db.collection("ads").findOne({ _id: ad._id });
  assert.equal(Object.keys(updated.watchDeliveries).length, 1);
  assert.equal(updated.impressions, 2);
});

test("a completion retry repairs failed analytics without losing or double-crediting the committed earning ledger", async t => {
  const f = await fixture(t);
  await f.video();
  const ad = await f.ad();
  const ticket = (await f.start(ad)).body.ticket;
  f.advance(10000);
  const ads = f.db.collection("ads");
  const originalUpdate = ads.updateOne.bind(ads);
  let fail = true;
  ads.updateOne = async (...args) => {
    if (fail && args[1].$max) { fail = false; throw new Error("Interrupted analytics write"); }
    return originalUpdate(...args);
  };
  assert.equal((await f.complete(ad, ticket)).status, 500);
  assert.equal((await creatorWallet(f.db, "creator")).adEstimatedEarningsRupees, 0.2);
  const retried = await f.complete(ad, ticket);
  assert.equal(retried.status, 200);
  assert.equal(retried.body.counted, false);
  assert.equal(retried.body.completedViews, 1);
  assert.equal((await ads.findOne({ _id: ad._id })).completedViews, 1);
  assert.equal((await creatorWallet(f.db, "creator")).adEstimatedEarningsRupees, 0.2);
});

test("unpublished, paused, deleted, unready and location-ineligible sources stop serving and reject completion", async t => {
  const f = await fixture(t);
  const video = await f.video();
  const ad = await f.ad();
  const ticket = (await f.start(ad)).body.ticket;
  f.advance(10000);
  for (const fields of [
    { published: false }, { approvalStatus: "rejected" }, { processingStatus: "error" }, { deletedAt: "2026-10-18" }
  ]) {
    await f.db.collection("videos").updateOne({ _id: video._id }, { $set: fields });
    assert.equal(await creatorAdSourceAvailable(f.db, ad), false);
    assert.equal((await f.start(ad)).status, 404);
    assert.equal((await f.complete(ad, ticket)).status, 404);
    await f.db.collection("videos").updateOne({ _id: video._id }, { $set: { published: true, approvalStatus: "approved", processingStatus: "ready" }, $unset: { deletedAt: "" } });
  }
  for (const fields of [{ active: false }, { targetCity: "Elsewhere" }]) {
    await f.db.collection("ads").updateOne({ _id: ad._id }, { $set: fields });
    assert.equal((await f.start(ad)).status, 404);
    assert.equal((await f.complete(ad, ticket)).status, 404);
    await f.db.collection("ads").updateOne({ _id: ad._id }, { $set: { active: true }, $unset: { targetCity: "" } });
  }
  assert.equal(f.db.collection("adCompletedViews").documents.length, 0);
});

test("creator delete is owner-only, idempotent, stops linked ads and retains regular, Simply and ad wallet earnings/history", async t => {
  const f = await fixture(t);
  await f.video("regular");
  await f.video("simply", { videoType: "short" });
  const regularAd = await f.ad("regular");
  const simplyAd = await f.ad("simply");
  for (const ad of [regularAd, simplyAd]) {
    const ticket = (await f.start(ad)).body.ticket;
    f.advance(10000);
    assert.equal((await f.complete(ad, ticket)).body.counted, true);
  }
  await f.db.collection("uniqueVideoViews").insertOne({ videoId: "regular", ipHash: "original-regular" });
  await f.db.collection("shortViews").insertOne({ videoId: "simply", viewerHash: "original-short", creatorId: "creator", earningMilliRupees: 25 });
  await f.db.collection("savedShorts").insertOne({ videoId: "simply", userId: "viewer" });
  const before = await creatorWallet(f.db, "creator");
  assert.equal(before.estimatedEarningsRupees, 0.38);
  assert.equal((await f.request("/creator/videos/regular", "DELETE")).status, 401);
  assert.equal((await f.request("/creator/videos/regular", "DELETE", undefined, "another")).status, 404);
  for (const id of ["regular", "simply"]) {
    assert.equal((await f.request(`/creator/videos/${id}`, "DELETE", undefined, "creator")).status, 204);
    assert.equal((await f.request(`/creator/videos/${id}`, "DELETE", undefined, "creator")).status, 204);
  }
  const wallet = await creatorWallet(f.db, "creator");
  assert.equal(wallet.estimatedEarningsRupees, before.estimatedEarningsRupees);
  assert.equal(wallet.adEligibleViews, 2);
  assert.ok(wallet.videos.every(video => video.deleted && video.deletedAt));
  assert.equal(f.db.collection("ads").documents.length, 2);
  assert.ok(f.db.collection("ads").documents.every(ad => ad.active === false && ad.sourceDeletedAt));
  assert.ok(f.db.collection("videos").documents.every(video => video.published === false));
  assert.equal(f.db.collection("savedShorts").documents.length, 0);
  assert.equal(f.db.collection("shortViews").documents.length, 1);
  assert.equal(f.db.collection("uniqueVideoViews").documents.length, 1);
  assert.equal((await f.request("/admin/creator-ad-videos", "GET", undefined, "admin")).body.length, 0);
});

test("failed CDN cleanup leaves the source hidden, stops ads, retains credit and can be retried safely", async t => {
  const f = await fixture(t);
  await f.video();
  const ad = await f.ad();
  f.failMedia(true);
  assert.equal((await f.request("/creator/videos/source", "DELETE", undefined, "creator")).status, 500);
  assert.equal((await f.db.collection("videos").findOne({ _id: "source" })).published, false);
  assert.equal((await f.db.collection("ads").findOne({ _id: ad._id })).active, false);
  f.failMedia(false);
  assert.equal((await f.request("/creator/videos/source", "DELETE", undefined, "creator")).status, 204);
});

test("watch start and completion endpoints enforce independent per-IP rate limits", async t => {
  const f = await fixture(t);
  await f.video();
  const ad = await f.ad();
  for (let i = 0; i < 30; i++) assert.equal((await f.start(ad)).status, 200);
  assert.equal((await f.start(ad)).status, 429);
  for (let i = 0; i < 60; i++) assert.equal((await f.complete(ad, "invalid")).status, 400);
  assert.equal((await f.complete(ad, "invalid")).status, 429);
  f.advance(60000);
  assert.equal((await f.start(ad)).status, 200);
});

test("creator ad source metadata is locked and ordinary ads cannot be forged into earning ads", () => {
  const ad = { creatorVideoId: "source", creatorId: "creator", type: "video", mediaUrl: "https://test.b-cdn.net/source/playlist.m3u8", creditRateRupees: 200 };
  for (const key of ["creatorVideoId", "creatorId", "type", "mediaUrl", "durationSeconds", "creditRateRupees", "creditRateViews", "earningMilliRupees", "sourceVideoType", "bunnyVideoId"]) {
    assert.ok(creatorAdEditError(ad, { [key]: "forged" }));
  }
  assert.equal(creatorAdEditError(ad, { targetUrl: "https://new.example", active: false, frequency: 10 }), null);
  assert.equal(creatorAdEditError(ad, { creatorVideoId: ad.creatorVideoId }), null);
  assert.ok(creatorAdEditError({}, { creatorVideoId: "source" }));
  assert.equal(creatorAdEditError({}, { creatorVideoId: "" }), null);
  assert.ok(creatorAdEditError({ ...ad, sourceDeletedAt: "2026-10-18" }, { active: true }));
});

test("durable ad earnings remain in wallet even if a source tombstone is accidentally removed", async () => {
  const db = memoryDatabase();
  await db.collection("adCompletedViews").insertOne({ videoId: "removed", creatorId: "creator", earningMilliRupees: 200 });
  assert.equal((await creatorWallet(db, "creator")).estimatedEarningsRupees, 0.2);
  assert.equal((await creatorWallet(db, "other")).estimatedEarningsRupees, 0);
});

test("admin reports derive completed counts and credit from durable ledgers and expose unavailable sources", async t => {
  const f = await fixture(t);
  const video = await f.video();
  const ad = await f.ad("source", { completedViews: 999 });
  const ticket = (await f.start(ad)).body.ticket;
  f.advance(10000);
  await f.complete(ad, ticket);
  let report = (await creatorAdAdminReports(f.db, [ad]))[0];
  assert.equal(report.adEligibleViews, 1);
  assert.equal(report.completedViews, 1);
  assert.equal(report.adEstimatedEarningsRupees, 0.2);
  assert.equal(report.sourceAvailable, true);
  await f.db.collection("videos").updateOne({ _id: video._id }, { $set: { published: false } });
  report = (await creatorAdAdminReports(f.db, [ad]))[0];
  assert.equal(report.sourceAvailable, false);
  assert.equal(report.adEstimatedEarningsRupees, 0.2);
});

test("source location restrictions remain effective even when an ad has no city targeting", async t => {
  const f = await fixture(t);
  await f.video("source", { targetCity: "Elsewhere" });
  const ad = await f.ad();
  assert.equal(await creatorAdSourceAvailable(f.db, ad, {}, async video => video.targetCity !== "Elsewhere"), false);
  assert.equal((await f.request(`/ads/${ad._id}/view-start`, "POST", {})).status, 404);
  assert.equal((await f.request(`/ads/${ad._id}/impression`, "POST", { ticket: "invalid" })).status, 400);
});
