import { hex } from "./apple2-explorer.js";
import type { DebugLocation } from "./instruction-debugger.js";

interface BusAccess { readonly kind: "read" | "write"; readonly address: number }
export interface Apple2AccessCondition extends BusAccess { readonly caller: DebugLocation }
type AccessStop = Apple2AccessCondition & { readonly enabled: boolean };

export function apple2AccessKey({ caller, kind, address }: Apple2AccessCondition): string {
  return `${caller.space}:${caller.address}:${kind}:${address}`;
}

export function describeApple2Access({ caller, kind, address }: Apple2AccessCondition): string {
  return `$${hex(caller.address)} (${caller.space}) · ${kind.toUpperCase()} $${hex(address)}`;
}

export function validateApple2AccessStops(points: readonly AccessStop[]): readonly AccessStop[] {
  if (!Array.isArray(points) || points.length > 64) throw new RangeError("Keep at most 64 access stops.");
  const word = (value: number) => Number.isInteger(value) && value >= 0 && value <= 0xffff;
  const seen = new Set<string>();
  return points.map(({ caller, address, kind, enabled }) => {
    if (!caller || !word(caller.address) || !["ram", "device", "rom", "lc-upper", "lc-bank1", "lc-bank2"].includes(caller.space)
      || !word(address) || (kind !== "read" && kind !== "write") || typeof enabled !== "boolean") throw new Error("Invalid Apple II access stop.");
    const point = { caller: { space: caller.space, address: caller.address }, address, kind, enabled };
    const key = apple2AccessKey(point);
    if (seen.has(key)) throw new Error("Access stops must be distinct.");
    seen.add(key); return point;
  });
}

export function decodeApple2AccessStops(saved: string | null): readonly AccessStop[] {
  try { return validateApple2AccessStops(JSON.parse(saved ?? "[]")); }
  catch { return []; }
}

/** Match the observed instruction mapping and its completed data transfers in bus order. */
export function apple2AccessHit<T extends BusAccess>(points: readonly AccessStop[], caller: DebugLocation, transfers: readonly T[]): T | undefined {
  if (!points.length) return undefined;
  return transfers.find(access => points.some(point => point.enabled && point.caller.address === caller.address
    && point.caller.space === caller.space && point.kind === access.kind && point.address === access.address));
}
