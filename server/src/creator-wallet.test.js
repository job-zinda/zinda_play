import assert from "node:assert/strict";
import test from "node:test";
import { memoryDatabase } from "../test-support/memory-database.js";
import { creatorWallet } from "./creator-wallet.js";

async function fixture() {
  const db = memoryDatabase();
  for (const video of [
    { _id: "regular", ownerId: "creator", title: "Regular", views: 2000 },
    { _id: "simply", ownerId: "creator", title: "Simply", views: 5000, videoType: "short" },
    { _id: "other", ownerId: "another", title: "Other", views: 9000, videoType: "short" }
  ]) await db.collection("videos").insertOne(video);
  return db;
}

test("Simply pays exactly 25 per 1000 and 12.50 per 500 while regular rates stay 50", async () => {
  for (const [count, expected] of [[0, 0], [500, 12.5], [1000, 25], [1501, 37.53]]) {
    const db = await fixture();
    for (let i = 0; i < count; i++) await db.collection("shortViews").insertOne({
      videoId: "simply", viewerHash: `ip-${i}`, creatorId: "creator", earningMilliRupees: 25
    });
    for (let i = 0; i < 1000; i++) await db.collection("uniqueVideoViews").insertOne({ videoId: "regular", ipHash: `ip-${i}` });
    const wallet = await creatorWallet(db, "creator");
    assert.equal(wallet.videos.find(video => video.id === "simply").estimatedEarningsRupees, expected);
    assert.equal(wallet.videos.find(video => video.id === "regular").estimatedEarningsRupees, 50);
    assert.equal(wallet.estimatedEarningsRupees, Math.round((count * 25 + 50000) / 10) / 100);
    assert.equal(wallet.eligibleViews, count + 1000);
    assert.equal(wallet.simplyRateRupees, 25);
    assert.equal(wallet.videos.length, 2);
  }
});

test("historical Simply views never backfill earnings and other creators remain isolated", async () => {
  const db = await fixture();
  await db.collection("shortViews").insertOne({ videoId: "simply", viewerHash: "old", createdAt: "2026-01-01" });
  await db.collection("shortViews").insertOne({ videoId: "simply", viewerHash: "old-with-owner", creatorId: "creator" });
  await db.collection("shortViews").insertOne({ videoId: "other", viewerHash: "other", creatorId: "another", earningMilliRupees: 25 });
  await db.collection("shortViews").insertOne({ videoId: "simply", viewerHash: "wrong-owner", creatorId: "another", earningMilliRupees: 25 });
  const wallet = await creatorWallet(db, "creator");
  assert.equal(wallet.eligibleViews, 0);
  assert.equal(wallet.estimatedEarningsRupees, 0);
  assert.equal(wallet.totalViews, 7000);
  assert.deepEqual((await creatorWallet(db, "empty")).videos, []);
});

test("wallet rounds only for display after summing exact fractional-paise earnings", async () => {
  const db = await fixture();
  await db.collection("videos").insertOne({ _id: "simply2", ownerId: "creator", title: "Second", videoType: "short" });
  for (const videoId of ["simply", "simply2"]) await db.collection("shortViews").insertOne({ videoId, viewerHash: "ip", creatorId: "creator", earningMilliRupees: 25 });
  const wallet = await creatorWallet(db, "creator");
  assert.equal(wallet.estimatedEarningsRupees, 0.05);
  assert.equal(wallet.videos.find(video => video.id === "simply").estimatedEarningsRupees, 0.03);
});

test("converting a regular video to Simply retains previous regular earnings at their original rate", async () => {
  const db = await fixture();
  await db.collection("uniqueVideoViews").insertOne({ videoId: "simply", ipHash: "legacy" });
  await db.collection("shortViews").insertOne({ videoId: "simply", viewerHash: "old-unpaid" });
  let wallet = await creatorWallet(db, "creator");
  assert.equal(wallet.estimatedEarningsRupees, 0.05);
  await db.collection("shortViews").insertOne({ videoId: "simply", viewerHash: "new", creatorId: "creator", earningMilliRupees: 25 });
  wallet = await creatorWallet(db, "creator");
  assert.equal(wallet.estimatedEarningsRupees, 0.08);
  assert.equal(wallet.videos.find(video => video.id === "simply").legacyRegularEligibleViews, 1);
  assert.equal(wallet.eligibleViews, 2);
});
