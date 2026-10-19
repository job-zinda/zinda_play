import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { ObjectId } from "mongodb";
import { memoryDatabase } from "../test-support/memory-database.js";
import { registerAccountSecurityRoutes } from "./account-security.js";

async function fixture(t) {
  const db = memoryDatabase();
  const user = { _id: new ObjectId(), username: "viewer", usernameKey: "viewer", passwordHash: "old-hash", email: "old@example.test", recoveryEmail: "old@example.test" };
  await db.collection("users").insertOne(user);
  const originalUpdate = db.collection("users").updateOne;
  db.collection("users").updateOne = async function(filter, update, options) {
    if (update.$set?.usernameKey && this.documents.some(row => row._id.toString() !== filter._id.toString() && row.usernameKey === update.$set.usernameKey)) {
      throw Object.assign(new Error("Duplicate key"), { code: 11000 });
    }
    return originalUpdate.call(this, filter, update, options);
  };
  const sessions = [];
  const app = express();
  app.use(express.json());
  registerAccountSecurityRoutes(app, {
    getDb: () => db, asyncRoute: handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next),
    requireAccount: (req, res, next) => {
      if (!req.get("authorization")) return res.status(401).json({ error: "Sign in." });
      req.session = { userId: user._id.toString(), role: req.get("x-role") || "member" };
      next();
    },
    userId: () => user._id,
    passwordMatches: async (password, account) => password === "current-password" && account.passwordHash === "old-hash",
    updateSessions: async (...args) => sessions.push(args)
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(path, body = {}, { signedIn = false, method = "POST", role = "member" } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { "Content-Type": "application/json", ...(signedIn ? { Authorization: "Bearer test", "x-role": role } : {}) },
      ...(method !== "GET" ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, body: await response.json() };
  }
  return { db, user, sessions, request };
}

test("removed email endpoints reject old clients and links without changing account data", async t => {
  const f = await fixture(t);
  await f.db.collection("accountTokens").insertOne({ _id: "legacy-token", userId: f.user._id, purpose: "reset" });
  for (const signedIn of [false, true]) {
    for (const path of ["/account/recovery-email", "/account/verification-otp", "/auth/recovery", "/auth/account-action"]) {
      const result = await f.request(path, { purpose: "reset", token: "legacy-token", email: "new@example.test", password: "new-password" }, { signedIn });
      assert.equal(result.status, 410);
      assert.match(result.body.error, /removed/);
    }
  }
  assert.equal(f.user.passwordHash, "old-hash");
  assert.equal(f.user.recoveryEmail, "old@example.test");
  assert.equal(f.db.collection("accountTokens").documents.length, 1);
  assert.deepEqual(f.sessions, []);
});

test("security profile requires authentication and exposes only username", async t => {
  const f = await fixture(t);
  assert.equal((await f.request("/account/security", {}, { method: "GET" })).status, 401);
  assert.deepEqual((await f.request("/account/security", {}, { signedIn: true, method: "GET" })).body, { username: "viewer" });
});

test("username changes retain ownership and update sessions for every personal role", async t => {
  const f = await fixture(t);
  const id = f.user._id.toString();
  const body = { username: "renamed", password: "current-password" };
  assert.equal((await f.request("/account/username", body, { method: "PATCH" })).status, 401);
  assert.equal((await f.request("/account/username", { ...body, password: "wrong" }, { signedIn: true, method: "PATCH" })).status, 403);
  assert.equal((await f.request("/account/username", { ...body, username: "!" }, { signedIn: true, method: "PATCH" })).status, 400);
  for (const role of ["member", "creator", "promoter", "business"]) {
    const result = await f.request("/account/username", { ...body, username: `renamed-${role}` }, { signedIn: true, role, method: "PATCH" });
    assert.equal(result.status, 200);
    assert.equal(f.user._id.toString(), id);
    assert.deepEqual(f.sessions.at(-1), [id, `renamed-${role}`]);
  }
  await f.db.collection("users").insertOne({ _id: new ObjectId(), usernameKey: "taken" });
  assert.equal((await f.request("/account/username", { ...body, username: "taken" }, { signedIn: true, method: "PATCH" })).status, 409);
});

test("username change rate limit remains enforced", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 20; i++) {
    assert.equal((await f.request("/account/username", {}, { signedIn: true, method: "PATCH" })).status, 400);
  }
  assert.equal((await f.request("/account/username", {}, { signedIn: true, method: "PATCH" })).status, 429);
});
