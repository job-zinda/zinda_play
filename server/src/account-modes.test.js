import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { accountRole, approvedCreatorQuery, registerAccountModeRoutes } from "./account-modes.js";

test("promoter creator access is opt-in and never bypasses approval", () => {
  assert.equal(accountRole({ accountType: "promoter" }, "creator"), "promoter");
  const promoter = { accountType: "promoter", creatorRequested: true, approvalStatus: "pending" };
  assert.equal(accountRole(promoter, "creator"), "member");
  assert.equal(accountRole(promoter, "promoter"), "promoter");
  assert.equal(accountRole({ ...promoter, approvalStatus: "approved" }, "member"), "creator");
  assert.equal(accountRole({ ...promoter, approvalStatus: "rejected" }, "creator"), "member");
  assert.equal(accountRole({ accountType: "business" }, "creator"), "business");
  assert.equal(accountRole({ accountType: "member", approvalStatus: "approved" }), "creator");
  assert.ok(approvedCreatorQuery.$and.some(condition => condition.$or?.some(item => item.creatorRequested === true)));
});

async function fixture(t, accountType = "promoter") {
  const user = { _id: "user-1", username: "promoter-test", accountType, promoterRewards: 150, withdrawalHistory: ["paid-1"], creatorMembership: null };
  const notifications = [];
  const session = { userId: user._id, role: accountType, username: user.username };
  const collection = {
    async findOne() { return user; },
    async updateOne(filter, update) {
      if (filter.creatorRequested?.$ne === true && user.creatorRequested === true) return { matchedCount: 0 };
      Object.assign(user, update.$set);
      return { matchedCount: 1 };
    }
  };
  const app = express();
  app.use(express.json());
  let saved = 0;
  registerAccountModeRoutes(app, {
    users: () => collection,
    notifications: () => ({ async insertOne(notification) { notifications.push(notification); } }),
    requireMember: (req, res, next) => {
      if (req.get("authorization") !== "Bearer test") return res.status(401).json({ error: "Sign in." });
      req.session = session;
      next();
    },
    asyncRoute: handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next),
    publicUser: account => ({ username: account.username }),
    saveSession: () => saved++, userId: req => req.session.userId
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function switchMode(mode, token = "test") {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/account/mode`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mode })
    });
    return { status: response.status, body: await response.json() };
  }
  return { user, session, notifications, switchMode, saved: () => saved };
}

test("switching applies once, preserves promoter data, and follows normal approval before creator access", async t => {
  const f = await fixture(t);
  assert.equal((await f.switchMode("creator", "invalid")).status, 401);
  assert.equal((await f.switchMode("admin")).status, 400);
  const application = await f.switchMode("creator");
  assert.equal(application.status, 200);
  assert.equal(application.body.role, "member");
  assert.equal(f.user.approvalStatus, "pending");
  assert.equal(f.user.creatorMembership, null);
  assert.equal(f.notifications.length, 1);
  assert.equal((await f.switchMode("promoter")).body.role, "promoter");
  assert.equal((await f.switchMode("creator")).body.role, "member");
  assert.equal(f.notifications.length, 1);
  f.user.approvalStatus = "approved";
  assert.equal((await f.switchMode("creator")).body.role, "creator");
  assert.equal((await f.switchMode("promoter")).body.role, "promoter");
  assert.equal(f.user.accountType, "promoter");
  assert.equal(f.user.promoterRewards, 150);
  assert.deepEqual(f.user.withdrawalHistory, ["paid-1"]);
  assert.ok(f.saved() >= 5);
});

test("a rejected creator application cannot be reset by switching modes", async t => {
  const f = await fixture(t);
  await f.switchMode("creator");
  f.user.approvalStatus = "rejected";
  await f.switchMode("promoter");
  const response = await f.switchMode("creator");
  assert.equal(response.body.role, "member");
  assert.equal(response.body.approvalStatus, "rejected");
  assert.equal(f.notifications.length, 1);
});

test("normal and business accounts cannot obtain promoter mode", async t => {
  for (const type of ["member", "business"]) {
    const f = await fixture(t, type);
    assert.equal((await f.switchMode("promoter")).status, 403);
  }
});
