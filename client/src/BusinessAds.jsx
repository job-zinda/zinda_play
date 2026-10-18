import { useEffect, useState } from "react";
import "./membership.css";

const blank = { title: "", description: "", targetUrl: "", targetCity: "", targetCategories: [], targetViews: 1000 };
const imageTypes = ["image/jpeg", "image/png", "image/webp"];
async function request(api, token, path, options = {}) {
  const response = await fetch(`${api}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Business ad request failed.");
  return data;
}
const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function PrivateAdMedia({ api, token, path, video = false, onClose }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    let objectUrl;
    setUrl(""); setError("");
    fetch(`${api}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then(async response => {
      if (!response.ok) throw new Error((await response.json()).error || "Could not load preview.");
      objectUrl = URL.createObjectURL(await response.blob());
      if (!stopped) setUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    }).catch(err => { if (!stopped) setError(err.message); });
    return () => { stopped = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [api, token, path]);
  return <div className="membership-review">{error ? <p role="alert">{error}</p> : !url ? <p>Loading preview...</p> : video ? <video className="membership-proof" src={url} controls/> : <img className="membership-proof" src={url} alt="Payment screenshot"/>}<button className="secondary-btn" type="button" onClick={onClose}>Close preview</button></div>;
}

export function BusinessAdReports({ submissions, categories, onEdit, onPreview, busy }) {
  const exportCsv = () => {
    const rows = [["Ad", "Review status", "Delivery", "City", "Interests", "Amount INR", "Target impressions", "Impressions", "Remaining", "Clicks", "CTR (%)", "Completion (%)", "Completed at"],
      ...submissions.map(item => [item.title, item.status, item.deliveryStatus || "", item.targetCity || "All", item.targetCategories.map(id => categories.find(category => category.id === id)?.name || id).join("; "), item.amountRupees, item.targetViews, item.impressions, item.remainingImpressions, item.clicks, item.clickThroughRate.toFixed(2), item.completionPercent.toFixed(2), item.completedAt || ""])];
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "business-ad-analytics.csv"; link.click(); URL.revokeObjectURL(url);
  };
  return <section className="notification-section"><h2>Ad analytics & submission history</h2>
    <p className="muted">Same delivery metrics as admin: impressions, clicks, CTR, remaining target and completion. Impressions count ad deliveries, not completed watches. Latest 200 submissions.</p>
    <button className="secondary-btn" disabled={!submissions.length} onClick={exportCsv}>Download ad analytics CSV</button>
    {!submissions.length && <p>No ad submissions yet.</p>}
    {submissions.map(item => <article className="membership-review" key={item.id}>
      <strong>{item.title}</strong><p>Review: {item.status} · Delivery: {item.deliveryStatus || "not published"} · Payment: {item.paymentVerified ? "verified" : "not yet verified"}</p>
      <p>₹{item.amountRupees} / {item.targetViews} impressions · {item.targetCity || "All locations"} · {item.targetCategories.length ? item.targetCategories.map(id => categories.find(category => category.id === id)?.name || id).join(", ") : "All interests"}</p>
      <p>{item.impressions} impressions · {item.clicks} clicks · CTR {item.clickThroughRate.toFixed(2)}% · {item.remainingImpressions} remaining · {item.completionPercent.toFixed(1)}% complete</p>
      {item.completedAt && <p>Completed {new Date(item.completedAt).toLocaleString()}</p>}
      {item.rejectionReason && <p>Last rejection: {item.rejectionReason}</p>}
      {item.history?.length > 0 && <details><summary>Review history</summary>{item.history.map((review, index) => <p key={index}>{review.decision} · {new Date(review.reviewedAt).toLocaleString()} {review.reason}</p>)}</details>}
      {item.hasVideo && <button className="secondary-btn" disabled={busy} onClick={() => onPreview(item)}>Preview video</button>}
      {item.status === "uploading" && <p>Upload in progress. After an interruption, retry after 30 minutes.</p>}
      {["draft", "rejected", "uploading"].includes(item.status) && <button className="primary-btn" disabled={busy} onClick={() => onEdit(item)}>{item.status === "rejected" ? "Resubmit replacement" : "Continue draft"}</button>}
    </article>)}
  </section>;
}

export function BusinessAds({ api, token, categories }) {
  const [settings, setSettings] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [form, setForm] = useState(blank);
  const [current, setCurrent] = useState(null);
  const [video, setVideo] = useState(null);
  const [proof, setProof] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function load() {
    const [config, list] = await Promise.all([request(api, token, "/business/ad-settings"), request(api, token, "/business/ads")]);
    setSettings(config); setSubmissions(list);
  }
  useEffect(() => { load().catch(err => setError(err.message)); }, [api, token]);
  async function act(action) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const edit = item => { setCurrent(item); setForm({ ...blank, ...item }); setVideo(null); setProof(null); setError(""); setMessage(""); };
  const unsaved = Boolean(current && (video || ["title", "description", "targetUrl", "targetCity", "targetCategories", "targetViews"].some(key => JSON.stringify(form[key]) !== JSON.stringify(current[key]))));
  async function saveDraft(event) {
    event.preventDefault();
    await act(async () => {
      if (video && (!["video/mp4", "video/webm"].includes(video.type) || video.size > 150 * 1024 * 1024)) throw new Error("Choose an MP4 or WebM video up to 150 MB.");
      if (!video && !current?.hasVideo) throw new Error("Choose an ad video first.");
      const draft = await request(api, token, current ? `/business/ads/${current.id}` : "/business/ads", json(current ? "PATCH" : "POST", { ...form, cpmRupees: settings.cpmRupees }));
      setCurrent(draft); setForm({ ...blank, ...draft });
      if (video) {
        const updated = await request(api, token, `/business/ads/${draft.id}/video`, { method: "PUT", headers: { "Content-Type": video.type }, body: video });
        setCurrent(updated); setVideo(null);
      }
      await load();
      setMessage("Draft saved. Pay the quoted amount and upload proof below, then submit for review. Your ad is not submitted yet.");
    });
  }
  async function submit() {
    await act(async () => {
      if (unsaved) throw new Error("Save changes before submitting.");
      if (!current?.hasVideo) throw new Error("Save the draft and upload a video before submitting.");
      if (!current.paymentVerified && proof) {
        if (!imageTypes.includes(proof.type) || proof.size > 8 * 1024 * 1024) throw new Error("Choose a JPEG, PNG, or WebP screenshot up to 8 MB.");
        await request(api, token, `/business/ads/${current.id}/proof`, { method: "PUT", headers: { "Content-Type": proof.type }, body: proof });
      }
      await request(api, token, `/business/ads/${current.id}/submit`, json("POST", {}));
      setCurrent(null); setForm(blank); setProof(null); setVideo(null);
      await load();
      setMessage("Submitted for payment and content review. We will notify you when reviewed and when your ad is running.");
    });
  }
  return <section className="notification-section membership-panel">
    <h2>Business video ads</h2><p>Upload + destination URL + city/interests → QR payment → admin review → admin publishes your approved ad.</p>
    {error && <p role="alert" className="membership-error">{error}</p>}{message && <p role="status">{message}</p>}
    <button className="secondary-btn" disabled={busy} onClick={() => act(load)}>Refresh ads & analytics</button>
    {!settings ? <p>Loading ad settings...</p> : <><p>Current price: ₹{settings.cpmRupees} per 1000 impressions. Existing drafts keep their quoted price.</p>
      <form className="video-form" onSubmit={saveDraft}>
        <fieldset disabled={busy} className="membership-review">
          <legend>{current ? "Edit / continue ad draft" : "New ad"}</legend>
          <label>Ad title<input required maxLength={120} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })}/></label>
          <label>Description<textarea maxLength={2000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })}/></label>
          <label>Destination URL<input required type="url" maxLength={2000} value={form.targetUrl} onChange={event => setForm({ ...form, targetUrl: event.target.value })} placeholder="https://your-business.example/offer"/></label>
          <label>City (optional; blank = all locations)<input maxLength={100} value={form.targetCity} onChange={event => setForm({ ...form, targetCity: event.target.value })}/></label>
          <fieldset><legend>Interests (none selected = all interests)</legend>{categories.map(category => <label key={category.id}><input type="checkbox" checked={form.targetCategories.includes(category.id)} onChange={event => setForm({ ...form, targetCategories: event.target.checked ? [...form.targetCategories, category.id] : form.targetCategories.filter(id => id !== category.id) })}/>{category.name}</label>)}</fieldset>
          <label>Purchased impressions<input required type="number" min={1000} max={1000000} step={1000} disabled={Boolean(current)} value={form.targetViews} onChange={event => setForm({ ...form, targetViews: Number(event.target.value) })}/></label>
          <label>Ad video (MP4 / WebM, up to 150 MB)<input type="file" accept="video/mp4,video/webm" onChange={event => setVideo(event.target.files?.[0] || null)}/></label>
          {current?.hasVideo && <p>A video is already uploaded. Choosing another file replaces it.</p>}
          <p>Total: ₹{current?.amountRupees ?? form.targetViews / 1000 * settings.cpmRupees}. Confirm the recipient before paying.</p>
          <button className="primary-btn">{busy ? "Saving / uploading..." : "Save details & upload video"}</button>
          {current && <button className="secondary-btn" type="button" onClick={() => { setCurrent(null); setForm(blank); setVideo(null); setProof(null); }}>Start another ad</button>}
        </fieldset>
      </form>
      {current?.hasVideo && <section className="membership-review">
        <h3>Payment & submission</h3>
        {current.paymentVerified ? <p>Your ₹{current.amountRupees} payment is verified and retained for this {current.targetViews}-impression replacement. Do not pay again.</p> : <>
          <p>Pay exactly ₹{current.amountRupees}, then upload the successful payment screenshot. A screenshot alone does not activate an ad.</p>
          {settings.qrUrl ? <img className="membership-qr" src={`${api}${settings.qrUrl}`} alt="Business ad payment QR"/> : <p role="alert">QR unavailable. Contact admin before paying.</p>}
          <label>Payment screenshot (max 8 MB)<input type="file" disabled={busy} accept={imageTypes.join(",")} onChange={event => setProof(event.target.files?.[0] || null)}/></label>
          {current.hasProof && <p>A payment screenshot is saved. You may replace it before submission.</p>}
        </>}
        <p>{unsaved ? "You have unsaved changes. Save the details above before submitting." : "Saved details will be sent for review."}</p>
        <button className="primary-btn" disabled={busy || unsaved || (!current.paymentVerified && !proof && !current.hasProof)} onClick={submit}>{busy ? "Submitting..." : "Submit paid ad for review"}</button>
      </section>}
    </>}
    {preview && <PrivateAdMedia api={api} token={token} path={`/business/ads/${preview.id}/video`} video onClose={() => setPreview(null)}/>}
    <BusinessAdReports submissions={submissions} categories={categories} busy={busy} onEdit={edit} onPreview={setPreview}/>
  </section>;
}

export function AdminBusinessAdReview({ api, token, onUpdated, categories }) {
  const [settings, setSettings] = useState(null);
  const [price, setPrice] = useState(500);
  const [queue, setQueue] = useState([]);
  const [reasons, setReasons] = useState({});
  const [verified, setVerified] = useState({});
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function load() {
    const [config, list] = await Promise.all([request(api, token, "/admin/business-ad-settings"), request(api, token, "/admin/business-ads")]);
    setSettings(config); setPrice(config.cpmRupees); setQueue(list);
  }
  useEffect(() => { load().catch(err => setError(err.message)); }, [api, token]);
  async function act(action) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="membership-panel notification-section">
    <h2>Business ad pricing & paid submissions</h2>
    {error && <p role="alert" className="membership-error">{error}</p>}{message && <p role="status">{message}</p>}
    <form className="category-form" onSubmit={event => { event.preventDefault(); act(async () => {
      const result = await request(api, token, "/admin/business-ad-settings", json("PUT", { cpmRupees: price })); setSettings(result); setMessage("Business ad pricing saved. Existing quotes are unchanged.");
    }); }}><label>Price per 1000 impressions (₹)<input required min={1} max={1000000} type="number" value={price} onChange={event => setPrice(Number(event.target.value))}/></label><button className="primary-btn" disabled={busy}>Save business ad pricing</button></form>
    <p>Business ads use the same payment QR as membership. Upload/change it below or in Membership plans & payments.</p>
    {settings?.qrUrl && <img className="membership-qr" src={`${api}${settings.qrUrl}`} alt="Business payment QR"/>}
    <label>Upload / replace payment QR<input disabled={busy} type="file" accept={imageTypes.join(",")} onChange={event => {
      const file = event.target.files?.[0]; if (!file) return;
      act(async () => {
        if (!imageTypes.includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error("Choose a JPEG, PNG or WebP QR up to 8 MB.");
        await request(api, token, "/admin/membership/qr", { method: "POST", headers: { "Content-Type": file.type }, body: file });
        await load(); setMessage("Payment QR updated for memberships and business ads.");
      });
    }}/></label>
    <button className="secondary-btn" disabled={busy} onClick={() => act(load)}>Refresh paid submissions</button>
    <p>Preview the video and check the destination, city and interests. Verify the money received in your bank/UPI app, not just the screenshot. Approval adds a paused ad below; publish it separately.</p>
    {preview && <PrivateAdMedia api={api} token={token} path={preview.path} video={preview.video} onClose={() => setPreview(null)}/>}
    {!queue.length && <p>No business ads awaiting review.</p>}
    {queue.map(item => <article className="membership-review" key={item.id}>
      <strong>{item.businessName} - {item.title}</strong><p>{item.status} · ₹{item.amountRupees} for {item.targetViews} impressions</p>
      <p>{item.description}</p><p><a href={item.targetUrl} target="_blank" rel="noopener noreferrer">Destination: {item.targetUrl}</a></p><p>City: {item.targetCity || "All locations"} · Interests: {item.targetCategories.map(id => categories.find(category => category.id === id)?.name || id).join(", ") || "All interests"}</p>
      {item.hasVideo && <button className="secondary-btn" disabled={busy} onClick={() => setPreview({ path: `/admin/business-ads/${item.id}/video`, video: true })}>Review video</button>}
      {item.hasProof && <button className="secondary-btn" disabled={busy} onClick={() => setPreview({ path: `/admin/business-ads/${item.id}/proof`, video: false })}>Review payment screenshot</button>}
      <label><input type="checkbox" disabled={item.paymentVerified || busy} checked={item.paymentVerified || verified[item.id] || false} onChange={event => setVerified({ ...verified, [item.id]: event.target.checked })}/> I verified ₹{item.amountRupees} was received (retained for resubmission if rejected)</label>
      <label>Rejection reason<textarea maxLength={500} value={reasons[item.id] || ""} onChange={event => setReasons({ ...reasons, [item.id]: event.target.value })}/></label>
      <div className="admin-actions">{["approved", "rejected"].map(decision => <button key={decision} className={decision === "approved" ? "primary-btn" : "secondary-btn"} disabled={busy || (decision === "approved" ? item.status === "rejecting" || (!item.paymentVerified && !verified[item.id]) : item.status === "approving" || !reasons[item.id]?.trim())} onClick={() => act(async () => {
        await request(api, token, `/admin/business-ads/${item.id}/review`, json("POST", { decision, reason: reasons[item.id], paymentVerified: item.paymentVerified || verified[item.id] === true }));
        setPreview(null); await load(); await onUpdated();
        setMessage(decision === "approved" ? "Approved and added to Ads as unpublished. Publish it from the ad table." : "Rejected. Video deleted; business can resubmit a replacement.");
      })}>{decision === "approved" ? "Approve into Ads (unpublished)" : "Reject & delete video"}</button>)}</div>
    </article>)}
  </section>;
}
