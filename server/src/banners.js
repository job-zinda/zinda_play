import { ObjectId } from "mongodb";
import { pipeline } from "node:stream/promises";

const legacyBannerId = "homepage-banner";
const maxBanners = 20;

function bannerKey(id) {
  return typeof id === "string" && ObjectId.isValid(id) && /^[a-f0-9]{24}$/i.test(id) ? new ObjectId(id) : null;
}

export function publicBanner(banner) {
  return {
    id: banner._id.toString(),
    enabled: banner.enabled === true,
    title: banner.title || "",
    description: banner.description || "",
    buttonLabel: banner.buttonLabel || "",
    buttonUrl: banner.buttonUrl || "",
    imageUrl: banner.imageId ? `/banner/image/${banner.imageId}` : banner.imageUrl || "",
    createdAt: banner.createdAt || null,
    updatedAt: banner.updatedAt || null
  };
}

function bannerSettings(body) {
  const text = key => typeof body?.[key] === "string" ? body[key].trim() : "";
  const settings = {
    enabled: body?.enabled === true,
    title: text("title"),
    description: text("description"),
    buttonLabel: text("buttonLabel"),
    buttonUrl: text("buttonUrl")
  };
  if (settings.title.length > 120 || settings.description.length > 500 || settings.buttonLabel.length > 40) {
    return { error: "Banner title, description, or button label is too long." };
  }
  if (settings.buttonUrl) {
    try {
      if (!["http:", "https:"].includes(new URL(settings.buttonUrl).protocol)) throw new Error();
    } catch {
      return { error: "Button URL must be a valid HTTP or HTTPS URL." };
    }
  }
  if (settings.enabled && !settings.title) return { error: "Add a banner title before publishing it." };
  if (Boolean(settings.buttonLabel) !== Boolean(settings.buttonUrl)) {
    return { error: "Provide both a button label and button URL, or leave both empty." };
  }
  return { settings };
}

// Copies the former single homepage banner into the multi-banner collection once.
export async function initializeBanners(database) {
  const banners = database.collection("homeBanners");
  await banners.createIndex({ createdAt: 1 });
  if (await banners.countDocuments({})) return;
  const legacy = await database.collection("siteContent").findOne({ _id: legacyBannerId });
  if (!legacy || (!legacy.title && !legacy.imageId && !legacy.imageUrl)) return;
  const { _id, ...settings } = legacy;
  await banners.insertOne({ ...settings, createdAt: legacy.updatedAt || new Date().toISOString() });
}

export function registerBannerRoutes(app, {
  getDb, requireAdmin, asyncRoute, imageBucket, supportedImageTypes, maxImageBytes
}) {
  const banners = () => getDb().collection("homeBanners");
  const enabledBanners = async () => (await banners().find({ enabled: true }).sort({ createdAt: 1 }).toArray())
    .map(publicBanner).filter(banner => banner.imageUrl);
  const deleteImage = async imageId => {
    if (!imageId || !ObjectId.isValid(imageId)) return;
    await imageBucket().delete(new ObjectId(imageId)).catch(error => {
      console.error("Failed to remove a banner image:", error.message);
    });
  };

  app.get("/api/banners", asyncRoute(async (_req, res) => {
    res.json(await enabledBanners());
  }));
  // Older app builds read a single banner from this endpoint.
  app.get("/api/banner", asyncRoute(async (_req, res) => {
    res.json((await enabledBanners())[0] || null);
  }));
  app.get("/api/admin/banners", requireAdmin, asyncRoute(async (_req, res) => {
    res.json((await banners().find({}).sort({ createdAt: 1 }).toArray()).map(publicBanner));
  }));
  app.post("/api/admin/banners", requireAdmin, asyncRoute(async (req, res) => {
    const { settings, error } = bannerSettings(req.body);
    if (error) return res.status(400).json({ error });
    if (await banners().countDocuments({}) >= maxBanners) {
      return res.status(409).json({ error: `You can have up to ${maxBanners} banners. Delete one first.` });
    }
    const now = new Date().toISOString();
    const banner = { ...settings, imageId: "", createdAt: now, updatedAt: now };
    const result = await banners().insertOne(banner);
    res.status(201).json(publicBanner({ ...banner, _id: result.insertedId }));
  }));
  app.put("/api/admin/banners/:id", requireAdmin, asyncRoute(async (req, res) => {
    const _id = bannerKey(req.params.id);
    if (!_id) return res.status(404).json({ error: "Banner not found." });
    const { settings, error } = bannerSettings(req.body);
    if (error) return res.status(400).json({ error });
    const result = await banners().updateOne({ _id }, { $set: { ...settings, updatedAt: new Date().toISOString() } });
    if (!result.matchedCount) return res.status(404).json({ error: "Banner not found." });
    res.json(publicBanner(await banners().findOne({ _id })));
  }));
  app.delete("/api/admin/banners/:id", requireAdmin, asyncRoute(async (req, res) => {
    const _id = bannerKey(req.params.id);
    const banner = _id && await banners().findOne({ _id });
    if (!banner) return res.status(404).json({ error: "Banner not found." });
    await banners().deleteOne({ _id });
    await deleteImage(banner.imageId);
    res.status(204).end();
  }));
  app.put("/api/admin/banners/:id/image", requireAdmin, asyncRoute(async (req, res) => {
    const _id = bannerKey(req.params.id);
    const previous = _id && await banners().findOne({ _id });
    if (!previous) return res.status(404).json({ error: "Banner not found." });
    const contentType = String(req.get("Content-Type") || "").split(";")[0].toLowerCase();
    const extension = supportedImageTypes.get(contentType);
    if (!extension) return res.status(415).json({ error: "Choose a JPEG, PNG, WebP, or GIF image." });
    const size = Number(req.get("Content-Length") || req.get("X-Upload-Size") || 0);
    if (!Number.isSafeInteger(size) || size <= 0) return res.status(411).json({ error: "The image upload must include a valid file size." });
    if (size > maxImageBytes) return res.status(413).json({ error: "Banner images are limited to 8 MB." });
    const bucket = imageBucket();
    const upload = bucket.openUploadStream(`homepage-banner.${extension}`, { metadata: { contentType } });
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
    const result = await banners().updateOne(
      { _id },
      { $set: { imageId: upload.id.toString(), updatedAt: new Date().toISOString() }, $unset: { imageUrl: "" } }
    );
    if (!result.matchedCount) {
      await bucket.delete(upload.id).catch(() => {});
      return res.status(404).json({ error: "Banner not found." });
    }
    await deleteImage(previous.imageId);
    res.status(201).json(publicBanner(await banners().findOne({ _id })));
  }));
}
