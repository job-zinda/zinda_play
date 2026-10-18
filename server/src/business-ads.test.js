import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { ObjectId } from "mongodb";
import { memoryDatabase } from "../test-support/memory-database.js";
import { businessAdSettings, businessAdSummary, initializeBusinessAds, normalizeBusinessAd, notifyBusinessAdPublication, registerBusinessAdRoutes } from "./business-ads.js";

const categories = [{ id: "cat-learning", name: "Learning" }, { id: "cat-films", name: "Films" }];
const fields = {
  title: "Business offer", description: "Our new offer", targetUrl: "https://example.com/offer",
  targetCity: "", targetCategories: ["cat-learning"], targetViews: 1000, cpmRupees: 500
};
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=", "base64");
const mp4 = Buffer.from("000000106674797069736f6d00000200", "hex");

async function fixture(t) {
  const db = memoryDatabase();
  const businessId = new ObjectId();
  const otherId = new ObjectId();
  const qrId = new ObjectId();
  await db.collection("siteContent").insertOne({ _id: "creator-membership", qrImageId: qrId.toString() });
  await initializeBusinessAds(db);
  const app = express();
  app.use(express.json());
  const requireBusiness = (req, res, next) => {
    const token = req.get("authorization");
    if (!["Bearer business", "Bearer other"].includes(token)) return res.status(401).json({ error: "Business sign-in required." });
    req.businessId = token === "Bearer business" ? businessId : otherId;
    req.business = { businessName: token === "Bearer business" ? "Test Brand" : "Other Brand" };
    req.session = { username: "brand" };
    next();
  };
  const requireAdmin = (req, res, next) => {
    if (req.get("authorization") !== "Bearer admin") return res.status(401).json({ error: "Admin sign-in required." });
    next();
  };
  registerBusinessAdRoutes(app, {
    getDb: () => db, requireBusiness, requireAdmin, getCategories: () => categories,
    asyncRoute: handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next),
    streamFile: async (_req, res, _bucket, name, id) => {
      const file = await db.collection(name).findOne({ _id: new ObjectId(id) });
      if (!file) return res.status(404).json({ error: "File not found" });
      res.json({ id, contentType: file.metadata.contentType });
    }
  });
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(path, role = "business", method = "GET", body, type) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { Authorization: `Bearer ${role}`, ...(body ? { "Content-Type": type || "application/json" } : {}) },
      body: body ? type ? body : JSON.stringify(body) : undefined
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  }
  async function create() {
    const response = await request("/business/ads", "business", "POST", fields);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body;
  }
  async function submit() {
    const draft = await create();
    assert.equal((await request(`/business/ads/${draft.id}/video`, "business", "PUT", mp4, "video/mp4")).status, 200);
    assert.equal((await request(`/business/ads/${draft.id}/proof`, "business", "PUT", png, "image/png")).status, 200);
    assert.equal((await request(`/business/ads/${draft.id}/submit`, "business", "POST", {})).status, 200);
    return draft;
  }
  return { db, businessId, request, create, submit };
}

test("business ad input validates URL, interests, title and exact impression increments", () => {
  assert.equal(normalizeBusinessAd(fields, categories).error, undefined);
  for (const patch of [
    { targetUrl: "javascript:alert(1)" }, { targetUrl: "https://user:password@example.com" },
    { targetUrl: "" }, { targetCategories: ["unknown"] }, { targetCategories: "cat-learning" },
    { targetViews: 999 }, { targetViews: 1500 }, { targetViews: 1000001 }, { title: " " }
  ]) assert.ok(normalizeBusinessAd({ ...fields, ...patch }, categories).error);
  assert.equal(normalizeBusinessAd({ ...fields, targetCity: " New   Delhi " }, categories).fields.targetCity, "New Delhi");
});

test("admin pricing is protected, quoted once, and cannot be changed by business payloads", async t => {
  const f = await fixture(t);
  assert.equal((await f.request("/admin/business-ad-settings", "business", "PUT", { cpmRupees: 250 })).status, 401);
  assert.equal((await f.request("/admin/business-ad-settings", "admin", "PUT", { cpmRupees: 250.5 })).status, 400);
  assert.equal((await f.request("/admin/business-ad-settings", "admin", "PUT", { cpmRupees: 250 })).status, 200);
  assert.equal((await f.request("/business/ads", "business", "POST", fields)).status, 409);
  const created = await f.request("/business/ads", "business", "POST", { ...fields, cpmRupees: 250, amountRupees: 1, paymentVerified: true, status: "approved" });
  assert.equal(created.body.amountRupees, 250);
  assert.equal(created.body.paymentVerified, false);
  assert.equal(created.body.status, "draft");
  await f.request("/admin/business-ad-settings", "admin", "PUT", { cpmRupees: 700 });
  assert.equal((await f.request("/business/ads")).body[0].amountRupees, 250);
  assert.equal((await businessAdSettings(f.db)).cpmRupees, 700);
});

test("draft -> upload -> payment -> review -> approved unpublished ad preserves targeting", async t => {
  const f = await fixture(t);
  const draft = await f.create();
  assert.equal((await f.request("/admin/business-ads", "admin")).body.length, 0);
  assert.equal((await f.request(`/business/ads/${draft.id}/submit`, "business", "POST", {})).status, 409);
  assert.equal((await f.request(`/business/ads/${draft.id}/video`, "business", "PUT", mp4, "video/mp4")).status, 200);
  const preview = await f.request(`/business/ads/${draft.id}/video`);
  assert.equal(preview.status, 200);
  assert.equal(preview.cache, "private, no-store");
  assert.equal((await f.request(`/business-ad-media/${draft.id}`, "anonymous")).status, 404);
  assert.equal((await f.request(`/business/ads/${draft.id}/submit`, "business", "POST", {})).status, 409);
  assert.equal((await f.request(`/business/ads/${draft.id}/proof`, "business", "PUT", png, "image/png")).status, 200);
  assert.equal((await f.request(`/business/ads/${draft.id}/submit`, "business", "POST", {})).status, 200);
  assert.equal((await f.request(`/business/ads/${draft.id}/submit`, "business", "POST", {})).status, 200);
  assert.equal((await f.request(`/business/ads/${draft.id}`, "business", "PATCH", fields)).status, 409);
  assert.equal((await f.request("/admin/business-ads", "admin")).body[0].status, "submitted");
  assert.equal((await f.request(`/admin/business-ads/${draft.id}/proof`, "admin")).status, 200);
  assert.equal((await f.request(`/admin/business-ads/${draft.id}/review`, "admin", "POST", { decision: "approved" })).status, 400);
  const review = await f.request(`/admin/business-ads/${draft.id}/review`, "admin", "POST", { decision: "approved", paymentVerified: true });
  assert.equal(review.status, 200);
  assert.equal(review.body.deliveryStatus, "unpublished");
  const ad = f.db.collection("ads").documents[0];
  assert.equal(ad.active, false);
  assert.equal(ad.targetUrl, fields.targetUrl);
  assert.deepEqual(ad.targetCategories, fields.targetCategories);
  assert.equal(ad.targetViews, fields.targetViews);
  assert.equal(ad.businessId, f.businessId.toString());
  assert.equal((await f.request(`/business-ad-media/${draft.id}`, "anonymous")).status, 404);
  assert.equal((await f.request(`/admin/business-ads/${draft.id}/review`, "admin", "POST", { decision: "approved", paymentVerified: true })).status, 200);
  assert.equal(f.db.collection("businessAdSubmissions").documents[0].history.length, 1);
  assert.equal(f.db.collection("ads").documents.length, 1);
  assert.ok(f.db.collection("notifications").documents.some(item => item.type === "business_ad_approved"));
});

test("business and private payment data are isolated across accounts", async t => {
  const f = await fixture(t);
  const draft = await f.submit();
  assert.equal((await f.request("/business/ads", "other")).body.length, 0);
  assert.equal((await f.request(`/business/ads/${draft.id}/video`, "other")).status, 404);
  assert.equal((await f.request(`/business/ads/${draft.id}`, "other", "PATCH", fields)).status, 404);
  assert.equal((await f.request(`/admin/business-ads/${draft.id}/proof`, "business")).status, 401);
  assert.equal((await f.request(`/admin/business-ads/${draft.id}/review`, "business", "POST", { decision: "approved", paymentVerified: true })).status, 401);
});

test("rejection deletes the video and allows a replacement with verified payment and quoted target retained", async t => {
  const f = await fixture(t);
  const draft = await f.submit();
  const submission = f.db.collection("businessAdSubmissions").documents[0];
  const videoId = submission.videoId;
  const path = `/admin/business-ads/${draft.id}/review`;
  assert.equal((await f.request(path, "admin", "POST", { decision: "rejected" })).status, 400);
  const rejected = await f.request(path, "admin", "POST", { decision: "rejected", reason: "Replace misleading claim", paymentVerified: true });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.hasVideo, false);
  assert.equal(rejected.body.hasProof, true);
  assert.equal(rejected.body.history[0].reason, "Replace misleading claim");
  assert.equal(await f.db.collection("businessAdVideos.files").findOne({ _id: videoId }), null);
  assert.equal(f.db.collection("businessAdVideos.chunks").documents.length, 0);
  assert.equal((await f.request(`/business/ads/${draft.id}/video`)).status, 404);
  await f.request("/admin/business-ad-settings", "admin", "PUT", { cpmRupees: 999 });
  const changed = { ...fields, title: "Corrected offer" };
  assert.equal((await f.request(`/business/ads/${draft.id}`, "business", "PATCH", { ...changed, targetViews: 2000 })).status, 400);
  const resubmittedDraft = await f.request(`/business/ads/${draft.id}`, "business", "PATCH", changed);
  assert.equal(resubmittedDraft.body.status, "draft");
  assert.equal(resubmittedDraft.body.amountRupees, 500);
  assert.equal(resubmittedDraft.body.targetViews, 1000);
  assert.equal(resubmittedDraft.body.paymentVerified, true);
  assert.equal((await f.request(`/business/ads/${draft.id}/video`, "business", "PUT", mp4, "video/mp4")).status, 200);
  assert.equal((await f.request(`/business/ads/${draft.id}/submit`, "business", "POST", {})).status, 200);
  const approved = await f.request(path, "admin", "POST", { decision: "approved" });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.history.length, 2);
  assert.equal(f.db.collection("ads").documents[0].title, "Corrected offer");
});

test("deletion failures stay retryable and never claim a rejected video was deleted", async t => {
  const f = await fixture(t);
  const draft = await f.submit();
  const files = f.db.collection("businessAdVideos.files");
  const originalDelete = files.deleteOne;
  files.deleteOne = async () => { throw new Error("Simulated storage outage"); };
  const path = `/admin/business-ads/${draft.id}/review`;
  const body = { decision: "rejected", reason: "Invalid content", paymentVerified: true };
  assert.equal((await f.request(path, "admin", "POST", body)).status, 500);
  assert.equal((await f.request("/admin/business-ads", "admin")).body[0].status, "rejecting");
  assert.equal((await f.request(`/business/ads/${draft.id}`, "business", "PATCH", fields)).status, 409);
  assert.equal(f.db.collection("notifications").documents.some(item => item.type === "business_ad_rejected"), false);
  files.deleteOne = originalDelete;
  assert.equal((await f.request(path, "admin", "POST", body)).status, 200);
});

test("publication notifies business and business reports match admin delivery metrics", async t => {
  const f = await fixture(t);
  const draft = await f.submit();
  await f.request(`/admin/business-ads/${draft.id}/review`, "admin", "POST", { decision: "approved", paymentVerified: true });
  const ad = f.db.collection("ads").documents[0];
  ad.active = true;
  ad.publishedAt = new Date().toISOString();
  ad.impressions = 250;
  ad.clicks = 10;
  await notifyBusinessAdPublication(f.db, ad, false);
  const report = (await f.request("/business/ads")).body[0];
  assert.equal(report.deliveryStatus, "active");
  assert.equal(report.impressions, 250);
  assert.equal(report.clicks, 10);
  assert.equal(report.clickThroughRate, 4);
  assert.equal(report.remainingImpressions, 750);
  assert.equal(report.completionPercent, 25);
  assert.ok(f.db.collection("notifications").documents.some(item => item.type === "business_ad_running" && item.recipientId === f.businessId.toString()));
  const before = f.db.collection("notifications").documents.length;
  await notifyBusinessAdPublication(f.db, ad, true);
  assert.equal(f.db.collection("notifications").documents.length, before);
  assert.equal((await f.request(`/business-ad-media/${draft.id}`, "anonymous")).status, 200);
  ad.impressions = 1000;
  assert.equal(businessAdSummary(f.db.collection("businessAdSubmissions").documents[0], ad).deliveryStatus, "completed");
});

test("parallel approval retries create one ad and one review-history entry", async t => {
  const f = await fixture(t);
  const draft = await f.submit();
  const responses = await Promise.all(Array.from({ length: 6 }, () => f.request(
    `/admin/business-ads/${draft.id}/review`, "admin", "POST", { decision: "approved", paymentVerified: true }
  )));
  assert.ok(responses.every(response => response.status === 200), JSON.stringify(responses));
  assert.equal(f.db.collection("ads").documents.length, 1);
  assert.equal(f.db.collection("businessAdSubmissions").documents[0].history.length, 1);
  assert.equal(f.db.collection("notifications").documents.filter(item => item.type === "business_ad_approved").length, 1);
});

test("a failed review notification can be retried without approving or charging twice", async t => {
  const f = await fixture(t);
  const draft = await f.submit();
  const notifications = f.db.collection("notifications");
  const originalUpdate = notifications.updateOne;
  notifications.updateOne = async function (filter, ...args) {
    if (filter.type === "business_ad_approved") throw new Error("Simulated notification failure");
    return originalUpdate.call(this, filter, ...args);
  };
  const path = `/admin/business-ads/${draft.id}/review`;
  const body = { decision: "approved", paymentVerified: true };
  assert.equal((await f.request(path, "admin", "POST", body)).status, 500);
  assert.equal(f.db.collection("businessAdSubmissions").documents[0].status, "approved");
  notifications.updateOne = originalUpdate;
  assert.equal((await f.request(path, "admin", "POST", body)).status, 200);
  assert.equal(f.db.collection("ads").documents.length, 1);
  assert.equal(f.db.collection("businessAdSubmissions").documents[0].history.length, 1);
  assert.equal(notifications.documents.filter(item => item.type === "business_ad_approved").length, 1);
});

test("interrupted uploads can recover after their lease expires without losing an earlier video", async t => {
  const f = await fixture(t);
  const draft = await f.create();
  await f.request(`/business/ads/${draft.id}/video`, "business", "PUT", mp4, "video/mp4");
  const submission = f.db.collection("businessAdSubmissions").documents[0];
  const earlierVideoId = submission.videoId;
  submission.status = "uploading";
  submission.uploadingVideoId = new ObjectId();
  submission.uploadExpiresAt = new Date(Date.now() + 60000).toISOString();
  assert.equal((await f.request(`/business/ads/${draft.id}`, "business", "PATCH", fields)).status, 409);
  submission.uploadExpiresAt = new Date(Date.now() - 1).toISOString();
  await f.db.collection("businessAdVideos.chunks").insertOne({ files_id: submission.uploadingVideoId, data: mp4 });
  assert.equal((await f.request(`/business/ads/${draft.id}`, "business", "PATCH", fields)).status, 200);
  assert.equal(f.db.collection("businessAdVideos.chunks").documents.length, 1);
  assert.equal((await f.request(`/business/ads/${draft.id}/video`)).body.id, earlierVideoId.toString());
  assert.equal((await f.request(`/business/ads/${draft.id}/video`, "business", "PUT", mp4, "video/mp4")).status, 200);
  assert.equal((await f.request(`/business/ads/${draft.id}/video`)).status, 200);
  assert.equal(await f.db.collection("businessAdVideos.files").findOne({ _id: earlierVideoId }), null);
});

test("rejection retries also clean up orphaned chunks after file metadata was already deleted", async t => {
  const f = await fixture(t);
  const draft = await f.submit();
  const chunks = f.db.collection("businessAdVideos.chunks");
  const originalDelete = chunks.deleteMany;
  chunks.deleteMany = async () => { throw new Error("Simulated chunk deletion failure"); };
  const path = `/admin/business-ads/${draft.id}/review`;
  const body = { decision: "rejected", reason: "Fix creative" };
  assert.equal((await f.request(path, "admin", "POST", body)).status, 500);
  assert.equal(f.db.collection("businessAdVideos.files").documents.length, 0);
  assert.ok(chunks.documents.length > 0);
  chunks.deleteMany = originalDelete;
  assert.equal((await f.request(path, "admin", "POST", body)).status, 200);
  assert.equal(chunks.documents.length, 0);
});
