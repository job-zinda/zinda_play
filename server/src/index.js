import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { GridFSBucket, MongoClient, ObjectId } from "mongodb";
import { open as openGeoReader } from "maxmind";
import { initializeMemberships, membershipSettings, registerMembershipRoutes } from "./memberships.js";
import { adCapacityExpression, adReport, claimAdImpression, normalizeAdFrequency } from "./ad-delivery.js";
import { accountRole, approvedCreatorQuery, registerAccountModeRoutes } from "./account-modes.js";
import { initializeBusinessAds, notifyBusinessAdPublication, registerBusinessAdRoutes } from "./business-ads.js";
import { deleteShortRecords, initializeShorts, registerShortRoutes, shortProcessingFields, shortUpload, shortsCdnOrigin } from "./shorts.js";
import { creatorWallet } from "./creator-wallet.js";
import { createAdminAdHandler, creatorAdAdminReports, creatorAdEditError, creatorAdSourceAvailable, deliverCreatorAdNotifications, initializeCreatorAds, registerCreatorAdRoutes, softDeleteCreatorVideo } from "./creator-ads.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });
const app = express();
const port = process.env.PORT || 4000;
const scrypt = promisify(scryptCallback);
const trustedProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS || "0", 10);
if (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops < 0) {
  throw new Error("TRUST_PROXY_HOPS must be a non-negative integer.");
}
app.set("trust proxy", trustedProxyHops);
const allowedOrigins = [
  "https://zindaplay.vercel.app",
  "http://localhost:5173",
  "http://localhost:5174",
  "https://zindaplay.com",
  ...(process.env.CLIENT_ORIGIN || "").split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean),
];

app.use(
  cors({
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)),
  })
);

app.use(express.json());
const maxVideoUploadBytes = 2 * 1024 * 1024 * 1024;

const defaultCategories = [
  { id: "cat-learning", name: "Learning", slug: "learning" },
  { id: "cat-entertainment", name: "Entertainment", slug: "entertainment" },
  { id: "cat-films", name: "Short Films", slug: "short-films" }
];
let database;
let categories = [];
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const sessionKey = (token) => createHash("sha256").update(String(token)).digest("hex");
const sessionCache = new Map();
// In-memory cache backed by MongoDB so logins survive server restarts.
const sessions = {
  get: (token) => sessionCache.get(token),
  set(token, value) {
    sessionCache.set(token, value);
    database?.collection("sessions").updateOne(
      { _id: sessionKey(token) },
      { $set: { ...value, token, expiresAt: new Date(Date.now() + SESSION_TTL_MS) } },
      { upsert: true }
    ).catch((error) => console.error("Session save failed", error.message));
  },
  delete(token) {
    sessionCache.delete(token);
    database?.collection("sessions").deleteOne({ _id: sessionKey(token) }).catch(() => {});
  }
};
const videosCollection = () => database.collection("videos");
const categoriesCollection = () => database.collection("categories");
const usersCollection = () => database.collection("users");
const notificationsCollection = () => database.collection("notifications");
const invitationsCollection = () => database.collection("creatorInvitations");
const creatorRequestsCollection = () => database.collection("creatorRequests");
const adminChatsCollection = () => database.collection("adminChats");
const businessCampaignsCollection = () => database.collection("businessCampaigns");
const promoterRewardsCollection = () => database.collection("promoterRewards");
const promoterWithdrawalsCollection = () => database.collection("promoterWithdrawals");
const promoterWatchSessionsCollection = () => database.collection("promoterWatchSessions");
const promoterVideoWatchesCollection = () => database.collection("promoterVideoWatches");
const likesCollection = () => database.collection("videoLikes");
const commentsCollection = () => database.collection("videoComments");
const creatorFollowsCollection = () => database.collection("creatorFollows");
const uniqueViewsCollection = () => database.collection("uniqueVideoViews");
const bannerCollection = () => database.collection("siteContent");
const adsCollection = () => database.collection("ads");
const bannerImageBucket = () => new GridFSBucket(database, { bucketName: "bannerImages" });
const creatorProfilePhotoBucket = () => new GridFSBucket(database, { bucketName: "creatorProfilePhotos" });
const videoThumbnailBucket = () => new GridFSBucket(database, { bucketName: "videoThumbnails" });
const adMediaBucket = () => new GridFSBucket(database, { bucketName: "adMedia" });
const supportedAdVideoTypes = new Map([
  ["video/mp4", "mp4"],
  ["video/webm", "webm"]
]);
const maxAdVideoBytes = 150 * 1024 * 1024;
const maxIntroVideoBytes = 100 * 1024 * 1024;
let geoReaderPromise;
const supportedImageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);
const maxImageBytes = 8 * 1024 * 1024;
const defaultBanner = {
  _id: "homepage-banner",
  enabled: false,
  title: "",
  description: "",
  imageId: "",
  buttonLabel: "",
  buttonUrl: ""
};

const asyncRoute = handler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const matchesSecret = (provided, expected) => {
  const providedHash = createHash("sha256").update(provided).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
};

function requireAdmin(req, res, next) {
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  const session = token && sessions.get(token);
  if (!session || session.role !== "admin") return res.status(401).json({ error: "Admin authentication required" });
  req.session = session;
  next();
}
function requireMember(req, res, next) {
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  const session = token && sessions.get(token);
  if (!session || !session.userId || !["member", "creator", "promoter"].includes(session.role)) {
    return res.status(401).json({ error: "Member authentication required" });
  }
  req.session = session;
  next();
}
function requireShortsAccount(req, res, next) {
  const session = sessions.get(req.get("authorization")?.replace(/^Bearer\s+/i, ""));
  if (!session?.userId || !["member", "creator", "promoter", "business"].includes(session.role)) {
    return res.status(401).json({ error: "Sign in to interact with Simply." });
  }
  req.session = session;
  next();
}
const requireVideoAccount = asyncRoute(async (req, res, next) => {
  const video = await videosCollection().findOne({ _id: req.params.id });
  if (video?.videoType === "short") return requireShortsAccount(req, res, next);
  requireMember(req, res, next);
});
const requireBusiness = asyncRoute(async (req, res, next) => {
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  const session = token && sessions.get(token);
  if (!session?.userId || session.role !== "business") {
    return res.status(401).json({ error: "Business authentication required" });
  }
  const user = await usersCollection().findOne({ _id: new ObjectId(session.userId), accountType: "business" });
  if (!user) return res.status(401).json({ error: "Business account not found" });
  req.session = session;
  req.businessId = user._id;
  req.business = user;
  next();
});
const requirePromoter = asyncRoute(async (req, res, next) => {
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  const session = token && sessions.get(token);
  if (!session?.userId || session.role !== "promoter") {
    return res.status(401).json({ error: "Promoter authentication required." });
  }
  const user = await usersCollection().findOne({ _id: new ObjectId(session.userId), accountType: "promoter" });
  if (!user) return res.status(401).json({ error: "Promoter account not found." });
  req.session = session;
  req.promoter = user;
  req.promoterId = user._id.toString();
  next();
});
const requireCreator = asyncRoute(async (req, res, next) => {
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  const session = token && sessions.get(token);
  if (!session?.userId || !["member", "creator"].includes(session.role)) {
    return res.status(401).json({ error: "Member authentication required" });
  }
  const user = await usersCollection().findOne({ _id: new ObjectId(session.userId) });
  if (!user) return res.status(401).json({ error: "Member account not found" });
  if (user.accountType === "business" || (user.accountType === "promoter" && !user.creatorRequested)) {
    return res.status(403).json({ error: "Apply for creator access before opening Creator studio." });
  }
  if (user.approvalStatus !== "approved" && user.approvalStatus !== undefined) {
    return res.status(403).json({ error: user.approvalStatus === "rejected" ? "Your creator application was not approved." : "Your creator membership is awaiting admin approval." });
  }
  session.role = "creator";
  req.session = session;
  req.creatorId = user._id;
  next();
});
function createSession(username, role, userId = null) {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { username, role, userId });
  return token;
}
function publicUser(user, token) {
  if (user.accountType === "business") {
    return { token, username: user.username, role: "business" };
  }
  if (user.accountType === "promoter") {
    return { token, username: user.username, role: "promoter", promoterAccount: true, approvalStatus: user.creatorRequested ? user.approvalStatus : null };
  }
  const approvalStatus = user.approvalStatus || "approved";
  return {
    token,
    username: user.username,
    role: approvalStatus === "approved" ? "creator" : "member",
    approvalStatus
  };
}
async function getGeoReader() {
  const dbPath = process.env.MAXMIND_DB_PATH;
  if (!dbPath) throw new Error("MAXMIND_DB_PATH is not configured.");
  geoReaderPromise ||= openGeoReader(resolve(dirname(fileURLToPath(import.meta.url)), "..", dbPath));
  try {
    return await geoReaderPromise;
  } catch (error) {
    geoReaderPromise = undefined;
    throw error;
  }
}
async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: hash.toString("hex") };
}
async function passwordMatches(password, user) {
  const suppliedHash = await scrypt(password, user.passwordSalt, 64);
  const storedHash = Buffer.from(user.passwordHash, "hex");
  return storedHash.length === suppliedHash.length && timingSafeEqual(suppliedHash, storedHash);
}

const safeVideo = ({ _id, thumbnailImageId, ownerId: _ownerId, ownerBusinessId: _ownerBusinessId, businessCampaignId: _businessCampaignId, ...video }) => ({
  ...video,
  id: _id,
  ...(_ownerBusinessId ? { ownerType: "business" } : _ownerId ? { ownerType: "creator" } : {}),
  thumbnailUrl: thumbnailImageId ? `/videos/thumbnail/${thumbnailImageId}` : video.thumbnailUrl || "",
  category: categories.find(category => category.id === video.categoryId) || null
});
function normalizeVideoCollection(source) {
  const collectionName = typeof source.collectionName === "string" ? source.collectionName.trim() : "";
  const collectionType = typeof source.collectionType === "string" ? source.collectionType : "";
  if (collectionName.length > 120) return { error: "Collection name must be 120 characters or fewer." };
  if (!collectionName) return { fields: { collectionName: "", collectionType: "", episodeNumber: null } };
  if (!["series", "playlist"].includes(collectionType)) {
    return { error: "Choose Web series or Playlist for the collection type." };
  }
  const episodeValue = source.episodeNumber;
  const episodeNumber = episodeValue === "" || episodeValue === undefined || episodeValue === null
    ? null
    : Number(episodeValue);
  if (episodeNumber !== null && (!Number.isInteger(episodeNumber) || episodeNumber < 1 || episodeNumber > 99999)) {
    return { error: "Episode or position number must be a whole number from 1 to 99,999." };
  }
  return { fields: { collectionName, collectionType, episodeNumber } };
}
function normalizeVideoTargetCity(source) {
  if (!Object.hasOwn(source, "targetCity")) return { fields: {} };
  if (typeof source.targetCity !== "string") return { error: "Target city must be text." };
  const targetCity = source.targetCity.trim().replace(/\s+/g, " ");
  if (targetCity.length > 100) return { error: "Target city must be 100 characters or fewer." };
  return { fields: { targetCity } };
}
function normalizeCityName(city) {
  return typeof city === "string" ? city.trim().replace(/\s+/g, " ").toLocaleLowerCase("en") : "";
}
async function withCreatorProfiles(videos) {
  const creatorIds = [...new Set(videos.map(video => video.ownerId).filter(id => id && ObjectId.isValid(id)))];
  const creators = creatorIds.length
    ? await usersCollection().find(
      { _id: { $in: creatorIds.map(id => new ObjectId(id)) } },
      { projection: { username: 1, displayName: 1, bio: 1, profilePhotoImageId: 1, introVideoId: 1 } }
    ).toArray()
    : [];
  const profilesById = new Map(creators.map(creator => [creator._id.toString(), {
    id: creator._id.toString(),
    username: creator.username,
    displayName: creator.displayName || creator.username,
    bio: creator.bio || "",
    profilePhotoUrl: creator.profilePhotoImageId ? `/creators/${creator._id}/profile-photo` : "",
    introVideoUrl: creator.introVideoId ? `/creators/${creator._id}/intro-video` : ""
  }]));
  return videos.map(video => ({
    ...safeVideo(video),
    creatorProfile: video.ownerId && profilesById.has(video.ownerId)
      ? profilesById.get(video.ownerId)
      : null
  }));
}
function publicBannerSettings(banner) {
  const { _id, imageId, imageUrl: legacyImageUrl = "", ...settings } = banner;
  return {
    ...settings,
    imageUrl: imageId ? `/banner/image/${imageId}` : legacyImageUrl
  };
}
const publicVideoQuery = {
  deletedAt: { $exists: false },
  published: true,
  approvalStatus: { $nin: ["pending", "rejected"] },
  $or: [{ bunnyVideoId: { $exists: false } }, { processingStatus: "ready" }],
  $and: [{ $or: [{ videoType: { $ne: "short" } }, { shortValidated: true }] }]
};
async function viewerLocation(req) {
  const dbPath = process.env.MAXMIND_DB_PATH;
  if (!dbPath) return null;
  if (!req.ip) throw new Error("Unable to determine the viewer IP address for location targeting.");
  const reader = await getGeoReader();
  const location = reader.get(req.ip);
  if (!location?.country?.iso_code) return null;
  return {
    countryCode: location.country.iso_code.toUpperCase(),
    regionCode: location.subdivisions?.[0]?.iso_code?.toUpperCase() || "",
    cityName: location.city?.names?.en || ""
  };
}
function videoMatchesTargetCity(video, location) {
  return !video.targetCity || Boolean(
    location?.cityName &&
    normalizeCityName(video.targetCity) === normalizeCityName(location.cityName)
  );
}
async function videosAvailableInViewerCity(videos, req) {
  if (!videos.some(video => video.targetCity)) return videos;
  const location = await viewerLocation(req);
  return videos.filter(video => videoMatchesTargetCity(video, location));
}
async function videoAvailableInViewerCity(video, req) {
  if (!video.targetCity) return true;
  return videoMatchesTargetCity(video, await viewerLocation(req));
}
function campaignTargetsLocation(campaign, location) {
  return Boolean(
    location &&
    campaign.countryCode === location.countryCode &&
    (!campaign.regionCode || campaign.regionCode === location.regionCode)
  );
}
async function grantPromoterMilestones(promoterId, eventType, eventCount) {
  const milestoneSize = eventType === "referral_view" ? 1000 : 100;
  const rewardRupees = eventType === "referral_view" ? 20 : 10;
  const completedMilestones = Math.floor(eventCount / milestoneSize);
  let awarded = 0;
  for (let milestone = 1; milestone <= completedMilestones; milestone += 1) {
    const sourceKey = `${promoterId}:${eventType}:${milestone}`;
    try {
      const result = await promoterRewardsCollection().updateOne(
        { sourceKey },
        { $setOnInsert: {
          sourceKey,
          promoterId,
          type: eventType,
          milestone,
          amountRupees: rewardRupees,
          createdAt: new Date().toISOString()
        } },
        { upsert: true }
      );
      if (result.upsertedCount) awarded += rewardRupees;
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
  return awarded;
}
async function campaignVideoIsAvailable(video, req) {
  if (!video.ownerBusinessId && !video.businessCampaignId) return true;
  if (!video.businessCampaignId) return false;
  const campaign = await businessCampaignsCollection().findOne({
    _id: video.businessCampaignId,
    status: "active",
    $expr: { $lt: ["$impressions", "$targetImpressions"] }
  });
  if (!campaign) return false;
  return campaignTargetsLocation(campaign, await viewerLocation(req));
}
function razorpayConfiguration() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("Paid promotion is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in server/.env.");
  return { keyId, keySecret };
}
function bunnyConfiguration() {
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
  const apiKey = process.env.BUNNY_STREAM_API_KEY;
  if (!libraryId || !/^\d+$/.test(libraryId) || !apiKey) {
    throw new Error("Bunny Stream is not configured. Set BUNNY_STREAM_LIBRARY_ID and BUNNY_STREAM_API_KEY in server/.env.");
  }
  return { libraryId, apiKey, baseUrl: `https://video.bunnycdn.com/library/${libraryId}` };
}
async function bunnyRequest(url, apiKey, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { AccessKey: apiKey, ...options.headers }
  });
  if (!response.ok) {
    const details = await response.text();
    throw Object.assign(new Error(`Bunny Stream request failed (${response.status})${details ? `: ${details.slice(0, 500)}` : ""}`), { statusCode: response.status });
  }
  return response;
}
function processingState(status) {
  const states = {
    0: "created",
    1: "uploaded",
    2: "processing",
    3: "transcoding",
    4: "ready",
    5: "error",
    6: "upload failed",
    7: "just-in-time encoding",
    8: "creating playlists"
  };
  return states[status] || "processing";
}
app.get("/api/health", (_req, res) => res.json({ status: "ok", app: "Zinda Play API" }));

const adPlacements = ["top", "middle", "bottom"];
const publicAd = ad => ({
  id: ad._id.toString(),
  title: ad.title,
  type: ad.type,
  placement: ad.placement || "",
  mediaUrl: ad.mediaUrl,
  targetUrl: ad.targetUrl || "",
  skippable: ad.type === "video" ? ad.skippable !== false : true,
  skipAfterSeconds: ad.skipAfterSeconds || 20,
  frequency: ad.frequency || 1,
  ...(ad.creatorVideoId ? {
    creatorVideoId: ad.creatorVideoId, creatorId: ad.creatorId, creatorVideoType: ad.creatorVideoType || ad.sourceVideoType, sourceVideoType: ad.sourceVideoType,
    streamUrl: ad.mediaUrl, durationSeconds: ad.durationSeconds,
    creditRateRupees: ad.creditRateRupees, creditRateViews: ad.creditRateViews
  } : {})
});
const adminAd = ad => ({
  ...publicAd(ad),
  active: ad.active !== false,
  impressions: ad.impressions || 0,
  clicks: ad.clicks || 0,
  completedViews: ad.completedViews || 0,
  sourceDeletedAt: ad.sourceDeletedAt || null,
  sourceAvailable: ad.sourceAvailable ?? !ad.sourceDeletedAt,
  adEligibleViews: ad.adEligibleViews || 0,
  adEstimatedEarningsRupees: ad.adEstimatedEarningsRupees || 0,
  targetViews: ad.targetViews || 0,
  targetCity: ad.targetCity || "",
  targetCategories: Array.isArray(ad.targetCategories) ? ad.targetCategories : [],
  createdAt: ad.createdAt,
  ...adReport(ad),
  ...(ad.businessSubmissionId && ad.active === false && !ad.publishedAt ? { deliveryStatus: "unpublished" } : {}),
  businessSubmissionId: ad.businessSubmissionId || null,
  businessName: ad.businessName || ""
});
const isHttpUrl = value => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};
const isUploadedAdMedia = value => /^\/ads\/media\/[0-9a-f]{24}$/.test(value);
function normalizeAd(body) {
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const type = body?.type === "video" ? "video" : "banner";
  const mediaUrl = typeof body?.mediaUrl === "string" ? body.mediaUrl.trim() : "";
  const targetUrl = typeof body?.targetUrl === "string" ? body.targetUrl.trim() : "";
  if (!title || title.length > 120) return { error: "Enter an ad name (up to 120 characters)." };
  if (!mediaUrl) return { error: type === "video" ? "Upload a video file for this ad." : "Upload an image for this ad." };
  if (!isUploadedAdMedia(mediaUrl)) {
    const businessMedia = /^\/business-ad-media\/[0-9a-f]{24}$/.test(mediaUrl);
    if (!businessMedia && !isHttpUrl(mediaUrl)) return { error: "Upload a file for this ad." };
    if (!businessMedia && type === "video" && !/\.(mp4|webm|ogv|ogg|m3u8)(?:$|[?#])/i.test(mediaUrl)) {
      return { error: "Video ads need a direct video file ending in .mp4 or .webm." };
    }
  }
  if (targetUrl && !isHttpUrl(targetUrl)) return { error: "The click-through URL must be a valid HTTP or HTTPS URL." };
  const fields = { title, type, mediaUrl, targetUrl, active: body?.active !== false };
  const frequency = normalizeAdFrequency(body?.frequency);
  if (frequency === null) return { error: "Ad frequency must be every 1, 5, or 10 videos." };
  fields.frequency = frequency;
  const targetViews = Number(body?.targetViews ?? 0);
  if (!Number.isInteger(targetViews) || targetViews < 0 || targetViews > 100000000) {
    return { error: "Target views must be a whole number (0 means unlimited)." };
  }
  const targetCity = typeof body?.targetCity === "string" ? body.targetCity.trim().replace(/\s+/g, " ") : "";
  if (targetCity.length > 100) return { error: "Target city must be 100 characters or fewer." };
  const targetCategories = Array.isArray(body?.targetCategories) ? [...new Set(body.targetCategories.map(String))] : [];
  if (targetCategories.some(id => !categories.some(category => category.id === id))) {
    return { error: "Choose valid interest categories." };
  }
  Object.assign(fields, { targetViews, targetCity, targetCategories });
  if (type === "banner") {
    if (!adPlacements.includes(body?.placement)) return { error: "Choose a banner position: top, middle or bottom." };
    fields.placement = body.placement;
    fields.skippable = true;
    fields.skipAfterSeconds = 20;
  } else {
    const skipAfterSeconds = Number(body?.skipAfterSeconds ?? 20);
    if (!Number.isInteger(skipAfterSeconds) || skipAfterSeconds < 1 || skipAfterSeconds > 120) {
      return { error: "Skip time must be a whole number of seconds between 1 and 120." };
    }
    fields.placement = "";
    fields.skippable = body?.skippable !== false;
    fields.skipAfterSeconds = skipAfterSeconds;
  }
  return { fields };
}
app.get("/api/ads", asyncRoute(async (req, res) => {
  const placement = String(req.query.placement || "");
  // Ads stop once they reach their target number of views (0 = unlimited).
  const query = {
    active: { $ne: false },
    $expr: adCapacityExpression
  };
  if (placement === "video") query.type = "video";
  else if (adPlacements.includes(placement)) Object.assign(query, { type: "banner", placement });
  else return res.status(400).json({ error: "Choose a valid ad placement." });
  let ads = await adsCollection().find(query).sort({ createdAt: -1 }).limit(100).toArray();
  if (ads.some(ad => ad.targetCity)) {
    const location = await viewerLocation(req).catch(() => null);
    ads = ads.filter(ad => !ad.targetCity || (location?.cityName && normalizeCityName(ad.targetCity) === normalizeCityName(location.cityName)));
  }
  // Interests are the categories of the videos this viewer watched recently.
  const interests = new Set(String(req.query.interests || "").split(",").map(value => value.trim()).filter(Boolean));
  ads = ads.filter(ad => !ad.targetCategories?.length || ad.targetCategories.some(id => interests.has(id)));
  const deliverable = [];
  for (const ad of ads) if (await creatorAdSourceAvailable(database, ad, req, videoAvailableInViewerCity)) deliverable.push(ad);
  res.json(deliverable.slice(0, 20).map(publicAd));
}));
app.post("/api/ads/:id/impression", asyncRoute(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Ad not found." });
  const candidate = await adsCollection().findOne({ _id: new ObjectId(req.params.id) });
  if (!candidate || !await creatorAdSourceAvailable(database, candidate, req, videoAvailableInViewerCity)) return res.json({ accepted: false });
  if (candidate.creatorVideoId) return creatorAdRoutes.claimImpression(req, res);
  const accepted = await claimAdImpression(adsCollection(), new ObjectId(req.params.id));
  if (accepted) {
    const ad = await adsCollection().findOne({ _id: new ObjectId(req.params.id) });
    if (ad?.businessSubmissionId && adReport(ad).deliveryStatus === "completed") {
      await notificationsCollection().updateOne(
        { type: "business_ad_completed", adId: ad._id.toString() },
        { $setOnInsert: {
          recipientId: ad.businessId, title: "Your ad target is complete",
          message: `"${ad.title}" reached its ${ad.targetViews} impression target and has stopped serving.`,
          readAt: null, createdAt: new Date().toISOString()
        } }, { upsert: true }
      );
    }
  }
  res.json({ accepted });
}));
app.post("/api/ads/:id/click", asyncRoute(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Ad not found." });
  const result = await adsCollection().updateOne({ _id: new ObjectId(req.params.id) }, { $inc: { clicks: 1 } });
  if (!result.matchedCount) return res.status(404).json({ error: "Ad not found." });
  res.status(204).end();
}));
app.put("/api/admin/ads/media", requireAdmin, asyncRoute(async (req, res) => {
  const contentType = String(req.get("Content-Type") || "").split(";")[0].toLowerCase();
  const isVideo = supportedAdVideoTypes.has(contentType);
  const extension = isVideo ? supportedAdVideoTypes.get(contentType) : supportedImageTypes.get(contentType);
  if (!extension) return res.status(415).json({ error: "Choose a JPEG, PNG, WebP or GIF image, or an MP4 or WebM video." });
  const limit = isVideo ? maxAdVideoBytes : maxImageBytes;
  const size = Number(req.get("Content-Length") || req.get("X-Upload-Size") || 0);
  if (!Number.isSafeInteger(size) || size <= 0) return res.status(411).json({ error: "The upload must include a valid file size." });
  if (size > limit) return res.status(413).json({ error: `Ad ${isVideo ? "videos are limited to 150 MB" : "images are limited to 8 MB"}.` });

  const bucket = adMediaBucket();
  const upload = bucket.openUploadStream(`ad-media.${extension}`, { metadata: { contentType } });
  let received = 0;
  req.on("data", chunk => {
    received += chunk.length;
    if (received > limit) req.destroy(Object.assign(new Error("The ad file is too large."), { statusCode: 413 }));
  });
  try {
    await pipeline(req, upload);
    if (received !== size) throw Object.assign(new Error("The uploaded file size did not match the selected file."), { statusCode: 400 });
  } catch (error) {
    await bucket.delete(upload.id).catch(() => {});
    if (!res.headersSent) return res.status(error.statusCode || 400).json({ error: error.message });
    return;
  }
  res.status(201).json({ mediaUrl: `/ads/media/${upload.id.toHexString()}`, type: isVideo ? "video" : "banner" });
}));
async function streamGridFile(req, res, bucket, filesName, id, notFound) {
  if (!ObjectId.isValid(id)) return res.status(404).json({ error: notFound });
  const fileId = new ObjectId(id);
  const file = await database.collection(filesName).findOne({ _id: fileId });
  if (!file) return res.status(404).json({ error: notFound });
  const headers = {
    "Content-Type": file.metadata?.contentType || "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": res.getHeader("Cache-Control") || "public, max-age=3600",
    "X-Content-Type-Options": "nosniff"
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.get("Range") || "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, file.length - Number(range[2]));
    const end = Math.min(range[1] && range[2] ? Number(range[2]) : file.length - 1, file.length - 1);
    if (start > end || start >= file.length) {
      return res.status(416).set("Content-Range", `bytes */${file.length}`).end();
    }
    res.status(206).set({ ...headers, "Content-Range": `bytes ${start}-${end}/${file.length}`, "Content-Length": end - start + 1 });
    return pipeline(bucket.openDownloadStream(fileId, { start, end: end + 1 }), res);
  }
  res.set({ ...headers, "Content-Length": file.length });
  await pipeline(bucket.openDownloadStream(fileId), res);
}
app.get("/api/ads/media/:id", asyncRoute((req, res) =>
  streamGridFile(req, res, adMediaBucket(), "adMedia.files", req.params.id, "Ad media not found")));
const creatorIntroBucket = () => new GridFSBucket(database, { bucketName: "creatorIntros" });
app.get("/api/creators/:id/intro-video", asyncRoute(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Intro video not found" });
  const creator = await usersCollection().findOne({ _id: new ObjectId(req.params.id) }, { projection: { introVideoId: 1 } });
  if (!creator?.introVideoId) return res.status(404).json({ error: "Intro video not found" });
  await streamGridFile(req, res, creatorIntroBucket(), "creatorIntros.files", creator.introVideoId, "Intro video not found");
}));
app.put("/api/creator/intro-video", requireCreator, asyncRoute(async (req, res) => {
  const contentType = String(req.get("Content-Type") || "").split(";")[0].toLowerCase();
  const extension = supportedAdVideoTypes.get(contentType);
  if (!extension) return res.status(415).json({ error: "Choose an MP4 or WebM video." });
  const size = Number(req.get("Content-Length") || req.get("X-Upload-Size") || 0);
  if (!Number.isSafeInteger(size) || size <= 0) return res.status(411).json({ error: "The upload must include a valid file size." });
  if (size > maxIntroVideoBytes) return res.status(413).json({ error: "Intro videos are limited to 100 MB." });
  const bucket = creatorIntroBucket();
  const upload = bucket.openUploadStream(`intro.${extension}`, { metadata: { contentType } });
  let received = 0;
  req.on("data", chunk => {
    received += chunk.length;
    if (received > maxIntroVideoBytes) req.destroy(Object.assign(new Error("Intro videos are limited to 100 MB."), { statusCode: 413 }));
  });
  try {
    await pipeline(req, upload);
    if (received !== size) throw Object.assign(new Error("The uploaded file size did not match the selected file."), { statusCode: 400 });
  } catch (error) {
    await bucket.delete(upload.id).catch(() => {});
    if (!res.headersSent) return res.status(error.statusCode || 400).json({ error: error.message });
    return;
  }
  const previous = await usersCollection().findOneAndUpdate(
    { _id: req.creatorId },
    { $set: { introVideoId: upload.id.toHexString() } },
    { returnDocument: "before", projection: { introVideoId: 1 } }
  );
  if (previous?.introVideoId && ObjectId.isValid(previous.introVideoId)) {
    await bucket.delete(new ObjectId(previous.introVideoId)).catch(() => {});
  }
  res.status(201).json({ introVideoUrl: `/creators/${req.creatorId}/intro-video` });
}));
app.delete("/api/creator/intro-video", requireCreator, asyncRoute(async (req, res) => {
  const previous = await usersCollection().findOneAndUpdate(
    { _id: req.creatorId },
    { $unset: { introVideoId: "" } },
    { returnDocument: "before", projection: { introVideoId: 1 } }
  );
  if (previous?.introVideoId && ObjectId.isValid(previous.introVideoId)) {
    await creatorIntroBucket().delete(new ObjectId(previous.introVideoId)).catch(() => {});
  }
  res.status(204).end();
}));
app.get("/api/admin/ads", requireAdmin, asyncRoute(async (_req, res) => {
  const ads = await adsCollection().find({}).sort({ createdAt: -1 }).toArray();
  res.json((await creatorAdAdminReports(database, ads)).map(adminAd));
}));
async function deleteCreatorMedia(video) {
  if (video.bunnyVideoId) {
    const config = bunnyConfiguration();
    try {
      await bunnyRequest(`${config.baseUrl}/videos/${encodeURIComponent(video.bunnyVideoId)}`, config.apiKey, { method: "DELETE" });
    } catch (error) {
      if (error.status !== 404 && error.statusCode !== 404) throw error;
    }
  }
  if (video.thumbnailImageId && ObjectId.isValid(video.thumbnailImageId)) {
    await videoThumbnailBucket().delete(new ObjectId(video.thumbnailImageId)).catch(() => {});
  }
}
const creatorAdRoutes = registerCreatorAdRoutes(app, {
  getDb: () => database, asyncRoute, requireAdmin, requireCreator, withCreatorProfiles,
  sessionFor: req => sessions.get(req.get("authorization")?.replace(/^Bearer\s+/i, "")),
  availableInCity: videoAvailableInViewerCity, deleteMedia: deleteCreatorMedia
});
app.get("/api/admin/campaigns", requireAdmin, asyncRoute(async (_req, res) => {
  const campaigns = await businessCampaignsCollection().find({}).sort({ createdAt: -1 }).limit(500).toArray();
  res.json(campaigns.map(campaign => ({
    id: campaign._id.toString(),
    businessName: campaign.businessName,
    videoId: campaign.videoId,
    amountRupees: campaign.amountRupees,
    countryCode: campaign.countryCode,
    regionCode: campaign.regionCode,
    status: campaign.status,
    targetImpressions: campaign.targetImpressions,
    impressions: campaign.impressions || 0,
    remainingImpressions: Math.max(0, campaign.targetImpressions - (campaign.impressions || 0)),
    completionPercent: Math.min(100, (campaign.impressions || 0) / campaign.targetImpressions * 100),
    createdAt: campaign.createdAt,
    completedAt: campaign.completedAt || null
  })));
}));
app.post("/api/admin/ads", requireAdmin, asyncRoute(createAdminAdHandler({
  getDb: () => database, normalizeAd, serializeAd: adminAd,
  loadMetadata: async video => {
    const config = bunnyConfiguration();
    const response = await bunnyRequest(`${config.baseUrl}/videos/${encodeURIComponent(video.bunnyVideoId)}`, config.apiKey);
    return response.json();
  }
})));
app.patch("/api/admin/ads/:id", requireAdmin, asyncRoute(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Ad not found" });
  const existing = await adsCollection().findOne({ _id: new ObjectId(req.params.id) });
  if (!existing) return res.status(404).json({ error: "Ad not found" });
  const sourceError = creatorAdEditError(existing, req.body);
  if (sourceError) return res.status(400).json({ error: sourceError });
  if (existing.creatorVideoId && req.body?.active === true && !await creatorAdSourceAvailable(database, existing)) {
    return res.status(409).json({ error: "The source must be published, approved and ready before restarting this ad." });
  }
  if (existing.creatorVideoId && Object.hasOwn(req.body || {}, "targetUrl")) {
    try {
      const url = new URL(req.body.targetUrl);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || req.body.targetUrl.length > 2048) throw new Error();
    } catch { return res.status(400).json({ error: "Enter a valid HTTP or HTTPS destination URL." }); }
  }
  if (existing.businessSubmissionId) {
    const protectedFields = ["title", "type", "mediaUrl", "targetUrl", "targetCity", "targetCategories", "targetViews"];
    if (protectedFields.some(key => req.body[key] !== undefined && JSON.stringify(req.body[key]) !== JSON.stringify(existing[key]))) {
      return res.status(400).json({ error: "Business creative, destination, targeting and paid impression target are locked. Change only publication, frequency or skip settings." });
    }
  } else if (String(req.body?.mediaUrl || "").startsWith("/business-ad-media/")) {
    return res.status(400).json({ error: "Business ad media can only be added through approval." });
  }
  const { fields, error } = normalizeAd({ ...existing, ...req.body });
  if (error) return res.status(400).json({ error });
  const reopened = !fields.targetViews || (existing.impressions || 0) < fields.targetViews;
  await adsCollection().updateOne({ _id: existing._id }, {
    $set: {
      ...fields, updatedAt: new Date().toISOString(),
      ...(existing.businessSubmissionId && fields.active && !existing.publishedAt ? { publishedAt: new Date().toISOString() } : {}),
      ...(!reopened && !existing.completedAt ? { completedAt: new Date().toISOString() } : {})
    },
    ...(reopened ? { $unset: { completedAt: "" } } : {})
  });
  const updatedAd = await adsCollection().findOne({ _id: existing._id });
  await notifyBusinessAdPublication(database, updatedAd, existing.active);
  res.json(adminAd(updatedAd));
}));
app.delete("/api/admin/ads/:id", requireAdmin, asyncRoute(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Ad not found" });
  const candidate = await adsCollection().findOne({ _id: new ObjectId(req.params.id) });
  if (candidate?.businessSubmissionId) return res.status(409).json({ error: "Paid business ads retain their analytics and history. Pause the ad instead of deleting it." });
  if (candidate?.creatorVideoId) return res.status(409).json({ error: "Creator ads retain earned credit and history. Pause the ad instead of deleting it." });
  const existing = await adsCollection().findOneAndDelete({ _id: new ObjectId(req.params.id) });
  if (existing && isUploadedAdMedia(existing.mediaUrl || "")) {
    await adMediaBucket().delete(new ObjectId(existing.mediaUrl.split("/").pop())).catch(() => {});
  }
  res.status(204).end();
}));
app.get("/api/banner", asyncRoute(async (_req, res) => {
  const banner = await bannerCollection().findOne({ _id: defaultBanner._id });
  if (!banner?.enabled) return res.json(null);
  res.json(publicBannerSettings(banner));
}));
app.get("/api/banner/image/:id", asyncRoute(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Banner image not found" });
  const bucket = bannerImageBucket();
  const fileId = new ObjectId(req.params.id);
  const file = await database.collection("bannerImages.files").findOne({ _id: fileId });
  if (!file) return res.status(404).json({ error: "Banner image not found" });
  res.set({
    "Content-Type": file.metadata?.contentType || "application/octet-stream",
    "Content-Length": file.length,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff"
  });
  await pipeline(bucket.openDownloadStream(fileId), res);
}));
app.get("/api/videos/thumbnail/:id", asyncRoute(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Video thumbnail not found" });
  const bucket = videoThumbnailBucket();
  const fileId = new ObjectId(req.params.id);
  const file = await database.collection("videoThumbnails.files").findOne({ _id: fileId });
  if (!file) return res.status(404).json({ error: "Video thumbnail not found" });
  const video = await videosCollection().findOne({ thumbnailImageId: fileId.toHexString() });
  if (video && !await videoAvailableInViewerCity(video, req)) {
    return res.status(404).json({ error: "Video thumbnail not found" });
  }
  res.set({
    "Content-Type": file.metadata?.contentType || "application/octet-stream",
    "Content-Length": file.length,
    "Cache-Control": video?.targetCity ? "private, no-store" : "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff"
  });
  await pipeline(bucket.openDownloadStream(fileId), res);
}));
app.get("/api/creators/:id/profile-photo", asyncRoute(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Creator profile photo not found." });
  const creator = await usersCollection().findOne(
    { _id: new ObjectId(req.params.id) },
    { projection: { profilePhotoImageId: 1, businessLogoImageId: 1 } }
  );
  const imageId = creator?.profilePhotoImageId || creator?.businessLogoImageId;
  if (!imageId || !ObjectId.isValid(imageId)) {
    return res.status(404).json({ error: "Creator profile photo not found." });
  }
  const fileId = new ObjectId(imageId);
  const file = await database.collection("creatorProfilePhotos.files").findOne({ _id: fileId });
  if (!file) return res.status(404).json({ error: "Creator profile photo not found." });
  res.set({
    "Content-Type": file.metadata?.contentType || "application/octet-stream",
    "Content-Length": file.length,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff"
  });
  await pipeline(creatorProfilePhotoBucket().openDownloadStream(fileId), res);
}));
app.get("/api/categories", (_req, res) => res.json(categories));
const shortEngagementLimit = registerShortRoutes(app, {
  getDb: () => database, asyncRoute, requireAccount: requireShortsAccount, requireAdmin,
  publicVideoQuery, availableInCity: videoAvailableInViewerCity, withCreatorProfiles,
  sessionFor: req => sessions.get(req.get("authorization")?.replace(/^Bearer\s+/i, ""))
});
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
// Link-preview crawlers do not run the SPA, so shared links point here to get Open Graph tags before redirecting to the app.
app.get("/api/share/video/:id", asyncRoute(async (req, res) => {
  const video = await videosCollection().findOne({ _id: req.params.id, ...publicVideoQuery });
  if (!video || !await videoAvailableInViewerCity(video, req) || !await campaignVideoIsAvailable(video, req)) {
    return res.status(404).type("text/plain").send("Video not found");
  }
  const clientOrigin = (process.env.CLIENT_ORIGIN || "").split(",").map(origin => origin.trim().replace(/\/+$/, "")).find(Boolean) || allowedOrigins[0];
  const target = `${clientOrigin}/?video=${encodeURIComponent(video._id)}`;
  const image = video.thumbnailImageId ? `${req.protocol}://${req.get("host")}/api/videos/thumbnail/${video.thumbnailImageId}` : "";
  const title = String(video.title || "Zinda Play").slice(0, 120);
  const description = String(video.description || "Watch this video on Zinda Play.").slice(0, 200);
  res.set("Cache-Control", "public, max-age=300").type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)} · Zinda Play</title>
<meta property="og:type" content="video.other"><meta property="og:site_name" content="Zinda Play"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(target)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}"><meta name="twitter:image" content="${escapeHtml(image)}">` : ""}<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}">
<meta http-equiv="refresh" content="0;url=${escapeHtml(target)}"></head><body><p><a href="${escapeHtml(target)}">Watch “${escapeHtml(title)}” on Zinda Play</a></p><script>location.replace(${JSON.stringify(target).replace(/</g, "\\u003c")});</script></body></html>`);
}));
app.get("/api/videos", asyncRoute(async (req, res) => {
  const q = String(req.query.search || "").toLowerCase();
  const category = String(req.query.category || "");
  const featured = req.query.featured === "true";
  const query = {
    ...publicVideoQuery,
    videoType: { $ne: "short" },
    businessCampaignId: { $exists: false },
    ownerBusinessId: { $exists: false }
  };
  if (category) query.categoryId = category;
  if (featured) query.featured = true;
  if (q) {
    const escapedQuery = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.$and = [...(query.$and || []), {
      $or: [
        { title: { $regex: escapedQuery, $options: "i" } },
        { description: { $regex: escapedQuery, $options: "i" } },
        { collectionName: { $regex: escapedQuery, $options: "i" } }
      ]
    }];
  }
  const result = await videosAvailableInViewerCity(
    await videosCollection().find(query).sort({ createdAt: -1 }).toArray(),
    req
  );
  let promotedVideos = [];
  if (process.env.MAXMIND_DB_PATH) {
    const location = await viewerLocation(req);
    if (location) {
      const campaigns = await businessCampaignsCollection().find({
        status: "active",
        $expr: { $lt: ["$impressions", "$targetImpressions"] },
        countryCode: location.countryCode,
        $or: [{ regionCode: "" }, { regionCode: location.regionCode }]
      }).sort({ createdAt: -1 }).limit(10).toArray();
      if (campaigns.length) {
        const campaignVideos = await videosAvailableInViewerCity(await videosCollection().find({
          _id: { $in: campaigns.map(campaign=>campaign.videoId) },
          ...publicVideoQuery
        }).toArray(), req);
        const campaignsByVideoId = new Map(campaigns.map(campaign=>[campaign.videoId.toString(), campaign]));
        promotedVideos = campaignVideos.map(video=>({
          ...safeVideo(video),
          isSponsored: true,
          sponsorName: campaignsByVideoId.get(video._id.toString())?.businessName || "Sponsored"
        }));
      }
    }
  }
  res.json([...promotedVideos, ...await withCreatorProfiles(result)]);
}));
app.get("/api/videos/:id", asyncRoute(async (req, res) => {
  const video = await videosCollection().findOne({ _id: req.params.id, ...publicVideoQuery });
  if (!video) return res.status(404).json({ error: "Video not found" });
  if (!await videoAvailableInViewerCity(video, req)) return res.status(404).json({ error: "Video not found" });
  if (!await campaignVideoIsAvailable(video, req)) return res.status(404).json({ error: "Video not found" });
  res.json((await withCreatorProfiles([video]))[0]);
}));
app.post("/api/videos/:id/watch-start", requireMember, asyncRoute(async (req, res) => {
  const video = await videosCollection().findOne({ _id: req.params.id, ...publicVideoQuery });
  if (video?.videoType === "short") return res.status(400).json({ error: "Simply videos do not qualify for regular-video watch rewards." });
  if (!video || !await videoAvailableInViewerCity(video, req) || !await campaignVideoIsAvailable(video, req)) {
    return res.status(404).json({ error: "Video not found." });
  }
  const userId = req.session.userId;
  if (!userId || !ObjectId.isValid(userId)) return res.status(401).json({ error: "Sign in to qualify for promoter rewards." });
  const requiredWatchSeconds = Math.max(1, Math.min(30, Math.ceil(Number(video.durationSeconds) || 30)));
  const watchId = randomUUID();
  const startedAt = new Date();
  await promoterWatchSessionsCollection().insertOne({
    _id: watchId,
    videoId: video._id,
    viewerId: userId,
    requiredWatchSeconds,
    startedAt,
    expiresAt: new Date(startedAt.getTime() + 30 * 60 * 1000)
  });
  res.status(201).json({ watchId, requiredWatchSeconds });
}));
app.post("/api/videos/:id/watch-complete", requireMember, asyncRoute(async (req, res) => {
  const watchId = typeof req.body?.watchId === "string" ? req.body.watchId : "";
  if (!watchId) return res.status(400).json({ error: "Watch session is required." });
  const watchSession = await promoterWatchSessionsCollection().findOne({
    _id: watchId,
    videoId: req.params.id,
    viewerId: req.session.userId
  });
  if (!watchSession) return res.status(404).json({ error: "Watch session not found or expired." });
  if (watchSession.completedAt) return res.json({ counted: false, alreadyCounted: true, rewardRupees: 0 });
  const now = Date.now();
  const startedAt = new Date(watchSession.startedAt).getTime();
  const activeSeconds = Number(req.body?.activeSeconds);
  const elapsedSeconds = Math.floor((now - startedAt) / 1000);
  if (!Number.isInteger(activeSeconds) || activeSeconds < watchSession.requiredWatchSeconds || activeSeconds > elapsedSeconds + 1) {
    return res.status(400).json({ error: "Keep the video page visible until enough qualifying time has elapsed." });
  }
  if (now - startedAt < watchSession.requiredWatchSeconds * 1000) {
    return res.status(425).json({ error: "Keep the video page visible until enough qualifying time has elapsed." });
  }
  if (now > new Date(watchSession.expiresAt).getTime()) {
    await promoterWatchSessionsCollection().deleteOne({ _id: watchId, viewerId: req.session.userId });
    return res.status(410).json({ error: "This watch session expired. Reopen the video to start again." });
  }
  const completedAt = new Date(now);
  const completion = await promoterWatchSessionsCollection().updateOne(
    { _id: watchId, viewerId: req.session.userId, completedAt: { $exists: false } },
    { $set: { completedAt } }
  );
  if (!completion.matchedCount) return res.json({ counted: false, alreadyCounted: true, rewardRupees: 0 });

  const video = await videosCollection().findOne({ _id: req.params.id, ...publicVideoQuery });
  if (!video || !await videoAvailableInViewerCity(video, req) || !await campaignVideoIsAvailable(video, req)) {
    return res.status(404).json({ error: "Video is no longer available." });
  }
  const viewer = await usersCollection().findOne(
    { _id: new ObjectId(req.session.userId) },
    { projection: { accountType: 1, referrerPromoterId: 1 } }
  );
  if (!viewer) return res.status(401).json({ error: "Viewer account not found." });
  const referredByPromoterId = ObjectId.isValid(viewer.referrerPromoterId) ? viewer.referrerPromoterId : null;
  const watchingPromoterId = viewer.accountType === "promoter" ? req.session.userId : null;
  let newWatch = false;
  try {
    await promoterVideoWatchesCollection().insertOne({
      videoId: video._id,
      viewerId: req.session.userId,
      referredByPromoterId,
      watchingPromoterId,
      title: video.title,
      watchedAt: completedAt.toISOString()
    });
    newWatch = true;
  } catch (error) {
    if (error.code !== 11000) throw error;
  }

  let rewardRupees = 0;
  if (referredByPromoterId) {
    const referralViews = await promoterVideoWatchesCollection().countDocuments({ referredByPromoterId });
    rewardRupees += await grantPromoterMilestones(referredByPromoterId, "referral_view", referralViews);
  }
  if (watchingPromoterId) {
    const distinctVideosWatched = await promoterVideoWatchesCollection().countDocuments({ watchingPromoterId });
    rewardRupees += await grantPromoterMilestones(watchingPromoterId, "promoter_watch", distinctVideosWatched);
  }
  res.json({
    counted: newWatch,
    alreadyCounted: !newWatch,
    rewardRupees,
    requiredWatchSeconds: watchSession.requiredWatchSeconds
  });
}));
app.post("/api/videos/:id/view", asyncRoute(async (req, res) => {
  const video = await videosCollection().findOne({ _id: req.params.id, ...publicVideoQuery });
  if (!video) return res.status(404).json({ error: "Video not found" });
  if (video.videoType === "short") return res.status(400).json({ error: "Use the Simply view ticket flow." });
  if (!await videoAvailableInViewerCity(video, req)) return res.status(404).json({ error: "Video not found" });
  if (!await campaignVideoIsAvailable(video, req)) return res.status(404).json({ error: "Video not found" });
  const ipHashSecret = process.env.VIEW_IP_HASH_SECRET || process.env.ADMIN_PASSWORD;
  if (!ipHashSecret) return res.status(503).json({ error: "Configure VIEW_IP_HASH_SECRET to enable view tracking." });
  const viewerIp = req.ip;
  if (!viewerIp) return res.status(400).json({ error: "Unable to determine the viewer IP address." });
  const ipHash = createHmac("sha256", ipHashSecret).update(viewerIp).digest("hex");
  let earningViewCounted = false;
  try {
    await uniqueViewsCollection().insertOne({
      videoId: video._id,
      ipHash,
      createdAt: new Date().toISOString()
    });
    earningViewCounted = true;
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  const result = await videosCollection().updateOne(
    { _id: req.params.id, ...publicVideoQuery },
    { $inc: { views: 1 } },
  );
  if (!result.matchedCount) return res.status(404).json({ error: "Video not found" });
  const updatedVideo = await videosCollection().findOne({ _id: req.params.id });
  res.json({ views: updatedVideo.views, earningViewCounted });
}));
app.post("/api/videos/:id/impression", asyncRoute(async (req, res) => {
  const video = await videosCollection().findOne({
    _id: req.params.id,
    businessCampaignId: { $exists: true },
    ...publicVideoQuery
  });
  if (!video) return res.status(404).json({ error: "Sponsored video not found." });
  if (!await videoAvailableInViewerCity(video, req)) return res.status(404).json({ error: "Sponsored video not found." });
  const campaign = await businessCampaignsCollection().findOne({
    _id: video.businessCampaignId,
    status: "active",
    $expr: { $lt: ["$impressions", "$targetImpressions"] }
  });
  const location = campaign && await viewerLocation(req);
  if (!campaign || !campaignTargetsLocation(campaign, location)) return res.status(404).json({ error: "Sponsored video not found." });
  const result = await businessCampaignsCollection().updateOne(
    { _id: campaign._id, status: "active", $expr: { $lt: ["$impressions", "$targetImpressions"] } },
    { $inc: { impressions: 1 } }
  );
  if (!result.matchedCount) return res.status(409).json({ error: "This promotion has reached its impression limit." });
  await businessCampaignsCollection().updateOne(
    { _id: campaign._id, status: "active", $expr: { $gte: ["$impressions", "$targetImpressions"] } },
    { $set: { status: "completed", completedAt: new Date().toISOString() } }
  );
  res.status(204).end();
}));
app.get("/api/videos/:id/interactions", asyncRoute(async (req, res) => {
  const video = await videosCollection().findOne({ _id: req.params.id, ...publicVideoQuery });
  if (!video) return res.status(404).json({ error: "Video not found." });
  if (!await videoAvailableInViewerCity(video, req)) return res.status(404).json({ error: "Video not found." });
  if (!await campaignVideoIsAvailable(video, req)) return res.status(404).json({ error: "Video not found." });
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  const session = token && sessions.get(token);
  const [likeCount, comments, commentCount, liked] = await Promise.all([
    likesCollection().countDocuments({ videoId: video._id }),
    commentsCollection().find({ videoId: video._id }).sort({ createdAt: -1 }).limit(100).toArray(),
    commentsCollection().countDocuments({ videoId: video._id }),
    session?.userId ? likesCollection().findOne({ videoId: video._id, userId: session.userId }) : null
  ]);
  res.json({
    likeCount,
    commentCount,
    liked: Boolean(liked),
    comments: comments.map(({ _id, videoId: _videoId, userId: _userId, ...comment }) => ({ id: _id, ...comment }))
  });
}));
app.post("/api/videos/:id/like", requireVideoAccount, shortEngagementLimit, asyncRoute(async (req, res) => {
  const video = await videosCollection().findOne({ _id: req.params.id, ...publicVideoQuery });
  if (!video) return res.status(404).json({ error: "Video not found." });
  if (!await videoAvailableInViewerCity(video, req)) return res.status(404).json({ error: "Video not found." });
  if (!await campaignVideoIsAvailable(video, req)) return res.status(404).json({ error: "Video not found." });
  const userId = req.session.userId;
  const existing = await likesCollection().findOne({ videoId: video._id, userId });
  let liked;
  let createdLike = false;
  if (existing) {
    await likesCollection().deleteOne({ _id: existing._id });
    liked = false;
  } else {
    try {
      await likesCollection().insertOne({ videoId: video._id, userId, createdAt: new Date().toISOString() });
      liked = true;
      createdLike = true;
    } catch (error) {
      if (error.code !== 11000) throw error;
      liked = true;
    }
    if (createdLike && video.ownerId && video.ownerId !== userId) {
      await notificationsCollection().insertOne({
        recipientId: video.ownerId,
        type: "video_like",
        videoId: video._id,
        title: "Your video got a like",
        message: `${req.session.username} liked "${video.title}".`,
        readAt: null,
        createdAt: new Date().toISOString()
      });
    }
  }
  res.json({ liked, likeCount: await likesCollection().countDocuments({ videoId: video._id }) });
}));
app.post("/api/videos/:id/comments", requireVideoAccount, shortEngagementLimit, asyncRoute(async (req, res) => {
  const video = await videosCollection().findOne({ _id: req.params.id, ...publicVideoQuery });
  if (!video) return res.status(404).json({ error: "Video not found." });
  if (!await videoAvailableInViewerCity(video, req)) return res.status(404).json({ error: "Video not found." });
  if (!await campaignVideoIsAvailable(video, req)) return res.status(404).json({ error: "Video not found." });
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text || text.length > 1000) return res.status(400).json({ error: "Comments must be between 1 and 1000 characters." });
  const comment = {
    videoId: video._id,
    userId: req.session.userId,
    username: req.session.username,
    text,
    createdAt: new Date().toISOString()
  };
  const result = await commentsCollection().insertOne(comment);
  if (video.ownerId && video.ownerId !== req.session.userId) {
    await notificationsCollection().insertOne({
      recipientId: video.ownerId,
      type: "video_comment",
      videoId: video._id,
      title: "New comment on your video",
      message: `${req.session.username} commented on "${video.title}".`,
      readAt: null,
      createdAt: comment.createdAt
    });
  }
  res.status(201).json({ id: result.insertedId, username: comment.username, text: comment.text, createdAt: comment.createdAt });
}));
app.post("/api/auth/register", asyncRoute(async (req, res) => {
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password = req.body?.password;
  const requestedAccountType = req.body?.accountType;
  const accountType = ["business", "promoter"].includes(requestedAccountType) ? requestedAccountType : "member";
  const referrerPromoterId = typeof req.body?.referrerPromoterId === "string" ? req.body.referrerPromoterId : "";
  const businessName = typeof req.body?.businessName === "string" ? req.body.businessName.trim() : "";
  const businessAbout = typeof req.body?.businessAbout === "string" ? req.body.businessAbout.trim() : "";
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: "Username must be 3–32 characters and use only letters, numbers, dots, underscores, or hyphens." });
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: "Password must be between 8 and 128 characters." });
  }
  if (accountType === "business" && (!businessName || businessName.length > 100 || businessAbout.length > 1000)) {
    return res.status(400).json({ error: "Business name is required (up to 100 characters); business description must be 1,000 characters or fewer." });
  }
  let referrerCreatorId = "";
  if (referrerPromoterId) {
    if (accountType !== "member" || !ObjectId.isValid(referrerPromoterId)) {
      return res.status(400).json({ error: "Referral links can only be used when creating a viewer account." });
    }
    const referrer = await usersCollection().findOne({ _id: new ObjectId(referrerPromoterId) }, { projection: { accountType: 1, approvalStatus: 1 } });
    const isPromoter = referrer?.accountType === "promoter";
    const isCreator = referrer && !["promoter", "business"].includes(referrer.accountType) && (referrer.approvalStatus === "approved" || referrer.approvalStatus === undefined);
    if (!isPromoter && !isCreator) return res.status(400).json({ error: "This referral link is invalid." });
    // Creator referrals are tracked separately so they never trigger promoter rewards.
    if (isCreator) referrerCreatorId = referrerPromoterId;
  }
  if (process.env.ADMIN_USERNAME && username.toLowerCase() === process.env.ADMIN_USERNAME.trim().toLowerCase()) {
    return res.status(409).json({ error: "That username is reserved." });
  }
  const { salt, hash } = await hashPassword(password);
  const user = {
    username,
    usernameKey: username.toLowerCase(),
    passwordSalt: salt,
    passwordHash: hash,
    accountType,
    ...(accountType === "business"
      ? { businessName, businessAbout }
      : accountType === "promoter"
        ? {}
        : { approvalStatus: "pending", ...(referrerPromoterId && !referrerCreatorId ? { referrerPromoterId } : {}), ...(referrerCreatorId ? { referrerCreatorId } : {}) }),
    createdAt: new Date()
  };
  try {
    await usersCollection().insertOne(user);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "That username is already taken." });
    throw error;
  }
  if (["business", "promoter"].includes(accountType)) {
    const token = createSession(user.username, accountType, user._id.toString());
    return res.status(201).json(publicUser(user, token));
  }
  const token = createSession(user.username, "member", user._id.toString());
  await notificationsCollection().insertOne({
    recipientId: "admin",
    type: "creator_application",
    userId: user._id.toString(),
    username: user.username,
    title: "Creator membership requested",
    message: `${user.username} joined and is waiting for creator approval.`,
    readAt: null,
    createdAt: new Date().toISOString()
  });
  res.status(201).json(publicUser(user, token));
}));
app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Enter a username and password." });
  }
  if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD &&
      matchesSecret(username, process.env.ADMIN_USERNAME) &&
      matchesSecret(password, process.env.ADMIN_PASSWORD)) {
    return res.json({ token: createSession(username, "admin"), username, role: "admin" });
  }
  const user = await usersCollection().findOne({ usernameKey: username.trim().toLowerCase() });
  if (!user || !await passwordMatches(password, user)) {
    return res.status(401).json({ error: "Incorrect username or password" });
  }
  if (user.accountType === "business") {
    return res.json(publicUser(user, createSession(user.username, "business", user._id.toString())));
  }
  if (user.accountType === "promoter") {
    return res.json(publicUser(user, createSession(user.username, "promoter", user._id.toString())));
  }
  const role = user.approvalStatus === "approved" || user.approvalStatus === undefined ? "creator" : "member";
  const token = createSession(user.username, role, user._id.toString());
  res.json(publicUser(user, token));
}));
registerAccountModeRoutes(app, {
  users: usersCollection, notifications: notificationsCollection, requireMember, asyncRoute, publicUser,
  userId: req => new ObjectId(req.session.userId),
  saveSession: req => sessions.set(req.get("authorization").replace(/^Bearer\s+/i, ""), req.session)
});
app.get("/api/account", requireMember, asyncRoute(async (req, res) => {
  const user = await usersCollection().findOne({ _id: new ObjectId(req.session.userId) });
  if (!user) return res.status(401).json({ error: "Member account not found" });
  req.session.role = accountRole(user, req.session.role);
  res.json({
    username: user.username,
    displayName: user.displayName || user.username,
    bio: user.bio || "",
    profilePhotoUrl: user.profilePhotoImageId ? `/creators/${user._id}/profile-photo` : "",
    introVideoUrl: user.introVideoId ? `/creators/${user._id}/intro-video` : "",
    role: req.session.role,
    promoterAccount: user.accountType === "promoter",
    approvalStatus: user.approvalStatus || "approved"
  });
}));
app.patch("/api/account", requireMember, asyncRoute(async (req, res) => {
  if (typeof req.body?.displayName !== "string" || (req.body.bio !== undefined && typeof req.body.bio !== "string")) {
    return res.status(400).json({ error: "Enter a valid display name and bio." });
  }
  const displayName = req.body.displayName.trim();
  const bio = (req.body.bio || "").trim();
  if (!displayName || displayName.length > 60) {
    return res.status(400).json({ error: "Display name must be between 1 and 60 characters." });
  }
  if (bio.length > 300) return res.status(400).json({ error: "Bio must be 300 characters or fewer." });
  const userId = new ObjectId(req.session.userId);
  const result = await usersCollection().updateOne(
    { _id: userId },
    { $set: { displayName, bio } }
  );
  if (!result.matchedCount) return res.status(404).json({ error: "Account not found." });
  const user = await usersCollection().findOne({ _id: userId }, { projection: { profilePhotoImageId: 1 } });
  res.json({
    username: req.session.username,
    displayName,
    bio,
    profilePhotoUrl: user?.profilePhotoImageId ? `/creators/${userId}/profile-photo` : ""
  });
}));
app.put("/api/account/profile-photo", requireMember, asyncRoute(async (req, res) => {
  await saveAccountImage(req, res, "profilePhotoImageId", "profile photo");
}));
async function saveAccountImage(req, res, imageField, imageLabel) {
  const contentType = String(req.get("Content-Type") || "").split(";")[0].toLowerCase();
  const extension = supportedImageTypes.get(contentType);
  if (!extension) return res.status(415).json({ error: `Choose a JPEG, PNG, WebP, or GIF ${imageLabel}.` });
  const size = Number(req.get("Content-Length") || req.get("X-Upload-Size") || 0);
  if (!Number.isSafeInteger(size) || size <= 0) return res.status(411).json({ error: `The ${imageLabel} upload must include a valid file size.` });
  if (size > maxImageBytes) return res.status(413).json({ error: `${imageLabel} files are limited to 8 MB.` });
  const userId = new ObjectId(req.session.userId);
  const user = await usersCollection().findOne({ _id: userId });
  if (!user) return res.status(404).json({ error: "Account not found." });

  const bucket = creatorProfilePhotoBucket();
  const upload = bucket.openUploadStream(`${imageLabel.replace(/\s+/g, "-")}.${extension}`, { metadata: { contentType } });
  let received = 0;
  req.on("data", chunk => {
    received += chunk.length;
    if (received > maxImageBytes) req.destroy(Object.assign(new Error(`${imageLabel} files are limited to 8 MB.`), { statusCode: 413 }));
  });
  try {
    await pipeline(req, upload);
    if (received !== size) throw Object.assign(new Error(`The uploaded ${imageLabel} size did not match the selected file.`), { statusCode: 400 });
  } catch (error) {
    await bucket.delete(upload.id).catch(() => {});
    if (!res.headersSent) return res.status(error.statusCode || 400).json({ error: error.message });
    return;
  }

  try {
    await usersCollection().updateOne({ _id: userId }, { $set: { [imageField]: upload.id.toHexString() } });
  } catch (error) {
    await bucket.delete(upload.id).catch(() => {});
    throw error;
  }
  if (user[imageField] && ObjectId.isValid(user[imageField])) {
    await bucket.delete(new ObjectId(user[imageField])).catch(error => {
      console.error(`Failed to remove the replaced ${imageLabel}:`, error.message);
    });
  }
  res.status(201).json({ profilePhotoUrl: `/creators/${userId}/profile-photo` });
}
app.put("/api/business/logo", requireBusiness, asyncRoute(async (req, res) => {
  await saveAccountImage(req, res, "businessLogoImageId", "business logo");
}));
app.get("/api/business/profile", requireBusiness, asyncRoute(async (req, res) => {
  const business = await usersCollection().findOne({ _id: req.businessId });
  res.json({
    username: business.username,
    businessName: business.businessName || business.username,
    businessAbout: business.businessAbout || "",
    logoUrl: business.businessLogoImageId ? `/creators/${business._id}/profile-photo` : ""
  });
}));
app.patch("/api/business/profile", requireBusiness, asyncRoute(async (req, res) => {
  const businessName = typeof req.body?.businessName === "string" ? req.body.businessName.trim() : "";
  const businessAbout = typeof req.body?.businessAbout === "string" ? req.body.businessAbout.trim() : "";
  if (!businessName || businessName.length > 100 || businessAbout.length > 1000) {
    return res.status(400).json({ error: "Business name is required (up to 100 characters); description must be 1,000 characters or fewer." });
  }
  await usersCollection().updateOne(
    { _id: req.businessId },
    { $set: { businessName, businessAbout } }
  );
  res.json({
    username: req.session.username,
    businessName,
    businessAbout,
    logoUrl: req.business.businessLogoImageId ? `/creators/${req.businessId}/profile-photo` : ""
  });
}));
app.get("/api/business/creators", requireBusiness, asyncRoute(async (_req, res) => {
  const creators = await usersCollection().find({
    ...approvedCreatorQuery
  }, {
    projection: { username: 1, displayName: 1, bio: 1, profilePhotoImageId: 1 }
  }).sort({ username: 1 }).toArray();
  res.json(creators.map(creator => ({
    id: creator._id.toString(),
    username: creator.username,
    displayName: creator.displayName || creator.username,
    bio: creator.bio || "",
    profilePhotoUrl: creator.profilePhotoImageId ? `/creators/${creator._id}/profile-photo` : ""
  })));
}));
// Businesses no longer contact creators directly: they select a creator and an admin follows up.
const withId = ({ _id, ...doc }) => ({ id: _id.toString(), ...doc });
app.get("/api/business/creator-requests", requireBusiness, asyncRoute(async (req, res) => {
  const requests = await creatorRequestsCollection().find({ businessId: req.businessId.toString() }).sort({ createdAt: -1 }).limit(100).toArray();
  res.json(requests.map(withId));
}));
app.post("/api/business/creator-requests", requireBusiness, asyncRoute(async (req, res) => {
  const creatorId = typeof req.body?.creatorId === "string" ? req.body.creatorId : "";
  const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
  if (!ObjectId.isValid(creatorId)) return res.status(400).json({ error: "Choose a valid creator." });
  if (!note || note.length > 1000) return res.status(400).json({ error: "Describe what you need. The note must be 1,000 characters or fewer." });
  const creator = await findApprovedCreator(creatorId);
  if (!creator) return res.status(404).json({ error: "Approved creator not found." });
  const businessId = req.businessId.toString();
  const businessName = req.business.businessName || req.session.username;
  const request = {
    businessId,
    businessName,
    creatorId,
    creatorUsername: creator.username,
    creatorDisplayName: creator.displayName || creator.username,
    note,
    status: "pending",
    createdAt: new Date().toISOString()
  };
  let result;
  try {
    result = await creatorRequestsCollection().insertOne(request);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "You already have a pending request for this creator." });
    throw error;
  }
  await notificationsCollection().insertOne({
    recipientId: "admin",
    type: "creator_request",
    requestId: result.insertedId.toString(),
    title: `${businessName} selected creator ${request.creatorDisplayName}`,
    message: note.slice(0, 180),
    readAt: null,
    createdAt: request.createdAt
  });
  res.status(201).json({ id: result.insertedId.toString(), ...request });
}));
app.get("/api/admin/creators", requireAdmin, asyncRoute(async (_req, res) => {
  const creators = await usersCollection().find({
    ...approvedCreatorQuery
  }, { projection: { username: 1, displayName: 1, bio: 1, profilePhotoImageId: 1 } }).sort({ username: 1 }).limit(500).toArray();
  res.json(creators.map(publicCreatorProfile));
}));
app.get("/api/admin/creator-requests", requireAdmin, asyncRoute(async (_req, res) => {
  const requests = await creatorRequestsCollection().find({}).sort({ createdAt: -1 }).limit(200).toArray();
  res.json(requests.map(withId));
}));
app.patch("/api/admin/creator-requests/:id", requireAdmin, asyncRoute(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Request not found." });
  const status = req.body?.status;
  if (!["handled", "dismissed"].includes(status)) return res.status(400).json({ error: "Choose handled or dismissed." });
  const request = await creatorRequestsCollection().findOneAndUpdate(
    { _id: new ObjectId(req.params.id), status: "pending" },
    { $set: { status, resolvedAt: new Date().toISOString() } },
    { returnDocument: "after" }
  );
  if (!request) return res.status(404).json({ error: "Pending request not found." });
  res.json(withId(request));
}));
async function resolveCreatorRequest(requestId, creatorId) {
  if (!ObjectId.isValid(requestId)) return;
  await creatorRequestsCollection().updateOne(
    { _id: new ObjectId(requestId), creatorId, status: "pending" },
    { $set: { status: "handled", resolvedAt: new Date().toISOString() } }
  );
}
async function postAdminChat(creatorId, senderRole, senderName, text) {
  const message = { creatorId, senderRole, senderName, text, createdAt: new Date().toISOString() };
  const result = await adminChatsCollection().insertOne(message);
  return { id: result.insertedId.toString(), ...message };
}
const chatText = value => typeof value === "string" ? value.trim() : "";
app.get("/api/creator/admin-chat", requireCreator, asyncRoute(async (req, res) => {
  const messages = await adminChatsCollection().find({ creatorId: req.creatorId.toString() }).sort({ createdAt: 1 }).limit(300).toArray();
  res.json(messages.map(withId));
}));
app.post("/api/creator/admin-chat", requireCreator, asyncRoute(async (req, res) => {
  const text = chatText(req.body?.text);
  if (!text || text.length > 2000) return res.status(400).json({ error: "Message must be between 1 and 2,000 characters." });
  const creator = await usersCollection().findOne({ _id: req.creatorId }, { projection: { username: 1, displayName: 1 } });
  const name = creator?.displayName || creator?.username || req.session.username;
  const message = await postAdminChat(req.creatorId.toString(), "creator", name, text);
  await notificationsCollection().insertOne({
    recipientId: "admin",
    type: "creator_chat",
    creatorId: req.creatorId.toString(),
    title: `Message from creator ${name}`,
    message: text.slice(0, 180),
    readAt: null,
    createdAt: message.createdAt
  });
  res.status(201).json(message);
}));
app.get("/api/admin/chats", requireAdmin, asyncRoute(async (_req, res) => {
  const latest = await adminChatsCollection().aggregate([
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$creatorId", latestMessage: { $first: "$text" }, latestAt: { $first: "$createdAt" }, latestRole: { $first: "$senderRole" } } },
    { $sort: { latestAt: -1 } },
    { $limit: 200 }
  ]).toArray();
  const ids = latest.map(item => item._id).filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id));
  const users = ids.length ? await usersCollection().find({ _id: { $in: ids } }, { projection: { username: 1, displayName: 1 } }).toArray() : [];
  const names = new Map(users.map(user => [user._id.toString(), user.displayName || user.username]));
  res.json(latest.map(({ _id, ...item }) => ({ creatorId: _id, creatorName: names.get(_id) || "Creator", ...item })));
}));
app.get("/api/admin/chats/:creatorId", requireAdmin, asyncRoute(async (req, res) => {
  const messages = await adminChatsCollection().find({ creatorId: req.params.creatorId }).sort({ createdAt: 1 }).limit(300).toArray();
  res.json(messages.map(withId));
}));
app.post("/api/admin/chats/:creatorId", requireAdmin, asyncRoute(async (req, res) => {
  const text = chatText(req.body?.text);
  if (!text || text.length > 2000) return res.status(400).json({ error: "Message must be between 1 and 2,000 characters." });
  const creator = await findApprovedCreator(req.params.creatorId);
  if (!creator) return res.status(404).json({ error: "Approved creator not found." });
  const message = await postAdminChat(req.params.creatorId, "admin", "Zinda Play", text);
  await notificationsCollection().insertOne({
    recipientId: req.params.creatorId,
    type: "admin_message",
    title: "Message from Zinda Play",
    message: text.slice(0, 180),
    readAt: null,
    createdAt: message.createdAt
  });
  res.status(201).json(message);
}));
app.get("/api/admin/invitations", requireAdmin, asyncRoute(async (_req, res) => {
  const invitations = await invitationsCollection().find({ businessId: "admin" }).sort({ createdAt: -1 }).limit(200).toArray();
  res.json(invitations.map(withId));
}));
app.post("/api/admin/invitations", requireAdmin, asyncRoute(async (req, res) => {
  const creatorId = typeof req.body?.creatorId === "string" ? req.body.creatorId : "";
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message || message.length > 1000) return res.status(400).json({ error: "Invitation message is required and must be 1,000 characters or fewer." });
  const creator = await findApprovedCreator(creatorId);
  if (!creator) return res.status(404).json({ error: "Approved creator not found." });
  const invitation = {
    businessId: "admin",
    businessName: "Zinda Play",
    creatorId,
    creatorUsername: creator.username,
    message,
    status: "pending",
    createdAt: new Date().toISOString()
  };
  let result;
  try {
    result = await invitationsCollection().insertOne(invitation);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "This creator already has a pending invitation from Zinda Play." });
    throw error;
  }
  await notificationsCollection().insertOne({
    recipientId: creatorId,
    type: "brand_invitation",
    invitationId: result.insertedId.toString(),
    title: "Video invitation from Zinda Play",
    message,
    readAt: null,
    createdAt: invitation.createdAt
  });
  await resolveCreatorRequest(req.body?.requestId, creatorId);
  await postAdminChat(creatorId, "admin", "Zinda Play", `Invitation: ${message}`);
  res.status(201).json({ id: result.insertedId.toString(), ...invitation });
}));
app.post("/api/admin/messages", requireAdmin, asyncRoute(async (req, res) => {
  const creatorId = typeof req.body?.creatorId === "string" ? req.body.creatorId : "";
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text || text.length > 2000) return res.status(400).json({ error: "Message must be between 1 and 2,000 characters." });
  const creator = await findApprovedCreator(creatorId);
  if (!creator) return res.status(404).json({ error: "Approved creator not found." });
  await notificationsCollection().insertOne({
    recipientId: creatorId,
    type: "admin_message",
    title: "Message from Zinda Play",
    message: text,
    readAt: null,
    createdAt: new Date().toISOString()
  });
  await resolveCreatorRequest(req.body?.requestId, creatorId);
  await postAdminChat(creatorId, "admin", "Zinda Play", text);
  res.status(201).json({ sent: true });
}));
app.get("/api/creator/invitations", requireCreator, asyncRoute(async (req, res) => {
  const invitations = await invitationsCollection().find({ creatorId: req.creatorId.toString() }).sort({ createdAt: -1 }).toArray();
  res.json(invitations.map(({ _id, ...invitation }) => ({ id: _id.toString(), ...invitation })));
}));
app.patch("/api/creator/invitations/:id", requireCreator, asyncRoute(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Invitation not found." });
  const status = req.body?.status;
  if (!["accepted", "declined"].includes(status)) return res.status(400).json({ error: "Choose accepted or declined." });
  const invitationId = new ObjectId(req.params.id);
  const invitation = await invitationsCollection().findOneAndUpdate(
    { _id: invitationId, creatorId: req.creatorId.toString(), status: "pending" },
    { $set: { status, respondedAt: new Date().toISOString() } },
    { returnDocument: "after" }
  );
  if (!invitation) return res.status(404).json({ error: "Pending invitation not found." });
  if (invitation.businessId === "admin") {
    const text = status === "accepted" ? "I'm interested in this invitation." : "I'm not interested in this invitation right now.";
    await postAdminChat(req.creatorId.toString(), "creator", invitation.creatorUsername, text);
  }
  await notificationsCollection().insertOne({
    recipientId: invitation.businessId,
    type: "brand_invitation_response",
    invitationId: invitationId.toString(),
    title: `${invitation.creatorUsername} ${status} your invitation`,
    message: `${invitation.creatorUsername} ${status} the video invitation from ${invitation.businessName}.`,
    readAt: null,
    createdAt: new Date().toISOString()
  });
  const { _id, ...data } = invitation;
  res.json({ id: _id.toString(), ...data });
}));
async function findApprovedCreator(id) {
  if (!ObjectId.isValid(id)) return null;
  return usersCollection().findOne({
    _id: new ObjectId(id),
    ...approvedCreatorQuery
  }, { projection: { username: 1, displayName: 1, bio: 1, profilePhotoImageId: 1, introVideoId: 1 } });
}
function publicCreatorProfile(creator) {
  return {
    id: creator._id.toString(),
    username: creator.username,
    displayName: creator.displayName || creator.username,
    bio: creator.bio || "",
    profilePhotoUrl: creator.profilePhotoImageId ? `/creators/${creator._id}/profile-photo` : "",
    introVideoUrl: creator.introVideoId ? `/creators/${creator._id}/intro-video` : ""
  };
}
async function creatorFollowerCount(creatorId) {
  return creatorFollowsCollection().countDocuments({ creatorId: creatorId.toString() });
}
app.get("/api/discover/creators", asyncRoute(async (_req, res) => {
  const creators = await usersCollection().find({
    ...approvedCreatorQuery
  }, { projection: { username: 1, displayName: 1, bio: 1, profilePhotoImageId: 1 } })
    .sort({ displayName: 1, username: 1 })
    .limit(200)
    .toArray();
  res.json(creators.map(creator => publicCreatorProfile(creator)));
}));
app.get("/api/discover/popular-creators", asyncRoute(async (_req, res) => {
  const counts = await creatorFollowsCollection().aggregate([
    { $group: { _id: "$creatorId", followerCount: { $sum: 1 } } },
    { $sort: { followerCount: -1 } },
    { $limit: 30 }
  ]).toArray();
  const ids = counts.map(item => item._id).filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id));
  const creators = ids.length ? await usersCollection().find({
    _id: { $in: ids },
    ...approvedCreatorQuery
  }, { projection: { username: 1, displayName: 1, bio: 1, profilePhotoImageId: 1 } }).toArray() : [];
  const byId = new Map(creators.map(creator => [creator._id.toString(), creator]));
  res.json(counts
    .filter(item => byId.has(item._id))
    .slice(0, 10)
    .map(item => ({ ...publicCreatorProfile(byId.get(item._id)), followerCount: item.followerCount })));
}));
app.get("/api/discover/brands", asyncRoute(async (_req, res) => {
  const brands = await usersCollection().find(
    { accountType: "business" },
    { projection: { username: 1, businessName: 1, businessAbout: 1, businessLogoImageId: 1 } }
  ).sort({ businessName: 1, username: 1 }).limit(200).toArray();
  res.json(brands.map(brand => ({
    id: brand._id.toString(),
    username: brand.username,
    businessName: brand.businessName || brand.username,
    businessAbout: brand.businessAbout || "",
    logoUrl: brand.businessLogoImageId ? `/creators/${brand._id}/profile-photo` : ""
  })));
}));
app.get("/api/creators/:creatorId/profile", asyncRoute(async (req, res) => {
  const creator = await findApprovedCreator(req.params.creatorId);
  if (!creator) return res.status(404).json({ error: "Approved creator not found." });
  const videos = await videosAvailableInViewerCity(
    await videosCollection().find({
      ownerId: creator._id.toString(),
      ...publicVideoQuery
    }).sort({ createdAt: -1 }).limit(50).toArray(),
    req
  );
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  const session = token && sessions.get(token);
  const [followerCount, follow] = await Promise.all([
    creatorFollowerCount(creator._id),
    session?.userId
      ? creatorFollowsCollection().findOne({ creatorId: creator._id.toString(), followerId: session.userId })
      : null
  ]);
  res.json({
    ...publicCreatorProfile(creator),
    followerCount,
    following: Boolean(follow),
    isSelf: session?.userId === creator._id.toString(),
    videos: await withCreatorProfiles(videos)
  });
}));
app.get("/api/creators/:creatorId/follow", asyncRoute(async (req, res) => {
  const creator = await findApprovedCreator(req.params.creatorId);
  if (!creator) return res.status(404).json({ error: "Approved creator not found." });
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  const session = token && sessions.get(token);
  const [followerCount, follow] = await Promise.all([
    creatorFollowerCount(creator._id),
    session?.userId
      ? creatorFollowsCollection().findOne({ creatorId: creator._id.toString(), followerId: session.userId })
      : null
  ]);
  res.json({
    creatorId: creator._id.toString(),
    followerCount,
    following: Boolean(follow),
    isSelf: session?.userId === creator._id.toString()
  });
}));
app.post("/api/creators/:creatorId/follow", requireShortsAccount, shortEngagementLimit, asyncRoute(async (req, res) => {
  const creator = await findApprovedCreator(req.params.creatorId);
  if (!creator) return res.status(404).json({ error: "Approved creator not found." });
  const followerId = req.session.userId;
  const creatorId = creator._id.toString();
  if (followerId === creatorId) return res.status(400).json({ error: "You cannot follow your own creator profile." });
  let createdFollow = false;
  try {
    await creatorFollowsCollection().insertOne({
      creatorId,
      followerId,
      createdAt: new Date().toISOString()
    });
    createdFollow = true;
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  if (createdFollow) {
    await notificationsCollection().insertOne({
      recipientId: creatorId,
      type: "creator_follow",
      followerId,
      title: "You have a new follower",
      message: `${req.session.username} followed your creator profile.`,
      readAt: null,
      createdAt: new Date().toISOString()
    });
  }
  res.json({ creatorId, followerCount: await creatorFollowerCount(creatorId), following: true });
}));
app.delete("/api/creators/:creatorId/follow", requireShortsAccount, shortEngagementLimit, asyncRoute(async (req, res) => {
  const creator = await findApprovedCreator(req.params.creatorId);
  if (!creator) return res.status(404).json({ error: "Approved creator not found." });
  const creatorId = creator._id.toString();
  if (req.session.userId === creatorId) return res.status(400).json({ error: "You cannot unfollow your own creator profile." });
  await creatorFollowsCollection().deleteOne({ creatorId, followerId: req.session.userId });
  res.json({ creatorId, followerCount: await creatorFollowerCount(creatorId), following: false });
}));
app.get("/api/creator/profile", requireCreator, asyncRoute(async (req, res) => {
  const creator = await usersCollection().findOne(
    { _id: req.creatorId },
    { projection: { username: 1, displayName: 1, bio: 1, profilePhotoImageId: 1, introVideoId: 1 } }
  );
  if (!creator) return res.status(404).json({ error: "Creator profile not found." });
  const videos = await videosAvailableInViewerCity(
    await videosCollection().find({
      ownerId: creator._id.toString(),
      ...publicVideoQuery
    }).sort({ createdAt: -1 }).toArray(),
    req
  );
  res.json({
    ...publicCreatorProfile(creator),
    followerCount: await creatorFollowerCount(creator._id),
    videos: await withCreatorProfiles(videos)
  });
}));
app.get("/api/business/creators/:creatorId", requireBusiness, asyncRoute(async (req, res) => {
  const creator = await findApprovedCreator(req.params.creatorId);
  if (!creator) return res.status(404).json({ error: "Approved creator not found." });
  const videos = await videosAvailableInViewerCity(
    await videosCollection().find({
      ownerId: creator._id.toString(),
      ...publicVideoQuery
    }).sort({ createdAt: -1 }).limit(20).toArray(),
    req
  );
  res.json({ ...publicCreatorProfile(creator), videos: videos.map(safeVideo) });
}));
app.get("/api/notifications", asyncRoute(async (req, res) => {
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  const session = token && sessions.get(token);
  if (!session) return res.status(401).json({ error: "Sign in to view notifications." });
  const recipientId = session.role === "admin" ? "admin" : session.userId;
  if (!recipientId) return res.status(401).json({ error: "Sign in to view notifications." });
  if (session.role !== "admin") await deliverCreatorAdNotifications(database, recipientId);
  const notifications = await notificationsCollection()
    .find({ recipientId })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
  let approvalStatus = null;
  if (session.userId) {
    const user = await usersCollection().findOne({ _id: new ObjectId(session.userId) }, { projection: { accountType: 1, approvalStatus: 1, creatorRequested: 1 } });
    if (user) {
      session.role = accountRole(user, session.role);
      if (session.role !== "promoter" && session.role !== "business") approvalStatus = user.approvalStatus || "approved";
    }
  }
  res.json({
    notifications: notifications.map(({ _id, recipientId: _recipientId, ...notification }) => ({ id: _id, ...notification })),
    unreadCount: notifications.filter(notification => !notification.readAt).length,
    role: session.role,
    approvalStatus
  });
}));
app.post("/api/notifications/:id/read", asyncRoute(async (req, res) => {
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  const session = token && sessions.get(token);
  if (!session) return res.status(401).json({ error: "Sign in to manage notifications." });
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Notification not found." });
  const recipientId = session.role === "admin" ? "admin" : session.userId;
  const result = await notificationsCollection().updateOne(
    { _id: new ObjectId(req.params.id), recipientId },
    { $set: { readAt: new Date().toISOString() } }
  );
  if (!result.matchedCount) return res.status(404).json({ error: "Notification not found." });
  res.status(204).end();
}));
app.get("/api/admin/members/pending", requireAdmin, asyncRoute(async (_req, res) => {
  const users = await usersCollection()
    .find({ approvalStatus: "pending" }, { projection: { username: 1, createdAt: 1 } })
    .sort({ createdAt: 1 })
    .toArray();
  res.json(users.map(user => ({ id: user._id.toString(), username: user.username, createdAt: user.createdAt })));
}));
app.patch("/api/admin/members/:id", requireAdmin, asyncRoute(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Member not found." });
  const decision = req.body?.approvalStatus;
  if (!["approved", "rejected"].includes(decision)) {
    return res.status(400).json({ error: "Choose approved or rejected." });
  }
  const userId = new ObjectId(req.params.id);
  const user = await usersCollection().findOne({ _id: userId });
  if (!user) return res.status(404).json({ error: "Member not found." });
  if (user.approvalStatus !== "pending") {
    return res.status(409).json({ error: "This creator application has already been reviewed." });
  }
  const updateResult = await usersCollection().updateOne({ _id: userId, approvalStatus: "pending" }, {
    $set: { approvalStatus: decision, reviewedAt: new Date().toISOString() }
  });
  if (!updateResult.matchedCount) return res.status(409).json({ error: "This creator application has already been reviewed." });
  const approved = decision === "approved";
  await notificationsCollection().insertOne({
    recipientId: userId.toString(),
    type: approved ? "creator_approved" : "creator_rejected",
    title: approved ? "Creator membership approved" : "Creator application update",
    message: approved
      ? "Your creator membership is approved. You can now upload videos and track their analytics."
      : "Your creator membership application was not approved. Contact the administrator if you have questions.",
    readAt: null,
    createdAt: new Date().toISOString()
  });
  await notificationsCollection().updateMany(
    { recipientId: "admin", type: "creator_application", userId: userId.toString(), readAt: null },
    { $set: { readAt: new Date().toISOString() } }
  );
  res.json({ id: userId.toString(), username: user.username, approvalStatus: decision });
}));
app.post("/api/auth/logout", (req, res) => {
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (token) sessions.delete(token);
  res.status(204).end();
});
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    return res.status(503).json({ error: "Admin credentials are missing. Set ADMIN_USERNAME and ADMIN_PASSWORD in server/.env, then restart the API." });
  }
  if (typeof username !== "string" || typeof password !== "string" ||
      !matchesSecret(username, process.env.ADMIN_USERNAME) ||
      !matchesSecret(password, process.env.ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "Incorrect username or password" });
  }
  const token = createSession(username, "admin");
  res.json({ token });
});
app.post("/api/admin/logout", requireAdmin, (req, res) => {
  const token = req.get("authorization").replace(/^Bearer\s+/i, "");
  sessions.delete(token);
  res.status(204).end();
});
app.get("/api/admin/banner", requireAdmin, asyncRoute(async (_req, res) => {
  const banner = await bannerCollection().findOne({ _id: defaultBanner._id });
  res.json(publicBannerSettings(banner || defaultBanner));
}));
app.put("/api/admin/banner", requireAdmin, asyncRoute(async (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
  const buttonLabel = typeof req.body?.buttonLabel === "string" ? req.body.buttonLabel.trim() : "";
  const buttonUrl = typeof req.body?.buttonUrl === "string" ? req.body.buttonUrl.trim() : "";
  const enabled = req.body?.enabled === true;

  if (title.length > 120 || description.length > 500 || buttonLabel.length > 40) {
    return res.status(400).json({ error: "Banner title, description, or button label is too long." });
  }
  if (buttonUrl) {
    try {
      if (!["http:", "https:"].includes(new URL(buttonUrl).protocol)) throw new Error();
    } catch {
      return res.status(400).json({ error: "Button URL must be a valid HTTP or HTTPS URL." });
    }
  }
  if (enabled && !title) return res.status(400).json({ error: "Add a banner title before publishing it." });
  if (Boolean(buttonLabel) !== Boolean(buttonUrl)) {
    return res.status(400).json({ error: "Provide both a button label and button URL, or leave both empty." });
  }

  const settings = { enabled, title, description, buttonLabel, buttonUrl, updatedAt: new Date().toISOString() };
  await bannerCollection().updateOne(
    { _id: defaultBanner._id },
    { $set: settings, $setOnInsert: { _id: defaultBanner._id, imageId: "" }, $unset: { imageUrl: "" } },
    { upsert: true }
  );
  const banner = await bannerCollection().findOne({ _id: defaultBanner._id });
  res.json(publicBannerSettings(banner));
}));
app.put("/api/admin/banner/image", requireAdmin, asyncRoute(async (req, res) => {
  const contentType = String(req.get("Content-Type") || "").split(";")[0].toLowerCase();
  const extension = supportedImageTypes.get(contentType);
  if (!extension) return res.status(415).json({ error: "Choose a JPEG, PNG, WebP, or GIF image." });
  const size = Number(req.get("Content-Length") || req.get("X-Upload-Size") || 0);
  if (!Number.isSafeInteger(size) || size <= 0) return res.status(411).json({ error: "The image upload must include a valid file size." });
  if (size > maxImageBytes) return res.status(413).json({ error: "Banner images are limited to 8 MB." });

  const bucket = bannerImageBucket();
  const upload = bucket.openUploadStream(`homepage-banner.${extension}`, {
    metadata: { contentType }
  });
  let received = 0;
  req.on("data", chunk => {
    received += chunk.length;
    if (received > maxImageBytes) req.destroy(Object.assign(new Error("Banner images are limited to 8 MB."), { statusCode: 413 }));
  });
  try {
    await pipeline(req, upload);
    if (received !== size) throw Object.assign(new Error("The uploaded image size did not match the selected file."), { statusCode: 400 });
  } catch (error) {
    await bucket.delete(upload.id).catch(() => {});
    if (!res.headersSent) return res.status(error.statusCode || 400).json({ error: error.message });
    return;
  }

  const previous = await bannerCollection().findOne({ _id: defaultBanner._id });
  try {
    await bannerCollection().updateOne(
      { _id: defaultBanner._id },
      {
        $set: { imageId: upload.id.toHexString(), updatedAt: new Date().toISOString() },
        $setOnInsert: {
          _id: defaultBanner._id,
          enabled: defaultBanner.enabled,
          title: defaultBanner.title,
          description: defaultBanner.description,
          buttonLabel: defaultBanner.buttonLabel,
          buttonUrl: defaultBanner.buttonUrl
        },
        $unset: { imageUrl: "" }
      },
      { upsert: true }
    );
  } catch (error) {
    await bucket.delete(upload.id).catch(() => {});
    throw error;
  }
  if (previous?.imageId && ObjectId.isValid(previous.imageId)) {
    await bucket.delete(new ObjectId(previous.imageId)).catch(error => {
      console.error("Failed to remove the replaced banner image:", error.message);
    });
  }
  const banner = await bannerCollection().findOne({ _id: defaultBanner._id });
  res.status(201).json(publicBannerSettings(banner));
}));
const uploadThumbnail = asyncRoute(async (req, res) => {
  const video = await videosCollection().findOne({ _id: req.params.id, deletedAt: { $exists: false } });
  if (!video || (req.session.role === "creator" && video.ownerId !== req.creatorId.toString())) {
    return res.status(404).json({ error: "Video not found" });
  }

  const contentType = String(req.get("Content-Type") || "").split(";")[0].toLowerCase();
  const extension = supportedImageTypes.get(contentType);
  if (!extension) return res.status(415).json({ error: "Choose a JPEG, PNG, WebP, or GIF thumbnail." });
  const size = Number(req.get("Content-Length") || req.get("X-Upload-Size") || 0);
  if (!Number.isSafeInteger(size) || size <= 0) return res.status(411).json({ error: "The thumbnail upload must include a valid file size." });
  if (size > maxImageBytes) return res.status(413).json({ error: "Video thumbnails are limited to 8 MB." });

  const bucket = videoThumbnailBucket();
  const upload = bucket.openUploadStream(`video-thumbnail.${extension}`, { metadata: { contentType } });
  let received = 0;
  req.on("data", chunk => {
    received += chunk.length;
    if (received > maxImageBytes) req.destroy(Object.assign(new Error("Video thumbnails are limited to 8 MB."), { statusCode: 413 }));
  });
  try {
    await pipeline(req, upload);
    if (received !== size) throw Object.assign(new Error("The uploaded thumbnail size did not match the selected file."), { statusCode: 400 });
  } catch (error) {
    await bucket.delete(upload.id).catch(() => {});
    if (!res.headersSent) return res.status(error.statusCode || 400).json({ error: error.message });
    return;
  }

  let result;
  try {
    result = await videosCollection().updateOne(
      { _id: video._id },
      { $set: { thumbnailImageId: upload.id.toHexString() }, $unset: { thumbnailUrl: "" } }
    );
  } catch (error) {
    await bucket.delete(upload.id).catch(() => {});
    throw error;
  }
  if (!result.matchedCount) {
    await bucket.delete(upload.id).catch(() => {});
    return res.status(404).json({ error: "Video not found" });
  }
  if (video.thumbnailImageId && ObjectId.isValid(video.thumbnailImageId)) {
    await bucket.delete(new ObjectId(video.thumbnailImageId)).catch(error => {
      console.error("Failed to remove the replaced video thumbnail:", error.message);
    });
  }
  const updatedVideo = await videosCollection().findOne({ _id: video._id });
  res.status(201).json(safeVideo(updatedVideo));
});
app.put("/api/admin/videos/:id/thumbnail", requireAdmin, uploadThumbnail);
app.put("/api/creator/videos/:id/thumbnail", requireCreator, uploadThumbnail);
app.post("/api/admin/categories", requireAdmin, asyncRoute(async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ error: "Category name is required" });
  if (categories.some(category => category.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: "A category with that name already exists" });
  }
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || randomUUID();
  const category = { id: randomUUID(), name, slug };
  try {
    await categoriesCollection().insertOne({ _id: category.id, name, slug });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "A category with that name already exists" });
    throw error;
  }
  categories.push(category);
  res.status(201).json(category);
}));
const uploadVideo = asyncRoute(async (req, res) => {
  const short = shortUpload(req);
  if (short.error) return res.status(400).json({ error: short.error });
  if (short.fields.videoType === "short") {
    if (!["creator", "admin"].includes(req.session.role)) return res.status(403).json({ error: "Simply uploads require creator access." });
    if (!categories.some(category => category.id === req.get("X-Video-Category"))) return res.status(400).json({ error: "Choose a Simply category." });
    try { shortsCdnOrigin(); }
    catch (error) { return res.status(503).json({ error: error.message }); }
  }
  const title = short.fields.caption?.slice(0, 120) || String(req.get("X-Video-Title") || "").trim();
  const description = short.fields.caption || String(req.get("X-Video-Description") || "");
  const categoryId = String(req.get("X-Video-Category") || "");
  let collectionName;
  try {
    collectionName = decodeURIComponent(req.get("X-Video-Collection-Name") || "");
  } catch {
    return res.status(400).json({ error: "Collection name encoding is invalid." });
  }
  const collection = normalizeVideoCollection({
    collectionName,
    collectionType: req.get("X-Video-Collection-Type") || "",
    episodeNumber: req.get("X-Video-Episode-Number") || ""
  });
  let targetCityName;
  try {
    targetCityName = decodeURIComponent(req.get("X-Video-Target-City") || "");
  } catch {
    return res.status(400).json({ error: "Target city encoding is invalid." });
  }
  const targetCity = normalizeVideoTargetCity({ targetCity: targetCityName });
  const promotionUrl = req.session.role === "creator" ? String(req.get("X-Video-Promotion-Url") || "").trim() : "";
  const promotionType = req.session.role === "creator" ? String(req.get("X-Video-Promotion-Type") || "product") : "";
  const ownerBusinessId = req.session.role === "business" ? req.businessId.toString() : null;
  const contentType = String(req.get("Content-Type") || "").split(";")[0].toLowerCase();
  const allowedTypes = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/x-msvideo", "video/x-ms-wmv", "video/mpeg", "video/3gpp", "video/x-m4v"]);
  const size = Number(req.get("Content-Length") || req.get("X-Upload-Size") || 0);
  if (!title) return res.status(400).json({ error: "Video title is required" });
  if (collection.error) return res.status(400).json({ error: collection.error });
  if (targetCity.error) return res.status(400).json({ error: targetCity.error });
  if (req.session.role === "business" && targetCity.fields.targetCity) {
    return res.status(400).json({ error: "Business video location is set when you create a promotion campaign." });
  }
  if (req.session.role === "business" && collection.fields.collectionName) {
    return res.status(400).json({ error: "Business promotional videos cannot be added to a creator or admin collection." });
  }
  if (!allowedTypes.has(contentType)) return res.status(415).json({ error: "Choose a supported video file (MP4, MOV, WebM, MKV, AVI, WMV, MPEG, or 3GP)." });
  if (!size) return res.status(411).json({ error: "The upload must include a file size." });
  if (size > maxVideoUploadBytes) return res.status(413).json({ error: "Video uploads are limited to 2 GB." });
  if (categoryId && !categories.some(category => category.id === categoryId)) {
    return res.status(400).json({ error: "Choose a valid category" });
  }
  if (ownerBusinessId && (title.length > 120 || description.length > 2000)) {
    return res.status(400).json({ error: "Business video titles must be 120 characters or fewer and descriptions 2,000 characters or fewer." });
  }
  if (req.session.role === "creator") {
    if (promotionUrl.length > 2048) {
      return res.status(400).json({ error: "Product, service, or course URLs must be 2,048 characters or fewer." });
    }
    if (!["product", "service", "course"].includes(promotionType)) {
      return res.status(400).json({ error: "Choose Product, Service, or Course for the link type." });
    }
    if (promotionUrl) {
      let parsedUrl;
      try { parsedUrl = new URL(promotionUrl); }
      catch { return res.status(400).json({ error: "Enter a valid product, service, or course URL." }); }
      if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) {
        return res.status(400).json({ error: "Use an HTTPS product, service, or course URL without embedded credentials." });
      }
    }
  }

  let config;
  try {
    config = bunnyConfiguration();
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }

  let bunnyVideo;
  try {
    const createResponse = await bunnyRequest(`${config.baseUrl}/videos`, config.apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    });
    bunnyVideo = await createResponse.json();
    if (!bunnyVideo.guid) throw new Error("Bunny Stream did not return a video ID.");

    await bunnyRequest(`${config.baseUrl}/videos/${encodeURIComponent(bunnyVideo.guid)}`, config.apiKey, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream", "Content-Length": String(size) },
      body: req,
      duplex: "half"
    });
  } catch (error) {
    if (bunnyVideo?.guid) {
      try {
        await bunnyRequest(`${config.baseUrl}/videos/${encodeURIComponent(bunnyVideo.guid)}`, config.apiKey, { method: "DELETE" });
      } catch (cleanupError) {
        console.error("Failed to remove the incomplete Bunny Stream upload:", cleanupError.message);
      }
    }
    if (!res.headersSent) {
      const status = error.message.includes("Bunny Stream is not configured") ? 503 : 502;
      return res.status(status).json({ error: error.message });
    }
    return;
  }

  const video = {
    _id: randomUUID(),
    title,
    description,
    categoryId,
    ...collection.fields,
    ...targetCity.fields,
    thumbnailUrl: "",
    playbackUrl: `https://iframe.mediadelivery.net/embed/${config.libraryId}/${bunnyVideo.guid}`,
    durationSeconds: 0,
    ...short.fields,
    ownerId: req.creatorId?.toString() || null,
    ...(ownerBusinessId ? { ownerBusinessId, businessCampaignStatus: "unpaid", approvalStatus: "pending" } : {}),
    ...(req.session.role === "creator" ? { promotionUrl, promotionType } : {}),
    featured: req.session.role === "admin" && req.get("X-Video-Featured") === "true",
    published: ["creator", "business"].includes(req.session.role) ? false : req.get("X-Video-Published") === "true",
    ...(req.session.role === "creator" ? { approvalStatus: "pending" } : {}),
    views: 0,
    bunnyVideoId: bunnyVideo.guid,
    processingStatus: "uploaded",
    encodeProgress: 0,
    createdAt: new Date().toISOString()
  };
  await videosCollection().insertOne(video);
  if (["creator", "business"].includes(req.session.role)) {
    const ownerId = req.session.role === "creator" ? req.creatorId.toString() : req.businessId.toString();
    const submittedAt = new Date().toISOString();
    const isBusiness = req.session.role === "business";
    await notificationsCollection().insertMany([
      {
        recipientId: ownerId,
        type: isBusiness ? "business_video_submitted" : "creator_video_submitted",
        videoId: video._id,
        title: "Video submitted for approval",
        message: isBusiness
          ? `"${title}" is waiting for admin approval. Once approved, you can set its target and pay to promote it.`
          : `"${title}" is waiting for admin approval before it is published.`,
        readAt: null,
        createdAt: submittedAt
      },
      {
        recipientId: "admin",
        type: isBusiness ? "business_video_review" : "creator_video_review",
        videoId: video._id,
        ...(isBusiness ? { businessId: ownerId } : { creatorId: ownerId }),
        username: req.session.username,
        ownerType: isBusiness ? "business" : "creator",
        title: `${isBusiness ? "Business" : "Creator"} video needs review`,
        message: `${req.session.username} submitted "${title}" for approval.`,
        readAt: null,
        createdAt: submittedAt
      }
    ]);
  }
  res.status(201).json(safeVideo(video));
});
const MEMBERSHIP_DAYS = 30;
const creatorOrdersCollection = () => database.collection("creatorMembershipOrders");
const addDays = (date, days) => new Date(date.getTime() + days * 86400000);
// The free trial starts the first time a creator's membership is checked, so existing creators also get a full week.
async function creatorMembershipState(userId) {
  const now = new Date();
  const settings = await membershipSettings(database);
  let user = await usersCollection().findOne({ _id: userId }, { projection: { creatorMembership: 1 } });
  let membership = user?.creatorMembership;
  if (!membership?.trialEndsAt) {
    membership = { ...membership, trialStartedAt: now.toISOString(), trialEndsAt: addDays(now, settings.trialDays).toISOString() };
    await usersCollection().updateOne({ _id: userId, "creatorMembership.trialEndsAt": { $exists: false } }, { $set: { creatorMembership: membership } });
    user = await usersCollection().findOne({ _id: userId }, { projection: { creatorMembership: 1 } });
    membership = user.creatorMembership;
  }
  const paidUntil = membership.paidUntil ? new Date(membership.paidUntil) : null;
  const trialEndsAt = new Date(membership.trialEndsAt);
  const status = paidUntil && paidUntil > now ? "active" : trialEndsAt > now ? "trial" : "expired";
  const endsAt = status === "active" ? paidUntil : trialEndsAt;
  return {
    status,
    trialEndsAt: trialEndsAt.toISOString(),
    paidUntil: paidUntil ? paidUntil.toISOString() : null,
    daysLeft: status === "expired" ? 0 : Math.max(0, Math.ceil((endsAt - now) / 86400000)),
    priceRupees: settings.plans.find(plan => plan.enabled).priceRupees,
    periodDays: settings.plans.find(plan => plan.enabled).durationDays,
    trialDays: settings.trialDays,
    plans: settings.plans.filter(plan => plan.enabled),
    qrUrl: settings.qrUrl,
    paymentMethod: "manual"
  };
}
const requireActiveMembership = asyncRoute(async (req, res, next) => {
  const state = await creatorMembershipState(req.creatorId);
  if (state.status === "expired") {
    return res.status(402).json({ error: "Your free trial has ended. Subscribe to the creator membership to keep uploading videos." });
  }
  next();
});
app.get("/api/creator/membership", requireCreator, asyncRoute(async (req, res) => {
  const state = await creatorMembershipState(req.creatorId);
  const dueSoon = state.status !== "trial" && state.status !== "active" ? state.status === "expired" : state.daysLeft <= 2 || (state.status === "active" && state.daysLeft <= 3);
  if (dueSoon) {
    const endsAt = state.status === "active" ? state.paidUntil : state.trialEndsAt;
    const reminderKey = `${req.creatorId}:${state.status}:${endsAt}`;
    const exists = await notificationsCollection().findOne({ recipientId: req.creatorId.toString(), reminderKey });
    if (!exists) {
      await notificationsCollection().insertOne({
        recipientId: req.creatorId.toString(),
        type: "membership_reminder",
        reminderKey,
        title: state.status === "expired" ? "Your free trial has ended" : state.status === "trial" ? "Your free trial is ending soon" : "Your membership is ending soon",
        message: state.status === "expired"
          ? `Upgrade for ₹${state.priceRupees} per ${state.periodDays} days to keep uploading videos.`
          : `${state.daysLeft} ${state.daysLeft === 1 ? "day" : "days"} left. Upgrade for ₹${state.priceRupees} per ${state.periodDays} days to keep uploading videos.`,
        readAt: null,
        createdAt: new Date().toISOString()
      });
    }
  }
  res.json(state);
}));
registerMembershipRoutes(app, { getDb: () => database, requireAdmin, requireCreator, asyncRoute, getState: creatorMembershipState });
registerBusinessAdRoutes(app, {
  getDb: () => database, requireBusiness, requireAdmin, asyncRoute,
  getCategories: () => categories, streamFile: streamGridFile
});
app.post("/api/creator/membership/order", requireCreator, (_req, res) => {
  res.status(410).json({ error: "Online membership checkout is postponed. Update the app and use QR payment with manual approval." });
});
app.post("/api/creator/membership/verify", requireCreator, asyncRoute(async (req, res) => {
  let paymentConfig;
  try {
    paymentConfig = razorpayConfiguration();
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
  const orderId = typeof req.body?.razorpay_order_id === "string" ? req.body.razorpay_order_id : "";
  const paymentId = typeof req.body?.razorpay_payment_id === "string" ? req.body.razorpay_payment_id : "";
  const signature = typeof req.body?.razorpay_signature === "string" ? req.body.razorpay_signature : "";
  if (!orderId || !paymentId || !/^[a-f0-9]{64}$/i.test(signature)) {
    return res.status(400).json({ error: "Invalid Razorpay payment confirmation." });
  }
  const expectedSignature = createHmac("sha256", paymentConfig.keySecret).update(`${orderId}|${paymentId}`).digest();
  const suppliedSignature = Buffer.from(signature, "hex");
  if (suppliedSignature.length !== expectedSignature.length || !timingSafeEqual(suppliedSignature, expectedSignature)) {
    return res.status(400).json({ error: "Razorpay payment signature verification failed." });
  }
  const claimed = await creatorOrdersCollection().findOneAndUpdate(
    { orderId, creatorId: req.creatorId.toString(), status: "created" },
    { $set: { status: "paid", paymentId, paidAt: new Date().toISOString() } }
  );
  if (!claimed) return res.status(409).json({ error: "This payment was already processed or the order was not found." });
  const current = await creatorMembershipState(req.creatorId);
  const base = current.paidUntil && new Date(current.paidUntil) > new Date() ? new Date(current.paidUntil) : new Date();
  await usersCollection().updateOne(
    { _id: req.creatorId },
    { $set: { "creatorMembership.paidUntil": addDays(base, MEMBERSHIP_DAYS).toISOString(), "creatorMembership.lastPaymentId": paymentId } }
  );
  res.json(await creatorMembershipState(req.creatorId));
}));
const requireProfilePhoto = asyncRoute(async (req, res, next) => {
  const user = await usersCollection().findOne({ _id: req.creatorId }, { projection: { profilePhotoImageId: 1 } });
  if (!user?.profilePhotoImageId) {
    return res.status(403).json({ error: "Add a profile photo to your creator account before uploading videos." });
  }
  next();
});
app.get("/api/creator/referrals", requireCreator, asyncRoute(async (req, res) => {
  const referralCode = req.creatorId.toString();
  const referred = await usersCollection().find(
    { referrerCreatorId: referralCode },
    { projection: { username: 1, createdAt: 1 } }
  ).sort({ createdAt: -1 }).limit(100).toArray();
  res.json({
    referralCode,
    total: await usersCollection().countDocuments({ referrerCreatorId: referralCode }),
    referred: referred.map(user => ({ id: user._id.toString(), username: user.username, joinedAt: user.createdAt }))
  });
}));
app.post("/api/admin/videos/upload", requireAdmin, uploadVideo);
app.post("/api/creator/videos/upload", requireCreator, requireProfilePhoto, requireActiveMembership, uploadVideo);
app.post("/api/business/videos/upload", requireBusiness, (_req, res) => {
  res.status(410).json({ error: "Use Business Ads to upload, pay by QR and submit your ad for review. Update your app." });
});
app.get("/api/business/videos", requireBusiness, asyncRoute(async (req, res) => {
  const videos = await videosCollection().find({ ownerBusinessId: req.businessId.toString() }).sort({ createdAt: -1 }).toArray();
  const videoIds = videos.map(video=>video._id);
  const campaigns = videoIds.length ? await businessCampaignsCollection().find({ videoId: { $in: videoIds } }).toArray() : [];
  const campaignMap = new Map(campaigns.map(campaign=>[campaign.videoId.toString(), campaign]));
  res.json(videos.map(video=>({
    ...safeVideo(video),
    isBusinessOwner: true,
    campaign: campaignMap.has(video._id.toString()) ? (() => {
      const { _id, businessId: _businessId, videoId: _videoId, orderId: _orderId, paymentId: _paymentId, ...campaign } = campaignMap.get(video._id.toString());
      return { id: _id.toString(), ...campaign };
    })() : null
  })));
}));
app.get("/api/business/videos/processing", requireBusiness, asyncRoute(async (req, res) => {
  const pendingVideos = await videosCollection().find({
    ownerBusinessId: req.businessId.toString(),
    bunnyVideoId: { $exists: true },
    processingStatus: { $nin: ["ready", "error", "upload failed"] }
  }).toArray();
  if (!pendingVideos.length) return res.json([]);
  const config = bunnyConfiguration();
  const updates = await Promise.all(pendingVideos.map(async video => {
    const response = await bunnyRequest(`${config.baseUrl}/videos/${encodeURIComponent(video.bunnyVideoId)}`, config.apiKey);
    const bunnyVideo = await response.json();
    const processingStatus = processingState(bunnyVideo.status);
    const encodeProgress = Number(bunnyVideo.encodeProgress) || 0;
    await videosCollection().updateOne({ _id: video._id, ownerBusinessId: req.businessId.toString() }, { $set: { processingStatus, encodeProgress } });
    return { id: video._id, processingStatus, encodeProgress };
  }));
  res.json(updates);
}));
app.post("/api/business/videos/:id/campaign-order", requireBusiness, (_req, res) => {
  res.status(410).json({ error: "New Razorpay campaigns are postponed. Use Business Ads QR payment and manual review." });
});
app.post("/api/business/campaigns/:id/verify-payment", requireBusiness, asyncRoute(async (req, res) => {
  let paymentConfig;
  try {
    paymentConfig = razorpayConfiguration();
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
  const orderId = typeof req.body?.razorpay_order_id === "string" ? req.body.razorpay_order_id : "";
  const paymentId = typeof req.body?.razorpay_payment_id === "string" ? req.body.razorpay_payment_id : "";
  const signature = typeof req.body?.razorpay_signature === "string" ? req.body.razorpay_signature : "";
  if (!ObjectId.isValid(req.params.id) || !orderId || !paymentId || !/^[a-f0-9]{64}$/i.test(signature)) {
    return res.status(400).json({ error: "Invalid Razorpay payment confirmation." });
  }
  const campaignId = new ObjectId(req.params.id);
  const campaign = await businessCampaignsCollection().findOne({
    _id: campaignId,
    businessId: req.businessId.toString(),
    orderId,
    status: "awaiting_payment"
  });
  if (!campaign) return res.status(404).json({ error: "Pending campaign payment not found." });
  const expectedSignature = createHmac("sha256", paymentConfig.keySecret).update(`${orderId}|${paymentId}`).digest();
  const suppliedSignature = Buffer.from(signature, "hex");
  if (suppliedSignature.length !== expectedSignature.length || !timingSafeEqual(suppliedSignature, expectedSignature)) {
    return res.status(400).json({ error: "Razorpay payment signature verification failed." });
  }
  const now = new Date().toISOString();
  const result = await businessCampaignsCollection().updateOne(
    { _id: campaignId, businessId: req.businessId.toString(), status: "awaiting_payment" },
    { $set: { status: "active", paymentId, paidAt: now } }
  );
  if (!result.matchedCount) return res.status(409).json({ error: "This campaign payment has already been processed." });
  await videosCollection().updateOne(
    { _id: campaign.videoId, ownerBusinessId: req.businessId.toString(), businessCampaignStatus: "awaiting_payment" },
    { $set: { businessCampaignStatus: "active", businessCampaignId: campaignId, published: true } }
  );
  res.json({ campaignId: campaignId.toString(), status: "active" });
}));
app.get("/api/admin/videos", requireAdmin, asyncRoute(async (_req, res) => {
  const videos = await videosCollection().find({ deletedAt: { $exists: false } }).sort({ createdAt: -1 }).toArray();
  res.json(await withCreatorProfiles(videos));
}));
app.get("/api/admin/videos/pending-review", requireAdmin, asyncRoute(async (_req, res) => {
  const videos = await videosCollection().find(
    {
      deletedAt: { $exists: false },
      $or: [
        { ownerId: { $exists: true, $ne: null }, approvalStatus: "pending" },
        {
          ownerBusinessId: { $exists: true, $ne: null },
          $or: [
            { approvalStatus: "pending" },
            { approvalStatus: { $exists: false }, businessCampaignId: { $exists: false } }
          ]
        }
      ]
    }
  ).sort({ createdAt: 1 }).toArray();
  const ownerIds = [...new Set(videos.map(video => video.ownerBusinessId || video.ownerId).filter(id => ObjectId.isValid(id)))];
  const owners = ownerIds.length
    ? await usersCollection().find(
      { _id: { $in: ownerIds.map(id => new ObjectId(id)) } },
      { projection: { username: 1, businessName: 1, accountType: 1 } }
    ).toArray()
    : [];
  const ownersById = new Map(owners.map(owner => [owner._id.toString(), owner]));
  res.json(videos.map(video => {
    const isBusinessVideo = Boolean(video.ownerBusinessId);
    const owner = ownersById.get((video.ownerBusinessId || video.ownerId).toString());
    return {
      ...safeVideo(video),
      ownerType: isBusinessVideo ? "business" : "creator",
      ownerName: isBusinessVideo ? owner?.businessName || owner?.username || "Business" : owner?.username || "Creator"
    };
  }));
}));
app.patch("/api/admin/videos/:id/review", requireAdmin, asyncRoute(async (req, res) => {
  const decision = req.body?.decision;
  const rejectionReason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!["approved", "rejected"].includes(decision)) {
    return res.status(400).json({ error: "Choose approved or rejected." });
  }
  if (decision === "rejected" && (!rejectionReason || rejectionReason.length > 500)) {
    return res.status(400).json({ error: "Enter a rejection reason of 1 to 500 characters." });
  }
  const video = await videosCollection().findOne({
    _id: req.params.id,
    deletedAt: { $exists: false },
    $or: [
      { ownerId: { $exists: true, $ne: null }, approvalStatus: "pending" },
      {
        ownerBusinessId: { $exists: true, $ne: null },
        $or: [
          { approvalStatus: "pending" },
          { approvalStatus: { $exists: false }, businessCampaignId: { $exists: false } }
        ]
      }
    ]
  });
  if (!video) return res.status(404).json({ error: "Pending creator or business video not found." });
  const isBusinessVideo = Boolean(video.ownerBusinessId);
  const ownerId = isBusinessVideo ? video.ownerBusinessId : video.ownerId;
  const currentApprovalFilter = video.approvalStatus === "pending"
    ? { approvalStatus: "pending" }
    : { approvalStatus: { $exists: false }, businessCampaignId: { $exists: false } };
  const reviewFilter = { _id: video._id, ...currentApprovalFilter };

  if (decision === "approved") {
    if (video.videoType === "short" && !video.shortValidated) return res.status(400).json({ error: "This Short must pass duration and portrait validation before approval." });
    const result = await videosCollection().updateOne(
      reviewFilter,
      {
        $set: {
          approvalStatus: "approved",
          published: !isBusinessVideo,
          ...(isBusinessVideo ? { businessCampaignStatus: "unpaid" } : {}),
          reviewedAt: new Date().toISOString()
        }
      }
    );
    if (!result.matchedCount) return res.status(409).json({ error: "This video has already been reviewed." });
  } else {
    const claim = await videosCollection().updateOne(
      reviewFilter,
      { $set: { approvalStatus: "rejection_processing", reviewedAt: new Date().toISOString() } }
    );
    if (!claim.matchedCount) return res.status(409).json({ error: "This video has already been reviewed." });
    if (video.bunnyVideoId) {
      try {
        const config = bunnyConfiguration();
        await bunnyRequest(`${config.baseUrl}/videos/${encodeURIComponent(video.bunnyVideoId)}`, config.apiKey, { method: "DELETE" });
      } catch (error) {
        try {
          await videosCollection().updateOne(
            { _id: video._id, approvalStatus: "rejection_processing" },
            { $set: { approvalStatus: "pending" }, $unset: { reviewedAt: "" } }
          );
        } catch (restoreError) {
          console.error("Failed to restore a rejected video to the review queue:", restoreError.message);
          return res.status(500).json({ error: `Video removal failed and its review state could not be restored: ${restoreError.message}` });
        }
        return res.status(502).json({ error: `Could not delete the rejected video from Bunny Stream: ${error.message}` });
      }
    }
    const result = await videosCollection().deleteOne({ _id: video._id, approvalStatus: "rejection_processing" });
    if (!result.deletedCount) return res.status(409).json({ error: "This video has already been reviewed." });
    await Promise.all([
      likesCollection().deleteMany({ videoId: video._id }),
      commentsCollection().deleteMany({ videoId: video._id }),
      uniqueViewsCollection().deleteMany({ videoId: video._id }),
      deleteShortRecords(database, video._id)
    ]);
    if (video.thumbnailImageId && ObjectId.isValid(video.thumbnailImageId)) {
      await videoThumbnailBucket().delete(new ObjectId(video.thumbnailImageId)).catch(error => {
        console.error("Failed to remove the rejected video's thumbnail:", error.message);
      });
    }
  }
  const reviewedAt = new Date().toISOString();
  await notificationsCollection().insertOne({
    recipientId: ownerId,
    type: isBusinessVideo
      ? decision === "approved" ? "business_video_approved" : "business_video_rejected"
      : decision === "approved" ? "creator_video_approved" : "creator_video_rejected",
    videoId: video._id,
    title: decision === "approved" ? "Video approved" : "Video rejected",
    message: decision === "approved"
      ? isBusinessVideo
        ? `"${video.title}" was approved. Choose a target location and complete payment to promote it.`
        : `"${video.title}" was approved and is now published.`
      : `"${video.title}" was rejected and removed. Reason: ${rejectionReason}`,
    readAt: null,
    createdAt: reviewedAt
  });
  await notificationsCollection().updateMany(
    { recipientId: "admin", type: { $in: ["creator_video_review", "business_video_review"] }, videoId: video._id, readAt: null },
    { $set: { readAt: reviewedAt } }
  );
  res.json({ id: video._id, decision, published: decision === "approved" && !isBusinessVideo, ownerType: isBusinessVideo ? "business" : "creator" });
}));
app.get("/api/creator/videos", requireCreator, asyncRoute(async (req, res) => {
  const videos = await videosCollection().find({ ownerId: req.creatorId.toString(), deletedAt: { $exists: false } }).sort({ createdAt: -1 }).toArray();
  res.json(await withCreatorProfiles(videos));
}));
app.get("/api/creator/videos/processing", requireCreator, asyncRoute(async (req, res) => {
  const pendingVideos = await videosCollection().find({
    ownerId: req.creatorId.toString(),
    deletedAt: { $exists: false },
    bunnyVideoId: { $exists: true },
    processingStatus: { $nin: ["ready", "error", "upload failed"] }
  }).toArray();
  if (!pendingVideos.length) return res.json([]);
  try {
    const config = bunnyConfiguration();
    const updates = await Promise.all(pendingVideos.map(async video => {
      const response = await bunnyRequest(`${config.baseUrl}/videos/${encodeURIComponent(video.bunnyVideoId)}`, config.apiKey);
      const bunnyVideo = await response.json();
      const processingStatus = processingState(bunnyVideo.status);
      const encodeProgress = Number(bunnyVideo.encodeProgress) || 0;
      const fields = { processingStatus, encodeProgress, durationSeconds: Number(bunnyVideo.length) || 0, ...shortProcessingFields(video, bunnyVideo, processingStatus) };
      await videosCollection().updateOne({ _id: video._id, ownerId: req.creatorId.toString() }, { $set: fields });
      return { id: video._id, ...fields };
    }));
    res.json(updates);
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
}));
app.get("/api/creator/analytics", requireCreator, asyncRoute(async (req, res) => {
  const videos = await videosCollection().find(
    { ownerId: req.creatorId.toString(), deletedAt: { $exists: false } },
    { projection: { title: 1, views: 1, published: 1, createdAt: 1 } }
  ).sort({ createdAt: -1 }).toArray();
  res.json({
    totalVideos: videos.length,
    publishedVideos: videos.filter(video => video.published).length,
    totalViews: videos.reduce((total, video) => total + Number(video.views || 0), 0),
    videos: videos.map(video => ({ id: video._id, title: video.title, views: Number(video.views || 0) }))
  });
}));
app.get("/api/creator/wallet", requireCreator, asyncRoute(async (req, res) => {
  res.json(await creatorWallet(database, req.creatorId.toString()));
}));
app.get("/api/promoter/wallet", requirePromoter, asyncRoute(async (req, res) => {
  const promoterId = req.promoterId;
  const [referredViews, watchedVideos, rewardTotals, withdrawals] = await Promise.all([
    promoterVideoWatchesCollection().countDocuments({ referredByPromoterId: promoterId }),
    promoterVideoWatchesCollection().countDocuments({ watchingPromoterId: promoterId }),
    promoterRewardsCollection().aggregate([
      { $match: { promoterId } },
      { $group: { _id: "$type", amountRupees: { $sum: "$amountRupees" }, milestones: { $sum: 1 } } }
    ]).toArray(),
    promoterWithdrawalsCollection().find({ promoterId }).sort({ createdAt: -1 }).limit(50).toArray()
  ]);
  const totals = new Map(rewardTotals.map(item => [item._id, item]));
  const earnedRupees = rewardTotals.reduce((total, item) => total + item.amountRupees, 0);
  const paidRupees = withdrawals.filter(item => item.status === "paid").reduce((total, item) => total + item.amountRupees, 0);
  const reservedRupees = withdrawals.filter(item => item.status === "pending").reduce((total, item) => total + item.amountRupees, 0);
  res.json({
    referralCode: promoterId,
    referredViews,
    referralViewsUntilReward: 1000 - referredViews % 1000,
    referralRewardMilestones: totals.get("referral_view")?.milestones || 0,
    distinctVideosWatched: watchedVideos,
    videosUntilWatchReward: 100 - watchedVideos % 100,
    watchRewardMilestones: totals.get("promoter_watch")?.milestones || 0,
    earnedRupees,
    paidRupees,
    pendingRupees: reservedRupees,
    availableRupees: Math.max(0, earnedRupees - paidRupees - reservedRupees),
    withdrawals: withdrawals.map(({ _id, promoterId: _promoterId, ...withdrawal }) => ({ id: _id.toString(), ...withdrawal }))
  });
}));
app.post("/api/promoter/withdrawals", requirePromoter, asyncRoute(async (req, res) => {
  const payoutHandle = typeof req.body?.payoutHandle === "string" ? req.body.payoutHandle.trim() : "";
  const validUpiId = /^[A-Za-z0-9._-]{2,100}@[A-Za-z][A-Za-z0-9.-]{1,30}$/.test(payoutHandle);
  const validMobile = /^[6-9]\d{9}$/.test(payoutHandle);
  if (!validUpiId && !validMobile) {
    return res.status(400).json({ error: "Enter a valid UPI ID or its 10-digit UPI-linked mobile number." });
  }
  const [rewards, withdrawals, existingRequest] = await Promise.all([
    promoterRewardsCollection().aggregate([
      { $match: { promoterId: req.promoterId } },
      { $group: { _id: null, total: { $sum: "$amountRupees" } } }
    ]).toArray(),
    promoterWithdrawalsCollection().find({ promoterId: req.promoterId, status: { $in: ["pending", "paid"] } }).toArray(),
    promoterWithdrawalsCollection().findOne({ promoterId: req.promoterId, status: "pending" })
  ]);
  if (existingRequest) return res.status(409).json({ error: "You already have a withdrawal request awaiting admin review." });
  const earnedRupees = rewards[0]?.total || 0;
  const committedRupees = withdrawals.reduce((total, withdrawal) => total + withdrawal.amountRupees, 0);
  const availableRupees = earnedRupees - committedRupees;
  if (availableRupees < 100) return res.status(400).json({ error: "At least ₹100 must be available before you can request a withdrawal." });
  const createdAt = new Date().toISOString();
  const withdrawal = {
    promoterId: req.promoterId,
    username: req.session.username,
    amountRupees: availableRupees,
    payoutHandle,
    status: "pending",
    createdAt
  };
  let result;
  try {
    result = await promoterWithdrawalsCollection().insertOne(withdrawal);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "You already have a withdrawal request awaiting admin review." });
    throw error;
  }
  await notificationsCollection().insertMany([
    {
      recipientId: req.promoterId,
      type: "promoter_withdrawal_requested",
      title: "Withdrawal request submitted",
      message: `Your ₹${availableRupees} withdrawal request is waiting for admin review.`,
      readAt: null,
      createdAt
    },
    {
      recipientId: "admin",
      type: "promoter_withdrawal_review",
      withdrawalId: result.insertedId.toString(),
      promoterId: req.promoterId,
      title: "Promoter withdrawal needs review",
      message: `${req.session.username} requested a ₹${availableRupees} payout.`,
      readAt: null,
      createdAt
    }
  ]);
  res.status(201).json({ id: result.insertedId.toString(), ...withdrawal, availableRupees: 0 });
}));
app.get("/api/admin/promoter-withdrawals", requireAdmin, asyncRoute(async (_req, res) => {
  const withdrawals = await promoterWithdrawalsCollection().find({ status: "pending" }).sort({ createdAt: 1 }).toArray();
  const promoterIds = [...new Set(withdrawals.map(item => item.promoterId).filter(ObjectId.isValid))];
  const promoters = promoterIds.length
    ? await usersCollection().find({ _id: { $in: promoterIds.map(id => new ObjectId(id)) } }, { projection: { username: 1 } }).toArray()
    : [];
  const usernames = new Map(promoters.map(promoter => [promoter._id.toString(), promoter.username]));
  res.json(withdrawals.map(({ _id, promoterId, ...withdrawal }) => ({
    id: _id.toString(),
    promoterId,
    username: usernames.get(promoterId) || withdrawal.username || "Promoter",
    ...withdrawal
  })));
}));
app.patch("/api/admin/promoter-withdrawals/:id", requireAdmin, asyncRoute(async (req, res) => {
  const decision = req.body?.decision;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!["paid", "rejected"].includes(decision)) return res.status(400).json({ error: "Choose paid or rejected." });
  if (decision === "rejected" && (!reason || reason.length > 500)) {
    return res.status(400).json({ error: "Enter a rejection reason of 1 to 500 characters." });
  }
  if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Withdrawal request not found." });
  const withdrawalId = new ObjectId(req.params.id);
  const reviewedAt = new Date().toISOString();
  const withdrawal = await promoterWithdrawalsCollection().findOneAndUpdate(
    { _id: withdrawalId, status: "pending" },
    { $set: { status: decision, reviewedAt, ...(decision === "paid" ? { paidAt: reviewedAt } : { rejectionReason: reason }) } },
    { returnDocument: "after" }
  );
  if (!withdrawal) return res.status(404).json({ error: "Pending withdrawal request not found." });
  await notificationsCollection().insertOne({
    recipientId: withdrawal.promoterId,
    type: decision === "paid" ? "promoter_withdrawal_paid" : "promoter_withdrawal_rejected",
    title: decision === "paid" ? "Withdrawal marked paid" : "Withdrawal request rejected",
    message: decision === "paid"
      ? `Your ₹${withdrawal.amountRupees} withdrawal was marked as paid by the administrator.`
      : `Your ₹${withdrawal.amountRupees} withdrawal was rejected. Reason: ${reason}`,
    readAt: null,
    createdAt: reviewedAt
  });
  await notificationsCollection().updateMany(
    { recipientId: "admin", type: "promoter_withdrawal_review", withdrawalId: withdrawalId.toString(), readAt: null },
    { $set: { readAt: reviewedAt } }
  );
  res.json({ id: withdrawalId.toString(), status: decision });
}));
app.get("/api/admin/videos/processing", requireAdmin, asyncRoute(async (_req, res) => {
  const pendingVideos = await videosCollection().find({
    deletedAt: { $exists: false },
    bunnyVideoId: { $exists: true },
    processingStatus: { $nin: ["ready", "error", "upload failed"] }
  }).toArray();
  if (!pendingVideos.length) return res.json([]);
  let config;
  try {
    config = bunnyConfiguration();
    const updates = await Promise.all(pendingVideos.map(async video => {
      const response = await bunnyRequest(`${config.baseUrl}/videos/${encodeURIComponent(video.bunnyVideoId)}`, config.apiKey);
      const bunnyVideo = await response.json();
      const processingStatus = processingState(bunnyVideo.status);
      const encodeProgress = Number(bunnyVideo.encodeProgress) || 0;
      const fields = { processingStatus, encodeProgress, durationSeconds: Number(bunnyVideo.length) || 0, ...shortProcessingFields(video, bunnyVideo, processingStatus) };
      await videosCollection().updateOne(
        { _id: video._id },
        { $set: fields }
      );
      return { id: video._id, ...fields };
    }));
    res.json(updates);
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
}));
app.post("/api/admin/videos", requireAdmin, asyncRoute(async (req, res) => {
  const { title, description = "", categoryId = "", thumbnailUrl = "", playbackUrl = "", durationSeconds = 0, featured = false, published = false } = req.body || {};
  if (!String(title || "").trim()) return res.status(400).json({ error: "Title is required" });
  const collection = normalizeVideoCollection(req.body || {});
  if (collection.error) return res.status(400).json({ error: collection.error });
  const targetCity = normalizeVideoTargetCity(req.body || {});
  if (targetCity.error) return res.status(400).json({ error: targetCity.error });
  const video = { _id: randomUUID(), title: String(title).trim(), description, categoryId, ...collection.fields, ...targetCity.fields, thumbnailUrl, playbackUrl, durationSeconds: Number(durationSeconds) || 0, featured: Boolean(featured), published: Boolean(published), views: 0, createdAt: new Date().toISOString() };
  await videosCollection().insertOne(video);
  res.status(201).json(safeVideo(video));
}));
app.patch("/api/creator/videos/:id", requireCreator, asyncRoute(async (req, res) => {
  const video = await videosCollection().findOne({ _id: req.params.id, ownerId: req.creatorId.toString(), deletedAt: { $exists: false } });
  if (!video) return res.status(404).json({ error: "Video not found" });
  const { title, description, categoryId, promotionUrl, promotionType } = req.body || {};
  const hasCollectionFields = ["collectionName", "collectionType", "episodeNumber"].some(field => Object.hasOwn(req.body || {}, field));
  const hasTargetCity = Object.hasOwn(req.body || {}, "targetCity");
  const collection = hasCollectionFields ? normalizeVideoCollection(req.body || {}) : { fields: {} };
  const targetCity = hasTargetCity ? normalizeVideoTargetCity(req.body || {}) : { fields: {} };
  if (collection.error) return res.status(400).json({ error: collection.error });
  if (targetCity.error) return res.status(400).json({ error: targetCity.error });
  if (title !== undefined && (typeof title !== "string" || !title.trim())) {
    return res.status(400).json({ error: "Title is required." });
  }
  if (description !== undefined && typeof description !== "string") {
    return res.status(400).json({ error: "Description must be text." });
  }
  if (video.videoType === "short" && description !== undefined && (!description.trim() || description.length > 2000)) {
    return res.status(400).json({ error: "Simply captions must be 1 to 2000 characters." });
  }
  if (categoryId !== undefined && (typeof categoryId !== "string" || (categoryId && !categories.some(category => category.id === categoryId)))) {
    return res.status(400).json({ error: "Choose a valid category." });
  }
  if (promotionUrl !== undefined) {
    if (typeof promotionUrl !== "string") return res.status(400).json({ error: "Enter a valid product, service, or course URL." });
    if (promotionUrl.trim()) {
      let parsedUrl;
      try { parsedUrl = new URL(promotionUrl.trim()); }
      catch { return res.status(400).json({ error: "Enter a valid product, service, or course URL." }); }
      if (promotionUrl.trim().length > 2048 || parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) {
        return res.status(400).json({ error: "Use an HTTPS product, service, or course URL without embedded credentials." });
      }
    }
  }
  if (promotionUrl?.trim() && promotionType === undefined) {
    return res.status(400).json({ error: "Choose Product, Service, or Course for the link type." });
  }
  if (promotionType !== undefined && !["product", "service", "course"].includes(promotionType)) {
    return res.status(400).json({ error: "Choose Product, Service, or Course for the link type." });
  }
  if (video.bunnyVideoId && title !== undefined && title.trim() !== video.title) {
    try {
      const config = bunnyConfiguration();
      await bunnyRequest(`${config.baseUrl}/videos/${encodeURIComponent(video.bunnyVideoId)}`, config.apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() })
      });
    } catch (error) {
      return res.status(502).json({ error: error.message });
    }
  }
  const updates = {};
  if (title !== undefined) updates.title = title.trim();
  if (description !== undefined) updates.description = description;
  if (video.videoType === "short" && description !== undefined) updates.caption = description.trim();
  if (categoryId !== undefined) updates.categoryId = categoryId;
  if (promotionUrl !== undefined) updates.promotionUrl = promotionUrl.trim();
  if (promotionType !== undefined) updates.promotionType = promotionType;
  Object.assign(updates, collection.fields);
  Object.assign(updates, targetCity.fields);
  if (Object.keys(updates).length) {
    await videosCollection().updateOne(
      { _id: video._id, ownerId: req.creatorId.toString() },
      { $set: updates }
    );
  }
  res.json(safeVideo({ ...video, ...updates }));
}));
app.patch("/api/admin/videos/:id", requireAdmin, asyncRoute(async (req, res) => {
  const video = await videosCollection().findOne({ _id: req.params.id, deletedAt: { $exists: false } });
  if (!video) return res.status(404).json({ error: "Video not found" });
  const { title, description, categoryId, thumbnailUrl, playbackUrl, durationSeconds, featured, published } = req.body || {};
  const hasCollectionFields = ["collectionName", "collectionType", "episodeNumber"].some(field => Object.hasOwn(req.body || {}, field));
  const hasTargetCity = Object.hasOwn(req.body || {}, "targetCity");
  const collection = hasCollectionFields ? normalizeVideoCollection(req.body || {}) : { fields: {} };
  const targetCity = hasTargetCity ? normalizeVideoTargetCity(req.body || {}) : { fields: {} };
  if (collection.error) return res.status(400).json({ error: collection.error });
  if (targetCity.error) return res.status(400).json({ error: targetCity.error });
  if (video.approvalStatus === "pending" && published !== undefined && Boolean(published)) {
    return res.status(409).json({ error: "Review this submission before publishing it." });
  }
  if (video.ownerBusinessId && published === true && video.businessCampaignStatus !== "active") {
    return res.status(409).json({ error: "Business videos can only be published after admin approval and verified promotion payment." });
  }
  if (title !== undefined && !String(title).trim()) return res.status(400).json({ error: "Title is required" });
  if (categoryId !== undefined && categoryId && !categories.some(category => category.id === categoryId)) {
    return res.status(400).json({ error: "Choose a valid category" });
  }
  if (video.bunnyVideoId && title !== undefined && String(title).trim() !== video.title) {
    try {
      const config = bunnyConfiguration();
      await bunnyRequest(`${config.baseUrl}/videos/${encodeURIComponent(video.bunnyVideoId)}`, config.apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: String(title).trim() })
      });
    } catch (error) {
      return res.status(502).json({ error: error.message });
    }
  }
  const updates = {};
  if (title !== undefined) updates.title = String(title).trim();
  if (description !== undefined) updates.description = description;
  if (categoryId !== undefined) updates.categoryId = categoryId;
  if (thumbnailUrl !== undefined) updates.thumbnailUrl = thumbnailUrl;
  if (playbackUrl !== undefined) updates.playbackUrl = playbackUrl;
  if (durationSeconds !== undefined) updates.durationSeconds = Number(durationSeconds) || 0;
  if (featured !== undefined) updates.featured = Boolean(featured);
  if (published !== undefined) updates.published = Boolean(published);
  Object.assign(updates, collection.fields);
  Object.assign(updates, targetCity.fields);
  if (Object.keys(updates).length) await videosCollection().updateOne({ _id: video._id }, { $set: updates });
  res.json(safeVideo({ ...video, ...updates }));
}));
app.delete("/api/admin/videos/:id", requireAdmin, asyncRoute(async (req, res) => {
  const video = await videosCollection().findOne({ _id: req.params.id });
  if (!video) return res.status(404).json({ error: "Video not found" });
  if (video.ownerId && !video.ownerBusinessId) {
    await softDeleteCreatorVideo(database, video);
    if (!video.mediaDeletedAt) {
      await deleteCreatorMedia(video);
      await videosCollection().updateOne({ _id: video._id }, { $set: { mediaDeletedAt: new Date().toISOString() } });
    }
    return res.status(204).end();
  }
  if (video.bunnyVideoId) {
    try {
      const config = bunnyConfiguration();
      await bunnyRequest(`${config.baseUrl}/videos/${encodeURIComponent(video.bunnyVideoId)}`, config.apiKey, { method: "DELETE" });
    } catch (error) {
      return res.status(502).json({ error: error.message });
    }
  }
  await videosCollection().deleteOne({ _id: video._id });
  await Promise.all([
    likesCollection().deleteMany({ videoId: video._id }),
    commentsCollection().deleteMany({ videoId: video._id }),
    uniqueViewsCollection().deleteMany({ videoId: video._id }),
    deleteShortRecords(database, video._id)
  ]);
  if (video.thumbnailImageId && ObjectId.isValid(video.thumbnailImageId)) {
    await videoThumbnailBucket().delete(new ObjectId(video.thumbnailImageId)).catch(error => {
      console.error("Failed to remove the deleted video's thumbnail:", error.message);
    });
  }
  res.status(204).end();
}));
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
  console.error("Admin login is disabled: set ADMIN_USERNAME and ADMIN_PASSWORD in server/.env.");
}

app.use((error, _req, res, next) => {
  console.error("API request failed:", error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: "The API could not complete the request. Check the server logs." });
});

async function start() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required. Configure MongoDB before starting the API.");

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  database = client.db(process.env.MONGODB_DATABASE || "zinda_play");
  await initializeMemberships(database);
  await initializeBusinessAds(database);
  await initializeShorts(database);
  await initializeCreatorAds(database);

  await database.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  for (const saved of await database.collection("sessions").find({ expiresAt: { $gt: new Date() } }).toArray()) {
    sessionCache.set(saved.token, { username: saved.username, role: saved.role, userId: saved.userId });
  }
  await usersCollection().createIndex({ usernameKey: 1 }, { unique: true });
  await likesCollection().createIndex({ videoId: 1, userId: 1 }, { unique: true });
  await commentsCollection().createIndex({ videoId: 1, createdAt: -1 });
  await creatorFollowsCollection().createIndex({ creatorId: 1, followerId: 1 }, { unique: true });
  await creatorFollowsCollection().createIndex({ creatorId: 1 });
  await uniqueViewsCollection().createIndex({ videoId: 1, ipHash: 1 }, { unique: true });
  const categoryCollection = categoriesCollection();
  await categoryCollection.createIndex({ name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
  await notificationsCollection().createIndex({ recipientId: 1, createdAt: -1 });
  await invitationsCollection().createIndex(
    { businessId: 1, creatorId: 1 },
    { unique: true, partialFilterExpression: { status: "pending" } }
  );
  await adminChatsCollection().createIndex({ creatorId: 1, createdAt: 1 });
  await creatorOrdersCollection().createIndex({ orderId: 1 }, { unique: true });
  await creatorRequestsCollection().createIndex(
    { businessId: 1, creatorId: 1 },
    { unique: true, partialFilterExpression: { status: "pending" } }
  );
  await businessCampaignsCollection().createIndex({ videoId: 1 }, { unique: true });
  await businessCampaignsCollection().createIndex({ orderId: 1 }, { unique: true });
  await promoterRewardsCollection().createIndex({ sourceKey: 1 }, { unique: true });
  await promoterRewardsCollection().createIndex({ promoterId: 1, createdAt: -1 });
  await promoterVideoWatchesCollection().createIndex({ viewerId: 1, videoId: 1 }, { unique: true });
  await promoterVideoWatchesCollection().createIndex({ referredByPromoterId: 1 });
  await promoterVideoWatchesCollection().createIndex({ watchingPromoterId: 1 });
  await promoterWatchSessionsCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await promoterWithdrawalsCollection().createIndex(
    { promoterId: 1 },
    { unique: true, partialFilterExpression: { status: "pending" } }
  );
  await categoryCollection.bulkWrite(defaultCategories.map(category => ({
    updateOne: {
      filter: { _id: category.id },
      update: { $setOnInsert: { name: category.name, slug: category.slug } },
      upsert: true
    }
  })));
  await videosCollection().createIndex({ published: 1, processingStatus: 1, createdAt: -1 });
  await bannerCollection().updateOne(
    { _id: defaultBanner._id },
    { $setOnInsert: defaultBanner },
    { upsert: true }
  );

  categories = (await categoryCollection.find().toArray()).map(({ _id, ...category }) => ({
    id: _id,
    ...category
  }));
  app.listen(port, () => console.log(`Zinda Play API connected to MongoDB and listening on port ${port}`));
}

start().catch(error => {
  console.error("Failed to start Zinda Play API:", error);
  process.exit(1);
});
