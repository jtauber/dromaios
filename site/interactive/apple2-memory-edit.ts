import type { createApple2Session } from "./apple2-session.js";
import { apple2RamRegions } from "./apple2-inspection.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";
import { checkUnsigned } from "../../src/components/validation.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];
export interface Apple2MemoryEdit extends Omit<Apple2MemoryChange, "after"> {
  readonly machine: Machine;
}

/** Capture the read mapping shown by an inspector, independently of CPU write protection. */
export function apple2EditableMemory(machine: Machine) {
  const language = machine.language.snapshot();
  return (address: number, before: number): Apple2MemoryEdit => {
    checkUnsigned("Memory address", address, 0xffff);
    checkUnsigned("Displayed byte", before, 0xff);
    if (address >= 0xc000 && (address < 0xd000 || !language.ram_read)) {
      throw new Error("ROM and device addresses are read-only. Select a visible RAM byte.");
    }
    const region = address < 0xc000 ? "ram" : address >= 0xe000 ? "upper" : language.bank2 ? "bank2" : "bank1";
    return { machine, region, address, before };
  };
}

/** A debugger edit writes physical storage, never the guest bus or a soft switch. */
export function editApple2Memory(machine: Machine, edit: Apple2MemoryEdit, text: string): Apple2MemoryChange | undefined {
  if (!/^\$?[\da-f]{1,2}$/i.test(text.trim())) throw new RangeError("Enter a hexadecimal byte from 00 to FF.");
  if (machine !== edit.machine || apple2EditableMemory(machine)(edit.address, edit.before).region !== edit.region) {
    throw new Error("The displayed RAM bank has changed. Select the byte again.");
  }
  const { base } = apple2RamRegions.find(region => region.part === edit.region)!;
  const storage = machine[edit.region], offset = edit.address - base;
  if (storage.read(offset) !== edit.before) throw new Error("This byte has changed. Refresh the inspector and select it again.");
  const after = parseInt(text.trim().replace(/^\$/, ""), 16);
  if (after === edit.before) return undefined;
  storage.write(offset, after);
  return { region: edit.region, address: edit.address, before: edit.before, after };
}
