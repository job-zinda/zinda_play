import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const code = (await readFile(new URL("./engagement-feedback.js", import.meta.url), "utf8")).replace(/\bexport /g, "");

test("success tones reuse one audio context and release oscillator connections", () => {
  let contexts = 0, resumes = 0, starts = 0, stops = 0, disconnected = 0;
  const volumes = [];
  class AudioContext {
    state = "suspended";
    currentTime = 1;
    constructor() { contexts++; }
    async resume() { resumes++; this.state = "running"; }
    createOscillator() {
      return {
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
        disconnect() { disconnected++; },
        start() { starts++; },
        stop() { stops++; this.onended(); }
      };
    }
    createGain() {
      return {
        gain: { setValueAtTime(value) { volumes.push(value); }, exponentialRampToValueAtTime() {} },
        connect() {}, disconnect() { disconnected++; }
      };
    }
  }
  const sound = vm.runInNewContext(`${code}\n({ prepareEngagementSound, playEngagementSound })`, { AudioContext });
  sound.playEngagementSound();
  assert.equal(starts, 0);
  sound.prepareEngagementSound();
  sound.playEngagementSound();
  sound.prepareEngagementSound();
  sound.playEngagementSound(true);
  assert.equal(contexts, 1);
  assert.equal(resumes, 1);
  assert.equal(starts, 2);
  assert.equal(stops, 2);
  assert.equal(disconnected, 4);
  assert.ok(volumes.every(value => value <= 0.04));
});

test("missing browser audio support does not block engagement", () => {
  const sound = vm.runInNewContext(`${code}\n({ prepareEngagementSound, playEngagementSound })`);
  assert.doesNotThrow(() => { sound.prepareEngagementSound(); sound.playEngagementSound(); });
});
