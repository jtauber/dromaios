/** Presentation state only: panel identities, group membership, and geometry. */
export interface TabGroup {
  readonly kind: "tabs";
  readonly id: string;
  readonly panels: readonly string[];
  readonly active: string;
  readonly collapsed: boolean;
}
export interface Split {
  readonly kind: "split";
  readonly id: string;
  readonly axis: "horizontal" | "vertical";
  readonly ratio: number;
  readonly first: LayoutNode;
  readonly second: LayoutNode;
}
export type LayoutNode = TabGroup | Split;
export interface Box { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface WorkspaceLayout { readonly root: LayoutNode | null }
export type DockSide = "left" | "right" | "above" | "below";
export type DropTarget = { readonly group: string; readonly side: "tab" | DockSide; readonly index?: number };

export function groups(layout: WorkspaceLayout): readonly TabGroup[] {
  const visit = (node: LayoutNode | null): TabGroup[] => node === null ? [] : node.kind === "tabs" ? [node]
    : [...visit(node.first), ...visit(node.second)];
  return visit(layout.root);
}
export function panelGroup(layout: WorkspaceLayout, panel: string): TabGroup | undefined {
  return groups(layout).find(group => group.panels.includes(panel));
}
function mapNode(node: LayoutNode, transform: (node: LayoutNode) => LayoutNode): LayoutNode {
  return transform(node.kind === "tabs" ? node : { ...node, first: mapNode(node.first, transform), second: mapNode(node.second, transform) });
}
function mapGroups(layout: WorkspaceLayout, transform: (group: TabGroup) => TabGroup): WorkspaceLayout {
  return { root: layout.root && mapNode(layout.root, node => node.kind === "tabs" ? transform(node) : node) };
}
function nextId(layout: WorkspaceLayout, prefix: string): string {
  const ids = new Set<string>();
  if (layout.root) mapNode(layout.root, node => { ids.add(node.id); return node; });
  let n = 1; while (ids.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}
export function activatePanel(layout: WorkspaceLayout, panel: string): WorkspaceLayout {
  return mapGroups(layout, group => group.panels.includes(panel) ? { ...group, active: panel, collapsed: false } : group);
}
export function closePanel(layout: WorkspaceLayout, panel: string): WorkspaceLayout {
  function remove(group: TabGroup): TabGroup | null {
    const panels = group.panels.filter(id => id !== panel);
    if (!panels.length) return null;
    const active = group.active === panel ? panels[Math.min(group.panels.indexOf(panel), panels.length - 1)]! : group.active;
    return { ...group, panels, active };
  }
  function visit(node: LayoutNode): LayoutNode | null {
    if (node.kind === "tabs") return remove(node);
    const first = visit(node.first), second = visit(node.second);
    return first && second ? { ...node, first, second } : first ?? second;
  }
  return { root: layout.root && visit(layout.root) };
}

/** Move one existing view, or place a previously closed view. Empty containers collapse. */
export function movePanel(layout: WorkspaceLayout, panel: string, target: DropTarget): WorkspaceLayout {
  const source = panelGroup(layout, panel);
  const destination = groups(layout).find(group => group.id === target.group);
  if (!destination) throw new Error("Choose an open destination panel.");
  if (target.side === "tab") {
    const group = destination!;
    const index = target.index ?? group.panels.length;
    if (!Number.isInteger(index) || index < 0 || index > group.panels.length) throw new RangeError("Invalid tab position.");
    const panels = group.panels.filter(id => id !== panel);
    const oldIndex = group.panels.indexOf(panel);
    panels.splice(index - (oldIndex >= 0 && oldIndex < index ? 1 : 0), 0, panel);
    // In-place reordering must not remove a one-tab destination group.
    const base = source?.id === group.id ? layout : closePanel(layout, panel);
    return mapGroups(base, current => current.id === group.id ? { ...current, panels, active: panel, collapsed: false } : current);
  }
  if (destination?.id === source?.id && source?.panels.length === 1) return layout;
  const base = closePanel(layout, panel);
  const group: TabGroup = { kind: "tabs", id: nextId(layout, "group"), panels: [panel], active: panel, collapsed: false };
  const first = target.side === "left" || target.side === "above";
  const split = (node: LayoutNode): LayoutNode => node.id !== target.group ? node : {
    kind: "split", id: nextId(layout, "split"), axis: target.side === "left" || target.side === "right" ? "horizontal" : "vertical",
    ratio: .5, first: first ? group : node, second: first ? node : group,
  };
  return { ...base, root: base.root && mapNode(base.root, split) };
}
export function openPanel(layout: WorkspaceLayout, panel: string): WorkspaceLayout {
  if (panelGroup(layout, panel)) return activatePanel(layout, panel);
  const destination = groups(layout)[0];
  if (destination) return movePanel(layout, panel, { group: destination.id, side: "tab" });
  return { root: { kind: "tabs", id: "group-1", panels: [panel], active: panel, collapsed: false } };
}
export function resizeSplit(layout: WorkspaceLayout, id: string, ratio: number): WorkspaceLayout {
  if (!Number.isFinite(ratio)) throw new RangeError("Invalid split size.");
  return { ...layout, root: layout.root && mapNode(layout.root, node => node.kind === "split" && node.id === id
    ? { ...node, ratio: Math.max(.1, Math.min(.9, ratio)) } : node) };
}
/** Collapse affects presentation only; the active tab and split proportions are retained. */
export function collapseGroup(layout: WorkspaceLayout, id: string, collapsed: boolean): WorkspaceLayout {
  return mapGroups(layout, group => group.id === id ? { ...group, collapsed } : group);
}

/** A fully collapsed subtree needs only its headers and the gaps between them. */
export function collapsedHeight(node: LayoutNode, headerHeight: number, gap: number): number | undefined {
  if (node.kind === "tabs") return node.collapsed ? headerHeight : undefined;
  const first = collapsedHeight(node.first, headerHeight, gap), second = collapsedHeight(node.second, headerHeight, gap);
  if (first === undefined || second === undefined) return undefined;
  return node.axis === "vertical" ? first + gap + second : Math.max(first, second);
}
