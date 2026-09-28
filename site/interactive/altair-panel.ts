import type { Ram } from "../../src/components/memory/ram.js";

/** Address storage can belong to the panel or connect to a processor's PC. */
interface PanelAddress { value: number; }

/** The lesson's stopped-memory controls, without bus-cycle emulation. */
export function createAltairMemoryPanel(ram: Ram, address: PanelAddress = { value: 0 }) {
  if (ram.size !== 0x10000) throw new RangeError("The lesson panel requires 65,536 bytes of RAM.");
  let switches = 0;
  const advance = () => { address.value = (address.value + 1) & 0xffff; };
  const deposit = () => { ram.write(address.value, switches & 0xff); };

  return {
    get switches() { return switches; },
    get address() { return address.value; },
    get data() { return ram.read(address.value); },
    toggleSwitch(bit: number): void {
      if (!Number.isInteger(bit) || bit < 0 || bit > 15) throw new RangeError("Switch numbers run from 0 to 15.");
      switches ^= 1 << bit;
    },
    examine(): void { address.value = switches; },
    examineNext(): void { advance(); },
    deposit,
    depositNext(): void { advance(); deposit(); },
  };
}
