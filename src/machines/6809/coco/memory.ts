import type { Coco } from "./runtime.ts";

/** Capacity belongs to the board; SAM latches cannot manufacture installed RAM. */
export function cocoMemorySupported(machine: Pick<Coco, "ram" | "sam">): boolean {
  return machine.ram.size === 0x10000 ? machine.sam.supported64Memory() : machine.sam.supportedMemory();
}

/** Read-only address observation, matching the chapter's RAM windows without bus effects. */
export function cocoRamAddress(machine: Pick<Coco, "ram" | "sam">, address: number): number | undefined {
  if (!cocoMemorySupported(machine)) return undefined;
  const expanded = machine.ram.size === 0x10000;
  if (address < 0x8000 || expanded && machine.sam.allRam() && address < 0xff00) {
    return expanded ? machine.sam.cpuRamAddress(address) : address;
  }
  return undefined;
}

/** The VDG sees physical RAM independently of the CPU's page and ROM selection. */
export function cocoDisplayAddress(machine: Pick<Coco, "ram" | "sam">, row: number, column: number): number {
  return machine.sam.displayAddress(row, column) & (machine.ram.size - 1);
}
