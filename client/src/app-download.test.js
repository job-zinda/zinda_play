import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const file = path => new URL(path, import.meta.url);

test("website exposes the Android download page in the header and menu", async () => {
  const app = await readFile(file("./App.jsx"), "utf8");
  assert.match(app, /className="app-download-link" href="\/download-app\.html"/);
  assert.match(app, /className="drawer-download-link" href="\/download-app\.html"/);
  const page = await readFile(file("../public/download-app.html"), "utf8");
  assert.match(page, /href="\/downloads\/zinda-play\.apk" download="zinda-play\.apk"/);
  assert.match(page, /Install unknown apps/);
  assert.match(page, /Android requires you to approve installation/);
  assert.match(page, /cannot be installed on iPhone or iPad/);
});

test("public APK is a real release archive with a matching SHA-256 checksum", async () => {
  const apk = await readFile(file("../public/downloads/zinda-play.apk"));
  assert.ok(apk.length > 1024 * 1024, "APK must not be a placeholder");
  assert.ok(apk.length < 100 * 1024 * 1024, "APK must fit repository-hosted deployment limits");
  assert.equal(apk.readUInt32LE(0), 0x04034b50);
  const checksum = await readFile(file("../public/downloads/zinda-play.apk.sha256"), "utf8");
  assert.equal(checksum.trim(), `${createHash("sha256").update(apk).digest("hex")}  zinda-play.apk`);
});

test("Vercel serves the APK as a download without stale long-lived caching", async () => {
  const config = JSON.parse(await readFile(file("../vercel.json"), "utf8"));
  const headers = config.headers.find(rule => rule.source === "/downloads/zinda-play.apk").headers;
  const get = key => headers.find(header => header.key === key)?.value;
  assert.equal(get("Content-Type"), "application/vnd.android.package-archive");
  assert.equal(get("Content-Disposition"), 'attachment; filename="zinda-play.apk"');
  assert.equal(get("Cache-Control"), "public, max-age=0, must-revalidate");
  assert.deepEqual(config.rewrites.map(rule => rule.source), ["/share/video/:id", "/share/creator/:id", "/join/:code"], "Share and invitation rewrites are preserved");
});
