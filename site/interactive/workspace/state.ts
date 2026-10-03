import type { LayoutNode, WorkspaceLayout } from "./layout.js";

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Layout preferences contain no tool, media, or machine state. */
export function encodeWorkspaceState(layout: WorkspaceLayout): string {
  return JSON.stringify({ version: 2, layout });
}
/** Reconstruct a bounded, known layout instead of trusting objects from local storage. */
export function decodeWorkspaceState(text: string, panelIds: readonly string[]): WorkspaceLayout {
  const fail = (): never => { throw new Error("Invalid or outdated workspace layout."); };
  if (text.length > 100_000) fail();
  const saved: unknown = JSON.parse(text);
  if (!object(saved) || saved.version !== 2 || !object(saved.layout)) return fail();
  const layout = saved.layout, nodes = new Set<string>(), panels = new Set<string>(), known = new Set(panelIds);
  function readNode(value: unknown, depth = 0): LayoutNode {
    if (depth > 32 || !object(value) || typeof value.id !== "string" || !/^[a-z0-9-]{1,80}$/.test(value.id)
      || nodes.has(value.id)) return fail();
    nodes.add(value.id);
    if (value.kind === "tabs") {
      if (typeof value.collapsed !== "boolean" || !Array.isArray(value.panels) || !value.panels.length || typeof value.active !== "string" || !value.panels.includes(value.active)) return fail();
      const ids: string[] = [];
      for (const id of value.panels) {
        if (typeof id !== "string" || !known.has(id) || panels.has(id)) return fail();
        panels.add(id); ids.push(id);
      }
      return { kind: "tabs", id: value.id, panels: ids, active: value.active, collapsed: value.collapsed };
    }
    if (value.kind !== "split" || (value.axis !== "horizontal" && value.axis !== "vertical")
      || !finite(value.ratio) || value.ratio < .1 || value.ratio > .9) return fail();
    return { kind: "split", id: value.id, axis: value.axis, ratio: value.ratio,
      first: readNode(value.first, depth + 1), second: readNode(value.second, depth + 1) };
  }
  const root = layout.root === null ? null : readNode(layout.root);
  return { root };
}
