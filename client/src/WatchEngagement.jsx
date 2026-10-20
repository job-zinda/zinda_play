import { useEffect, useRef, useState } from "react";
import { Bookmark, Heart, Loader2, MessageCircle, RefreshCw, Send, UserRound } from "lucide-react";
import "./watch.css";
import { CommentThreads, ReactionButton } from "./Reactions.jsx";
import { prepareEngagementSound } from "./engagement-feedback.js";

export const savedVideoKey = (username, videoId) =>
  username && videoId ? `saved-video:${encodeURIComponent(username)}:${encodeURIComponent(videoId)}` : "";

function readSaved(key) {
  try { return Boolean(key) && localStorage.getItem(key) === "true"; }
  catch { return false; }
}

// Bookmarks are a per-account preference stored on this device, matching the mobile app.
export function useSavedVideo(username, videoId) {
  const key = savedVideoKey(username, videoId);
  const [saved, setSaved] = useState(() => readSaved(key));
  useEffect(() => setSaved(readSaved(key)), [key]);
  function toggle() {
    if (!key) return false;
    const next = !saved;
    try {
      if (next) localStorage.setItem(key, "true");
      else localStorage.removeItem(key);
    } catch {
      throw new Error("Could not update saved videos in this browser.");
    }
    setSaved(next);
    return true;
  }
  return [saved, toggle];
}

export function Action({ label, count, icon, tone, selected, busy, onClick, compact = false }) {
  return <button type="button" className={`engage-action ${tone ? `engage-${tone}` : ""} ${selected ? "selected" : ""}`} aria-pressed={selected === undefined ? undefined : selected} aria-label={`${label}${count === undefined ? "" : `, ${count}`}`} disabled={busy} onClick={onClick}>
    <span className="engage-icon">{busy ? <Loader2 className="engage-spin" size={18}/> : icon}</span>
    {(!compact || count !== undefined) && <strong>{count === undefined ? "\u00a0" : Number(count).toLocaleString()}</strong>}
    <small>{label}</small>
  </button>;
}

export function EngagementBar({ liked, reaction, reactions, likes, comments, saved, liking, onLike, onComments, onShare, onSave }) {
  return <div className="engage-bar" role="group" aria-label="Video actions">
    <ReactionButton reaction={reaction || (liked ? "like" : null)} counts={reactions} count={likes} busy={liking} onReact={onLike}/>
    <Action label="Comments" count={comments} tone="comments" onClick={onComments} icon={<MessageCircle size={19}/>}/>
    <Action label="Share" onClick={onShare} icon={<Send size={19}/>}/>
    <Action label={saved ? "Saved" : "Save"} tone="save" selected={saved} onClick={onSave} icon={<Bookmark size={19} fill={saved ? "currentColor" : "none"}/>}/>
  </div>;
}

function EmptyIllustration() {
  return <svg className="comments-empty-art" viewBox="0 0 100 70" aria-hidden="true">
    <path d="M58 29h24q9 0 9 9v11q0 8-8 8v8l-11-8H58z" fill="#7027f555" stroke="#ac6cff" strokeWidth="2.5" strokeLinejoin="round"/>
    <path d="M25 7h39q13 0 13 13v16q0 11-13 11H43L29 60V47h-4q-11 0-11-11V20q0-13 11-13z" fill="#292044" stroke="#ac6cff" strokeWidth="2.5" strokeLinejoin="round"/>
    <circle cx="32" cy="27" r="3" fill="#ac6cff"/><circle cx="45" cy="27" r="3" fill="#ac6cff"/><circle cx="58" cy="27" r="3" fill="#ac6cff"/>
    <path d="M84 12l4-7M5 34l-5-3M6 44l-6 2" stroke="#ac6cff" strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M90 20l7-2" stroke="#ff8f9d" strokeWidth="2.5" strokeLinecap="round"/>
  </svg>;
}

export function CommentsEmptyState() {
  return <div className="comments-empty">
    <EmptyIllustration/>
    <strong>No comments yet</strong>
    <span>Be the first to share your thoughts!</span>
  </div>;
}

export function CommentsPanel({ panelRef, inputRef, count, comments, canComment, signedIn, commentText, onCommentText, onSubmit, submitting, onRefresh, refreshing, onSignIn, api, token, videoId, nextCursor, onReplyAdded }) {
  return <section className="comments-panel" ref={panelRef} aria-labelledby="comments-heading">
    <div className="comments-panel-head">
      <h2 id="comments-heading">Comments ({Number(count || 0).toLocaleString()})</h2>
      {onRefresh && <button type="button" className="comments-refresh" onClick={onRefresh} disabled={refreshing} aria-label="Refresh comments"><RefreshCw size={17}/></button>}
    </div>
    {comments.length ? <CommentThreads comments={comments} nextCursor={nextCursor} api={api} token={token} videoId={videoId} canComment={canComment} onSignIn={onSignIn} onAdded={onReplyAdded}/> : <CommentsEmptyState/>}
    {canComment
      ? <form className="comments-compose" onSubmit={event => { prepareEngagementSound(); onSubmit(event); }}>
        <textarea ref={inputRef} required rows={1} maxLength={1000} value={commentText} onChange={event => onCommentText(event.target.value)} placeholder="Share your thoughts..." aria-label="Add a comment"/>
        <button type="submit" disabled={submitting || !commentText.trim()} aria-label="Post comment">{submitting ? <Loader2 className="engage-spin" size={19}/> : <Send size={19}/>}</button>
      </form>
      : <div className="comments-signin">
        <UserRound size={22}/>
        <span>{signedIn ? "Sign in with a viewer account to like, comment or save." : "Sign in to like, comment or save."}</span>
        {!signedIn && <button type="button" onClick={onSignIn}>Sign In</button>}
      </div>}
  </section>;
}

export function useCommentsFocus() {
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  function openComments() {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    inputRef.current?.focus({ preventScroll: true });
  }
  return { panelRef, inputRef, openComments };
}
