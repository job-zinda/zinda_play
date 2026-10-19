import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { ObjectId } from "mongodb";
import { memoryDatabase } from "../test-support/memory-database.js";
import { normalizePayoutNumber, parseRupeeAmount, registerCreatorWithdrawalRoutes } from "./creator-withdrawals.js";

async function fixture(t, { earned = 150 } = {}) {
  const db = memoryDatabase();
  const creatorId = new ObjectId();
  await db.collection("users").insertOne({ _id: creatorId, username: "maya", accountType: "member" });
  const wallet = { earned };
  const app = express();
  app.use(express.json());
  registerCreatorWithdrawalRoutes(app, {
    getDb: () => db,
    asyncRoute: handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next),
    requireCreator: (req, res, next) => {
      if (req.get("authorization") !== "creator") return res.status(401).json({ error: "Member authentication required" });
      req.creatorId = creatorId;
      req.session = { username: "maya" };
      next();
    },
    requireAdmin: (req, res, next) => req.get("authorization") === "admin" ? next() : res.status(401).json({ error: "Admin authentication required" }),
    creatorWallet: async () => ({ estimatedEarningsRupees: wallet.earned, videos: [] })
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (path, { method = "GET", body, as = "creator" } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, body: body && JSON.stringify(body),
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(as ? { Authorization: as } : {}) }
    });
    return { status: response.status, body: await response.json() };
  };
  const notifications = recipientId => db.collection("notifications").documents.filter(item => item.recipientId === recipientId);
  return { db, creatorId: creatorId.toString(), wallet, request, notifications };
}

test("amounts and payout numbers are validated", () => {
  assert.equal(parseRupeeAmount("100"), 10000);
  assert.equal(parseRupeeAmount("1,250.5"), 125050);
  assert.equal(parseRupeeAmount(99.99), 9999);
  for (const bad of ["", "abc", "-5", "1.234", 0, null]) assert.equal(parseRupeeAmount(bad), null);
  assert.equal(normalizePayoutNumber("+91 98475 61998"), "9847561998");
  assert.equal(normalizePayoutNumber("09847561998"), "9847561998");
  assert.equal(normalizePayoutNumber("12345"), null);
  assert.equal(normalizePayoutNumber("5847561998"), null);
});

test("creators below ₹100 cannot withdraw", async t => {
  const f = await fixture(t, { earned: 99.5 });
  const wallet = (await f.request("/creator/wallet")).body;
  assert.equal(wallet.availableRupees, 99.5);
  assert.equal(wallet.minimumWithdrawalRupees, 100);
  assert.equal(wallet.canWithdraw, false);
  const response = await f.request("/creator/withdrawals", { method: "POST", body: { payoutApp: "gpay", payoutNumber: "9847561998" } });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /at least ₹100/);
});

test("creators request the full or a custom amount, admins pay or reject with a reason", async t => {
  const f = await fixture(t, { earned: 350 });
  const post = body => f.request("/creator/withdrawals", { method: "POST", body });
  assert.equal((await post({ payoutApp: "paytm", payoutNumber: "9847561998" })).status, 400);
  assert.equal((await post({ payoutApp: "gpay", payoutNumber: "123" })).status, 400);
  assert.equal((await post({ payoutApp: "gpay", payoutNumber: "9847561998", amountRupees: 50 })).status, 400);
  assert.equal((await post({ payoutApp: "gpay", payoutNumber: "9847561998", amountRupees: 351 })).status, 400);

  const first = await post({ payoutApp: "phonepe", payoutNumber: "+91 98475 61998", amountRupees: "120.50" });
  assert.equal(first.status, 201);
  assert.equal(first.body.amountRupees, 120.5);
  assert.equal(first.body.payoutNumber, "9847561998");
  assert.equal(first.body.payoutAppLabel, "PhonePe");
  assert.equal((await post({ payoutApp: "gpay", payoutNumber: "9847561998" })).status, 409);
  let wallet = (await f.request("/creator/wallet")).body;
  assert.equal(wallet.pendingWithdrawalRupees, 120.5);
  assert.equal(wallet.availableRupees, 229.5);
  assert.equal(wallet.hasPendingWithdrawal, true);
  assert.equal(wallet.canWithdraw, false);
  assert.equal(f.notifications("admin").filter(item => item.type === "creator_withdrawal_review").length, 1);

  assert.equal((await f.request("/admin/creator-withdrawals", { as: "creator" })).status, 401);
  const queue = (await f.request("/admin/creator-withdrawals", { as: "admin" })).body;
  assert.equal(queue.pending.length, 1);
  assert.equal(queue.pending[0].username, "maya");
  assert.equal(queue.pending[0].availableAfterRupees, 229.5);

  const reject = id => f.request(`/admin/creator-withdrawals/${id}`, { method: "PATCH", as: "admin", body: { decision: "rejected", reason: "" } });
  assert.equal((await reject(first.body.id)).status, 400);
  const rejected = await f.request(`/admin/creator-withdrawals/${first.body.id}`, { method: "PATCH", as: "admin", body: { decision: "rejected", reason: "Number not on PhonePe" } });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.rejectionReason, "Number not on PhonePe");
  assert.match(f.notifications(f.creatorId).at(-1).message, /Reason: Number not on PhonePe/);
  assert.ok(f.notifications("admin").find(item => item.type === "creator_withdrawal_review").readAt);
  wallet = (await f.request("/creator/wallet")).body;
  assert.equal(wallet.availableRupees, 350);

  const full = await post({ payoutApp: "gpay", payoutNumber: "9847561998" });
  assert.equal(full.body.amountRupees, 350);
  const paid = await f.request(`/admin/creator-withdrawals/${full.body.id}`, { method: "PATCH", as: "admin", body: { decision: "paid" } });
  assert.equal(paid.body.status, "paid");
  assert.equal((await f.request(`/admin/creator-withdrawals/${full.body.id}`, { method: "PATCH", as: "admin", body: { decision: "paid" } })).status, 404);
  wallet = (await f.request("/creator/wallet")).body;
  assert.equal(wallet.withdrawnRupees, 350);
  assert.equal(wallet.availableRupees, 0);
  assert.deepEqual(wallet.withdrawals.map(item => item.status).sort(), ["paid", "rejected"]);
  assert.equal(f.notifications(f.creatorId).at(-1).type, "creator_withdrawal_paid");
  assert.ok(f.notifications("admin").some(item => item.type === "creator_withdrawal_marked_paid"));

  // New earnings after a payout become available again.
  f.wallet.earned = 400;
  assert.equal((await f.request("/creator/wallet")).body.availableRupees, 50);
});

test("admins can send an amount to a creator's wallet", async t => {
  const f = await fixture(t, { earned: 40 });
  const send = body => f.request("/admin/creator-credits", { method: "POST", as: "admin", body });
  assert.equal((await f.request("/admin/creator-credits", { method: "POST", as: "creator", body: {} })).status, 401);
  assert.equal((await send({ creatorId: f.creatorId, amountRupees: 0 })).status, 400);
  assert.equal((await send({ creatorId: new ObjectId().toString(), amountRupees: 10 })).status, 404);
  const credit = await send({ creatorId: f.creatorId, amountRupees: "60", note: "Festival bonus" });
  assert.equal(credit.status, 201);
  assert.equal(credit.body.username, "maya");
  const wallet = (await f.request("/creator/wallet")).body;
  assert.equal(wallet.adminCreditsRupees, 60);
  assert.equal(wallet.availableRupees, 100);
  assert.equal(wallet.canWithdraw, true);
  assert.match(f.notifications(f.creatorId).at(-1).message, /added ₹60 to your wallet: Festival bonus/);
  assert.equal((await f.request("/admin/creator-withdrawals", { as: "admin" })).body.credits.length, 1);
});
