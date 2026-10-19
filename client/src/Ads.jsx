import { useEffect, useRef, useState } from "react";
import { Megaphone, Plus, Trash2, Pencil, Eye, MousePointerClick, Play, X, ExternalLink } from "lucide-react";
import "./ads.css";
import { dueVideoAds, markAdDelivered } from "./ad-frequency.js";
import { AdminBusinessAdReview, PrivateAdMedia } from "./BusinessAds.jsx";

const track = (api, id, event) => fetch(`${api}/ads/${id}/${event}`, { method: "POST" })
  .then(response => { if (!response.ok) throw new Error(`Ad tracking failed (${response.status}).`); })
  .catch(error => console.error("Ad tracking failed:", error));
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
async function claimAd(api, ad, ticket, token) {
  const response = await fetch(`${api}/ads/${ad.id}/impression`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: ticket ? JSON.stringify({ ticket }) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not reserve ad impression.");
  return data.accepted === true;
}

// Banner ad shown at the top, middle or bottom of the home page.
export function AdSlot({ api, placement }) {
  const [ad, setAd] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch(adsUrl(api, placement))
      .then(response => (response.ok ? response.json() : []))
      .then(async list => {
        if (cancelled || !list.length) return;
        const chosen = pickRandom(list);
        if (!await claimAd(api, chosen) || cancelled) return;
        setAd(chosen);
      })
      .catch(error => console.error("Banner ad delivery failed:", error));
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
export function PlayerGate({ api, token, children }) {
  const [phase, setPhase] = useState("loading");
  const [ad, setAd] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);
  const videoRef = useRef(null);
  const ticket = useRef(null);
  const watchedMs = useRef(0);
  const lastPosition = useRef(0);
  const [playError, setPlayError] = useState("");
  const [finishing, setFinishing] = useState(false);
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  useEffect(() => {
    let cancelled = false;
    fetch(adsUrl(api, "video"))
      .then(response => (response.ok ? response.json() : []))
      .then(async list => {
        if (cancelled) return;
        const due = dueVideoAds(list);
        if (!due.length) return setPhase("done");
        const chosen = pickRandom(due);
        if (chosen.creatorVideoId) {
          const response = await fetch(`${api}/ads/${chosen.id}/view-start`, { method: "POST", headers: authHeaders });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Could not start creator ad watch tracking.");
          if (cancelled) return;
          ticket.current = data;
        }
        if (!await claimAd(api, chosen, ticket.current?.ticket, token) || cancelled) {
          if (!cancelled) setPhase("done");
          return;
        }
        markAdDelivered(chosen.id);
        setAd(chosen);
        setPhase("ad");
      })
      .catch(error => { console.error("Video ad delivery failed:", error); if (!cancelled) setPhase("done"); });
    return () => { cancelled = true; };
  }, [api, token]);

  useEffect(() => {
    if (phase !== "ad" || !ad) return;
    const media = videoRef.current;
    let hls;
    let cancelled = false;
    const src = mediaSrc(api, ad.mediaUrl);
    async function attach() {
      try {
        if (ad.creatorVideoId && !media.canPlayType("application/vnd.apple.mpegurl")) {
          const { default: Hls } = await import("hls.js/dist/hls.light.mjs");
          if (cancelled) return;
          if (!Hls.isSupported()) throw new Error("This browser cannot play this video ad.");
          hls = new Hls({ maxBufferLength: 10, maxMaxBufferLength: 20, backBufferLength: 0 });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!cancelled && data.fatal) {
              hls.stopLoad();
              setPlayError("The ad could not be played. Continue to your video.");
            }
          });
          hls.loadSource(src);
          hls.attachMedia(media);
        } else {
          media.src = src;
          media.load();
        }
      } catch (error) {
        if (!cancelled) setPlayError(error.message);
      }
    }
    attach();
    const visibility = () => {
      if (document.hidden) media.pause();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", visibility);
      media.pause();
      hls?.destroy();
      media.removeAttribute("src");
      media.load();
    };
  }, [phase, ad, api]);

  if (phase === "loading") return <div className="ad-preroll" aria-busy="true" />;
  if (phase === "done" || !ad) return children;

  const skipAt = Math.min(ad.skipAfterSeconds, duration || ad.skipAfterSeconds);
  const canSkip = ad.skippable && elapsed >= skipAt;
  const remaining = Math.max(0, Math.ceil((duration || 0) - elapsed));
  const finish = () => setPhase("done");
  const complete = async () => {
    if (finishing) return;
    const media = videoRef.current;
    const remaining = media.currentTime - lastPosition.current;
    if (!document.hidden && remaining > 0 && remaining < 1.5) watchedMs.current += remaining * 1000;
    setFinishing(true);
    if (ticket.current && watchedMs.current >= ticket.current.minimumWatchMs - 250) {
      try {
        const response = await fetch(`${api}/ads/${ad.id}/view`, {
          method: "POST", headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ ticket: ticket.current.ticket })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not record completed ad watch.");
      } catch (error) {
        console.error("Creator ad earning tracking failed:", error);
      }
    }
    if (ad.targetUrl || ad.productUrl) setPhase("endcard");
    else finish();
  };

  if (phase === "endcard") {
    const visit = (url, event = "click") => {
      track(api, ad.id, event);
      window.open(url, "_blank", "noopener,noreferrer");
    };
    return (
      <div className="ad-preroll ad-end-screen">
        <span className="ad-label">Ad</span>
        <section className="ad-end-card" aria-label="Advertisement finished">
          <span className="ad-end-kicker">Ad finished</span>
          <h2>{ad.title}</h2>
          {ad.description && <p>{ad.description}</p>}
          <div className="ad-end-actions">
            {ad.targetUrl && <button type="button" className="ad-visit" onClick={() => visit(ad.targetUrl)}>Visit advertiser <ExternalLink size={18}/></button>}
            {ad.productUrl && <button type="button" className="ad-product" onClick={() => visit(ad.productUrl)}>View product <ExternalLink size={18}/></button>}
            <button type="button" className="ad-skip ad-continue" onClick={finish}>Skip ad ›</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="ad-preroll">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        preload="auto"
        disablePictureInPicture
        controlsList="nodownload noremoteplayback"
        onLoadedMetadata={event => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={event => {
          const media = event.currentTarget;
          const delta = media.currentTime - lastPosition.current;
          lastPosition.current = media.currentTime;
          if (!document.hidden && !media.paused && !media.seeking && delta > 0 && delta < 1.5) watchedMs.current += delta * 1000;
          setElapsed(media.currentTime);
        }}
        onSeeking={event => { lastPosition.current = event.currentTarget.currentTime; }}
        onCanPlay={event => {
          if (!document.hidden) event.currentTarget.play().catch(error => {
            if (error.name === "NotAllowedError") setPaused(true);
            else if (error.name !== "AbortError") setPlayError(error.message);
          });
        }}
        onPlay={() => {
          setPaused(false);
        }}
        onPause={event => !event.currentTarget.ended && setPaused(true)}
        onEnded={complete}
        onError={() => setPlayError("The ad could not be played. Continue to your video.")}
      />
      <span className="ad-label">Ad</span>
      {playError && <div className="ad-error" role="alert"><p>{playError}</p><button className="secondary-btn" onClick={finish}>Continue to video</button></div>}
      {paused && <button type="button" className="ad-play" aria-label="Play ad" onClick={() => videoRef.current?.play()}><Play size={30} fill="currentColor"/></button>}
      {ad.skippable
        ? <button type="button" className="ad-skip" disabled={!canSkip} onClick={finish}>{canSkip ? "Skip ad ›" : `Skip in ${Math.max(1, Math.ceil(skipAt - elapsed))}s`}</button>
        : <span className="ad-skip ad-must">You can watch your video in {remaining || ""}{remaining ? "s" : "…"}</span>}
    </div>
  );
}

const blankAd = { title: "", type: "banner", placement: "top", mediaUrl: "", targetUrl: "", skippable: true, skipAfterSeconds: 20, frequency: 1, active: true, targetViews: 0, targetCity: "", targetCategories: [] };

export function AdminAds({ api, token, onBack, onUnauthorized }) {
  const [ads, setAds] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [form, setForm] = useState(blankAd);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [businessPreview, setBusinessPreview] = useState(null);
  const [creatorVideos, setCreatorVideos] = useState([]);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const request = async (path, options = {}) => {
    const response = await fetch(`${api}${path}`, { ...options, headers });
    if (response.status === 401) { onUnauthorized?.(); throw new Error("Your admin session expired. Please sign in again."); }
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  };
  const load = () => Promise.all([request("/admin/ads"), request("/admin/campaigns")])
    .then(([ads, campaigns]) => { setAds(ads); setCampaigns(campaigns); })
    .catch(err => setError(err.message));
  const [categories, setCategories] = useState([]);
  useEffect(() => {
    load();
    request("/categories").then(setCategories).catch(err => setError(err.message));
    request("/admin/creator-ad-videos").then(setCreatorVideos).catch(err => setError(err.message));
  }, []);
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
  const downloadReport = () => {
    const columns = ["Ad", "Type", "Status", "Frequency", "Target impressions", "Impressions", "Remaining", "Clicks", "CTR (%)", "Completion (%)", "Completed at", "Credited full ad watches", "Creator ad earnings (INR)"];
    const rows = [
      ...ads.map(ad => [ad.title, ad.type, ad.deliveryStatus, ad.frequency, ad.targetViews, ad.impressions, ad.remainingImpressions ?? "Unlimited", ad.clicks, ad.clickThroughRate.toFixed(2), ad.completionPercent?.toFixed(2) ?? "", ad.completedAt || "", ad.adEligibleViews ?? "", ad.adEstimatedEarningsRupees ?? ""]),
      ...campaigns.map(campaign => [campaign.businessName, "Business promotion", campaign.status, "", campaign.targetImpressions, campaign.impressions, campaign.remainingImpressions, "", "", campaign.completionPercent.toFixed(2), campaign.completedAt || "", "", ""])
    ];
    const csvCell = value => `"${String(value).replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`;
    const url = URL.createObjectURL(new Blob([[columns, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ad-analytics.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="admin-panel">
      <button className="back-link" onClick={onBack}>← Back to Admin</button>
      <div className="section-heading">
        <div><span className="eyebrow"><Megaphone size={14}/> ADVERTISING</span><h1>Ads</h1><p className="muted">Show banner ads on the home page and video ads before playback, on the web app and the mobile app.</p></div>
        {!showForm && <button className="primary-btn" onClick={startNew}><Plus size={16}/> New ad</button>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="admin-actions"><button className="secondary-btn" onClick={load}>Refresh analytics</button><button className="secondary-btn" onClick={downloadReport} disabled={!ads.length && !campaigns.length}>Download analytics CSV</button></div>
      <p className="muted">Impressions count reserved ad deliveries, not unique viewers or completed watches. Video frequency is counted per eligible video opening in this browser/app session for each ad; due ads rotate when several qualify.</p>

      {showForm && (
        <form className="video-form ads-form" onSubmit={save}>
          {form.businessSubmissionId ? <>
            <p>Paid business ad from {form.businessName}. Creative, URL, targeting and impression target are locked to the approved submission.</p>
            <p>{form.title} · {form.targetUrl} · {form.targetCity || "All locations"} · {form.targetViews} impressions</p>
            <label>Play this ad<select value={form.frequency} onChange={e => set({ frequency: Number(e.target.value) })}><option value={1}>Every video</option><option value={5}>Every 5 videos</option><option value={10}>Every 10 videos</option></select></label>
            <label><input type="checkbox" checked={form.skippable} onChange={e => set({ skippable: e.target.checked })}/> Allow skipping</label>
            {form.skippable && <label>Skip after seconds<input type="number" min={1} max={120} value={form.skipAfterSeconds} onChange={e => set({ skipAfterSeconds: Number(e.target.value) })}/></label>}
          </> : <>
          <label>Ad name<input required maxLength={120} value={form.title} onChange={e => set({ title: e.target.value })} placeholder="e.g. Diwali sale"/></label>
          <label>Ad type
            <select disabled={Boolean(form.creatorVideoId)} value={form.type} onChange={e => set({ type: e.target.value, mediaUrl: "" })}>
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
          {form.type === "video" && <label>Use a creator's approved video
            <select disabled={Boolean(editingId && form.creatorVideoId)} value={form.creatorVideoId || ""} onChange={event => {
              const video = creatorVideos.find(item => item.id === event.target.value);
              set({ creatorVideoId: video?.id || "", mediaUrl: video?.streamUrl || "", title: video?.title || form.title });
            }}>
              <option value="">Upload a separate ad instead</option>
              {creatorVideos.map(video => <option key={video.id} value={video.id}>{video.title} ({video.videoType === "short" ? "Simply" : "Regular"}){video.creatorUsername ? ` - @${video.creatorUsername}` : ""}</option>)}
              {form.creatorVideoId && !creatorVideos.some(video => video.id === form.creatorVideoId) && <option value={form.creatorVideoId}>{form.title} (source unavailable)</option>}
            </select>
          </label>}
          {form.creatorVideoId && <p className="muted">Creator ad earnings: ₹{(creatorVideos.find(video => video.id === form.creatorVideoId)?.videoType || form.creatorVideoType) === "short" ? 100 : 200} per 1,000 full ad watches, once per viewer per ad. The original video keeps its normal rate. Deleting the source stops this ad but preserves earned credit.</p>}
          {!form.creatorVideoId && <label>{form.type === "video" ? "Ad video (MP4 or WebM, up to 150 MB)" : "Banner image (JPG, PNG, WebP or GIF, up to 8 MB)"}
            <input type="file" accept={form.type === "video" ? "video/mp4,video/webm" : "image/jpeg,image/png,image/webp,image/gif"} onChange={e => upload(e.target.files?.[0])} disabled={uploading}/>
          </label>}
          {form.type === "banner" && <p className="muted">Recommended test image: 1200 x 400 pixels (3:1) for all banner positions on web and mobile. The full image scales without cropping; other sizes fit with padding. Use large, readable text and keep the top-left corner clear for the Ad label. Maximum 8 MB.</p>}
          {uploading && <p className="muted">Uploading… {progress}%</p>}
          {form.mediaUrl && !uploading && !form.creatorVideoId && (
            <div className="ad-preview">
              {form.type === "video"
                ? <video src={mediaSrc(api, form.mediaUrl)} controls preload="metadata"/>
                : <img src={mediaSrc(api, form.mediaUrl)} alt="Ad preview"/>}
            </div>
          )}
          <label>Click-through URL {form.creatorVideoId ? "(required)" : "(optional)"}
            <input required={Boolean(form.creatorVideoId)} type="url" value={form.targetUrl} onChange={e => set({ targetUrl: e.target.value })} placeholder="https://advertiser.example.com/offer"/>
          </label>
          {form.type === "video" && (
            <>
              <label>Play this ad
                <select value={form.frequency} onChange={e => set({ frequency: Number(e.target.value) })}>
                  <option value={1}>Every video</option><option value={5}>Every 5 videos</option><option value={10}>Every 10 videos</option>
                </select>
              </label>
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
          </>}
          <div className="checks"><label><input type="checkbox" checked={form.active} onChange={e => set({ active: e.target.checked })}/> Active (visible to viewers)</label></div>
          <div className="admin-actions">
            <button className="primary-btn" disabled={busy || uploading || (!form.mediaUrl && !form.creatorVideoId)}>{busy ? "Saving…" : editingId ? "Save changes" : "Create ad"}</button>
            <button type="button" className="secondary-btn" onClick={() => setShowForm(false)}><X size={15}/> Cancel</button>
          </div>
        </form>
      )}

      {ads.length === 0 && !showForm ? (
        <div className="empty-state"><Megaphone size={32}/><h3>No ads yet</h3><p>Create a banner or a video ad to get started.</p></div>
      ) : (
        <div className="table-wrap ads-table">
          <table>
            <thead><tr><th>Ad</th><th>Where / frequency</th><th>Viewer option</th><th>Targeting</th><th>Status</th><th><Eye size={13}/> Impressions</th><th><MousePointerClick size={13}/> Clicks</th><th>Report</th><th/></tr></thead>
            <tbody>
              {ads.map(ad => (
                <tr key={ad.id}>
                  <td><div className="table-title">{ad.type === "banner" ? <img src={mediaSrc(api, ad.mediaUrl)} alt=""/> : <span className="mini-thumb"><Play size={14}/></span>}<span>{ad.title}{ad.businessName && <small> · {ad.businessName}</small>}</span></div></td>
                  <td>{where(ad)}{ad.type === "video" && <div>Every {ad.frequency || 1} video(s)</div>}</td>
                  <td>{mode(ad)}</td>
                  <td className="ads-target-cell">{targeting(ad).map(line => <div key={line}>{line}</div>)}</td>
                  <td><span className={`status ${ad.deliveryStatus === "active" ? "published" : ""}`}>{ad.deliveryStatus}</span></td>
                  <td>{ad.impressions.toLocaleString()}</td>
                  <td>{ad.clicks.toLocaleString()}</td>
                  <td><div>CTR: {ad.clickThroughRate.toFixed(2)}%</div><div>{ad.remainingImpressions === null ? "Unlimited" : `${ad.remainingImpressions} remaining · ${ad.completionPercent.toFixed(1)}% complete`}</div>{ad.creatorVideoId && <div>{ad.adEligibleViews || 0} credited full watches · ₹{Number(ad.adEstimatedEarningsRupees || 0).toFixed(2)} creator earnings{ad.sourceAvailable === false && <div>Source unavailable; activation blocked.</div>}</div>}{ad.completedAt && <div>Completed {new Date(ad.completedAt).toLocaleString()}</div>}</td>
                  <td>
                    <button className="icon-btn" title={ad.active ? "Pause" : ad.businessSubmissionId ? "Publish business ad" : "Activate"} disabled={ad.deliveryStatus === "completed" || (!ad.active && ad.sourceAvailable === false)} onClick={() => toggle(ad)}><Eye size={15}/></button>
                    {ad.businessSubmissionId && <button className="secondary-btn" onClick={() => setBusinessPreview(ad.businessSubmissionId)}>Preview</button>}
                    <button className="icon-btn" title="Edit" onClick={() => startEdit(ad)}><Pencil size={15}/></button>
                    {!ad.businessSubmissionId && !ad.creatorVideoId && <button className="icon-btn danger" title="Delete" onClick={() => remove(ad)}><Trash2 size={15}/></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {businessPreview && <PrivateAdMedia api={api} token={token} path={`/admin/business-ads/${businessPreview}/video`} video onClose={() => setBusinessPreview(null)}/>}
      <AdminBusinessAdReview api={api} token={token} onUpdated={load} categories={categories}/>
      <h2>Legacy paid business promotion reports</h2>
      <p className="muted">Latest 500 campaigns. Location targeting and purchased impression limits remain in effect. These feed promotions are separate from pre-roll ad frequency.</p>
      {campaigns.length ? <div className="table-wrap"><table>
        <thead><tr><th>Business / video</th><th>Location</th><th>Status</th><th>Amount</th><th>Impressions / target</th><th>Report</th></tr></thead>
        <tbody>{campaigns.map(campaign => <tr key={campaign.id}>
          <td>{campaign.businessName}<div>{campaign.videoId}</div></td>
          <td>{campaign.countryCode}{campaign.regionCode ? ` / ${campaign.regionCode}` : ""}</td>
          <td>{campaign.status}</td><td>₹{campaign.amountRupees}</td>
          <td>{campaign.impressions} / {campaign.targetImpressions}</td>
          <td>{campaign.remainingImpressions} remaining · {campaign.completionPercent.toFixed(1)}% complete{campaign.completedAt && <div>Completed {new Date(campaign.completedAt).toLocaleString()}</div>}</td>
        </tr>)}</tbody>
      </table></div> : <p className="muted">No paid business campaigns yet.</p>}
    </section>
  );
}
