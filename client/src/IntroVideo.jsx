import { useState } from "react";
import { Play, Trash2, Upload, Video } from "lucide-react";
import "./ads.css";

const src = (api, url) => (url && url.startsWith("/") ? `${api}${url}` : url);

// Creator self-introduction video pinned to a profile.
export function IntroVideo({ api, url, open = false }) {
  const [show, setShow] = useState(open);
  if (!url) return null;
  return (
    <div className="intro-video">
      {show
        ? <video src={src(api, url)} controls autoPlay playsInline preload="metadata"/>
        : <button type="button" className="intro-play" onClick={() => setShow(true)}><Play size={16} fill="currentColor"/> Watch intro</button>}
    </div>
  );
}

export function IntroManager({ api, token, url, onChange }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  const upload = file => {
    if (!file) return;
    if (!["video/mp4", "video/webm"].includes(file.type)) return setError("Choose an MP4 or WebM video.");
    if (file.size > 100 * 1024 * 1024) return setError("Intro videos are limited to 100 MB.");
    setError("");
    setBusy(true);
    setProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${api}/creator/intro-video`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = e => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      setBusy(false);
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* keep empty */ }
      if (xhr.status >= 200 && xhr.status < 300) { setVersion(v => v + 1); onChange(data.introVideoUrl); }
      else setError(data.error || "Upload failed");
    };
    xhr.onerror = () => { setBusy(false); setError("Upload failed. Check your connection."); };
    xhr.send(file);
  };
  const remove = async () => {
    if (!window.confirm("Remove your intro video from your profile?")) return;
    setError("");
    const response = await fetch(`${api}/creator/intro-video`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) onChange("");
    else setError("Could not remove the intro video.");
  };

  return (
    <section className="intro-manager">
      <div><span className="eyebrow"><Video size={14}/> PINNED INTRO</span><h2>Self-introduction video</h2><p className="muted">Pinned to your profile so viewers can meet you. MP4 or WebM, up to 100 MB.</p></div>
      {error && <p className="error" role="alert">{error}</p>}
      {url && <video key={version} src={src(api, url)} controls preload="metadata"/>}
      <div className="admin-actions">
        <label className="primary-btn intro-upload">
          <Upload size={16}/> {busy ? `Uploading… ${progress}%` : url ? "Replace intro" : "Upload intro"}
          <input type="file" accept="video/mp4,video/webm" hidden disabled={busy} onChange={e => { upload(e.target.files?.[0]); e.target.value = ""; }}/>
        </label>
        {url && <button type="button" className="secondary-btn" onClick={remove} disabled={busy}><Trash2 size={15}/> Remove</button>}
      </div>
    </section>
  );
}
