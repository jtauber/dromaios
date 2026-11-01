import type { CompositionDefinition } from "../src/machines/language/composition.ts";
import type { XtStorageRegion } from "./interactive/xt-inspection.ts";

/** Publish only unconditional reads of physical RAM and ROM declared on the XT board. */
export function xtStorageRegions(machine: CompositionDefinition): XtStorageRegion[] {
  if (machine.connection.kind !== "mapped") throw new Error("Expected an XT memory map.");
  return machine.connection.regions.flatMap(region => {
    const window = "window" in region ? region.window : undefined;
    const route = window?.read[0];
    if (window && (window.read.length !== 1 || route?.when.length)) throw new Error("XT inspector needs a static read mapping.");
    const target = "component" in region ? { component: region.component, offset: 0 } : route?.target;
    if (!target || target === "discard") return [];
    const component = machine.components.find(part => part.name === target.component);
    if (!component || !("size" in component)) return [];
    const { name } = component;
    if (name !== "ram" && name !== "video" && name !== "bios" && name !== "basic") throw new Error("Unknown XT storage: " + name);
    return [{ start: region.start, size: window?.size ?? component.size, component: name, offset: target.offset }];
  });
}
