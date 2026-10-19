import { useEffect, useState } from "react";

async function request(api, path, body, token, method = "POST") {
  const response = await fetch(`${api}${path}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to complete this account request.");
  return data;
}

export function Recovery({ api, initialPurpose = "password", onBack, onPasswordReset }) {
  const params = new URLSearchParams(window.location.search);
  const action = params.get("account-action");
  const [purpose, setPurpose] = useState(["reset", "verify"].includes(action) ? action : initialPurpose);
  const [code, setCode] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (action) window.history.replaceState({}, "", "/");
  }, [action]);
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setMessage(""); setError("");
    try {
      const data = await request(api, purpose === "reset" || purpose === "verify" ? "/auth/account-action" : "/auth/recovery",
        purpose === "reset" || purpose === "verify" ? { purpose, token: code.trim(), password } : { purpose, email });
      setMessage(data.message);
      setPassword(""); setCode("");
      if (purpose === "reset") onPasswordReset?.();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="admin-panel login-panel"><div className="login-card">
    <h1>Account recovery</h1>
    <p>Use the recovery email you previously verified in your profile. If you never added one, contact support for help.</p>
    <form className="login-form" onSubmit={submit}>
      <label>Option<select value={purpose} disabled={busy} onChange={e=>{setPurpose(e.target.value);setMessage("");setError("");}}>
        <option value="password">Forgot password</option><option value="username">Forgot username</option>
        <option value="reset">Reset password with email code</option><option value="verify">Verify recovery email</option>
      </select></label>
      {["password", "username"].includes(purpose)
        ? <label>Verified recovery email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
        : <label>Code from email<input required autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)}/></label>}
      {purpose === "reset" && <label>New password<input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)}/></label>}
      <button className="primary-btn" disabled={busy}>{busy ? "Please wait..." : ["password", "username"].includes(purpose) ? "Send recovery email" : "Confirm"}</button>
    </form>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <button className="secondary-btn" onClick={onBack}>Back to sign in</button>
  </div></section>;
}

export default function AccountSecurity({ api, token, onUsernameChanged }) {
  const [profile, setProfile] = useState(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function load() {
    const data = await request(api, "/account/security", null, token, "GET");
    setProfile(data); setUsername(data.username); setEmail(data.pendingEmail || data.email);
  }
  useEffect(() => { load().catch(err=>setError(err.message)); }, [api, token]);
  async function run(event, path, body) {
    event.preventDefault(); setBusy(true); setMessage(""); setError("");
    try {
      const data = await request(api, path, body, token, path === "/account/username" ? "PATCH" : "POST");
      if (data.username) onUsernameChanged(data.username);
      setMessage(data.message); setPassword(""); setCode("");
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="notification-section account-security">
    <h2>Username & account recovery</h2>
    <p>Set and verify an email to recover your password or username. Current password is required to change account details.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {profile && <>
      <label>Current password<input type="password" autoComplete="current-password" maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <form className="profile-form" onSubmit={e=>run(e, "/account/username", { username, password })}>
        <label>New username<input required minLength={3} maxLength={32} pattern={"[a-zA-Z0-9._\\-]+"} value={username} onChange={e=>setUsername(e.target.value)}/></label>
        <button className="secondary-btn" disabled={busy || !password}>Change username</button>
      </form>
      <p>{profile.email ? `Verified recovery email: ${profile.email}` : "No verified recovery email. Recovery is unavailable until you verify one."}</p>
      <form className="profile-form" onSubmit={e=>run(e, "/account/recovery-email", { email, password })}>
        <label>Recovery email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
        <button className="secondary-btn" disabled={busy || !password}>Send verification email</button>
      </form>
      {profile.pendingEmail && <form className="profile-form" onSubmit={e=>run(e, "/auth/account-action", { purpose: "verify", token: code.trim() })}>
        <label>Verification code from email<input required autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)}/></label>
        <button className="primary-btn" disabled={busy}>Verify email</button>
      </form>}
      <p><a href="/?account-action=recover">Forgot password or username?</a></p>
    </>}
  </section>;
}
