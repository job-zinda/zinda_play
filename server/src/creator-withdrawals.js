import { ObjectId } from "mongodb";

export const MIN_CREATOR_WITHDRAWAL_RUPEES = 100;
const MAX_ADMIN_CREDIT_RUPEES = 100000;
const payoutApps = new Map([["gpay", "Google Pay"], ["phonepe", "PhonePe"]]);

const toPaise = rupees => Math.round(Number(rupees || 0) * 100);
const toRupees = paise => paise / 100;
const formatRupees = rupees => `₹${Number(rupees).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

// Accepts amounts like 100, "250.5" or "1,000"; returns paise or null when invalid.
export function parseRupeeAmount(value) {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.replace(/,/g, "").trim() : "";
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const paise = toPaise(text);
  return Number.isSafeInteger(paise) && paise > 0 ? paise : null;
}

// Normalises an Indian mobile number such as "+91 98475 61998" to 10 digits.
export function normalizePayoutNumber(value) {
  const digits = typeof value === "string" ? value.replace(/[\s()-]/g, "").replace(/^(\+?91|0)(?=\d{10}$)/, "") : "";
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

function publicWithdrawal({ _id, ...withdrawal }) {
  return {
    id: _id.toString(),
    creatorId: withdrawal.creatorId,
    username: withdrawal.username || "",
    amountRupees: withdrawal.amountRupees,
    payoutApp: withdrawal.payoutApp,
    payoutAppLabel: payoutApps.get(withdrawal.payoutApp) || withdrawal.payoutApp,
    payoutNumber: withdrawal.payoutNumber,
    status: withdrawal.status,
    rejectionReason: withdrawal.rejectionReason || "",
    createdAt: withdrawal.createdAt,
    reviewedAt: withdrawal.reviewedAt || null,
    paidAt: withdrawal.paidAt || null
  };
}

function publicCredit({ _id, ...credit }) {
  return {
    id: _id.toString(),
    creatorId: credit.creatorId,
    username: credit.username || "",
    amountRupees: credit.amountRupees,
    note: credit.note || "",
    createdAt: credit.createdAt
  };
}

export async function creatorBalance(db, creatorId, earnedRupees) {
  const [withdrawals, credits] = await Promise.all([
    db.collection("creatorWithdrawals").find({ creatorId }).sort({ createdAt: -1 }).toArray(),
    db.collection("creatorCredits").find({ creatorId }).sort({ createdAt: -1 }).toArray()
  ]);
  const sum = (items, status) => items.filter(item => !status || item.status === status)
    .reduce((total, item) => total + toPaise(item.amountRupees), 0);
  const earnedPaise = toPaise(earnedRupees);
  const creditPaise = sum(credits);
  const paidPaise = sum(withdrawals, "paid");
  const pendingPaise = sum(withdrawals, "pending");
  const availablePaise = Math.max(0, earnedPaise + creditPaise - paidPaise - pendingPaise);
  const hasPending = pendingPaise > 0;
  return {
    adminCreditsRupees: toRupees(creditPaise),
    withdrawnRupees: toRupees(paidPaise),
    pendingWithdrawalRupees: toRupees(pendingPaise),
    availableRupees: toRupees(availablePaise),
    minimumWithdrawalRupees: MIN_CREATOR_WITHDRAWAL_RUPEES,
    hasPendingWithdrawal: hasPending,
    canWithdraw: !hasPending && availablePaise >= MIN_CREATOR_WITHDRAWAL_RUPEES * 100,
    withdrawals: withdrawals.slice(0, 50).map(publicWithdrawal),
    credits: credits.slice(0, 50).map(publicCredit)
  };
}

export function registerCreatorWithdrawalRoutes(app, {
  getDb, requireCreator, requireAdmin, asyncRoute, creatorWallet
}) {
  const db = () => getDb();
  const withdrawals = () => db().collection("creatorWithdrawals");
  const credits = () => db().collection("creatorCredits");
  const notify = notification => db().collection("notifications").insertOne({ readAt: null, ...notification });
  const walletFor = async creatorId => {
    const wallet = await creatorWallet(db(), creatorId);
    return { ...wallet, ...await creatorBalance(db(), creatorId, wallet.estimatedEarningsRupees) };
  };

  app.get("/api/creator/wallet", requireCreator, asyncRoute(async (req, res) => {
    res.json(await walletFor(req.creatorId.toString()));
  }));

  app.post("/api/creator/withdrawals", requireCreator, asyncRoute(async (req, res) => {
    const creatorId = req.creatorId.toString();
    const payoutApp = typeof req.body?.payoutApp === "string" ? req.body.payoutApp : "";
    if (!payoutApps.has(payoutApp)) return res.status(400).json({ error: "Choose Google Pay or PhonePe." });
    const payoutNumber = normalizePayoutNumber(req.body?.payoutNumber);
    if (!payoutNumber) return res.status(400).json({ error: `Enter the 10-digit mobile number linked to your ${payoutApps.get(payoutApp)}.` });
    if (await withdrawals().findOne({ creatorId, status: "pending" })) {
      return res.status(409).json({ error: "You already have a withdrawal request waiting for the admin." });
    }
    const wallet = await walletFor(creatorId);
    const availablePaise = toPaise(wallet.availableRupees);
    const minimumPaise = MIN_CREATOR_WITHDRAWAL_RUPEES * 100;
    if (availablePaise < minimumPaise) {
      return res.status(400).json({ error: `You need at least ${formatRupees(MIN_CREATOR_WITHDRAWAL_RUPEES)} in your wallet to withdraw. Available: ${formatRupees(wallet.availableRupees)}.` });
    }
    const requested = req.body?.amountRupees;
    const amountPaise = requested === undefined || requested === null || requested === "" ? availablePaise : parseRupeeAmount(requested);
    if (!amountPaise) return res.status(400).json({ error: "Enter a valid amount, for example 100 or 250.50." });
    if (amountPaise < minimumPaise) return res.status(400).json({ error: `The minimum withdrawal is ${formatRupees(MIN_CREATOR_WITHDRAWAL_RUPEES)}.` });
    if (amountPaise > availablePaise) return res.status(400).json({ error: `You can withdraw up to ${formatRupees(wallet.availableRupees)}.` });
    const createdAt = new Date().toISOString();
    const amountRupees = toRupees(amountPaise);
    const withdrawal = {
      creatorId, username: req.session.username || "", amountRupees, payoutApp, payoutNumber, status: "pending", createdAt
    };
    let result;
    try {
      result = await withdrawals().insertOne({ ...withdrawal });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ error: "You already have a withdrawal request waiting for the admin." });
      throw error;
    }
    const withdrawalId = result.insertedId.toString();
    const via = `${payoutApps.get(payoutApp)} ${payoutNumber}`;
    await notify({
      recipientId: creatorId, type: "creator_withdrawal_requested", withdrawalId,
      title: "Withdrawal request sent",
      message: `Your ${formatRupees(amountRupees)} withdrawal to ${via} is waiting for the admin.`, createdAt
    });
    await notify({
      recipientId: "admin", type: "creator_withdrawal_review", withdrawalId, creatorId,
      title: "Creator withdrawal request",
      message: `${withdrawal.username || "A creator"} requested ${formatRupees(amountRupees)} to ${via}.`, createdAt
    });
    res.status(201).json(publicWithdrawal({ _id: result.insertedId, ...withdrawal }));
  }));

  app.get("/api/admin/creator-withdrawals", requireAdmin, asyncRoute(async (_req, res) => {
    const [pending, recent] = await Promise.all([
      withdrawals().find({ status: "pending" }).sort({ createdAt: 1 }).toArray(),
      withdrawals().find({ status: { $in: ["paid", "rejected"] } }).sort({ reviewedAt: -1 }).limit(50).toArray()
    ]);
    const balances = new Map();
    for (const creatorId of new Set(pending.map(item => item.creatorId))) {
      balances.set(creatorId, (await walletFor(creatorId)).availableRupees);
    }
    res.json({
      pending: pending.map(item => ({ ...publicWithdrawal(item), availableAfterRupees: balances.get(item.creatorId) ?? 0 })),
      recent: recent.map(publicWithdrawal),
      credits: (await credits().find({}).sort({ createdAt: -1 }).limit(50).toArray()).map(publicCredit)
    });
  }));

  app.patch("/api/admin/creator-withdrawals/:id", requireAdmin, asyncRoute(async (req, res) => {
    const decision = req.body?.decision;
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!["paid", "rejected"].includes(decision)) return res.status(400).json({ error: "Choose paid or rejected." });
    if (decision === "rejected" && (!reason || reason.length > 500)) {
      return res.status(400).json({ error: "Enter a rejection reason of 1 to 500 characters." });
    }
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(404).json({ error: "Withdrawal request not found." });
    const _id = new ObjectId(req.params.id);
    const reviewedAt = new Date().toISOString();
    const withdrawal = await withdrawals().findOneAndUpdate(
      { _id, status: "pending" },
      { $set: { status: decision, reviewedAt, ...(decision === "paid" ? { paidAt: reviewedAt } : { rejectionReason: reason }) } },
      { returnDocument: "after" }
    );
    if (!withdrawal) return res.status(404).json({ error: "This withdrawal request is no longer pending." });
    const amount = formatRupees(withdrawal.amountRupees);
    const via = `${payoutApps.get(withdrawal.payoutApp) || "UPI"} ${withdrawal.payoutNumber}`;
    await notify({
      recipientId: withdrawal.creatorId, withdrawalId: req.params.id,
      type: decision === "paid" ? "creator_withdrawal_paid" : "creator_withdrawal_rejected",
      title: decision === "paid" ? "Withdrawal paid" : "Withdrawal rejected",
      message: decision === "paid"
        ? `${amount} was sent to your ${via}. It has been deducted from your wallet.`
        : `Your ${amount} withdrawal was rejected. Reason: ${reason}. The amount is back in your wallet.`,
      createdAt: reviewedAt
    });
    await db().collection("notifications").updateMany(
      { recipientId: "admin", type: "creator_withdrawal_review", withdrawalId: req.params.id, readAt: null },
      { $set: { readAt: reviewedAt } }
    );
    await notify({
      recipientId: "admin", withdrawalId: req.params.id, creatorId: withdrawal.creatorId,
      type: decision === "paid" ? "creator_withdrawal_marked_paid" : "creator_withdrawal_marked_rejected",
      title: decision === "paid" ? "Withdrawal marked paid" : "Withdrawal rejected",
      message: decision === "paid"
        ? `${amount} paid to ${withdrawal.username || "creator"} (${via}).`
        : `${amount} for ${withdrawal.username || "creator"} rejected. Reason: ${reason}`,
      readAt: reviewedAt, createdAt: reviewedAt
    });
    res.json(publicWithdrawal(withdrawal));
  }));

  // Lets the admin add money (bonus, correction or manual earnings) to a creator's wallet.
  app.post("/api/admin/creator-credits", requireAdmin, asyncRoute(async (req, res) => {
    const creatorId = typeof req.body?.creatorId === "string" ? req.body.creatorId : "";
    const amountPaise = parseRupeeAmount(req.body?.amountRupees);
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (!amountPaise || amountPaise > MAX_ADMIN_CREDIT_RUPEES * 100) {
      return res.status(400).json({ error: `Enter an amount between ₹0.01 and ${formatRupees(MAX_ADMIN_CREDIT_RUPEES)}.` });
    }
    if (note.length > 200) return res.status(400).json({ error: "Keep the note under 200 characters." });
    const creator = /^[a-f0-9]{24}$/i.test(creatorId) && await db().collection("users").findOne({ _id: new ObjectId(creatorId) });
    if (!creator || creator.accountType === "business") return res.status(404).json({ error: "Creator not found." });
    const createdAt = new Date().toISOString();
    const amountRupees = toRupees(amountPaise);
    const credit = { creatorId, username: creator.username || "", amountRupees, note, createdAt };
    const result = await credits().insertOne({ ...credit });
    await notify({
      recipientId: creatorId, type: "creator_wallet_credit", creditId: result.insertedId.toString(),
      title: "Money added to your wallet",
      message: `The admin added ${formatRupees(amountRupees)} to your wallet${note ? `: ${note}` : "."}`, createdAt
    });
    await notify({
      recipientId: "admin", type: "creator_wallet_credit_sent", creditId: result.insertedId.toString(), creatorId,
      title: "Amount sent to creator",
      message: `${formatRupees(amountRupees)} added to ${credit.username || "creator"}'s wallet${note ? `: ${note}` : "."}`,
      readAt: createdAt, createdAt
    });
    res.status(201).json(publicCredit({ _id: result.insertedId, ...credit }));
  }));
}

export async function initializeCreatorWithdrawals(database) {
  await database.collection("creatorWithdrawals").createIndex(
    { creatorId: 1 },
    { unique: true, partialFilterExpression: { status: "pending" } }
  );
  await database.collection("creatorWithdrawals").createIndex({ status: 1, createdAt: 1 });
  await database.collection("creatorCredits").createIndex({ creatorId: 1, createdAt: -1 });
}
