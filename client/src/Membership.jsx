import { useEffect, useState } from "react";
import "./membership.css";

const imageTypes = ["image/jpeg", "image/png", "image/webp"];
async function request(api, token, path, options = {}) {
  const response = await fetch(`${api}${path}`, {
    ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Membership request failed.");
  return data;
}
function imageError(file) {
  return !file || !imageTypes.includes(file.type) || file.size > 8 * 1024 * 1024 || !file.size
    ? "Choose a JPEG, PNG, or WebP image up to 8 MB." : "";
}
function PaymentHistory({ payments }) {
  return <div className="membership-history">{payments.map(payment => <article key={payment.id}>
    <strong>{payment.plan.name} - ₹{payment.plan.priceRupees}</strong>
    <span>{payment.status === "approving" ? "pending" : payment.status} · {new Date(payment.createdAt).toLocaleDateString()}</span>
    {payment.reason && <p>Reason: {payment.reason}</p>}
  </article>)}</div>;
}

export function CreatorMembership({ api, token, onUpdated, onClose }) {
  const [state, setState] = useState(null);
  const [payments, setPayments] = useState([]);
  const [planId, setPlanId] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function load() {
    const [next, history] = await Promise.all([
      request(api, token, "/creator/membership"), request(api, token, "/creator/membership/payments")
    ]);
    setState(next);
    setPayments(history);
    setPlanId(current => next.plans.some(plan => plan.id === current) ? current : next.plans[0]?.id || "");
    onUpdated(next);
  }
  useEffect(() => { load().catch(err => setError(err.message)); }, [api, token]);
  const plan = state?.plans.find(item => item.id === planId);
  const pending = payments.some(payment => ["pending", "approving"].includes(payment.status));
  async function submit(event) {
    event.preventDefault();
    const validation = imageError(file);
    if (validation) { setError(validation); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const query = new URLSearchParams({ planId: plan.id, priceRupees: plan.priceRupees, durationDays: plan.durationDays });
      await request(api, token, `/creator/membership/payments?${query}`, {
        method: "POST", headers: { "Content-Type": file.type }, body: file
      });
      setFile(null);
      setMessage("Screenshot submitted. Membership activates only after the administrator verifies your payment. Do not pay again while it is pending.");
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="admin-panel membership-panel">
    <div className="section-heading"><h2>Creator membership</h2><button className="secondary-btn" onClick={onClose}>Close</button></div>
    {error && <p role="alert" className="membership-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!state ? <p>Loading membership...</p> : <>
      <p>{state.status === "expired" ? "Membership expired. Approval is required before uploading again." : `${state.status === "trial" ? "Free trial" : "Membership active"}: ${state.daysLeft} day(s) left.`}</p>
      <button className="secondary-btn" disabled={busy} onClick={() => load().catch(err => setError(err.message))}>Refresh payment status</button>
      {pending ? <p role="status">Payment awaiting manual review. Do not pay or submit again. Your current trial or paid expiry stays unchanged until approval.</p> : !state.qrUrl ? <p>The administrator has not added a payment QR yet. Please do not pay.</p> : <form className="video-form" onSubmit={submit}>
        <label>Choose plan<select value={planId} disabled={busy} onChange={event => setPlanId(event.target.value)}>
          {state.plans.map(item => <option key={item.id} value={item.id}>{item.name} - ₹{item.priceRupees} / {item.durationDays} days</option>)}
        </select></label>
        <p>1. Scan the QR using your payment app and pay exactly <strong>₹{plan?.priceRupees}</strong>. Verify the recipient before paying.</p>
        <img className="membership-qr" src={`${api}${state.qrUrl}`} alt="Membership payment QR"/>
        <p>2. Upload the successful payment screenshot. The administrator will verify the money received, then approve {plan?.durationDays} days of membership.</p>
        <label>Payment screenshot<input type="file" required accept={imageTypes.join(",")} disabled={busy} onChange={event => setFile(event.target.files?.[0] || null)}/></label>
        <p className="muted">JPEG, PNG, or WebP, up to 8 MB. Screenshots are visible only to administrators. This is not an automatic recurring payment.</p>
        <button className="primary-btn" disabled={busy || !file || !plan}>{busy ? "Submitting..." : "Submit payment for approval"}</button>
      </form>}
      <h3>Payment history</h3><PaymentHistory payments={payments}/>
    </>}
  </section>;
}

export function AdminMembership({ api, token, onBack }) {
  const [settings, setSettings] = useState(null);
  const [payments, setPayments] = useState([]);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reasons, setReasons] = useState({});
  const [proof, setProof] = useState(null);
  useEffect(() => () => { if (proof) URL.revokeObjectURL(proof.url); }, [proof]);
  async function loadPayments() {
    setPayments(await request(api, token, `/admin/membership/payments${all ? "?status=all" : ""}`));
  }
  useEffect(() => {
    request(api, token, "/admin/membership").then(setSettings).catch(err => setError(err.message));
  }, [api, token]);
  useEffect(() => { loadPayments().catch(err => setError(err.message)); }, [api, token, all]);
  async function act(action, success) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); if (success) setMessage(success); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  function updatePlan(id, patch) {
    setSettings(current => ({ ...current, plans: current.plans.map(plan => plan.id === id ? { ...plan, ...patch } : plan) }));
  }
  async function showProof(payment) {
    const response = await fetch(`${api}${payment.proofUrl}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error((await response.json()).error || "Could not load screenshot.");
    setProof({ id: payment.id, url: URL.createObjectURL(await response.blob()) });
  }
  return <section className="admin-panel membership-panel">
    <button className="back-link" onClick={onBack}>Back to Admin</button>
    <h1>Membership settings & payment approvals</h1>
    {error && <p role="alert" className="membership-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!settings ? <p>Loading settings...</p> : <>
      <form className="video-form" onSubmit={event => { event.preventDefault(); act(async () => {
        setSettings(await request(api, token, "/admin/membership", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) }));
      }, "Membership settings saved."); }}>
        <label>Free trial (days)<input type="number" required min="0" max="365" value={settings.trialDays} onChange={event => setSettings({ ...settings, trialDays: Number(event.target.value) })}/></label>
        <p className="muted">Trial changes apply only to creators whose trial has not started. Existing trials and approved payments are not changed.</p>
        {settings.plans.map(plan => <fieldset className="membership-plan" key={plan.id}>
          <label>Plan name<input required maxLength="80" value={plan.name} onChange={event => updatePlan(plan.id, { name: event.target.value })}/></label>
          <label>Price (₹)<input type="number" required min="1" max="1000000" value={plan.priceRupees} onChange={event => updatePlan(plan.id, { priceRupees: Number(event.target.value) })}/></label>
          <label>Duration (days)<input type="number" required min="1" max="3660" value={plan.durationDays} onChange={event => updatePlan(plan.id, { durationDays: Number(event.target.value) })}/></label>
          <label><input type="checkbox" checked={plan.enabled} onChange={event => updatePlan(plan.id, { enabled: event.target.checked })}/> Available to creators</label>
          <button className="secondary-btn" type="button" onClick={() => setSettings({ ...settings, plans: settings.plans.filter(item => item.id !== plan.id) })}>Remove plan</button>
        </fieldset>)}
        <button className="secondary-btn" type="button" disabled={settings.plans.length >= 20} onClick={() => setSettings({ ...settings, plans: [...settings.plans, { id: crypto.randomUUID(), name: "New plan", priceRupees: 199, durationDays: 30, enabled: false }] })}>Add plan</button>
        <button className="primary-btn" disabled={busy}>Save plans & trial</button>
      </form>
      <h2>Payment QR</h2>
      {settings.qrUrl && <img className="membership-qr" src={`${api}${settings.qrUrl}`} alt="Current payment QR"/>}
      <label>Upload / replace QR (JPEG, PNG, WebP; max 8 MB)<input type="file" disabled={busy} accept={imageTypes.join(",")} onChange={event => {
        const file = event.target.files?.[0];
        if (!file) return;
        const validation = imageError(file);
        if (validation) { setError(validation); return; }
        act(async () => {
          const result = await request(api, token, "/admin/membership/qr", { method: "POST", headers: { "Content-Type": file.type }, body: file });
          setSettings(current => ({ ...current, qrUrl: result.qrUrl }));
        }, "Payment QR updated.");
      }}/></label>
    </>}
    <h2>Membership payments</h2>
    <p>Verify the payment in your bank / UPI app before approving. A screenshot alone is not proof of received funds. Approval adds the purchased duration to remaining paid membership, or starts today.</p>
    <label><input type="checkbox" checked={all} onChange={event => setAll(event.target.checked)}/> Include reviewed payments (latest 200)</label>
    <button className="secondary-btn" disabled={busy} onClick={() => act(loadPayments)}>Refresh</button>
    {!payments.length && <p>No payments to review.</p>}
    {payments.map(payment => <article className="membership-review" key={payment.id}>
      <strong>{payment.username} - {payment.plan.name} - ₹{payment.plan.priceRupees} / {payment.plan.durationDays} days</strong>
      <p>{payment.status} · Submitted {new Date(payment.createdAt).toLocaleString()}</p>
      <button className="secondary-btn" disabled={busy} onClick={() => act(() => showProof(payment))}>View screenshot</button>
      {proof?.id === payment.id && <div><img className="membership-proof" src={proof.url} alt={`Payment screenshot from ${payment.username}`}/><button className="secondary-btn" onClick={() => setProof(null)}>Close screenshot</button></div>}
      {["pending", "approving"].includes(payment.status) && <>
        <label>Rejection reason<textarea maxLength="500" value={reasons[payment.id] || ""} onChange={event => setReasons({ ...reasons, [payment.id]: event.target.value })}/></label>
        <div className="admin-actions">{["approved", "rejected"].map(decision => <button key={decision} className={decision === "approved" ? "primary-btn" : "secondary-btn"} disabled={busy || (decision === "rejected" && (!reasons[payment.id]?.trim() || payment.status === "approving"))} onClick={() => act(async () => {
          await request(api, token, `/admin/membership/payments/${payment.id}/review`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, reason: reasons[payment.id] })
          });
          await loadPayments();
        }, decision === "approved" ? "Membership approved." : "Payment rejected.")}>{decision === "approved" ? "Confirm received & approve" : "Reject"}</button>)}</div>
      </>}
      {payment.reason && <p>Reason: {payment.reason}</p>}
    </article>)}
  </section>;
}
