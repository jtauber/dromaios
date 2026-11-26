import type { DebugLocation } from "./instruction-debugger.js";

interface BusAccess { readonly kind: "read" | "write"; readonly address: number }
interface AccessCondition extends BusAccess { readonly caller: DebugLocation; readonly expectedValue?: number }
type AccessStop = AccessCondition & { readonly enabled: boolean };
const hex = (value: number, width = 4) => value.toString(16).toUpperCase().padStart(width, "0");

function key({ caller, kind, address, expectedValue }: AccessCondition): string {
  return `${caller.space}:${caller.address}:${kind}:${address}:${expectedValue ?? "*"}`;
}

export function mappedLocationText(caller: DebugLocation): string {
  return `$${hex(caller.address)} (${caller.space})`;
}

export function describeMappedAccess({ caller, kind, address, expectedValue }: AccessCondition): string {
  return `${mappedLocationText(caller)} · ${kind.toUpperCase()} $${hex(address)}`
    + (expectedValue === undefined ? "" : ` = $${hex(expectedValue, 2)}`);
}

/** Taking a stop from history only constrains the byte when the reader chooses it. */
export function accessStopHistoryActions(add: (condition: AccessCondition) => void) {
  return {
    stopOnAccess: add,
    stopOnValue: (entry: AccessCondition & { readonly value: number }) => add({ ...entry, expectedValue: entry.value }),
  };
}

/** Instruction-qualified stops for 16-bit machines. Each adapter supplies its observed mappings and transfer kinds. */
export function createMappedAccessStops(spaces: readonly string[], kinds: readonly BusAccess["kind"][]) {
  let points: readonly AccessStop[] = [];
  function validate(values: readonly AccessStop[]): readonly AccessStop[] {
    if (!Array.isArray(values) || values.length > 64) throw new RangeError("Keep at most 64 access stops.");
    const word = (value: number) => Number.isInteger(value) && value >= 0 && value <= 0xffff;
    const seen = new Set<string>();
    return values.map(({ caller, address, kind, enabled, expectedValue }) => {
      if (!caller || !word(caller.address) || !spaces.includes(caller.space) || !word(address)
        || !kinds.includes(kind) || typeof enabled !== "boolean") throw new Error("Invalid instruction access stop.");
      if (expectedValue !== undefined && (!Number.isInteger(expectedValue) || expectedValue < 0 || expectedValue > 0xff))
        throw new RangeError("An access stop value must be a byte.");
      const point = { caller: { space: caller.space, address: caller.address }, address, kind, enabled,
        ...(expectedValue !== undefined && { expectedValue }) };
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
    match<T extends BusAccess & { readonly value: number }>(caller: DebugLocation, transfers: readonly T[]): T | undefined {
      if (!points.length) return undefined;
      return transfers.find(access => points.some(point => point.enabled && point.caller.address === caller.address
        && point.caller.space === caller.space && point.kind === access.kind && point.address === access.address
        && (point.expectedValue === undefined || point.expectedValue === access.value)));
    },
  };
}
