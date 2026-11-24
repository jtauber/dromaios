import type { DebugLocation } from "./instruction-debugger.js";

interface BusAccess { readonly kind: "read" | "write"; readonly address: number }
interface AccessCondition extends BusAccess { readonly caller: DebugLocation }
type AccessStop = AccessCondition & { readonly enabled: boolean };
const hex = (value: number) => value.toString(16).toUpperCase().padStart(4, "0");

function key({ caller, kind, address }: AccessCondition): string {
  return `${caller.space}:${caller.address}:${kind}:${address}`;
}

export function mappedLocationText(caller: DebugLocation): string {
  return `$${hex(caller.address)} (${caller.space})`;
}

export function describeMappedAccess({ caller, kind, address }: AccessCondition): string {
  return `${mappedLocationText(caller)} · ${kind.toUpperCase()} $${hex(address)}`;
}

/** Instruction-qualified stops for 16-bit machines. Each adapter supplies its observed mappings and transfer kinds. */
export function createMappedAccessStops(spaces: readonly string[], kinds: readonly BusAccess["kind"][]) {
  let points: readonly AccessStop[] = [];
  function validate(values: readonly AccessStop[]): readonly AccessStop[] {
    if (!Array.isArray(values) || values.length > 64) throw new RangeError("Keep at most 64 access stops.");
    const word = (value: number) => Number.isInteger(value) && value >= 0 && value <= 0xffff;
    const seen = new Set<string>();
    return values.map(({ caller, address, kind, enabled }) => {
      if (!caller || !word(caller.address) || !spaces.includes(caller.space) || !word(address)
        || !kinds.includes(kind) || typeof enabled !== "boolean") throw new Error("Invalid instruction access stop.");
      const point = { caller: { space: caller.space, address: caller.address }, address, kind, enabled };
      const id = key(point);
      if (seen.has(id)) throw new Error("Access stops must be distinct.");
      seen.add(id); return point;
    });
  }
  return {
    key, describe: describeMappedAccess,
    values: () => points,
    set(values: readonly AccessStop[]): void { points = validate(values); },
    decode(saved: string | null): readonly AccessStop[] {
      try { return validate(JSON.parse(saved ?? "[]")); }
      catch { return []; }
    },
    match<T extends BusAccess>(caller: DebugLocation, transfers: readonly T[]): T | undefined {
      if (!points.length) return undefined;
      return transfers.find(access => points.some(point => point.enabled && point.caller.address === caller.address
        && point.caller.space === caller.space && point.kind === access.kind && point.address === access.address));
    },
  };
}
