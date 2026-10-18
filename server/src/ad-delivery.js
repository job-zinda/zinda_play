export const adCapacityExpression = {
  $or: [
    { $lte: [{ $ifNull: ["$targetViews", 0] }, 0] },
    { $lt: [{ $ifNull: ["$impressions", 0] }, "$targetViews"] }
  ]
};

export function adReport(ad) {
  const impressions = ad.impressions || 0;
  const clicks = ad.clicks || 0;
  const target = ad.targetViews || 0;
  const completed = target > 0 && impressions >= target;
  return {
    deliveryStatus: completed ? "completed" : ad.active === false ? "paused" : "active",
    remainingImpressions: target ? Math.max(0, target - impressions) : null,
    completionPercent: target ? Math.min(100, impressions / target * 100) : null,
    clickThroughRate: impressions ? clicks / impressions * 100 : 0,
    completedAt: ad.completedAt || null
  };
}

export function normalizeAdFrequency(value = 1) {
  const frequency = Number(value);
  return [1, 5, 10].includes(frequency) ? frequency : null;
}

export async function claimAdImpression(collection, id, now = new Date().toISOString()) {
  const ad = await collection.findOneAndUpdate(
    { _id: id, active: { $ne: false }, $expr: adCapacityExpression },
    { $inc: { impressions: 1 } },
    { returnDocument: "after" }
  );
  if (!ad) return false;
  if (ad.targetViews > 0 && ad.impressions >= ad.targetViews) {
    await collection.updateOne({ _id: id, impressions: ad.impressions }, { $set: { completedAt: now } });
  }
  return true;
}
