import { useEffect, useRef, useState } from "react";
import { Megaphone, Plus, Trash2, Pencil, Eye, MousePointerClick, Play, X, ExternalLink } from "lucide-react";
import "./ads.css";

const track = (api, id, event) => fetch(`${api}/ads/${id}/${event}`, { method: "POST" }).catch(() => {});
const pickRandom = list => list[Math.floor(Math.random() * list.length)];

// Categories of the videos this viewer opened recently, used for interest targeting.
const INTEREST_KEY = "zp_recent_categories";
const readInterests = () => { try { return JSON.parse(localStorage.getItem(INTEREST_KEY)) || []; } catch { return []; } };
export function recordInterest(categoryId) {
  if (!categoryId) return;
  try {
    const next = [categoryId, ...readInterests().filter(id => id !== categoryId)].slice(0, 8);
    localStorage.setItem(INTEREST_KEY, JSON.stringify(next));
  } catch { /* storage unavailable */ }
}
const adsUrl = (api, placement) => `${api}/ads?placement=${placement}&interests=${encodeURIComponent(readInterests().join(","))}`;
const mediaSrc = (api, url) => (url && url.startsWith("/") ? `${api}${url}` : url);

// Banner ad shown at the top, middle or bottom of the home page.
export function AdSlot({ api, placement }) {
  const [ad, setAd] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch(adsUrl(api, placement))
      .then(response => (response.ok ? response.json() : []))
      .then(list => {
        if (cancelled || !list.length) return;
        const chosen = pickRandom(list);
        setAd(chosen);
        track(api, chosen.id, "impression");
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api, placement]);
  if (!ad) return null;
  const image = <img src={mediaSrc(api, ad.mediaUrl)} alt={ad.title} loading="lazy" />;
  return (
    <aside className={`ad-slot ad-${placement}`} aria-label="Advertisement">
      <span className="ad-label">Ad</span>
      {ad.targetUrl
        ? <a href={ad.targetUrl} target="_blank" rel="noopener noreferrer sponsored" onClick={() => track(api, ad.id, "click")}>{image}</a>
        : image}
    </aside>
  );
}

// Plays a video ad before the real player. Skippable ads unlock "Skip" after the admin's chosen delay.
export function PlayerGate({ api, children }) {
  const [phase, setPhase] = useState("loading");
  const [ad, setAd] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);
  const counted = useRef(false);
  const videoRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetch(adsUrl(api, "video"))
      .then(response => (response.ok ? response.json() : []))
      .then(list => {
        if (cancelled) return;
        if (!list.length) return setPhase("done");
        setAd(pickRandom(list));
        setPhase("ad");
      })
      .catch(() => !cancelled && setPhase("done"));
    return () => { cancelled = true; };
  }, [api]);

  if (phase === "loading") return <div className="ad-preroll" aria-busy="true" />;
  if (phase === "done" || !ad) return children;

  const skipAt = Math.min(ad.skipAfterSeconds, duration || ad.skipAfterSeconds);
  const canSkip = ad.skippable && elapsed >= skipAt;
  const remaining = Math.max(0, Math.ceil((duration || 0) - elapsed));
  const finish = () => setPhase("done");

  return (
    <div className="ad-preroll">
      <video
        ref={videoRef}
        src={mediaSrc(api, ad.mediaUrl)}
        autoPlay
        playsInline
        disablePictureInPicture
        controlsList="nodownload noremoteplayback"
        onLoadedMetadata={event => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={event => setElapsed(event.currentTarget.currentTime)}
        onPlay={() => {
          setPaused(false);
          if (!counted.current) { counted.current = true; track(api, ad.id, "impression"); }
        }}
        onPause={event => !event.currentTarget.ended && setPaused(true)}
        onEnded={finish}
        onError={finish}
      />
      <span className="ad-label">Ad</span>
      {paused && <button type="button" className="ad-play" aria-label="Play ad" onClick={() => videoRef.current?.play()}><Play size={30} fill="currentColor"/></button>}
      {ad.targetUrl && <a className="ad-visit" href={ad.targetUrl} target="_blank" rel="noopener noreferrer sponsored" onClick={() => { track(api, ad.id, "click"); videoRef.current?.pause(); }}>Visit advertiser <ExternalLink size={13}/></a>}
      {ad.skippable
        ? <button type="button" className="ad-skip" disabled={!canSkip} onClick={finish}>{canSkip ? "Skip ad ›" : `Skip in ${Math.max(1, Math.ceil(skipAt - elapsed))}s`}</button>
        : <span className="ad-skip ad-must">You can watch your video in {remaining || ""}{remaining ? "s" : "…"}</span>}
    </div>
  );
}

const blankAd = { title: "", type: "banner", placement: "top", mediaUrl: "", targetUrl: "", skippable: true, skipAfterSeconds: 20, active: true, targetViews: 0, targetCity: "", targetCategories: [] };

export function AdminAds({ api, token, onBack, onUnauthorized }) {
  const [ads, setAds] = useState([]);
  const [form, setForm] = useState(blankAd);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const request = async (path, options = {}) => {
    const response = await fetch(`${api}${path}`, { ...options, headers });
    if (response.status === 401) { onUnauthorized?.(); throw new Error("Your admin session expired. Please sign in again."); }
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  };
  const load = () => request("/admin/ads").then(setAds).catch(err => setError(err.message));
  const [categories, setCategories] = useState([]);
  useEffect(() => { load(); fetch(`${api}/categories`).then(r => r.json()).then(setCategories).catch(() => {}); }, []);
  const toggleCategory = id => set({ targetCategories: form.targetCategories.includes(id) ? form.targetCategories.filter(c => c !== id) : [...form.targetCategories, id] });
  const targeting = ad => [
    ad.targetViews ? `${ad.impressions.toLocaleString()} / ${ad.targetViews.toLocaleString()} views` : "Unlimited views",
    ad.targetCity ? `📍 ${ad.targetCity}` : "All locations",
    ad.targetCategories?.length ? `Interests: ${ad.targetCategories.map(id => categories.find(c => c.id === id)?.name || id).join(", ")}` : "All interests"
  ];

  const startNew = () => { setForm(blankAd); setEditingId(null); setError(""); setShowForm(true); };
  const startEdit = ad => { setForm({ ...blankAd, ...ad }); setEditingId(ad.id); setError(""); setShowForm(true); };

  const save = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request(editingId ? `/admin/ads/${editingId}` : "/admin/ads", { method: editingId ? "PATCH" : "POST", body: JSON.stringify(form) });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = ad => request(`/admin/ads/${ad.id}`, { method: "PATCH", body: JSON.stringify({ active: !ad.active }) }).then(load).catch(err => setError(err.message));
  const remove = ad => window.confirm(`Delete the ad "${ad.title}"?`) && request(`/admin/ads/${ad.id}`, { method: "DELETE" }).then(load).catch(err => setError(err.message));
  const set = patch => setForm(current => ({ ...current, ...patch }));
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  // XHR gives upload progress, which fetch can't report.
  const upload = file => {
    if (!file) return;
    setError("");
    setUploading(true);
    setProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${api}/admin/ads/media`);
    xhr.setRequestHeader("Authorization", headers.Authorization);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = e => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      setUploading(false);
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* keep empty */ }
      if (xhr.status === 401) { onUnauthorized?.(); return; }
      if (xhr.status >= 200 && xhr.status < 300) setForm(current => ({ ...current, mediaUrl: data.mediaUrl, type: data.type }));
      else setError(data.error || "Upload failed");
    };
    xhr.onerror = () => { setUploading(false); setError("Upload failed. Check your connection."); };
    xhr.send(file);
  };
  const where = ad => ad.type === "video" ? "Video before playback" : `Banner · ${ad.placement}`;
  const mode = ad => ad.type !== "video" ? "—" : ad.skippable ? `Skip after ${ad.skipAfterSeconds}s` : "Must watch";

  return (
    <section className="admin-panel">
      <button className="back-link" onClick={onBack}>← Back to Admin</button>
      <div className="section-heading">
        <div><span className="eyebrow"><Megaphone size={14}/> ADVERTISING</span><h1>Ads</h1><p className="muted">Show banner ads on the home page and video ads before playback, on the web app and the mobile app.</p></div>
        {!showForm && <button className="primary-btn" onClick={startNew}><Plus size={16}/> New ad</button>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      {showForm && (
        <form className="video-form ads-form" onSubmit={save}>
          <label>Ad name<input required maxLength={120} value={form.title} onChange={e => set({ title: e.target.value })} placeholder="e.g. Diwali sale"/></label>
          <label>Ad type
            <select value={form.type} onChange={e => set({ type: e.target.value, mediaUrl: "" })}>
              <option value="banner">Banner (image)</option>
              <option value="video">Video (plays before a video)</option>
            </select>
          </label>
          {form.type === "banner" && (
            <label>Banner position
              <select value={form.placement} onChange={e => set({ placement: e.target.value })}>
                <option value="top">Top of the home page</option>
                <option value="middle">Middle of the home page</option>
                <option value="bottom">Bottom of the home page</option>
              </select>
            </label>
          )}
          <label>{form.type === "video" ? "Ad video (MP4 or WebM, up to 150 MB)" : "Banner image (JPG, PNG, WebP or GIF, up to 8 MB)"}
            <input type="file" accept={form.type === "video" ? "video/mp4,video/webm" : "image/jpeg,image/png,image/webp,image/gif"} onChange={e => upload(e.target.files?.[0])} disabled={uploading}/>
          </label>
          {uploading && <p className="muted">Uploading… {progress}%</p>}
          {form.mediaUrl && !uploading && (
            <div className="ad-preview">
              {form.type === "video"
                ? <video src={mediaSrc(api, form.mediaUrl)} controls preload="metadata"/>
                : <img src={mediaSrc(api, form.mediaUrl)} alt="Ad preview"/>}
            </div>
          )}
          <label>Click-through URL (optional)
            <input type="url" value={form.targetUrl} onChange={e => set({ targetUrl: e.target.value })} placeholder="https://advertiser.example.com/offer"/>
          </label>
          {form.type === "video" && (
            <>
              <label>Viewer option
                <select value={form.skippable ? "skip" : "must"} onChange={e => set({ skippable: e.target.value === "skip" })}>
                  <option value="skip">Skippable after a delay</option>
                  <option value="must">Must watch until the end</option>
                </select>
              </label>
              {form.skippable && <label>Allow skipping after (seconds)<input type="number" min="1" max="120" value={form.skipAfterSeconds} onChange={e => set({ skipAfterSeconds: Number(e.target.value) })}/></label>}
            </>
          )}
          <fieldset className="ads-targeting">
            <legend>Targeting</legend>
            <label>Target number of views (0 = unlimited)
              <input type="number" min="0" step="1" value={form.targetViews} onChange={e => set({ targetViews: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}/>
              <small className="muted">The ad stops showing once it reaches this many views.</small>
            </label>
            <label>Location (city, optional)
              <input maxLength={100} value={form.targetCity} onChange={e => set({ targetCity: e.target.value })} placeholder="e.g. Chennai — leave empty for everywhere"/>
            </label>
            <div className="ads-interests">
              <span>Viewer interests (based on the categories of their recently watched videos)</span>
              <div className="interest-chips">
                {categories.map(c => (
                  <label key={c.id} className={form.targetCategories.includes(c.id) ? "on" : ""}>
                    <input type="checkbox" checked={form.targetCategories.includes(c.id)} onChange={() => toggleCategory(c.id)}/>{c.name}
                  </label>
                ))}
              </div>
              <small className="muted">Leave all unchecked to show the ad to everyone.</small>
            </div>
          </fieldset>
          <div className="checks"><label><input type="checkbox" checked={form.active} onChange={e => set({ active: e.target.checked })}/> Active (visible to viewers)</label></div>
          <div className="admin-actions">
            <button className="primary-btn" disabled={busy || uploading || !form.mediaUrl}>{busy ? "Saving…" : editingId ? "Save changes" : "Create ad"}</button>
            <button type="button" className="secondary-btn" onClick={() => setShowForm(false)}><X size={15}/> Cancel</button>
          </div>
        </form>
      )}

      {ads.length === 0 && !showForm ? (
        <div className="empty-state"><Megaphone size={32}/><h3>No ads yet</h3><p>Create a banner or a video ad to get started.</p></div>
      ) : (
        <div className="table-wrap ads-table">
          <table>
            <thead><tr><th>Ad</th><th>Where</th><th>Viewer option</th><th>Targeting</th><th>Status</th><th><Eye size={13}/> Views</th><th><MousePointerClick size={13}/> Clicks</th><th/></tr></thead>
            <tbody>
              {ads.map(ad => (
                <tr key={ad.id}>
                  <td><div className="table-title">{ad.type === "banner" ? <img src={mediaSrc(api, ad.mediaUrl)} alt=""/> : <span className="mini-thumb"><Play size={14}/></span>}<span>{ad.title}</span></div></td>
                  <td>{where(ad)}</td>
                  <td>{mode(ad)}</td>
                  <td className="ads-target-cell">{targeting(ad).map(line => <div key={line}>{line}</div>)}</td>
                  <td><span className={`status ${ad.active ? "published" : ""}`}>{ad.active ? "Active" : "Paused"}</span></td>
                  <td>{ad.impressions.toLocaleString()}</td>
                  <td>{ad.clicks.toLocaleString()}</td>
                  <td>
                    <button className="icon-btn" title={ad.active ? "Pause" : "Activate"} onClick={() => toggle(ad)}><Eye size={15}/></button>
                    <button className="icon-btn" title="Edit" onClick={() => startEdit(ad)}><Pencil size={15}/></button>
                    <button className="icon-btn danger" title="Delete" onClick={() => remove(ad)}><Trash2 size={15}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
