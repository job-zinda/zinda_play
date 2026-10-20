import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bookmark, Check, ChevronDown, ChevronUp, Flag, Heart, MessageCircle, Pause, Play, RefreshCw, Send, UserPlus, UserRound, Volume2, VolumeX, X } from "lucide-react";
import "./shorts.css";
import { shareLink, videoShareUrl } from "./public-links.js";
import { PlayerGate } from "./Ads.jsx";
import { Action, CommentsEmptyState } from "./WatchEngagement.jsx";

async function request(api, token, path, options = {}) {
  const response = await fetch(`${api}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`The server returned an invalid response (${response.status}). Check the backend deployment.`); }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

export default function Shorts({ api, token, role, onSignIn, onShare, onCreator, initialId, suspended = false }) {
  const [saved, setSaved] = useState(false);
  return <section className="web-shorts" aria-label="Simply">
    <div className="shorts-heading">
      <h1>{saved ? "Watch Later" : "Simply"}</h1>
      <button className="secondary-btn" aria-pressed={saved} onClick={() => {
        if (!token) return onSignIn();
        setSaved(value => !value);
      }}><Bookmark size={18}/>{saved ? "All Simply videos" : "Watch Later"}</button>
    </div>
    <ShortFeed key={`${saved}:${initialId || ""}`} api={api} token={token} role={role} onSignIn={onSignIn} onShare={onShare} onCreator={onCreator} saved={saved} initialId={saved ? null : initialId} suspended={suspended}/>
  </section>;
}

function ShortFeed({ api, token, role, onSignIn, onShare, onCreator, saved, initialId, suspended }) {
  const [items, setItems] = useState([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [more, setMore] = useState(true);
  const [muted, setMuted] = useState(true);
  const [visible, setVisible] = useState(!document.hidden);
  const feed = useRef(null);
  const cursor = useRef(null);
  const busy = useRef(false);
  const abort = useRef(null);
  const initialized = useRef(false);
  const resetScroll = useRef(false);
  const stage = useRef(null);
  const [stageSize, setStageSize] = useState(null);
  const currentVideo = items[index];
  const aspectRatio = currentVideo?.width > 0 && currentVideo?.height > 0
    ? currentVideo.width / currentVideo.height : 9 / 16;

  useLayoutEffect(() => {
    const container = stage.current;
    const resize = () => {
      if (window.matchMedia("(max-width:760px)").matches) {
        setStageSize(null);
        return;
      }
      const availableWidth = container.parentElement.clientWidth;
      const availableHeight = Math.max(1, window.innerHeight - Math.max(0, container.getBoundingClientRect().top) - 16);
      const height = Math.min(1000, availableHeight, availableWidth / aspectRatio);
      setStageSize({ width: height * aspectRatio, height });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container.parentElement);
    window.addEventListener("resize", resize);
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); };
  }, [aspectRatio]);

  useLayoutEffect(() => {
    if (feed.current && stageSize) feed.current.scrollTop = index * feed.current.clientHeight;
  }, [stageSize?.height]);
  useLayoutEffect(() => {
    const element = feed.current;
    const observer = new ResizeObserver(() => {
      element.scrollTop = index * element.clientHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [index]);
  const load = useCallback(async (reset = false) => {
    if (busy.current) return;
    busy.current = true;
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true); setError("");
    try {
      const first = reset || !initialized.current;
      const detail = first && initialId ? await request(api, token, `/shorts/${encodeURIComponent(initialId)}`, { signal: controller.signal }) : null;
      const next = first ? null : cursor.current;
      const path = saved ? `/shorts/saved${next ? `?before=${encodeURIComponent(next)}` : ""}` : `/shorts?limit=6${next ? `&cursor=${encodeURIComponent(next)}` : ""}`;
      const page = await request(api, token, path, { signal: controller.signal });
      if (controller.signal.aborted) return;
      resetScroll.current = first;
      setItems(current => {
        const result = first ? (detail ? [detail] : []) : [...current];
        const ids = new Set(result.map(video => video.id));
        for (const video of page.items) if (!ids.has(video.id)) { ids.add(video.id); result.push(video); }
        return result;
      });
      initialized.current = true;
      cursor.current = page.nextCursor;
      setMore(Boolean(page.nextCursor));
      if (reset) { setIndex(0); feed.current?.scrollTo({ top: 0 }); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message);
    } finally {
      if (!controller.signal.aborted) { busy.current = false; setLoading(false); }
    }
  }, [api, token, saved, initialId]);

  useLayoutEffect(() => {
    if (resetScroll.current) {
      resetScroll.current = false;
      if (feed.current) feed.current.scrollTop = 0;
      setIndex(0);
    }
  }, [items]);

  useEffect(() => {
    busy.current = false;
    initialized.current = false;
    load(true);
    return () => abort.current?.abort();
  }, [load]);
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    if (more && !loading && !error && items.length && index >= items.length - 2) load();
  }, [index, items.length, more, loading, error, load]);

  function navigate(delta) {
    const element = feed.current;
    if (!element) return;
    const next = Math.max(0, Math.min(items.length, index + delta));
    element.scrollTo({ top: next * element.clientHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
  return <>
    <div className="shorts-toolbar">
      <span>Swipe, scroll or use arrow keys. Data saver: only the active video loads.</span>
      <button className="secondary-btn" disabled={loading} onClick={() => load(true)}><RefreshCw size={16}/>Refresh Simply</button>
    </div>
    <div className="shorts-stage" ref={stage} style={stageSize ? { width: stageSize.width, "--shorts-height": `${stageSize.height}px` } : undefined}>
      <div className="shorts-feed" ref={feed} tabIndex={0} aria-label="Vertical Simply feed"
        onKeyDown={event => {
          if (event.target !== event.currentTarget || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
          event.preventDefault(); navigate(event.key === "ArrowDown" ? 1 : -1);
        }}
        onScroll={event => {
          const element = event.currentTarget;
          if (element.clientHeight) setIndex(Math.round(element.scrollTop / element.clientHeight));
        }}>
        {items.map((video, i) => <div key={video.id} className="short-ad-gate">
          <PlayerGate api={api} token={token} placement="simply" active={visible && !suspended && i === index}>
            <ShortVideo video={video} api={api} token={token} role={role}
              active={visible && !suspended && i === index} muted={muted} onMute={() => setMuted(value => !value)} onSignIn={onSignIn} onShare={onShare} onCreator={onCreator}/>
          </PlayerGate>
        </div>)}
        <div key={`status-${items.length}`} className="shorts-status" role="status">
          {loading ? <><div className="shorts-skeleton"/><p>Loading Simply...</p></> : error ? <><p role="alert">{error}</p><button className="primary-btn" onClick={() => load()}>Retry</button></> :
            <><p>{more ? "More Simply videos are available." : items.length ? "You're all caught up." : saved ? "No saved Simply videos yet." : "No Simply videos yet. Upload one from the mobile app to get started."}</p>
              <button className="primary-btn" onClick={() => load(!more)}>{more ? "Load more Simply videos" : "Refresh"}</button></>}
        </div>
      </div>
      <div className="shorts-arrows">
        <button className="secondary-btn" aria-label="Previous Simply video" disabled={index === 0} onClick={() => navigate(-1)}><ChevronUp/></button>
        <button className="secondary-btn" aria-label="Next Simply video" disabled={index >= items.length} onClick={() => navigate(1)}><ChevronDown/></button>
      </div>
    </div>
  </>;
}

function ShortVideo({ video, api, token, role, active, muted, onMute, onSignIn, onShare, onCreator }) {
  const element = useRef(null);
  const activeNow = useRef(active);
  activeNow.current = active;
  const ticket = useRef(null);
  const watched = useRef(0);
  const lastPosition = useRef(0);
  const counted = useRef(false);
  const counting = useRef(false);
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [playError, setPlayError] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState("");
  const [comment, setComment] = useState("");
  const [state, setState] = useState({ likeCount: 0, liked: false, comments: [], commentCount: 0, saved: false, following: false, isSelf: false });
  const [views, setViews] = useState(video.views || 0);
  const [progress, setProgress] = useState(0);
  const creator = video.creatorProfile;
  const url = `/shorts/${encodeURIComponent(video.id)}`;
  const canEngage = token && ["member", "creator", "promoter", "business"].includes(role);
  const asset = path => /^https?:\/\//i.test(path) ? path : `${api}${path}`;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    Promise.all([
      request(api, token, `/videos/${encodeURIComponent(video.id)}/interactions`, { signal: controller.signal }),
      creator ? request(api, token, `/creators/${creator.id}/follow`, { signal: controller.signal }) : null,
      canEngage ? request(api, token, `${url}/state`, { signal: controller.signal }) : null
    ]).then(([interactions, follow, saved]) => {
      if (!controller.signal.aborted) setState({ ...interactions, following: follow?.following, isSelf: follow?.isSelf, saved: saved?.saved });
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [active, api, token, canEngage, video.id, creator?.id, url]);

  useEffect(() => {
    if (!active || counted.current) return;
    const controller = new AbortController();
    ticket.current = null; watched.current = 0;
    request(api, token, `${url}/view-start`, { method: "POST", signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) ticket.current = data;
    }).catch(failure => { if (!controller.signal.aborted) setError(`View tracking: ${failure.message}`); });
    return () => controller.abort();
  }, [active, api, token, url]);

  useEffect(() => {
    if (!active) return;
    const media = element.current;
    let hls;
    let cancelled = false;
    const stopFailedPlayback = () => hls?.destroy();
    media.addEventListener("error", stopFailedPlayback);
    setPlayError(""); setBuffering(true);
    async function attach() {
      try {
        if (media.canPlayType("application/vnd.apple.mpegurl")) {
          media.src = video.streamUrl;
          media.load();
        }
        else {
          const { default: Hls } = await import("hls.js/dist/hls.light.mjs");
          if (cancelled) return;
          if (!Hls.isSupported()) throw new Error("This browser does not support HLS playback.");
          hls = new Hls({ maxBufferLength: 10, maxMaxBufferLength: 20, backBufferLength: 0 });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!cancelled && data.fatal) {
              hls.stopLoad();
              setPlayError(`Could not play this Simply video (${data.details}). Check CDN access or retry.`);
            }
          });
          hls.loadSource(video.streamUrl);
          hls.attachMedia(media);
        }
      } catch (failure) { if (!cancelled) setPlayError(failure.message); }
    }
    attach();
    return () => {
      cancelled = true;
      media.removeEventListener("error", stopFailedPlayback);
      media.pause();
      hls?.destroy();
      media.removeAttribute("src");
      media.load();
    };
  }, [active, video.streamUrl, retry]);

  useEffect(() => {
    if (!active || !buffering || paused || modal || playError) return;
    const timeout = setTimeout(() => setPlayError("Video loading timed out. Check your connection, then retry playback."), 25000);
    return () => clearTimeout(timeout);
  }, [active, buffering, paused, modal, playError, retry]);

  useEffect(() => {
    const media = element.current;
    if (!media) return;
    media.muted = muted;
    const play = () => {
      if (active && !paused && !modal && media.readyState >= 2) media.play().catch(failure => {
        if (failure.name === "NotAllowedError") setPaused(true);
        else if (failure.name !== "AbortError") setPlayError(`Could not play this Simply video: ${failure.message}`);
      });
      else media.pause();
    };
    play();
    media.addEventListener("canplay", play);
    return () => { media.removeEventListener("canplay", play); media.pause(); };
  }, [active, muted, paused, modal, retry]);

  async function action(work, needsAuth = true) {
    if (busy) return;
    if (needsAuth && !canEngage) {
      if (!token) onSignIn();
      else setError("Use a viewer, creator, promoter or business account to interact with Simply.");
      return;
    }
    setBusy(true); setError("");
    try { await work(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function timeUpdate() {
    const media = element.current;
    const position = media.currentTime;
    const delta = position - lastPosition.current;
    lastPosition.current = position;
    setProgress(media.duration ? position / media.duration : 0);
    if (!activeNow.current || media.paused || media.seeking || media.readyState < 3 || delta <= 0 || delta > 1.5 || !ticket.current || counted.current || counting.current) return;
    watched.current += delta * 1000;
    if (watched.current < ticket.current.minimumWatchMs + 300) return;
    counting.current = true;
    try {
      const data = await request(api, token, `${url}/view`, { method: "POST", body: JSON.stringify({ ticket: ticket.current.ticket }) });
      counted.current = true; setViews(data.views);
    } catch (failure) { counted.current = true; setError(`View tracking: ${failure.message}`); }
    finally { counting.current = false; }
  }
  const button = (label, Icon, callback, pressed, tone, count) => <Action compact label={label} count={count} tone={tone} selected={pressed} busy={busy} onClick={callback} icon={<Icon size={21} fill={pressed ? "currentColor" : "none"}/>}/>;
  return <article className="shorts-item" aria-label={video.caption || video.title}>
    {active && <video ref={element} playsInline loop muted={muted} preload="auto" poster={video.thumbnailUrl ? asset(video.thumbnailUrl) : undefined}
      onClick={() => setPaused(value => !value)} onWaiting={() => setBuffering(true)} onPlaying={() => { setBuffering(false); setPlayError(""); }}
      onCanPlay={() => setBuffering(false)} onError={() => {
        const message = element.current?.error?.message || "";
        setPlayError(/DECODER_ERROR_NOT_SUPPORTED|UnsupportedConfig/i.test(message)
          ? "This browser cannot decode this video. Try opening Zinda Play in Chrome, Edge or Safari."
          : "Could not load this Simply video. Check the video CDN permissions, then retry.");
      }}
      onTimeUpdate={timeUpdate} onSeeked={() => { lastPosition.current = element.current.currentTime; }}/>}
    <div className="shorts-gradient"/>
    {active && paused && !modal && !playError && <button className="shorts-resume" aria-label="Resume video" onClick={() => setPaused(false)}><Play size={30} fill="currentColor"/></button>}
    {active && buffering && !playError && !paused && <div className="shorts-loading" role="status">Loading video...</div>}
    {active && playError && <div className="shorts-play-error" role="alert"><p>{playError}</p><button className="primary-btn" onClick={() => setRetry(value => value + 1)}>Retry playback</button></div>}
    <div className="shorts-actions" role="group" aria-label="Simply actions">
      {button("Like", Heart, () => action(async () => {
        const data = await request(api, token, `/videos/${video.id}/like`, { method: "POST" });
        setState(current => ({ ...current, ...data }));
      }), state.liked, "like", state.likeCount)}
      {button("Comments", MessageCircle, () => { setError(""); setModal("comments"); }, undefined, "comments", state.commentCount ?? state.comments.length)}
      {button("Share", Send, () => onShare ? onShare(video) : action(async () => {
        const result = await shareLink(video.title, videoShareUrl(video.id));
        if (result === "copied") setError("Share link copied.");
      }, false))}
      {button(state.saved ? "Saved" : "Save", Bookmark, () => action(async () => {
        const data = await request(api, token, `${url}/saved`, { method: state.saved ? "DELETE" : "PUT", body: state.saved ? undefined : "{}" });
        setState(current => ({ ...current, saved: data.saved }));
      }), Boolean(state.saved), "save")}
      {button("Report", Flag, () => action(async () => setModal("report")))}
    </div>
    <div className="shorts-caption">
      <div className="shorts-creator">
        <button type="button" className="shorts-creator-link" disabled={!creator || !onCreator} onClick={() => onCreator(creator)} aria-label={creator ? `View @${creator.username}'s profile` : undefined}>
          {creator?.profilePhotoUrl ? <img src={asset(creator.profilePhotoUrl)} alt=""/> : <UserRound size={28}/>}
          <strong>@{creator?.username || "zindaplay"}</strong>
        </button>
        {creator && !state.isSelf && <button disabled={busy} aria-pressed={Boolean(state.following)} onClick={() => action(async () => {
          const data = await request(api, token, `/creators/${creator.id}/follow`, { method: state.following ? "DELETE" : "POST" });
          setState(current => ({ ...current, following: data.following }));
        })}>{state.following ? <Check size={15}/> : <UserPlus size={15}/>} {state.following ? "Following" : "Follow"}</button>}
      </div>
      <p>{video.caption || video.description || video.title}</p>
      <p className="shorts-tags">{(video.hashtags || []).map(tag => `#${tag}`).join(" ")}</p>
      <small>{Number(views).toLocaleString()} views</small>
      {error && <p className="shorts-feedback" role="status">{error}</p>}
    </div>
    <div className="shorts-controls">
      <button aria-label={paused ? "Play" : "Pause"} onClick={() => setPaused(value => !value)}>{paused ? <Play/> : <Pause/>}</button>
      <input aria-label="Video progress" type="range" min="0" max="1" step="0.001" value={progress} onChange={event => {
        const media = element.current;
        if (media && Number.isFinite(media.duration)) { media.currentTime = Number(event.target.value) * media.duration; lastPosition.current = media.currentTime; }
      }}/>
      <button aria-label={muted ? "Unmute" : "Mute"} onClick={onMute}>{muted ? <VolumeX/> : <Volume2/>}</button>
    </div>
    {modal && active && <div className="shorts-modal" role="dialog" aria-modal="true" aria-label={modal === "comments" ? "Comments" : "Report Simply video"}
      onKeyDown={event => {
        if (event.key === "Escape" && !busy) setModal("");
        if (event.key !== "Tab") return;
        const controls = [...event.currentTarget.querySelectorAll("button:not(:disabled), textarea:not(:disabled)")];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
      }}>
      <div className="shorts-modal-heading"><h2>{modal === "comments" ? `Comments (${state.commentCount ?? state.comments.length})` : "Report Simply video"}</h2><button autoFocus disabled={busy} aria-label="Close dialog" onClick={() => setModal("")}><X/></button></div>
      {modal === "comments" ? <>
        <div className="shorts-comments">{state.comments.length ? state.comments.map((item, i) => <div key={item.id || i}><strong>{item.username}</strong><p>{item.text}</p></div>) : <CommentsEmptyState/>}</div>
        {!token ? <div className="comments-signin"><UserRound size={22}/><span>Sign in to like, comment or follow creators.</span><button type="button" onClick={onSignIn}>Sign In</button></div> : <form onSubmit={event => { event.preventDefault(); action(async () => {
          const data = await request(api, token, `/videos/${video.id}/comments`, { method: "POST", body: JSON.stringify({ text: comment.trim() }) });
          setState(current => ({ ...current, commentCount: (current.commentCount ?? current.comments.length) + 1, comments: [data, ...current.comments] })); setComment("");
        }); }}>
          <label>Add a comment<textarea maxLength={500} value={comment} disabled={busy} onChange={event => setComment(event.target.value)}/></label>
          <button className="primary-btn" disabled={busy || !comment.trim()}>Post comment</button>
        </form>}
      </> : <div className="shorts-report-reasons">{["spam", "harassment", "inappropriate", "copyright", "other"].map(reason => <button className="secondary-btn" key={reason} disabled={busy} onClick={() => action(async () => {
        await request(api, token, `${url}/report`, { method: "POST", body: JSON.stringify({ reason }) }); setModal(""); setError("Report submitted for admin review.");
      })}>{reason}</button>)}</div>}
      {error && <p role="alert">{error}</p>}
    </div>}
  </article>;
}
