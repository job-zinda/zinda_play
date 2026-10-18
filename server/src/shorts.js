import { createHmac, timingSafeEqual } from "node:crypto";
import { ObjectId } from "mongodb";
import { SIMPLY_EARNING_MILLI_RUPEES } from "./creator-wallet.js";

export const maxShortBytes = 150 * 1024 * 1024;
export function shortMetadata(source) {
  const durationSeconds = Number(source.length ?? source.durationSeconds);
  let width = Number(source.width);
  let height = Number(source.height);
  if (Number(source.rotation) % 180 !== 0 && Number.isFinite(Number(source.rotation))) [width, height] = [height, width];
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 60) return { error: "Simply videos must be longer than 0 and no longer than 60 seconds." };
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= width || Math.abs(width / height - 9 / 16) > 0.04) {
    return { error: "Simply videos must be portrait videos close to a 9:16 aspect ratio." };
  }
  return { fields: { durationSeconds, width, height } };
}

export function shortUpload(req) {
  if (req.get("X-Video-Type") !== "short") return { fields: {} };
  if (!["video/mp4", "video/quicktime", "video/webm"].includes(req.get("Content-Type")?.split(";")[0])) return { error: "Simply supports MP4, MOV or WebM." };
  if (Number(req.get("Content-Length") || req.get("X-Upload-Size")) > maxShortBytes) return { error: "Simply uploads are limited to 150 MB." };
  const metadata = shortMetadata({
    durationSeconds: req.get("X-Video-Duration"), width: req.get("X-Video-Width"), height: req.get("X-Video-Height")
  });
  if (metadata.error) return metadata;
  let caption;
  let hashtags;
  try {
    caption = decodeURIComponent(req.get("X-Short-Caption") || "");
    hashtags = JSON.parse(decodeURIComponent(req.get("X-Short-Hashtags") || "[]"));
  } catch {
    return { error: "Invalid Simply caption or hashtags encoding." };
  }
  if (!caption.trim() || caption.length > 2000) return { error: "Enter a caption of 1 to 2000 characters." };
  if (!Array.isArray(hashtags) || hashtags.length > 10 || hashtags.some(tag => typeof tag !== "string" || !/^[\p{L}\p{N}_]{1,30}$/u.test(tag))) {
    return { error: "Use up to 10 hashtags of 1 to 30 letters, numbers or underscores." };
  }
  return { fields: { videoType: "short", caption: caption.trim(), hashtags: [...new Set(hashtags)], shortValidated: false } };
}

export function shortProcessingFields(video, bunnyVideo, processingStatus) {
  if (video.videoType !== "short") return {};
  if (processingStatus !== "ready") return {};
  const metadata = shortMetadata(bunnyVideo);
  return metadata.error
    ? { shortValidated: false, processingStatus: "error", shortValidationError: metadata.error }
    : { ...metadata.fields, shortValidated: true, shortValidationError: "" };
}

export function shortsCdnOrigin() {
  const raw = process.env.BUNNY_STREAM_CDN_HOSTNAME;
  if (!raw) throw new Error("Configure BUNNY_STREAM_CDN_HOSTNAME for native Simply playback.");
  const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("BUNNY_STREAM_CDN_HOSTNAME must be an HTTPS CDN hostname without a path.");
  }
  return url.origin;
}

export async function initializeShorts(db) {
  await db.collection("videos").createIndex({ videoType: 1, published: 1, shortValidated: 1, createdAt: -1, _id: -1 });
  for (const name of ["savedShorts", "shortReports"]) {
    await db.collection(name).createIndex({ userId: 1, videoId: 1 }, { unique: true });
  }
  await db.collection("savedShorts").createIndex({ userId: 1, _id: -1 });
  await db.collection("shortViews").createIndex({ videoId: 1, viewerHash: 1 }, { unique: true });
  await db.collection("shortViews").createIndex({ creatorId: 1, videoId: 1, earningMilliRupees: 1 });
  await db.collection("shortRateLimits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

export async function deleteShortRecords(db, videoId) {
  await Promise.all(["savedShorts", "shortReports", "shortViews"].map(name => db.collection(name).deleteMany({ videoId })));
}

export function registerShortRoutes(app, {
  getDb, asyncRoute, requireAccount, requireAdmin, publicVideoQuery, availableInCity,
  withCreatorProfiles, sessionFor, cdnOrigin = shortsCdnOrigin, now = () => Date.now()
}) {
  const db = () => getDb();
  const query = () => ({ ...publicVideoQuery, videoType: "short", shortValidated: true, ownerBusinessId: { $exists: false } });
  const secret = () => {
    const value = process.env.VIEW_IP_HASH_SECRET || process.env.ADMIN_PASSWORD;
    if (!value) throw new Error("Configure VIEW_IP_HASH_SECRET for Simply views.");
    return value;
  };
  const viewerHash = req => {
    if (!req.ip) throw new Error("Cannot determine viewer IP for Simply.");
    return createHmac("sha256", secret()).update(req.ip).digest("hex");
  };
  async function find(req, res) {
    const video = await db().collection("videos").findOne({ ...query(), _id: req.params.id });
    if (!video || !await availableInCity(video, req)) {
      res.status(404).json({ error: "Simply video not found." });
      return null;
    }
    return video;
  }
  async function serialize(videos) {
    if (!videos.length) return [];
    const origin = cdnOrigin();
    return (await withCreatorProfiles(videos)).map(video => ({
      ...video, streamUrl: `${origin}/${encodeURIComponent(video.bunnyVideoId)}/playlist.m3u8`,
      thumbnailUrl: video.thumbnailUrl || `${origin}/${encodeURIComponent(video.bunnyVideoId)}/thumbnail.jpg`
    }));
  }
  app.get("/api/shorts", asyncRoute(async (req, res) => {
    const limit = Number(req.query.limit || 6);
    if (!Number.isInteger(limit) || limit < 1 || limit > 12) return res.status(400).json({ error: "Simply page size must be 1 to 12." });
    let cursor;
    if (req.query.cursor) {
      try {
        cursor = JSON.parse(Buffer.from(String(req.query.cursor), "base64url").toString());
        if (typeof cursor.id !== "string" || cursor.id.length > 64 || typeof cursor.at !== "string" || new Date(cursor.at).toISOString() !== cursor.at) throw new Error("Invalid cursor");
      } catch {
        return res.status(400).json({ error: "Invalid Simply cursor." });
      }
    }
    const filter = query();
    if (cursor) filter.$and = [...(filter.$and || []), { $or: [
      { createdAt: { $lt: cursor.at } }, { createdAt: cursor.at, _id: { $lt: cursor.id } }
    ] }];
    // Scan a bounded page even when location filtering removes every result.
    const scanned = await db().collection("videos").find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).toArray();
    const page = scanned.slice(0, limit);
    const visible = [];
    for (const video of page) if (await availableInCity(video, req)) visible.push(video);
    const last = page.at(-1);
    const nextCursor = scanned.length > limit ? Buffer.from(JSON.stringify({ at: last.createdAt, id: last._id })).toString("base64url") : null;
    res.json({ items: await serialize(visible), nextCursor });
  }));
  app.get("/api/shorts/saved", requireAccount, asyncRoute(async (req, res) => {
    const before = String(req.query.before || "");
    if (before && !/^[a-f\d]{24}$/i.test(before)) return res.status(400).json({ error: "Invalid saved Simply cursor." });
    const rows = await db().collection("savedShorts").find({
      userId: req.session.userId, ...(before ? { _id: { $lt: new ObjectId(before) } } : {})
    }).sort({ _id: -1 }).limit(13).toArray();
    const page = rows.slice(0, 12);
    const videos = [];
    for (const row of page) {
      const video = await db().collection("videos").findOne({ ...query(), _id: row.videoId });
      if (video && await availableInCity(video, req)) videos.push(video);
    }
    res.json({ items: await serialize(videos), nextCursor: rows.length > 12 ? page.at(-1)._id.toString() : null });
  }));
  app.get("/api/shorts/:id/state", requireAccount, asyncRoute(async (req, res) => {
    if (!await find(req, res)) return;
    const saved = await db().collection("savedShorts").findOne({ userId: req.session.userId, videoId: req.params.id });
    res.json({ saved: Boolean(saved) });
  }));
  app.get("/api/shorts/:id", asyncRoute(async (req, res) => {
    const video = await find(req, res);
    if (video) res.json((await serialize([video]))[0]);
  }));
  app.put("/api/shorts/:id/saved", requireAccount, asyncRoute(async (req, res) => {
    if (!await find(req, res)) return;
    await db().collection("savedShorts").updateOne({ userId: req.session.userId, videoId: req.params.id },
      { $setOnInsert: { createdAt: new Date(now()).toISOString() } }, { upsert: true });
    res.json({ saved: true });
  }));
  app.delete("/api/shorts/:id/saved", requireAccount, asyncRoute(async (req, res) => {
    if (!await find(req, res)) return;
    await db().collection("savedShorts").deleteOne({ userId: req.session.userId, videoId: req.params.id });
    res.json({ saved: false });
  }));
  async function rate(req, kind, maximum) {
    const identity = req.session?.userId || viewerHash(req);
    const bucket = Math.floor(now() / 60000);
    const result = await db().collection("shortRateLimits").findOneAndUpdate(
      { _id: `${kind}:${identity}:${bucket}` },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(now() + 120000) } },
      { upsert: true, returnDocument: "after" }
    );
    return result.count <= maximum;
  }
  app.post("/api/shorts/:id/report", requireAccount, asyncRoute(async (req, res) => {
    const video = await find(req, res);
    if (!video) return;
    const reason = req.body?.reason;
    if (!["spam", "harassment", "inappropriate", "copyright", "other"].includes(reason)) return res.status(400).json({ error: "Choose a valid report reason." });
    if (!await rate(req, "report", 10)) return res.status(429).json({ error: "Too many reports. Try again in a minute." });
    await db().collection("shortReports").updateOne({ userId: req.session.userId, videoId: video._id },
      { $setOnInsert: { reason, status: "pending", createdAt: new Date(now()).toISOString() } }, { upsert: true });
    await db().collection("notifications").updateOne({ recipientId: "admin", type: "short_report", videoId: video._id, reporterId: req.session.userId },
      { $setOnInsert: { title: "Simply reported", message: `${req.session.username} reported "${video.title}": ${reason}. Review the video in Admin content.`, readAt: null, createdAt: new Date(now()).toISOString() } },
      { upsert: true });
    res.json({ reported: true });
  }));
  app.get("/api/admin/shorts/reports", requireAdmin, asyncRoute(async (_req, res) => {
    const rows = await db().collection("shortReports").find({ status: "pending" }).sort({ createdAt: -1 }).limit(100).toArray();
    res.json(rows.map(({ _id, ...row }) => ({ id: _id.toString(), ...row })));
  }));
  app.patch("/api/admin/shorts/reports/:id", requireAdmin, asyncRoute(async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Report not found." });
    const action = req.body?.action;
    if (!["dismiss", "unpublish"].includes(action)) return res.status(400).json({ error: "Choose dismiss or unpublish." });
    const report = await db().collection("shortReports").findOne({ _id: new ObjectId(req.params.id) });
    if (!report) return res.status(404).json({ error: "Report not found." });
    if (action === "unpublish") await db().collection("videos").updateOne({ _id: report.videoId, videoType: "short" }, { $set: { published: false } });
    await db().collection("shortReports").updateOne({ _id: report._id }, { $set: { status: action === "dismiss" ? "dismissed" : "unpublished", reviewedAt: new Date(now()).toISOString() } });
    res.json({ reviewed: true });
  }));
  app.post("/api/shorts/:id/view-start", asyncRoute(async (req, res) => {
    const video = await find(req, res);
    if (!video) return;
    if (!await rate(req, "view", 30)) return res.status(429).json({ error: "Too many view requests. Try again in a minute." });
    const payload = Buffer.from(JSON.stringify({ id: video._id, viewer: viewerHash(req), at: now() })).toString("base64url");
    const signature = createHmac("sha256", secret()).update(payload).digest("hex");
    res.json({ ticket: `${payload}.${signature}`, minimumWatchMs: Math.min(3000, video.durationSeconds * 1000) });
  }));
  app.post("/api/shorts/:id/view", asyncRoute(async (req, res) => {
    const video = await find(req, res);
    if (!video) return;
    const ticket = req.body?.ticket;
    if (typeof ticket !== "string" || ticket.length > 1024) return res.status(400).json({ error: "A valid view ticket is required." });
    const [payload, signature, extra] = ticket.split(".");
    const expected = createHmac("sha256", secret()).update(payload || "").digest("hex");
    if (extra || !/^[a-f\d]{64}$/.test(signature || "") || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return res.status(400).json({ error: "Invalid view ticket." });
    let claim;
    try { claim = JSON.parse(Buffer.from(payload, "base64url").toString()); }
    catch { return res.status(400).json({ error: "Invalid view ticket." }); }
    const hash = viewerHash(req);
    const elapsed = now() - claim.at;
    if (claim.id !== video._id || claim.viewer !== hash || !Number.isFinite(elapsed) || elapsed < Math.min(3000, video.durationSeconds * 1000) || elapsed > 300000) {
      return res.status(400).json({ error: "View ticket is expired, premature or belongs to another viewer." });
    }
    if (sessionFor(req)?.userId === video.ownerId) return res.json({ counted: false, views: video.views || 0 });
    let counted = false;
    try {
      await db().collection("shortViews").insertOne({
        videoId: video._id, viewerHash: hash, createdAt: new Date(now()).toISOString(),
        ...(video.ownerId ? { creatorId: video.ownerId, earningMilliRupees: SIMPLY_EARNING_MILLI_RUPEES } : {})
      });
      counted = true;
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    // Derive the counter from the unique ledger so a retry repairs a failed counter write.
    const views = await db().collection("shortViews").countDocuments({ videoId: video._id });
    await db().collection("videos").updateOne({ _id: video._id }, { $max: { views } });
    res.json({ counted, views: (await db().collection("videos").findOne({ _id: video._id })).views || 0 });
  }));
  return asyncRoute(async (req, res, next) => {
    if (req.params.creatorId) {
      if (!await rate(req, "follow", 20)) return res.status(429).json({ error: "Too many follow actions. Try again in a minute." });
      return next();
    }
    const video = await db().collection("videos").findOne({ _id: req.params.id });
    if (video?.videoType === "short" && !await rate(req, "engagement", 30)) return res.status(429).json({ error: "Too many actions. Try again in a minute." });
    next();
  });
}
