import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { accountRole, approvedCreatorQuery, initializeCreatorApplications, memberRewardsEligible, memberRewardsGuard, registerAccountModeRoutes } from "./account-modes.js";
import { memoryDatabase } from "../test-support/memory-database.js";

test("promoter creator access is opt-in and never bypasses approval", () => {
  assert.equal(accountRole({ accountType: "promoter" }, "creator"), "member");
  const promoter = { accountType: "promoter", creatorRequested: true, approvalStatus: "pending" };
  assert.equal(accountRole(promoter, "creator"), "member");
  assert.equal(accountRole(promoter, "promoter"), "member");
  assert.equal(accountRole({ ...promoter, approvalStatus: "approved" }, "member"), "creator");
  assert.equal(accountRole({ ...promoter, approvalStatus: "rejected" }, "creator"), "member");
  assert.equal(accountRole({ accountType: "business" }, "creator"), "business");
  assert.equal(accountRole({ accountType: "member", approvalStatus: "approved" }), "creator");
  assert.ok(approvedCreatorQuery.$and.some(condition => condition.$or?.some(item => item.creatorRequested === true)));
});

async function fixture(t, accountType = "promoter") {
  const user = { _id: "user-1", username: "promoter-test", accountType, ...(accountType === "member" ? { approvalStatus: "draft" } : {}), promoterRewards: 150, withdrawalHistory: ["paid-1"], creatorMembership: null };
  const notifications = [];
  const session = { userId: user._id, role: accountType, username: user.username };
  const collection = memoryDatabase().collection("users");
  await collection.insertOne(user);
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
  async function switchMode(mode, token = "test", path = "mode") {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/account/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mode })
    });
    return { status: response.status, body: await response.json() };
  }
  return { user, session, notifications, switchMode, apply: () => switchMode(null, "test", "creator-application"), saved: () => saved };
}

test("switching only opens a draft; photo and explicit submission are required, with promoter data retained", async t => {
  const f = await fixture(t);
  assert.equal((await f.switchMode("creator", "invalid")).status, 401);
  assert.equal((await f.switchMode("admin")).status, 400);
  const application = await f.switchMode("creator");
  assert.equal(application.status, 200);
  assert.equal(application.body.role, "member");
  assert.equal(f.user.approvalStatus, "draft");
  assert.equal(f.user.creatorMembership, null);
  assert.equal(f.notifications.length, 0);
  assert.equal((await f.apply()).status, 400);
  f.user.profilePhotoImageId = "photo";
  assert.equal((await f.apply()).status, 200);
  assert.equal(f.user.approvalStatus, "pending");
  assert.ok(f.user.creatorSubmittedAt);
  assert.equal(f.user.introVideoId, undefined);
  assert.equal((await f.apply()).status, 409);
  assert.equal((await f.switchMode("promoter")).body.role, "member");
  assert.equal((await f.switchMode("creator")).body.role, "member");
  assert.equal(f.notifications.length, 1);
  f.user.approvalStatus = "approved";
  assert.equal((await f.switchMode("creator")).body.role, "creator");
  assert.equal((await f.switchMode("promoter")).body.role, "member");
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
  assert.equal(f.notifications.length, 0);
});

test("viewers submit only once and rejected applicants can resubmit with a photo", async t => {
  const f = await fixture(t, "member");
  assert.equal((await f.apply()).status, 400);
  assert.equal(f.user.approvalStatus, "draft");
  f.user.profilePhotoImageId = "photo";
  const results = await Promise.all([f.apply(), f.apply()]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(f.notifications.length, 1);
  assert.equal(f.session.role, "member");
  f.user.approvalStatus = "rejected";
  assert.equal((await f.apply()).status, 200);
  f.user.approvalStatus = "approved";
  assert.equal((await f.apply()).status, 409);
});

test("legacy pending accounts become drafts without changing approved creators", async () => {
  const db = memoryDatabase();
  const users = db.collection("users");
  await users.insertOne({ _id: "legacy", approvalStatus: "pending" });
  await users.insertOne({ _id: "submitted", approvalStatus: "pending", creatorSubmittedAt: "2026-10-19" });
  await users.insertOne({ _id: "approved", approvalStatus: "approved" });
  await initializeCreatorApplications(db);
  await initializeCreatorApplications(db);
  assert.equal((await users.findOne({ _id: "legacy" })).approvalStatus, "draft");
  assert.equal((await users.findOne({ _id: "submitted" })).approvalStatus, "pending");
  assert.equal((await users.findOne({ _id: "approved" })).approvalStatus, "approved");
});

test("members can open the creator application without losing wallet access; businesses cannot", async t => {
  const member = await fixture(t, "member");
  assert.equal((await member.switchMode("creator")).body.role, "member");
  assert.equal(member.user.approvalStatus, "draft");
  assert.equal(member.notifications.length, 0);
  assert.equal((await member.switchMode("promoter")).status, 200);
  assert.equal(member.user.promoterRewards, 150);
  const business = await fixture(t, "business");
  assert.equal((await business.switchMode("promoter")).status, 403);
  assert.equal((await business.switchMode("creator")).status, 403);
});

test("all active non-business members qualify for watch rewards regardless of creator approval", () => {
  for (const accountType of ["member", "promoter"]) {
    for (const approvalStatus of [undefined, "draft", "pending", "approved", "rejected"]) {
      assert.equal(memberRewardsEligible({ accountType, approvalStatus }), true);
      assert.equal(memberRewardsEligible({ accountType, approvalStatus, deletionStartedAt: "now" }), false);
    }
  }
  assert.equal(memberRewardsEligible({ accountType: "business" }), false);
  assert.equal(memberRewardsEligible(null), false);
});

test("wallet and payout guard accepts existing member/creator/promoter sessions but rejects other accounts", async () => {
  const users = memoryDatabase().collection("users");
  const guard = memberRewardsGuard({
    sessionFor: req => req.auth,
    users: () => users,
    userId: id => id
  });
  await users.insertOne({ _id: "member", accountType: "member", approvalStatus: "draft", promoterRewards: 150 });
  await users.insertOne({ _id: "promoter", accountType: "promoter" });
  await users.insertOne({ _id: "business", accountType: "business" });
  await users.insertOne({ _id: "deleted", accountType: "member", deletionStartedAt: "now" });
  for (const role of ["member", "creator", "promoter"]) {
    for (const userId of ["member", "promoter"]) {
      const req = { auth: { role, userId } };
      let allowed = false;
      await guard(req, { status: () => assert.fail("Existing personal accounts must keep wallet access") }, () => { allowed = true; });
      assert.equal(allowed, true);
      assert.equal(req.promoterId, userId);
    }
  }
  for (const [auth, expected] of [
    [undefined, 401],
    [{ role: "admin", userId: "member" }, 401],
    [{ role: "business", userId: "business" }, 401],
    [{ role: "member", userId: "business" }, 403],
    [{ role: "member", userId: "deleted" }, 403],
    [{ role: "member", userId: "missing" }, 403]
  ]) {
    let status;
    const res = { status(code) { status = code; return this; }, json(body) { assert.ok(body.error); } };
    await guard({ auth }, res, () => assert.fail("Unauthorized wallet access"));
    assert.equal(status, expected);
  }
});
