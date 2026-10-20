import test from "node:test";
import assert from "node:assert/strict";
import { normalPlaybackUrl, playbackSpeeds, hlsPlaybackConfig, isDirectPlayback } from "./playback.js";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("normal Bunny player enables speed and caps resolution without losing signed parameters", () => {
  const url = new URL(normalPlaybackUrl("https://iframe.mediadelivery.net/embed/1/video?token=test&expires=123&showSpeed=false&levelCap=false"));
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    token: "test", expires: "123", showSpeed: "true", levelCap: "true", preload: "true"
  });
  assert.equal(normalPlaybackUrl("https://example.test/player?foo=1"), "https://example.test/player?foo=1");
  assert.equal(isDirectPlayback("https://example.test/video.M3U8?token=x"), true);
  assert.equal(hlsPlaybackConfig.startLevel, 0);
  assert.equal(hlsPlaybackConfig.capLevelToPlayerSize, true);
});

const source = await readFile(new URL("./WatchPlayer.jsx", import.meta.url), "utf8");
const { code } = await transform(source.replace(/^import .*;\r?$/gm, "").replace("export default function", "function"), {
  loader: "jsx", jsxFactory: "jsx"
});

function mount(url) {
  const effects = [];
  const video = { playbackRate: 1, load() {}, pause() {}, removeAttribute() {} };
  const WatchPlayer = vm.runInNewContext(`${code}\nWatchPlayer`, {
    jsx: React.createElement, normalPlaybackUrl, playbackSpeeds, hlsPlaybackConfig, isDirectPlayback,
    useRef: () => ({ current: video }), useState: initial => [initial, () => {}],
    useEffect: effect => effects.push(effect)
  });
  return { tree: WatchPlayer({ source: url, title: "Test video" }), video, effects };
}

test("Bunny videos keep embedded player controls including speed", () => {
  const { tree } = mount("https://iframe.mediadelivery.net/embed/1/video");
  const html = renderToStaticMarkup(tree);
  assert.match(html, /showSpeed=true/);
  assert.match(html, /levelCap=true/);
  assert.match(html, /allowfullscreen/);
});

test("direct video speed selector sets the media playback rate for every offered speed", () => {
  const { tree, video, effects } = mount("https://example.test/video.mp4");
  const cleanup = effects[0]();
  assert.equal(video.src, "https://example.test/video.mp4");
  const label = tree.props.children[1];
  const select = label.props.children[1];
  for (const speed of playbackSpeeds) {
    select.props.onChange({ target: { value: String(speed) } });
    assert.equal(video.playbackRate, speed);
  }
  const html = renderToStaticMarkup(tree);
  assert.match(html, /aria-label="Playback speed"/);
  assert.equal((html.match(/<option /g) || []).length, 7);
  cleanup();
});
