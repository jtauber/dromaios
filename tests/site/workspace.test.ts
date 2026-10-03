import assert from "node:assert/strict";
import { test } from "node:test";
import { activatePanel, closePanel, collapsedHeight, collapseGroup, groups, movePanel, openPanel, panelGroup, resizeSplit } from "../../site/interactive/workspace/layout.js";
import type { TabGroup, WorkspaceLayout } from "../../site/interactive/workspace/layout.js";
import { decodeWorkspaceState, encodeWorkspaceState } from "../../site/interactive/workspace/state.js";

const ids = ["screen", "registers", "code", "log"];
const tabs = (id: string, ...panels: string[]): TabGroup => ({ kind: "tabs", id, panels, active: panels[0]!, collapsed: false });
const initial: WorkspaceLayout = { root: { kind: "split", id: "columns", axis: "horizontal", ratio: .6,
  first: tabs("left", "screen", "registers"), second: tabs("right", "code", "log") } };
const names = (layout: WorkspaceLayout) => groups(layout).flatMap(group => group.panels);
const checked = (layout: WorkspaceLayout) => assert.deepEqual(decodeWorkspaceState(encodeWorkspaceState(layout), ids), layout);

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

test("each docking edge creates the expected split while preserving every panel", () => {
  for (const side of ["left", "right", "above", "below"] as const) {
    const layout = movePanel(initial, "code", { group: "left", side });
    assert.equal(layout.root?.kind, "split");
    if (layout.root?.kind !== "split" || layout.root.first.kind !== "split") assert.fail("Expected nested split");
    const split = layout.root.first;
    assert.equal(split.axis, side === "left" || side === "right" ? "horizontal" : "vertical");
    const added = side === "left" || side === "above" ? split.first : split.second;
    assert.equal(added.kind, "tabs"); if (added.kind === "tabs") assert.deepEqual(added.panels, ["code"]);
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
  assert.equal(collapsed.root?.kind === "split" && collapsed.root.ratio, .6);
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
  const columns = { ...initial.root, first: left, second: right };
  assert.equal(collapsedHeight(columns, 34, 6), 34);
  assert.equal(collapsedHeight({ ...columns, axis: "vertical" }, 34, 6), 74);
  assert.equal(collapsedHeight({ ...columns, first: tabs("open", "log") }, 34, 6), undefined);
  const stacked = { ...columns, axis: "vertical" as const, first: columns };
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
    const layout = resizeSplit(initial, "columns", input!);
    assert.equal(layout.root?.kind === "split" && layout.root.ratio, expected); checked(layout);
  }
  assert.throws(() => resizeSplit(initial, "columns", NaN));
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
    else if (action === 3 && layout.root?.kind === "split") layout = resizeSplit(layout, layout.root.id, random(100) / 100);
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
