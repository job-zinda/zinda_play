import { useEffect, useState } from "react";
import { Eye, EyeOff, Pencil, Plus, Sparkles, Trash2, Upload, X } from "lucide-react";

const emptyBanner = { enabled: true, title: "", description: "", buttonLabel: "", buttonUrl: "", imageUrl: "" };

function uploadImage(api, token, id, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${api}/admin/banners/${encodeURIComponent(id)}/image`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.setRequestHeader("X-Upload-Size", String(file.size));
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
    };
    xhr.onerror = () => reject(new Error("Banner image upload failed. Check your connection and try again."));
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* handled below */ }
      if (xhr.status === 401) return reject(Object.assign(new Error("Your admin session expired."), { status: 401 }));
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(data.error || "Banner image upload failed."));
      resolve(data);
    };
    xhr.send(file);
  });
}

export default function AdminBanners({ api, token, assetSrc, onBack, onUnauthorized }) {
  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyBanner);
  const [imageFile, setImageFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function request(path, options = {}) {
    const response = await fetch(`${api}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.body ? { "Content-Type": "application/json" } : {}) }
    });
    if (response.status === 401) {
      onUnauthorized();
      throw new Error("Your admin session expired. Please sign in again.");
    }
    const data = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "Banner request failed.");
    return data;
  }
  async function load() {
    setLoading(true);
    try { setBanners(await request("/admin/banners")); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function startNew() {
    setEditingId("new"); setForm(emptyBanner); setImageFile(null); setProgress(0); setError(""); setNotice("");
  }
  function startEdit(banner) {
    setEditingId(banner.id); setForm({ ...emptyBanner, ...banner }); setImageFile(null); setProgress(0); setError(""); setNotice("");
  }
  function cancel() {
    setEditingId(null); setImageFile(null); setProgress(0);
  }
  async function save(event) {
    event.preventDefault();
    if (editingId === "new" && !imageFile) {
      setError("Choose a banner image.");
      return;
    }
    setSaving(true); setError(""); setNotice("");
    const body = JSON.stringify({
      enabled: form.enabled, title: form.title, description: form.description,
      buttonLabel: form.buttonLabel, buttonUrl: form.buttonUrl
    });
    try {
      let saved = editingId === "new"
        ? await request("/admin/banners", { method: "POST", body })
        : await request(`/admin/banners/${encodeURIComponent(editingId)}`, { method: "PUT", body });
      if (imageFile) {
        try {
          saved = await uploadImage(api, token, saved.id, imageFile, setProgress);
        } catch (err) {
          if (err.status === 401) onUnauthorized();
          setEditingId(saved.id);
          setForm({ ...emptyBanner, ...saved });
          throw new Error(`Banner details saved, but the image failed: ${err.message}`);
        }
      }
      setNotice(editingId === "new" ? "Banner added." : "Banner updated.");
      setEditingId(null); setImageFile(null); setProgress(0);
      await load();
    } catch (err) {
      setError(err.message);
      await load();
    } finally {
      setSaving(false);
    }
  }
  async function remove(banner) {
    if (!window.confirm(`Delete the banner "${banner.title || "Untitled"}"? This cannot be undone.`)) return;
    setError(""); setNotice("");
    try {
      await request(`/admin/banners/${encodeURIComponent(banner.id)}`, { method: "DELETE" });
      if (editingId === banner.id) cancel();
      setNotice("Banner deleted.");
      await load();
    } catch (err) { setError(err.message); }
  }
  async function toggle(banner) {
    setError(""); setNotice("");
    try {
      await request(`/admin/banners/${encodeURIComponent(banner.id)}`, {
        method: "PUT",
        body: JSON.stringify({ ...banner, enabled: !banner.enabled })
      });
      await load();
    } catch (err) { setError(err.message); }
  }

  const set = key => event => setForm({ ...form, [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value });

  return <section className="admin-panel admin-banners">
    <button className="back-link" onClick={onBack}>← Back to Admin</button>
    <div className="section-heading"><div><span className="eyebrow"><Sparkles size={14}/> HOMEPAGE PROMOTION</span><h1>Banners</h1><p className="muted">Add, edit or delete homepage banners. Visible banners rotate on the web and mobile home pages.</p></div>{editingId === null && <button className="primary-btn" onClick={startNew}><Plus size={17}/> Add banner</button>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="form-success" role="status">{notice}</p>}
    {editingId !== null && <form className="video-form banner-form" onSubmit={save}>
      <h2>{editingId === "new" ? "New banner" : "Edit banner"}</h2>
      <div className="checks"><label><input type="checkbox" checked={form.enabled} onChange={set("enabled")}/> Show on homepage</label></div>
      <label>Banner title<input required={form.enabled} maxLength={120} value={form.title} onChange={set("title")} placeholder="e.g. Discover something new"/></label>
      <label>Description<textarea maxLength={500} value={form.description} onChange={set("description")} placeholder="A short message for your viewers"/></label>
      <div className="upload-field banner-upload-field">
        <label>{editingId === "new" ? "Banner image" : "Replace banner image"}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={saving} onChange={e => { setImageFile(e.target.files?.[0] || null); setProgress(0); }}/></label>
        <p>Recommended: 1200 x 400 pixels (3:1). JPEG, PNG, WebP, or GIF up to 8 MB. The full image is shown without cropping.</p>
        {form.imageUrl && !imageFile && <img className="banner-image-preview" src={assetSrc(form.imageUrl)} alt="Current banner"/>}
        {imageFile && <div className="upload-progress"><div><span>{imageFile.name}</span><strong>{saving ? `${progress}% uploaded` : "Uploads when you save"}</strong></div><progress max="100" value={progress}/></div>}
      </div>
      <label>Button label<input maxLength={40} value={form.buttonLabel} onChange={set("buttonLabel")} placeholder="Watch now"/></label>
      <label>Button link<input type="url" value={form.buttonUrl} onChange={set("buttonUrl")} placeholder="https://..."/></label>
      <p className="publish-help">Add both a button label and a link, or leave both empty.</p>
      <div className="admin-banner-form-actions">
        <button className="primary-btn" type="submit" disabled={saving}>{imageFile ? <Upload size={16}/> : <Sparkles size={16}/>}{saving ? "Saving…" : editingId === "new" ? "Add banner" : "Save changes"}</button>
        <button className="secondary-btn" type="button" disabled={saving} onClick={cancel}><X size={16}/> Cancel</button>
      </div>
    </form>}
    {loading ? <p className="muted">Loading banners…</p> : banners.length === 0 ? <p className="muted">No banners yet. Add one to show it on the homepage.</p> : <div className="admin-banner-list">
      {banners.map((banner, index) => <article className="admin-banner-item" key={banner.id}>
        {banner.imageUrl ? <img src={assetSrc(banner.imageUrl)} alt=""/> : <div className="admin-banner-noimage">No image</div>}
        <div className="admin-banner-info">
          <strong>{index + 1}. {banner.title || "Untitled banner"}</strong>
          {banner.description && <p>{banner.description}</p>}
          <span className={`status ${banner.enabled && banner.imageUrl ? "live" : "draft"}`}>{banner.enabled ? banner.imageUrl ? "Visible on homepage" : "Hidden — needs an image" : "Hidden"}</span>
        </div>
        <div className="admin-banner-actions">
          <button className="secondary-btn" onClick={() => toggle(banner)} aria-label={banner.enabled ? "Hide banner" : "Show banner"}>{banner.enabled ? <EyeOff size={15}/> : <Eye size={15}/>}{banner.enabled ? "Hide" : "Show"}</button>
          <button className="secondary-btn" onClick={() => startEdit(banner)}><Pencil size={15}/> Edit</button>
          <button className="secondary-btn danger-btn" onClick={() => remove(banner)}><Trash2 size={15}/> Delete</button>
        </div>
      </article>)}
    </div>}
  </section>;
}
