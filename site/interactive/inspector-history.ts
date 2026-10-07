export type InspectorTool = "memory" | "code" | "rom";
export interface InspectorLocation { readonly tool: InspectorTool; readonly address: number }

const same = (a: InspectorLocation | undefined, b: InspectorLocation) => a?.tool === b.tool && a.address === b.address;

/** Explicit browsing only. Following execution and scrolling do not create entries. */
export function createInspectorHistory(capacity = 64) {
  if (!Number.isSafeInteger(capacity) || capacity < 2) throw new RangeError("Navigation capacity must be at least two.");
  let entries: InspectorLocation[] = [], index = -1;
  return {
    get back() { return entries[index - 1]; },
    get forward() { return entries[index + 1]; },
    visit(from: InspectorLocation, to: InspectorLocation): void {
      if (same(from, to)) return;
      entries.length = index + 1;
      if (!same(entries[index], from)) entries.push({ ...from });
      entries.push({ ...to });
      entries = entries.slice(-capacity); index = entries.length - 1;
    },
    move(direction: -1 | 1): InspectorLocation | undefined {
      const next = entries[index + direction];
      if (next) index += direction;
      return next;
    },
  };
}
