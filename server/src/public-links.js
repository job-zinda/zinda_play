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
  if (video.bunnyVideoId && cdnOrigin) {
    return new URL(`/${encodeURIComponent(video.bunnyVideoId)}/thumbnail.jpg`, cdnOrigin).href;
  }
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
  return "";
}

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);
const scriptJson = value => JSON.stringify(value).replace(/</g, "\\u003c");
export const androidPackage = "com.zindaplay.zinda_play";

// An intent:// URL names the app package, so Android opens the installed app even if App Links
// verification has not completed; without the app, Android browsers follow the website fallback.
export function appIntentUrl(sharePath, target) {
  return `intent://zindaplay.com${sharePath}#Intent;scheme=zindaplay;package=${androidPackage};` +
    `S.browser_fallback_url=${encodeURIComponent(target)};end`;
}

function openAppOrWebsite(sharePath, target, label) {
  const intent = appIntentUrl(sharePath, target);
  return `<p><a href="${escapeHtml(target)}">${label}</a></p>` +
    `<p id="open-app" hidden><a href="${escapeHtml(intent)}">Open in the Zinda Play app</a></p>` +
    `<script>(function(){if(!/Android/i.test(navigator.userAgent)){location.replace(${scriptJson(target)});return;}` +
    `document.getElementById("open-app").hidden=false;var left=false;` +
    `document.addEventListener("visibilitychange",function(){if(document.hidden)left=true;});` +
    `setTimeout(function(){if(!left)location.replace(${scriptJson(target)});},2500);` +
    `location.href=${scriptJson(intent)};})();</script>`;
}

const sharePathOf = url => { const parsed = new URL(url); return parsed.pathname + parsed.search; };

export function videoPreviewHtml(video, { website, apiOrigin, cdnOrigin, creatorName = "" }) {
  const target = videoLandingUrl(video, website);
  const shareUrl = new URL(`/share/video/${encodeURIComponent(video._id)}?preview=video-frame-v3`, website).href;
  const image = videoPreviewImage(video, apiOrigin, cdnOrigin);
  // Bunny Stream thumbnails are 1280x720 JPEGs; declaring the size lets WhatsApp show the large card.
  const imageDetails = image && cdnOrigin && video.bunnyVideoId
    ? `<meta property="og:image:secure_url" content="${escapeHtml(image)}"><meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="1280"><meta property="og:image:height" content="720">`
    : "";
  const title = String(video.title || "Zinda Play").slice(0, 120);
  const byline = creatorName ? `By ${String(creatorName).slice(0, 60)} · ` : "";
  const description = (byline + String(video.description || video.caption || "Watch this video on Zinda Play.")).slice(0, 200);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)} · Zinda Play</title>
<link rel="canonical" href="${escapeHtml(shareUrl)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Zinda Play"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(shareUrl)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">${imageDetails}<meta property="og:image:alt" content="${escapeHtml(title)}"><meta name="twitter:image" content="${escapeHtml(image)}"><meta name="twitter:image:alt" content="${escapeHtml(title)}">` : ""}
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}">
</head><body>${openAppOrWebsite(sharePathOf(shareUrl), target, `Watch “${escapeHtml(title)}” on Zinda Play`)}</body></html>`;
}

export function creatorLandingUrl(creatorId, origin) {
  const url = new URL("/", origin);
  url.searchParams.set("creator", creatorId);
  return url.href;
}

export function creatorPreviewHtml(creator, { website, apiOrigin }) {
  const id = String(creator._id);
  const target = creatorLandingUrl(id, website);
  const shareUrl = new URL(`/share/creator/${encodeURIComponent(id)}`, website).href;
  const name = String(creator.displayName || creator.username || "Zinda Play creator").slice(0, 80);
  const title = `${name} on Zinda Play`;
  const description = String(creator.bio || `Watch videos from ${name} and follow them on Zinda Play.`).slice(0, 200);
  const image = creator.profilePhotoImageId ? new URL(`/api/creators/${encodeURIComponent(id)}/profile-photo`, apiOrigin).href : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<link rel="canonical" href="${escapeHtml(shareUrl)}">
<meta property="og:type" content="profile"><meta property="og:site_name" content="Zinda Play"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(shareUrl)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}"><meta property="og:image:alt" content="${escapeHtml(name)}"><meta name="twitter:image" content="${escapeHtml(image)}">` : ""}
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}">
</head><body>${openAppOrWebsite(sharePathOf(shareUrl), target, `View ${escapeHtml(name)} on Zinda Play`)}</body></html>`;
}

export const isReferralCode = code => typeof code === "string" && /^[1-9]\d{5}$/.test(code);

export function referralJoinHtml(code, { website }) {
  const target = new URL("/", website);
  target.searchParams.set("ref", code);
  const shareUrl = new URL(`/join/${encodeURIComponent(code)}`, website).href;
  const title = "Join me on Zinda Play";
  const description = "Create your free Zinda Play account with my invitation.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<link rel="canonical" href="${escapeHtml(shareUrl)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Zinda Play"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${escapeHtml(shareUrl)}">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}">
</head><body>${openAppOrWebsite(sharePathOf(shareUrl), target.href, "Join Zinda Play")}</body></html>`;
}
