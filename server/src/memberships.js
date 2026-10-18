import express from "express";
import { GridFSBucket, ObjectId } from "mongodb";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const settingsId = "creator-membership";
const maxImageBytes = 8 * 1024 * 1024;
const imageTypes = ["image/jpeg", "image/png", "image/webp"];
const pendingStatuses = ["pending", "approving"];
export const defaultMembershipSettings = {
  trialDays: 7,
  plans: [
    { id: "monthly", name: "Monthly", durationDays: 30, priceRupees: 199, enabled: true },
    { id: "quarterly", name: "3 months", durationDays: 90, priceRupees: 597, enabled: false },
    { id: "half-year", name: "6 months", durationDays: 180, priceRupees: 1194, enabled: false },
    { id: "yearly", name: "One year", durationDays: 365, priceRupees: 2388, enabled: false }
  ]
};

export function validateMembershipSettings(body) {
  if (!Number.isInteger(body?.trialDays) || body.trialDays < 0 || body.trialDays > 365) {
    return "Trial length must be between 0 and 365 days.";
  }
  if (!Array.isArray(body.plans) || !body.plans.length || body.plans.length > 20) {
    return "Configure between 1 and 20 plans.";
  }
  const ids = new Set();
  for (const plan of body.plans) {
    if (typeof plan?.id !== "string" || !/^[a-zA-Z0-9-]{1,60}$/.test(plan.id) || ids.has(plan.id)) return "Plan IDs must be unique.";
    ids.add(plan.id);
    if (typeof plan.name !== "string" || !plan.name.trim() || plan.name.length > 80) return "Every plan needs a name (up to 80 characters).";
    if (!Number.isInteger(plan.durationDays) || plan.durationDays < 1 || plan.durationDays > 3660) return "Plan duration must be between 1 and 3660 days.";
    if (!Number.isSafeInteger(plan.priceRupees) || plan.priceRupees < 1 || plan.priceRupees > 1000000) return "Plan price must be a whole rupee amount between 1 and 1000000.";
    if (typeof plan.enabled !== "boolean") return "Specify whether each plan is enabled.";
  }
  if (!body.plans.some(plan => plan.enabled)) return "Enable at least one membership plan.";
  return null;
}

export async function membershipSettings(db) {
  const saved = await db.collection("siteContent").findOne({ _id: settingsId });
  return {
    trialDays: saved?.trialDays ?? defaultMembershipSettings.trialDays,
    plans: saved?.plans ?? defaultMembershipSettings.plans,
    qrUrl: saved?.qrImageId ? `/membership/qr/${saved.qrImageId}` : null
  };
}

export function membershipExtension(paidUntil, durationDays, now = new Date()) {
  const base = paidUntil && new Date(paidUntil) > now ? new Date(paidUntil) : now;
  return new Date(base.getTime() + durationDays * 86400000).toISOString();
}

export function validPaymentImage(bytes, type) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > maxImageBytes) return false;
  if (type === "image/png") return bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/webp") return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return false;
}

export async function initializeMemberships(db) {
  const payments = db.collection("membershipPayments");
  await payments.createIndex({ creatorId: 1 }, { unique: true, partialFilterExpression: { status: { $in: pendingStatuses } } });
  await payments.createIndex({ creatorId: 1, createdAt: -1 });
}

export function registerMembershipRoutes(app, { getDb, requireAdmin, requireCreator, asyncRoute, getState }) {
  const db = () => getDb();
  const payments = () => db().collection("membershipPayments");
  const bucket = () => new GridFSBucket(db(), { bucketName: "membershipImages" });
  const rawImage = express.raw({ type: imageTypes, limit: maxImageBytes });
  const publicPayment = payment => payment && ({
    id: payment._id.toString(), creatorId: payment.creatorId, username: payment.username,
    plan: payment.plan, status: payment.status, createdAt: payment.createdAt,
    reviewedAt: payment.reviewedAt, reason: payment.reason,
    proofUrl: `/admin/membership/payments/${payment._id}/proof`
  });
  async function saveImage(req) {
    const upload = bucket().openUploadStream("payment-image", { metadata: { contentType: req.get("content-type") } });
    try {
      await pipeline(Readable.from([req.body]), upload);
    } catch (error) {
      await bucket().delete(upload.id).catch(cleanupError => console.error("Membership image cleanup failed:", cleanupError));
      throw error;
    }
    return upload.id;
  }
  async function sendImage(res, id, privateImage) {
    const file = await db().collection("membershipImages.files").findOne({ _id: id });
    if (!file) return res.status(404).json({ error: "Payment image not found." });
    res.set({
      "Content-Type": file.metadata.contentType,
      "Content-Length": file.length,
      "Cache-Control": privateImage ? "private, no-store" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff"
    });
    await pipeline(bucket().openDownloadStream(id), res);
  }
  app.get("/api/admin/membership", requireAdmin, asyncRoute(async (_req, res) => {
    res.json(await membershipSettings(db()));
  }));
  app.put("/api/admin/membership", requireAdmin, asyncRoute(async (req, res) => {
    const error = validateMembershipSettings(req.body);
    if (error) return res.status(400).json({ error });
    const plans = req.body.plans.map(({ id, name, priceRupees, durationDays, enabled }) => ({
      id, name: name.trim(), priceRupees, durationDays, enabled
    }));
    await db().collection("siteContent").updateOne({ _id: settingsId }, { $set: { trialDays: req.body.trialDays, plans } }, { upsert: true });
    res.json(await membershipSettings(db()));
  }));
  app.post("/api/admin/membership/qr", requireAdmin, rawImage, asyncRoute(async (req, res) => {
    if (!validPaymentImage(req.body, req.get("content-type"))) return res.status(400).json({ error: "Choose a valid JPEG, PNG, or WebP QR image up to 8 MB." });
    const id = await saveImage(req);
    try {
      await db().collection("siteContent").updateOne({ _id: settingsId }, { $set: { qrImageId: id.toString() } }, { upsert: true });
    } catch (error) {
      await bucket().delete(id).catch(cleanupError => console.error("Membership QR cleanup failed:", cleanupError));
      throw error;
    }
    res.status(201).json(await membershipSettings(db()));
  }));
  app.get("/api/membership/qr/:id", asyncRoute(async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "QR image not found." });
    const settings = await membershipSettings(db());
    if (settings.qrUrl !== `/membership/qr/${req.params.id}`) return res.status(404).json({ error: "QR image not found." });
    await sendImage(res, new ObjectId(req.params.id), false);
  }));
  app.get("/api/creator/membership/payments", requireCreator, asyncRoute(async (req, res) => {
    const list = await payments().find({ creatorId: req.creatorId.toString() }).sort({ createdAt: -1 }).limit(50).toArray();
    res.json(list.map(publicPayment));
  }));
  app.post("/api/creator/membership/payments", requireCreator, rawImage, asyncRoute(async (req, res) => {
    const settings = await membershipSettings(db());
    if (!settings.qrUrl) return res.status(503).json({ error: "The administrator has not configured a payment QR yet. Please do not pay." });
    const plan = settings.plans.find(item => item.id === req.query.planId && item.enabled);
    if (!plan) return res.status(400).json({ error: "This plan is no longer available. Refresh membership plans." });
    if (String(plan.priceRupees) !== req.query.priceRupees || String(plan.durationDays) !== req.query.durationDays) {
      return res.status(409).json({ error: "This plan has changed. Refresh and check the amount before paying; contact the administrator if you already paid." });
    }
    if (!validPaymentImage(req.body, req.get("content-type"))) return res.status(400).json({ error: "Upload a valid JPEG, PNG, or WebP payment screenshot up to 8 MB." });
    if (await payments().findOne({ creatorId: req.creatorId.toString(), status: { $in: pendingStatuses } })) {
      return res.status(409).json({ error: "Your payment is already awaiting review. Do not pay again." });
    }
    const imageId = await saveImage(req);
    const payment = {
      creatorId: req.creatorId.toString(), username: req.session.username, plan: { ...plan },
      imageId, status: "pending", createdAt: new Date().toISOString()
    };
    try {
      await payments().insertOne(payment);
    } catch (error) {
      await bucket().delete(imageId).catch(cleanupError => console.error("Payment proof cleanup failed:", cleanupError));
      if (error.code === 11000) return res.status(409).json({ error: "Your payment is already awaiting review. Do not pay again." });
      throw error;
    }
    await db().collection("notifications").insertOne({
      recipientId: "admin", type: "membership_payment_submitted",
      title: "Membership payment needs review",
      message: `${payment.username} submitted ${payment.plan.name} payment of INR ${payment.plan.priceRupees}. Open Membership plans & payments to verify it.`,
      membershipPaymentId: payment._id.toString(), readAt: null, createdAt: payment.createdAt
    });
    res.status(201).json(publicPayment(payment));
  }));
  app.get("/api/admin/membership/payments", requireAdmin, asyncRoute(async (req, res) => {
    const filter = req.query.status === "all" ? {} : { status: { $in: pendingStatuses } };
    res.json((await payments().find(filter).sort({ createdAt: -1 }).limit(200).toArray()).map(publicPayment));
  }));
  app.get("/api/admin/membership/payments/:id/proof", requireAdmin, asyncRoute(async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Payment not found." });
    const payment = await payments().findOne({ _id: new ObjectId(req.params.id) });
    if (!payment) return res.status(404).json({ error: "Payment not found." });
    await sendImage(res, payment.imageId, true);
  }));
  app.post("/api/admin/membership/payments/:id/review", requireAdmin, asyncRoute(async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: "Payment not found." });
    const { decision, reason } = req.body || {};
    if (!["approved", "rejected"].includes(decision)) return res.status(400).json({ error: "Choose approve or reject." });
    if (decision === "rejected" && (typeof reason !== "string" || !reason.trim() || reason.length > 500)) {
      return res.status(400).json({ error: "A rejection reason is required (up to 500 characters)." });
    }
    const id = new ObjectId(req.params.id);
    const now = new Date().toISOString();
    // An interrupted approval can be retried; the per-payment user marker prevents double credit.
    const payment = await payments().findOneAndUpdate(
      { _id: id, status: decision === "approved" ? { $in: pendingStatuses } : "pending" },
      { $set: { status: decision === "approved" ? "approving" : "rejected", ...(decision === "rejected" ? { reason: reason.trim(), reviewedAt: now } : {}) } },
      { returnDocument: "after" }
    );
    if (!payment) return res.status(409).json({ error: "This payment was already reviewed or was not found. Refresh the list." });
    if (decision === "approved") {
      const creatorId = new ObjectId(payment.creatorId);
      await getState(creatorId);
      const user = await db().collection("users").findOne({ _id: creatorId });
      if (!user) throw new Error("Payment creator no longer exists.");
      const marker = `creatorMembership.appliedPayments.${id}`;
      await db().collection("users").updateOne(
        { _id: creatorId, [marker]: { $exists: false } },
        { $set: {
          "creatorMembership.paidUntil": membershipExtension(user.creatorMembership?.paidUntil, payment.plan.durationDays),
          [marker]: true
        } }
      );
      await payments().updateOne({ _id: id }, { $set: { status: "approved", reviewedAt: now } });
    }
    await db().collection("notifications").updateOne(
      { membershipPaymentId: id.toString(), recipientId: payment.creatorId },
      { $setOnInsert: {
        membershipPaymentId: id.toString(), recipientId: payment.creatorId, type: "membership_payment",
        title: decision === "approved" ? "Membership payment approved" : "Membership payment rejected",
        message: decision === "approved" ? `${payment.plan.name} membership activated for ${payment.plan.durationDays} days.` : reason.trim(),
        readAt: null, createdAt: now
      } },
      { upsert: true }
    );
    res.json({ status: decision });
  }));
  app.use((error, req, res, next) => {
    if (error.type === "entity.too.large" && req.path.includes("membership")) return res.status(413).json({ error: "Payment images must be no larger than 8 MB." });
    next(error);
  });
}
