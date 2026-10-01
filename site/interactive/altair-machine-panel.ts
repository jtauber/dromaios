import { Cpu8080 } from "../../src/components/cpus/generated/8080-cpu.js";
import type { create8080AltairBasic } from "../../src/machines/generated/8080/altair-basic.js";
import { createAltairMemoryPanel } from "./altair-panel.js";
import { checkUnsigned } from "../../src/components/validation.js";

/** Connect the shared controls to the chapter's memory map, live PC, and sense-switch device. */
export function createAltairMachinePanel(machine: ReturnType<typeof create8080AltairBasic>, canAccessMemory: () => boolean, initialLowSwitches = 0) {
  checkUnsigned("Lower panel switches", initialLowSwitches, 0xff);
  let lowSwitches = initialLowSwitches;
  return createAltairMemoryPanel(machine.memory, {
    get value() { return machine.cpu.snapshot().pc; },
    set value(pc: number) {
      // Change only PC at an instruction boundary; preserve the other stored fields and wiring.
      machine.cpu = new Cpu8080(machine.memory, { ...machine.cpu.snapshot(), pc }, machine.ports);
    },
  }, {
    canAccessMemory,
    switches: {
      get value() { return (machine.sense.snapshot().switches << 8) | lowSwitches; },
      set value(value: number) { machine.sense.offer(value >>> 8); lowSwitches = value & 0xff; },
    },
  });
}
