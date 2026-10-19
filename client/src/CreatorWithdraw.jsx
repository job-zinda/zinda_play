import { useState } from "react";
import { Send } from "lucide-react";

const rupees = value => `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CreatorWithdraw({ api, token, wallet, onChanged }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("full");
  const [form, setForm] = useState({ payoutApp: "gpay", payoutNumber: "", amountRupees: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  if (!wallet) return null;
  const minimum = wallet.minimumWithdrawalRupees ?? 100;
  const available = Number(wallet.availableRupees || 0);
  const shortBy = Math.max(0, minimum - available);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${api}/creator/withdrawals`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ payoutApp: form.payoutApp, payoutNumber: form.payoutNumber, ...(mode === "custom" ? { amountRupees: form.amountRupees } : {}) })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to request your withdrawal.");
      setNotice(`Withdrawal of ${rupees(data.amountRupees)} requested. The admin will pay it to your ${data.payoutAppLabel} ${data.payoutNumber}.`);
      setOpen(false);
      setForm(current => ({ ...current, amountRupees: "" }));
      await onChanged?.();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  return <section className="notification-section creator-withdraw">
    <div className="creator-withdraw-summary">
      <div><span>Available to withdraw</span><strong>{rupees(available)}</strong></div>
      <div><span>Withdrawn</span><strong>{rupees(wallet.withdrawnRupees)}</strong></div>
      <div><span>Pending</span><strong>{rupees(wallet.pendingWithdrawalRupees)}</strong></div>
      {Number(wallet.adminCreditsRupees) > 0 && <div><span>Added by admin</span><strong>{rupees(wallet.adminCreditsRupees)}</strong></div>}
    </div>
    <p className="muted">Minimum withdrawal is ₹{minimum}. {wallet.hasPendingWithdrawal ? "Your request is waiting for the admin." : shortBy > 0 ? `Earn ${rupees(shortBy)} more to withdraw.` : "You can withdraw the full balance or a custom amount."}</p>
    {notice && <p className="payout-notice" role="status">{notice}</p>}
    {!open ? <button className="primary-btn" disabled={!wallet.canWithdraw} onClick={() => { setOpen(true); setError(""); setNotice(""); }}><Send size={16}/> Withdraw</button>
      : <form className="business-invite-form creator-withdraw-form" onSubmit={submit}>
        <fieldset className="withdraw-choice"><legend>Amount</legend>
          <label><input type="radio" name="withdraw-mode" checked={mode === "full"} onChange={() => setMode("full")}/> Full balance ({rupees(available)})</label>
          <label><input type="radio" name="withdraw-mode" checked={mode === "custom"} onChange={() => setMode("custom")}/> Custom amount</label>
        </fieldset>
        {mode === "custom" && <label>Amount (₹{minimum} – {rupees(available)})<input required inputMode="decimal" pattern="\d+(\.\d{1,2})?" placeholder={String(minimum)} value={form.amountRupees} onChange={event => setForm(current => ({ ...current, amountRupees: event.target.value }))}/></label>}
        <fieldset className="withdraw-choice"><legend>Pay me on</legend>
          <label><input type="radio" name="payout-app" checked={form.payoutApp === "gpay"} onChange={() => setForm(current => ({ ...current, payoutApp: "gpay" }))}/> Google Pay</label>
          <label><input type="radio" name="payout-app" checked={form.payoutApp === "phonepe"} onChange={() => setForm(current => ({ ...current, payoutApp: "phonepe" }))}/> PhonePe</label>
        </fieldset>
        <label>{form.payoutApp === "gpay" ? "Google Pay" : "PhonePe"} number<input required type="tel" inputMode="numeric" maxLength={14} placeholder="98765 43210" value={form.payoutNumber} onChange={event => setForm(current => ({ ...current, payoutNumber: event.target.value }))}/></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="admin-actions"><button className="primary-btn" type="submit" disabled={saving}>{saving ? "Sending…" : "Request withdrawal"}</button><button className="secondary-btn" type="button" onClick={() => setOpen(false)}>Cancel</button></div>
      </form>}
    {wallet.withdrawals?.length > 0 && <><h2>Withdrawal history</h2><div className="wallet-video-analytics">{wallet.withdrawals.map(item => <article className="wallet-video-row" key={item.id}><div className="wallet-video-heading"><strong>{rupees(item.amountRupees)} · {item.payoutAppLabel} {item.payoutNumber}</strong><span className={`status ${item.status === "paid" ? "published" : ""}`}>{item.status}</span></div><div className="wallet-video-metrics"><span>Requested {new Date(item.createdAt).toLocaleString()}</span>{item.paidAt && <span>Paid {new Date(item.paidAt).toLocaleString()}</span>}{item.rejectionReason && <span>Reason: {item.rejectionReason}</span>}</div></article>)}</div></>}
    {wallet.credits?.length > 0 && <><h2>Added by admin</h2><div className="wallet-video-analytics">{wallet.credits.map(item => <article className="wallet-video-row" key={item.id}><div className="wallet-video-heading"><strong>+{rupees(item.amountRupees)}</strong><span>{new Date(item.createdAt).toLocaleDateString()}</span></div>{item.note && <div className="wallet-video-metrics"><span>{item.note}</span></div>}</article>)}</div></>}
  </section>;
}
