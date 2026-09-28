import type { Ram } from "../../src/components/memory/ram.js";

/** The lesson's stopped-memory controls, without CPU or bus-cycle emulation. */
export function createAltairMemoryPanel(ram: Ram) {
  if (ram.size !== 0x10000) throw new RangeError("The lesson panel requires 65,536 bytes of RAM.");
  let switches = 0;
  let address = 0;
  const advance = () => { address = (address + 1) & 0xffff; };
  const deposit = () => { ram.write(address, switches & 0xff); };

  return {
    get switches() { return switches; },
    get address() { return address; },
    get data() { return ram.read(address); },
    toggleSwitch(bit: number): void {
      if (!Number.isInteger(bit) || bit < 0 || bit > 15) throw new RangeError("Switch numbers run from 0 to 15.");
      switches ^= 1 << bit;
    },
    examine(): void { address = switches; },
    examineNext(): void { advance(); },
    deposit,
    depositNext(): void { advance(); deposit(); },
  };
}
