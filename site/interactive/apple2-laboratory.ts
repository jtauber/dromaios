import { mountApple2 } from "./apple2.js";
import { createWorkspace } from "./workspace/dock.js";
import type { Workspace } from "./workspace/dock.js";
import { mountWorkspaceControls } from "./workspace/controls.js";
import { apple2DefaultLayout, apple2WorkspaceKey, migrateApple2Workspace } from "./apple2-workspace.js";

for (const root of document.querySelectorAll<HTMLElement>("[data-laboratory]")) {
  let workspace: Workspace | undefined;
  const tools = mountApple2(root, id => workspace?.show(id));
  const pending = new Set<string>();
  function refreshVisibleTool(id: string): void {
    const scheduled = pending.size > 0;
    pending.add(id);
    if (scheduled) return;
    queueMicrotask(() => { tools.refreshPanels([...pending]); pending.clear(); });
  }
  const panels = [...root.querySelectorAll<HTMLElement>("[data-workspace-panel]")].map(content => ({
    id: content.dataset.workspacePanel!, title: content.dataset.panelTitle!,
    heading: content.dataset.panelHeading, detail: content.dataset.panelDetail, content,
    controls: tools.controls(content.dataset.workspacePanel!),
  }));
  const status = document.createElement("span"); status.className = "workspace-status"; status.setAttribute("role", "status");
  try { migrateApple2Workspace(window.localStorage, panels.map(panel => panel.id)); }
  catch { /* The workspace can still use its defaults if old preferences cannot be migrated. */ }
  workspace = createWorkspace(root.querySelector<HTMLElement>("[data-workspace-root]")!,
    root.querySelector<HTMLElement>("[data-workspace-panels]")!, panels, {
      defaults: apple2DefaultLayout, storageKey: apple2WorkspaceKey,
      onShow: refreshVisibleTool, onStatus: message => { status.textContent = message; },
    });
  mountWorkspaceControls(document.getElementById(root.dataset.layoutControls!)!, workspace, status);
}
