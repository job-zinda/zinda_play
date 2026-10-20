export const playbackSpeeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export const isDirectPlayback = source => /\.(mp4|webm|ogv|ogg|m3u8)(?:$|[?#])/i.test(source);

export function normalPlaybackUrl(source) {
  if (!/^https:\/\/(?:iframe|player)\.mediadelivery\.net\/embed\//i.test(source)) return source;
  const url = new URL(source);
  url.searchParams.set("preload", "true");
  url.searchParams.set("showSpeed", "true");
  url.searchParams.set("levelCap", "true");
  return url.toString();
}

export const hlsPlaybackConfig = {
  startLevel: 0,
  capLevelToPlayerSize: true,
  maxBufferLength: 20,
  maxMaxBufferLength: 40,
  backBufferLength: 10
};
