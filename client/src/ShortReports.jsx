import { useEffect, useState } from "react";

export function AdminShortReports({ api, token, videos, onUpdated }) {
  const [reports, setReports] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [preview, setPreview] = useState(null);
  async function request(path, options = {}) {
    const response = await fetch(`${api}${path}`, {
      ...options, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load Simply reports.");
    return data;
  }
  async function load() { setReports(await request("/admin/shorts/reports")); setLoaded(true); }
  useEffect(() => { load().catch(failure => setError(failure.message)); }, [api, token]);
  async function review(id, action) {
    setBusy(true); setError("");
    try {
      await request(`/admin/shorts/reports/${id}`, { method: "PATCH", body: JSON.stringify({ action }) });
      setPreview(null); await load(); await onUpdated();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <section className="notification-section">
    <h2>Simply reports</h2>
    {videos.filter(video => video.videoType === "short" && video.shortValidationError).map(video => <p role="alert" key={video.id}><strong>{video.title}</strong>: {video.shortValidationError} This Simply video cannot be served. Reject the upload so the creator can submit a valid replacement.</p>)}
    <p className="muted">Latest 100 pending reports. Review the Simply video before unpublishing; dismiss reports that do not require action.</p>
    {error && <p role="alert">{error}</p>}
    <button className="secondary-btn" disabled={busy} onClick={() => { setError(""); load().catch(failure => setError(failure.message)); }}>Refresh Simply reports</button>
    {preview && <div><iframe src={preview.playbackUrl} title="Reported Simply video preview" allow="fullscreen" allowFullScreen/><button className="secondary-btn" onClick={() => setPreview(null)}>Close preview</button></div>}
    {!error && !loaded && <p>Loading Simply reports...</p>}
    {loaded && !error && !reports.length && <p>No Simply reports awaiting review.</p>}
    {reports.map(report => {
      const video = videos.find(item => item.id === report.videoId);
      return <article className="membership-review" key={report.id}>
        <strong>{video?.title || report.videoId}</strong>
        <p>Reason: {report.reason} · {new Date(report.createdAt).toLocaleString()}</p>
        {video?.playbackUrl && <button className="secondary-btn" disabled={busy} onClick={() => setPreview(video)}>Preview reported Simply video</button>}
        <button className="secondary-btn" disabled={busy} onClick={() => review(report.id, "dismiss")}>Dismiss report</button>
        <button className="primary-btn" disabled={busy} onClick={() => review(report.id, "unpublish")}>Unpublish Simply video</button>
      </article>;
    })}
  </section>;
}
