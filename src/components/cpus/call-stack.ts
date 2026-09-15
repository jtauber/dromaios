import type { ByteMemory } from "./memory-access.ts";

/**
 * 8080/Z80 calls use a descending 16-bit stack with low-first words in memory.
 * Push predecrements before each write (high then low); pop reads low then high.
 * Calls receive an already fetched target; PC already holds the return address.
 */
export function callStack16LE(state: { pc: number; sp: number }) {
  const push = (value: number, writeByte: ByteMemory["writeByte"]): void => {
    state.sp = (state.sp - 1) & 0xffff;
    writeByte(state.sp, value >>> 8);
    state.sp = (state.sp - 1) & 0xffff;
    writeByte(state.sp, value & 0xff);
  };
  const pop = (readByte: ByteMemory["readByte"]): number => {
    const low = readByte(state.sp);
    state.sp = (state.sp + 1) & 0xffff;
    const high = readByte(state.sp);
    state.sp = (state.sp + 1) & 0xffff;
    return low | (high << 8);
  };
  return {
    push, pop,
    call(address: number, writeByte: ByteMemory["writeByte"], take = true): void {
      if (!take) return;
      push(state.pc, writeByte);
      state.pc = address;
    },
    return(readByte: ByteMemory["readByte"], take = true): void {
      if (take) state.pc = pop(readByte);
    },
  };
}
