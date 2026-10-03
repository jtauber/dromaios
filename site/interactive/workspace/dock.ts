import { activatePanel, closePanel, collapsedHeight, collapseGroup, groups, movePanel, openPanel, panelGroup, resizeSplit } from "./layout.js";
import type { Box, DropTarget, LayoutNode, Split, TabGroup, WorkspaceLayout } from "./layout.js";
import { decodeWorkspaceState, encodeWorkspaceState } from "./state.js";
import { dragPointer } from "./pointer.js";
import type { PointerPosition } from "./pointer.js";

export interface WorkspacePanel {
  readonly id: string;
  readonly title: string;
  readonly heading?: string;
  readonly detail?: string;
  /** Owned by the application: docking reparents this element but never recreates it. */
  readonly content: HTMLElement;
}
export type PanelPosition = "tab" | "left" | "right" | "above" | "below";
export interface Workspace {
  readonly panels: readonly WorkspacePanel[];
  isOpen(id: string): boolean;
  show(id: string): void;
  hide(id: string): void;
  move(id: string, position: PanelPosition, target?: string): void;
  reset(): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}
let workspaceSequence = 0;

/** Layout and interaction only. The host owns tool lifetime and supplies no simulation objects. */
export function createWorkspace(host: HTMLElement, parking: HTMLElement, panels: readonly WorkspacePanel[], options: {
  readonly defaults: WorkspaceLayout;
  readonly storageKey: string;
  readonly onShow: (id: string) => void;
  readonly onStatus: (message: string) => void;
}): Workspace {
  const definitions = new Map(panels.map(panel => [panel.id, panel]));
  if (definitions.size !== panels.length) throw new Error("Workspace panel IDs must be unique.");
  const prefix = `workspace-${++workspaceSequence}`, listeners = new Set<() => void>();
  const ids = panels.map(panel => panel.id);
  let layout = decodeWorkspaceState(encodeWorkspaceState(options.defaults), ids), timer: number | undefined;
  const definition = (id: string) => {
    const panel = definitions.get(id); if (!panel) throw new Error(`Unknown workspace panel: ${id}`); return panel;
  };
  function element(className: string): HTMLDivElement {
    const result = document.createElement("div"); result.className = className; return result;
  }
  // Reconcile containers without unnecessarily detaching focused inputs or canvases.
  function children(parent: HTMLElement, desired: readonly HTMLElement[]): void {
    desired.forEach((child, index) => { if (parent.children[index] !== child) parent.insertBefore(child, parent.children[index] ?? null); });
    while (parent.children.length > desired.length) parent.lastElementChild!.remove();
  }
  const tree = element("workspace-tree"), overlay = element("workspace-drop-preview");
  const empty = element("workspace-empty"); empty.textContent = "Use Panels to reopen a tool.";
  overlay.hidden = true; overlay.setAttribute("aria-hidden", "true"); host.append(tree, overlay);
  const groupViews = new Map<string, {
    root: HTMLElement; header: HTMLElement; body: HTMLElement; collapse: HTMLButtonElement;
    detail: HTMLElement; close: HTMLButtonElement;
  }>();
  const splitViews = new Map<string, { root: HTMLElement; divider: HTMLElement }>();
  const tabs = new Map<string, { root: HTMLElement; button: HTMLButtonElement }>();
  const visible = new Set<string>();
  let cancelGesture = () => {};
  function drag(event: PointerEvent, callbacks: Parameters<typeof dragPointer>[1]): void {
    cancelGesture(); cancelGesture = dragPointer(event, callbacks);
  }
  function save(): void {
    timer = undefined;
    try { window.localStorage.setItem(options.storageKey, encodeWorkspaceState(layout)); }
    catch { options.onStatus("Layout works for this visit, but this browser could not save it."); }
  }
  function commit(next: WorkspaceLayout): void {
    layout = next; render();
    scheduleSave();
    for (const listener of listeners) listener();
  }
  function scheduleSave(): void {
    window.clearTimeout(timer); timer = window.setTimeout(save, 200);
  }
  function boxStyle(element: HTMLElement, box: Box): void {
    Object.assign(element.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
  }
  // Keep these dimensions in step with workspace.css. A collapsed group is one header high.
  const headerHeight = 34, dividerSize = 6;
  const compactHeight = (node: LayoutNode) => collapsedHeight(node, headerHeight, dividerSize);
  function canResize(split: Split): boolean {
    return split.axis === "horizontal" || (compactHeight(split.first) === undefined && compactHeight(split.second) === undefined);
  }
  function splitStyle(root: HTMLElement, split: Split): void {
    const flexible = `minmax(0, ${split.ratio}fr) ${dividerSize}px minmax(0, ${1 - split.ratio}fr)`;
    root.style.gridTemplateColumns = split.axis === "horizontal" ? flexible : "minmax(0, 1fr)";
    if (split.axis === "horizontal") root.style.gridTemplateRows = "minmax(0, 1fr)";
    else {
      const first = compactHeight(split.first), second = compactHeight(split.second);
      root.style.gridTemplateRows = first === undefined && second === undefined ? flexible
        : `${first === undefined ? "minmax(0, 1fr)" : `${first}px`} ${dividerSize}px ${second === undefined ? "minmax(0, 1fr)" : `${second}px`}`;
    }
  }
  function findSplit(node: LayoutNode | null, id: string): Split | undefined {
    return !node || node.kind === "tabs" ? undefined : node.id === id ? node : findSplit(node.first, id) ?? findSplit(node.second, id);
  }
  function tab(id: string) {
    let view = tabs.get(id);
    if (view) return view;
    const panel = definition(id), root = element("workspace-tab"), button = document.createElement("button");
    root.dataset.panelTab = id; button.type = "button"; button.textContent = panel.title;
    button.id = `${prefix}-tab-${id}`; button.setAttribute("role", "tab"); button.setAttribute("aria-controls", `${prefix}-panel-${id}`);
    button.addEventListener("click", () => commit(activatePanel(layout, id)));
    button.addEventListener("keydown", event => {
      const group = panelGroup(layout, id); if (!group) return;
      const index = group.panels.indexOf(id), count = group.panels.length;
      const next = event.key === "ArrowRight" ? (index + 1) % count : event.key === "ArrowLeft" ? (index + count - 1) % count
        : event.key === "Home" ? 0 : event.key === "End" ? count - 1 : undefined;
      if (next !== undefined) {
        event.preventDefault(); const selected = group.panels[next]!;
        commit(activatePanel(layout, selected)); tabs.get(selected)!.button.focus();
      }
    });
    button.addEventListener("pointerdown", event => dragTab(event, id));
    root.append(button); view = { root, button }; tabs.set(id, view); return view;
  }
  function renderGroup(group: TabGroup): HTMLElement {
    let view = groupViews.get(group.id);
    if (!view) {
      const root = element("workspace-group"), heading = element("workspace-heading");
      const header = element("workspace-tabs"), body = element("workspace-body"), detail = element("workspace-panel-detail");
      const collapse = document.createElement("button"), close = document.createElement("button");
      root.dataset.workspaceGroup = group.id; header.setAttribute("role", "tablist"); header.setAttribute("aria-label", "Panel group");
      body.id = `${prefix}-body-${group.id}`;
      collapse.type = close.type = "button"; collapse.className = "workspace-collapse"; close.className = "workspace-close";
      collapse.setAttribute("aria-controls", body.id); close.textContent = "×";
      collapse.addEventListener("click", () => {
        const current = groups(layout).find(item => item.id === group.id)!;
        commit(collapseGroup(layout, current.id, !current.collapsed));
      });
      close.addEventListener("click", () => {
        const current = groups(layout).find(item => item.id === group.id)!;
        commit(closePanel(layout, current.active));
        const remaining = groups(layout), next = remaining.find(item => item.id === group.id) ?? remaining[0];
        if (next) tabs.get(next.active)!.button.focus();
      });
      heading.append(collapse, header, detail, close); root.append(heading, body);
      view = { root, header, body, collapse, detail, close }; groupViews.set(group.id, view);
    }
    const selected = definition(group.active), single = group.panels.length === 1;
    view.root.classList.toggle("is-single", single); view.root.classList.toggle("is-collapsed", group.collapsed);
    view.collapse.textContent = group.collapsed ? "▸" : "▾";
    view.collapse.setAttribute("aria-expanded", String(!group.collapsed));
    view.collapse.setAttribute("aria-label", `${group.collapsed ? "Expand" : "Collapse"} ${selected.title}`);
    view.close.setAttribute("aria-label", `Close ${selected.title}`);
    view.detail.textContent = single ? selected.detail ?? "" : "";
    view.body.hidden = group.collapsed;
    children(view.header, group.panels.map(id => {
      const view = tab(id), active = id === group.active;
      view.button.textContent = single ? definition(id).heading ?? definition(id).title : definition(id).title;
      view.button.setAttribute("aria-selected", String(active)); view.button.tabIndex = active ? 0 : -1;
      view.root.classList.toggle("is-active", active); return view.root;
    }));
    children(view.body, group.panels.map(id => definition(id).content));
    return view.root;
  }
  function renderNode(node: LayoutNode): HTMLElement {
    if (node.kind === "tabs") return renderGroup(node);
    let view = splitViews.get(node.id);
    if (!view) {
      const root = element("workspace-split"), divider = element("workspace-divider");
      divider.setAttribute("role", "separator"); divider.tabIndex = 0;
      divider.setAttribute("aria-valuemin", "10"); divider.setAttribute("aria-valuemax", "90");
      divider.addEventListener("pointerdown", event => {
        const split = findSplit(layout.root, node.id); if (!split || !canResize(split)) return;
        const rect = root.getBoundingClientRect();
        const ratio = ({ x, y }: PointerPosition) => Math.max(.1, Math.min(.9, split.axis === "horizontal"
          ? (x - rect.left) / rect.width : (y - rect.top) / rect.height));
        drag(event, { move: position => splitStyle(root, { ...split, ratio: ratio(position) }),
          finish: position => commit(resizeSplit(layout, split.id, ratio(position))), cancel: render });
      });
      divider.addEventListener("keydown", event => {
        const split = findSplit(layout.root, node.id); if (!split || !canResize(split)) return;
        const minus = split.axis === "horizontal" ? "ArrowLeft" : "ArrowUp", plus = split.axis === "horizontal" ? "ArrowRight" : "ArrowDown";
        const step = event.shiftKey ? .1 : .02;
        const ratio = event.key === minus ? split.ratio - step : event.key === plus ? split.ratio + step
          : event.key === "Home" ? .1 : event.key === "End" ? .9 : undefined;
        if (ratio !== undefined) { event.preventDefault(); commit(resizeSplit(layout, split.id, ratio)); }
      });
      view = { root, divider }; splitViews.set(node.id, view);
    }
    const horizontal = node.axis === "horizontal";
    view.root.dataset.workspaceSplit = node.id; view.divider.className = `workspace-divider ${horizontal ? "horizontal" : "vertical"}`;
    view.divider.setAttribute("aria-orientation", horizontal ? "vertical" : "horizontal");
    view.divider.setAttribute("aria-label", horizontal ? "Resize columns" : "Resize rows");
    view.divider.setAttribute("aria-valuenow", String(Math.round(node.ratio * 100)));
    view.divider.setAttribute("aria-disabled", String(!canResize(node))); view.divider.tabIndex = canResize(node) ? 0 : -1;
    splitStyle(view.root, node); children(view.root, [renderNode(node.first), view.divider, renderNode(node.second)]); return view.root;
  }
  function render(): void {
    const focused = document.activeElement instanceof HTMLElement && host.contains(document.activeElement) ? document.activeElement : undefined;
    const present = new Set(groups(layout).flatMap(group => group.panels)), active = new Set(groups(layout).filter(group => !group.collapsed).map(group => group.active));
    for (const panel of panels) {
      panel.content.id = `${prefix}-panel-${panel.id}`; panel.content.setAttribute("role", "tabpanel");
      panel.content.setAttribute("aria-labelledby", `${prefix}-tab-${panel.id}`);
      panel.content.hidden = !active.has(panel.id);
      if (!present.has(panel.id) && panel.content.parentElement !== parking) parking.append(panel.content);
    }
    children(tree, [layout.root ? renderNode(layout.root) : empty]);
    for (const id of [...groupViews.keys()]) if (!groups(layout).some(group => group.id === id)) groupViews.delete(id);
    for (const id of [...splitViews.keys()]) if (!findSplit(layout.root, id)) splitViews.delete(id);
    if (focused?.isConnected && !focused.closest("[hidden]") && document.activeElement !== focused) focused.focus({ preventScroll: true });
    for (const id of active) if (!visible.has(id)) options.onShow(id);
    visible.clear(); for (const id of active) visible.add(id);
  }
  function dropAt(position: PointerPosition): { target: DropTarget; rect: Box; label: string } | undefined {
    const hit = document.elementFromPoint(position.x, position.y), groupElement = hit?.closest<HTMLElement>("[data-workspace-group]");
    const hostRect = host.getBoundingClientRect();
    if (!groupElement || !host.contains(groupElement)) return undefined;
    const group = groups(layout).find(group => group.id === groupElement.dataset.workspaceGroup)!;
    const rect = groupElement.getBoundingClientRect(), x = position.x - rect.left, y = position.y - rect.top;
    const tabElement = hit?.closest<HTMLElement>("[data-panel-tab]"), header = hit?.closest(".workspace-heading");
    let side: PanelPosition = "tab", index: number | undefined;
    if (header) {
      if (tabElement) {
        const bounds = tabElement.getBoundingClientRect();
        index = group.panels.indexOf(tabElement.dataset.panelTab!) + (position.x > bounds.left + bounds.width / 2 ? 1 : 0);
      }
    } else {
      if (x < rect.width * .22) side = "left";
      else if (x > rect.width * .78) side = "right";
      else if (y < rect.height * .25) side = "above";
      else if (y > rect.height * .75) side = "below";
    }
    const preview = { x: rect.left - hostRect.left, y: rect.top - hostRect.top, width: rect.width, height: rect.height };
    if (side === "left" || side === "right") { preview.width /= 2; if (side === "right") preview.x += preview.width; }
    if (side === "above" || side === "below") { preview.height /= 2; if (side === "below") preview.y += preview.height; }
    return { target: { group: group.id, side, index }, rect: preview, label: side === "tab" ? "Add to tab group" : `Dock ${side}` };
  }
  function dragTab(event: PointerEvent, id: string): void {
    const update = (position: PointerPosition) => {
      const drop = dropAt(position); overlay.hidden = !drop;
      if (drop) { boxStyle(overlay, drop.rect); overlay.textContent = drop.label; }
      return drop;
    };
    drag(event, { move: position => { update(position); }, finish: position => {
      const drop = update(position); overlay.hidden = true;
      if (drop) { commit(movePanel(layout, id, drop.target)); options.onStatus(`${definition(id).title} moved.`); }
    }, cancel: () => { overlay.hidden = true; } });
  }
  try {
    const saved = window.localStorage.getItem(options.storageKey);
    if (saved !== null) layout = decodeWorkspaceState(saved, ids);
  } catch { options.onStatus("Saved layout unavailable. Using the default workspace."); }
  render();
  const flush = () => { if (timer !== undefined) { window.clearTimeout(timer); save(); } };
  window.addEventListener("pagehide", flush);
  return {
    panels, isOpen: id => panelGroup(layout, id) !== undefined,
    show(id) { definition(id); commit(openPanel(layout, id)); },
    hide(id) { definition(id); commit(closePanel(layout, id)); },
    move(id, position, target) {
      definition(id);
      const group = target === undefined ? undefined : panelGroup(layout, target);
      if (!group || target === id) throw new Error("Choose another open panel as the destination.");
      commit(movePanel(layout, id, { group: group.id, side: position }));
    },
    reset() { commit(options.defaults); options.onStatus("Default layout restored. The machine and tools are unchanged."); },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() {
      cancelGesture(); flush(); window.removeEventListener("pagehide", flush); listeners.clear();
      for (const panel of panels) { panel.content.hidden = true; parking.append(panel.content); }
      host.replaceChildren();
    },
  };
}
