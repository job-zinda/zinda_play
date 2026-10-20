import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Heart, SmilePlus } from "lucide-react";
import { playEngagementSound, prepareEngagementSound } from "./engagement-feedback.js";
import "./reactions.css";

export const reactions = [
  { type: "like", label: "Like", emoji: "\uD83D\uDC4D" },
  { type: "love", label: "Love", emoji: "\u2764\uFE0F" },
  { type: "haha", label: "Haha", emoji: "\uD83D\uDE02" },
  { type: "wow", label: "Wow", emoji: "\uD83D\uDE2E" },
  { type: "sad", label: "Sad", emoji: "\uD83D\uDE22" },
  { type: "angry", label: "Angry", emoji: "\uD83D\uDE20" }
];

export async function engagementRequest(api, token, path, body) {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not update reactions or comments.");
  return data;
}

export function ReactionButton({ reaction, count = 0, counts, busy, onReact, compact = false }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const container = useRef(null);
  const picker = useRef(null);
  const timer = useRef(null);
  const longPressed = useRef(false);
  const selected = reactions.find(item => item.type === reaction);
  useEffect(() => {
    if (!open) return;
    const dismiss = event => {
      if (!container.current?.contains(event.target) && !picker.current?.contains(event.target)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !container.current || !picker.current) { setPosition(null); return; }
    const anchor = container.current.getBoundingClientRect();
    const menu = picker.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - menu.width - 8)),
      top: Math.max(8, Math.min(anchor.top >= menu.height + 8 ? anchor.top - menu.height - 4 : anchor.bottom + 4, window.innerHeight - menu.height - 8))
    });
    picker.current.querySelector("button")?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const choose = type => {
    setOpen(false);
    if (open) container.current?.querySelector(".reaction-picker-toggle")?.focus({ preventScroll: true });
    prepareEngagementSound();
    onReact(type);
  };
  return <div ref={container} className={`reaction-control${compact ? " reaction-compact" : ""}`}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); container.current?.querySelector(".reaction-picker-toggle")?.focus(); } }}>
    <button type="button" className={`engage-action engage-like ${reaction ? "selected" : ""}`}
      aria-label={`${selected?.label || "Like"}, ${count}`} aria-pressed={Boolean(reaction)} disabled={busy}
      onPointerDown={event => {
        if (event.button !== 0) return;
        longPressed.current = false;
        timer.current = setTimeout(() => { longPressed.current = true; setOpen(true); }, 450);
      }}
      onPointerUp={() => clearTimeout(timer.current)} onPointerLeave={() => clearTimeout(timer.current)}
      onPointerCancel={() => clearTimeout(timer.current)}
      onContextMenu={event => { event.preventDefault(); setOpen(true); }}
      onClick={() => { if (longPressed.current) { longPressed.current = false; return; } choose("like"); }}>
      <span className="engage-icon">{selected ? <span aria-hidden="true">{selected.emoji}</span> : <Heart size={20}/>}</span>
      <strong>{Number(count).toLocaleString()}</strong><small>{selected?.label || "Like"}</small>
    </button>
    <button type="button" className="reaction-picker-toggle" aria-label="Choose reaction" aria-expanded={open} disabled={busy} onClick={() => setOpen(value => !value)}><SmilePlus size={16}/></button>
    {open && createPortal(<div ref={picker} className="reaction-picker" role="group" aria-label="Reactions" style={{ ...position, visibility: position ? "visible" : "hidden" }}>
      {reactions.map(item => <button type="button" key={item.type} disabled={busy} aria-label={item.label} aria-pressed={reaction === item.type}
        onClick={() => choose(item.type)}><span aria-hidden="true">{item.emoji}</span><small>{item.label}</small><small>{counts?.[item.type] || 0}</small></button>)}
    </div>, document.body)}
  </div>;
}

function CommentThread({ comment, api, token, videoId, canComment, onSignIn, onAdded, depth = 0 }) {
  const [data, setData] = useState(comment);
  const [replies, setReplies] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState(null);
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setData(comment); }, [comment]);
  const path = `/videos/${encodeURIComponent(videoId)}/comments`;
  async function work(callback, authenticated = false) {
    if (busy) return;
    if (authenticated && !canComment) {
      if (!token) onSignIn?.();
      else setError("Use a viewer account to react or reply.");
      return;
    }
    setBusy(true); setError("");
    try { await callback(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function load(more = false) {
    const page = await engagementRequest(api, token, `${path}?parentId=${data.id}${more && next ? `&before=${next}` : ""}`);
    setReplies(current => {
      const items = more ? [...current, ...page.comments] : [...page.comments, ...current];
      return [...new Map(items.map(item => [item.id, item])).values()];
    });
    setLoaded(true); setNext(page.nextCursor); setOpen(true);
  }
  return <article className={`thread-comment${depth ? " thread-reply" : ""}`}>
    <header><strong>{data.username}</strong>{data.createdAt && <time>{new Date(data.createdAt).toLocaleString()}</time>}</header>
    <p>{data.text}</p>
    <div className="thread-actions">
      <ReactionButton compact reaction={data.reaction} count={data.reactionCount} counts={data.reactions} busy={busy} onReact={type => work(async () => {
        const result = await engagementRequest(api, token, `${path}/${data.id}/reaction`, { reaction: type });
        setData(current => ({ ...current, ...result }));
        if (result.reaction) playEngagementSound();
      }, true)}/>
      <button type="button" disabled={busy} onClick={() => {
        if (!canComment) { if (!token) onSignIn?.(); else setError("Use a viewer account to reply."); return; }
        setReplying(value => !value);
      }}>Reply</button>
      {(data.replyCount > 0 || replies.length > 0) && <button type="button" disabled={busy} onClick={() => {
        if (open) setOpen(false);
        else if (loaded) setOpen(true);
        else work(() => load());
      }}>{open ? "Hide replies" : `Show replies (${data.replyCount})`}</button>}
    </div>
    {replying && <form className="thread-compose" onSubmit={event => {
      event.preventDefault(); prepareEngagementSound();
      work(async () => {
        const result = await engagementRequest(api, token, path, { text, parentId: data.id });
        setReplies(current => [result, ...current]); setOpen(true);
        setData(current => ({ ...current, replyCount: current.replyCount + 1 }));
        setText(""); setReplying(false); playEngagementSound(true); onAdded?.();
      }, true);
    }}>
      <textarea autoFocus aria-label={`Reply to ${data.username}`} maxLength={1000} required value={text} disabled={busy} onChange={event => setText(event.target.value)}/>
      <button type="submit" disabled={busy || !text.trim()}>Send reply</button>
      <button type="button" disabled={busy} onClick={() => setReplying(false)}>Cancel</button>
    </form>}
    {error && <p className="thread-error" role="alert">{error}</p>}
    {open && <div className={depth < 3 ? "thread-children" : ""}>
      {replies.map(reply => <CommentThread key={reply.id} comment={reply} api={api} token={token} videoId={videoId} canComment={canComment} onSignIn={onSignIn} onAdded={onAdded} depth={depth + 1}/>)}
      {(!loaded || next) && <button type="button" disabled={busy} onClick={() => work(() => load(loaded))}>{busy ? "Loading..." : "Load more replies"}</button>}
    </div>}
  </article>;
}

export function CommentThreads({ comments, nextCursor, api, token, videoId, canComment, onSignIn, onAdded }) {
  const [extra, setExtra] = useState([]);
  const [next, setNext] = useState(nextCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setExtra([]); setNext(nextCursor); }, [comments, nextCursor, token]);
  const items = [...new Map([...comments, ...extra].map(item => [item.id, item])).values()];
  return <div className="comment-threads">
    {items.map(comment => <CommentThread key={`${token || "guest"}:${comment.id}`} comment={comment} api={api} token={token} videoId={videoId} canComment={canComment} onSignIn={onSignIn} onAdded={onAdded}/>)}
    {next && <button type="button" disabled={busy} onClick={async () => {
      if (busy) return;
      setBusy(true); setError("");
      try {
        const page = await engagementRequest(api, token, `/videos/${encodeURIComponent(videoId)}/comments?before=${next}`);
        setExtra(current => [...current, ...page.comments]); setNext(page.nextCursor);
      } catch (failure) { setError(failure.message); }
      finally { setBusy(false); }
    }}>{busy ? "Loading..." : "Load more comments"}</button>}
    {error && <p className="thread-error" role="alert">{error}</p>}
  </div>;
}
