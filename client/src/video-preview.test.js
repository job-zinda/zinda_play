import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";

const source = await readFile(new URL("./VideoPreview.jsx", import.meta.url), "utf8");
const { code } = await transform(source.replace(/^import .* from "react";/m, "")
  .replace("export default function", "function"), { loader: "jsx", jsxFactory: "jsx" });

function mountPreview(url, playError) {
  const effects = [];
  const errors = [];
  let refs = 0;
  let states = 0;
  const events = new Map();
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
    jsx: () => null,
    useRef: () => ({ current: refs++ === 0 ? {} : video }),
    useState: () => [states++ === 0 ? true : "", message => errors.push(message)],
    useEffect: effect => effects.push(effect)
  };
  vm.runInNewContext(`${code}\nVideoPreview({ video: { streamUrl: ${JSON.stringify(url)} } });`, context);
  const cleanup = effects[1]();
  return { video, errors, events, cleanup };
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
