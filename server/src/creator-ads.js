import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { ObjectId } from "mongodb";
import { shortsCdnOrigin } from "./shorts.js";
import { adCapacityExpression } from "./ad-delivery.js";
import { eventMilliRupees, rewardSettings } from "./rewards.js";

export const creatorAdVideoQuery = {
  ownerId: { $exists: true, $ne: null }, ownerBusinessId: { $exists: false },
  deletedAt: { $exists: false }, published: true, approvalStatus: "approved",
  processingStatus: "ready", bunnyVideoId: { $exists: true },
  $or: [{ videoType: { $ne: "short" } }, { shortValidated: true }]
};
const protectedFields = [
  "creatorVideoId", "creatorId", "creatorVideoType", "sourceVideoType", "bunnyVideoId", "durationSeconds",
  "creditRateRupees", "creditRateViews", "earningMilliRupees", "streamUrl", "creatorVideoTitle"
];

export function creatorAdMedia(video, origin = shortsCdnOrigin()) {
  return `${origin}/${encodeURIComponent(video.bunnyVideoId)}/playlist.m3u8`;
}

export function creatorAdEditError(existing, body = {}) {
  const locked = existing.creatorVideoId ? [...protectedFields, "type", "mediaUrl"] : protectedFields;
  if (locked.some(key => Object.hasOwn(body, key) && !(key === "creatorVideoId" && !existing.creatorVideoId && body[key] === "") && JSON.stringify(body[key]) !== JSON.stringify(existing[key]))) {
    return "Creator ad source, media, duration and earning rate are locked. Create a new ad to change its source.";
  }
  if (existing.sourceDeletedAt && body.active === true) return "The source video was deleted. This ad cannot be restarted.";
  return null;
}

export async function prepareCreatorAd(db, body, { loadMetadata, cdnOrigin = shortsCdnOrigin } = {}) {
  if (body?.creatorVideoId === "") {
    const { creatorVideoId, ...upload } = body;
    body = upload;
  }
  if (!Object.hasOwn(body || {}, "creatorVideoId")) {
    if (protectedFields.some(key => Object.hasOwn(body || {}, key))) return { error: "Creator earning metadata is server-managed." };
    return { body, fields: {} };
  }
  if (body.type !== "video" || typeof body.creatorVideoId !== "string" || !body.creatorVideoId || body.creatorVideoId.length > 128) {
    return { error: "Choose an existing creator video for a video ad." };
  }
  if (protectedFields.filter(key => key !== "creatorVideoId").some(key => Object.hasOwn(body, key))) {
    return { error: "Creator earning metadata is server-managed." };
  }
  const video = await db.collection("videos").findOne({ ...creatorAdVideoQuery, _id: body.creatorVideoId });
  if (!video?.ownerId || !video.bunnyVideoId) return { error: "Choose an approved, published and ready creator video." };
  const metadata = loadMetadata ? await loadMetadata(video) : { length: video.durationSeconds, status: 4 };
  const durationSeconds = Number(metadata.length);
  if (metadata.status !== 4 || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 86400) {
    return { error: "The source video must have a verified playable duration." };
  }
  if (video.videoType === "short" && durationSeconds > 60) return { error: "Simply ads must be no longer than 60 seconds." };
  const targetUrl = typeof body.targetUrl === "string" ? body.targetUrl.trim() : "";
  try {
    const url = new URL(targetUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || targetUrl.length > 2048) throw new Error();
  } catch { return { error: "Enter an HTTP or HTTPS destination URL without embedded credentials." }; }
  const mediaUrl = creatorAdMedia(video, cdnOrigin());
  const rates = await rewardSettings(db);
  const rate = video.videoType === "short" ? rates.creatorSimplyAds : rates.creatorRegularAds;
  const fields = {
    creatorVideoId: video._id, creatorId: video.ownerId, creatorVideoTitle: video.title,
    creatorVideoType: video.videoType === "short" ? "short" : "regular",
    sourceVideoType: video.videoType === "short" ? "short" : "regular",
    bunnyVideoId: video.bunnyVideoId, durationSeconds,
    creditRateRupees: rate.rateRupees, creditRateViews: 1000,
    earningMilliRupees: eventMilliRupees(rate)
  };
  return { body: { ...body, mediaUrl, targetUrl }, fields };
}

export async function creatorAdSourceAvailable(db, ad, req, availableInCity) {
  if (!ad.creatorVideoId) return true;
  const video = await db.collection("videos").findOne({
    ...creatorAdVideoQuery, _id: ad.creatorVideoId, ownerId: ad.creatorId, bunnyVideoId: ad.bunnyVideoId
  });
  return Boolean(video) && (!availableInCity || await availableInCity(video, req));
}

export async function creatorAdAdminReports(db, ads) {
  const rates = await rewardSettings(db);
  const totals = await db.collection("adCompletedViews").aggregate([
    { $match: { adId: { $in: ads.map(ad => ad._id.toString()) }, earningMilliRupees: { $gte: 0 } } },
    { $group: { _id: "$adId", views: { $sum: 1 }, milliRupees: { $sum: "$earningMilliRupees" } } }
  ]).toArray();
  const byId = new Map(totals.map(row => [row._id, row]));
  return Promise.all(ads.map(async ad => {
    const total = byId.get(ad._id.toString());
    return {
      ...ad,
      ...(ad.creatorVideoId ? {
        currentCreditRateRupees: (ad.sourceVideoType === "short" ? rates.creatorSimplyAds : rates.creatorRegularAds).rateRupees,
        rewardEnabled: (ad.sourceVideoType === "short" ? rates.creatorSimplyAds : rates.creatorRegularAds).enabled
      } : {}),
      adEligibleViews: total?.views || 0,
      adEstimatedEarningsRupees: Math.round((total?.milliRupees || 0) / 10) / 100,
      ...(ad.creatorVideoId ? {
        completedViews: total?.views || 0, sourceAvailable: await creatorAdSourceAvailable(db, ad)
      } : { sourceAvailable: true })
    };
  }));
}

export async function softDeleteCreatorVideo(db, video, now = new Date().toISOString()) {
  await db.collection("videos").updateOne({ _id: video._id, ownerId: video.ownerId }, {
    $set: { published: false, deletedAt: video.deletedAt || now }
  });
  // Keep source documents and earning ledgers: wallet credit and ad history are permanent.
  const ads = await db.collection("ads").find({ creatorVideoId: video._id }).toArray();
  for (const ad of ads) await db.collection("ads").updateOne({ _id: ad._id }, {
    $set: { active: false, sourceDeletedAt: video.deletedAt || now, updatedAt: now }
  });
  await Promise.all(["savedShorts", "shortReports", "videoLikes", "videoComments"].map(name =>
    db.collection(name).deleteMany({ videoId: video._id })));
}

export async function initializeCreatorAds(db) {
  await db.collection("ads").createIndex({ creatorVideoId: 1 });
  await db.collection("adCompletedViews").createIndex({ adId: 1, viewerHash: 1 }, { unique: true });
  await db.collection("adCompletedViews").createIndex({ creatorId: 1, videoId: 1 });
  await db.collection("adWatchRateLimits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection("ads").createIndex({ creatorId: 1, creatorNotificationPending: 1 });
}

export async function deliverCreatorAdNotifications(db, creatorId) {
  const ads = await db.collection("ads").find({ creatorId, creatorNotificationPending: true }).toArray();
  for (const ad of ads) {
    await db.collection("notifications").updateOne({ _id: ad._id }, {
      $setOnInsert: {
        recipientId: creatorId, type: "creator_video_ad",
        adId: ad._id.toString(), videoId: ad.creatorVideoId,
        title: "Your video was selected for an ad",
        message: `"${ad.creatorVideoTitle || ad.title}" is now linked to the ad "${ad.title}". ${ad.active ? "The ad is active." : "The ad is currently paused."} The configured rate when selected is INR ${ad.creditRateRupees} per ${ad.creditRateViews} qualifying full ad watches, once per viewer per ad. Future completions use the current enabled reward settings shown in your wallet. Your original video keeps its normal earning rate.`,
        readAt: null, createdAt: ad.createdAt
      }
    }, { upsert: true });
    await db.collection("ads").updateOne({ _id: ad._id }, { $set: { creatorNotificationPending: false } });
  }
}

export function createAdminAdHandler({ getDb, normalizeAd, serializeAd, loadMetadata, cdnOrigin = shortsCdnOrigin, now = () => Date.now() }) {
  return async (req, res) => {
    if (String(req.body?.mediaUrl || "").startsWith("/business-ad-media/")) {
      return res.status(400).json({ error: "Business ad media can only be added through approval." });
    }
    const prepared = await prepareCreatorAd(getDb(), req.body || {}, { loadMetadata, cdnOrigin });
    if (prepared.error) return res.status(400).json({ error: prepared.error });
    const { fields, error } = normalizeAd(prepared.body);
    if (error) return res.status(400).json({ error });
    const at = new Date(now()).toISOString();
    const ad = {
      ...fields, ...prepared.fields, impressions: 0, clicks: 0, createdAt: at, updatedAt: at,
      ...(prepared.fields.creatorId ? { creatorNotificationPending: true } : {})
    };
    await getDb().collection("ads").insertOne(ad);
    res.status(201).json(serializeAd(ad));
  };
}

export function registerCreatorAdRoutes(app, {
  getDb, asyncRoute, requireAdmin, requireCreator, sessionFor, withCreatorProfiles,
  availableInCity = async () => true, cdnOrigin = shortsCdnOrigin, now = () => Date.now(),
  deleteMedia = async () => {}
}) {
  const db = () => getDb();
  const secret = () => {
    const key = process.env.VIEW_IP_HASH_SECRET || process.env.ADMIN_PASSWORD;
    if (!key) throw new Error("Configure VIEW_IP_HASH_SECRET for creator ad watches.");
    return key;
  };
  const hash = req => {
    if (!req.ip) throw new Error("Cannot determine viewer IP.");
    return createHmac("sha256", secret()).update(`ad-viewer:${req.ip}`).digest("hex");
  };
  const sign = payload => createHmac("sha256", secret()).update(`ad-full-watch:${payload}`).digest("hex");
  async function rate(req, action, maximum) {
    const filter = { _id: `${action}:${hash(req)}:${Math.floor(now() / 60000)}` };
    let result;
    try {
      result = await db().collection("adWatchRateLimits").findOneAndUpdate(
        filter, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(now() + 120000) } },
        { upsert: true, returnDocument: "after" }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
      result = await db().collection("adWatchRateLimits").findOneAndUpdate(filter, { $inc: { count: 1 } }, { returnDocument: "after" });
    }
    return result.count <= maximum;
  }
  async function findAd(req, res, starting = false) {
    if (!ObjectId.isValid(req.params.id)) { res.status(404).json({ error: "Ad not found." }); return null; }
    const ad = await db().collection("ads").findOne({ _id: new ObjectId(req.params.id) });
    if (!ad?.creatorVideoId || ad.type !== "video" || ad.active === false ||
      !await creatorAdSourceAvailable(db(), ad, req, availableInCity) || !await availableInCity(ad, req) ||
      (starting && ad.targetViews > 0 && (ad.impressions || 0) >= ad.targetViews)) {
      res.status(404).json({ error: "Creator ad is unavailable." }); return null;
    }
    return ad;
  }
  function readTicket(req, res, completed = false) {
    const ticket = req.body?.ticket;
    if (typeof ticket !== "string" || ticket.length > 2048) {
      res.status(400).json({ error: "A valid full-watch ticket is required." }); return null;
    }
    const [payload, signature, extra] = ticket.split(".");
    if (extra || !/^[a-f\d]{64}$/.test(signature || "") || !timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload || "")))) {
      res.status(400).json({ error: "Invalid full-watch ticket." }); return null;
    }
    let claim;
    try { claim = JSON.parse(Buffer.from(payload, "base64url").toString()); }
    catch { res.status(400).json({ error: "Invalid full-watch ticket." }); return null; }
    const elapsed = now() - claim.at;
    if (claim.version !== 1 || claim.ad !== req.params.id || claim.viewer !== hash(req) ||
      claim.account !== (sessionFor(req)?.userId || null) || !Number.isSafeInteger(claim.at) ||
      !Number.isSafeInteger(claim.duration) || claim.duration <= 0 || !/^[a-f\d-]{36}$/.test(claim.nonce || "") ||
      elapsed < (completed ? claim.duration : 0) || elapsed > claim.duration + 300000) {
      res.status(400).json({ error: "Full-watch ticket is premature, expired or belongs to another viewer." }); return null;
    }
    return claim;
  }
  async function claimImpression(req, res) {
    if (!await rate(req, "impression", 60)) return res.status(429).json({ error: "Too many ad delivery requests. Try again in a minute." });
    const claim = readTicket(req, res);
    if (!claim) return;
    const ad = await findAd(req, res);
    if (!ad) return;
    if (claim.video !== ad.creatorVideoId || claim.duration !== Math.ceil(ad.durationSeconds * 1000)) {
      return res.status(400).json({ error: "The ad source changed." });
    }
    // Expired tickets cannot be replayed, so their atomic delivery markers can be pruned.
    const expired = Object.entries(ad.watchDeliveries || {}).filter(([, delivery]) => delivery.expiresAt < now());
    if (expired.length) await db().collection("ads").updateOne({ _id: ad._id }, {
      $unset: Object.fromEntries(expired.map(([nonce]) => [`watchDeliveries.${nonce}`, ""]))
    });
    const path = `watchDeliveries.${claim.nonce}`;
    const claimed = await db().collection("ads").findOneAndUpdate({
      _id: ad._id, active: { $ne: false }, [path]: { $exists: false }, $expr: adCapacityExpression
    }, {
      $inc: { impressions: 1 },
      $set: { [path]: { at: now(), expiresAt: claim.at + claim.duration + 300000 } }
    }, { returnDocument: "after" });
    const current = claimed || await db().collection("ads").findOne({ _id: ad._id });
    const accepted = Boolean(current?.watchDeliveries?.[claim.nonce]);
    if (accepted && current.targetViews > 0 && current.impressions >= current.targetViews && !current.completedAt) {
      await db().collection("ads").updateOne({ _id: ad._id }, { $set: { completedAt: new Date(now()).toISOString() } });
    }
    res.json({ accepted, duplicate: accepted && !claimed });
  }
  app.get(["/api/admin/creator-ad-videos", "/api/admin/ads/creator-videos"], requireAdmin, asyncRoute(async (_req, res) => {
    const rates = await rewardSettings(db());
    const videos = await db().collection("videos").find(creatorAdVideoQuery).sort({ createdAt: -1 }).limit(500).toArray();
    const profiles = await withCreatorProfiles(videos);
    res.json(profiles.map((video, index) => ({
      ...video, creatorId: videos[index].ownerId, videoType: video.videoType === "short" ? "short" : "regular",
      creatorUsername: video.creatorProfile?.username || "",
      streamUrl: creatorAdMedia(videos[index], cdnOrigin()),
      creditRateRupees: (video.videoType === "short" ? rates.creatorSimplyAds : rates.creatorRegularAds).rateRupees,
      rewardEnabled: (video.videoType === "short" ? rates.creatorSimplyAds : rates.creatorRegularAds).enabled,
      creditRateViews: 1000
    })));
  }));
  app.delete("/api/creator/videos/:id", requireCreator, asyncRoute(async (req, res) => {
    const video = await db().collection("videos").findOne({ _id: req.params.id, ownerId: req.creatorId.toString() });
    if (!video || video.ownerBusinessId) return res.status(404).json({ error: "Video not found." });
    await softDeleteCreatorVideo(db(), video, new Date(now()).toISOString());
    // Persist removal first. A CDN failure cannot republish the source or erase earnings.
    if (!video.mediaDeletedAt) {
      await deleteMedia(video);
      await db().collection("videos").updateOne({ _id: video._id }, { $set: { mediaDeletedAt: new Date(now()).toISOString() } });
    }
    res.status(204).end();
  }));
  app.post("/api/ads/:id/view-start", asyncRoute(async (req, res) => {
    if (!await rate(req, "start", 30)) return res.status(429).json({ error: "Too many ad watch requests. Try again in a minute." });
    const ad = await findAd(req, res, true);
    if (!ad) return;
    const eligible = sessionFor(req)?.userId !== ad.creatorId;
    const minimumWatchMs = Math.ceil(ad.durationSeconds * 1000);
    if (!Number.isSafeInteger(minimumWatchMs) || minimumWatchMs <= 0) return res.status(409).json({ error: "Ad duration is unavailable." });
    const payload = Buffer.from(JSON.stringify({
      version: 1, ad: ad._id.toString(), video: ad.creatorVideoId, viewer: hash(req),
      account: sessionFor(req)?.userId || null, at: now(), duration: minimumWatchMs, nonce: randomUUID()
    })).toString("base64url");
    res.json({ ticket: `${payload}.${sign(payload)}`, eligible, minimumWatchMs, expiresInMs: minimumWatchMs + 300000 });
  }));
  app.post(["/api/ads/:id/view", "/api/ads/:id/view-complete"], asyncRoute(async (req, res) => {
    if (!await rate(req, "complete", 60)) return res.status(429).json({ error: "Too many ad completion requests. Try again in a minute." });
    const claim = readTicket(req, res, true);
    if (!claim) return;
    const ad = await findAd(req, res);
    if (!ad) return;
    if (claim.video !== ad.creatorVideoId || claim.duration !== Math.ceil(ad.durationSeconds * 1000)) return res.status(400).json({ error: "The ad source changed." });
    const delivery = ad.watchDeliveries?.[claim.nonce];
    if (!delivery) return res.status(409).json({ error: "Claim this ticket's ad impression before completing its watch." });
    if (now() - delivery.at < claim.duration) return res.status(400).json({ error: "The full ad duration must elapse after delivery." });
    if (sessionFor(req)?.userId === ad.creatorId) return res.json({ counted: false, earningRupees: 0 });
    const rates = await rewardSettings(db());
    const earningMilliRupees = eventMilliRupees(ad.sourceVideoType === "short" ? rates.creatorSimplyAds : rates.creatorRegularAds);
    let counted = false;
    try {
      await db().collection("adCompletedViews").insertOne({
        _id: `${ad._id}:${claim.viewer}`, adId: ad._id.toString(), videoId: ad.creatorVideoId,
        creatorId: ad.creatorId, sourceVideoType: ad.sourceVideoType, viewerHash: claim.viewer,
        earningMilliRupees, createdAt: new Date(now()).toISOString()
      });
      counted = true;
    } catch (error) { if (error.code !== 11000) throw error; }
    // Ledger-derived analytics repair themselves if a previous counter write failed.
    const completedViews = await db().collection("adCompletedViews").countDocuments({ adId: ad._id.toString() });
    await db().collection("ads").updateOne({ _id: ad._id }, { $max: { completedViews } });
    res.json({ counted, completedViews, earningRupees: counted ? earningMilliRupees / 1000 : 0 });
  }));
  return { claimImpression };
}
