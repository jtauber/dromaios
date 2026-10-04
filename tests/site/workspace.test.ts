import assert from "node:assert/strict";
import { test } from "node:test";
import { activatePanel, closePanel, collapsedHeight, collapseGroup, groups, movePanel, openPanel, panelGroup, resizeSplit } from "../../site/interactive/workspace/layout.js";
import type { Split, TabGroup, WorkspaceLayout } from "../../site/interactive/workspace/layout.js";
import { decodeWorkspaceState, encodeWorkspaceState } from "../../site/interactive/workspace/state.js";

const ids = ["screen", "registers", "code", "log"];
const tabs = (id: string, ...panels: string[]): TabGroup => ({ kind: "tabs", id, panels, active: panels[0]!, collapsed: false });
const initial: WorkspaceLayout = { root: { kind: "split", id: "columns", axis: "horizontal", items: [
  { weight: .6, node: tabs("left", "screen", "registers") }, { weight: .4, node: tabs("right", "code", "log") },
] } };
const splitRoot = (layout: WorkspaceLayout): Split => { assert.equal(layout.root?.kind, "split"); return layout.root as Split; };
const names = (layout: WorkspaceLayout) => groups(layout).flatMap(group => group.panels);
const checked = (layout: WorkspaceLayout) => assert.deepEqual(decodeWorkspaceState(encodeWorkspaceState(layout), ids), layout);
const stack = (axis: Split["axis"]): WorkspaceLayout => ({ root: { kind: "split", id: "stack", axis, items: [
  { weight: 20, node: tabs("a", "screen") }, { weight: 30, node: tabs("b", "code") }, { weight: 50, node: tabs("c", "log") },
] } });

test("three panels reorder as peers on either axis, carrying their sizes and collapse state", () => {
  for (const axis of ["horizontal", "vertical"] as const) {
    const before = axis === "horizontal" ? "left" : "above", after = axis === "horizontal" ? "right" : "below";
    const original = collapseGroup(stack(axis), "b", true);
    for (const [panel, destination, side, order] of [
      ["log", "a", before, ["log", "screen", "code"]],
      ["screen", "c", after, ["code", "log", "screen"]],
      ["code", "a", before, ["code", "screen", "log"]],
      ["code", "c", after, ["screen", "log", "code"]],
      ["screen", "b", before, ["screen", "code", "log"]],
    ] as const) {
      const moved = movePanel(original, panel, { group: destination, side });
      assert.deepEqual(names(moved), order);
      const root = splitRoot(moved);
      assert.equal(root.items.length, 3);
      for (const item of root.items) assert.deepEqual(item, splitRoot(original).items.find(other => other.node.id === item.node.id));
      checked(moved);
    }
    let moved = original;
    for (let i = 0; i < 30; i++) {
      const first = groups(moved)[0]!, last = groups(moved).at(-1)!;
      moved = movePanel(moved, last.active, { group: first.id, side: before });
      assert.equal(splitRoot(moved).items.length, 3);
      assert.ok(splitRoot(moved).items.every(item => item.node.kind === "tabs"));
    }
    assert.deepEqual(moved, original);
  }
});

test("each divider resizes just its neighbouring panels", () => {
  for (const axis of ["horizontal", "vertical"] as const) {
    let layout = resizeSplit(stack(axis), "stack", 0, .8);
    assert.deepEqual(splitRoot(layout).items.map(item => item.weight), [40, 10, 50]);
    layout = resizeSplit(layout, "stack", 1, .25);
    assert.deepEqual(splitRoot(layout).items.map(item => item.weight), [40, 15, 45]); checked(layout);
    const collapsed = collapseGroup(layout, "b", true);
    assert.deepEqual(collapseGroup(collapsed, "b", false), layout);
    const closed = closePanel(layout, "code");
    assert.deepEqual(splitRoot(closed).items.map(item => item.weight), [40, 45]); checked(closed);
  }
});

test("tabbing a panel and detaching it again leaves a flat stack with all tools intact", () => {
  let layout = movePanel(stack("vertical"), "log", { group: "b", side: "tab" });
  assert.deepEqual(panelGroup(layout, "log")?.panels, ["code", "log"]);
  layout = movePanel(layout, "log", { group: "b", side: "above" });
  assert.deepEqual(names(layout), ["screen", "log", "code"]);
  assert.deepEqual(splitRoot(layout).items.map(item => item.weight), [20, 15, 15]);
  assert.ok(splitRoot(layout).items.every(item => item.node.kind === "tabs")); checked(layout);
});

test("closing a crossing branch flattens newly adjacent rows while retaining their shares", () => {
  const layout: WorkspaceLayout = { root: { kind: "split", id: "outer", axis: "vertical", items: [
    { weight: 2, node: tabs("registers", "registers") },
    { weight: 8, node: { kind: "split", id: "crossing", axis: "horizontal", items: [
      { weight: 1, node: stack("vertical").root! }, { weight: 1, node: tabs("unused", "unused") },
    ] } },
  ] } };
  const closed = closePanel(layout, "unused");
  assert.deepEqual(splitRoot(closed).items.map(item => item.weight), [2, 1.6, 2.4, 4]);
  assert.ok(splitRoot(closed).items.every(item => item.node.kind === "tabs")); checked(closed);
});

test("version 2 saved splits migrate to ordered rows, preserving proportions, tabs, and collapse", () => {
  const saved = { version: 2, layout: { root: { kind: "split", id: "outer", axis: "vertical", ratio: .2,
    first: tabs("a", "screen"), second: { kind: "split", id: "inner", axis: "vertical", ratio: .375,
      first: { ...tabs("b", "registers", "code"), active: "code", collapsed: true }, second: tabs("c", "log"),
    },
  } } };
  const migrated = decodeWorkspaceState(JSON.stringify(saved), ids), root = splitRoot(migrated);
  assert.deepEqual(root.items.map(item => item.node.id), ["a", "b", "c"]);
  for (const [i, expected] of [.2, .3, .5].entries()) assert.ok(Math.abs(root.items[i]!.weight - expected) < 1e-12);
  assert.deepEqual(panelGroup(migrated, "code"), saved.layout.root.second.first);
  assert.equal(JSON.parse(encodeWorkspaceState(migrated)).version, 3); checked(migrated);
});

test("saved ordered rows require distinct known nodes and finite positive weights", () => {
  const saved = JSON.parse(encodeWorkspaceState(stack("vertical")));
  for (const items of [[], [saved.layout.root.items[0]], null,
    [{ node: tabs("a", "screen"), weight: 0 }, { node: tabs("b", "code"), weight: 1 }],
    [{ node: tabs("a", "screen"), weight: -1 }, { node: tabs("b", "code"), weight: 1 }],
    [{ node: tabs("a", "screen"), weight: null }, { node: tabs("b", "code"), weight: 1 }],
    [{ node: tabs("a", "screen"), weight: 1e308 }, { node: tabs("b", "code"), weight: 1e308 }],
    [{ node: tabs("a", "screen"), weight: 1 }, { node: tabs("a", "code"), weight: 1 }],
    [{ node: tabs("a", "screen"), weight: 1 }, { node: tabs("b", "unknown"), weight: 1 }],
  ]) {
    saved.layout.root.items = items;
    assert.throws(() => decodeWorkspaceState(JSON.stringify(saved), ids));
  }
});

test("tabs can reorder in either direction and a tab click changes only the active panel", () => {
  let layout = movePanel(initial, "code", { group: "left", side: "tab", index: 1 });
  assert.deepEqual(panelGroup(layout, "code")?.panels, ["screen", "code", "registers"]);
  layout = movePanel(layout, "screen", { group: "left", side: "tab", index: 3 });
  assert.deepEqual(panelGroup(layout, "screen")?.panels, ["code", "registers", "screen"]);
  layout = movePanel(layout, "screen", { group: "left", side: "tab", index: 0 });
  assert.deepEqual(panelGroup(layout, "screen")?.panels, ["screen", "code", "registers"]);
  const active = activatePanel(layout, "registers");
  assert.equal(panelGroup(active, "code")?.active, "registers");
  assert.deepEqual(names(active), names(layout)); checked(active);
});

test("closing or moving the last tab collapses empty groups and split areas", () => {
  let layout = closePanel(initial, "registers");
  layout = movePanel(layout, "screen", { group: "right", side: "tab" });
  assert.deepEqual(layout.root, { ...tabs("right", "code", "log", "screen"), active: "screen" });
  layout = closePanel(layout, "screen");
  assert.equal(panelGroup(layout, "log")?.active, "log"); checked(layout);
  assert.deepEqual(names(initial), ids); // Operations do not mutate their input.
});

test("docking in the same direction inserts a sibling; only a change of direction nests", () => {
  for (const side of ["left", "right", "above", "below"] as const) {
    const layout = movePanel(initial, "code", { group: "left", side });
    const root = splitRoot(layout);
    if (side === "left" || side === "right") {
      assert.equal(root.items.length, 3);
      assert.deepEqual(root.items.map(item => item.weight), [.3, .3, .4]);
      assert.deepEqual(names(layout), side === "left" ? ["code", "screen", "registers", "log"] : ["screen", "registers", "code", "log"]);
      assert.ok(root.items.every(item => item.node.kind === "tabs"));
    } else {
      const nested = root.items[0]!.node;
      assert.equal(nested.kind, "split"); if (nested.kind !== "split") assert.fail();
      assert.equal(nested.axis, "vertical"); assert.equal(nested.items.length, 2);
      assert.deepEqual(nested.items[side === "above" ? 0 : 1]!.node, panelGroup(layout, "code"));
    }
    assert.deepEqual(names(layout).sort(), [...ids].sort()); checked(layout);
  }
});

test("all panels can be closed and reopened into an empty workspace", () => {
  let layout = initial;
  for (const id of ids) layout = closePanel(layout, id);
  assert.deepEqual(layout, { root: null }); checked(layout);
  layout = openPanel(layout, "log"); assert.deepEqual(names(layout), ["log"]); checked(layout);
});

test("collapse retains active tabs and split proportions; selecting a tab expands its group", () => {
  const collapsed = collapseGroup(initial, "left", true);
  assert.equal(panelGroup(collapsed, "screen")?.collapsed, true);
  assert.equal(panelGroup(collapsed, "screen")?.active, "screen");
  assert.deepEqual(names(collapsed), names(initial));
  assert.deepEqual(splitRoot(collapsed).items.map(item => item.weight), [.6, .4]);
  assert.deepEqual(collapseGroup(collapsed, "left", false), initial);
  const selected = activatePanel(collapsed, "registers");
  assert.equal(panelGroup(selected, "registers")?.collapsed, false);
  assert.equal(panelGroup(selected, "registers")?.active, "registers"); checked(collapsed); checked(selected);
});

test("collapsed subtrees surrender only their body height and retain every visible header", () => {
  if (initial.root?.kind !== "split") assert.fail("Expected split");
  const left = { ...tabs("left", "screen"), collapsed: true }, right = { ...tabs("right", "code"), collapsed: true };
  assert.equal(collapsedHeight(tabs("open", "log"), 34, 6), undefined);
  assert.equal(collapsedHeight(left, 34, 6), 34);
  const columns: Split = { ...initial.root, items: [{ weight: 1, node: left }, { weight: 1, node: right }] };
  assert.equal(collapsedHeight(columns, 34, 6), 34);
  assert.equal(collapsedHeight({ ...columns, axis: "vertical" }, 34, 6), 74);
  assert.equal(collapsedHeight({ ...columns, items: [{ weight: 1, node: tabs("open", "log") }, columns.items[1]!] }, 34, 6), undefined);
  const stacked = { ...columns, axis: "vertical" as const, items: [{ weight: 1, node: columns }, columns.items[1]!] };
  assert.equal(collapsedHeight(stacked, 34, 6), 74);
});

test("moving into a collapsed group expands it; moving away preserves the source collapse", () => {
  const collapsed = collapseGroup(collapseGroup(initial, "left", true), "right", true);
  const moved = movePanel(collapsed, "code", { group: "left", side: "tab" });
  assert.equal(panelGroup(moved, "code")?.collapsed, false);
  assert.equal(panelGroup(moved, "log")?.collapsed, true);
  assert.equal(panelGroup(openPanel(collapsed, "screen"), "screen")?.collapsed, false);
  const split = movePanel(collapsed, "code", { group: "left", side: "below" });
  assert.equal(panelGroup(split, "code")?.collapsed, false);
  assert.equal(panelGroup(split, "screen")?.collapsed, true); checked(split);
});

test("invalid destinations and tab indexes fail without modifying the layout", () => {
  assert.throws(() => movePanel(initial, "code", { group: "missing", side: "left" }), /destination/);
  for (const index of [-1, 3, NaN, .5]) assert.throws(() => movePanel(initial, "code", { group: "left", side: "tab", index }));
  const single = closePanel(initial, "log");
  assert.equal(movePanel(single, "code", { group: "right", side: "left" }), single);
  checked(initial);
});

test("split proportions remain bounded", () => {
  for (const [input, expected] of [[0, .1], [1, .9], [.42, .42]]) {
    const layout = resizeSplit(initial, "columns", 0, input!);
    assert.equal(splitRoot(layout).items[0]!.weight, expected); checked(layout);
  }
  assert.throws(() => resizeSplit(initial, "columns", 0, NaN));
  for (const index of [-1, 1, .5, NaN]) assert.throws(() => resizeSplit(initial, "columns", index, .5));
});

test("saved layouts reject unknown panels, duplicate ownership, invalid geometry, and stale versions", () => {
  const saved = { version: 2, layout: { root: {
    kind: "split", id: "columns", axis: "horizontal", ratio: .6 as number | null,
    first: { kind: "tabs", id: "left", panels: ["screen", "registers"], active: "screen", collapsed: false },
    second: { kind: "tabs", id: "right", panels: ["code", "log"], active: "code", collapsed: false },
  } } };
  const invalid = (change: (value: typeof saved) => void) => {
    const copy = structuredClone(saved); change(copy);
    assert.throws(() => decodeWorkspaceState(JSON.stringify(copy), ids));
  };
  invalid(value => { value.version = 1; });
  invalid(value => { value.layout.root.ratio = null; });
  invalid(value => { value.layout.root.ratio = 0; });
  invalid(value => { value.layout.root.first.active = "missing"; });
  invalid(value => { value.layout.root.first.panels = []; });
  invalid(value => { value.layout.root.second.id = "left"; });
  invalid(value => { value.layout.root.second.panels = ["screen"]; value.layout.root.second.active = "screen"; });
  invalid(value => { value.layout.root.first.panels = ["unknown"]; value.layout.root.first.active = "unknown"; });
  invalid(value => { value.layout.root.kind = "html"; });
  invalid(value => { Reflect.deleteProperty(value.layout.root.first, "collapsed"); });
  assert.throws(() => decodeWorkspaceState("{", ids));
  assert.throws(() => decodeWorkspaceState(" ".repeat(100001), ids));
});

test("long sequences of docking, closing, reopening, and resizing preserve layout invariants", () => {
  let layout = initial, seed = 12345;
  const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 0x100000000 * limit); };
  for (let step = 0; step < 1000; step++) {
    const panel = ids[random(ids.length)]!, action = random(6);
    if (action === 0) layout = closePanel(layout, panel);
    else if (action === 1) layout = openPanel(layout, panel);
    else if (action === 2) {
      const group = panelGroup(layout, panel);
      if (group) layout = collapseGroup(layout, group.id, !group.collapsed);
    }
    else if (action === 3 && layout.root?.kind === "split") layout = resizeSplit(layout, layout.root.id, random(layout.root.items.length - 1), random(100) / 100);
    else {
      const all = groups(layout), target = all[random(all.length)];
      if (target) {
        const side = action === 4 ? (["left", "right", "above", "below"] as const)[random(4)]! : "tab";
        layout = movePanel(layout, panel, { group: target.id, side, index: random(target.panels.length + 1) });
      }
    }
    assert.equal(new Set(names(layout)).size, names(layout).length); checked(layout);
  }
});
