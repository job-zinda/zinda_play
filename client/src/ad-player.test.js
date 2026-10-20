import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hlsPlaybackConfig } from "./playback.js";

const source = await readFile(new URL("./Ads.jsx", import.meta.url), "utf8");
const start = source.indexOf("export function PlayerGate(");
const end = source.indexOf("export function HomeVideoAd(");
const claim = source.slice(source.indexOf("async function claimAd("), source.indexOf("// Banner ad shown"));
const { code } = await transform(
  claim + source.slice(start, end).replace("export function", "function"),
  { loader: "jsx", jsxFactory: "jsx" }
);

function mount({ targetUrl = "", tracking = Promise.resolve({ ok: true, json: async () => ({}) }) } = {}) {
  const slots = [];
  const effects = [];
  const timers = new Map();
  const calls = [];
  const errors = [];
  let index = 0;
  let firstRef = true;
  let now = 0;
  const media = {
    paused: true, readyState: 0, currentTime: 0, ended: false, seeking: false,
    pause() { this.paused = true; },
    play: async () => {},
    load() {}, removeAttribute() {}
  };
  const PlayerGate = vm.runInNewContext(`${code}\nPlayerGate`, {
    jsx: React.createElement,
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], next => { slots[slot] = next; }];
    },
    useRef(initial) {
      const slot = index++;
      if (!(slot in slots)) {
        slots[slot] = { current: firstRef ? media : initial };
        firstRef = false;
      }
      return slots[slot];
    },
    useEffect(effect, dependencies) {
      const slot = index++;
      const previous = slots[slot];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        effects.push(() => {
          previous?.cleanup?.();
          slots[slot] = { dependencies, cleanup: effect() };
        });
      }
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/view")) return tracking;
      return {
        ok: true,
        json: async () => url.endsWith("/view-start")
          ? { ticket: "test-ticket", minimumWatchMs: 3000 }
          : url.endsWith("/impression") ? { accepted: true }
            : [{ id: "test-ad", creatorVideoId: "creator", mediaUrl: "https://example.test/ad.mp4", targetUrl }]
      };
    },
    adsUrl: () => "/api/ads",
    dueVideoAds: list => list,
    pickRandom: list => list[0],
    markAdDelivered() {},
    mediaSrc: (_api, url) => url,
    hlsPlaybackConfig,
    AbortController,
    Date: { now: () => now },
    window: {
      setInterval(callback) { const id = timers.size + 1; timers.set(id, callback); return id; },
      clearInterval(id) { timers.delete(id); }
    },
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    console: { error: (...args) => errors.push(args) },
    Play: () => null,
    ExternalLink: () => null
  });
  const render = () => {
    index = 0;
    const tree = PlayerGate({ api: "/api", children: "Main video" });
    effects.splice(0).forEach(effect => effect());
    return tree;
  };
  return {
    media, calls, errors, render,
    async load() {
      render();
      await new Promise(resolve => setImmediate(resolve));
      return render();
    },
    advance(seconds) {
      for (let step = 0; step < seconds; step++) {
        now += 1000;
        [...timers.values()].forEach(callback => callback());
      }
    },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); }
  };
}

test("ad stalled before first frame offers recovery even when media reports paused", async () => {
  const gate = mount();
  await gate.load();
  gate.advance(14);
  assert.doesNotMatch(renderToStaticMarkup(gate.render()), /Continue to video/);
  gate.advance(1);
  assert.match(renderToStaticMarkup(gate.render()), /Continue to video/);
  gate.dispose();
});

test("a paused, ready ad does not trigger the loading watchdog", async () => {
  const gate = mount();
  await gate.load();
  gate.media.readyState = 4;
  gate.advance(20);
  assert.doesNotMatch(renderToStaticMarkup(gate.render()), /Continue to video/);
  gate.dispose();
});

for (const targetUrl of ["", "https://example.test/advertiser"]) {
  test(`completed ad transitions without waiting for tracking, end card: ${!!targetUrl}`, async () => {
    let finishTracking;
    const tracking = new Promise(resolve => { finishTracking = resolve; });
    const gate = mount({ targetUrl, tracking });
    let tree = await gate.load();
    gate.media.paused = false;
    for (let step = 1; step <= 6; step++) {
      gate.media.currentTime = step / 2;
      tree.props.children[0].props.onTimeUpdate({ currentTarget: gate.media });
      tree = gate.render();
    }
    const complete = tree.props.children[0].props.onEnded;
    complete();
    complete();
    const html = renderToStaticMarkup(gate.render());
    assert.match(html, targetUrl ? /Ad finished/ : /Main video/);
    assert.equal(gate.calls.filter(call => call.url.endsWith("/view")).length, 1);
    gate.dispose();
    finishTracking({ ok: false, json: async () => ({ error: "Tracking unavailable" }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(gate.errors.length, 1);
  });
}
