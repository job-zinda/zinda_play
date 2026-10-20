import { displayRupees, rewardSettings } from "./rewards.js";

const RATE_VIEWS = 1000;

export async function creatorWallet(db, creatorId) {
  const rates = await rewardSettings(db);
  const videos = await db.collection("videos").find(
    { ownerId: creatorId },
    { projection: { title: 1, views: 1, videoType: 1, deletedAt: 1 } }
  ).sort({ createdAt: -1 }).toArray();
  const videoIds = videos.map(video => video._id);
  const simplyIds = videos.filter(video => video.videoType === "short").map(video => video._id);
  const [regular, simply, ads] = await Promise.all([
    videoIds.length ? db.collection("uniqueVideoViews").aggregate([
      { $match: { videoId: { $in: videoIds } } },
      // Ledger rows before rate snapshots earned a fixed 50 milli-rupees.
      { $group: { _id: "$videoId", eligibleViews: { $sum: 1 }, milliRupees: { $sum: { $ifNull: ["$earningMilliRupees", 50] } } } }
    ]).toArray() : [],
    simplyIds.length ? db.collection("shortViews").aggregate([
      { $match: { videoId: { $in: simplyIds }, creatorId, earningMilliRupees: { $gte: 0 } } },
      { $group: { _id: "$videoId", eligibleViews: { $sum: 1 }, milliRupees: { $sum: "$earningMilliRupees" } } }
    ]).toArray() : [],
    db.collection("adCompletedViews").aggregate([
      { $match: { creatorId, earningMilliRupees: { $gte: 0 } } },
      { $group: { _id: "$videoId", eligibleViews: { $sum: 1 }, milliRupees: { $sum: "$earningMilliRupees" } } }
    ]).toArray()
  ]);
  const regularById = new Map(regular.map(row => [row._id, row]));
  const simplyById = new Map(simply.map(row => [row._id, row]));
  const adsById = new Map(ads.map(row => [row._id, row]));
  let totalMilliRupees = 0;
  const walletVideos = videos.map(video => {
    const isSimply = video.videoType === "short";
    const regularViews = regularById.get(video._id)?.eligibleViews || 0;
    const simply = isSimply ? simplyById.get(video._id) : undefined;
    const eligibleViews = regularViews + (simply?.eligibleViews || 0);
    const milliRupees = (regularById.get(video._id)?.milliRupees || 0) + (simply?.milliRupees || 0);
    totalMilliRupees += milliRupees;
    return {
      id: video._id, title: video.title, videoType: isSimply ? "short" : "regular",
      deleted: Boolean(video.deletedAt), deletedAt: video.deletedAt || null,
      totalViews: Number(video.views || 0), eligibleViews,
      rateRupees: (isSimply ? rates.creatorSimplyViews : rates.creatorRegularViews).rateRupees,
      legacyRegularEligibleViews: isSimply ? regularViews : 0,
      rateViews: RATE_VIEWS, estimatedEarningsRupees: displayRupees(milliRupees),
      adEligibleViews: adsById.get(video._id)?.eligibleViews || 0,
      adEstimatedEarningsRupees: displayRupees(adsById.get(video._id)?.milliRupees || 0),
      totalEstimatedEarningsRupees: displayRupees(milliRupees + (adsById.get(video._id)?.milliRupees || 0)),
      adRateRupees: (isSimply ? rates.creatorSimplyAds : rates.creatorRegularAds).rateRupees, adRateViews: RATE_VIEWS
    };
  });
  return {
    totalViews: walletVideos.reduce((sum, video) => sum + video.totalViews, 0),
    eligibleViews: walletVideos.reduce((sum, video) => sum + video.eligibleViews, 0),
    rewardSettings: rates,
    rateRupees: rates.creatorRegularViews.rateRupees, rateViews: RATE_VIEWS,
    simplyRateRupees: rates.creatorSimplyViews.rateRupees, simplyRateViews: RATE_VIEWS,
    creatorAdRateRupees: rates.creatorRegularAds.rateRupees, simplyAdRateRupees: rates.creatorSimplyAds.rateRupees, adRateViews: RATE_VIEWS,
    adEligibleViews: ads.reduce((sum, row) => sum + row.eligibleViews, 0),
    adEstimatedEarningsRupees: displayRupees(ads.reduce((sum, row) => sum + row.milliRupees, 0)),
    videoEstimatedEarningsRupees: displayRupees(totalMilliRupees),
    estimatedEarningsRupees: displayRupees(totalMilliRupees + ads.reduce((sum, row) => sum + row.milliRupees, 0)), videos: walletVideos
  };
}
