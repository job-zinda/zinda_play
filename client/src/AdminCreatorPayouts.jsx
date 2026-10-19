import { useEffect, useState } from "react";
import { Check, IndianRupee, RefreshCw, Send, WalletCards, X } from "lucide-react";

const rupees = value => `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const when = value => value ? new Date(value).toLocaleString() : "";

export default function AdminCreatorPayouts({ api, token, onBack, onUnauthorized, onChanged }) {
  const [data, setData] = useState({ pending: [], recent: [], credits: [] });
  const [creators, setCreators] = useState([]);
  const [reasons, setReasons] = useState({});
  const [credit, setCredit] = useState({ creatorId: "", amountRupees: "", note: "" });
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function request(path, options = {}) {
    const response = await fetch(`${api}${path}`, {
      ...options,
      headers: { Authorization: "Bearer " + token, ...(options.body ? { "Content-Type": "application/json" } : {}) }
    });
    if (response.status === 401) {
      onUnauthorized();
      throw new Error("Your admin session expired. Please sign in again.");
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Request failed.");
    return body;
  }
  async function load() {
    setLoading(true);
    setError("");
    try {
      const [payouts, creatorList] = await Promise.all([request("/admin/creator-withdrawals"), request("/admin/creators")]);
      setData(payouts);
      setCreators(creatorList);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function review(withdrawal, decision) {
    const reason = (reasons[withdrawal.id] || "").trim();
    if (decision === "rejected" && !reason) return setError("Enter a reason before rejecting this request.");
    if (decision === "paid" && !window.confirm(`Confirm you have sent ${rupees(withdrawal.amountRupees)} to ${withdrawal.username} on ${withdrawal.payoutAppLabel} ${withdrawal.payoutNumber}?`)) return;
    setBusy(withdrawal.id);
    setError("");
    try {
      await request(`/admin/creator-withdrawals/${encodeURIComponent(withdrawal.id)}`, {
        method: "PATCH", body: JSON.stringify({ decision, ...(decision === "rejected" ? { reason } : {}) })
      });
      setNotice(decision === "paid" ? `${rupees(withdrawal.amountRupees)} marked paid and deducted from ${withdrawal.username}'s wallet.` : `Request from ${withdrawal.username} rejected.`);
      setReasons(current => { const next = { ...current }; delete next[withdrawal.id]; return next; });
      await load();
      onChanged?.();
    } catch (err) { setError(err.message); }
    finally { setBusy(""); }
  }
  async function sendCredit(event) {
    event.preventDefault();
    const creator = creators.find(item => item.id === credit.creatorId);
    if (!creator) return setError("Choose a creator.");
    if (!window.confirm(`Add ${rupees(credit.amountRupees)} to ${creator.username}'s wallet?`)) return;
    setBusy("credit");
    setError("");
    try {
      await request("/admin/creator-credits", { method: "POST", body: JSON.stringify(credit) });
      setNotice(`${rupees(credit.amountRupees)} added to ${creator.username}'s wallet.`);
      setCredit({ creatorId: "", amountRupees: "", note: "" });
      await load();
      onChanged?.();
    } catch (err) { setError(err.message); }
    finally { setBusy(""); }
  }

  return <section className="admin-panel creator-payouts">
    <div className="section-heading"><div><span className="eyebrow"><WalletCards size={14}/> CREATOR PAYOUTS</span><h1>Withdrawal requests</h1><p className="muted">Pay the creator manually on Google Pay or PhonePe, then mark the request paid. Paid amounts are deducted from their wallet.</p></div><div className="admin-actions"><button className="secondary-btn" onClick={load} disabled={loading}><RefreshCw size={16}/> Refresh</button><button className="secondary-btn" onClick={onBack}>Back to dashboard</button></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="payout-notice" role="status">{notice}</p>}

    <section className="notification-section"><h2>Pending requests {data.pending.length > 0 && <span className="notification-count">{data.pending.length}</span>}</h2>
      {loading && !data.pending.length ? <p className="muted">Loading…</p> : data.pending.length ? <div className="member-application-list">{data.pending.map(withdrawal => <article className="member-application payout-request" key={withdrawal.id}>
        <div><strong>{withdrawal.username} · {rupees(withdrawal.amountRupees)}</strong><span>{withdrawal.payoutAppLabel}: <b className="payout-number">{withdrawal.payoutNumber}</b></span><span>Requested {when(withdrawal.createdAt)}</span><span className="muted">Wallet balance left after this request: {rupees(withdrawal.availableAfterRupees)}</span></div>
        <div className="payout-actions">
          <button className="primary-btn" disabled={busy === withdrawal.id} onClick={() => review(withdrawal, "paid")}><Check size={16}/> Paid</button>
          <input aria-label={`Rejection reason for ${withdrawal.username}`} maxLength={500} placeholder="Reason for rejecting" value={reasons[withdrawal.id] || ""} onChange={event => setReasons(current => ({ ...current, [withdrawal.id]: event.target.value }))}/>
          <button className="secondary-btn danger-btn" disabled={busy === withdrawal.id} onClick={() => review(withdrawal, "rejected")}><X size={16}/> Reject</button>
        </div>
      </article>)}</div> : <p className="muted">No withdrawal requests waiting.</p>}
    </section>

    <section className="notification-section"><h2><IndianRupee size={18}/> Send amount to a creator</h2><p className="muted">Adds money to the creator's wallet (bonus, correction or manual earnings). They are notified and can withdraw it.</p>
      <form className="business-invite-form payout-credit-form" onSubmit={sendCredit}>
        <label>Creator<select required value={credit.creatorId} onChange={event => setCredit(current => ({ ...current, creatorId: event.target.value }))}><option value="">Choose a creator</option>{creators.map(creator => <option key={creator.id} value={creator.id}>{creator.displayName && creator.displayName !== creator.username ? `${creator.displayName} (@${creator.username})` : creator.username}</option>)}</select></label>
        <label>Amount (₹)<input required inputMode="decimal" pattern="\d+(\.\d{1,2})?" placeholder="500" value={credit.amountRupees} onChange={event => setCredit(current => ({ ...current, amountRupees: event.target.value }))}/></label>
        <label>Note (optional)<input maxLength={200} placeholder="Festival bonus" value={credit.note} onChange={event => setCredit(current => ({ ...current, note: event.target.value }))}/></label>
        <button className="primary-btn" type="submit" disabled={busy === "credit"}><Send size={16}/> Send amount</button>
      </form>
      {data.credits.length > 0 && <div className="wallet-video-analytics">{data.credits.map(item => <article className="wallet-video-row" key={item.id}><div className="wallet-video-heading"><strong>{item.username} · +{rupees(item.amountRupees)}</strong><span>{when(item.createdAt)}</span></div>{item.note && <div className="wallet-video-metrics"><span>{item.note}</span></div>}</article>)}</div>}
    </section>

    <section className="notification-section"><h2>Recent decisions</h2>
      {data.recent.length ? <div className="wallet-video-analytics">{data.recent.map(item => <article className="wallet-video-row" key={item.id}><div className="wallet-video-heading"><strong>{item.username} · {rupees(item.amountRupees)} · {item.payoutAppLabel} {item.payoutNumber}</strong><span className={`status ${item.status === "paid" ? "published" : ""}`}>{item.status}</span></div><div className="wallet-video-metrics"><span>{item.status === "paid" ? "Paid" : "Rejected"} {when(item.reviewedAt)}</span>{item.rejectionReason && <span>Reason: {item.rejectionReason}</span>}</div></article>)}</div> : <p className="muted">No paid or rejected requests yet.</p>}
    </section>
  </section>;
}
