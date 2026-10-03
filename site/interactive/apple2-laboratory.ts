import { mountApple2 } from "./apple2.js";
import { createWorkspace } from "./workspace/dock.js";
import { mountWorkspaceControls } from "./workspace/controls.js";
import type { LayoutNode, WorkspaceLayout } from "./workspace/layout.js";

const group = (...panels: string[]): LayoutNode => ({ kind: "tabs", id: `default-${panels[0]}`, panels, active: panels[0]!, collapsed: false });
const split = (id: string, axis: "horizontal" | "vertical", ratio: number, first: LayoutNode, second: LayoutNode): LayoutNode =>
  ({ kind: "split", id, axis, ratio, first, second });

/** Composition only: this starting arrangement contains tool IDs and proportions, not machine state. */
const defaultLayout: WorkspaceLayout = {
  root: split("columns", "horizontal", .44,
    split("screen-and-cpu", "vertical", .65, group("screen"),
      split("cpu-details", "horizontal", .5,
        split("registers-and-instruction", "vertical", .45, group("registers"), group("instruction")), group("trace"))),
    split("memory-and-tools", "horizontal", .47,
      split("zero-and-memory", "vertical", .36, group("zero"),
        split("memory-and-stack", "vertical", .55, group("memory"), group("stack"))),
      group("rom", "code", "log", "system", "disk"))),
};

for (const root of document.querySelectorAll<HTMLElement>("[data-laboratory]")) {
  const tools = mountApple2(root);
  let refreshPending = false;
  function refreshVisibleTools(): void {
    if (refreshPending) return;
    refreshPending = true;
    queueMicrotask(() => { refreshPending = false; tools.refresh(); });
  }
  const panels = [...root.querySelectorAll<HTMLElement>("[data-workspace-panel]")].map(content => ({
    id: content.dataset.workspacePanel!, title: content.dataset.panelTitle!,
    heading: content.dataset.panelHeading, detail: content.dataset.panelDetail, content,
  }));
  const status = document.createElement("span"); status.className = "workspace-status"; status.setAttribute("role", "status");
  const workspace = createWorkspace(root.querySelector<HTMLElement>("[data-workspace-root]")!,
    root.querySelector<HTMLElement>("[data-workspace-panels]")!, panels, {
      defaults: defaultLayout, storageKey: "dromaios:workspace:apple2",
      onShow: refreshVisibleTools, onStatus: message => { status.textContent = message; },
    });
  mountWorkspaceControls(root.querySelector<HTMLElement>("[data-workspace-controls]")!, workspace, status);
}
