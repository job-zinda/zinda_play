import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { GridFSBucket, MongoClient, ObjectId } from "mongodb";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });
const app = express();
const port = process.env.PORT || 4000;
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json());
const maxVideoUploadBytes = 2 * 1024 * 1024 * 1024;

const defaultCategories = [
  { id: "cat-learning", name: "Learning", slug: "learning" },
  { id: "cat-entertainment", name: "Entertainment", slug: "entertainment" },
  { id: "cat-films", name: "Short Films", slug: "short-films" }
];
let database;
let categories = [];
const adminSessions = new Set();
const videosCollection = () => database.collection("videos");
const categoriesCollection = () => database.collection("categories");
const bannerCollection = () => database.collection("siteContent");
const bannerImageBucket = () => new GridFSBucket(database, { bucketName: "bannerImages" });
const videoThumbnailBucket = () => new GridFSBucket(database, { bucketName: "videoThumbnails" });
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
  if (!token || !adminSessions.has(token)) return res.status(401).json({ error: "Admin authentication required" });
  next();
}

const safeVideo = ({ _id, thumbnailImageId, ...video }) => ({
  ...video,
  id: _id,
  thumbnailUrl: thumbnailImageId ? `/videos/thumbnail/${thumbnailImageId}` : video.thumbnailUrl || "",
  category: categories.find(category => category.id === video.categoryId) || null
});
function publicBannerSettings(banner) {
  const { _id, imageId, imageUrl: legacyImageUrl = "", ...settings } = banner;
  return {
    ...settings,
    imageUrl: imageId ? `/banner/image/${imageId}` : legacyImageUrl
  };
}
const publicVideoQuery = {
  published: true,
  $or: [{ bunnyVideoId: { $exists: false } }, { processingStatus: "ready" }]
};
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
    throw new Error(`Bunny Stream request failed (${response.status})${details ? `: ${details.slice(0, 500)}` : ""}`);
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
  res.set({
    "Content-Type": file.metadata?.contentType || "application/octet-stream",
    "Content-Length": file.length,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff"
  });
  await pipeline(bucket.openDownloadStream(fileId), res);
}));
app.get("/api/categories", (_req, res) => res.json(categories));
app.get("/api/videos", asyncRoute(async (req, res) => {
  const q = String(req.query.search || "").toLowerCase();
  const category = String(req.query.category || "");
  const featured = req.query.featured === "true";
  const query = { ...publicVideoQuery };
  if (category) query.categoryId = category;
  if (featured) query.featured = true;
  if (q) {
    const escapedQuery = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.$and = [{
      $or: [
        { title: { $regex: escapedQuery, $options: "i" } },
        { description: { $regex: escapedQuery, $options: "i" } }
      ]
    }];
  }
  const result = await videosCollection().find(query).sort({ createdAt: -1 }).toArray();
  res.json(result.map(safeVideo));
}));
app.get("/api/videos/:id", asyncRoute(async (req, res) => {
  const video = await videosCollection().findOne({ _id: req.params.id, ...publicVideoQuery });
  if (!video) return res.status(404).json({ error: "Video not found" });
  res.json(safeVideo(video));
}));
app.post("/api/videos/:id/view", asyncRoute(async (req, res) => {
  const result = await videosCollection().updateOne(
    { _id: req.params.id, ...publicVideoQuery },
    { $inc: { views: 1 } },
  );
  if (!result.matchedCount) return res.status(404).json({ error: "Video not found" });
  const video = await videosCollection().findOne({ _id: req.params.id });
  res.json({ views: video.views });
}));
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
  const token = randomBytes(32).toString("hex");
  adminSessions.add(token);
  res.json({ token });
});
app.post("/api/admin/logout", requireAdmin, (req, res) => {
  const token = req.get("authorization").replace(/^Bearer\s+/i, "");
  adminSessions.delete(token);
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
app.put("/api/admin/videos/:id/thumbnail", requireAdmin, asyncRoute(async (req, res) => {
  const video = await videosCollection().findOne({ _id: req.params.id });
  if (!video) return res.status(404).json({ error: "Video not found" });

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
}));
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
app.post("/api/admin/videos/upload", requireAdmin, asyncRoute(async (req, res) => {
  const title = String(req.get("X-Video-Title") || "").trim();
  const description = String(req.get("X-Video-Description") || "");
  const categoryId = String(req.get("X-Video-Category") || "");
  const contentType = String(req.get("Content-Type") || "").split(";")[0].toLowerCase();
  const allowedTypes = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/x-msvideo", "video/x-ms-wmv", "video/mpeg", "video/3gpp", "video/x-m4v"]);
  const size = Number(req.get("Content-Length") || req.get("X-Upload-Size") || 0);
  if (!title) return res.status(400).json({ error: "Video title is required" });
  if (!allowedTypes.has(contentType)) return res.status(415).json({ error: "Choose a supported video file (MP4, MOV, WebM, MKV, AVI, WMV, MPEG, or 3GP)." });
  if (!size) return res.status(411).json({ error: "The upload must include a file size." });
  if (size > maxVideoUploadBytes) return res.status(413).json({ error: "Video uploads are limited to 2 GB." });
  if (categoryId && !categories.some(category => category.id === categoryId)) {
    return res.status(400).json({ error: "Choose a valid category" });
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
    thumbnailUrl: "",
    playbackUrl: `https://iframe.mediadelivery.net/embed/${config.libraryId}/${bunnyVideo.guid}`,
    durationSeconds: 0,
    featured: req.get("X-Video-Featured") === "true",
    published: req.get("X-Video-Published") === "true",
    views: 0,
    bunnyVideoId: bunnyVideo.guid,
    processingStatus: "uploaded",
    encodeProgress: 0,
    createdAt: new Date().toISOString()
  };
  await videosCollection().insertOne(video);
  res.status(201).json(safeVideo(video));
}));
app.get("/api/admin/videos", requireAdmin, asyncRoute(async (_req, res) => {
  const videos = await videosCollection().find().sort({ createdAt: -1 }).toArray();
  res.json(videos.map(safeVideo));
}));
app.get("/api/admin/videos/processing", requireAdmin, asyncRoute(async (_req, res) => {
  const pendingVideos = await videosCollection().find({
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
      await videosCollection().updateOne(
        { _id: video._id },
        { $set: { processingStatus, encodeProgress } }
      );
      return { id: video._id, processingStatus, encodeProgress };
    }));
    res.json(updates);
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
}));
app.post("/api/admin/videos", requireAdmin, asyncRoute(async (req, res) => {
  const { title, description = "", categoryId = "", thumbnailUrl = "", playbackUrl = "", durationSeconds = 0, featured = false, published = false } = req.body || {};
  if (!String(title || "").trim()) return res.status(400).json({ error: "Title is required" });
  const video = { _id: randomUUID(), title: String(title).trim(), description, categoryId, thumbnailUrl, playbackUrl, durationSeconds: Number(durationSeconds) || 0, featured: Boolean(featured), published: Boolean(published), views: 0, createdAt: new Date().toISOString() };
  await videosCollection().insertOne(video);
  res.status(201).json(safeVideo(video));
}));
app.patch("/api/admin/videos/:id", requireAdmin, asyncRoute(async (req, res) => {
  const video = await videosCollection().findOne({ _id: req.params.id });
  if (!video) return res.status(404).json({ error: "Video not found" });
  const { title, description, categoryId, thumbnailUrl, playbackUrl, durationSeconds, featured, published } = req.body || {};
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
  if (Object.keys(updates).length) await videosCollection().updateOne({ _id: video._id }, { $set: updates });
  res.json(safeVideo({ ...video, ...updates }));
}));
app.delete("/api/admin/videos/:id", requireAdmin, asyncRoute(async (req, res) => {
  const video = await videosCollection().findOne({ _id: req.params.id });
  if (!video) return res.status(404).json({ error: "Video not found" });
  if (video.bunnyVideoId) {
    try {
      const config = bunnyConfiguration();
      await bunnyRequest(`${config.baseUrl}/videos/${encodeURIComponent(video.bunnyVideoId)}`, config.apiKey, { method: "DELETE" });
    } catch (error) {
      return res.status(502).json({ error: error.message });
    }
  }
  await videosCollection().deleteOne({ _id: video._id });
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

  const categoryCollection = categoriesCollection();
  await categoryCollection.createIndex({ name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
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
