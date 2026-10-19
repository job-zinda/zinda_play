import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const digest = value => createHash("sha256").update(value).digest("hex");
export const normalizeEmail = value => typeof value === "string" ? value.trim().toLowerCase() : "";
export const validEmail = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const genericRecovery = { message: "If a matching verified email exists, we have sent recovery instructions. Check your inbox and spam folder." };
const securityProfile = user => ({
  username: user.username, email: user.recoveryEmail || "", emailVerified: Boolean(user.recoveryEmail),
  pendingEmail: user.pendingRecoveryEmail || ""
});

export async function sendAccountEmail(to, subject, textContent, { env = process.env, fetcher = fetch } = {}) {
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
    throw Object.assign(new Error("Email verification and recovery are not configured. Contact support."), { statusCode: 503 });
  }
  const response = await fetcher("https://api.brevo.com/v3/smtp/email", {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", "api-key": env.BREVO_API_KEY },
    body: JSON.stringify({
      sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME || "Zinda Play" },
      to: [{ email: to }], subject, textContent
    })
  });
  if (!response.ok) throw Object.assign(new Error("Unable to send the recovery email. Please try again later."), { statusCode: 502 });
}

export async function initializeAccountSecurity(database) {
  await database.collection("users").createIndex({ recoveryEmail: 1 }, { unique: true, partialFilterExpression: { recoveryEmail: { $type: "string" } } });
  await database.collection("users").createIndex({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } });
  await database.collection("accountTokens").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await database.collection("accountRateLimits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

export function registerAccountSecurityRoutes(app, {
  getDb, requireAccount, asyncRoute, hashPassword, passwordMatches, userId, publicWebsite, updateSessions,
  sendEmail = sendAccountEmail, now = () => Date.now()
}) {
  const users = () => getDb().collection("users");
  const tokens = () => getDb().collection("accountTokens");
  const route = handler => asyncRoute(async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      await handler(req, res);
    } catch (error) {
      if (![502, 503].includes(error.statusCode)) throw error;
      console.error("Account email delivery failed:", error.message);
      res.status(error.statusCode).json({ error: error.message });
    }
  });
  async function limited(req, res, action, email = "") {
    for (const [key, limit] of [[`ip:${req.ip}`, 20], ...(email ? [[`email:${email}`, 5]] : [])]) {
      const window = Math.floor(now() / (15 * 60 * 1000));
      const row = await getDb().collection("accountRateLimits").findOneAndUpdate(
        { _id: digest(`${action}:${key}:${window}`) },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * 15 * 60 * 1000) } },
        { upsert: true, returnDocument: "after" }
      );
      if (row.count > limit) {
        res.status(429).json({ error: "Too many requests. Please try again in 15 minutes." });
        return true;
      }
    }
    return false;
  }
  async function issue(user, purpose, email) {
    const verification = purpose === "verify";
    const token = verification ? String(randomInt(100000, 1000000)) : randomBytes(32).toString("hex");
    const record = {
      _id: verification ? digest(`verify:${email}`) : digest(token),
      userId: user._id, purpose, email, passwordHash: user.passwordHash,
      ...(verification ? { codeHash: digest(`${user._id}:${email}:${token}`), attempts: 0 } : {}),
      expiresAt: new Date(now() + (verification ? 10 : 30) * 60 * 1000)
    };
    if (verification) {
      const { _id, ...fields } = record;
      await tokens().updateOne({ _id }, { $set: fields }, { upsert: true });
    } else {
      await tokens().insertOne(record);
    }
    const link = `${publicWebsite}/?account-action=${purpose}#token=${token}`;
    try {
      await sendEmail(email, verification ? "Your Zinda Play email verification OTP" : "Reset your Zinda Play password",
        verification
          ? `Your Zinda Play email verification OTP is:\n${token}\n\nEnter this six-digit code with your email address in Zinda Play. Expires in 10 minutes. Only the latest OTP works. Do not share this code. If you did not request this, ignore this email.`
          : `Reset your password using this link:\n${link}\n\nOr paste this code into the Zinda Play app:\n${token}\n\nExpires in 30 minutes. If you did not request this, ignore this email.`);
    } catch (error) {
      await tokens().deleteOne({ _id: record._id, ...(verification ? { codeHash: record.codeHash } : {}) });
      throw error;
    }
  }
  app.get("/api/account/security", requireAccount, route(async (req, res) => {
    const user = await users().findOne({ _id: userId(req) });
    if (!user) return res.status(404).json({ error: "Account not found." });
    res.json(securityProfile(user));
  }));
  app.patch("/api/account/username", requireAccount, route(async (req, res) => {
    if (await limited(req, res, "username")) return;
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) return res.status(400).json({ error: "Username must be 3-32 letters, numbers, dots, underscores, or hyphens." });
    if (process.env.ADMIN_USERNAME?.trim().toLowerCase() === username.toLowerCase()) return res.status(409).json({ error: "That username is reserved." });
    const user = await users().findOne({ _id: userId(req) });
    if (!user || typeof req.body?.password !== "string" || !await passwordMatches(req.body.password, user)) {
      return res.status(403).json({ error: "Enter your current password to change your username." });
    }
    try {
      const changed = await users().updateOne({ _id: user._id, passwordHash: user.passwordHash },
        { $set: { username, usernameKey: username.toLowerCase() } });
      if (!changed.matchedCount) return res.status(409).json({ error: "Your account changed. Sign in again and retry." });
    } catch (error) {
      if (error.code !== 11000) throw error;
      return res.status(409).json({ error: "That username is already taken." });
    }
    await updateSessions(user._id.toString(), username);
    req.session.username = username;
    res.json({ username, message: "Username updated. Use your new username to sign in." });
  }));
  app.post("/api/account/recovery-email", requireAccount, route(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid recovery email." });
    if (await limited(req, res, "verify", email)) return;
    const user = await users().findOne({ _id: userId(req) });
    if (!user || typeof req.body?.password !== "string" || !await passwordMatches(req.body.password, user)) {
      return res.status(403).json({ error: "Enter your current password to set a recovery email." });
    }
    await users().updateOne({ _id: user._id }, { $set: { pendingRecoveryEmail: email } });
    await issue(user, "verify", email);
    res.json({ message: "Verification OTP sent. Enter the six-digit code from your email within 10 minutes." });
  }));
  app.post("/api/account/verification-otp", requireAccount, route(async (req, res) => {
    const user = await users().findOne({ _id: userId(req), deletionStartedAt: { $exists: false } });
    if (!user) return res.status(404).json({ error: "Account not found." });
    const email = normalizeEmail(user.pendingRecoveryEmail);
    if (!validEmail(email)) return res.status(409).json({ error: "No email is awaiting verification. Manage your recovery email in profile settings." });
    if (await limited(req, res, "verify", email)) return;
    await issue(user, "verify", email);
    res.json({ message: "Verification OTP sent. Enter the six-digit code from your email within 10 minutes." });
  }));
  app.post("/api/auth/recovery", route(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const purpose = req.body?.purpose;
    if (!validEmail(email) || !["password", "username"].includes(purpose)) return res.status(400).json({ error: "Enter your verified recovery email and choose password or username recovery." });
    if (await limited(req, res, "recovery", email)) return;
    const user = await users().findOne({ recoveryEmail: email, deletionStartedAt: { $exists: false } });
    if (user) {
      if (purpose === "password") await issue(user, "reset", email);
      else await sendEmail(email, "Your Zinda Play username", `Your Zinda Play username is: ${user.username}\n\nSign in at ${publicWebsite}. If you did not request this message, you can ignore it.`);
    }
    res.json(genericRecovery);
  }));
  app.post("/api/auth/account-action", route(async (req, res) => {
    if (await limited(req, res, "token")) return;
    const { token, purpose, password } = req.body || {};
    const otp = purpose === "verify" && typeof token === "string" && /^\d{6}$/.test(token);
    const email = normalizeEmail(req.body?.email);
    if (otp && !validEmail(email)) return res.status(400).json({ error: "Enter the email address that received this OTP." });
    if (typeof token !== "string" || (!otp && !/^[a-f0-9]{64}$/.test(token)) || !["verify", "reset"].includes(purpose)) {
      return res.status(400).json({ error: "Enter the complete code from your email." });
    }
    if (purpose === "reset" && (typeof password !== "string" || password.length < 8 || password.length > 128)) {
      return res.status(400).json({ error: "Password must be between 8 and 128 characters." });
    }
    const record = otp
      ? await tokens().findOneAndUpdate(
        { _id: digest(`verify:${email}`), purpose, attempts: { $lt: 5 }, expiresAt: { $gt: new Date(now()) } },
        { $inc: { attempts: 1 } }, { returnDocument: "after" }
      )
      : await tokens().findOne({ _id: digest(token), purpose, expiresAt: { $gt: new Date(now()) } });
    if (!record) return res.status(400).json({ error: "This code is invalid, expired, or already used. Request a new email." });
    if (otp && !timingSafeEqual(
      Buffer.from(record.codeHash, "hex"),
      Buffer.from(digest(`${record.userId}:${email}:${token}`), "hex")
    )) return res.status(400).json({ error: "Incorrect OTP. After five attempts, request a new verification email." });
    const user = await users().findOne({ _id: record.userId, deletionStartedAt: { $exists: false }, passwordHash: record.passwordHash });
    if (!user || (purpose === "verify" && user.pendingRecoveryEmail !== record.email) ||
        (purpose === "reset" && user.recoveryEmail !== record.email)) {
      return res.status(400).json({ error: "This code no longer matches your account. Request a new email." });
    }
    const claimed = await tokens().deleteOne({ _id: record._id, ...(otp ? { codeHash: record.codeHash } : {}) });
    if (!claimed.deletedCount) return res.status(400).json({ error: "This code has already been used." });
    if (purpose === "verify") {
      try {
        const changed = await users().updateOne(
          { _id: user._id, pendingRecoveryEmail: record.email, passwordHash: record.passwordHash },
          { $set: { recoveryEmail: record.email }, $unset: { pendingRecoveryEmail: "" } }
        );
        if (!changed.matchedCount) return res.status(409).json({ error: "Your account changed. Request a new verification email." });
      } catch (error) {
        if (error.code !== 11000) throw error;
        return res.status(409).json({ error: "This recovery email is already linked to another account." });
      }
    } else {
      const { salt, hash } = await hashPassword(password);
      const changed = await users().updateOne(
        { _id: user._id, passwordHash: record.passwordHash, recoveryEmail: record.email },
        { $set: { passwordSalt: salt, passwordHash: hash } }
      );
      if (!changed.matchedCount) return res.status(409).json({ error: "Your account changed. Request a new reset email." });
      await updateSessions(user._id.toString(), user.username, true);
      await tokens().deleteMany({ userId: user._id });
    }
    res.json({ message: purpose === "verify" ? "Recovery email verified." : "Password reset. Sign in again using your new password." });
  }));
  return {
    // Signup still succeeds when email delivery fails; the user can resend from profile settings.
    async sendSignupVerification(user, email) {
      try {
        await issue(user, "verify", email);
        return true;
      } catch (error) {
        console.error("Signup verification email failed:", error.message);
        return false;
      }
    }
  };
}
