import { useEffect, useMemo, useState } from "react";
import { Play, Search, Plus, Film, LayoutDashboard, X, Trash2, ExternalLink, Sparkles, LogOut, Pencil, Tags, Share2, Eye, EyeOff, BarChart3, Upload } from "lucide-react";

const API = import.meta.env.DEV
  ? "/api"
  : `${(import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/+$/, "")}/api`;
const blank = { title: "", description: "", categoryId: "cat-learning", thumbnailUrl: "", playbackUrl: "", featured: false, published: true };
const blankBanner = { enabled: false, title: "", description: "", imageUrl: "", buttonLabel: "", buttonUrl: "" };
const apiAssetSrc = imageUrl => !imageUrl
  ? ""
  : /^https?:\/\//i.test(imageUrl)
    ? imageUrl
    : `${API}${imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`}`;
function App() {
  const [videos, setVideos] = useState([]);
  const [categories, setCategories] = useState([]);
  const [banner, setBanner] = useState(null);
  const [bannerForm, setBannerForm] = useState(blankBanner);
  const [bannerImageFile, setBannerImageFile] = useState(null);
  const [bannerImageProgress, setBannerImageProgress] = useState(0);
  const [bannerImageUploading, setBannerImageUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [page, setPage] = useState("home");
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [categoryName, setCategoryName] = useState("");
  const [returnToContent, setReturnToContent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem("adminToken") || "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);

  async function load() {
    setLoading(true); setError("");
    try {
      const [v, c, b] = await Promise.all([
        fetch(`${API}/videos`).then(r => r.json()),
        fetch(`${API}/categories`).then(r => r.json()),
        fetch(`${API}/banner`).then(r => r.json())
      ]);
      setVideos(v); setCategories(c); setBanner(b);
    } catch { setError("Could not connect to the API. Check VITE_API_URL and make sure the backend is available."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  const filtered = useMemo(() => videos.filter(v => (!search || `${v.title} ${v.description}`.toLowerCase().includes(search.toLowerCase())) && (activeCategory === "all" || v.categoryId === activeCategory)), [videos, search, activeCategory]);
  const featured = filtered.find(v => v.featured) || filtered[0];
  const analytics = useMemo(() => {
    const totalViews = videos.reduce((total, video) => total + Number(video.views || 0), 0);
    const topVideos = [...videos].sort((a, b) => Number(b.views || 0) - Number(a.views || 0));
    const categoryStats = categories.map(category => {
      const categoryVideos = videos.filter(video => video.categoryId === category.id);
      return {
        ...category,
        videos: categoryVideos.length,
        views: categoryVideos.reduce((total, video) => total + Number(video.views || 0), 0)
      };
    }).sort((a, b) => b.views - a.views);
    return { totalViews, topVideos, categoryStats };
  }, [videos, categories]);

  async function watchVideo(video) {
    setSelected(video);
    try {
      const r = await fetch(`${API}/videos/${video.id}/view`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Unable to record this view");
      setVideos(current => current.map(item => item.id === video.id ? { ...item, views: data.views } : item));
      setSelected(current => current?.id === video.id ? { ...current, views: data.views } : current);
    } catch (err) {
      setError(err.message || "Unable to record this view");
    }
  }
  async function shareVideo(video) {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("video", video.id);
    try {
      if (navigator.share) {
        await navigator.share({ title: video.title, text: video.description, url: url.toString() });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url.toString());
        setError("Video link copied to clipboard.");
      } else {
        window.prompt("Copy this video link:", url.toString());
      }
    } catch (err) {
      if (err.name !== "AbortError") setError("Unable to share this video.");
    }
  }
  function closeVideo() {
    setSelected(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("video");
    window.history.replaceState({}, "", url);
  }
  useEffect(() => {
    const videoId = new URLSearchParams(window.location.search).get("video");
    const video = videos.find(item => item.id === videoId);
    if (video && !selected) watchVideo(video);
  }, [videos, selected]);

  function clearAdminSession() {
    sessionStorage.removeItem("adminToken");
    setAdminToken("");
  }
  async function loadAdmin(token = adminToken) {
    const r = await fetch(`${API}/admin/videos`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await r.json();
    if (r.status === 401) {
      clearAdminSession();
      setPage("admin");
      throw new Error("Your admin session expired. Please sign in again.");
    }
    if (!r.ok) throw new Error(data.error || "Unable to load admin videos");
    setVideos(data);
    const bannerResponse = await fetch(`${API}/admin/banner`, { headers: { Authorization: `Bearer ${token}` } });
    const bannerData = await bannerResponse.json();
    if (bannerResponse.status === 401) {
      clearAdminSession();
      setPage("admin");
      throw new Error("Your admin session expired. Please sign in again.");
    }
    if (!bannerResponse.ok) throw new Error(bannerData.error || "Unable to load banner settings");
    setBannerForm({ ...blankBanner, ...bannerData });
  }
  async function refreshProcessing() {
    const r = await fetch(`${API}/admin/videos/processing`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const data = await r.json();
    if (r.status === 401) {
      clearAdminSession();
      setPage("admin");
      throw new Error("Your admin session expired. Please sign in again.");
    }
    if (!r.ok) throw new Error(data.error || "Unable to refresh video processing status");
    if (data.length) {
      setVideos(current => current.map(video => {
        const status = data.find(update => update.id === video.id);
        return status ? { ...video, processingStatus: status.processingStatus, encodeProgress: status.encodeProgress } : video;
      }));
    }
  }
  useEffect(() => {
    if (page !== "admin" || !adminToken) return undefined;
    let stopped = false;
    const update = async () => {
      try {
        await refreshProcessing();
      } catch (err) {
        if (!stopped) setError(err.message);
      }
    };
    update();
    const timer = window.setInterval(update, 10000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [page, adminToken]);
  function uploadVideoFile(file) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API}/admin/videos/upload`);
      xhr.setRequestHeader("Authorization", `Bearer ${adminToken}`);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.setRequestHeader("X-Video-Title", form.title);
      xhr.setRequestHeader("X-Video-Description", form.description);
      xhr.setRequestHeader("X-Video-Category", form.categoryId);
      xhr.setRequestHeader("X-Video-Featured", String(form.featured));
      xhr.setRequestHeader("X-Video-Published", String(form.published));
      xhr.setRequestHeader("X-Upload-Size", String(file.size));
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) setUploadProgress(Math.round(event.loaded / event.total * 100));
      };
      xhr.onerror = () => reject(new Error("Video upload failed. Check your connection and try again."));
      xhr.onload = () => {
        let data;
        try { data = JSON.parse(xhr.responseText); }
        catch { reject(new Error("The server returned an invalid upload response.")); return; }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(data.error || "Video upload failed."));
          return;
        }
        resolve(data);
      };
      xhr.send(file);
    });
  }
  function uploadBannerImage(file) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `${API}/admin/banner/image`);
      xhr.setRequestHeader("Authorization", `Bearer ${adminToken}`);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.setRequestHeader("X-Upload-Size", String(file.size));
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) setBannerImageProgress(Math.round(event.loaded / event.total * 100));
      };
      xhr.onerror = () => reject(new Error("Banner image upload failed. Check your connection and try again."));
      xhr.onload = () => {
        let data;
        try { data = JSON.parse(xhr.responseText); }
        catch { reject(new Error("The server returned an invalid banner image response.")); return; }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(data.error || "Banner image upload failed."));
          return;
        }
        resolve(data);
      };
      xhr.send(file);
    });
  }
  function uploadVideoThumbnail(videoId, file) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `${API}/admin/videos/${encodeURIComponent(videoId)}/thumbnail`);
      xhr.setRequestHeader("Authorization", `Bearer ${adminToken}`);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.setRequestHeader("X-Upload-Size", String(file.size));
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) setUploadProgress(Math.round(event.loaded / event.total * 100));
      };
      xhr.onerror = () => reject(new Error("Thumbnail upload failed. Check your connection and try again."));
      xhr.onload = () => {
        let data;
        try { data = JSON.parse(xhr.responseText); }
        catch { reject(new Error("The server returned an invalid thumbnail response.")); return; }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(data.error || "Thumbnail upload failed."));
          return;
        }
        resolve(data);
      };
      xhr.send(file);
    });
  }
  async function login(e) {
    e.preventDefault(); setError(""); setLoginLoading(true);
    try {
      const r = await fetch(`${API}/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Unable to sign in");
      sessionStorage.setItem("adminToken", data.token);
      setAdminToken(data.token);
      setPassword("");
      await loadAdmin(data.token);
      setPage("admin");
    } catch (err) {
      setError(err.message || "Unable to sign in");
    } finally {
      setLoginLoading(false);
    }
  }
  async function logout() {
    try {
      await fetch(`${API}/admin/logout`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}` } });
    } catch {
      setError("Could not contact the server to end your session.");
    } finally {
      clearAdminSession();
      setPage("admin");
      setSelected(null);
    }
  }
  async function openAdmin() {
    setPage("admin"); setSelected(null);
    if (!adminToken) return;
    try { await loadAdmin(); }
    catch (err) { setError(err.message); }
  }

  async function saveVideo(e) {
    e.preventDefault(); setError("");
    setUploading(Boolean(uploadFile || thumbnailFile));
    setUploadProgress(0);
    try {
      if (uploadFile && uploadFile.size > 2 * 1024 * 1024 * 1024) {
        throw new Error("Video uploads are limited to 2 GB.");
      }
      if (uploadFile && !uploadFile.type.startsWith("video/")) {
        throw new Error("Choose a supported video file.");
      }
      if (thumbnailFile && !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(thumbnailFile.type)) {
        throw new Error("Choose a JPEG, PNG, WebP, or GIF thumbnail.");
      }
      if (thumbnailFile && thumbnailFile.size > 8 * 1024 * 1024) {
        throw new Error("Video thumbnails are limited to 8 MB.");
      }
      if (uploadFile && editingId) {
        throw new Error("Remove the selected file or save this as a new video; replacing uploaded files is not supported.");
      }
      let responseData = uploadFile ? await uploadVideoFile(uploadFile) : null;
      if (uploadFile) setUploadFile(null);
      if (!uploadFile) {
      const r = await fetch(`${API}/admin/videos${editingId ? `/${editingId}` : ""}`, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify(form)
      });
      responseData = await r.json();
      if (r.status === 401) { clearAdminSession(); setPage("admin"); }
      if (!r.ok) throw new Error(responseData.error || "Unable to save video");
      }
      if (!responseData?.id) throw new Error("The server did not return a saved video.");
      if (thumbnailFile) {
        setEditingId(responseData.id);
        setForm({
          title: responseData.title || "",
          description: responseData.description || "",
          categoryId: responseData.categoryId || "",
          thumbnailUrl: responseData.thumbnailUrl || "",
          playbackUrl: responseData.playbackUrl || "",
          featured: Boolean(responseData.featured),
          published: Boolean(responseData.published)
        });
        setPage("add");
        responseData = await uploadVideoThumbnail(responseData.id, thumbnailFile);
      }
      if (responseData.bunnyVideoId) setError("Upload complete. Bunny Stream is processing the video; status will update in the dashboard.");
      setThumbnailFile(null);
      setForm(blank); setEditingId(null); setPage("admin"); await loadAdmin();
    } catch (err) { setError(err.message); }
    finally { setUploading(false); }
  }
  function editVideo(video) {
    setForm({
      title: video.title || "",
      description: video.description || "",
      categoryId: video.categoryId || "",
      thumbnailUrl: video.thumbnailUrl || "",
      playbackUrl: video.playbackUrl || "",
      featured: Boolean(video.featured),
      published: Boolean(video.published)
    });
    setEditingId(video.id);
    setThumbnailFile(null);
    setPage("add");
  }
  async function createCategory(e) {
    e.preventDefault(); setError("");
    try {
      const r = await fetch(`${API}/admin/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ name: categoryName })
      });
      const data = await r.json();
      if (r.status === 401) { clearAdminSession(); setPage("admin"); }
      if (!r.ok) throw new Error(data.error || "Unable to create category");
      setCategories(current => [...current, data]);
      setCategoryName("");
      if (returnToContent) {
        setForm(current => ({ ...current, categoryId: data.id }));
        setPage("add");
        setReturnToContent(false);
      }
    } catch (err) { setError(err.message); }
  }
  async function saveBanner(e) {
    e.preventDefault(); setError("");
    try {
      const r = await fetch(`${API}/admin/banner`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify(bannerForm)
      });
      const data = await r.json();
      if (r.status === 401) { clearAdminSession(); setPage("admin"); }
      if (!r.ok) throw new Error(data.error || "Unable to save banner");
      setBannerForm({ ...blankBanner, ...data });
      setBanner(data.enabled ? data : null);
      setError("Banner settings saved.");
      setPage("admin");
    } catch (err) { setError(err.message); }
  }
  async function saveBannerImage() {
    if (!bannerImageFile) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(bannerImageFile.type)) {
      setError("Choose a JPEG, PNG, WebP, or GIF image.");
      return;
    }
    if (bannerImageFile.size > 8 * 1024 * 1024) {
      setError("Banner images are limited to 8 MB.");
      return;
    }
    setError("");
    setBannerImageUploading(true);
    setBannerImageProgress(0);
    try {
      const data = await uploadBannerImage(bannerImageFile);
      setBannerForm(current => ({ ...current, imageUrl: data.imageUrl }));
      setBanner(current => current ? { ...current, imageUrl: data.imageUrl } : current);
      setBannerImageFile(null);
      setError("Banner image uploaded and saved to MongoDB.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBannerImageUploading(false);
    }
  }
  async function deleteVideo(id) {
    if (!confirm("Delete this video?")) return;
    try {
      const r = await fetch(`${API}/admin/videos/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
      if (r.status === 401) { clearAdminSession(); setPage("admin"); throw new Error("Your admin session expired. Please sign in again."); }
      if (!r.ok) throw new Error("Could not delete video.");
      await loadAdmin();
    } catch (err) { setError(err.message); }
  }
  async function togglePublished(video) {
    try {
      const r = await fetch(`${API}/admin/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ published: !video.published })
      });
      const data = await r.json();
      if (r.status === 401) { clearAdminSession(); setPage("admin"); }
      if (!r.ok) throw new Error(data.error || "Unable to update publish status");
      setVideos(current => current.map(item => item.id === video.id ? data : item));
    } catch (err) { setError(err.message); }
  }

  return <div className="app-shell">
    <header className="topbar"><button className="brand" onClick={() => { setPage("home"); setSelected(null); }}><span className="brand-icon"><Play size={19} fill="currentColor"/></span>Zinda<span className="brand-accent">Play</span></button>
      <nav><button className={page === "home" ? "nav-active" : ""} onClick={() => {setPage("home"); setSelected(null);}}>Explore</button><button className={page === "admin" || page === "add" || page === "banner" ? "nav-active" : ""} onClick={openAdmin}><LayoutDashboard size={16}/> Admin</button></nav>
      <div className="top-pill"><span className="live-dot"/> VIDEO STREAMING</div>
    </header>
    <main className="container">
      {error && <div className="notice">{error}<button onClick={() => setError("")}><X size={16}/></button></div>}
      {selected ? <section className="watch-page"><button className="back-link" onClick={closeVideo}>← Back to Explore</button><div className="player-wrap"><span className="player-view-count"><Eye size={15}/> {Number(selected.views || 0).toLocaleString()} views</span>{selected.playbackUrl ? <iframe src={selected.playbackUrl} title={selected.title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen/> : <div className="empty-player"><Play size={48}/><p>Add a Bunny Stream player URL in Admin to enable playback.</p></div>}</div><div className="watch-meta"><div><span className="eyebrow">{selected.category?.name || "ZINDA PLAY ORIGINAL"}</span><h1>{selected.title}</h1><p>{selected.description}</p><span className="view-count"><Eye size={15}/> {Number(selected.views || 0).toLocaleString()} views</span></div><button className="secondary-btn share-btn" onClick={() => shareVideo(selected)}><Share2 size={17}/> Share video</button></div></section>
      : page === "analytics" && adminToken ? <section className="admin-panel"><button className="back-link" onClick={() => setPage("admin")}>← Back to Admin</button><div className="section-heading"><div><span className="eyebrow"><BarChart3 size={14}/> PERFORMANCE</span><h1>Content analytics</h1><p className="muted">View counts for your video library since tracking began.</p></div></div><div className="analytics-stats"><div className="analytics-card"><Eye/><span>Total views</span><strong>{analytics.totalViews.toLocaleString()}</strong></div><div className="analytics-card"><Film/><span>Total content</span><strong>{videos.length.toLocaleString()}</strong></div><div className="analytics-card"><Play/><span>Published</span><strong>{videos.filter(video=>video.published).length.toLocaleString()}</strong></div><div className="analytics-card"><Sparkles/><span>Average views</span><strong>{videos.length ? Math.round(analytics.totalViews/videos.length).toLocaleString() : "0"}</strong></div></div><div className="analytics-columns"><section className="analytics-section"><h2><BarChart3 size={18}/> Top videos</h2>{analytics.topVideos.length ? <div className="ranking-list">{analytics.topVideos.slice(0,10).map((video,index)=><div className="ranking-item" key={video.id}><span className="ranking-number">{index+1}</span><div className="ranking-content"><div className="ranking-label"><strong>{video.title}</strong><span>{Number(video.views||0).toLocaleString()} views</span></div><div className="ranking-track"><span style={{width:`${analytics.topVideos[0].views ? Math.max(3,Number(video.views||0)/Number(analytics.topVideos[0].views)*100) : 0}%`}}/></div></div></div>)}</div> : <p className="muted">No videos to report yet.</p>}</section><section className="analytics-section"><h2><Tags size={18}/> Category performance</h2>{analytics.categoryStats.length ? <div className="category-analytics">{analytics.categoryStats.map(category=><div className="category-analytics-item" key={category.id}><div><strong>{category.name}</strong><span>{category.videos} {category.videos===1?"video":"videos"}</span></div><b><Eye size={14}/> {category.views.toLocaleString()}</b></div>)}</div> : <p className="muted">No categories to report yet.</p>}</section></div><p className="analytics-note">Views are counted when a published video is opened. Analytics are currently held in memory and reset when the API restarts.</p></section>
      : page === "categories" && adminToken ? <section className="admin-panel"><button className="back-link" onClick={() => {setPage(returnToContent ? "add" : "admin");setReturnToContent(false);}}>← Back to {returnToContent ? "Content" : "Admin"}</button><div className="section-heading"><div><span className="eyebrow">CONTENT ORGANIZATION</span><h1>Categories</h1><p className="muted">Create categories to organize your video library.</p></div></div><form className="category-form" onSubmit={createCategory}><label>Category name<input required maxLength={60} value={categoryName} onChange={e=>setCategoryName(e.target.value)} placeholder="e.g. Tutorials"/></label><button className="primary-btn" type="submit"><Plus size={17}/> Create category</button></form><div className="category-list">{categories.map(category=><div className="category-list-item" key={category.id}><Tags size={17}/><span>{category.name}</span></div>)}</div></section>
      : page === "banner" && adminToken ? <section className="admin-panel">
        <button className="back-link" onClick={() => setPage("admin")}>← Back to Admin</button>
        <div className="section-heading"><div><span className="eyebrow"><Sparkles size={14}/> HOMEPAGE PROMOTION</span><h1>Banner settings</h1><p className="muted">Manage the promotional banner shown on the homepage.</p></div></div>
        <form className="video-form banner-form" onSubmit={saveBanner}>
          <div className="checks"><label><input type="checkbox" checked={bannerForm.enabled} onChange={e=>setBannerForm({...bannerForm,enabled:e.target.checked})}/> Show banner on homepage</label></div>
          <label>Banner title<input required={bannerForm.enabled} maxLength={120} value={bannerForm.title} onChange={e=>setBannerForm({...bannerForm,title:e.target.value})} placeholder="e.g. Discover something new"/></label>
          <label>Description<textarea maxLength={500} value={bannerForm.description} onChange={e=>setBannerForm({...bannerForm,description:e.target.value})} placeholder="A short message for your viewers"/></label>
          <div className="upload-field banner-upload-field">
            <label>Upload background image<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={bannerImageUploading} onChange={e=>{setBannerImageFile(e.target.files?.[0] || null);setBannerImageProgress(0);}}/></label>
            <p>JPEG, PNG, WebP, or GIF. Maximum size: 8 MB. Images are stored in MongoDB.</p>
            {bannerForm.imageUrl && <img className="banner-image-preview" src={apiAssetSrc(bannerForm.imageUrl)} alt="Current homepage banner"/>}
            {bannerImageFile && <div className="upload-progress"><div><span>{bannerImageFile.name}</span><strong>{bannerImageUploading ? `${bannerImageProgress}% uploaded` : "Ready to upload"}</strong></div><progress max="100" value={bannerImageProgress}/><button className="secondary-btn" type="button" disabled={bannerImageUploading} onClick={saveBannerImage}><Upload size={16}/>{bannerImageUploading ? "Uploading…" : "Upload image"}</button></div>}
          </div>
          <label>Button label<input maxLength={40} value={bannerForm.buttonLabel} onChange={e=>setBannerForm({...bannerForm,buttonLabel:e.target.value})} placeholder="Watch now"/></label>
          <label>Button link<input type="url" value={bannerForm.buttonUrl} onChange={e=>setBannerForm({...bannerForm,buttonUrl:e.target.value})} placeholder="https://..."/></label>
            <p className="publish-help">Add both a button label and a link, or leave both empty. Banner text and the uploaded image are stored in MongoDB.</p>
            <button className="primary-btn" type="submit" disabled={bannerImageUploading}><Sparkles size={17}/> Save banner</button>
        </form>
      </section>
      : page === "add" ? <section className="admin-panel">
        <button className="back-link" onClick={() => {setPage("admin");setEditingId(null);setUploadFile(null);setThumbnailFile(null);}}>← Back to Admin</button>
        <div className="section-heading"><div><span className="eyebrow">CONTENT STUDIO</span><h1>{editingId ? "Edit video" : "Add a video"}</h1></div></div>
        <form className="video-form" onSubmit={saveVideo}>
          <label>Video title<input required value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="e.g. Introduction to Zinda Play"/></label>
          <label>Description<textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Tell viewers about this video"/></label>
          <label>Category<select value={form.categoryId} onChange={e=>setForm({...form,categoryId:e.target.value})}>{categories.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select><button className="inline-category-btn" type="button" onClick={()=>{setReturnToContent(true);setPage("categories");}}><Plus size={14}/> Create category</button></label>
          {!editingId && <div className="upload-field">
            <label>Upload video file to Bunny Stream<input type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,video/x-ms-wmv,video/mpeg,video/3gpp,video/x-m4v" disabled={uploading} onChange={e=>{setUploadFile(e.target.files?.[0] || null);setUploadProgress(0);}}/></label>
            <p>Supported video formats, up to 2 GB. File transfer and encoding status will be shown here and in the dashboard.</p>
            {uploadFile && <div className="upload-progress"><div><span>{uploadFile.name}</span><strong>{uploading ? `${uploadProgress}% uploaded` : "Ready to upload"}</strong></div><progress max="100" value={uploadProgress}/></div>}
          </div>}
          <div className="upload-field">
            <label>Upload video thumbnail<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={uploading} onChange={e=>{setThumbnailFile(e.target.files?.[0] || null);setUploadProgress(0);}}/></label>
            <p>JPEG, PNG, WebP, or GIF. Maximum size: 8 MB. The thumbnail is saved with the video in MongoDB.</p>
            {form.thumbnailUrl && <img className="thumbnail-preview" src={apiAssetSrc(form.thumbnailUrl)} alt="Current video thumbnail"/>}
            {thumbnailFile && <div className="upload-progress"><div><span>{thumbnailFile.name}</span><strong>{uploading ? `${uploadProgress}% uploaded` : "Ready to upload on save"}</strong></div><progress max="100" value={uploadProgress}/></div>}
          </div>
          <label>Bunny Stream player/embed URL<input type="url" value={form.playbackUrl} onChange={e=>setForm({...form,playbackUrl:e.target.value})} placeholder="https://..."/></label>
          <div className="checks"><label><input type="checkbox" checked={form.featured} onChange={e=>setForm({...form,featured:e.target.checked})}/> Featured</label><label><input type="checkbox" checked={form.published} onChange={e=>setForm({...form,published:e.target.checked})}/> Published</label></div>
          <div className="publish-help">{form.published ? "This video will be published when encoding is complete." : "This video will remain unpublished until you publish it."}</div>
          <button className="primary-btn" type="submit" disabled={uploading}>{uploading ? <><Upload size={17}/> Uploading {uploadProgress}%</> : editingId ? <><Pencil size={17}/> Save changes</> : uploadFile ? <><Upload size={17}/> Upload video</> : <><Plus size={17}/> Save video</>}</button>
        </form>
      </section>
      : page === "admin" && adminToken ? <section className="admin-panel">
        <div className="section-heading"><div><span className="eyebrow">CONTROL CENTER</span><h1>Content dashboard</h1><p className="muted">Manage your Zinda Play video library.</p></div><div className="admin-actions"><button className="secondary-btn" onClick={()=>setPage("analytics")}><BarChart3 size={16}/> Analytics</button><button className="secondary-btn" onClick={()=>setPage("banner")}><Sparkles size={16}/> Banner</button><button className="secondary-btn" onClick={()=>{setReturnToContent(false);setPage("categories");}}><Tags size={16}/> Categories</button><button className="primary-btn" onClick={()=>{setForm(blank);setEditingId(null);setThumbnailFile(null);setUploadFile(null);setPage("add");}}><Plus size={17}/> Add video</button><button className="secondary-btn" onClick={logout}><LogOut size={16}/> Sign out</button></div></div>
        <div className="stats-grid"><div className="stat-card"><Film/><span>Total videos</span><strong>{videos.length}</strong></div><div className="stat-card"><Sparkles/><span>Featured</span><strong>{videos.filter(v=>v.featured).length}</strong></div><div className="stat-card"><Play/><span>Published</span><strong>{videos.filter(v=>v.published).length}</strong></div></div>
        <div className="table-wrap"><table><thead><tr><th>Video</th><th>Category</th><th>Publish</th><th>Processing</th><th>Views</th><th>Actions</th></tr></thead><tbody>{videos.map(v=><tr key={v.id}>
          <td><div className="table-title">{v.thumbnailUrl?<img src={apiAssetSrc(v.thumbnailUrl)} alt=""/>:<div className="mini-thumb"><Film size={17}/></div>}<span>{v.title}</span></div></td>
          <td>{v.category?.name || "—"}</td>
          <td><span className={v.published?"status published":"status"}>{v.published?"Published":"Unpublished"}</span></td>
          <td>{v.processingStatus ? <div className="processing-cell"><span className={`processing-status ${v.processingStatus==="ready"?"ready":v.processingStatus==="error"||v.processingStatus==="upload failed"?"failed":"pending"}`}>{v.processingStatus}</span>{v.processingStatus!=="ready"&&v.processingStatus!=="error"&&v.processingStatus!=="upload failed"&&<span className="processing-progress">{Number(v.encodeProgress||0)}% encoded</span>}</div> : <span className="muted">—</span>}</td>
          <td><span className="table-views"><Eye size={14}/> {Number(v.views || 0).toLocaleString()}</span></td>
          <td><button className="icon-btn" title="Preview" disabled={Boolean(v.bunnyVideoId&&v.processingStatus!=="ready")} onClick={()=>{setSelected(v);setPage("home");}}><ExternalLink size={16}/></button><button className="icon-btn" title="Edit video" aria-label={`Edit ${v.title}`} onClick={()=>editVideo(v)}><Pencil size={16}/></button><button className="icon-btn" title={v.published?"Unpublish":"Publish"} aria-label={v.published?`Unpublish ${v.title}`:`Publish ${v.title}`} disabled={Boolean(v.bunnyVideoId&&v.processingStatus!=="ready")} onClick={()=>togglePublished(v)}>{v.published?<EyeOff size={16}/>:<Eye size={16}/>}</button><button className="icon-btn danger" title="Delete" onClick={()=>deleteVideo(v.id)}><Trash2 size={16}/></button></td>
        </tr>)}</tbody></table>{!videos.length&&<p className="muted empty-state">No videos yet. Add your first video.</p>}</div>
      </section>
      : (page === "admin" || page === "add" || page === "banner") ? <section className="admin-panel login-panel"><div className="login-card"><span className="eyebrow"><LayoutDashboard size={14}/> ADMIN ACCESS</span><h1>Sign in to Zinda Play</h1><p className="muted">Enter your admin credentials to manage videos.</p><form className="login-form" onSubmit={login}><label>Username<input autoComplete="username" required value={username} onChange={e=>setUsername(e.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} /></label><button className="primary-btn" type="submit" disabled={loginLoading}>{loginLoading ? "Signing in…" : "Sign in"}</button></form></div></section>
      : <>{banner && <section className="promo-banner">
        {banner.imageUrl && <img className="promo-banner-image" src={apiAssetSrc(banner.imageUrl)} alt="" aria-hidden="true"/>}
        <div className="promo-banner-copy"><span className="eyebrow"><Sparkles size={14}/> FEATURED</span><h2>{banner.title}</h2>{banner.description && <p>{banner.description}</p>}{banner.buttonLabel && <a className="primary-btn" href={banner.buttonUrl} target="_blank" rel="noreferrer">{banner.buttonLabel}<ExternalLink size={16}/></a>}</div>
      </section>}<section className="hero"><div className="hero-copy"><span className="eyebrow"><Sparkles size={14}/> YOUR WORLD. YOUR PLAYLIST.</span><h1>Big stories.<br/><span>New skills.</span><br/>Endless discovery.</h1><p>Stream films, learn something new, and find your next favourite video.</p><div className="hero-actions"><button className="primary-btn" onClick={()=>featured&&watchVideo(featured)}><Play size={17} fill="currentColor"/> Start watching</button><button className="secondary-btn" onClick={()=>document.getElementById("library")?.scrollIntoView({behavior:"smooth"})}>Explore library</button></div></div><div className="hero-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="play-tile"><Play size={48} fill="currentColor"/></div><div className="floating-card card-top"><Sparkles size={16}/> Curated for you</div><div className="floating-card card-bottom"><span className="live-dot"/> Watch something great</div></div></section>
        <section id="library" className="library"><div className="section-heading"><div><span className="eyebrow">HANDPICKED FOR YOU</span><h2>Explore the library</h2></div><div className="search-box"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search videos"/></div></div><div className="category-row"><button className={activeCategory==="all"?"category active":"category"} onClick={()=>setActiveCategory("all")}>All videos</button>{categories.map(c=><button key={c.id} className={activeCategory===c.id?"category active":"category"} onClick={()=>setActiveCategory(c.id)}>{c.name}</button>)}</div>{loading?<p className="muted">Loading videos…</p>:<div className="video-grid">{filtered.map((v,i)=><button className="video-card" key={v.id} onClick={()=>watchVideo(v)}><div className="thumbnail">{v.thumbnailUrl?<img src={apiAssetSrc(v.thumbnailUrl)} alt=""/>:<div className={`thumb-gradient gradient-${i%4}`}><Play size={32} fill="currentColor"/></div>}<span className="play-overlay"><Play size={18} fill="currentColor"/></span>{v.featured&&<span className="featured-tag">FEATURED</span>}</div><div className="video-info"><span className="video-category">{v.category?.name||"Zinda Play"}</span><h3>{v.title}</h3><p>{v.description||"Discover this video on Zinda Play."}</p><span className="video-views"><Eye size={14}/> {Number(v.views || 0).toLocaleString()} views</span></div></button>)}</div>}{!loading&&filtered.length===0&&<div className="empty-state"><Film size={32}/><h3>No videos found</h3><p>Try another search or category.</p></div>}</section></>}
    </main><footer><button className="brand footer-brand" onClick={()=>{setPage("home");setSelected(null);}}>Zinda<span className="brand-accent">Play</span></button><span>Made for stories, skills & discovery.</span><span>© {new Date().getFullYear()} Zinda Play</span></footer>
  </div>;
}
export default App;
