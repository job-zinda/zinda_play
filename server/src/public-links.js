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

export function videoPreviewImage(video, apiOrigin, cdnOrigin) {
  if (video.thumbnailImageId) {
    return new URL(`/api/videos/thumbnail/${encodeURIComponent(video.thumbnailImageId)}`, apiOrigin).href;
  }
  if (video.thumbnailUrl) {
    const path = String(video.thumbnailUrl);
    const image = new URL(path.startsWith("/api/") ? path : path.replace(/^\/?videos\//, "/api/videos/"), apiOrigin);
    if (!["https:", "http:"].includes(image.protocol) || image.username || image.password) {
      throw new Error("Video preview thumbnail must be a public HTTP(S) image URL.");
    }
    return image.href;
  }
  if (video.bunnyVideoId && cdnOrigin) {
    return new URL(`/${encodeURIComponent(video.bunnyVideoId)}/thumbnail.jpg`, cdnOrigin).href;
  }
  return "";
}

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

export function videoPreviewHtml(video, { website, apiOrigin, cdnOrigin }) {
  const target = videoLandingUrl(video, website);
  const shareUrl = new URL(`/share/video/${encodeURIComponent(video._id)}`, website).href;
  const image = videoPreviewImage(video, apiOrigin, cdnOrigin);
  const title = String(video.title || "Zinda Play").slice(0, 120);
  const description = String(video.description || video.caption || "Watch this video on Zinda Play.").slice(0, 200);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)} · Zinda Play</title>
<link rel="canonical" href="${escapeHtml(shareUrl)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Zinda Play"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(shareUrl)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}"><meta property="og:image:alt" content="${escapeHtml(title)}"><meta name="twitter:image" content="${escapeHtml(image)}"><meta name="twitter:image:alt" content="${escapeHtml(title)}">` : ""}
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}">
</head><body><p><a href="${escapeHtml(target)}">Watch “${escapeHtml(title)}” on Zinda Play</a></p><script>location.replace(${JSON.stringify(target).replace(/</g, "\\u003c")});</script></body></html>`;
}
