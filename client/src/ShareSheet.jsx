import { useEffect, useState } from "react";
import { Copy, Share2, UserRound, X } from "lucide-react";
import { shareLink } from "./public-links.js";

// Shows who is being shared (creator photo and name) before handing off to the system share sheet.
export default function ShareSheet({ share, onClose, assetSrc }) {
  const [status, setStatus] = useState("");
  useEffect(() => {
    setStatus("");
    if (!share) return undefined;
    const close = event => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [share, onClose]);
  if (!share) return null;
  const { heading, title, url, creator } = share;
  const name = creator?.displayName || creator?.username || "Zinda Play";
  const message = `${title}\n${url}`;
  async function shareNow() {
    const result = await shareLink(title, url);
    if (result === "copied") setStatus("Link copied.");
    else if (result === "shared") onClose();
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setStatus("Link copied.");
    } catch {
      window.prompt("Copy this link:", url);
    }
  }
  return <div className="share-sheet-backdrop" role="presentation" onClick={onClose}>
    <div className="share-sheet" role="dialog" aria-modal="true" aria-label={heading} onClick={event => event.stopPropagation()}>
      <div className="share-sheet-header"><h2>{heading}</h2><button type="button" className="icon-btn" aria-label="Close share" onClick={onClose}><X size={18}/></button></div>
      <div className="share-sheet-creator">
        {creator?.profilePhotoUrl ? <img src={assetSrc(creator.profilePhotoUrl)} alt={`${name} profile photo`}/> : <span className="share-sheet-avatar"><UserRound size={28}/></span>}
        <div><strong>{name}</strong>{creator?.username && <small>@{creator.username}</small>}</div>
      </div>
      <p className="share-sheet-title">{title}</p>
      <div className="share-sheet-actions">
        <button type="button" className="primary-btn" onClick={shareNow}><Share2 size={16}/> Share</button>
        <a className="secondary-btn share-sheet-whatsapp" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
        <button type="button" className="secondary-btn" onClick={copy}><Copy size={16}/> Copy link</button>
      </div>
      <input className="share-sheet-url" readOnly value={url} aria-label="Share link" onFocus={event => event.target.select()}/>
      {status && <p className="share-sheet-status" role="status">{status}</p>}
    </div>
  </div>;
}
