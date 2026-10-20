import { useEffect, useRef, useState } from "react";
import { hlsPlaybackConfig, isDirectPlayback, normalPlaybackUrl, playbackSpeeds } from "./playback.js";

export default function WatchPlayer({ source, title }) {
  const media = useRef(null);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState("");
  const direct = isDirectPlayback(source);

  useEffect(() => {
    if (!direct) return;
    const video = media.current;
    let hls;
    let cancelled = false;
    setError("");
    setSpeed(1);
    video.playbackRate = 1;
    (async () => {
      try {
        if (/\.m3u8(?:$|[?#])/i.test(source) && !video.canPlayType("application/vnd.apple.mpegurl")) {
          const { default: Hls } = await import("hls.js/dist/hls.light.mjs");
          if (cancelled) return;
          if (!Hls.isSupported()) throw new Error("This browser cannot play this video.");
          hls = new Hls(hlsPlaybackConfig);
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!cancelled && data.fatal) {
              hls.stopLoad();
              setError("The video could not load. Check your connection and reopen it.");
            }
          });
          hls.loadSource(source);
          hls.attachMedia(video);
        } else {
          video.src = source;
          video.load();
        }
      } catch (failure) {
        if (!cancelled) setError(failure.message);
      }
    })();
    return () => {
      cancelled = true;
      video.pause();
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [source, direct]);

  if (!direct) return <iframe src={normalPlaybackUrl(source)} title={title}
    allow="autoplay; encrypted-media; fullscreen" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen/>;

  return <div className="normal-video-player">
    <video ref={media} title={title} controls preload="auto"
      controlsList="nodownload noremoteplayback" disablePictureInPicture disableRemotePlayback playsInline
      onRateChange={event => setSpeed(event.currentTarget.playbackRate)}
      onError={() => setError("The video could not load. Check your connection and reopen it.")}/>
    <label className="playback-speed">Speed <select aria-label="Playback speed" value={speed}
      onChange={event => {
        const next = Number(event.target.value);
        media.current.playbackRate = next;
        setSpeed(next);
      }}>{playbackSpeeds.map(value => <option key={value} value={value}>{value === 1 ? "Normal (1x)" : `${value}x`}</option>)}</select></label>
    {error && <p className="playback-error" role="alert">{error}</p>}
  </div>;
}
