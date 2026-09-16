import { instructions as semantics } from "./generated/8080.ts";
import type { Ram } from "../memory/ram.js";
import { pairViews } from "./register-pairs.ts";
import { Cpu8080Family } from "./8080-family.ts";
import type { AluInstruction, ByteOperation } from "./8080-family.ts";
import { flagRegister, signZeroParity8 } from "./flags.ts";
import type { FetchedInstruction, StateTransition, InstructionStep, HaltedStep } from "./execution-records.ts";
import { executeByteInstruction } from "./execute-byte-instruction.ts";
import { executionBoundary } from "./execution-boundary.ts";
import { recordInterruptInstruction } from "./interrupt-instruction.ts";
import type { InterruptInstruction, InterruptAcknowledge } from "./interrupt-instruction.ts";
import { readWordLE } from "./binary.ts";
import type { MemoryAccess } from "./memory-access.ts";
import { recordMemory } from "./memory-access.ts";
import { recordPorts } from "./port-access.ts";
import type { BytePorts, PortAccess } from "./port-access.ts";
import type { WordInstructionContext } from "./instruction-context.ts";
import { copyState, readState } from "./state.ts";
import { cpu8080StateDescription } from "./state/8080.ts";
import type { Cpu8080State } from "./state/8080.ts";
import type { ReadonlyState } from "./state.js";
import { opcodeTable, opcodePattern } from "./opcodes.ts";
import { add, subtract } from "./alu.ts";

export { cpu8080StateDescription } from "./state/8080.ts";
export type { Cpu8080State, Cpu8080Flags } from "./state/8080.ts";

export type Cpu8080Snapshot = ReadonlyState<Cpu8080State> & {
  readonly bc: number;
  readonly de: number;
  readonly hl: number;
};

export type Cpu8080MemoryAccess = MemoryAccess;
export type Cpu8080Access = MemoryAccess | PortAccess;

export type Cpu8080Instruction = FetchedInstruction;

export type Cpu8080StepRecord = InstructionStep<Cpu8080Snapshot, Cpu8080Access> | HaltedStep<Cpu8080Snapshot, Cpu8080Access>;

export type Cpu8080ResetRecord = StateTransition<Cpu8080Snapshot>;

export type Cpu8080InterruptAccess = Cpu8080Access | InterruptAcknowledge;

/** Interrupt instruction bytes have an external source, with no RAM fetch address. */
export type Cpu8080InterruptInstruction = InterruptInstruction;

export type Cpu8080InterruptRecord = StateTransition<Cpu8080Snapshot, Cpu8080InterruptAccess> & (
  | { readonly outcome: "ignored"; readonly reason: "disabled" | "deferred"; readonly instruction: null }
  | { readonly outcome: "executed" | "halted"; readonly instruction: Cpu8080InterruptInstruction }
  | { readonly outcome: "unsupported"; readonly reason: "opcode"; readonly instruction: Cpu8080InterruptInstruction }
);

interface InstructionContext extends WordInstructionContext, BytePorts {
  readonly deferInterrupt: () => void;
}
type OpcodeHandler = (instruction: InstructionContext) => void;
const instructionPattern = opcodePattern<OpcodeHandler>;

// PSW low byte: S Z 0 AC 0 P 1 CY.
const packedFlags = flagRegister({ s: 7, z: 6, ac: 4, p: 2, cy: 0 }, 0x02);

/** Instruction-level Intel 8080 with boundary interrupt delivery; timing remains unmodeled. */
export class Cpu8080 extends Cpu8080Family<Cpu8080State> {
  readonly #ram: Ram;
  readonly #ports: BytePorts | undefined;
  readonly #atBoundary = executionBoundary("8080 step, reset, and interrupt calls must not be reentrant.");

  constructor(ram: Ram, initialState: Omit<Cpu8080Snapshot, "bc" | "de" | "hl">, ports?: BytePorts) {
    if (ram.size !== 0x10000) {
      throw new RangeError("The 8080 model requires exactly 64 KiB of RAM.");
    }
    super(readState(cpu8080StateDescription, initialState));
    this.#ram = ram;
    this.#ports = ports;
  }

  /** Inspect a detached copy, readonly to TypeScript, without accessing RAM. */
  snapshot(): Cpu8080Snapshot {
    const state = copyState(cpu8080StateDescription, this.state);
    return { ...state, ...pairViews(state) };
  }

  /** Reset PC and control latches, preserving data registers, SP, flags, and RAM. */
  reset(): Cpu8080ResetRecord {
    return this.#atBoundary(() => {
      const before = this.snapshot();
      this.state.pc = 0;
      this.state.interruptEnabled = false;
      this.state.interruptDeferred = false;
      this.state.halted = false;
      return { before, after: this.snapshot(), accesses: [] };
    });
  }

  /** Attempt one instruction; halted CPUs do not fetch and unsupported opcodes preserve state. */
  step(): Cpu8080StepRecord {
    return this.#atBoundary<Cpu8080StepRecord>(() => {
      const before = this.snapshot();
      if (this.state.halted) {
        return { before, after: this.snapshot(), instruction: null, accesses: [], outcome: "halted" };
      }
      let portAccesses: readonly PortAccess[] = [];
      const execution = executeByteInstruction(this.state, this.#ram, opcode => {
        const handler = this.#opcodeHandlers[opcode];
        return handler && (context => { portAccesses = this.#executeHandler(handler, context); });
      }, readWordLE);
      // IN/OUT perform exactly one port transfer after all their memory fetches.
      const accesses: readonly Cpu8080Access[] = [...execution.accesses, ...portAccesses];
      const record = { before, after: this.snapshot(), instruction: execution.instruction, accesses };
      return execution.executed
        ? { ...record, outcome: this.state.halted ? "halted" : "executed" }
        : { ...record, outcome: "unsupported", reason: "opcode" };
    });
  }

  /** Offer an interrupt at this boundary. Ignored requests are not queued and do not acknowledge. */
  interrupt(acknowledge: () => number): Cpu8080InterruptRecord {
    return this.#atBoundary<Cpu8080InterruptRecord>(() => {
      const before = this.snapshot();
      if (!this.state.interruptEnabled || this.state.interruptDeferred) {
        return { before, after: this.snapshot(), instruction: null, accesses: [], outcome: "ignored",
          reason: this.state.interruptEnabled ? "deferred" : "disabled" };
      }
      // Acceptance releases HALT and disables further interrupts before the device supplies a byte.
      this.state.interruptEnabled = false;
      this.state.interruptDeferred = false;
      this.state.halted = false;
      const accesses: Cpu8080InterruptAccess[] = [];
      const recordAccess = (access: Cpu8080InterruptAccess): void => { accesses.push(access); };
      const { readByte, writeByte } = recordMemory(this.#ram, recordAccess);
      const { instruction, fetchByte } = recordInterruptInstruction(acknowledge, recordAccess);
      const handler = this.#opcodeHandlers[fetchByte()];
      if (handler) this.#executeHandler(handler, { readByte, writeByte, fetchByte, fetchWord: () => readWordLE(fetchByte) }, recordAccess);
      const record = { before, after: this.snapshot(), instruction, accesses };
      return handler
        ? { ...record, outcome: this.state.halted ? "halted" : "executed" }
        : { ...record, outcome: "unsupported", reason: "opcode" };
    });
  }

  // Execution boundaries and shared handler capabilities.

  #executeHandler(handler: OpcodeHandler, context: WordInstructionContext, onAccess?: (access: PortAccess) => void): readonly PortAccess[] {
    const ports = recordPorts(this.#ports, onAccess);
    let interruptDeferred = false;
    handler({ ...context, readPort: ports.readPort, writePort: ports.writePort,
      deferInterrupt: () => { interruptDeferred = true; } });
    // Only a retired instruction consumes the previous EI delay; another EI renews it.
    this.state.interruptDeferred = interruptDeferred;
    return ports.accesses;
  }

  // Register and flag views.

  protected override get statusWord(): number {
    return (this.state.a << 8) | packedFlags.encode(this.state.flags);
  }

  protected override set statusWord(value: number) {
    this.state.a = value >>> 8;
    this.state.flags = packedFlags.decode(value);
  }

  // Opcode selectors and construction.

  // 10 ooo rrr and 11 ooo 110 share this three-bit ALU selector.
  // These closures read state at execution; CMP updates flags but retains A.
  protected override readonly aluInstructions: readonly AluInstruction[] = [
    ...([
      value => this.#add(value), // 000 ADD / ADI
      value => this.#add(value, this.state.flags.cy ? 1 : 0), // 001 ADC / ACI
      value => this.#subtract(value), // 010 SUB / SUI
      value => this.#subtract(value, this.state.flags.cy ? 1 : 0), // 011 SBB / SBI
      value => this.#and(value), // 100 ANA / ANI
      value => this.#aluResult(this.state.a ^ value, false, false), // 101 XRA / XRI
      value => this.#aluResult(this.state.a | value, false, false), // 110 ORA / ORI
    ] satisfies readonly ByteOperation[]).map(operate => this.accumulatorInstruction(operate)),
    // 111 CMP / CPI: generated bodies read their own source and never write A.
    operand => {
      const compare = {
        b: semantics.cmpB, c: semantics.cmpC, d: semantics.cmpD, e: semantics.cmpE,
        h: semantics.cmpH, l: semantics.cmpL, "(hl)": semantics.cmpM, a: semantics.cmpA, immediate: semantics.cpi,
      }[operand];
      return instruction => compare(this.state, instruction);
    },
  ];

  // ccc = ff v: ff selects Z, CY, P, S; v is the required flag value (0 or 1).
  // Predicates read flags at execution.
  protected override readonly conditions = (["z", "cy", "p", "s"] as const).flatMap(flag =>
    [false, true].map(value => () => this.state.flags[flag] === value));

  // 00 ooo 111: accumulator/carry operations, in encoded order.
  protected override readonly accumulatorOperations: readonly (() => void)[] = [
    () => semantics.rlc(this.state), // 000 RLC
    () => semantics.rrc(this.state), // 001 RRC
    () => semantics.ral(this.state), // 010 RAL
    () => semantics.rar(this.state), // 011 RAR
    () => this.#decimalAdjust(), // 100 DAA
    () => { this.state.a ^= 0xff; }, // 101 CMA
    () => { this.state.flags.cy = true; }, // 110 STC
    () => { this.state.flags.cy = !this.state.flags.cy; }, // 111 CMC
  ];

  // Common encodings and operand handling live in 8080-family.ts.
  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    ...this.baseInstructions(),
    // 1101 d 011: d=0 outputs A; d=1 inputs A. The next byte selects the port.
    ...instructionPattern("1101 0 011", ({ fetchByte, writePort }) => writePort(fetchByte(), this.state.a)), // OUT
    ...instructionPattern("1101 1 011", ({ fetchByte, readPort }) => { this.state.a = readPort(fetchByte()); }), // IN
    // 1111 e 011: e selects interrupt enable; EI inhibits acceptance through the next instruction.
    ...instructionPattern("1111 0 011", () => { this.state.interruptEnabled = false; }), // DI
    ...instructionPattern("1111 1 011", ({ deferInterrupt }) => { this.state.interruptEnabled = true; deferInterrupt(); }), // EI
  ]);

  // Arithmetic, logic, and flags.

  #add(value: number, carryIn: 0 | 1 = 0): number {
    const { result, halfCarry, carry } = add(8, this.state.a, value, carryIn);
    return this.#aluResult(result, halfCarry, carry);
  }

  #subtract(value: number, borrowIn: 0 | 1 = 0): number {
    const { result, borrow, halfBorrow } = subtract(8, this.state.a, value, borrowIn);
    // CY reports a borrow; AC is the inverse of the low-nibble borrow.
    return this.#aluResult(result, !halfBorrow, borrow);
  }

  #and(value: number): number {
    const accumulator = this.state.a;
    // ANA clears CY; AC is bit 3 of A OR the operand.
    return this.#aluResult(accumulator & value, ((accumulator | value) & 0x08) !== 0, false);
  }

  protected override adjustByte(value: number, delta: -1 | 1): number {
    // INR sets AC on carry out of bit 3; DCR uses the inverse low-nibble borrow. Both preserve CY.
    const ac = delta === 1 ? (value & 0x0f) === 0x0f : (value & 0x0f) !== 0;
    return this.#aluResult(value + delta, ac, this.state.flags.cy);
  }

  protected override addToHl(value: number): void {
    const { result, carry } = add(16, this.hl, value);
    this.hl = result;
    this.state.flags.cy = carry;
  }

  #decimalAdjust(): void {
    const accumulator = this.state.a;
    const low = accumulator & 0x0f;
    const lowCorrection = low > 9 || this.state.flags.ac ? 0x06 : 0;
    // Select both corrections from the original state; preserve incoming CY.
    const cy = accumulator > 0x99 || this.state.flags.cy;
    const correction = lowCorrection + (cy ? 0x60 : 0);
    this.state.a = this.#aluResult(accumulator + correction, low + lowCorrection > 0x0f, cy);
  }

  #aluResult(value: number, ac: boolean, cy: boolean): number {
    const result = value & 0xff;
    this.state.flags = { ...signZeroParity8(result), ac, cy };
    return result;
  }
}
