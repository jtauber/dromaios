import { decodeWorkspaceState, encodeWorkspaceState } from "./workspace/state.js";
import { normalizeSplit } from "./workspace/layout.js";
import type { LayoutNode, Split, TabGroup, WorkspaceLayout } from "./workspace/layout.js";

const group = (id: string): TabGroup => ({ kind: "tabs", id: "xt-" + id, active: id, panels: [id], collapsed: false });
const area = (weight: number, node: LayoutNode) => ({ weight, node });
const column = (id: string, ...items: Split["items"]): Split => ({ id, kind: "split", axis: "vertical", items });
const tools = column("xt-inspectors", area(.37, group("registers")), area(.63, group("code")));
export const xtWorkspaceKey = "dromaios:workspace:xt:2";
export const xtDefaultLayout: WorkspaceLayout = { root: { kind: "split", id: "xt-columns", axis: "horizontal", items: [
  area(.42, column("xt-console", area(.76, group("screen")), area(.24, group("execution")))),
  area(.36, tools),
  area(.22, column("xt-session", area(.66, group("rom")), area(.34, group("snapshot")))),
] } };

/** Keep existing tabs, hidden panels and relative sizes. Add the two inspectors alongside them once. */
export function migrateXtWorkspace(storage: { getItem(key: string): string | null; setItem(key: string, value: string): void }): void {
  if (storage.getItem(xtWorkspaceKey) !== null) return;
  const saved = storage.getItem("dromaios:workspace:xt:1");
  if (saved === null) return;
  const old = decodeWorkspaceState(saved, ["screen", "execution", "rom", "snapshot"]);
  const root = old.root ? normalizeSplit({ kind: "split", id: "xt-expanded", axis: "horizontal", items: [
    area(.64, old.root), area(.36, tools),
  ] }) : tools;
  storage.setItem(xtWorkspaceKey, encodeWorkspaceState({ root }));
}
