import assert from "node:assert/strict";
import { once } from "node:events";
import { Writable } from "node:stream";
import test from "node:test";
import express from "express";
import { ObjectId } from "mongodb";
import { memoryDatabase } from "../test-support/memory-database.js";
import { initializeBanners, registerBannerRoutes } from "./banners.js";

async function fixture(t, db = memoryDatabase()) {
  const deleted = [];
  const bucket = {
    openUploadStream() {
      const stream = new Writable({ write(_chunk, _encoding, done) { done(); } });
      stream.id = new ObjectId();
      return stream;
    },
    async delete(id) { deleted.push(id.toString()); }
  };
  const app = express();
  app.use((req, _res, next) => req.is("application/json") ? express.json()(req, _res, next) : next());
  registerBannerRoutes(app, {
    getDb: () => db, asyncRoute: handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next),
    requireAdmin: (req, res, next) => req.get("authorization") === "Bearer admin" ? next() : res.status(401).json({ error: "Admin authentication required" }),
    imageBucket: () => bucket, supportedImageTypes: new Map([["image/png", "png"]]), maxImageBytes: 1024
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (path, { method = "GET", body, admin = true, headers = {} } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, body: typeof body === "string" || body instanceof Uint8Array ? body : body && JSON.stringify(body),
      headers: { ...(body && !(body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}), ...(admin ? { Authorization: "Bearer admin" } : {}), ...headers }
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  return { db, deleted, request };
}

test("admins can add, edit, upload images for and delete multiple banners", async t => {
  const f = await fixture(t);
  assert.equal((await f.request("/admin/banners", { admin: false })).status, 401);
  assert.equal((await f.request("/admin/banners", { method: "POST", body: { enabled: true } })).status, 400);
  const first = (await f.request("/admin/banners", { method: "POST", body: { enabled: true, title: "First" } })).body;
  const second = (await f.request("/admin/banners", { method: "POST", body: { enabled: true, title: "Second", buttonLabel: "Go", buttonUrl: "https://example.com" } })).body;
  assert.equal((await f.request("/admin/banners")).body.length, 2);
  // Banners without images are not shown publicly.
  assert.deepEqual((await f.request("/banners", { admin: false })).body, []);
  const png = new Uint8Array([1, 2, 3]);
  for (const banner of [first, second]) {
    const uploaded = await f.request(`/admin/banners/${banner.id}/image`, { method: "PUT", body: png, headers: { "Content-Type": "image/png" } });
    assert.equal(uploaded.status, 201);
    assert.match(uploaded.body.imageUrl, /^\/banner\/image\/[a-f0-9]{24}$/);
  }
  const oldImage = (await f.request("/admin/banners")).body[0].imageUrl.split("/").pop();
  await f.request(`/admin/banners/${first.id}/image`, { method: "PUT", body: png, headers: { "Content-Type": "image/png" } });
  assert.ok(f.deleted.includes(oldImage));
  assert.deepEqual((await f.request("/banners", { admin: false })).body.map(b => b.title), ["First", "Second"]);
  const edited = await f.request(`/admin/banners/${second.id}`, { method: "PUT", body: { enabled: false, title: "Second edited" } });
  assert.equal(edited.body.title, "Second edited");
  assert.equal(edited.body.imageUrl.startsWith("/banner/image/"), true);
  assert.deepEqual((await f.request("/banners", { admin: false })).body.map(b => b.title), ["First"]);
  assert.equal((await f.request("/banner", { admin: false })).body.title, "First");
  assert.equal((await f.request(`/admin/banners/${first.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await f.request(`/admin/banners/${first.id}`, { method: "DELETE" })).status, 404);
  assert.equal((await f.request("/banner", { admin: false })).body, null);
  assert.equal((await f.request("/admin/banners")).body.length, 1);
  assert.equal((await f.request("/admin/banners/not-an-id", { method: "PUT", body: { title: "x" } })).status, 404);
});

test("the legacy single banner is migrated once", async () => {
  const db = memoryDatabase();
  await db.collection("siteContent").insertOne({ _id: "homepage-banner", enabled: true, title: "Old", imageId: "abc", updatedAt: "2026-01-01" });
  await initializeBanners(db);
  await initializeBanners(db);
  const banners = db.collection("homeBanners").documents;
  assert.equal(banners.length, 1);
  assert.equal(banners[0].title, "Old");
  assert.ok(banners[0]._id instanceof ObjectId);
});
