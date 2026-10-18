export const SIMPLY_EARNING_MILLI_RUPEES = 25;
const REGULAR_RATE_RUPEES = 50;
const RATE_VIEWS = 1000;
const REGULAR_VIEW_MILLI_RUPEES = REGULAR_RATE_RUPEES * 1000 / RATE_VIEWS;
const SIMPLY_RATE_RUPEES = SIMPLY_EARNING_MILLI_RUPEES * RATE_VIEWS / 1000;
const displayRupees = milliRupees => Math.round(milliRupees / 10) / 100;

export async function creatorWallet(db, creatorId) {
  const videos = await db.collection("videos").find(
    { ownerId: creatorId },
    { projection: { title: 1, views: 1, videoType: 1 } }
  ).sort({ createdAt: -1 }).toArray();
  const videoIds = videos.map(video => video._id);
  const simplyIds = videos.filter(video => video.videoType === "short").map(video => video._id);
  const [regular, simply] = await Promise.all([
    videoIds.length ? db.collection("uniqueVideoViews").aggregate([
      { $match: { videoId: { $in: videoIds } } },
      { $group: { _id: "$videoId", eligibleViews: { $sum: 1 } } }
    ]).toArray() : [],
    simplyIds.length ? db.collection("shortViews").aggregate([
      { $match: { videoId: { $in: simplyIds }, creatorId, earningMilliRupees: { $gt: 0 } } },
      { $group: { _id: "$videoId", eligibleViews: { $sum: 1 }, milliRupees: { $sum: "$earningMilliRupees" } } }
    ]).toArray() : []
  ]);
  const regularById = new Map(regular.map(row => [row._id, row]));
  const simplyById = new Map(simply.map(row => [row._id, row]));
  let totalMilliRupees = 0;
  const walletVideos = videos.map(video => {
    const isSimply = video.videoType === "short";
    const regularViews = regularById.get(video._id)?.eligibleViews || 0;
    const simply = isSimply ? simplyById.get(video._id) : undefined;
    const eligibleViews = regularViews + (simply?.eligibleViews || 0);
    const milliRupees = regularViews * REGULAR_VIEW_MILLI_RUPEES + (simply?.milliRupees || 0);
    totalMilliRupees += milliRupees;
    return {
      id: video._id, title: video.title, videoType: isSimply ? "short" : "regular",
      totalViews: Number(video.views || 0), eligibleViews,
      rateRupees: isSimply ? SIMPLY_RATE_RUPEES : REGULAR_RATE_RUPEES,
      legacyRegularEligibleViews: isSimply ? regularViews : 0,
      rateViews: RATE_VIEWS, estimatedEarningsRupees: displayRupees(milliRupees)
    };
  });
  return {
    totalViews: walletVideos.reduce((sum, video) => sum + video.totalViews, 0),
    eligibleViews: walletVideos.reduce((sum, video) => sum + video.eligibleViews, 0),
    rateRupees: REGULAR_RATE_RUPEES, rateViews: RATE_VIEWS,
    simplyRateRupees: SIMPLY_RATE_RUPEES, simplyRateViews: RATE_VIEWS,
    estimatedEarningsRupees: displayRupees(totalMilliRupees), videos: walletVideos
  };
}
