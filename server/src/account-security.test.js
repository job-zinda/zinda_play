import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { memoryDatabase } from "../test-support/memory-database.js";
import { registerAccountSecurityRoutes, sendAccountEmail } from "./account-security.js";

async function fixture(t) {
  const db = memoryDatabase();
  const user = { _id: new ObjectId(), username: "viewer", usernameKey: "viewer", passwordHash: "old-hash", passwordSalt: "old-salt" };
  await db.collection("users").insertOne(user);
  const originalUpdate = db.collection("users").updateOne;
  db.collection("users").updateOne = async function(filter, update, options) {
    for (const key of ["usernameKey", "recoveryEmail"]) {
      if (update.$set?.[key] && this.documents.some(row => row._id.toString() !== filter._id.toString() && row[key] === update.$set[key])) {
        throw Object.assign(new Error("Duplicate key"), { code: 11000 });
      }
    }
    return originalUpdate.call(this, filter, update, options);
  };
  const emails = [], sessions = [];
  let time = new Date("2026-10-19T10:00:00Z").getTime();
  let deliveryFailure = false;
  const app = express();
  app.use(express.json());
  const security = registerAccountSecurityRoutes(app, {
    getDb: () => db, asyncRoute: handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next),
    requireAccount: (req, res, next) => {
      if (!req.get("authorization")) return res.status(401).json({ error: "Sign in." });
      req.session = { userId: user._id.toString(), role: req.get("x-role") || "member", username: user.username };
      next();
    },
    userId: () => user._id, publicWebsite: "https://zindaplay.com",
    hashPassword: async password => ({ salt: "new-salt", hash: `hashed:${password}` }),
    passwordMatches: async (password, account) => password === "current-password" && account.passwordHash === "old-hash",
    updateSessions: async (...args) => sessions.push(args),
    sendEmail: async (...args) => {
      if (deliveryFailure) throw Object.assign(new Error("Email service unavailable"), { statusCode: 502 });
      emails.push(args);
    },
    now: () => time
  });
  app.use((error, req, res, next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(path, body, { signedIn = false, method = "POST", role = "member" } = {}) {
    if (body?.purpose === "verify" && /^\d{6}$/.test(body.token) && !Object.hasOwn(body, "email")) {
      body = { ...body, email: emails.findLast(email => email[1].includes("OTP"))?.[0] };
    }
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { "Content-Type": "application/json", ...(signedIn ? { Authorization: "Bearer test", "x-role": role } : {}) },
      ...(method !== "GET" ? { body: JSON.stringify(body || {}) } : {})
    });
    return { status: response.status, body: await response.json() };
  }
  const code = () => emails.at(-1)[2].match(/#token=([a-f0-9]{64})|\n(\d{6})\n/).slice(1).find(Boolean);
  async function verify(email = "person@example.test") {
    const sent = await request("/account/recovery-email", { email, password: "current-password" }, { signedIn: true });
    assert.equal(sent.status, 200);
    return request("/auth/account-action", { purpose: "verify", token: code() });
  }
  return { db, user, emails, sessions, request, code, verify, security, advance: ms => { time += ms; }, failDelivery: () => { deliveryFailure = true; } };
}

test("signup email gets a verification code that enables recovery, and delivery failure does not throw", async t => {
  const f = await fixture(t);
  f.user.email = "signup@example.test";
  f.user.pendingRecoveryEmail = "signup@example.test";
  assert.equal(await f.security.sendSignupVerification(f.user, "signup@example.test"), true);
  assert.equal(f.emails.at(-1)[0], "signup@example.test");
  assert.equal((await f.request("/auth/account-action", { purpose: "verify", token: f.code() })).status, 200);
  assert.equal(f.user.recoveryEmail, "signup@example.test");
  await f.request("/auth/recovery", { email: "signup@example.test", purpose: "password" });
  assert.match(f.emails.at(-1)[1], /Reset/);
  f.failDelivery();
  assert.equal(await f.security.sendSignupVerification(f.user, "signup@example.test"), false);
  assert.equal(f.db.collection("accountTokens").documents.filter(row => row.purpose === "verify").length, 0);
});

test("recovery email requires authentication, password, and single-use verification", async t => {
  const f = await fixture(t);
  assert.equal((await f.request("/account/security", null, { method: "GET" })).status, 401);
  assert.equal((await f.request("/account/recovery-email", { email: "person@example.test", password: "wrong" }, { signedIn: true })).status, 403);
  assert.equal((await f.request("/account/recovery-email", { email: "bad", password: "current-password" }, { signedIn: true })).status, 400);
  assert.equal((await f.verify(" Person@Example.test ")).status, 200);
  assert.equal(f.user.recoveryEmail, "person@example.test");
  assert.equal(f.user.pendingRecoveryEmail, undefined);
  assert.equal((await f.request("/auth/account-action", { purpose: "verify", token: f.code() })).status, 400);
  assert.ok(!JSON.stringify(f.db.collection("accountTokens").documents).includes(f.code()));
});

test("verification OTP is six digits, bound to the recipient and stored only as a hash", async t => {
  const f = await fixture(t);
  await f.request("/account/recovery-email", { email: "person@example.test", password: "current-password" }, { signedIn: true });
  const code = f.code();
  assert.match(code, /^[1-9]\d{5}$/);
  const record = f.db.collection("accountTokens").documents[0];
  assert.equal(typeof record.codeHash, "string");
  assert.ok(!JSON.stringify(record).includes(code));
  assert.equal((await f.request("/auth/account-action", { purpose: "verify", token: code, email: "" })).status, 400);
  assert.equal((await f.request("/auth/account-action", { purpose: "verify", token: code, email: "other@example.test" })).status, 400);
  assert.equal((await f.request("/auth/account-action", { purpose: "verify", token: code, email: " PERSON@EXAMPLE.TEST " })).status, 200);
  assert.equal(f.user.recoveryEmail, "person@example.test");
});

test("signup OTP resend uses only the signed-in account's pending email and respects limits", async t => {
  const f = await fixture(t);
  f.user.pendingRecoveryEmail = "signup@example.test";
  assert.equal((await f.request("/account/verification-otp")).status, 401);
  for (let i = 0; i < 5; i++) {
    const sent = await f.request("/account/verification-otp", { email: "attacker@example.test" }, { signedIn: true });
    assert.equal(sent.status, 200);
    assert.equal(f.emails.at(-1)[0], "signup@example.test");
    assert.match(f.code(), /^\d{6}$/);
  }
  assert.equal((await f.request("/account/verification-otp", {}, { signedIn: true })).status, 429);
  f.advance(15 * 60 * 1000);
  assert.equal((await f.request("/auth/account-action", { purpose: "verify", token: f.code() })).status, 400);
  assert.equal((await f.request("/account/verification-otp", {}, { signedIn: true })).status, 200);
  assert.equal((await f.request("/auth/account-action", { purpose: "verify", token: f.code() })).status, 200);
  assert.equal((await f.request("/account/verification-otp", {}, { signedIn: true })).status, 409);
});

test("resend delivery failure is visible and leaves no working OTP", async t => {
  const f = await fixture(t);
  f.user.pendingRecoveryEmail = "signup@example.test";
  f.failDelivery();
  assert.equal((await f.request("/account/verification-otp", {}, { signedIn: true })).status, 502);
  assert.equal(f.db.collection("accountTokens").documents.length, 0);
});

test("five wrong OTPs lock verification and resending replaces the challenge", async t => {
  const f = await fixture(t);
  const send = () => f.request("/account/recovery-email", { email: "person@example.test", password: "current-password" }, { signedIn: true });
  await send();
  const code = f.code();
  const wrong = code === "123456" ? "654321" : "123456";
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await f.request("/auth/account-action", { purpose: "verify", token: wrong })).status, 400);
  }
  assert.equal((await f.request("/auth/account-action", { purpose: "verify", token: code })).status, 400);
  await send();
  assert.equal(f.db.collection("accountTokens").documents.filter(row => row.purpose === "verify").length, 1);
  assert.equal((await f.request("/auth/account-action", { purpose: "verify", token: f.code() })).status, 200);
});

test("OTP expires after ten minutes and cannot be consumed concurrently twice", async t => {
  const f = await fixture(t);
  await f.request("/account/recovery-email", { email: "person@example.test", password: "current-password" }, { signedIn: true });
  const code = f.code();
  f.advance(10 * 60 * 1000);
  assert.equal((await f.request("/auth/account-action", { purpose: "verify", token: code })).status, 400);
  await f.request("/account/recovery-email", { email: "person@example.test", password: "current-password" }, { signedIn: true });
  const fresh = f.code();
  const results = await Promise.all([1, 2].map(() => f.request("/auth/account-action", { purpose: "verify", token: fresh })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
});

test("previously emailed long verification links remain valid during deployment", async t => {
  const f = await fixture(t);
  const token = "a".repeat(64);
  f.user.pendingRecoveryEmail = "person@example.test";
  await f.db.collection("accountTokens").insertOne({
    _id: createHash("sha256").update(token).digest("hex"),
    userId: f.user._id, purpose: "verify", email: "person@example.test",
    passwordHash: f.user.passwordHash, expiresAt: new Date("2026-10-19T10:30:00Z")
  });
  assert.equal((await f.request("/auth/account-action", { purpose: "verify", token })).status, 200);
  assert.equal(f.user.recoveryEmail, "person@example.test");
});

test("forgot username only sends verified accounts and never returns usernames publicly", async t => {
  const f = await fixture(t);
  f.user.pendingRecoveryEmail = "pending@example.test";
  const missing = await f.request("/auth/recovery", { email: "pending@example.test", purpose: "username" });
  assert.equal(f.emails.length, 0);
  await f.verify();
  const found = await f.request("/auth/recovery", { email: "person@example.test", purpose: "username" });
  assert.deepEqual(found.body, missing.body);
  assert.ok(f.emails.at(-1)[2].includes("viewer"));
  assert.ok(!JSON.stringify(found.body).includes("viewer"));
});

test("password reset validates length, revokes every session and invalidates all old tokens", async t => {
  const f = await fixture(t);
  await f.verify();
  await f.request("/auth/recovery", { email: "person@example.test", purpose: "password" });
  const first = f.code();
  await f.request("/auth/recovery", { email: "person@example.test", purpose: "password" });
  const second = f.code();
  assert.notEqual(first, second);
  assert.equal((await f.request("/auth/account-action", { token: first, purpose: "reset", password: "short" })).status, 400);
  assert.equal((await f.request("/auth/account-action", { token: first, purpose: "reset", password: "new-password" })).status, 200);
  assert.equal(f.user.passwordHash, "hashed:new-password");
  assert.equal(f.user.passwordSalt, "new-salt");
  assert.deepEqual(f.sessions.at(-1), [f.user._id.toString(), "viewer", true]);
  assert.equal((await f.request("/auth/account-action", { token: second, purpose: "reset", password: "another-password" })).status, 400);
});

test("expired and wrong-purpose codes cannot update an account", async t => {
  const f = await fixture(t);
  await f.request("/account/recovery-email", { email: "person@example.test", password: "current-password" }, { signedIn: true });
  const token = f.code();
  assert.equal((await f.request("/auth/account-action", { token, purpose: "reset", password: "new-password" })).status, 400);
  f.advance(31 * 60 * 1000);
  assert.equal((await f.request("/auth/account-action", { token, purpose: "verify" })).status, 400);
  assert.equal(f.user.recoveryEmail, undefined);
});

test("changing verified email invalidates prior reset links; unverified replacement keeps old recovery", async t => {
  const f = await fixture(t);
  await f.verify();
  await f.request("/auth/recovery", { email: "person@example.test", purpose: "password" });
  const oldReset = f.code();
  await f.request("/account/recovery-email", { email: "replacement@example.test", password: "current-password" }, { signedIn: true });
  assert.equal(f.user.recoveryEmail, "person@example.test");
  assert.equal((await f.request("/auth/account-action", { purpose: "verify", token: f.code() })).status, 200);
  assert.equal((await f.request("/auth/account-action", { purpose: "reset", token: oldReset, password: "new-password" })).status, 400);
});

test("username edits apply to every personal role, reauthenticate and retain ownership", async t => {
  const f = await fixture(t);
  for (const role of ["member", "creator", "promoter", "business"]) {
    const response = await f.request("/account/username", { username: `new-${role}`, password: "current-password" }, { signedIn: true, method: "PATCH", role });
    assert.equal(response.status, 200);
    assert.equal(f.user.usernameKey, `new-${role}`);
    assert.deepEqual(f.sessions.at(-1), [f.user._id.toString(), `new-${role}`]);
  }
  assert.equal((await f.request("/account/username", { username: "bad spaces", password: "current-password" }, { signedIn: true, method: "PATCH" })).status, 400);
  assert.equal((await f.request("/account/username", { username: "valid", password: "wrong" }, { signedIn: true, method: "PATCH" })).status, 403);
  await f.db.collection("users").insertOne({ _id: new ObjectId(), usernameKey: "taken" });
  assert.equal((await f.request("/account/username", { username: "Taken", password: "current-password" }, { signedIn: true, method: "PATCH" })).status, 409);
});

test("recovery email uniqueness is enforced at verification", async t => {
  const f = await fixture(t);
  await f.db.collection("users").insertOne({ _id: new ObjectId(), recoveryEmail: "person@example.test" });
  assert.equal((await f.verify()).status, 409);
  assert.equal(f.user.recoveryEmail, undefined);
});

test("deleted accounts cannot reset passwords or receive recovery emails", async t => {
  const f = await fixture(t);
  await f.verify();
  await f.request("/auth/recovery", { email: "person@example.test", purpose: "password" });
  const token = f.code();
  f.user.deletionStartedAt = "2026-10-19";
  assert.equal((await f.request("/auth/account-action", { token, purpose: "reset", password: "new-password" })).status, 400);
  const count = f.emails.length;
  assert.equal((await f.request("/auth/recovery", { email: "person@example.test", purpose: "password" })).status, 200);
  assert.equal(f.emails.length, count);
});

test("persistent limits and delivery errors are explicit, with failed tokens removed", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++) assert.equal((await f.request("/auth/recovery", { email: "unknown@example.test", purpose: "password" })).status, 200);
  assert.equal((await f.request("/auth/recovery", { email: "unknown@example.test", purpose: "password" })).status, 429);
  f.failDelivery();
  assert.equal((await f.request("/account/recovery-email", { email: "person@example.test", password: "current-password" }, { signedIn: true })).status, 502);
  assert.equal(f.db.collection("accountTokens").documents.length, 0);
});

test("Brevo integration uses transactional email endpoint and explicit configuration failures", async () => {
  await assert.rejects(sendAccountEmail("to@example.test", "subject", "body", { env: {} }), error => error.statusCode === 503);
  let payload;
  await sendAccountEmail("to@example.test", "subject", "body", {
    env: { BREVO_API_KEY: "test-key", BREVO_SENDER_EMAIL: "sender@example.test" },
    fetcher: async (url, options) => { payload = { url, options }; return { ok: true }; }
  });
  assert.equal(payload.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(payload.options.headers["api-key"], "test-key");
  assert.equal(JSON.parse(payload.options.body).textContent, "body");
  await assert.rejects(sendAccountEmail("to@example.test", "subject", "body", {
    env: { BREVO_API_KEY: "test-key", BREVO_SENDER_EMAIL: "sender@example.test" }, fetcher: async () => ({ ok: false })
  }), error => error.statusCode === 502);
});
