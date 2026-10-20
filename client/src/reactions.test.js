import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transform } from "esbuild";

const source = await readFile(new URL("./Reactions.jsx", import.meta.url), "utf8");
const { code } = await transform(source.replace(/^import .*;\r?$/gm, "").replace(/\bexport /g, ""), { loader: "jsx", jsxFactory: "jsx" });

function harness(component, props, fetcher = async () => ({ ok: true, json: async () => ({}) })) {
  const slots = [], effects = [], requests = [], sounds = [];
  let position = 0;
  let timer;
  const context = {
    jsx: React.createElement,
    Heart: () => React.createElement("svg"),
    SmilePlus: () => React.createElement("svg"),
    useState(initial) {
      const index = position++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], update => { slots[index] = typeof update === "function" ? update(slots[index]) : update; }];
    },
    useRef(initial) {
      const index = position++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(callback, dependencies) {
      const index = position++;
      if (!slots[index] || dependencies.some((value, i) => !Object.is(value, slots[index].dependencies[i]))) {
        effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { dependencies, cleanup: callback() }; });
      }
    },
    useLayoutEffect() {},
    createPortal: child => child,
    fetch: async (url, options) => { requests.push({ url, ...options }); return fetcher(url, options); },
    prepareEngagementSound: () => sounds.push("prepared"),
    playEngagementSound: comment => sounds.push(comment ? "comment" : "reaction"),
    document: { addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {} },
    setTimeout: callback => { timer = callback; return 1; },
    clearTimeout: () => { timer = null; }
  };
  const components = vm.runInNewContext(`${code}\n({ ReactionButton, CommentThread, CommentThreads })`, context);
  return {
    requests, sounds,
    render() {
      position = 0;
      const tree = components[component](props);
      effects.splice(0).forEach(effect => effect());
      return tree;
    },
    longPress() { timer?.(); },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); }
  };
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
const find = (tree, predicate) => {
  const result = nodes(tree).find(predicate);
  assert.ok(result, "Expected element exists");
  return result;
};
const button = (tree, text) => find(tree, node => node.type === "button" && node.props.children === text);
const event = { preventDefault() {} };

test("video reaction control supports tap Like, long press, all six choices and repeat selection", () => {
  const selected = [];
  const view = harness("ReactionButton", { reaction: "love", count: 8, counts: { love: 3 }, onReact: type => selected.push(type) });
  let tree = view.render();
  assert.match(renderToStaticMarkup(tree), /aria-label="Love, 8"/);
  const main = find(tree, node => node.props?.["aria-label"] === "Love, 8");
  main.props.onClick();
  assert.deepEqual(selected, ["like"]);
  main.props.onPointerDown({ button: 0 });
  view.longPress();
  tree = view.render();
  const choices = nodes(tree).filter(node => node.type === "button" && ["Like", "Love", "Haha", "Wow", "Sad", "Angry"].includes(node.props["aria-label"]));
  assert.equal(choices.length, 6);
  main.props.onClick();
  assert.deepEqual(selected, ["like"]);
  choices.find(node => node.props["aria-label"] === "Love").props.onClick();
  assert.deepEqual(selected, ["like", "love"]);
  assert.equal(view.sounds.length, 2);
  view.dispose();
});

test("comment reactions use the comment endpoint and only successful additions play sound", async () => {
  let response = { reaction: "wow", reactions: { wow: 2 }, reactionCount: 2 };
  const view = harness("CommentThread", {
    comment: { id: "root", username: "Author", text: "Hello", replyCount: 0 },
    api: "/api", token: "viewer", videoId: "video", canComment: true
  }, async () => ({ ok: true, json: async () => response }));
  let tree = view.render();
  let react = find(tree, node => node.type?.name === "ReactionButton").props.onReact;
  await react("wow");
  tree = view.render();
  assert.equal(view.requests[0].url, "/api/videos/video/comments/root/reaction");
  assert.deepEqual(JSON.parse(view.requests[0].body), { reaction: "wow" });
  assert.equal(find(tree, node => node.type?.name === "ReactionButton").props.reaction, "wow");
  assert.deepEqual(view.sounds, ["reaction"]);
  response = { reaction: null, reactions: {}, reactionCount: 1 };
  react = find(tree, node => node.type?.name === "ReactionButton").props.onReact;
  await react("wow");
  view.render();
  assert.deepEqual(view.sounds, ["reaction"]);
  view.dispose();
});

test("replies are loaded on demand and failed nested submissions keep their draft", async () => {
  let fail = true, added = 0;
  const view = harness("CommentThread", {
    comment: { id: "child", parentId: "root", username: "Author", text: "Reply", replyCount: 1 },
    api: "/api", token: "viewer", videoId: "video", canComment: true, depth: 1, onAdded: () => added++
  }, async (_url, options) => {
    if (options.method === "GET") return { ok: true, json: async () => ({ comments: [{ id: "nested", text: "Older nested reply" }], nextCursor: null }) };
    return { ok: !fail, json: async () => fail ? { error: "Reply unavailable" } : { id: "new", text: "New nested reply", parentId: "child" } };
  });
  let tree = view.render();
  assert.equal(view.requests.length, 0);
  await button(tree, "Show replies (1)").props.onClick();
  // The click starts work without waiting for the event handler's return.
  await new Promise(resolve => setImmediate(resolve));
  tree = view.render();
  assert.equal(view.requests[0].url, "/api/videos/video/comments?parentId=child");
  button(tree, "Reply").props.onClick();
  tree = view.render();
  find(tree, node => node.type === "textarea").props.onChange({ target: { value: "New nested reply" } });
  tree = view.render();
  find(tree, node => node.type === "form").props.onSubmit(event);
  await new Promise(resolve => setImmediate(resolve));
  tree = view.render();
  assert.equal(find(tree, node => node.type === "textarea").props.value, "New nested reply");
  assert.equal(find(tree, node => node.props?.role === "alert").props.children, "Reply unavailable");
  assert.equal(view.sounds.filter(value => value === "comment").length, 0);
  fail = false;
  find(tree, node => node.type === "form").props.onSubmit(event);
  await new Promise(resolve => setImmediate(resolve));
  tree = view.render();
  assert.equal(nodes(tree).filter(node => node.type === "textarea").length, 0);
  assert.equal(added, 1);
  assert.deepEqual(JSON.parse(view.requests.at(-1).body), { text: "New nested reply", parentId: "child" });
  assert.equal(view.sounds.filter(value => value === "comment").length, 1);
  view.dispose();
});

test("guest comment replies and reactions prompt sign-in without requests", async () => {
  let signIns = 0;
  const view = harness("CommentThread", {
    comment: { id: "root", text: "Hello" }, api: "/api", videoId: "video", canComment: false, onSignIn: () => signIns++
  });
  const tree = view.render();
  button(tree, "Reply").props.onClick();
  await find(tree, node => node.type?.name === "ReactionButton").props.onReact("love");
  assert.equal(signIns, 2);
  assert.equal(view.requests.length, 0);
  view.dispose();
});

test("root pagination appends older comments and removes the exhausted cursor", async () => {
  const view = harness("CommentThreads", {
    comments: [{ id: "first", text: "First" }], nextCursor: "cursor", api: "/api", videoId: "video", token: "viewer"
  }, async () => ({ ok: true, json: async () => ({ comments: [{ id: "older", text: "Older" }], nextCursor: null }) }));
  let tree = view.render();
  await button(tree, "Load more comments").props.onClick();
  tree = view.render();
  assert.equal(view.requests[0].url, "/api/videos/video/comments?before=cursor");
  assert.equal(nodes(tree).filter(node => node.type?.name === "CommentThread").length, 2);
  assert.equal(nodes(tree).filter(node => node.type === "button").length, 0);
  view.dispose();
});
