import { useEffect, useState } from "react";

const labels = {
  memberWatch: "Personal watches (members and creators)",
  referralViews: "Referral views (members and creators)",
  creatorRegularViews: "Creator regular-video views",
  creatorSimplyViews: "Creator Simply views",
  creatorRegularAds: "Creator-linked regular-video ads",
  creatorSimplyAds: "Creator-linked Simply ads",
  referralSignup: "Referral signup bonus (members and creators)"
};
const creatorKeys = ["creatorRegularViews", "creatorSimplyViews", "creatorRegularAds", "creatorSimplyAds"];
const rateText = (key, rate) => key === "referralSignup"
  ? `₹${rate} per account that joins with your referral ID`
  : `₹${rate} per 1,000 qualifying ${key.endsWith("Ads") ? "full ad watches" : key === "memberWatch" ? "distinct videos watched" : "views"}`;

export function RewardSummary({ settings, member = false }) {
  if (!settings) return <p className="muted">Refresh after the rewards API is deployed to see current reward settings.</p>;
  const keys = (member ? ["memberWatch", "referralViews", "referralSignup"] : creatorKeys).filter(key => settings[key]);
  return <div className="wallet-note">
    {keys.map(key => <p key={key}>{labels[key]}: {settings[key].enabled
      ? rateText(key, settings[key].rateRupees)
      : "Paused (no new rewards)"}.</p>)}
    <p>Earned proportionally on each new qualifying event. Rate changes and pauses never change previously credited earnings.
      {member && " Members and creators both qualify for personal and referral rewards, without creator approval."}</p>
  </div>;
}

export function AdminRewards({ api, token, onBack }) {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function request(options) {
    const response = await fetch(`${api}/admin/rewards/settings`, {
      ...options, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load or save reward settings.");
    return data;
  }
  useEffect(() => {
    let active = true;
    request().then(data => { if (active) setSettings(data); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [api, token]);
  async function save(event) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      setSettings(await request({ method: "PUT", body: JSON.stringify(settings) }));
      setMessage("Reward settings saved. Only future qualifying activity uses these rates.");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="admin-panel">
    <div className="section-heading"><div><h1>Reward settings</h1><p className="muted">    Control all seven reward types independently.</p></div><button className="secondary-btn" onClick={onBack}>Back to dashboard</button></div>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
        <p>Rates are whole rupees per 1,000 qualifying events, credited proportionally. The referral signup bonus is a flat amount credited to the member or creator whose referral ID a new member uses, once per joined account. Changes take effect when new activity qualifies, including ads already playing. Pausing stops new credit; it does not remove balances or make paused activity earn later.</p>
    <p>Members and creators earn personal-watch and referral rewards without creator approval. Creator-linked ads require a full watch, once per viewer per ad; skipped ads earn nothing.</p>
    {!settings ? <p>{error ? "Reopen this page to retry loading settings." : "Loading reward settings..."}</p> : <form className="video-form" onSubmit={save}>
      {Object.entries(labels).filter(([key]) => settings[key]).map(([key, label]) => <fieldset key={key} disabled={busy}>
        <legend>{label}</legend>
        <label className="checkbox-row"><input type="checkbox" checked={settings[key].enabled} onChange={event => setSettings(current => ({ ...current, [key]: { ...current[key], enabled: event.target.checked } }))}/>Enable new rewards</label>
        <label>{key === "referralSignup" ? "Rupees per joined account" : "Rupees per 1,000 events"}<input type="number" required min="0" max={key === "referralSignup" ? "10000" : "1000000"} step="1" value={settings[key].rateRupees} onChange={event => setSettings(current => ({ ...current, [key]: { ...current[key], rateRupees: event.target.value === "" ? "" : Number(event.target.value) } }))}/></label>
      </fieldset>)}
      <button className="primary-btn" disabled={busy}>{busy ? "Saving..." : "Save reward settings"}</button>
    </form>}
  </section>;
}
