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

test("uploaded thumbnail wins over thumbnail URLs and Bunny, using the public HTTPS API", () => {
  assert.equal(videoPreviewImage({
    thumbnailImageId: "image-id", thumbnailUrl: "https://images.example/other.jpg", bunnyVideoId: "bunny-id"
  }, previewConfig.apiOrigin, previewConfig.cdnOrigin),
  "https://zinda-play.onrender.com/api/videos/thumbnail/image-id");
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

test("Bunny regular and Simply uploads get a generated thumbnail when no custom image exists", () => {
  for (const videoType of ["regular", "short"]) {
    assert.equal(videoPreviewImage({ bunnyVideoId: "bunny-id", videoType }, previewConfig.apiOrigin, previewConfig.cdnOrigin),
      "https://example.b-cdn.net/bunny-id/thumbnail.jpg");
  }
  assert.equal(videoPreviewImage({}, previewConfig.apiOrigin), "");
});

test("preview metadata stays on the share URL while clicks open the correct player", () => {
  for (const videoType of ["regular", "short"]) {
    const html = videoPreviewHtml({ _id: "video-id", title: "My video", bunnyVideoId: "bunny-id", videoType }, previewConfig);
    assert.match(html, /property="og:image" content="https:\/\/example.b-cdn.net\/bunny-id\/thumbnail.jpg"/);
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
    assert.match(html, /property="og:url" content="https:\/\/zindaplay.com\/share\/video\/video-id"/);
    assert.match(html, /rel="canonical" href="https:\/\/zindaplay.com\/share\/video\/video-id"/);
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
