export function publicWebOrigin(value = "https://zindaplay.com") {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PUBLIC_WEB_URL must be an HTTP(S) website origin, without a path, credentials or query.");
  }
  return url.origin;
}

export function videoLandingUrl(video, origin) {
  const url = new URL("/", origin);
  url.searchParams.set(video.videoType === "short" ? "short" : "video", video._id);
  return url.href;
}
