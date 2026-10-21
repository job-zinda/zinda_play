import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";

const source = await readFile(new URL("./VideoPreview.jsx", import.meta.url), "utf8");
const { code } = await transform(source.replace(/^import .* from "react";/m, "")
  .replace("export default function", "function"), { loader: "jsx", jsxFactory: "jsx" });

function mountPreview(url, playError, { error = "", imageFailed = false } = {}) {
  const effects = [];
  const errors = [];
  let refs = 0;
  let states = 0;
  const events = new Map();
  const nodes = [];
  const video = {
    preload: "none", muted: false, plays: 0, pauses: 0, loads: 0,
    canPlayType: () => "maybe",
    addEventListener: (name, listener) => events.set(name, listener),
    removeEventListener: name => events.delete(name),
    play() {
      this.plays++;
      return playError ? Promise.reject(playError) : Promise.resolve();
    },
    pause() { this.pauses++; },
    load() { this.loads++; },
    removeAttribute(name) { delete this[name]; }
  };
  const context = {
    URL,
    jsx: (type, props) => { nodes.push({ type, props }); return null; },
    useRef: () => ({ current: refs++ === 0 ? {} : video }),
    useState: () => [[true, error, imageFailed][states++], message => errors.push(message)],
    useEffect: effect => effects.push(effect)
  };
  vm.runInNewContext(`${code}\nVideoPreview({ video: { streamUrl: ${JSON.stringify(url)} } });`, context);
  const cleanup = effects[2]();
  return { video, errors, events, cleanup, nodes };
}

for (const url of ["https://cdn.example/video/playlist.m3u8", "https://cdn.example/video.mp4"]) {
  test(`visible preview starts without waiting for canplay: ${url}`, async () => {
    const { video, cleanup, events } = mountPreview(url);
    assert.equal(video.src, url);
    assert.equal(video.muted, true);
    assert.equal(video.plays, 1, "preload=none must not deadlock waiting for canplay");
    cleanup();
    assert.equal(video.pauses, 1);
    assert.equal(video.src, undefined);
    assert.equal(video.loads, 1);
    assert.equal(events.has("canplay"), false);
    await Promise.resolve();
  });
}

test("blocked autoplay displays an explicit preview error", async () => {
  const { errors, cleanup } = mountPreview("https://cdn.example/video.mp4", { name: "NotAllowedError" });
  await Promise.resolve();
  assert.equal(errors.at(-1), "Preview unavailable. Tap to watch.");
  cleanup();
});

test("an aborted playback request during cleanup is not displayed as a failure", async () => {
  const { errors, cleanup } = mountPreview("https://cdn.example/video.mp4", { name: "AbortError" });
  cleanup();
  await Promise.resolve();
  assert.deepEqual(errors, [""]);
});

test("failed Bunny video decoding uses its animated preview instead of an error label", () => {
  const { video, nodes, cleanup } = mountPreview(
    "https://vz-example.b-cdn.net/video-id/playlist.m3u8",
    undefined,
    { error: "Preview unavailable. Tap to watch." },
  );
  const image = nodes.find(node => node.type === "img");
  assert.equal(image.props.src, "https://vz-example.b-cdn.net/video-id/preview.webp");
  assert.equal(video.plays, 0);
  assert.equal(cleanup, undefined);
  assert.equal(nodes.some(node => node.props.className === "preview-message"), false);
  assert.equal(nodes.some(node => node.type === "video"), false);
});

test("failed animated previews retain the explicit error without retrying in a loop", () => {
  const { video, nodes } = mountPreview(
    "https://vz-example.b-cdn.net/video-id/playlist.m3u8",
    undefined,
    { error: "Preview unavailable. Tap to watch.", imageFailed: true },
  );
  assert.equal(video.plays, 0);
  assert.equal(nodes.some(node => node.type === "img" || node.type === "video"), false);
  assert.ok(nodes.some(node => node.props.className === "preview-message"));
});

test("arbitrary media URLs do not get a guessed Bunny preview URL", () => {
  const { nodes, cleanup } = mountPreview(
    "https://cdn.example/video/playlist.m3u8",
    undefined,
    { error: "Preview unavailable. Tap to watch." },
  );
  assert.equal(nodes.some(node => node.type === "img"), false);
  cleanup();
});
