import { ObjectId } from "mongodb";

export const reactionTypes = ["like", "love", "haha", "wow", "sad", "angry"];
const pageSize = 20;
const objectId = value => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value) ? new ObjectId(value) : null;
const rootFilter = { $or: [{ parentId: null }, { parentId: { $exists: false } }] };
const reactionOf = row => row ? row.reaction || "like" : null;

export async function initializeEngagement(db) {
  await db.collection("commentReactions").createIndex({ commentId: 1, userId: 1 }, { unique: true });
  await db.collection("commentReactions").createIndex({ videoId: 1 });
  await db.collection("videoComments").createIndex({ videoId: 1, parentId: 1, _id: -1 });
}

async function reactionSummary(collection, filter, userId) {
  const [groups, own] = await Promise.all([
    collection.aggregate([{ $match: filter }, { $group: { _id: "$reaction", count: { $sum: 1 } } }]).toArray(),
    userId ? collection.findOne({ ...filter, userId }) : null
  ]);
  const reactions = Object.fromEntries(reactionTypes.map(type => [type, 0]));
  for (const group of groups) reactions[group._id || "like"] += group.count;
  return { reaction: reactionOf(own), reactions, reactionCount: Object.values(reactions).reduce((sum, count) => sum + count, 0) };
}

async function toggleReaction(collection, filter, type) {
  const existing = await collection.findOne(filter);
  if (existing && reactionOf(existing) === type) {
    await collection.deleteOne({ _id: existing._id });
    return false;
  }
  try {
    const result = await collection.updateOne(filter, { $set: { reaction: type }, $setOnInsert: { ...filter, createdAt: new Date().toISOString() } }, { upsert: true });
    return result.upsertedCount === 1;
  } catch (error) {
    if (error.code !== 11000) throw error;
    await collection.updateOne(filter, { $set: { reaction: type } });
    return false;
  }
}

async function commentPage(db, videoId, userId, parentId = null, before = null) {
  const filter = { videoId, ...(parentId ? { parentId } : rootFilter), ...(before ? { _id: { $lt: before } } : {}) };
  const rows = await db.collection("videoComments").find(filter).sort({ _id: -1 }).limit(pageSize + 1).toArray();
  const more = rows.length > pageSize;
  const page = rows.slice(0, pageSize);
  const ids = page.map(row => row._id.toString());
  const [replyGroups, own, ...groups] = await Promise.all([
    db.collection("videoComments").aggregate([
      { $match: { videoId, parentId: { $in: ids } } }, { $group: { _id: "$parentId", count: { $sum: 1 } } }
    ]).toArray(),
    userId ? db.collection("commentReactions").find({ videoId, commentId: { $in: ids }, userId }).toArray() : [],
    ...reactionTypes.map(reaction => db.collection("commentReactions").aggregate([
      { $match: { videoId, commentId: { $in: ids }, reaction } },
      { $group: { _id: "$commentId", count: { $sum: 1 } } }
    ]).toArray())
  ]);
  const replies = new Map(replyGroups.map(row => [row._id, row.count]));
  const ownReactions = new Map(own.map(row => [row.commentId, row.reaction]));
  const counts = groups.map(rows => new Map(rows.map(row => [row._id, row.count])));
  return {
    comments: page.map(row => {
      const id = row._id.toString();
      const reactions = Object.fromEntries(reactionTypes.map((type, i) => [type, counts[i].get(id) || 0]));
      return {
        id, username: row.username, text: row.text, createdAt: row.createdAt,
        parentId: row.parentId || null, replyCount: replies.get(id) || 0,
        reaction: ownReactions.get(id) || null, reactions,
        reactionCount: Object.values(reactions).reduce((sum, count) => sum + count, 0)
      };
    }),
    nextCursor: more ? page.at(-1)._id.toString() : null
  };
}

export function registerEngagementRoutes(app, { getDb, asyncRoute, requireAccount, limit, availableVideo, sessionFor }) {
  const videoGuard = asyncRoute(async (req, res, next) => {
    req.engagementVideo = await availableVideo(req);
    if (!req.engagementVideo) return res.status(404).json({ error: "Video not found." });
    next();
  });
  const summary = async (db, videoId, userId) => {
    const result = await reactionSummary(db.collection("videoLikes"), { videoId }, userId);
    return { ...result, liked: Boolean(result.reaction), likeCount: result.reactionCount };
  };
  app.get("/api/videos/:id/interactions", videoGuard, asyncRoute(async (req, res) => {
    const db = getDb(), videoId = req.engagementVideo._id, userId = sessionFor(req)?.userId;
    const [reactions, page, commentCount] = await Promise.all([
      summary(db, videoId, userId), commentPage(db, videoId, userId),
      db.collection("videoComments").countDocuments({ videoId })
    ]);
    res.json({ ...reactions, commentCount, comments: page.comments, commentsNextCursor: page.nextCursor });
  }));
  app.get("/api/videos/:id/comments", videoGuard, asyncRoute(async (req, res) => {
    const db = getDb(), videoId = req.engagementVideo._id;
    const parentId = req.query.parentId;
    const before = req.query.before;
    if ((parentId !== undefined && !objectId(parentId)) || (before !== undefined && !objectId(before))) {
      return res.status(400).json({ error: "Invalid comment or pagination ID." });
    }
    if (parentId && !await db.collection("videoComments").findOne({ _id: objectId(parentId), videoId })) {
      return res.status(404).json({ error: "Comment not found." });
    }
    res.json(await commentPage(db, videoId, sessionFor(req)?.userId, parentId ? objectId(parentId).toString() : null, before ? objectId(before) : null));
  }));
  const reactToVideo = legacy => asyncRoute(async (req, res) => {
    const type = legacy ? "like" : req.body?.reaction;
    if (!reactionTypes.includes(type)) return res.status(400).json({ error: "Choose a supported reaction." });
    const db = getDb(), video = req.engagementVideo, userId = req.session.userId;
    const created = await toggleReaction(db.collection("videoLikes"), { videoId: video._id, userId }, type);
    if (created && video.ownerId && video.ownerId !== userId) {
      await db.collection("notifications").insertOne({
        recipientId: video.ownerId, type: "video_like", actorId: userId, videoId: video._id,
        title: "New reaction on your video", message: `${req.session.username} reacted to "${video.title}".`,
        readAt: null, createdAt: new Date().toISOString()
      });
    }
    res.json(await summary(db, video._id, userId));
  });
  app.post("/api/videos/:id/like", requireAccount, limit, videoGuard, reactToVideo(true));
  app.post("/api/videos/:id/reaction", requireAccount, limit, videoGuard, reactToVideo(false));
  app.post("/api/videos/:id/comments/:commentId/reaction", requireAccount, limit, videoGuard, asyncRoute(async (req, res) => {
    const type = req.body?.reaction, db = getDb(), videoId = req.engagementVideo._id;
    if (!reactionTypes.includes(type)) return res.status(400).json({ error: "Choose a supported reaction." });
    const id = objectId(req.params.commentId);
    if (!id || !await db.collection("videoComments").findOne({ _id: id, videoId })) {
      return res.status(404).json({ error: "Comment not found." });
    }
    const commentId = id.toString();
    await toggleReaction(db.collection("commentReactions"), { videoId, commentId, userId: req.session.userId }, type);
    res.json(await reactionSummary(db.collection("commentReactions"), { videoId, commentId }, req.session.userId));
  }));
  app.post("/api/videos/:id/comments", requireAccount, limit, videoGuard, asyncRoute(async (req, res) => {
    const db = getDb(), video = req.engagementVideo;
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text || text.length > 1000) return res.status(400).json({ error: "Comments must be between 1 and 1000 characters." });
    const parentId = req.body?.parentId;
    if (parentId !== undefined && parentId !== null && !objectId(parentId)) {
      return res.status(400).json({ error: "Invalid parent comment ID." });
    }
    const parent = parentId ? await db.collection("videoComments").findOne({ _id: objectId(parentId), videoId: video._id }) : null;
    if (parentId && !parent) return res.status(404).json({ error: "Parent comment not found." });
    const comment = {
      videoId: video._id, userId: req.session.userId, username: req.session.username,
      text, parentId: parent?._id.toString() || null, createdAt: new Date().toISOString()
    };
    const result = await db.collection("videoComments").insertOne(comment);
    for (const recipientId of new Set([video.ownerId, parent?.userId].filter(id => id && id !== req.session.userId))) {
      await db.collection("notifications").insertOne({
        recipientId, type: "video_comment", actorId: req.session.userId, videoId: video._id,
        title: parent ? "New reply on your video comment" : "New comment on your video",
        message: `${req.session.username} commented on "${video.title}".`, readAt: null, createdAt: comment.createdAt
      });
    }
    res.status(201).json({
      id: result.insertedId, username: comment.username, text, createdAt: comment.createdAt,
      parentId: comment.parentId, replyCount: 0, reaction: null, reactionCount: 0,
      reactions: Object.fromEntries(reactionTypes.map(type => [type, 0]))
    });
  }));
}
