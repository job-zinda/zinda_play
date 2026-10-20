import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const source = await readFile(new URL("./WatchEngagement.jsx", import.meta.url), "utf8");
const { code } = await transform(source.replace(/^import .*;\r?$/gm, "").replace(/\bexport /g, ""), {
  loader: "jsx", jsxFactory: "jsx"
});
const { Action, CommentsEmptyState } = vm.runInNewContext(`${code}\n({ Action, CommentsEmptyState })`, {
  jsx: React.createElement
});

test("Simply action exposes accurate count and selected state with a compact layout", () => {
  const html = renderToStaticMarkup(React.createElement(Action, {
    label: "Like", count: 1234, selected: true, compact: true, tone: "like",
    icon: React.createElement("svg")
  }));
  assert.match(html, /engage-like selected/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /aria-label="Like, 1234"/);
  assert.match(html, /<strong>1,234<\/strong>/);
});

test("compact save action has no phantom count and exposes saved state", () => {
  for (const saved of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(Action, {
      label: saved ? "Saved" : "Save", selected: saved, compact: true, tone: "save"
    }));
    assert.ok(html.includes(`aria-pressed="${saved}"`));
    assert.ok(!html.includes("<strong>"));
    assert.ok(html.includes(saved ? "Saved" : "Save"));
  }
});

test("normal video bar keeps its count placeholder alignment", () => {
  const html = renderToStaticMarkup(React.createElement(Action, { label: "Share" }));
  assert.match(html, /<strong>/);
});

test("shared comments empty state renders its illustration and message", () => {
  const html = renderToStaticMarkup(React.createElement(CommentsEmptyState));
  assert.match(html, /<svg/);
  assert.match(html, /No comments yet/);
  assert.match(html, /Be the first to share your thoughts!/);
});
