import { createHash } from "node:crypto";

const digest = value => createHash("sha256").update(value).digest("hex");

export async function initializeAccountSecurity(database) {
  await database.collection("accountRateLimits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

export function registerAccountSecurityRoutes(app, {
  getDb, requireAccount, asyncRoute, passwordMatches, userId, updateSessions, now = () => Date.now()
}) {
  const users = () => getDb().collection("users");
  const route = handler => asyncRoute(async (req, res) => {
    res.set("Cache-Control", "no-store");
    await handler(req, res);
  });
  app.get("/api/account/security", requireAccount, route(async (req, res) => {
    const user = await users().findOne({ _id: userId(req) });
    if (!user) return res.status(404).json({ error: "Account not found." });
    res.json({ username: user.username });
  }));
  app.patch("/api/account/username", requireAccount, route(async (req, res) => {
    const window = Math.floor(now() / (15 * 60 * 1000));
    const row = await getDb().collection("accountRateLimits").findOneAndUpdate(
      { _id: digest(`username:ip:${req.ip}:${window}`) },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * 15 * 60 * 1000) } },
      { upsert: true, returnDocument: "after" }
    );
    if (row.count > 20) return res.status(429).json({ error: "Too many requests. Please try again in 15 minutes." });
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
  for (const path of [
    "/api/account/recovery-email", "/api/account/verification-otp",
    "/api/auth/recovery", "/api/auth/account-action"
  ]) {
    app.post(path, route(async (req, res) => {
      res.status(410).json({ error: "Email verification and email recovery have been removed. Sign in with your username and password. Contact support if you cannot sign in." });
    }));
  }
}
