import type { LayoutNode, SplitItem, WorkspaceLayout } from "./workspace/layout.js";
import { activatePanel, collapseGroup, movePanel, openPanel, panelGroup } from "./workspace/layout.js";
import { decodeWorkspaceState, encodeWorkspaceState } from "./workspace/state.js";

const group = (...panels: string[]): LayoutNode => ({ kind: "tabs", id: `coco-${panels[0]}`, panels, active: panels[0]!, collapsed: false });
const area = (weight: number, node: LayoutNode): SplitItem => ({ weight, node });
const column = (id: string, ...items: SplitItem[]): LayoutNode => ({ kind: "split", id, axis: "vertical", items });

export const cocoWorkspaceKey = "dromaios:workspace:coco:7";
export const cocoDefaultLayout: WorkspaceLayout = {
  root: { kind: "split", id: "coco-columns", axis: "horizontal", items: [
    area(.30, column("coco-screen-controls", area(.5, group("screen")), area(.2, group("execution", "debugger")), area(.3, group("instruction")))),
    area(.28, column("coco-cpu-code", area(.22, group("registers")), area(.78, group("code", "log")))),
    area(.24, column("coco-memory-tools", area(.3, group("memory")), area(.3, group("direct-page")), area(.2, group("stack-s", "calls")), area(.2, group("stack-u")))),
    area(.18, column("coco-devices", area(.27, group("sam")), area(.45, group("pias")), area(.28, group("rom", "walkthrough", "states")))),
  ] },
};

/** Add tools once per layout version; deliberately hidden older tools stay hidden. */
export function migrateCocoWorkspace(storage: { getItem(key: string): string | null; setItem(key: string, value: string): void }, ids: readonly string[]): void {
  if (storage.getItem(cocoWorkspaceKey) !== null) return;
  const version6 = storage.getItem("dromaios:workspace:coco:6");
  if (version6 !== null) {
    storage.setItem(cocoWorkspaceKey, encodeWorkspaceState(withLog(decodeWorkspaceState(version6, ids)))); return;
  }
  const version5 = storage.getItem("dromaios:workspace:coco:5");
  if (version5 !== null) {
    storage.setItem(cocoWorkspaceKey, encodeWorkspaceState(withLog(withTab(decodeWorkspaceState(version5, ids), "calls", "stack-s")))); return;
  }
  const version4 = storage.getItem("dromaios:workspace:coco:4");
  if (version4 !== null) {
    const layout = decodeWorkspaceState(version4, ids);
    storage.setItem(cocoWorkspaceKey, encodeWorkspaceState(withLog(withTab(withTab(layout, "debugger", "execution"), "calls", "stack-s")))); return;
  }
  const version3 = storage.getItem("dromaios:workspace:coco:3");
  if (version3 !== null) {
    const layout = decodeWorkspaceState(version3, ids);
    storage.setItem(cocoWorkspaceKey, encodeWorkspaceState(withNewTools(layout))); return;
  }
  const version2 = storage.getItem("dromaios:workspace:coco:2");
  const saved = version2 ?? storage.getItem("dromaios:workspace:coco:1"); if (saved === null) return;
  let layout = decodeWorkspaceState(saved, ids);
  const additions = version2 === null ? [["instruction", "screen"], ["code", "memory"]] as const : [];
  for (const [tool, beside] of additions) {
    if (panelGroup(layout, tool)) continue;
    const group = panelGroup(layout, beside);
    layout = group ? movePanel(layout, tool, { group: group.id, side: "below" }) : openPanel(layout, tool);
  }
  // New memory tools share a tab set rather than repeatedly halving an existing pane.
  // Each remains independently dockable; preserve the old active tab and collapsed state.
  const memory = panelGroup(layout, "memory");
  let destination = memory;
  for (const tool of ["direct-page", "stack-s", "stack-u"]) {
    if (panelGroup(layout, tool)) continue;
    layout = destination ? movePanel(layout, tool, { group: destination.id, side: "tab" }) : openPanel(layout, tool);
    destination = panelGroup(layout, tool);
  }
  if (memory) layout = collapseGroup(activatePanel(layout, memory.active), memory.id, memory.collapsed);
  else if (destination) layout = activatePanel(layout, destination.panels[0]!);
  storage.setItem(cocoWorkspaceKey, encodeWorkspaceState(withNewTools(layout)));
}

const withLog = (layout: WorkspaceLayout) => withTab(layout, "log", "code");

function withNewTools(layout: WorkspaceLayout): WorkspaceLayout {
  return withLog(withTab(withTab(withTab(layout, "walkthrough", "rom"), "debugger", "execution"), "calls", "stack-s"));
}

function withTab(layout: WorkspaceLayout, panel: string, beside: string): WorkspaceLayout {
  if (panelGroup(layout, panel)) return layout;
  const group = panelGroup(layout, beside);
  if (!group) return openPanel(layout, panel);
  const added = movePanel(layout, panel, { group: group.id, side: "tab" });
  return collapseGroup(activatePanel(added, group.active), group.id, group.collapsed);
}
