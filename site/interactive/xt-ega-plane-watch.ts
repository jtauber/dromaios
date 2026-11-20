import type { EgaMemoryWrite, IbmEga } from "../../src/components/devices/ibm-ega.js";
import type { InstructionBreakpoint } from "./instruction-debugger.js";
import { xtHex as hex } from "./8088-disassembly.js";

export const egaPlanes = ["P0", "P1", "P2", "P3"] as const;
export const planeByteLabel = (plane: number, offset: number) => `${egaPlanes[plane]}:$${hex(offset, 4)}`;

export interface EgaPlaneStore {
  readonly plane: number;
  readonly write: EgaMemoryWrite;
}

/** Watch decoded storage, so changing the CPU aperture or display page does not move a watch. */
export function createXtEgaPlaneWatches(current: () => IbmEga | undefined) {
  let points: readonly InstructionBreakpoint[] = [], detach: (() => void)[] = [];
  let active = false, first: EgaPlaneStore | undefined;
  function dispose(): void {
    for (const remove of detach) remove();
    detach = []; first = undefined;
  }
  function reconnect(): void {
    dispose();
    const ega = current();
    if (!ega) return;
    for (const point of points) {
      if (!point.enabled) continue;
      const plane = egaPlanes.findIndex(name => name === point.space);
      detach.push(ega.observePlaneWrites(point.address, write => {
        if (active && !first && write.writeMode !== 3 && (write.enabledPlanes & (1 << plane))) first = { plane, write };
      }));
    }
  }
  return {
    get values() { return points; },
    get enabled() { return detach.length > 0; },
    get store() { return first; },
    set(values: readonly InstructionBreakpoint[]): void {
      if (values.length > 64 || values.some(p => !Number.isInteger(p.address) || p.address < 0 || p.address > 0xffff
        || typeof p.enabled !== "boolean" || !egaPlanes.some(name => name === p.space))
        || new Set(values.map(p => p.space + ":" + p.address)).size !== values.length) {
        throw new RangeError("Use up to 64 distinct EGA plane bytes in P0–P3 at offsets 0000–FFFF.");
      }
      points = values.map(({ address, space, enabled }) => ({ address, space, enabled }));
      reconnect();
    },
    capture<T>(step: () => T): T {
      first = undefined; active = true;
      try { return step(); }
      catch (cause) { first = undefined; throw cause; }
      finally { active = false; }
    },
    reconnect, dispose,
  };
}
