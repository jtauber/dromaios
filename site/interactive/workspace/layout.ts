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
  readonly items: readonly SplitItem[];
}
export interface SplitItem { readonly node: LayoutNode; readonly weight: number }
export type LayoutNode = TabGroup | Split;
export interface Box { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface WorkspaceLayout { readonly root: LayoutNode | null }
export type DockSide = "left" | "right" | "above" | "below";
export type DropTarget = { readonly group: string; readonly side: "tab" | DockSide; readonly index?: number };

export function groups(layout: WorkspaceLayout): readonly TabGroup[] {
  const visit = (node: LayoutNode | null): TabGroup[] => node === null ? [] : node.kind === "tabs" ? [node]
    : node.items.flatMap(item => visit(item.node));
  return visit(layout.root);
}
export function panelGroup(layout: WorkspaceLayout, panel: string): TabGroup | undefined {
  return groups(layout).find(group => group.panels.includes(panel));
}
function mapNode(node: LayoutNode, transform: (node: LayoutNode) => LayoutNode): LayoutNode {
  return transform(node.kind === "tabs" ? node : { ...node, items: node.items.map(item => ({ ...item, node: mapNode(item.node, transform) })) });
}
/** Same-direction children belong to one row or column; only direction changes nest. */
export function normalizeSplit(split: Split): LayoutNode {
  const items = split.items.flatMap(item => {
    const child = item.node.kind === "split" ? normalizeSplit(item.node) : item.node;
    if (child.kind !== "split" || child.axis !== split.axis) return [{ ...item, node: child }];
    const total = child.items.reduce((sum, part) => sum + part.weight, 0);
    return child.items.map(part => ({ node: part.node, weight: item.weight * (part.weight / total) }));
  });
  return items.length === 1 ? items[0]!.node : { ...split, items };
}
export function parentSplit(layout: WorkspaceLayout, id: string): Split | undefined {
  function visit(node: LayoutNode | null): Split | undefined {
    if (!node || node.kind === "tabs") return undefined;
    if (node.items.some(item => item.node.id === id)) return node;
    for (const item of node.items) { const parent = visit(item.node); if (parent) return parent; }
    return undefined;
  }
  return visit(layout.root);
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
    const items = node.items.flatMap(item => { const child = visit(item.node); return child ? [{ ...item, node: child }] : []; });
    return items.length ? normalizeSplit({ ...node, items }) : null;
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
  const axis = target.side === "left" || target.side === "right" ? "horizontal" : "vertical";
  const before = target.side === "left" || target.side === "above";
  const parent = parentSplit(layout, destination.id);
  // Moving a whole panel within its row/column is a permutation, including its size and collapse state.
  if (source?.panels.length === 1 && parent?.axis === axis && parent.items.some(item => item.node.id === source.id)) {
    const moving = parent.items.find(item => item.node.id === source.id)!;
    const items = parent.items.filter(item => item !== moving);
    const index = items.findIndex(item => item.node.id === destination.id);
    items.splice(index + (before ? 0 : 1), 0, moving);
    return { root: layout.root && mapNode(layout.root, node => node.id === parent.id ? { ...parent, items } : node) };
  }
  const base = closePanel(layout, panel);
  const group: TabGroup = source?.panels.length === 1 ? source
    : { kind: "tabs", id: nextId(layout, "group"), panels: [panel], active: panel, collapsed: false };
  const splitId = nextId(layout, "split");
  const insert = (node: LayoutNode): LayoutNode => {
    if (node.id === target.group) return { kind: "split", id: splitId, axis,
      items: (before ? [group, node] : [node, group]).map(node => ({ node, weight: 1 })) };
    return node.kind === "split" ? normalizeSplit(node) : node;
  };
  return { root: base.root && mapNode(base.root, insert) };
}
export function openPanel(layout: WorkspaceLayout, panel: string): WorkspaceLayout {
  if (panelGroup(layout, panel)) return activatePanel(layout, panel);
  const destination = groups(layout)[0];
  if (destination) return movePanel(layout, panel, { group: destination.id, side: "tab" });
  return { root: { kind: "tabs", id: "group-1", panels: [panel], active: panel, collapsed: false } };
}
/** A divider redistributes only its two neighbours' combined weight. */
export function resizeItems(split: Split, index: number, ratio: number): Split {
  if (!Number.isFinite(ratio)) throw new RangeError("Invalid split size.");
  if (!Number.isInteger(index) || index < 0 || index >= split.items.length - 1) throw new RangeError("Invalid divider.");
  const total = split.items[index]!.weight + split.items[index + 1]!.weight;
  const first = total * Math.max(.1, Math.min(.9, ratio));
  return { ...split, items: split.items.map((item, i) => i === index ? { ...item, weight: first }
    : i === index + 1 ? { ...item, weight: total - first } : item) };
}
export function resizeSplit(layout: WorkspaceLayout, id: string, index: number, ratio: number): WorkspaceLayout {
  return { ...layout, root: layout.root && mapNode(layout.root, node => node.kind === "split" && node.id === id
    ? resizeItems(node, index, ratio) : node) };
}
/** Collapse affects presentation only; the active tab and split proportions are retained. */
export function collapseGroup(layout: WorkspaceLayout, id: string, collapsed: boolean): WorkspaceLayout {
  return mapGroups(layout, group => group.id === id ? { ...group, collapsed } : group);
}

/** A fully collapsed subtree needs only its headers and the gaps between them. */
export function collapsedHeight(node: LayoutNode, headerHeight: number, gap: number): number | undefined {
  if (node.kind === "tabs") return node.collapsed ? headerHeight : undefined;
  const heights: number[] = [];
  for (const item of node.items) {
    const height = collapsedHeight(item.node, headerHeight, gap);
    if (height === undefined) return undefined;
    heights.push(height);
  }
  return node.axis === "vertical" ? heights.reduce((sum, height) => sum + height, gap * (heights.length - 1)) : Math.max(...heights);
}
