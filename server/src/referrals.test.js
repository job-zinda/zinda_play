import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import { memoryDatabase } from "../test-support/memory-database.js";
import { ensureReferralCode, initializeReferrals, referralOwner } from "./referrals.js";

function fixture() {
  const db = memoryDatabase();
  const users = db.collection("users");
  const update = users.findOneAndUpdate.bind(users);
  users.findOneAndUpdate = async (filter, changes, options) => {
    if (users.documents.some(user =>
      user._id.toString() !== filter._id.toString() &&
      user.referralCode === changes.$set.referralCode
    )) {
      throw Object.assign(new Error("Duplicate referral code"), {
        code: 11000, keyPattern: { referralCode: 1 }
      });
    }
    return update(filter, changes, options);
  };
  const find = users.find.bind(users);
  users.find = (...args) => {
    const cursor = find(...args);
    cursor[Symbol.asyncIterator] = async function* () {
      yield* await cursor.toArray();
    };
    return cursor;
  };
  return { db, users };
}

test("existing accounts migrate to stable six-digit invitation IDs without changing attribution", async () => {
  const { db, users } = fixture();
  const creatorId = new ObjectId();
  const promoterId = new ObjectId();
  const viewerId = new ObjectId();
  await users.insertOne({ _id: creatorId, accountType: "member", approvalStatus: "approved", referralCode: creatorId.toString() });
  await users.insertOne({ _id: promoterId, accountType: "promoter" });
  await users.insertOne({
    _id: viewerId, accountType: "member", approvalStatus: "pending",
    referrerCreatorId: creatorId.toString(), referrerPromoterId: promoterId.toString()
  });
  await users.insertOne({ accountType: "business" });
  let index;
  users.createIndex = async (...args) => { index = args; };
  await initializeReferrals(db);
  assert.deepEqual(index, [
    { referralCode: 1 },
    { unique: true, partialFilterExpression: { referralCode: { $type: "string" } } }
  ]);
  const personal = users.documents.filter(user => user.accountType !== "business");
  for (const user of personal) assert.match(user.referralCode, /^[1-9]\d{5}$/);
  assert.equal(new Set(personal.map(user => user.referralCode)).size, personal.length);
  const firstCodes = personal.map(user => user.referralCode);
  await initializeReferrals(db);
  assert.deepEqual(personal.map(user => user.referralCode), firstCodes);
  const viewer = await users.findOne({ _id: viewerId });
  assert.equal(viewer.referrerCreatorId, creatorId.toString());
  assert.equal(viewer.referrerPromoterId, promoterId.toString());
  assert.equal(users.documents.find(user => user.accountType === "business").referralCode, undefined);
});

test("new accounts get a persistent code and collisions retry instead of sharing a code", async () => {
  const { users } = fixture();
  await users.insertOne({ accountType: "promoter", referralCode: "123456" });
  const newcomer = { accountType: "promoter" };
  await users.insertOne(newcomer);
  const choices = ["123456", "654321"];
  assert.equal(await ensureReferralCode(users, newcomer._id, () => choices.shift()), "654321");
  assert.equal(await ensureReferralCode(users, newcomer._id, () => assert.fail("Must reuse the existing code")), "654321");
});

test("concurrent requests for one account return the same invitation ID", async () => {
  const { users } = fixture();
  const user = { accountType: "member", approvalStatus: "approved" };
  await users.insertOne(user);
  const codes = await Promise.all([
    ensureReferralCode(users, user._id, () => "123456"),
    ensureReferralCode(users, user._id, () => "654321")
  ]);
  assert.equal(codes[0], codes[1]);
});

test("six-digit invitations resolve to internal creator/promoter IDs, never legacy ObjectIDs", async () => {
  const { users } = fixture();
  const creator = { accountType: "member", approvalStatus: "approved", referralCode: "123456" };
  const promoter = { accountType: "promoter", creatorRequested: true, approvalStatus: "approved", referralCode: "654321" };
  await users.insertOne(creator);
  await users.insertOne(promoter);
  assert.deepEqual(await referralOwner(users, "123456"), { id: creator._id.toString(), type: "promoter" });
  assert.deepEqual(await referralOwner(users, "654321"), { id: promoter._id.toString(), type: "promoter" });
  for (const code of [creator._id.toString(), "", "12345", "1234567", "abcdef", "000000", 123456]) {
    assert.equal(await referralOwner(users, code), null);
  }
  for (const approvalStatus of ["draft", "pending", "rejected", "approved"]) {
    await users.updateOne({ _id: creator._id }, { $set: { approvalStatus } });
    assert.deepEqual(await referralOwner(users, "123456"), { id: creator._id.toString(), type: "promoter" });
  }
  for (const fields of [
    { accountType: "business" },
    { accountType: "promoter", deletionStartedAt: "now" }
  ]) {
    await users.updateOne({ _id: creator._id }, { $set: fields });
    assert.equal(await referralOwner(users, "123456"), null);
  }
});

test("allocation errors are surfaced, including exhaustion and unrelated database failures", async () => {
  const { users } = fixture();
  const user = { accountType: "promoter" };
  await users.insertOne(user);
  await assert.rejects(ensureReferralCode(users, new ObjectId()), /missing account/);
  await assert.rejects(ensureReferralCode(users, user._id, () => "short"), /six-digit/);
  await users.insertOne({ referralCode: "123456" });
  await assert.rejects(ensureReferralCode(users, user._id, () => "123456"), /unique invitation/);
  const failure = new Error("Database unavailable");
  users.findOneAndUpdate = async () => { throw failure; };
  await assert.rejects(ensureReferralCode(users, user._id, () => "654321"), error => error === failure);
});
