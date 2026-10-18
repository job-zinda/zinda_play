import { useEffect, useRef, useState } from "react";
import { Play, Eye, Heart, MoreVertical, Share2, UserRound, Clock3 } from "lucide-react";
import VideoPreview from "./VideoPreview.jsx";

const PREVIEW_DELAY_MS = 700;

export const formatDuration = seconds => {
  const total = Math.floor(Number(seconds) || 0);
  if (total <= 0) return "";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

const previewUrl = playbackUrl => {
  if (!/^https:\/\/iframe\.mediadelivery\.net\/embed\//i.test(playbackUrl || "")) return "";
  try {
    const url = new URL(playbackUrl);
    url.searchParams.set("autoplay", "true");
    url.searchParams.set("muted", "true");
    url.searchParams.set("loop", "true");
    url.searchParams.set("preload", "false");
    return url.toString();
  } catch { return ""; }
};

export default function VideoCard({ video, index = 0, rank, assetSrc, like, onOpen, onShare, onCreator, onLike, onWarmLike }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const timer = useRef(null);
  const cardRef = useRef(null);
  const src = previewUrl(video.playbackUrl);
  const duration = formatDuration(video.durationSeconds);
  const creator = video.creatorProfile;
  const badge = rank ? { cls: "rank", text: `#${rank} TRENDING` }
    : video.isSponsored ? { cls: "sponsored", text: `SPONSORED · ${video.sponsorName}` }
    : video.collectionName ? { cls: "episode", text: `${video.collectionType === "series" ? "EPISODE" : "ITEM"}${video.episodeNumber ? ` ${video.episodeNumber}` : ""}` }
    : video.featured ? { cls: "featured", text: "FEATURED" } : null;

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = event => { if (!cardRef.current?.contains(event.target)) setMenuOpen(false); };
    const escape = event => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [menuOpen]);

  const startPreview = event => {
    onWarmLike?.(video);
    if (!src || event.pointerType !== "mouse") return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPreviewing(true), PREVIEW_DELAY_MS);
  };
  const stopPreview = () => { window.clearTimeout(timer.current); setPreviewing(false); };
  const stop = handler => event => { event.stopPropagation(); handler(event); };

  return <article ref={cardRef} className={`vcard${menuOpen ? " menu-open" : ""}`} {...(video.isSponsored ? { "data-sponsored": "true", "data-video-id": video.id } : {})} onClick={() => onOpen(video)} onPointerEnter={startPreview} onPointerLeave={stopPreview} onFocus={() => onWarmLike?.(video)}>
    <div className="vcard-thumb">
      <button type="button" className="vcard-open" aria-label={`Watch ${video.title}`}>
        {video.thumbnailUrl ? <img src={assetSrc(video.thumbnailUrl)} alt="" loading="lazy" draggable="false"/> : <VideoPreview video={video}/>}
        {video.thumbnailUrl && previewing && src && <iframe className="vcard-preview" src={src} title="" tabIndex={-1} allow="autoplay" aria-hidden="true"/>}
        <span className="vcard-shade"/>
        <span className="vcard-play"><Play size={22} fill="currentColor"/></span>
      </button>
      {badge && <span className={`vcard-badge ${badge.cls}`}>{badge.text}</span>}
      {duration && <span className="vcard-duration"><Clock3 size={11}/> {duration}</span>}
      <div className="vcard-menu-wrap">
        <button type="button" className="vcard-icon-btn" aria-label="More actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={stop(() => setMenuOpen(open => !open))}><MoreVertical size={17}/></button>
        {menuOpen && <div className="vcard-menu" role="menu" onClick={event => event.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onShare(video); }}><Share2 size={15}/> Share</button>
          {creator && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onCreator(creator); }}><UserRound size={15}/> View creator</button>}
        </div>}
      </div>
    </div>
    <div className="vcard-meta">
      <div className="vcard-stats">
        <span className="vcard-stat"><Eye size={13}/> {Number(video.views || 0).toLocaleString()} views</span>
        <button type="button" className={`vcard-like${like?.liked ? " liked" : ""}`} aria-pressed={Boolean(like?.liked)} aria-label={like?.liked ? "Unlike this video" : "Like this video"} onClick={stop(() => onLike(video))}>
          <Heart size={14} fill={like?.liked ? "currentColor" : "none"}/>{like ? <span>{Number(like.likeCount || 0).toLocaleString()}</span> : null}
        </button>
      </div>
      <span className="vcard-category">{video.collectionName || video.category?.name || "Zinda Play"}</span>
      <h3 title={video.title}>{video.title}</h3>
      {creator
        ? <button type="button" className="vcard-creator" onClick={stop(() => onCreator(creator))}>
            {creator.profilePhotoUrl ? <img src={assetSrc(creator.profilePhotoUrl)} alt="" loading="lazy"/> : <span className="vcard-avatar"><UserRound size={12}/></span>}
            <span>{creator.displayName || creator.username}</span>
          </button>
        : <p className="vcard-desc">{video.description || "Discover this video on Zinda Play."}</p>}
    </div>
  </article>;
}

export function VideoCardSkeleton() {
  return <div className="vcard vcard-skeleton" aria-hidden="true">
    <div className="vcard-thumb"/>
    <div className="vcard-meta"><i style={{ width: "40%" }}/><i style={{ width: "30%" }}/><i style={{ width: "85%" }}/><i style={{ width: "50%" }}/></div>
  </div>;
}
