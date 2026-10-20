const website = "https://zindaplay.com";
export const whatsAppHelpUrl = "https://wa.me/919847561998?text=Zindaplay";

export function isReferralCode(code) {
  return typeof code === "string" && /^[1-9]\d{5}$/.test(code);
}

export function videoShareUrl(id) {
  return `${website}/share/video/${encodeURIComponent(id)}?preview=video-frame-v2`;
}

export function creatorShareUrl(id) {
  return `${website}/share/creator/${encodeURIComponent(id)}`;
}

export function referralUrl(code) {
  if (!code) throw new Error("Your referral link is not available yet. Please refresh and retry.");
  return `${website}/join/${encodeURIComponent(code)}`;
}

export async function shareLink(title, url) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text: title, url });
      return "shared";
    } catch (error) {
      if (error.name === "AbortError") return "cancelled";
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      return "copied";
    } catch {
      // Some embedded browsers expose the clipboard API but deny access.
    }
  }
  window.prompt("Copy this link:", url);
  return "prompted";
}
