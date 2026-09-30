import type { ByteMemoryConnection } from "../../src/components/memory/connection.js";

/** A panel word can be stored locally or supplied by the connected machine. */
interface PanelWord { value: number; }

/** Instruction-boundary controls. Display reads require a memory connection without read side effects. */
export function createAltairMemoryPanel(memory: ByteMemoryConnection, address: PanelWord = { value: 0 }, {
  switches = { value: 0 }, canAccessMemory = () => true,
}: { readonly switches?: PanelWord; readonly canAccessMemory?: () => boolean } = {}) {
  if (memory.size !== 0x10000) throw new RangeError("The panel requires a 16-bit memory address space.");
  const advance = () => { address.value = (address.value + 1) & 0xffff; };
  const deposit = () => { memory.write(address.value, switches.value & 0xff); };
  const requireStopped = () => { if (!canAccessMemory()) throw new Error("STOP before examining or depositing memory."); };

  return {
    get switches() { return switches.value; },
    get address() { return address.value; },
    get data() { return memory.read(address.value); },
    toggleSwitch(bit: number): void {
      if (!Number.isInteger(bit) || bit < 0 || bit > 15) throw new RangeError("Switch numbers run from 0 to 15.");
      switches.value ^= 1 << bit;
    },
    examine(): void { requireStopped(); address.value = switches.value; },
    examineNext(): void { requireStopped(); advance(); },
    deposit(): void { requireStopped(); deposit(); },
    depositNext(): void { requireStopped(); advance(); deposit(); },
  };
}
