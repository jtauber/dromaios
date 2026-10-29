import { captureMemory } from "./memory-window.js";

export type MemoryRegister6809 = "s" | "u" | "dp";
type Pointers6809 = Readonly<Record<MemoryRegister6809, number>>;

/** Each held tool owns its bytes and pointers. Changes compare addresses, not positions on screen. */
export function create6809MemoryObservation() {
  let image: Int16Array = new Int16Array(0x10000).fill(-1), previous = image;
  let pointers: Pointers6809 = { s: 0, u: 0, dp: 0 }, initialized = false;
  function byte(address: number) {
    address &= 0xffff;
    const value = image[address]!, before = previous[address]!;
    return { address, value: value < 0 ? undefined : value, before: before < 0 ? undefined : before,
      changed: value >= 0 && before >= 0 && value !== before };
  }
  return {
    byte,
    pointer: (register: MemoryRegister6809): number => pointers[register],
    word(address: number): number | undefined {
      const high = byte(address).value, low = byte(address + 1).value;
      return high === undefined || low === undefined ? undefined : high * 256 + low;
    },
    reset(): void { initialized = false; previous = image; },
    refresh(read: (address: number) => number | undefined, state: Pointers6809): void {
      previous = image; image = captureMemory(read);
      if (!initialized) previous = image;
      pointers = { s: state.s, u: state.u, dp: state.dp }; initialized = true;
    },
  };
}

/** A bounded window, not inferred frames: the 6809 exposes no stack bounds or empty-stack marker. */
export function stack6809Rows(pointer: number, width: 1 | 2) {
  return Array.from({ length: 34 / width }, (_, index) => {
    const offset = index * width - 2;
    return { offset, address: (pointer + offset) & 0xffff };
  });
}
