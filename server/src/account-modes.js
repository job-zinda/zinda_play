export function accountRole(user, preferredRole) {
  if (user.accountType === "business") return "business";
  if (user.accountType === "promoter" && (!user.creatorRequested || preferredRole === "promoter")) return "promoter";
  return user.approvalStatus === "approved" || user.approvalStatus === undefined ? "creator" : "member";
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
    if (!user || user.accountType !== "promoter") return res.status(403).json({ error: "Account switching is available to promoter accounts only." });
    const mode = req.body?.mode;
    if (!["creator", "promoter"].includes(mode)) return res.status(400).json({ error: "Choose creator or promoter mode." });
    if (mode === "creator" && !user.creatorRequested) {
      const result = await users().updateOne(
        { _id: user._id, creatorRequested: { $ne: true } },
        { $set: { creatorRequested: true, approvalStatus: "pending", creatorRequestedAt: new Date().toISOString() } }
      );
      if (result.matchedCount) {
        await notifications().insertOne({
          recipientId: "admin", type: "creator_application", userId: user._id.toString(),
          username: user.username, title: "Promoter requested creator access",
          message: `${user.username} requested creator approval. Their promoter account and rewards are retained.`,
          readAt: null, createdAt: new Date().toISOString()
        });
      }
    }
    const updated = await users().findOne({ _id: user._id });
    req.session.role = accountRole(updated, mode);
    saveSession(req);
    res.json({ ...publicUser(updated), role: req.session.role, approvalStatus: updated.creatorRequested ? updated.approvalStatus : null, promoterAccount: true });
  }));
}
