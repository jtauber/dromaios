import type { MemoryRoute } from "../../src/machines/language/memory-window.js";
import type { createApple2Session } from "./apple2-session.js";
import { hex } from "./apple2-explorer.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];
export interface Apple2HardwareCatalogue {
  readonly size: number;
  readonly undriven: number;
  readonly components: Readonly<Record<string, {
    readonly kind: string;
    readonly source: string;
    readonly read: Readonly<Record<number, string>>;
    readonly write: Readonly<Record<number, string>>;
  }>>;
  readonly regions: readonly {
    readonly start: number;
    readonly size: number;
    readonly read: readonly MemoryRoute[];
    readonly write: readonly MemoryRoute[];
  }[];
}

/** Small, detached observations: no guest reads, RAM copies, or disk-image snapshots. */
export function apple2HardwareState(machine: Machine) {
  return { keyboard: machine.keyboard.snapshot(), video: machine.video.snapshot(), language: machine.language.snapshot(),
    disk: machine.disk.inspect(), firmware: machine.firmware.loaded };
}
export type Apple2HardwareState = ReturnType<typeof apple2HardwareState>;
export const apple2ComponentNames: Readonly<Record<string, string>> = {
  ram: "Main RAM", firmware: "ROM", bank1: "LC bank 1", bank2: "LC bank 2", upper: "LC upper RAM",
  keyboard: "Keyboard", video: "Display", language: "Language Card", disk: "Disk II",
};

/** Evaluate the exported routing declarations against observed selector values, never the guest bus. */
export function apple2MemoryMap(catalogue: Apple2HardwareCatalogue, state: Apple2HardwareState) {
  const selectors: Readonly<Record<string, boolean>> = {
    "language.ramRead": state.language.ram_read, "language.ramWrite": state.language.ram_write, "language.bank2": state.language.bank2,
  };
  function describe(routes: readonly MemoryRoute[], direction: "read" | "write"): string {
    const route = routes.find(route => route.when.every(condition => {
      const key = `${condition.component}.${condition.view}`;
      if (!(key in selectors)) throw new Error(`Unknown Apple II inspection selector: ${key}`);
      return selectors[key];
    }));
    if (!route || route.target === "discard") return direction === "read" ? `Unmapped · $${hex(catalogue.undriven, 2)}` : "Discarded";
    const { component, offset } = route.target;
    const name = apple2ComponentNames[component] ?? component;
    if (component === "firmware" && !state.firmware || component === "disk" && !state.disk.installed) {
      return direction === "read" ? `${name} absent · $${hex(catalogue.undriven, 2)}` : "Discarded (card absent)";
    }
    return component === "disk" && offset >= 0x100 ? "Disk II bootstrap ROM" : name;
  }
  return catalogue.regions.map(region => ({ start: region.start, end: region.start + region.size - 1,
    read: describe(region.read, "read"), write: describe(region.write, "write") }));
}

/** Describe the declared operation. Access history separately supplies the byte actually transferred. */
export function apple2DeviceAccess(catalogue: Apple2HardwareCatalogue, address: number, direction: "read" | "write") {
  if (address < 0xc000 || address >= 0xd000) return undefined;
  const region = catalogue.regions.find(region => address >= region.start && address < region.start + region.size)!;
  const route = region[direction][0];
  if (!route || route.target === "discard") return { device: "unmapped", description: direction === "read"
    ? `No modeled device; bus supplies $${hex(catalogue.undriven, 2)}` : "Write discarded", source: "src/machines/6502/apple2.md#components-and-address-decoding" };
  if (route.when.length) throw new Error("Conditional Apple II I/O routing needs an observed mapping.");
  const { component, offset } = route.target, device = catalogue.components[component]!;
  const description = device[direction][address - region.start + offset];
  return { device: component, description: description ?? `Unbound ${direction}; ${direction === "read" ? "bus supplies the undriven value" : "write discarded"}`, source: device.source };
}
