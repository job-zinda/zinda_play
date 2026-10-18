import { ObjectId } from "mongodb";

async function removeFile(db, bucket, id) {
  if (!id) return;
  const fileId = id instanceof ObjectId ? id : new ObjectId(id);
  await db.collection(`${bucket}.chunks`).deleteMany({ files_id: fileId });
  await db.collection(`${bucket}.files`).deleteOne({ _id: fileId });
}

export async function deleteAccountData(db, user, { deleteVideoMedia, revokeSessions }) {
  const id = user._id.toString();
  const now = new Date().toISOString();
  await db.collection("users").updateOne({ _id: user._id }, {
    $set: { deletionStartedAt: user.deletionStartedAt || now, approvalStatus: "deleted", accountType: "deleted" }
  });
  const owned = { $or: [{ ownerId: id }, { ownerBusinessId: id }] };
  const videos = await db.collection("videos").find(owned).toArray();
  const videoIds = videos.map(video => video._id);
  await db.collection("videos").updateMany(owned, { $set: { published: false, deletedAt: now } });
  const adQuery = { $or: [{ creatorId: id }, { businessId: id }, { creatorVideoId: { $in: videoIds } }] };
  await db.collection("ads").updateMany(adQuery, {
    $set: { active: false, sourceDeletedAt: now, creatorNotificationPending: false }
  });
  await db.collection("businessCampaigns").updateMany({ businessId: id }, { $set: { status: "deleted" } });
  for (const video of videos) {
    if (!video.mediaDeletedAt) await deleteVideoMedia(video);
    await removeFile(db, "videoThumbnails", video.thumbnailImageId);
    await db.collection("videos").updateOne({ _id: video._id }, {
      $set: { title: "Deleted video", description: "", published: false, deletedAt: now, mediaDeletedAt: now },
      $unset: { bunnyVideoId: "", playbackUrl: "", thumbnailUrl: "", thumbnailImageId: "", promotionUrl: "", caption: "", hashtags: "", collectionName: "", targetCity: "" }
    });
  }
  for (const [bucket, field] of [
    ["creatorProfilePhotos", "profilePhotoImageId"], ["creatorProfilePhotos", "businessLogoImageId"],
    ["creatorIntros", "introVideoId"]
  ]) await removeFile(db, bucket, user[field]);
  for (const submission of await db.collection("businessAdSubmissions").find({ businessId: id }).toArray()) {
    await removeFile(db, "businessAdVideos", submission.videoId);
    await removeFile(db, "businessAdVideos", submission.uploadingVideoId);
    await db.collection("businessAdSubmissions").updateOne({ _id: submission._id }, {
      $set: { title: "Deleted business ad", businessName: "Deleted account", status: "deleted", deletedAt: now },
      $unset: { videoId: "", uploadingVideoId: "", description: "", targetUrl: "", targetCity: "", interests: "", rejectionReason: "" }
    });
  }
  await db.collection("ads").updateMany(adQuery, {
    $set: { title: "Deleted account ad", creatorVideoTitle: "Deleted video", businessName: "Deleted account" },
    $unset: { mediaUrl: "", streamUrl: "", targetUrl: "", watchDeliveries: "", targetCity: "", interests: "" }
  });
  await db.collection("businessCampaigns").updateMany({ businessId: id }, {
    $set: { businessName: "Deleted account" }, $unset: { targetUrl: "", targetCity: "", description: "", title: "" }
  });
  for (const name of ["videoLikes", "videoComments", "savedShorts", "shortReports"]) {
    await db.collection(name).deleteMany({ $or: [{ userId: id }, { videoId: { $in: videoIds } }] });
  }
  const conversationQuery = { $or: [{ creatorId: id }, { businessId: id }, { senderId: id }, { recipientId: id }] };
  const invitationIds = (await db.collection("creatorInvitations").find(conversationQuery).toArray()).map(row => row._id.toString());
  const requestIds = (await db.collection("creatorRequests").find(conversationQuery).toArray()).map(row => row._id.toString());
  for (const name of ["creatorInvitations", "creatorRequests", "adminChats"]) {
    await db.collection(name).deleteMany({ $or: [{ creatorId: id }, { businessId: id }, { senderId: id }, { recipientId: id }] });
  }
  await db.collection("creatorFollows").deleteMany({ $or: [{ creatorId: id }, { followerId: id }] });
  await db.collection("notifications").deleteMany({
    $or: [{ recipientId: id }, { userId: id }, { creatorId: id }, { businessId: id }, { reporterId: id }, { followerId: id }, { actorId: id },
      { videoId: { $in: videoIds } }, { invitationId: { $in: invitationIds } }, { requestId: { $in: requestIds } }]
  });
  const escapedUsername = String(user.username).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await db.collection("notifications").deleteMany({
    type: { $in: ["video_like", "video_comment"] },
    message: { $regex: `^${escapedUsername} (?:liked|commented on) "` }
  });
  await db.collection("promoterWatchSessions").deleteMany({ $or: [{ userId: id }, { viewerId: id }] });
  for (const name of ["membershipPayments", "creatorMembershipOrders"]) {
    await db.collection(name).updateMany({ creatorId: id }, { $set: { username: "Deleted account", accountDeletedAt: now } });
  }
  // Financial ledgers, payment evidence and outstanding payout details remain for reconciliation.
  await db.collection("sessions").deleteMany({ userId: id });
  await revokeSessions(id);
  await db.collection("users").deleteOne({ _id: user._id });
}

export function accountDeletionHandler({ getDb, passwordMatches, deleteVideoMedia, revokeSessions }) {
  const running = new Set();
  return async (req, res) => {
    const id = req.session.userId;
    if (running.has(id)) return res.status(409).json({ error: "Account deletion is already running. Please wait and retry." });
    const password = req.body?.password;
    if (typeof password !== "string" || !password || password.length > 128 || req.body?.confirmation !== "DELETE") {
      return res.status(400).json({ error: "Enter your current password and type DELETE to confirm." });
    }
    const db = getDb();
    const user = await db.collection("users").findOne({ _id: new ObjectId(id) });
    if (!user || !await passwordMatches(password, user)) return res.status(403).json({ error: "Incorrect password." });
    if (running.has(id)) return res.status(409).json({ error: "Account deletion is already running. Please wait and retry." });
    running.add(id);
    try {
      await deleteAccountData(db, user, { deleteVideoMedia, revokeSessions });
      res.status(204).end();
    } finally {
      running.delete(id);
    }
  };
}

export function accountAccessGuard({ getDb, sessionFor }) {
  return async (req, res, next) => {
    const session = sessionFor(req);
    if (session?.userId) {
      const user = await getDb().collection("users").findOne({ _id: new ObjectId(session.userId) }, { projection: { deletionStartedAt: 1 } });
      if (!user) return res.status(401).json({ error: "This account no longer exists." });
      if (user.deletionStartedAt && !(req.method === "DELETE" && req.path === "/api/account") && req.path !== "/api/auth/logout") {
        return res.status(409).json({ error: "Account deletion is incomplete. Open Delete account and retry to finish removing your data." });
      }
    }
    next();
  };
}
