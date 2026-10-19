export function accountRole(user, preferredRole) {
  if (user.accountType === "business") return "business";
  if (user.accountType === "promoter" && (!user.creatorRequested || preferredRole === "promoter")) return "member";
  return user.approvalStatus === "approved" || user.approvalStatus === undefined ? "creator" : "member";
}

export const memberRewardsEligible = user => Boolean(user && user.accountType !== "business" && !user.deletionStartedAt);

export function memberRewardsGuard({ sessionFor, users, userId }) {
  return async (req, res, next) => {
    const session = sessionFor(req);
    if (!session?.userId || !["member", "creator", "promoter"].includes(session.role)) {
      return res.status(401).json({ error: "Member authentication required." });
    }
    const user = await users().findOne({ _id: userId(session.userId) });
    if (!memberRewardsEligible(user)) return res.status(403).json({ error: "Member rewards are not available for this account." });
    req.session = session;
    req.promoter = user;
    req.promoterId = user._id.toString();
    next();
  };
}

export const approvedCreatorQuery = {
  $and: [
    { deletionStartedAt: { $exists: false } },
    { accountType: { $ne: "business" } },
    { $or: [{ accountType: { $ne: "promoter" } }, { creatorRequested: true }] },
    { $or: [{ approvalStatus: "approved" }, { approvalStatus: { $exists: false } }] }
  ]
};

export function registerAccountModeRoutes(app, { users, notifications, requireMember, asyncRoute, publicUser, saveSession, userId }) {
  app.post("/api/account/mode", requireMember, asyncRoute(async (req, res) => {
    const user = await users().findOne({ _id: userId(req) });
    if (!memberRewardsEligible(user)) return res.status(403).json({ error: "Creator access is available to members only." });
    const mode = req.body?.mode;
    if (!["creator", "promoter"].includes(mode)) return res.status(400).json({ error: "Choose creator or promoter mode." });
    if (mode === "creator" && user.accountType === "promoter" && !user.creatorRequested) {
      await users().updateOne(
        { _id: user._id, creatorRequested: { $ne: true } },
        { $set: { creatorRequested: true, approvalStatus: "draft" } }
      );
    }
    const updated = await users().findOne({ _id: user._id });
    req.session.role = accountRole(updated, mode);
    saveSession(req);
    res.json({ ...publicUser(updated), role: req.session.role, approvalStatus: updated.approvalStatus ?? null, promoterAccount: true });
  }));
  app.post("/api/account/creator-application", requireMember, asyncRoute(async (req, res) => {
    const user = await users().findOne({ _id: userId(req) });
    if (!user || user.deletionStartedAt || user.accountType === "business") return res.status(403).json({ error: "This account cannot apply for creator access." });
    if (user.approvalStatus === "approved" || (user.approvalStatus === undefined && user.accountType !== "promoter")) {
      return res.status(409).json({ error: "Your creator account is already approved." });
    }
    if (!user.profilePhotoImageId) return res.status(400).json({ error: "Add a profile photo before submitting your creator application." });
    if (user.approvalStatus === "pending") return res.status(409).json({ error: "Your creator application is already awaiting approval." });
    const now = new Date().toISOString();
    const result = await users().updateOne(
      { _id: user._id, approvalStatus: user.approvalStatus ?? { $exists: false }, profilePhotoImageId: user.profilePhotoImageId },
      { $set: { creatorRequested: true, approvalStatus: "pending", creatorSubmittedAt: now } }
    );
    if (!result.matchedCount) return res.status(409).json({ error: "Your application changed. Refresh and try again." });
    await notifications().insertOne({
      recipientId: "admin", type: "creator_application", userId: user._id.toString(), username: user.username,
      title: "Creator application submitted", message: `${user.username} submitted a creator application with a profile photo.`,
      readAt: null, createdAt: now
    });
    req.session.role = "member";
    saveSession(req);
    res.json({ role: "member", approvalStatus: "pending", promoterAccount: true });
  }));
}

export async function initializeCreatorApplications(database) {
  await database.collection("users").updateMany(
    { approvalStatus: "pending", creatorSubmittedAt: { $exists: false } },
    { $set: { approvalStatus: "draft" } }
  );
}
