import type { Cpu8008State } from "../../src/components/cpus/generated/8008-cpu.js";
import type { Cpu8080State } from "../../src/components/cpus/generated/8080-cpu.js";
import type { Cpu8088State } from "../../src/components/cpus/8088.js";
import type { Cpu6502State } from "../../src/components/cpus/generated/6502-cpu.js";
import type { Cpu6800State } from "../../src/components/cpus/6800.js";
import type { Cpu6809State } from "../../src/components/cpus/6809.js";
import type { Cpu68000State } from "../../src/components/cpus/68000.js";
import type { CpuZ80State } from "../../src/components/cpus/z80.js";
import { parseMachine } from "../../src/machines/machine-language.js";

// Compiled, never called: the model discriminant must narrow the parsed state.
export function checkParsedState(source: string): void {
  const machine = parseMachine(source);
  const endAddress: number | undefined = machine.endAddress;
  switch (machine.cpu) {
    case "68000": {
      const state: Cpu68000State = machine.initialState;
      if ("ramSize" in machine) { const size: 0x1000000 = machine.ramSize; }
      const pc: number = state.pc;
      // @ts-expect-error A7 is derived from the two stored stack pointers.
      state.a7;
      // @ts-expect-error The original 68000 has no later-family master bit.
      state.flags.m;
      break;
    }
    case "8088": {
      const state: Cpu8088State = machine.initialState;
      if ("ramSize" in machine) { const size: 0x100000 = machine.ramSize; }
      const ip: number = state.ip;
      // @ts-expect-error The physical PC is derived from CS:IP, not assigned.
      state.pc;
      // @ts-expect-error Byte-register views are derived from word registers.
      state.al;
      break;
    }
    case "8008": {
      const state: Cpu8008State = machine.initialState;
      if ("ramSize" in machine) { const size: 0x4000 = machine.ramSize; }
      const address: number = state.addressStack[7];
      // @ts-expect-error Parsed caller state retains the chapter's readonly address-register policy.
      machine.initialState.addressStack[0] = 0;
      // @ts-expect-error PC is a derived snapshot view.
      state.pc;
      // @ts-expect-error Address stacks have exactly eight entries.
      state.addressStack[8];
      break;
    }
    case "z80": {
      const state: CpuZ80State = machine.initialState;
      const im: 0 | 1 | 2 = state.im;
      const pv: boolean = state.alternate.flags.pv;
      // @ts-expect-error The parsed Z80 state has no 8080 carry flag.
      state.flags.cy;
      break;
    }
    case "8080": {
      const state: Cpu8080State = machine.initialState;
      // @ts-expect-error Numeric source bits become Boolean flags.
      const flag: number = state.flags.cy;
      break;
    }
    case "6502": {
      const state: Cpu6502State = machine.initialState;
      // @ts-expect-error A 6502 has no 8080 control latches.
      machine.initialState.halted;
      break;
    }
    case "6809": {
      const state: Cpu6809State = machine.initialState;
      // @ts-expect-error Derived registers are absent from stored initial state.
      machine.initialState.d;
      break;
    }
    case "6800": {
      const state: Cpu6800State = machine.initialState;
      if ("ramSize" in machine) { const size: 0x10000 = machine.ramSize; }
      const sp: number = state.sp;
      // @ts-expect-error The 6800 has no 6809 direct-page register.
      state.dp;
      // @ts-expect-error The 6800 has no 6809 F interrupt mask.
      state.flags.f;
      break;
    }
  }
}
