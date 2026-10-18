import { useEffect, useRef, useState } from "react";

export default function VideoPreview({ video }) {
  const host = useRef(null);
  const media = useRef(null);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const source = video.streamUrl || video.playbackUrl || "";
  const embed = /^https:\/\/iframe\.mediadelivery\.net\/embed\//i.test(source);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting && entry.intersectionRatio >= 0.5);
    }, { threshold: [0, 0.5] });
    observer.observe(host.current);
    const visibility = () => {
      if (document.hidden) setVisible(false);
      else {
        observer.unobserve(host.current);
        observer.observe(host.current);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => {
    if (!visible || !source || embed) return undefined;
    const element = media.current;
    let hls;
    let cancelled = false;
    setError("");
    const fail = message => {
      if (!cancelled) setError(message);
    };
    const play = () => {
      element.muted = true;
      element.play().catch(failure => {
        if (failure.name !== "AbortError") fail("Preview unavailable. Tap to watch.");
      });
    };
    element.addEventListener("canplay", play);
    (async () => {
      try {
        if (/\.m3u8(?:$|[?#])/i.test(source) && !element.canPlayType("application/vnd.apple.mpegurl")) {
          const { default: Hls } = await import("hls.js/dist/hls.light.mjs");
          if (cancelled) return;
          if (!Hls.isSupported()) throw new Error("HLS unsupported");
          hls = new Hls({ maxBufferLength: 5, maxMaxBufferLength: 10, backBufferLength: 0 });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              hls.stopLoad();
              fail("Preview unavailable. Tap to watch.");
            }
          });
          hls.loadSource(source);
          hls.attachMedia(element);
        } else element.src = source;
      } catch {
        fail("Preview unavailable. Tap to watch.");
      }
    })();
    return () => {
      cancelled = true;
      element.removeEventListener("canplay", play);
      element.pause();
      hls?.destroy();
      element.removeAttribute("src");
      element.load();
    };
  }, [visible, source, embed]);

  let embedUrl = source;
  if (embed) {
    const url = new URL(source);
    for (const key of ["autoplay", "muted", "loop"]) url.searchParams.set(key, "true");
    url.searchParams.set("controls", "false");
    embedUrl = url.toString();
  }
  return <span ref={host} className="thumbnail-preview-media" aria-hidden="true">
    {visible && source && (embed
      ? <iframe src={embedUrl} title="Muted video preview" allow="autoplay" tabIndex={-1}/>
      : <video ref={media} muted loop playsInline preload="none" onError={() => setError("Preview unavailable. Tap to watch.")}/>)}
    {(error || !source) && <span className="preview-message">{error || "Preview unavailable. Tap to watch."}</span>}
  </span>;
}
