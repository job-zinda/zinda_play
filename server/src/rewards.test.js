import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { memoryDatabase } from "../test-support/memory-database.js";
import {
  creditMemberWatch, defaultRewardSettings, eventMilliRupees, memberRewardTotals,
  recordMemberWatch, recordRegularView, registerRewardRoutes, rewardSettings, validateRewardSettings
} from "./rewards.js";
import { creatorWallet } from "./creator-wallet.js";

async function fixture(t) {
  const db = memoryDatabase();
  const app = express();
  app.use(express.json());
  registerRewardRoutes(app, {
    getDb: () => db,
    requireAdmin: (req, res, next) => req.get("authorization") === "Bearer admin" ? next() : res.sendStatus(401),
    asyncRoute: handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
  });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(path = "/admin/rewards/settings", method = "GET", body, token = "admin") {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, headers: response.headers, body: response.status === 401 ? null : await response.json() };
  }
  return { db, request };
}

test("six defaults, admin-only persistence, validation and public rate reads", async t => {
  const f = await fixture(t);
  const initial = (await f.request()).body;
  assert.deepEqual(Object.values(initial).map(item => item.rateRupees), [30, 20, 50, 25, 200, 100]);
  assert.ok(Object.values(initial).every(item => item.enabled && item.rateViews === 1000));
  for (const token of ["", "member", "creator", "business"]) {
    assert.equal((await f.request(undefined, "GET", undefined, token)).status, 401);
    assert.equal((await f.request(undefined, "PUT", initial, token)).status, 401);
  }
  const invalid = [
    null, {}, [], { ...initial, unexpected: {} },
    ...[-1, 1.5, "30", null, 1000001].map(rateRupees => ({ ...initial, memberWatch: { enabled: true, rateRupees } })),
    { ...initial, referralViews: { enabled: "false", rateRupees: 20 } },
    { ...initial, creatorSimplyViews: { enabled: true, rateRupees: 25, rateViews: 100 } }
  ];
  for (const body of invalid) {
    assert.ok(validateRewardSettings(body));
    assert.equal((await f.request(undefined, "PUT", body)).status, 400);
  }
  assert.deepEqual((await f.request()).body, initial);
  const next = Object.fromEntries(Object.keys(initial).map((key, i) => [key, { enabled: false, rateRupees: i }]));
  assert.equal((await f.request(undefined, "PUT", next)).status, 200);
  const publicSettings = await f.request("/rewards/settings", "GET", undefined, "");
  assert.equal(publicSettings.headers.get("cache-control"), "no-store");
  for (const key of Object.keys(next)) assert.deepEqual(publicSettings.body[key], { ...next[key], rateViews: 1000 });
  assert.equal((await f.db.collection("siteContent").findOne({ _id: "reward-settings" })).memberWatch.rateRupees, 0);
});

test("personal/referral rewards accrue per distinct event, preserve old milestones, freeze rates, and repair partial retries", async () => {
  const db = memoryDatabase();
  await db.collection("promoterRewards").insertOne({ sourceKey: "old", promoterId: "viewer", type: "promoter_watch", amountRupees: 10 });
  const rates = await rewardSettings(db);
  const watch = {
    videoId: "video", viewerId: "viewer", watchingPromoterId: "viewer", referredByPromoterId: "referrer",
    watchEarningMilliRupees: eventMilliRupees(rates.memberWatch),
    referralEarningMilliRupees: eventMilliRupees(rates.referralViews), watchedAt: new Date().toISOString()
  };
  const rewards = db.collection("promoterRewards");
  const update = rewards.updateOne.bind(rewards);
  let failReferral = true;
  rewards.updateOne = async (filter, ...args) => {
    if (failReferral && filter.sourceKey.endsWith("referral_view")) {
      failReferral = false;
      throw new Error("Credit interrupted");
    }
    return update(filter, ...args);
  };
  await assert.rejects(creditMemberWatch(db, watch), /Credit interrupted/);
  assert.equal((await memberRewardTotals(db, "viewer")).earnedRupees, 10.03);
  assert.equal((await memberRewardTotals(db, "viewer")).watchRewardMilestones, 1);
  await db.collection("siteContent").insertOne({ _id: "reward-settings", memberWatch: { enabled: false, rateRupees: 900 }, referralViews: { enabled: false, rateRupees: 800 } });
  const retries = await Promise.all([creditMemberWatch(db, watch), creditMemberWatch(db, watch)]);
  assert.deepEqual(retries, [0, 0]);
  assert.equal((await memberRewardTotals(db, "referrer")).earnedRupees, 0.02);
  assert.equal((await memberRewardTotals(db, "viewer")).earnedRupees, 10.03);
  const paused = await rewardSettings(db);
  await creditMemberWatch(db, { ...watch, videoId: "paused", watchEarningMilliRupees: eventMilliRupees(paused.memberWatch), referralEarningMilliRupees: eventMilliRupees(paused.referralViews) });
  await creditMemberWatch(db, { videoId: "old-unpaid", viewerId: "viewer", watchingPromoterId: "viewer" });
  assert.equal((await memberRewardTotals(db, "viewer")).earnedRupees, 10.03);
  await creditMemberWatch(db, { ...watch, videoId: "next", watchEarningMilliRupees: 50, referralEarningMilliRupees: 40 });
  assert.equal((await memberRewardTotals(db, "viewer")).earnedRupees, 10.08);
  assert.equal((await memberRewardTotals(db, "referrer")).earnedRupees, 0.06);
  assert.equal(await rewards.countDocuments({ promoterId: "viewer" }), 3);
});

test("1,000 personal/referral events pay exactly 30/20; display rounds after summing milli-rupees", async () => {
  const db = memoryDatabase();
  for (let i = 0; i < 1000; i++) await creditMemberWatch(db, {
    videoId: `video-${i}`, viewerId: "viewer", watchingPromoterId: "viewer", referredByPromoterId: "referrer",
    watchEarningMilliRupees: 30, referralEarningMilliRupees: 20
  });
  assert.equal((await memberRewardTotals(db, "viewer")).earnedRupees, 30);
  assert.equal((await memberRewardTotals(db, "referrer")).earnedRupees, 20);
  for (let i = 0; i < 10; i++) await creditMemberWatch(db, {
    videoId: `fraction-${i}`, viewerId: "small-rate", watchingPromoterId: "small-rate", watchEarningMilliRupees: 1
  });
  assert.equal((await memberRewardTotals(db, "small-rate")).earnedRupees, 0.01);
});

test("regular view snapshots retain legacy 50, explicit zero and changed rates regardless of current settings", async () => {
  const db = memoryDatabase();
  await db.collection("videos").insertOne({ _id: "regular", ownerId: "creator", title: "Regular", views: 3 });
  await db.collection("uniqueVideoViews").insertOne({ videoId: "regular", ipHash: "legacy" });
  await db.collection("uniqueVideoViews").insertOne({ videoId: "regular", ipHash: "new", earningMilliRupees: 80 });
  await db.collection("uniqueVideoViews").insertOne({ videoId: "regular", ipHash: "paused", earningMilliRupees: 0 });
  await db.collection("siteContent").insertOne({ _id: "reward-settings", ...defaultRewardSettings, creatorRegularViews: { enabled: false, rateRupees: 700 } });
  const wallet = await creatorWallet(db, "creator");
  assert.equal(wallet.estimatedEarningsRupees, 0.13);
  assert.equal(wallet.rateRupees, 700);
  assert.equal(wallet.rewardSettings.creatorRegularViews.enabled, false);
  assert.equal(wallet.eligibleViews, 3);
});

test("unique watch recording snapshots new rates, retries do not reprice, paused and historical watches never backfill", async () => {
  const db = memoryDatabase();
  const watch = { videoId: "first", viewerId: "viewer", watchingPromoterId: "viewer", referredByPromoterId: "referrer", watchedAt: "2026-10-20" };
  assert.deepEqual(await recordMemberWatch(db, watch), { counted: true, rewardRupees: 0.03 });
  await db.collection("siteContent").insertOne({
    _id: "reward-settings", memberWatch: { enabled: false, rateRupees: 90 },
    referralViews: { enabled: true, rateRupees: 40 }, creatorRegularViews: { enabled: false, rateRupees: 90 }
  });
  assert.equal(await recordRegularView(db, "regular", "paused"), true);
  assert.deepEqual(await recordMemberWatch(db, { ...watch, videoId: "paused" }), { counted: true, rewardRupees: 0 });
  await db.collection("siteContent").updateOne({ _id: "reward-settings" }, {
    $set: { memberWatch: { enabled: true, rateRupees: 50 }, creatorRegularViews: { enabled: true, rateRupees: 90 } }
  });
  const duplicates = await Promise.all([recordMemberWatch(db, watch), recordMemberWatch(db, watch)]);
  assert.ok(duplicates.every(result => !result.counted && result.rewardRupees === 0));
  await recordMemberWatch(db, { ...watch, videoId: "paused" });
  await db.collection("promoterVideoWatches").insertOne({ ...watch, videoId: "legacy" });
  await recordMemberWatch(db, { ...watch, videoId: "legacy" });
  assert.equal((await memberRewardTotals(db, "viewer")).earnedRupees, 0.03);
  assert.equal((await memberRewardTotals(db, "referrer")).earnedRupees, 0.06);
  await recordMemberWatch(db, { ...watch, videoId: "new-rate" });
  assert.equal((await memberRewardTotals(db, "viewer")).earnedRupees, 0.08);
  assert.equal(await recordRegularView(db, "regular", "paused"), false);
  assert.equal(await recordRegularView(db, "regular", "paid"), true);
  assert.deepEqual((await db.collection("uniqueVideoViews").find().toArray()).map(row => row.earningMilliRupees), [0, 90]);
});
