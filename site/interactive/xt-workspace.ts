import { decodeWorkspaceState, encodeWorkspaceState } from "./workspace/state.js";
import { groups, movePanel, normalizeSplit, openPanel, panelGroup } from "./workspace/layout.js";
import type { LayoutNode, Split, TabGroup, WorkspaceLayout } from "./workspace/layout.js";

const group = (id: string): TabGroup => ({ kind: "tabs", id: "xt-" + id, active: id, panels: [id], collapsed: false });
const area = (weight: number, node: LayoutNode) => ({ weight, node });
const column = (id: string, ...items: Split["items"]): Split => ({ id, kind: "split", axis: "vertical", items });
const tools = column("xt-inspectors", area(.31, group("registers")), area(.40, group("code")), area(.29, group("memory")));
export const xtWorkspaceKey = "dromaios:workspace:xt:5";
export const xtDefaultLayout: WorkspaceLayout = { root: { kind: "split", id: "xt-columns", axis: "horizontal", items: [
  area(.42, column("xt-console", area(.50, group("screen")), area(.22, group("execution")), area(.28, group("instruction")))),
  area(.36, tools),
  area(.22, column("xt-session", area(.40, group("rom")),
    area(.40, { ...group("debugger"), panels: ["debugger", "walkthrough"], active: "walkthrough" }), area(.20, group("snapshot")))),
] } };

/** Add new tools once per version, preserving existing tabs, hidden panels and relative sizes. */
export function migrateXtWorkspace(storage: { getItem(key: string): string | null; setItem(key: string, value: string): void }): void {
  if (storage.getItem(xtWorkspaceKey) !== null) return;
  function addDebugger(layout: WorkspaceLayout): WorkspaceLayout {
    const destination = panelGroup(layout, "rom") ?? panelGroup(layout, "snapshot");
    return destination ? movePanel(layout, "debugger", { group: destination.id, side: "below" }) : openPanel(layout, "debugger");
  }
  function save(layout: WorkspaceLayout): void {
    const destination = panelGroup(layout, "execution") ?? panelGroup(layout, "registers") ?? groups(layout)[0];
    layout = destination ? movePanel(layout, "instruction", { group: destination.id, side: "below" }) : openPanel(layout, "instruction");
    const debuggerGroup = panelGroup(layout, "debugger");
    const guideDestination = debuggerGroup ?? groups(layout)[0];
    layout = guideDestination ? movePanel(layout, "walkthrough", { group: guideDestination.id, side: debuggerGroup ? "tab" : "below" }) : openPanel(layout, "walkthrough");
    storage.setItem(xtWorkspaceKey, encodeWorkspaceState(layout));
  }
  const version4 = storage.getItem("dromaios:workspace:xt:4");
  if (version4 !== null) {
    save(decodeWorkspaceState(version4, ["screen", "execution", "rom", "snapshot", "registers", "code", "memory", "debugger"]));
    return;
  }
  const version3 = storage.getItem("dromaios:workspace:xt:3");
  if (version3 !== null) {
    const old = decodeWorkspaceState(version3, ["screen", "execution", "rom", "snapshot", "registers", "code", "memory"]);
    save(addDebugger(old));
    return;
  }
  const version2 = storage.getItem("dromaios:workspace:xt:2");
  if (version2 !== null) {
    const old = decodeWorkspaceState(version2, ["screen", "execution", "rom", "snapshot", "registers", "code"]);
    const destination = panelGroup(old, "code") ?? panelGroup(old, "registers");
    const layout = destination ? movePanel(old, "memory", { group: destination.id, side: "below" }) : openPanel(old, "memory");
    save(addDebugger(layout));
    return;
  }
  const saved = storage.getItem("dromaios:workspace:xt:1");
  if (saved === null) return;
  const old = decodeWorkspaceState(saved, ["screen", "execution", "rom", "snapshot"]);
  const root = old.root ? normalizeSplit({ kind: "split", id: "xt-expanded", axis: "horizontal", items: [
    area(.64, old.root), area(.36, tools),
  ] }) : tools;
  save(addDebugger({ root }));
}
