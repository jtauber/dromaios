import assert from "node:assert/strict";
import { test } from "node:test";
import { apple2WorkspaceKey, migrateApple2Workspace } from "../../site/interactive/apple2-workspace.js";
import { closePanel, groups, panelGroup } from "../../site/interactive/workspace/layout.js";
import type { WorkspaceLayout } from "../../site/interactive/workspace/layout.js";
import { decodeWorkspaceState, encodeWorkspaceState } from "../../site/interactive/workspace/state.js";

const ids = ["screen", "execution", "rom", "code"];
const original: WorkspaceLayout = { root: { kind: "split", id: "column", axis: "vertical", items: [
  { weight: 60, node: { kind: "tabs", id: "screen", panels: ["screen"], active: "screen", collapsed: false } },
  { weight: 40, node: { kind: "tabs", id: "tools", panels: ["rom", "code"], active: "code", collapsed: true } },
] } };
function preferences(layout?: WorkspaceLayout) {
  const values = new Map<string, string>(layout ? [["dromaios:workspace:apple2", encodeWorkspaceState(layout)]] : []);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test("older Apple II workspaces gain execution controls beneath the screen without rearranging other tools", () => {
  const storage = preferences(original);
  migrateApple2Workspace(storage, ids);
  const migrated = decodeWorkspaceState(storage.getItem(apple2WorkspaceKey)!, ids);
  assert.deepEqual(groups(migrated).map(group => group.panels), [["screen"], ["execution"], ["rom", "code"]]);
  assert.deepEqual(panelGroup(migrated, "code"), panelGroup(original, "code"));
  assert.equal(migrated.root?.kind, "split");
  if (migrated.root?.kind === "split") {
    const weights = migrated.root.items.map(item => item.weight);
    assert.equal(weights[2], 40);
    assert.equal(weights[0]! + weights[1]!, 60);
    assert.ok(weights[0]! > weights[1]!);
  }
  storage.setItem(apple2WorkspaceKey, encodeWorkspaceState(closePanel(migrated, "execution")));
  const hidden = storage.getItem(apple2WorkspaceKey);
  migrateApple2Workspace(storage, ids);
  assert.equal(storage.getItem(apple2WorkspaceKey), hidden, "later choices to hide controls survive reloads");
});

test("execution controls are accessible when an older workspace has no screen or no open panels", () => {
  for (const layout of [closePanel(original, "screen"), { root: null }]) {
    const storage = preferences(layout);
    migrateApple2Workspace(storage, ids);
    const migrated = decodeWorkspaceState(storage.getItem(apple2WorkspaceKey)!, ids);
    const execution = panelGroup(migrated, "execution");
    assert.equal(execution?.active, "execution");
    assert.equal(execution?.collapsed, false);
    for (const group of groups(layout)) for (const id of group.panels) assert.ok(panelGroup(migrated, id));
  }
  const fresh = preferences();
  migrateApple2Workspace(fresh, ids);
  assert.equal(fresh.getItem(apple2WorkspaceKey), null, "new visitors use the default layout");
});

test("saved layouts gain a watch tab once while preserving memory selection, collapse, and hidden execution controls", () => {
  const ids = ["screen", "execution", "memory", "watches"];
  const layout: WorkspaceLayout = { root: { kind: "tabs", id: "memory-tools", panels: ["memory"], active: "memory", collapsed: true } };
  const storage = preferences();
  storage.setItem("dromaios:workspace:apple2:2", encodeWorkspaceState(layout));
  migrateApple2Workspace(storage, ids);
  const updated = decodeWorkspaceState(storage.getItem(apple2WorkspaceKey)!, ids);
  assert.deepEqual(panelGroup(updated, "memory"), { ...layout.root, panels: ["memory", "watches"] });
  assert.equal(panelGroup(updated, "execution"), undefined);
  storage.setItem(apple2WorkspaceKey, encodeWorkspaceState(closePanel(updated, "watches")));
  migrateApple2Workspace(storage, ids);
  assert.equal(panelGroup(decodeWorkspaceState(storage.getItem(apple2WorkspaceKey)!, ids), "watches"), undefined);
});

test("version 3 gains Call stack beside Stack without reopening hidden Watches or other instruments", () => {
  const ids = ["stack", "calls", "memory", "watches", "execution"];
  const layout: WorkspaceLayout = { root: { kind: "tabs", id: "tools", panels: ["stack", "memory"], active: "memory", collapsed: true } };
  const storage = preferences(); storage.setItem("dromaios:workspace:apple2:3", encodeWorkspaceState(layout));
  migrateApple2Workspace(storage, ids);
  const updated = decodeWorkspaceState(storage.getItem(apple2WorkspaceKey)!, ids);
  assert.deepEqual(panelGroup(updated, "calls"), { ...layout.root, panels: ["stack", "memory", "calls"] });
  assert.equal(panelGroup(updated, "watches"), undefined); assert.equal(panelGroup(updated, "execution"), undefined);
  storage.setItem(apple2WorkspaceKey, encodeWorkspaceState(closePanel(updated, "calls")));
  migrateApple2Workspace(storage, ids);
  assert.equal(panelGroup(decodeWorkspaceState(storage.getItem(apple2WorkspaceKey)!, ids), "calls"), undefined);
});
