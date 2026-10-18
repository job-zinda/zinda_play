import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { ObjectId } from "mongodb";
import { memoryDatabase } from "../test-support/memory-database.js";
import {
  defaultMembershipSettings, initializeMemberships, membershipExtension,
  membershipSettings, registerMembershipRoutes, validPaymentImage, validateMembershipSettings
} from "./memberships.js";

const clone = value => structuredClone(value);

async function fixture(t) {
  const db = memoryDatabase();
  const creatorId = new ObjectId();
  const trialEndsAt = new Date(Date.now() + 7 * 86400000).toISOString();
  await db.collection("users").insertOne({ _id: creatorId, creatorMembership: { trialEndsAt } });
  await initializeMemberships(db);
  const app = express();
  app.use(express.json());
  const guard = role => (req, res, next) => {
    if (req.get("authorization") !== `Bearer ${role}`) return res.status(401).json({ error: "Authentication required." });
    req.creatorId = creatorId;
    req.session = { username: "creator-test" };
    next();
  };
  registerMembershipRoutes(app, {
    getDb: () => db, requireAdmin: guard("admin"), requireCreator: guard("creator"),
    asyncRoute: handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next),
    getState: async () => ({})
  });
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(path, role = "creator", method = "GET", body, raw = false) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${role}`,
        ...(body ? { "Content-Type": raw ? "image/png" : "application/json" } : {})
      },
      body: body ? raw ? body : JSON.stringify(body) : undefined
    });
    return { status: response.status, body: await response.json() };
  }
  async function addPayment(plan = defaultMembershipSettings.plans[0]) {
    const payment = { creatorId: creatorId.toString(), username: "creator-test", plan: { ...plan }, status: "pending", imageId: new ObjectId(), createdAt: new Date().toISOString() };
    await db.collection("membershipPayments").insertOne(payment);
    return payment;
  }
  return { db, creatorId, request, addPayment, trialEndsAt };
}

test("default plans preserve 199 / 30 days and 7-day trial; longer plans start disabled", () => {
  assert.equal(defaultMembershipSettings.trialDays, 7);
  assert.deepEqual(defaultMembershipSettings.plans.map(plan => [plan.durationDays, plan.enabled]), [[30, true], [90, false], [180, false], [365, false]]);
  assert.equal(defaultMembershipSettings.plans[0].priceRupees, 199);
  assert.equal(validateMembershipSettings(defaultMembershipSettings), null);
});
test("settings reject invalid prices, duration, trial, duplicate IDs and no available plans", () => {
  for (const [field, value] of [["priceRupees", -1], ["priceRupees", 1.5], ["priceRupees", 1000001], ["durationDays", 0], ["durationDays", 1.5], ["enabled", "yes"]]) {
    const settings = clone(defaultMembershipSettings);
    settings.plans[0][field] = value;
    assert.ok(validateMembershipSettings(settings));
  }
  assert.ok(validateMembershipSettings({ ...defaultMembershipSettings, trialDays: -1 }));
  assert.ok(validateMembershipSettings({ ...defaultMembershipSettings, plans: [] }));
  const duplicate = clone(defaultMembershipSettings);
  duplicate.plans[1].id = duplicate.plans[0].id;
  assert.ok(validateMembershipSettings(duplicate));
  assert.ok(validateMembershipSettings({ ...defaultMembershipSettings, plans: defaultMembershipSettings.plans.map(plan => ({ ...plan, enabled: false })) }));
});
test("membership extensions start on approval or extend remaining paid time", () => {
  const now = new Date("2026-10-18T00:00:00Z");
  assert.equal(membershipExtension(null, 30, now), "2026-11-17T00:00:00.000Z");
  assert.equal(membershipExtension("2026-10-01", 90, now), "2027-01-16T00:00:00.000Z");
  assert.equal(membershipExtension("2026-11-01", 365, now), "2027-11-01T00:00:00.000Z");
});
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=", "base64");
test("image validation checks signatures, supported formats and exact size limit", () => {
  assert.equal(validPaymentImage(png, "image/png"), true);
  assert.equal(validPaymentImage(Buffer.from("<svg/>"), "image/png"), false);
  assert.equal(validPaymentImage(png, "image/jpeg"), false);
  assert.equal(validPaymentImage(png, "image/svg+xml"), false);
  const limit = Buffer.alloc(8 * 1024 * 1024);
  png.copy(limit);
  assert.equal(validPaymentImage(limit, "image/png"), true);
  assert.equal(validPaymentImage(Buffer.concat([limit, Buffer.from([0])]), "image/png"), false);
});
test("admin can save new plans and trial without changing existing user membership", async t => {
  const f = await fixture(t);
  const settings = clone(defaultMembershipSettings);
  settings.trialDays = 14;
  settings.plans[1].enabled = true;
  settings.plans[1].priceRupees = 549;
  assert.equal((await f.request("/admin/membership", "creator", "PUT", settings)).status, 401);
  assert.equal((await f.request("/admin/membership", "admin", "PUT", settings)).status, 200);
  assert.equal((await membershipSettings(f.db)).plans[1].priceRupees, 549);
  assert.equal((await f.db.collection("users").findOne({ _id: f.creatorId })).creatorMembership.trialEndsAt, f.trialEndsAt);
});
test("QR upload and screenshot submission persist a pending plan snapshot without granting access", async t => {
  const f = await fixture(t);
  const path = "/creator/membership/payments?planId=monthly&priceRupees=199&durationDays=30";
  assert.equal((await f.request(path, "creator", "POST", png, true)).status, 503);
  assert.equal((await f.request("/admin/membership/qr", "creator", "POST", png, true)).status, 401);
  const qr = await f.request("/admin/membership/qr", "admin", "POST", png, true);
  assert.equal(qr.status, 201);
  assert.ok(qr.body.qrUrl);
  assert.equal((await f.request(path.replace("199", "99"), "creator", "POST", png, true)).status, 409);
  const submitted = await f.request(path, "creator", "POST", png, true);
  assert.equal(submitted.status, 201);
  assert.equal(submitted.body.status, "pending");
  assert.equal(submitted.body.plan.priceRupees, 199);
  assert.equal((await f.db.collection("users").findOne({ _id: f.creatorId })).creatorMembership.paidUntil, undefined);
  assert.equal((await f.request(path, "creator", "POST", png, true)).status, 409);
  assert.equal((await f.request("/creator/membership/payments")).body.length, 1);
  assert.equal((await f.request(submitted.body.proofUrl, "creator")).status, 401);
  const payment = f.db.collection("membershipPayments").documents[0];
  assert.equal((await f.request(`/membership/qr/${payment.imageId}`, "creator")).status, 404);
  assert.equal(f.db.collection("notifications").documents[0].recipientId, "admin");
});
test("approval credits the submitted duration once and preserves existing paid days", async t => {
  const f = await fixture(t);
  const paidUntil = new Date(Date.now() + 10 * 86400000).toISOString();
  await f.db.collection("users").updateOne({ _id: f.creatorId }, { $set: { "creatorMembership.paidUntil": paidUntil } });
  const payment = await f.addPayment(defaultMembershipSettings.plans[1]);
  const changedSettings = clone(defaultMembershipSettings);
  changedSettings.plans[1].durationDays = 120;
  changedSettings.plans[1].priceRupees = 999;
  await f.request("/admin/membership", "admin", "PUT", changedSettings);
  const path = `/admin/membership/payments/${payment._id}/review`;
  assert.equal((await f.request(path, "creator", "POST", { decision: "approved" })).status, 401);
  assert.equal((await f.request(path, "admin", "POST", { decision: "approved" })).status, 200);
  const user = await f.db.collection("users").findOne({ _id: f.creatorId });
  assert.equal(user.creatorMembership.paidUntil, membershipExtension(paidUntil, 90));
  assert.equal((await f.request(path, "admin", "POST", { decision: "approved" })).status, 409);
  assert.equal(f.db.collection("notifications").documents[0].recipientId, f.creatorId.toString());
});
test("oversized images are explicitly rejected and disabled plans cannot be purchased", async t => {
  const f = await fixture(t);
  const tooLarge = Buffer.alloc(8 * 1024 * 1024 + 1);
  png.copy(tooLarge);
  assert.equal((await f.request("/admin/membership/qr", "admin", "POST", tooLarge, true)).status, 413);
  assert.equal((await f.request("/admin/membership/qr", "admin", "POST", png, true)).status, 201);
  assert.equal((await f.request("/creator/membership/payments?planId=quarterly&priceRupees=597&durationDays=90", "creator", "POST", png, true)).status, 400);
  assert.equal((await f.request("/creator/membership/payments?planId=monthly&priceRupees=199&durationDays=30", "creator", "POST", Buffer.from("not an image"), true)).status, 400);
  assert.equal(f.db.collection("membershipPayments").documents.length, 0);
});
test("an interrupted approval can resume without double credit", async t => {
  const f = await fixture(t);
  const payment = await f.addPayment();
  const collection = f.db.collection("membershipPayments");
  const update = collection.updateOne;
  let fail = true;
  collection.updateOne = async function (...args) {
    if (fail) { fail = false; throw new Error("Simulated persistence outage"); }
    return update.apply(this, args);
  };
  const path = `/admin/membership/payments/${payment._id}/review`;
  assert.equal((await f.request(path, "admin", "POST", { decision: "approved" })).status, 500);
  const user = await f.db.collection("users").findOne({ _id: f.creatorId });
  const expiry = user.creatorMembership.paidUntil;
  assert.equal(payment.status, "approving");
  assert.equal((await f.request(path, "admin", "POST", { decision: "approved" })).status, 200);
  assert.equal(user.creatorMembership.paidUntil, expiry);
});
test("rejection needs a reason, does not activate membership, and permits a new submission", async t => {
  const f = await fixture(t);
  const payment = await f.addPayment();
  const path = `/admin/membership/payments/${payment._id}/review`;
  assert.equal((await f.request(path, "admin", "POST", { decision: "rejected" })).status, 400);
  assert.equal((await f.request(path, "admin", "POST", { decision: "rejected", reason: "Payment not received" })).status, 200);
  assert.equal((await f.db.collection("users").findOne({ _id: f.creatorId })).creatorMembership.paidUntil, undefined);
  assert.equal((await f.request("/creator/membership/payments")).body[0].reason, "Payment not received");
  assert.equal((await f.request(path, "admin", "POST", { decision: "approved" })).status, 409);
  await f.addPayment();
  assert.equal((await f.request("/admin/membership/payments", "admin")).body.length, 1);
});
