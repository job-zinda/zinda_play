import { useState } from "react";

export default function DeleteAccount({ api, token, role, onSignIn, onDeleted }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch(`${api}/account`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmation })
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "Could not finish deletion. Retry to complete removing your data.");
      }
      onDeleted();
    } catch (failure) {
      setError(`${failure.message} If deletion has started, videos and ads remain disabled. Retry here to finish, or contact jobzinda@gmail.com.`);
    } finally { setBusy(false); }
  }
  return <section className="admin-panel">
    <h1>Delete account</h1>
    <p>This permanently removes your account, profile, uploaded videos and associated social content. Linked ads stop and all login sessions end. This cannot be undone.</p>
    <p>Necessary payment evidence, earnings, withdrawal and non-public ledger records may be retained for reconciliation and legal obligations. Contact jobzinda@gmail.com about outstanding balances before deleting; deletion does not automatically pay or refund them.</p>
    <p><a href="/privacy.html">Privacy Policy</a> · <a href="/delete-account.html">Deletion details and support</a></p>
    {!token ? <button className="primary-btn" onClick={onSignIn}>Sign in to delete account</button>
      : role === "admin" ? <p>Administrative credentials cannot be deleted here. Sign in with your personal account.</p>
      : <form className="video-form" onSubmit={submit}>
        {error && <p role="alert">{error}</p>}
        <label>Current password<input type="password" autoComplete="current-password" required maxLength={128} value={password} disabled={busy} onChange={event => setPassword(event.target.value)}/></label>
        <label>Type DELETE to confirm<input required value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} autoComplete="off"/></label>
        <button className="primary-btn" disabled={busy || !password || confirmation !== "DELETE"}>{busy ? "Deleting account..." : "Permanently delete account"}</button>
      </form>}
  </section>;
}
