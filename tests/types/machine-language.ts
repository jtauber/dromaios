import type { Cpu8008State } from "../../src/components/cpus/8008.js";
import type { Cpu8080State } from "../../src/components/cpus/8080.js";
import type { Cpu6502State } from "../../src/components/cpus/6502.js";
import type { Cpu6800State } from "../../src/components/cpus/6800.js";
import type { Cpu6809State } from "../../src/components/cpus/6809.js";
import type { CpuZ80State } from "../../src/components/cpus/z80.js";
import { parseMachine } from "../../src/machines/machine-language.js";

// Compiled, never called: the model discriminant must narrow the parsed state.
export function checkParsedState(source: string): void {
  const machine = parseMachine(source);
  const endAddress: number | undefined = machine.endAddress;
  switch (machine.cpu) {
    case "8008": {
      const state: Cpu8008State = machine.initialState;
      const size: 0x4000 = machine.ramSize;
      const address: number = state.addressStack[7];
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
      const size: 0x10000 = machine.ramSize;
      const sp: number = state.sp;
      // @ts-expect-error The 6800 has no 6809 direct-page register.
      state.dp;
      // @ts-expect-error The 6800 has no 6809 F interrupt mask.
      state.flags.f;
      break;
    }
  }
}
