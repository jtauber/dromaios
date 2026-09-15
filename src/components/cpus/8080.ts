import type { Ram } from "../memory/ram.js";
import { pairViews } from "./register-pairs.ts";
import { Cpu8080Family } from "./8080-family.ts";
import type { OpcodeHandler, ByteOperation } from "./8080-family.ts";
import { flagRegister, signZeroParity8 } from "./flags.ts";
import type { FetchedInstruction, StateTransition, InstructionStep, HaltedStep } from "./execution-records.ts";
import { executeByteInstruction } from "./execute-byte-instruction.ts";
import { readWordLE } from "./binary.ts";
import type { MemoryAccess } from "./memory-access.ts";
import { defineState, copyState, readState, unsigned, flag, boolean, group } from "./state.ts";
import type { StateValues, ReadonlyState } from "./state.js";
import { opcodeTable } from "./opcodes.ts";
import { add, subtract, shiftLeft, shiftRight } from "./alu.ts";
import type { ShiftResult } from "./alu.ts";

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu8080StateDescription = defineState({
  a: unsigned(8), b: unsigned(8), c: unsigned(8), d: unsigned(8), e: unsigned(8), h: unsigned(8), l: unsigned(8),
  pc: unsigned(16), sp: unsigned(16),
  flags: group({ s: flag, z: flag, ac: flag, p: flag, cy: flag }),
  interruptEnabled: boolean, halted: boolean,
});

export type Cpu8080State = StateValues<typeof cpu8080StateDescription>;
export type Cpu8080Flags = Cpu8080State["flags"];

export type Cpu8080Snapshot = ReadonlyState<Cpu8080State> & {
  readonly bc: number;
  readonly de: number;
  readonly hl: number;
};

export type Cpu8080MemoryAccess = MemoryAccess;

export type Cpu8080Instruction = FetchedInstruction;

export type Cpu8080StepRecord = InstructionStep<Cpu8080Snapshot> | HaltedStep<Cpu8080Snapshot>;

export type Cpu8080ResetRecord = StateTransition<Cpu8080Snapshot>;

// PSW low byte: S Z 0 AC 0 P 1 CY.
const packedFlags = flagRegister({ s: 7, z: 6, ac: 4, p: 2, cy: 0 }, 0x02);

/** Instruction-level Intel 8080 subset for the 8080 examples. */
export class Cpu8080 extends Cpu8080Family<Cpu8080State> {
  readonly #ram: Ram;

  constructor(ram: Ram, initialState: Omit<Cpu8080Snapshot, "bc" | "de" | "hl">) {
    if (ram.size !== 0x10000) {
      throw new RangeError("The 8080 model requires exactly 64 KiB of RAM.");
    }
    super(readState(cpu8080StateDescription, initialState));
    this.#ram = ram;
  }

  /** Inspect a detached copy, readonly to TypeScript, without accessing RAM. */
  snapshot(): Cpu8080Snapshot {
    const state = copyState(cpu8080StateDescription, this.state);
    return { ...state, ...pairViews(state) };
  }

  /** Reset PC and control latches, preserving data registers, SP, flags, and RAM. */
  reset(): Cpu8080ResetRecord {
    const before = this.snapshot();
    this.state.pc = 0;
    this.state.interruptEnabled = false;
    this.state.halted = false;
    return { before, after: this.snapshot(), accesses: [] };
  }

  /** Attempt one instruction; halted CPUs do not fetch and unsupported opcodes preserve state. */
  step(): Cpu8080StepRecord {
    const before = this.snapshot();
    if (this.state.halted) {
      return { before, after: this.snapshot(), instruction: null, accesses: [], outcome: "halted" };
    }
    const { instruction, accesses, executed } = executeByteInstruction(this.state, this.#ram, this.#opcodeHandlers, readWordLE);
    const record = { before, after: this.snapshot(), instruction, accesses };
    return executed
      ? { ...record, outcome: this.state.halted ? "halted" : "executed" }
      : { ...record, outcome: "unsupported", reason: "opcode" };
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
  protected override readonly aluOperations: readonly ByteOperation[] = [
    value => this.#add(value), // 000 ADD / ADI
    value => this.#add(value, this.state.flags.cy ? 1 : 0), // 001 ADC / ACI
    value => this.#subtract(value), // 010 SUB / SUI
    value => this.#subtract(value, this.state.flags.cy ? 1 : 0), // 011 SBB / SBI
    value => this.#and(value), // 100 ANA / ANI
    value => this.#aluResult(this.state.a ^ value, false, false), // 101 XRA / XRI
    value => this.#aluResult(this.state.a | value, false, false), // 110 ORA / ORI
    value => this.#compare(value), // 111 CMP / CPI
  ];

  // ccc = ff v: ff selects Z, CY, P, S; v is the required flag value (0 or 1).
  // Predicates read flags at execution.
  protected override readonly conditions = (["z", "cy", "p", "s"] as const).flatMap(flag =>
    [false, true].map(value => () => this.state.flags[flag] === value));

  // 00 ooo 111: accumulator/carry operations, in encoded order.
  protected override readonly accumulatorOperations: readonly (() => void)[] = [
    () => this.#rotateAccumulator(shiftLeft(8, this.state.a, (this.state.a & 0x80) !== 0 ? 1 : 0)), // 000 RLC
    () => this.#rotateAccumulator(shiftRight(8, this.state.a, (this.state.a & 1) !== 0 ? 1 : 0)), // 001 RRC
    () => this.#rotateAccumulator(shiftLeft(8, this.state.a, this.state.flags.cy ? 1 : 0)), // 010 RAL
    () => this.#rotateAccumulator(shiftRight(8, this.state.a, this.state.flags.cy ? 1 : 0)), // 011 RAR
    () => this.#decimalAdjust(), // 100 DAA
    () => { this.state.a ^= 0xff; }, // 101 CMA
    () => { this.state.flags.cy = true; }, // 110 STC
    () => { this.state.flags.cy = !this.state.flags.cy; }, // 111 CMC
  ];

  // Common encodings and operand handling live in 8080-family.ts.
  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>(this.baseInstructions());

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

  #compare(value: number): number {
    this.#subtract(value);
    // Use subtraction's flags, but retain A as the ALU result.
    return this.state.a;
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

  #rotateAccumulator({ result, carry }: ShiftResult): void {
    this.state.a = result;
    this.state.flags.cy = carry; // Rotates preserve every other flag.
  }

  #aluResult(value: number, ac: boolean, cy: boolean): number {
    const result = value & 0xff;
    this.state.flags = { ...signZeroParity8(result), ac, cy };
    return result;
  }
}
