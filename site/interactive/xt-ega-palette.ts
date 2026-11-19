import type { EgaPaletteWrite } from "../../src/components/devices/ibm-ega.js";
import { xtDebugLocation } from "./xt-inspection.js";
import type { DebugLocation } from "./instruction-debugger.js";
import type { XtBoundary, XtMachine } from "./xt-session.js";

export interface XtPaletteEntry {
  readonly caller: DebugLocation;
  readonly bytes: readonly number[];
  readonly ticks: number;
  readonly transfer: EgaPaletteWrite & { readonly kind: "output" };
}

/** An 8088 OUT strobes at most two adjacent ports, hence at most one palette data byte. */
export function createXtPaletteCapture(machine: XtMachine) {
  if (!("ega" in machine)) return undefined;
  let latest: EgaPaletteWrite | undefined;
  const dispose = machine.ega.observePaletteWrites(event => { latest = event; });
  return {
    dispose,
    capture(step: () => XtBoundary): XtBoundary {
      const previous = latest;
      const record = step();
      if (!latest || latest === previous || record.outcome !== "executed") return record;
      return { ...record, paletteWrite: {
        caller: xtDebugLocation(record.before), bytes: record.instruction?.bytes ?? [], ticks: machine.io.clock.ticks,
        transfer: { kind: "output", ...latest },
      } };
    },
  };
}
