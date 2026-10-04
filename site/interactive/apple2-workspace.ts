import { movePanel, openPanel, panelGroup, parentSplit, resizeSplit } from "./workspace/layout.js";
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
        area(.65, group("code")))))),
    area(.2632, split("zero-and-memory", "vertical", area(.36, group("zero")), area(.352, group("memory")), area(.288, group("stack")))),
    area(.2968, group("rom", "trace", "log", "system", "disk"))),
};

export const apple2WorkspaceKey = "dromaios:workspace:apple2:2";

/** Replace the former global control bar once, preserving later choices to move or hide its panel. */
export function migrateApple2Workspace(storage: { getItem(key: string): string | null; setItem(key: string, value: string): void }, ids: readonly string[]): void {
  if (storage.getItem(apple2WorkspaceKey) !== null) return;
  const saved = storage.getItem("dromaios:workspace:apple2");
  if (saved === null) return;
  let layout = decodeWorkspaceState(saved, ids);
  if (!panelGroup(layout, "execution")) {
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
  storage.setItem(apple2WorkspaceKey, encodeWorkspaceState(layout));
}
