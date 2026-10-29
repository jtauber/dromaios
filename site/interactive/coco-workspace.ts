import type { LayoutNode, SplitItem, WorkspaceLayout } from "./workspace/layout.js";
import { movePanel, openPanel, panelGroup } from "./workspace/layout.js";
import { decodeWorkspaceState, encodeWorkspaceState } from "./workspace/state.js";

const group = (...panels: string[]): LayoutNode => ({ kind: "tabs", id: `coco-${panels[0]}`, panels, active: panels[0]!, collapsed: false });
const area = (weight: number, node: LayoutNode): SplitItem => ({ weight, node });
const column = (id: string, ...items: SplitItem[]): LayoutNode => ({ kind: "split", id, axis: "vertical", items });

export const cocoWorkspaceKey = "dromaios:workspace:coco:2";
export const cocoDefaultLayout: WorkspaceLayout = {
  root: { kind: "split", id: "coco-columns", axis: "horizontal", items: [
    area(.42, column("coco-screen-controls", area(.5, group("screen")), area(.2, group("execution")), area(.3, group("instruction")))),
    area(.33, column("coco-cpu-memory", area(.22, group("registers")), area(.43, group("code")), area(.35, group("memory")))),
    area(.25, column("coco-devices", area(.27, group("sam")), area(.45, group("pias")), area(.28, group("rom", "states")))),
  ] },
};

/** Add the two new tools once, retaining existing panels, tab choices, and hidden tools. */
export function migrateCocoWorkspace(storage: { getItem(key: string): string | null; setItem(key: string, value: string): void }, ids: readonly string[]): void {
  if (storage.getItem(cocoWorkspaceKey) !== null) return;
  const saved = storage.getItem("dromaios:workspace:coco:1"); if (saved === null) return;
  let layout = decodeWorkspaceState(saved, ids);
  for (const [tool, beside] of [["instruction", "screen"], ["code", "memory"]] as const) {
    if (panelGroup(layout, tool)) continue;
    const group = panelGroup(layout, beside);
    layout = group ? movePanel(layout, tool, { group: group.id, side: "below" }) : openPanel(layout, tool);
  }
  storage.setItem(cocoWorkspaceKey, encodeWorkspaceState(layout));
}
