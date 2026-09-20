import { opcodeEntries } from "./generated/8008.ts";
import { instructions as stateActions, sourceReaders } from "./generated/8008-state.ts";
import { cpu8008StateDescription } from "./state/8008.ts";
import type { Cpu8008State, Cpu8008StoredState } from "./state/8008.ts";
import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition, InstructionStep, HaltedStep } from "./execution-records.ts";
import { readWordLE } from "./binary.ts";
import { executeByteInstruction, programCounter } from "./execute-byte-instruction.ts";
import { executionBoundary } from "./execution-boundary.ts";
import { recordInterruptInstruction } from "./interrupt-instruction.ts";
import type { InterruptInstruction, InterruptAcknowledge } from "./interrupt-instruction.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import { recordPorts } from "./port-access.ts";
import type { BytePorts, PortAccess } from "./port-access.ts";
import type { WordInstructionContext } from "./instruction-context.ts";
import { copyState, readState } from "./state.ts";
import type { ReadonlyState } from "./state.js";
import { opcodeTable } from "./opcodes.ts";

export { cpu8008StateDescription } from "./state/8008.ts";
export type { Cpu8008State, Cpu8008AddressStack, Cpu8008Flags } from "./state/8008.ts";

export type Cpu8008Snapshot = ReadonlyState<Cpu8008State> & {
  readonly pc: number;
  /** Raw H:L byte pair; memory addressing uses only its low 14 bits. */
  readonly hl: number;
};

export type Cpu8008MemoryAccess = MemoryAccess;
export type Cpu8008Access = MemoryAccess | PortAccess;

export type Cpu8008Instruction = FetchedInstruction;

export type Cpu8008StepRecord = InstructionStep<Cpu8008Snapshot, Cpu8008Access> | HaltedStep<Cpu8008Snapshot, Cpu8008Access>;

export type Cpu8008ResetRecord = StateTransition<Cpu8008Snapshot>;

export type Cpu8008InterruptAccess = Cpu8008Access | InterruptAcknowledge;
export type Cpu8008InterruptInstruction = InterruptInstruction;

export type Cpu8008InterruptRecord = StateTransition<Cpu8008Snapshot, Cpu8008InterruptAccess> & (
  | { readonly outcome: "executed" | "halted"; readonly instruction: Cpu8008InterruptInstruction }
  | { readonly outcome: "unsupported"; readonly reason: "opcode"; readonly instruction: Cpu8008InterruptInstruction }
);

interface InstructionContext extends WordInstructionContext, BytePorts {}
type OpcodeHandler = (instruction: InstructionContext) => void;

/** Instruction-level Intel 8008 with native port selectors and 14-bit addresses. */
export class Cpu8008 {
  readonly #ram: Ram;
  readonly #ports: BytePorts | undefined;
  readonly #state: Cpu8008StoredState;
  readonly #views: ReturnType<typeof sourceReaders>["views"];
  readonly #opcodeHandlers: Readonly<Partial<Record<number, OpcodeHandler>>>;
  readonly #atBoundary = executionBoundary("8008 step, reset, and interrupt calls must not be reentrant.");
  readonly #counter = programCounter(() => this.#views.PC(), value => stateActions.setPC(this.#state, value));

  constructor(ram: Ram, initialState: Cpu8008State, ports?: BytePorts) {
    if (ram.size !== 0x4000) throw new RangeError("The 8008 model requires exactly 16 KiB of RAM.");
    this.#ram = ram;
    this.#ports = ports;
    this.#state = readState(cpu8008StateDescription, initialState);
    this.#views = sourceReaders(this.#state).views;
    this.#opcodeHandlers = opcodeTable(opcodeEntries(this.#state));
  }

  /** Inspect detached state, the selected PC, and the raw H:L pair without RAM accesses. */
  snapshot(): Cpu8008Snapshot {
    return { ...copyState(cpu8008StateDescription, this.#state), pc: this.#views.PC(), hl: this.#views.HL() };
  }

  /** Model settled power-on clearing and STOPPED, not an interrupt or a lesson restart. */
  reset(): Cpu8008ResetRecord {
    return this.#atBoundary(() => {
      const before = this.snapshot();
      stateActions.reset(this.#state);
      return { before, after: this.snapshot(), accesses: [] };
    });
  }

  /** Attempt one instruction; unsupported and already halted attempts preserve all state. */
  step(): Cpu8008StepRecord {
    return this.#atBoundary<Cpu8008StepRecord>(() => {
      const before = this.snapshot();
      if (this.#state.halted) {
        return { before, after: this.snapshot(), instruction: null, accesses: [], outcome: "halted" };
      }
      const ports = recordPorts(this.#ports);
      const execution = executeByteInstruction(this.#counter, this.#ram, opcode => {
        const handler = this.#opcodeHandlers[opcode];
        return handler && (context => handler({ ...context, readPort: ports.readPort, writePort: ports.writePort }));
      }, readWordLE);
      // INP/OUT fetch one opcode byte, then perform one port transfer with no further RAM accesses.
      const accesses: readonly Cpu8008Access[] = [...execution.accesses, ...ports.accesses];
      const record = { before, after: this.snapshot(), instruction: execution.instruction, accesses };
      return execution.executed
        ? { ...record, outcome: this.#state.halted ? "halted" : "executed" }
        : { ...record, outcome: "unsupported", reason: "opcode" };
    });
  }

  /** Offer an external instruction at this boundary; the 8008 has no interrupt mask or queue. */
  interrupt(acknowledge: () => number): Cpu8008InterruptRecord {
    return this.#atBoundary<Cpu8008InterruptRecord>(() => {
      if (typeof acknowledge !== "function") throw new TypeError("8008 interrupt requires an acknowledgement callback.");
      const before = this.snapshot();
      // Acceptance releases STOPPED. Only the supplied instruction can change flags or call a handler.
      this.#state.halted = false;
      const accesses: Cpu8008InterruptAccess[] = [];
      const recordAccess = (access: Cpu8008InterruptAccess): void => { accesses.push(access); };
      const { readByte, writeByte } = recordMemory(this.#ram, recordAccess);
      const { readPort, writePort } = recordPorts(this.#ports, recordAccess);
      const { instruction, fetchByte } = recordInterruptInstruction(acknowledge, recordAccess);
      // T1I suppresses PC advancement for every supplied byte, including immediate/address operands.
      const handler = this.#opcodeHandlers[fetchByte()];
      if (handler) handler({ readByte, writeByte, readPort, writePort, fetchByte, fetchWord: () => readWordLE(fetchByte) });
      const record = { before, after: this.snapshot(), instruction, accesses };
      return handler
        ? { ...record, outcome: this.#state.halted ? "halted" : "executed" }
        : { ...record, outcome: "unsupported", reason: "opcode" };
    });
  }

}
