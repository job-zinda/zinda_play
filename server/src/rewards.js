const settingsId = "reward-settings";
export const defaultRewardSettings = {
  memberWatch: { enabled: true, rateRupees: 30 },
  referralViews: { enabled: true, rateRupees: 20 },
  creatorRegularViews: { enabled: true, rateRupees: 50 },
  creatorSimplyViews: { enabled: true, rateRupees: 25 },
  creatorRegularAds: { enabled: true, rateRupees: 200 },
  creatorSimplyAds: { enabled: true, rateRupees: 100 }
};
export const displayRupees = milliRupees => Math.round(milliRupees / 10) / 100;

export async function rewardSettings(db) {
  const saved = await db.collection("siteContent").findOne({ _id: settingsId });
  return Object.fromEntries(Object.entries(defaultRewardSettings).map(([key, value]) => [
    key, { ...(saved?.[key] ?? value), rateViews: 1000 }
  ]));
}

export function validateRewardSettings(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Supply all six reward settings.";
  const keys = Object.keys(defaultRewardSettings);
  if (Object.keys(body).some(key => !keys.includes(key))) return "Unknown reward setting.";
  for (const key of keys) {
    const item = body[key];
    if (typeof item?.enabled !== "boolean") return `Specify whether ${key} is enabled.`;
    if (!Number.isSafeInteger(item.rateRupees) || item.rateRupees < 0 || item.rateRupees > 1000000) {
      return `${key}: enter a whole rupee rate between 0 and 1,000,000 per 1,000 events.`;
    }
    if (Object.keys(item).some(field => !["enabled", "rateRupees", "rateViews"].includes(field)) ||
        (item.rateViews !== undefined && item.rateViews !== 1000)) return "Reward rates must be per 1,000 events.";
  }
  return null;
}

export const eventMilliRupees = setting => setting.enabled ? setting.rateRupees : 0;

export async function recordRegularView(db, videoId, ipHash) {
  const rates = await rewardSettings(db);
  try {
    await db.collection("uniqueVideoViews").insertOne({
      videoId, ipHash, earningMilliRupees: eventMilliRupees(rates.creatorRegularViews),
      createdAt: new Date().toISOString()
    });
    return true;
  } catch (error) {
    if (error.code !== 11000) throw error;
    return false;
  }
}

export async function recordMemberWatch(db, watch) {
  const rates = await rewardSettings(db);
  let counted = false;
  try {
    await db.collection("promoterVideoWatches").insertOne({
      ...watch,
      watchEarningMilliRupees: eventMilliRupees(rates.memberWatch),
      referralEarningMilliRupees: eventMilliRupees(rates.referralViews)
    });
    counted = true;
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  const saved = await db.collection("promoterVideoWatches").findOne({ viewerId: watch.viewerId, videoId: watch.videoId });
  const rewardRupees = await creditMemberWatch(db, saved);
  return { counted, rewardRupees };
}

export function registerRewardRoutes(app, { getDb, requireAdmin, asyncRoute }) {
  app.get("/api/rewards/settings", asyncRoute(async (_req, res) => {
    res.set("Cache-Control", "no-store").json(await rewardSettings(getDb()));
  }));
  app.get("/api/admin/rewards/settings", requireAdmin, asyncRoute(async (_req, res) => {
    res.set("Cache-Control", "no-store").json(await rewardSettings(getDb()));
  }));
  app.put("/api/admin/rewards/settings", requireAdmin, asyncRoute(async (req, res) => {
    const error = validateRewardSettings(req.body);
    if (error) return res.status(400).json({ error });
    const settings = Object.fromEntries(Object.keys(defaultRewardSettings).map(key => [
      key, { enabled: req.body[key].enabled, rateRupees: req.body[key].rateRupees }
    ]));
    await getDb().collection("siteContent").updateOne({ _id: settingsId }, {
      $set: { ...settings, updatedAt: new Date().toISOString() }
    }, { upsert: true });
    res.json(await rewardSettings(getDb()));
  }));
}

// Snapshots belong to the unique watch, not to a retry or the current settings.
export async function creditMemberWatch(db, watch) {
  let awardedMilliRupees = 0;
  for (const [type, promoterId, amount] of [
    ["promoter_watch", watch.watchingPromoterId, watch.watchEarningMilliRupees],
    ["referral_view", watch.referredByPromoterId, watch.referralEarningMilliRupees]
  ]) {
    if (!promoterId || !Number.isSafeInteger(amount) || amount <= 0) continue;
    const sourceKey = `watch-v2:${watch.viewerId}:${watch.videoId}:${type}`;
    try {
      const result = await db.collection("promoterRewards").updateOne({ sourceKey }, {
        $setOnInsert: {
          sourceKey, promoterId, type, rewardVersion: 2,
          videoId: watch.videoId, viewerId: watch.viewerId,
          earningMilliRupees: amount, amountRupees: amount / 1000,
          createdAt: watch.watchedAt
        }
      }, { upsert: true });
      if (result.upsertedCount && type === "promoter_watch") awardedMilliRupees += amount;
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
  return awardedMilliRupees / 1000;
}

export async function memberRewardTotals(db, promoterId) {
  const rewards = db.collection("promoterRewards");
  const [totals, legacy] = await Promise.all([
    rewards.aggregate([
      { $match: { promoterId } },
      { $group: {
        _id: "$type",
        milliRupees: { $sum: { $ifNull: ["$earningMilliRupees", { $multiply: ["$amountRupees", 1000] }] } }
      } }
    ]).toArray(),
    rewards.aggregate([
      { $match: { promoterId, rewardVersion: { $ne: 2 } } },
      { $group: { _id: "$type", milestones: { $sum: 1 } } }
    ]).toArray()
  ]);
  return {
    earnedRupees: displayRupees(totals.reduce((sum, row) => sum + row.milliRupees, 0)),
    referralRewardMilestones: legacy.find(row => row._id === "referral_view")?.milestones || 0,
    watchRewardMilestones: legacy.find(row => row._id === "promoter_watch")?.milestones || 0
  };
}
