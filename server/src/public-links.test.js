import test from "node:test";
import assert from "node:assert/strict";
import { publicWebOrigin, videoLandingUrl } from "./public-links.js";

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
