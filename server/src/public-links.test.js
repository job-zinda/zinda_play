import test from "node:test";
import assert from "node:assert/strict";
import { publicWebOrigin, videoLandingUrl, videoPreviewHtml, videoPreviewImage } from "./public-links.js";

test("public share origin defaults to the custom domain, not the CORS origin list", () => {
  assert.equal(publicWebOrigin(), "https://zindaplay.com");
  assert.equal(publicWebOrigin("https://zindaplay.com/"), "https://zindaplay.com");
  assert.equal(publicWebOrigin("http://localhost:5173"), "http://localhost:5173");
  for (const origin of ["https://example.com/path", "javascript:alert(1)", "https://a.com,https://b.com", "https://u:p@example.com", "https://example.com/?ref=a"]) {
    assert.throws(() => publicWebOrigin(origin));
  }
});

test("regular and Simply previews land on the correct canonical player", () => {
  const origin = publicWebOrigin();
  assert.equal(videoLandingUrl({ _id: "regular-id" }, origin), "https://zindaplay.com/?video=regular-id");
  assert.equal(videoLandingUrl({ _id: "short-id", videoType: "short" }, origin), "https://zindaplay.com/?short=short-id");
  const encoded = new URL(videoLandingUrl({ _id: "id&ref=not-a-referral" }, origin));
  assert.equal(encoded.searchParams.get("video"), "id&ref=not-a-referral");
  assert.equal(encoded.searchParams.has("ref"), false);
});

const previewConfig = {
  website: "https://zindaplay.com",
  apiOrigin: "https://zinda-play.onrender.com",
  cdnOrigin: "https://example.b-cdn.net"
};

test("uploaded thumbnail remains the fallback when no generated video frame is available", () => {
  assert.equal(videoPreviewImage({
    thumbnailImageId: "image-id", thumbnailUrl: "https://images.example/other.jpg"
  }, previewConfig.apiOrigin, previewConfig.cdnOrigin),
  "https://zinda-play.onrender.com/api/videos/thumbnail/image-id");
  assert.equal(videoPreviewImage({
    thumbnailImageId: "image-id", bunnyVideoId: "bunny-id"
  }, previewConfig.apiOrigin), "https://zinda-play.onrender.com/api/videos/thumbnail/image-id");
});

test("external and relative thumbnail URLs are included in social previews", () => {
  for (const [path, expected] of [
    ["https://images.example/photo.jpg?size=large", "https://images.example/photo.jpg?size=large"],
    ["/videos/thumbnail/id", "https://zinda-play.onrender.com/api/videos/thumbnail/id"],
    ["/api/videos/thumbnail/id", "https://zinda-play.onrender.com/api/videos/thumbnail/id"]
  ]) {
    assert.equal(videoPreviewImage({ thumbnailUrl: path }, previewConfig.apiOrigin), expected);
  }
  assert.throws(() => videoPreviewImage({ thumbnailUrl: "javascript:alert(1)" }, previewConfig.apiOrigin), /HTTP/);
});

test("Bunny regular and Simply shares use the same video frame with or without a banner", () => {
  for (const videoType of ["regular", "short"]) {
    for (const banner of [
      {},
      { thumbnailImageId: "image-id" },
      { thumbnailUrl: "https://images.example/banner.jpg" },
      { thumbnailImageId: "image-id", thumbnailUrl: "/videos/thumbnail/image-id" }
    ]) {
      const video = { _id: "video-id", bunnyVideoId: "bunny-id", videoType, ...banner };
      assert.equal(videoPreviewImage(video, previewConfig.apiOrigin, previewConfig.cdnOrigin),
        "https://example.b-cdn.net/bunny-id/thumbnail.jpg");
      const html = videoPreviewHtml(video, previewConfig);
      assert.match(html, /property="og:image" content="https:\/\/example.b-cdn.net\/bunny-id\/thumbnail.jpg"/);
      assert.match(html, /name="twitter:image" content="https:\/\/example.b-cdn.net\/bunny-id\/thumbnail.jpg"/);
      assert.match(html, /name="twitter:card" content="summary_large_image"/);
      assert.ok(html.includes(`location.replace("https://zindaplay.com/?${videoType === "short" ? "short" : "video"}=video-id")`));
      assert.ok(!html.includes("images.example/banner.jpg"));
      assert.ok(!html.includes("/api/videos/thumbnail/"));
    }
  }
  assert.equal(videoPreviewImage({}, previewConfig.apiOrigin), "");
});

test("preview metadata stays on the share URL while clicks open the correct player", () => {
  for (const videoType of ["regular", "short"]) {
    const html = videoPreviewHtml({ _id: "video-id", title: "My video", bunnyVideoId: "bunny-id", videoType }, previewConfig);
    assert.match(html, /property="og:image" content="https:\/\/example.b-cdn.net\/bunny-id\/thumbnail.jpg"/);
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
    assert.match(html, /property="og:url" content="https:\/\/zindaplay.com\/share\/video\/video-id\?preview=video-frame-v2"/);
    assert.match(html, /rel="canonical" href="https:\/\/zindaplay.com\/share\/video\/video-id\?preview=video-frame-v2"/);
    assert.ok(html.includes(`location.replace("https://zindaplay.com/?${videoType === "short" ? "short" : "video"}=video-id")`));
    assert.ok(!html.includes('http-equiv="refresh"'));
    assert.ok(!html.includes("app-icon"));
  }
});

test("preview text and URLs are escaped, with no fabricated image for imageless videos", () => {
  const html = videoPreviewHtml({
    _id: "</script>", title: 'Video <script> & "title"', caption: "Simply caption",
    thumbnailUrl: "https://images.example/photo.jpg?a=1&b=2"
  }, previewConfig);
  assert.match(html, /Video &lt;script&gt; &amp; &quot;title&quot;/);
  assert.match(html, /content="Simply caption"/);
  assert.match(html, /photo.jpg\?a=1&amp;b=2/);
  assert.ok(!html.includes('Video <script>'));
  const noImage = videoPreviewHtml({ _id: "no-image" }, previewConfig);
  assert.ok(!noImage.includes('property="og:image"'));
  assert.match(noImage, /name="twitter:card" content="summary"/);
});

test("video previews name the creator and creator previews use their profile photo", async () => {
  const { creatorPreviewHtml } = await import("./public-links.js");
  const video = videoPreviewHtml({ _id: "v1", title: "Clip", description: "Fun", thumbnailImageId: "img" }, { ...previewConfig, creatorName: "Asha <3" });
  assert.match(video, /content="By Asha &lt;3 \u00b7 Fun"/);
  assert.match(video, /og:image" content="https:\/\/zinda-play.onrender.com\/api\/videos\/thumbnail\/img"/);
  const creator = creatorPreviewHtml({ _id: "c1", username: "asha", displayName: "Asha", profilePhotoImageId: "p" }, previewConfig);
  assert.match(creator, /og:image" content="https:\/\/zinda-play.onrender.com\/api\/creators\/c1\/profile-photo"/);
  assert.match(creator, /og:url" content="https:\/\/zindaplay.com\/share\/creator\/c1"/);
  assert.ok(creator.includes('location.replace("https://zindaplay.com/?creator=c1")'));
  assert.ok(!creatorPreviewHtml({ _id: "c2", username: "x" }, previewConfig).includes("og:image"));
});

test("Android share pages open the installed app by package, falling back to the website", async () => {
  const vm = await import("node:vm");
  const { creatorPreviewHtml, referralJoinHtml } = await import("./public-links.js");
  const pages = [
    [videoPreviewHtml({ _id: "</script>", title: "x" }, previewConfig), "/share/video/%3C%2Fscript%3E?preview=video-frame-v2", "https://zindaplay.com/?video=%3C%2Fscript%3E"],
    [creatorPreviewHtml({ _id: "c1", username: "asha" }, previewConfig), "/share/creator/c1", "https://zindaplay.com/?creator=c1"],
    [referralJoinHtml("123456", previewConfig), "/join/123456", "https://zindaplay.com/?ref=123456"]
  ];
  for (const [html, path, target] of pages) {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
    assert.equal(scripts.length, 1);
    const intent = `intent://zindaplay.com${path}#Intent;scheme=zindaplay;package=com.zindaplay.zinda_play;S.browser_fallback_url=${encodeURIComponent(target)};end`;
    assert.ok(html.includes(intent.replace(/&/g, "&amp;")), html);
    function run(userAgent, leaves) {
      const timers = [], listeners = {}, openApp = { hidden: true };
      const location = { replaced: null, href: "", replace(url) { this.replaced = url; } };
      const document = {
        hidden: false, getElementById: id => id === "open-app" ? openApp : null,
        addEventListener: (type, listener) => { listeners[type] = listener; }
      };
      vm.runInNewContext(scripts[0], { navigator: { userAgent }, document, location, setTimeout: fn => timers.push(fn) });
      if (leaves) { document.hidden = true; listeners.visibilitychange(); }
      timers.forEach(fn => fn());
      return { location, openApp };
    }
    const desktop = run("Mozilla/5.0 (Windows NT 10.0)");
    assert.equal(desktop.location.replaced, target);
    assert.equal(desktop.location.href, "");
    const appOpened = run("Mozilla/5.0 (Linux; Android 14)", true);
    assert.equal(appOpened.location.href, intent);
    assert.equal(appOpened.location.replaced, null);
    assert.equal(appOpened.openApp.hidden, false);
    const blocked = run("Mozilla/5.0 (Linux; Android 14)", false);
    assert.equal(blocked.location.replaced, target);
  }
});

test("referral join pages accept only real invitation codes", async () => {
  const { isReferralCode, referralJoinHtml } = await import("./public-links.js");
  for (const code of ["123456", "900001"]) assert.ok(isReferralCode(code));
  for (const code of ["012345", "12345", "1234567", "12a456", "", undefined]) assert.equal(isReferralCode(code), false);
  const html = referralJoinHtml("123456", previewConfig);
  assert.match(html, /rel="canonical" href="https:\/\/zindaplay.com\/join\/123456"/);
  assert.match(html, /property="og:title" content="Join me on Zinda Play"/);
});
