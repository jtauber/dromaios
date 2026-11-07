import { activatePanel, collapseGroup, movePanel, openPanel, panelGroup, parentSplit, resizeSplit } from "./workspace/layout.js";
import type { LayoutNode, SplitItem, WorkspaceLayout } from "./workspace/layout.js";
import { decodeWorkspaceState, encodeWorkspaceState } from "./workspace/state.js";

const group = (...panels: string[]): LayoutNode => ({ kind: "tabs", id: `default-${panels[0]}`, panels, active: panels[0]!, collapsed: false });
const split = (id: string, axis: "horizontal" | "vertical", ...items: SplitItem[]): LayoutNode => ({ kind: "split", id, axis, items });
const area = (weight: number, node: LayoutNode): SplitItem => ({ weight, node });

/** Composition only: tool IDs and proportions, not machine state. */
export const apple2DefaultLayout: WorkspaceLayout = {
  root: split("columns", "horizontal",
    area(.44, split("screen-and-cpu", "vertical", area(.5, group("screen")),
      area(.5, split("cpu-details", "horizontal",
        area(.35, split("execution-and-cpu", "vertical", area(.4, group("execution")), area(.35, group("registers")), area(.25, group("instruction")))),
        area(.65, group("code", "applesoft", "applesoft-history", "applesoft-events")))))),
    area(.2632, split("zero-and-memory", "vertical", area(.36, group("zero")), area(.352, group("memory", "watches")), area(.288, group("stack", "calls", "variables", "applesoft-stack")))),
    area(.2968, group("rom", "walkthrough", "states", "trace", "log", "system", "activity", "disk"))),
};

export const apple2WorkspaceKey = "dromaios:workspace:apple2:12";

/** Introduce new instruments once, retaining the saved arrangement and later choices to hide them. */
export function migrateApple2Workspace(storage: { getItem(key: string): string | null; setItem(key: string, value: string): void }, ids: readonly string[]): void {
  if (storage.getItem(apple2WorkspaceKey) !== null) return;
  let version = 11;
  let saved = storage.getItem(`dromaios:workspace:apple2:${version}`);
  while (saved === null && version > 1) {
    version--;
    saved = storage.getItem(version === 1 ? "dromaios:workspace:apple2" : `dromaios:workspace:apple2:${version}`);
  }
  if (saved === null) return;
  let layout = decodeWorkspaceState(saved, ids);
  if (version < 2 && !panelGroup(layout, "execution")) {
    const screen = panelGroup(layout, "screen");
    if (screen) {
      layout = movePanel(layout, "execution", { group: screen.id, side: "below" });
      const column = parentSplit(layout, screen.id)!;
      const index = column.items.findIndex(item => item.node.id === screen.id);
      layout = resizeSplit(layout, column.id, index, .72);
    } else {
      layout = openPanel(layout, "execution");
    }
  }
  function addTab(tool: string, beside: string): void {
    const existing = panelGroup(layout, beside);
    if (ids.includes(tool) && existing && !panelGroup(layout, tool)) {
      layout = movePanel(layout, tool, { group: existing.id, side: "tab" });
      layout = activatePanel(layout, existing.active);
      layout = collapseGroup(layout, existing.id, existing.collapsed);
    }
  }
  if (version < 3) addTab("watches", "memory");
  if (version < 4) addTab("calls", "stack");
  if (version < 5) addTab("activity", "system");
  if (version < 6) addTab("walkthrough", "rom");
  if (version < 7) addTab("states", "rom");
  if (version < 8) addTab("applesoft", "code");
  if (version < 9) addTab("variables", "stack");
  if (version < 10) addTab("applesoft-stack", panelGroup(layout, "variables") ? "variables" : "stack");
  if (version < 11) addTab("applesoft-history", panelGroup(layout, "applesoft") ? "applesoft" : "code");
  addTab("applesoft-events", panelGroup(layout, "applesoft") ? "applesoft" : "code");
  storage.setItem(apple2WorkspaceKey, encodeWorkspaceState(layout));
}
