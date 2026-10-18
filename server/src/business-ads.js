import express from "express";
import { GridFSBucket, ObjectId } from "mongodb";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { adReport } from "./ad-delivery.js";
import { membershipSettings, validPaymentImage } from "./memberships.js";

const settingsId = "business-ad-pricing";
const maxVideoBytes = 150 * 1024 * 1024;
const uploadTimeoutMs = 30 * 60 * 1000;
const imageTypes = ["image/jpeg", "image/png", "image/webp"];
const editableStatuses = ["draft", "rejected"];
const reviewStatuses = ["submitted", "approving", "rejecting"];

export async function businessAdSettings(db) {
  const saved = await db.collection("siteContent").findOne({ _id: settingsId });
  return { cpmRupees: saved?.cpmRupees ?? 500, qrUrl: (await membershipSettings(db)).qrUrl };
}

export function normalizeBusinessAd(body, categories) {
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const targetUrl = typeof body?.targetUrl === "string" ? body.targetUrl.trim() : "";
  const targetCity = typeof body?.targetCity === "string" ? body.targetCity.trim().replace(/\s+/g, " ") : "";
  if (!title || title.length > 120 || description.length > 2000) return { error: "Enter a title (up to 120 characters) and description up to 2000 characters." };
  try {
    const url = new URL(targetUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid URL");
  } catch {
    return { error: "Enter a valid HTTP or HTTPS destination URL without credentials." };
  }
  if (targetUrl.length > 2000 || targetCity.length > 100) return { error: "Destination URL must be at most 2000 characters and city at most 100 characters." };
  if (!Array.isArray(body.targetCategories) || body.targetCategories.some(id => typeof id !== "string" || !categories.some(category => category.id === id))) {
    return { error: "Choose valid interest categories." };
  }
  const targetViews = body.targetViews;
  if (!Number.isSafeInteger(targetViews) || targetViews < 1000 || targetViews > 1000000 || targetViews % 1000 !== 0) {
    return { error: "Choose 1000 to 1000000 impressions in multiples of 1000." };
  }
  return { fields: { title, description, targetUrl, targetCity, targetCategories: [...new Set(body.targetCategories)], targetViews } };
}

export function businessAdSummary(submission, ad) {
  return {
    id: submission._id.toString(), businessName: submission.businessName,
    title: submission.title, description: submission.description, targetUrl: submission.targetUrl,
    targetCity: submission.targetCity, targetCategories: submission.targetCategories,
    targetViews: submission.targetViews, amountRupees: submission.amountRupees, cpmRupees: submission.cpmRupees,
    status: submission.status, paymentVerified: submission.paymentVerified === true,
    hasVideo: Boolean(submission.videoId), hasProof: Boolean(submission.proofId),
    rejectionReason: submission.rejectionReason || "", history: submission.history || [],
    createdAt: submission.createdAt, submittedAt: submission.submittedAt, reviewedAt: submission.reviewedAt,
    adId: ad?._id.toString() || null,
    impressions: ad?.impressions || 0, clicks: ad?.clicks || 0,
    ...adReport(ad || { active: false, targetViews: submission.targetViews }),
    // A submission is not a deliverable ad until the administrator publishes it.
    ...(!ad || (!ad.active && !ad.publishedAt) ? { deliveryStatus: submission.status === "approved" ? "unpublished" : null } : {})
  };
}

export async function initializeBusinessAds(db) {
  await db.collection("businessAdSubmissions").createIndex({ businessId: 1, createdAt: -1 });
  await db.collection("ads").createIndex({ businessSubmissionId: 1 }, {
    unique: true, partialFilterExpression: { businessSubmissionId: { $type: "string" } }
  });
  await db.collection("notifications").createIndex({ businessSubmissionId: 1, type: 1, recipientId: 1, revision: 1 }, {
    unique: true, partialFilterExpression: { businessSubmissionId: { $type: "string" }, revision: { $type: "number" } }
  });
}

export function registerBusinessAdRoutes(app, { getDb, requireBusiness, requireAdmin, asyncRoute, getCategories, streamFile }) {
  const db = () => getDb();
  const submissions = () => db().collection("businessAdSubmissions");
  const ads = () => db().collection("ads");
  const videos = () => new GridFSBucket(db(), { bucketName: "businessAdVideos" });
  const proofs = () => new GridFSBucket(db(), { bucketName: "businessAdProofs" });
  const rawImage = express.raw({ type: imageTypes, limit: 8 * 1024 * 1024 });

  async function notify(submission, kind, title, message, recipient = submission.businessId) {
    await db().collection("notifications").updateOne(
      { businessSubmissionId: submission._id.toString(), type: kind, recipientId: recipient, revision: submission.revision || 1 },
      { $setOnInsert: { title, message, readAt: null, createdAt: new Date().toISOString() } },
      { upsert: true }
    );
  }
  async function findOwned(req) {
    if (!ObjectId.isValid(req.params.id)) return null;
    return submissions().findOne({ _id: new ObjectId(req.params.id), businessId: req.businessId.toString() });
  }
  async function notifyReview(submission) {
    const approved = submission.status === "approved";
    await notify(submission, `business_ad_${submission.status}`, approved ? "Your ad was approved" : "Your ad was rejected",
      approved ? `"${submission.title}" was approved and is waiting for the administrator to publish it.`
        : `"${submission.title}" was rejected and its video deleted. Reason: ${submission.rejectionReason}. Upload a replacement using Resubmit.${submission.paymentVerified ? " Your verified payment is retained; do not pay again." : " Payment has not been verified."}`);
  }
  async function summary(submission) {
    return businessAdSummary(submission, await ads().findOne({ businessSubmissionId: submission._id.toString() }));
  }
  async function deleteFile(collection, id) {
    if (!id) return;
    // Both deletes are idempotent, including a retry after only one succeeded.
    await db().collection(`${collection}.files`).deleteOne({ _id: id });
    await db().collection(`${collection}.chunks`).deleteMany({ files_id: id });
  }
  app.get("/api/business/ad-settings", requireBusiness, asyncRoute(async (_req, res) => res.json(await businessAdSettings(db()))));
  app.get("/api/admin/business-ad-settings", requireAdmin, asyncRoute(async (_req, res) => res.json(await businessAdSettings(db()))));
  app.put("/api/admin/business-ad-settings", requireAdmin, asyncRoute(async (req, res) => {
    const cpmRupees = req.body?.cpmRupees;
    if (!Number.isSafeInteger(cpmRupees) || cpmRupees < 1 || cpmRupees > 1000000) {
      return res.status(400).json({ error: "Price per 1000 impressions must be a whole rupee amount from 1 to 1000000." });
    }
    await db().collection("siteContent").updateOne({ _id: settingsId }, { $set: { cpmRupees } }, { upsert: true });
    res.json(await businessAdSettings(db()));
  }));
  app.get("/api/business/ads", requireBusiness, asyncRoute(async (req, res) => {
    const list = await submissions().find({ businessId: req.businessId.toString() }).sort({ createdAt: -1 }).limit(200).toArray();
    res.json(await Promise.all(list.map(summary)));
  }));
  app.post("/api/business/ads", requireBusiness, asyncRoute(async (req, res) => {
    const { fields, error } = normalizeBusinessAd(req.body, getCategories());
    if (error) return res.status(400).json({ error });
    const settings = await businessAdSettings(db());
    if (!settings.qrUrl) return res.status(503).json({ error: "Payment QR is not configured. Contact the administrator before paying." });
    if (fields.targetCity && !process.env.MAXMIND_DB_PATH) return res.status(503).json({ error: "City targeting is not configured. Contact the administrator." });
    if (req.body.cpmRupees !== settings.cpmRupees) return res.status(409).json({ error: "Ad pricing changed. Refresh and check the new total before paying." });
    const submission = {
      ...fields, businessId: req.businessId.toString(), businessName: req.business.businessName || req.session.username,
      cpmRupees: settings.cpmRupees, amountRupees: fields.targetViews / 1000 * settings.cpmRupees,
      status: "draft", paymentVerified: false, revision: 1, adId: new ObjectId(),
      createdAt: new Date().toISOString(), history: []
    };
    await submissions().insertOne(submission);
    res.status(201).json(await summary(submission));
  }));
  app.patch("/api/business/ads/:id", requireBusiness, asyncRoute(async (req, res) => {
    const submission = await findOwned(req);
    if (!submission) return res.status(404).json({ error: "Business ad not found." });
    const recoveringUpload = submission.status === "uploading" && submission.uploadExpiresAt <= new Date().toISOString();
    if (!editableStatuses.includes(submission.status) && !recoveringUpload) {
      return res.status(409).json({ error: submission.status === "uploading" ? "An upload is still in progress. Interrupted uploads can be retried after 30 minutes." : "Only draft or rejected ads can be changed." });
    }
    if (req.body?.targetViews !== submission.targetViews) return res.status(400).json({ error: "The quoted impression target is fixed. Create a new ad to purchase a different target." });
    const { fields, error } = normalizeBusinessAd({ ...req.body, targetViews: submission.targetViews }, getCategories());
    if (error) return res.status(400).json({ error });
    if (fields.targetCity && !process.env.MAXMIND_DB_PATH) return res.status(503).json({ error: "City targeting is not configured." });
    if (recoveringUpload) await deleteFile("businessAdVideos", submission.uploadingVideoId);
    const result = await submissions().updateOne(
      { _id: submission._id, status: submission.status, ...(recoveringUpload ? { uploadingVideoId: submission.uploadingVideoId } : {}) },
      { $set: { ...fields, status: "draft" }, $unset: { uploadingVideoId: "", uploadExpiresAt: "" }, ...(submission.status === "rejected" ? { $inc: { revision: 1 } } : {}) }
    );
    if (!result.matchedCount) return res.status(409).json({ error: "This ad changed. Refresh before editing." });
    res.json(await summary(await findOwned(req)));
  }));
  app.put("/api/business/ads/:id/video", requireBusiness, asyncRoute(async (req, res) => {
    const submission = await findOwned(req);
    if (!submission) return res.status(404).json({ error: "Business ad not found." });
    const type = req.get("content-type");
    if (!["video/mp4", "video/webm"].includes(type)) return res.status(415).json({ error: "Choose an MP4 or WebM ad video." });
    const size = Number(req.get("content-length") || req.get("x-upload-size"));
    if (!Number.isSafeInteger(size) || size < 12 || size > maxVideoBytes) return res.status(400).json({ error: "Choose an MP4 or WebM ad video up to 150 MB." });
    const uploadingVideoId = new ObjectId();
    const claimed = await submissions().updateOne({ _id: submission._id, status: "draft" }, {
      $set: { status: "uploading", uploadingVideoId, uploadExpiresAt: new Date(Date.now() + uploadTimeoutMs).toISOString() }
    });
    if (!claimed.matchedCount) return res.status(409).json({ error: "Save a draft before uploading; this ad may already be in review." });
    const upload = videos().openUploadStreamWithId(uploadingVideoId, "business-ad", { metadata: { contentType: type } });
    let received = 0;
    let prefix = Buffer.alloc(0);
    let signatureChecked = false;
    const validate = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > size || received > maxVideoBytes) return callback(new Error("Video exceeded the declared file size."));
        if (!signatureChecked) {
          prefix = Buffer.concat([prefix, chunk.subarray(0, Math.max(0, 12 - prefix.length))]);
          if (prefix.length >= 12) {
            signatureChecked = true;
            const valid = type === "video/mp4" ? prefix.toString("ascii", 4, 8) === "ftyp" : prefix.subarray(0, 4).equals(Buffer.from("1a45dfa3", "hex"));
            if (!valid) return callback(new Error("Video content does not match MP4 or WebM format."));
          }
        }
        callback(null, chunk);
      }
    });
    try {
      await pipeline(req, validate, upload, { signal: AbortSignal.timeout(uploadTimeoutMs) });
      if (received !== size || !signatureChecked) throw new Error("The uploaded video was incomplete.");
      const saved = await submissions().updateOne({ _id: submission._id, status: "uploading", uploadingVideoId }, {
        $set: { status: "draft", videoId: upload.id }, $unset: { uploadingVideoId: "", uploadExpiresAt: "" }
      });
      if (!saved.matchedCount) throw new Error("The upload expired or this ad changed. Refresh and upload again.");
    } catch (error) {
      await deleteFile("businessAdVideos", upload.id);
      await submissions().updateOne({ _id: submission._id, status: "uploading", uploadingVideoId }, {
        $set: { status: "draft" }, $unset: { uploadingVideoId: "", uploadExpiresAt: "" }
      });
      throw error;
    }
    await deleteFile("businessAdVideos", submission.videoId);
    res.json(await summary(await findOwned(req)));
  }));
  app.put("/api/business/ads/:id/proof", requireBusiness, rawImage, asyncRoute(async (req, res) => {
    const submission = await findOwned(req);
    if (!submission) return res.status(404).json({ error: "Business ad not found." });
    if (submission.status !== "draft" || submission.paymentVerified) return res.status(409).json({ error: "Payment proof can be changed only on unverified drafts." });
    if (!validPaymentImage(req.body, req.get("content-type"))) return res.status(400).json({ error: "Choose a valid JPEG, PNG, or WebP payment screenshot up to 8 MB." });
    const upload = proofs().openUploadStream("business-payment", { metadata: { contentType: req.get("content-type") } });
    try {
      await pipeline(Readable.from([req.body]), upload);
      const result = await submissions().updateOne(
        { _id: submission._id, status: "draft", paymentVerified: false, proofId: submission.proofId || { $exists: false } },
        { $set: { proofId: upload.id } }
      );
      if (!result.matchedCount) {
        await deleteFile("businessAdProofs", upload.id);
        return res.status(409).json({ error: "This ad changed. Refresh before uploading proof." });
      }
    } catch (error) {
      await deleteFile("businessAdProofs", upload.id);
      throw error;
    }
    await deleteFile("businessAdProofs", submission.proofId);
    res.json(await summary(await findOwned(req)));
  }));
  app.post("/api/business/ads/:id/submit", requireBusiness, asyncRoute(async (req, res) => {
    const submission = await findOwned(req);
    if (!submission) return res.status(404).json({ error: "Business ad not found." });
    if (!["draft", "submitted"].includes(submission.status) || !submission.videoId || (!submission.proofId && !submission.paymentVerified)) {
      return res.status(409).json({ error: "Save a draft, upload a video and payment screenshot before submitting." });
    }
    if (submission.status === "draft") {
      const result = await submissions().updateOne({ _id: submission._id, status: "draft", videoId: submission.videoId }, { $set: { status: "submitted", submittedAt: new Date().toISOString() } });
      if (!result.matchedCount) return res.status(409).json({ error: "This ad changed. Refresh before submitting." });
    }
    await notify(submission, "business_ad_review", "Business ad and payment need review", `${submission.businessName} submitted "${submission.title}". Verify INR ${submission.amountRupees} and review the ad in Admin Ads.`, "admin");
    await notify(submission, "business_ad_submitted", "Your ad is under review", `"${submission.title}" was submitted. Payment and content will be checked before publication.`);
    res.json(await summary(await findOwned(req)));
  }));
  app.get("/api/business/ads/:id/video", requireBusiness, asyncRoute(async (req, res) => {
    const submission = await findOwned(req);
    if (!submission?.videoId) return res.status(404).json({ error: "Ad video not found." });
    res.set("Cache-Control", "private, no-store");
    await streamFile(req, res, videos(), "businessAdVideos.files", submission.videoId.toString(), "Ad video not found");
  }));
  app.get("/api/admin/business-ads", requireAdmin, asyncRoute(async (_req, res) => {
    const list = await submissions().find({ status: { $in: reviewStatuses } }).sort({ submittedAt: 1 }).limit(200).toArray();
    res.json(await Promise.all(list.map(summary)));
  }));
  for (const kind of ["video", "proof"]) {
    app.get(`/api/admin/business-ads/:id/${kind}`, requireAdmin, asyncRoute(async (req, res) => {
      if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Business ad not found." });
      const submission = await submissions().findOne({ _id: new ObjectId(req.params.id) });
      const fileId = submission?.[kind === "video" ? "videoId" : "proofId"];
      if (!fileId) return res.status(404).json({ error: "Requested file not found." });
      res.set("Cache-Control", "private, no-store");
      await streamFile(req, res, kind === "video" ? videos() : proofs(), kind === "video" ? "businessAdVideos.files" : "businessAdProofs.files", fileId.toString(), "Requested file not found");
    }));
  }
  app.get("/api/business-ad-media/:id", asyncRoute(async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Ad media not found." });
    const submission = await submissions().findOne({ _id: new ObjectId(req.params.id), status: "approved" });
    if (!submission?.videoId || !await ads().findOne({ businessSubmissionId: submission._id.toString(), active: true })) return res.status(404).json({ error: "Ad media not found." });
    await streamFile(req, res, videos(), "businessAdVideos.files", submission.videoId.toString(), "Ad media not found");
  }));
  app.post("/api/admin/business-ads/:id/review", requireAdmin, asyncRoute(async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Business ad not found." });
    const id = new ObjectId(req.params.id);
    const decision = req.body?.decision;
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!["approved", "rejected"].includes(decision)) return res.status(400).json({ error: "Choose approve or reject." });
    if (decision === "rejected" && (!reason || reason.length > 500)) return res.status(400).json({ error: "A rejection reason is required (up to 500 characters)." });
    let submission = await submissions().findOne({ _id: id });
    if (!submission) return res.status(404).json({ error: "Business ad not found." });
    if (submission.status === decision) {
      await notifyReview(submission);
      return res.json(await summary(submission));
    }
    if (decision === "approved" && !submission.paymentVerified && req.body.paymentVerified !== true) return res.status(400).json({ error: "Confirm that the payment was received before approval." });
    const nextStatus = decision === "approved" ? "approving" : "rejecting";
    const paymentVerified = submission.paymentVerified || req.body.paymentVerified === true;
    const claimed = await submissions().updateOne(
      { _id: id, status: "submitted", revision: submission.revision },
      { $set: {
        status: nextStatus, ...(paymentVerified ? { paymentVerified: true } : {}),
        ...(decision === "rejected" ? { rejectionReason: reason } : {})
      } }
    );
    const current = await submissions().findOne({ _id: id });
    if ((!claimed.matchedCount && current.status !== nextStatus) || current.revision !== submission.revision) {
      if (current.status === decision && current.revision === submission.revision) {
        await notifyReview(current);
        return res.json(await summary(current));
      }
      return res.status(409).json({ error: "This ad has already been reviewed or a different review is in progress." });
    }
    submission = current;
    const reviewedAt = new Date().toISOString();
    if (decision === "approved") {
      if (!submission.videoId) throw new Error("Cannot approve an ad without a video.");
      await ads().updateOne(
        { _id: submission.adId },
        { $setOnInsert: {
          businessSubmissionId: id.toString(), businessId: submission.businessId, businessName: submission.businessName,
          title: submission.title, type: "video", placement: "", mediaUrl: `/business-ad-media/${id}`,
          targetUrl: submission.targetUrl, targetCity: submission.targetCity, targetCategories: submission.targetCategories,
          targetViews: submission.targetViews, frequency: 1, skippable: true, skipAfterSeconds: 20,
          active: false, impressions: 0, clicks: 0, createdAt: reviewedAt
        } }, { upsert: true }
      );
    } else {
      await deleteFile("businessAdVideos", submission.videoId);
    }
    await submissions().updateOne({ _id: id, status: nextStatus, revision: submission.revision }, {
      $set: { status: decision, reviewedAt },
      ...(decision === "rejected" ? { $unset: { videoId: "" } } : {}),
      $push: { history: { decision, reason: decision === "rejected" ? submission.rejectionReason : "", paymentVerified: submission.paymentVerified === true, reviewedAt, revision: submission.revision || 1 } }
    });
    const reviewed = await submissions().findOne({ _id: id });
    if (reviewed.revision !== submission.revision || reviewed.status !== decision) return res.status(409).json({ error: "This ad changed. Refresh its current review status." });
    await notifyReview(reviewed);
    res.json(await summary(reviewed));
  }));
  app.use((error, req, res, next) => {
    if (error.type === "entity.too.large" && req.path.includes("/business/ads/")) return res.status(413).json({ error: "Payment screenshots must be no larger than 8 MB." });
    next(error);
  });
}

export async function notifyBusinessAdPublication(db, ad, wasActive) {
  if (!ad?.businessSubmissionId || ad.active === wasActive) return;
  const running = ad.active && adReport(ad).deliveryStatus !== "completed";
  await db.collection("notifications").insertOne({
    recipientId: ad.businessId, type: running ? "business_ad_running" : "business_ad_paused",
    businessSubmissionId: ad.businessSubmissionId, adId: ad._id.toString(),
    title: running ? "Your ad is running" : "Your ad is paused",
    message: running ? `"${ad.title}" is now published. View impressions, clicks and delivery progress in Business Ad analytics.`
      : `"${ad.title}" is not accepting new deliveries. Check Business Ad analytics for its status.`,
    readAt: null, createdAt: new Date().toISOString()
  });
}
