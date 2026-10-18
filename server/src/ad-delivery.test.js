import assert from "node:assert/strict";
import test from "node:test";
import { adCapacityExpression, adReport, claimAdImpression, normalizeAdFrequency } from "./ad-delivery.js";
import { dueVideoAds, markAdDelivered } from "../../client/src/ad-frequency.js";

test("ad frequency accepts only every 1, 5, or 10 videos", () => {
  for (const value of [1, 5, 10, "5"]) assert.equal(normalizeAdFrequency(value), Number(value));
  assert.equal(normalizeAdFrequency(), 1);
  for (const value of [0, -1, 2, 1.5, 100, null, "invalid"]) assert.equal(normalizeAdFrequency(value), null);
});

test("each ad becomes due at its own interval and resets only when delivered", () => {
  const ads = [{ id: "one", frequency: 1 }, { id: "five", frequency: 5 }, { id: "ten", frequency: 10 }];
  for (let opening = 1; opening <= 20; opening++) {
    const due = dueVideoAds(ads);
    assert.deepEqual(due.map(ad => ad.id), [
      "one", ...(opening % 5 === 0 ? ["five"] : []), ...(opening % 10 === 0 ? ["ten"] : [])
    ]);
    due.forEach(ad => markAdDelivered(ad.id));
  }
  const delayed = [{ id: "not-selected", frequency: 5 }];
  for (let i = 0; i < 4; i++) assert.deepEqual(dueVideoAds(delayed), []);
  assert.equal(dueVideoAds(delayed).length, 1);
  assert.equal(dueVideoAds(delayed).length, 1);
  markAdDelivered("not-selected");
  assert.deepEqual(dueVideoAds(delayed), []);
});

test("reports show completion, remaining impressions and CTR without division by zero", () => {
  assert.deepEqual(adReport({ impressions: 100, targetViews: 100, clicks: 4 }), {
    deliveryStatus: "completed", remainingImpressions: 0, completionPercent: 100,
    clickThroughRate: 4, completedAt: null
  });
  assert.equal(adReport({ impressions: 50, targetViews: 100 }).completionPercent, 50);
  assert.equal(adReport({ active: false }).deliveryStatus, "paused");
  assert.equal(adReport({}).clickThroughRate, 0);
  assert.equal(adReport({}).remainingImpressions, null);
});

test("atomic impression claims cap simultaneous deliveries and timestamp completion", async () => {
  const ad = { _id: "limited", active: true, impressions: 0, targetViews: 5 };
  const collection = {
    async findOneAndUpdate(filter, update, options) {
      assert.deepEqual(filter.$expr, adCapacityExpression);
      assert.deepEqual(filter.active, { $ne: false });
      assert.equal(options.returnDocument, "after");
      if (!ad.active || ad.impressions >= ad.targetViews) return null;
      ad.impressions += update.$inc.impressions;
      return { ...ad };
    },
    async updateOne(filter, update) {
      if (ad.impressions === filter.impressions) Object.assign(ad, update.$set);
    }
  };
  const claims = await Promise.all(Array.from({ length: 100 }, () => claimAdImpression(collection, "limited", "2026-10-18")));
  assert.equal(claims.filter(Boolean).length, 5);
  assert.equal(ad.impressions, 5);
  assert.equal(ad.completedAt, "2026-10-18");
  assert.equal(await claimAdImpression(collection, "limited"), false);
});
