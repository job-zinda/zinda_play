import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { creatorShareUrl, isReferralCode, referralUrl, shareLink, videoShareUrl, whatsAppHelpUrl } from "./public-links.js";

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else delete globalThis.navigator;
  delete globalThis.window;
});
const navigatorWith = value => Object.defineProperty(globalThis, "navigator", { configurable: true, value });

test("all share and invitation links use the public domain, with encoded IDs", () => {
  assert.equal(videoShareUrl("video-id"), "https://zindaplay.com/share/video/video-id");
  assert.equal(creatorShareUrl("a b"), "https://zindaplay.com/share/creator/a%20b");
  assert.equal(videoShareUrl("id/?"), "https://zindaplay.com/share/video/id%2F%3F");
  assert.equal(referralUrl("123456"), "https://zindaplay.com/?ref=123456");
  assert.throws(() => referralUrl(undefined), /not available/);
});

test("invitation input accepts exactly six digits and rejects old long IDs", () => {
  for (const code of ["123456", "999999", "100000"]) assert.equal(isReferralCode(code), true);
  for (const code of ["0123456789abcdef01234567", "12345", "1234567", "abcdef", "", null, 123456]) {
    assert.equal(isReferralCode(code), false);
  }
});

test("Ask me uses the WhatsApp number and prefilled Zindaplay message", () => {
  const url = new URL(whatsAppHelpUrl);
  assert.equal(url.origin, "https://wa.me");
  assert.equal(url.pathname, "/919847561998");
  assert.equal(url.searchParams.get("text"), "Zindaplay");
});

test("native share receives a title and a non-empty canonical URL", async () => {
  let payload;
  navigatorWith({ share: async value => { payload = value; } });
  assert.equal(await shareLink("Watch me", videoShareUrl("id")), "shared");
  assert.deepEqual(payload, { title: "Watch me", text: "Watch me", url: "https://zindaplay.com/share/video/id" });
});

test("cancelling share does not copy a link unexpectedly", async () => {
  navigatorWith({
    share: async () => { throw Object.assign(new Error("Cancelled"), { name: "AbortError" }); },
    clipboard: { writeText: () => assert.fail("Cancelled share must not copy") }
  });
  assert.equal(await shareLink("Invite", referralUrl("code")), "cancelled");
});

test("denied or unsupported native sharing falls back to copying the invitation", async () => {
  for (const share of [undefined, async () => { throw new Error("Denied"); }]) {
    let copied;
    navigatorWith({ share, clipboard: { writeText: async value => { copied = value; } } });
    assert.equal(await shareLink("Invite", referralUrl("code")), "copied");
    assert.equal(copied, "https://zindaplay.com/?ref=code");
  }
});

test("a blocked clipboard presents the complete link for manual copying", async () => {
  let prompted;
  navigatorWith({ clipboard: { writeText: async () => { throw new Error("Denied"); } } });
  globalThis.window = { prompt: (_message, value) => { prompted = value; } };
  assert.equal(await shareLink("Watch", videoShareUrl("id")), "prompted");
  assert.equal(prompted, videoShareUrl("id"));
});

test("Vercel forwards the public preview route to the existing API, preserving the ID", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url)));
  assert.deepEqual(config.rewrites, [{
    source: "/share/video/:id",
    destination: "https://zinda-play.onrender.com/api/share/video/:id"
  }, {
    source: "/share/creator/:id",
    destination: "https://zinda-play.onrender.com/api/share/creator/:id"
  }]);
});
