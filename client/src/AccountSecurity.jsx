import { useEffect, useState } from "react";

async function request(api, path, body, token, method = "POST") {
  const response = await fetch(`${api}${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to complete this account request.");
  return data;
}

export function Recovery({ onBack }) {
  useEffect(() => { window.history.replaceState({}, "", "/"); }, []);
  return <section className="admin-panel login-panel"><div className="login-card">
    <h1>Email recovery unavailable</h1>
    <p>Email verification and email recovery have been removed. Sign in with your username and password. Contact support if you cannot sign in.</p>
    <button className="secondary-btn" onClick={onBack}>Back to sign in</button>
  </div></section>;
}

export default function AccountSecurity({ api, token, onUsernameChanged }) {
  const [profile, setProfile] = useState(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function load() {
    const data = await request(api, "/account/security", null, token, "GET");
    setProfile(data); setUsername(data.username);
  }
  useEffect(() => { load().catch(err=>setError(err.message)); }, [api, token]);
  async function changeUsername(event) {
    event.preventDefault(); setBusy(true); setMessage(""); setError("");
    try {
      const data = await request(api, "/account/username", { username, password }, token, "PATCH");
      onUsernameChanged(data.username);
      setMessage(data.message); setPassword("");
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="notification-section account-security">
    <h2>Username & account settings</h2>
    <p>Current password is required to change your username. Email verification and email recovery are unavailable.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {profile && <form className="profile-form" onSubmit={changeUsername}>
      <label>Current password<input type="password" autoComplete="current-password" maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <label>New username<input required minLength={3} maxLength={32} pattern={"[a-zA-Z0-9._\\-]+"} value={username} onChange={e=>setUsername(e.target.value)}/></label>
      <button className="secondary-btn" disabled={busy || !password}>Change username</button>
    </form>}
  </section>;
}
