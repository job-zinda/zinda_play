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

export const adSurfaceLabels = { video: "Normal videos", simply: "Simply", home: "Homepage" };
export const bannerPositions = ["top", "middle", "bottom"];

export function effectiveAdPlacements(ad) {
  return ad.placements ?? (ad.type === "video" ? ["video"] : ["home"]);
}

export function normalizeAdPlacements(body) {
  const placements = Object.hasOwn(body, "placements") ? body.placements : effectiveAdPlacements(body);
  if (!Array.isArray(placements) || !placements.length ||
      placements.some(value => !Object.hasOwn(adSurfaceLabels, value))) {
    return { error: "Choose at least one valid ad placement: Normal videos, Simply or Homepage." };
  }
  if (body.type !== "video" && placements.some(value => value !== "home")) {
    return { error: "Image ads can only appear on the homepage. Use a video ad for Normal videos or Simply." };
  }
  return { placements: [...new Set(placements)] };
}

export function adPlacementQuery(placement) {
  if (placement === "simply" || placement === "home") {
    return { type: "video", placements: placement };
  }
  if (placement === "video" || bannerPositions.includes(placement)) {
    return {
      type: placement === "video" ? "video" : "banner",
      ...(placement === "video" ? {} : { placement }),
      $or: [
        { placements: placement === "video" ? "video" : "home" },
        { placements: { $exists: false } }
      ]
    };
  }
  return null;
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
