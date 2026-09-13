import type { Cpu8080State } from "../../src/components/cpus/8080.js";
import type { Cpu6502State } from "../../src/components/cpus/6502.js";
import type { Cpu6809State } from "../../src/components/cpus/6809.js";
import { parseMachine } from "../../src/machines/machine-language.js";

// Compiled, never called: the model discriminant must narrow the parsed state.
export function checkParsedState(source: string): void {
  const machine = parseMachine(source);
  const endAddress: number | undefined = machine.endAddress;
  switch (machine.cpu) {
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
  }
}
