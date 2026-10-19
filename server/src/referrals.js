import { randomInt } from "node:crypto";

const validCode = code => typeof code === "string" && /^[1-9]\d{5}$/.test(code);

export async function ensureReferralCode(users, userId, generate = () => String(randomInt(100000, 1000000))) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const user = await users.findOne({ _id: userId });
    if (!user) throw new Error("Cannot assign an invitation ID to a missing account.");
    if (validCode(user.referralCode)) return user.referralCode;
    const code = generate();
    if (!validCode(code)) throw new Error("Invitation IDs must be six-digit numbers.");
    try {
      const updated = await users.findOneAndUpdate(
        {
          _id: userId,
          referralCode: user.referralCode === undefined ? { $exists: false } : user.referralCode
        },
        { $set: { referralCode: code } },
        { returnDocument: "after" }
      );
      if (updated) return updated.referralCode;
    } catch (error) {
      if (error.code !== 11000 || !error.keyPattern?.referralCode) throw error;
    }
  }
  throw new Error("Could not allocate a unique invitation ID. Please try again later.");
}

export async function initializeReferrals(database) {
  const users = database.collection("users");
  await users.createIndex(
    { referralCode: 1 },
    { unique: true, partialFilterExpression: { referralCode: { $type: "string" } } }
  );
  const cursor = users.find(
    { accountType: { $ne: "business" }, deletionStartedAt: { $exists: false } },
    { projection: { _id: 1, referralCode: 1 } }
  );
  for await (const user of cursor) {
    if (!validCode(user.referralCode)) await ensureReferralCode(users, user._id);
  }
}

export async function referralOwner(users, code) {
  if (!validCode(code)) return null;
  const user = await users.findOne({ referralCode: code, deletionStartedAt: { $exists: false } });
  if (!user || user.accountType === "business") return null;
  if (user.accountType === "promoter") return { id: user._id.toString(), type: "promoter" };
  if (user.approvalStatus === "approved" || user.approvalStatus === undefined) {
    return { id: user._id.toString(), type: "creator" };
  }
  return null;
}
