import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition, InstructionStep, WaitingStep } from "./execution-records.ts";
import { executeByteInstruction } from "./execute-byte-instruction.ts";
import { executionBoundary } from "./execution-boundary.ts";
import { readWordBE } from "./binary.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { copyState, readState } from "./state.ts";
import type { ReadonlyState } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.ts";
import { motorolaUnaryOperations, motorolaOperandBindings, motorolaBranchNames } from "./motorola.ts";
import { instructions as semantics, opcodeEntries } from "./generated/6800.ts";
import { cpu6800StateDescription } from "./state/6800.ts";
import type { Cpu6800State } from "./state/6800.ts";

export { cpu6800StateDescription } from "./state/6800.ts";
export type { Cpu6800State, Cpu6800Flags } from "./state/6800.ts";

export type Cpu6800Snapshot = ReadonlyState<Cpu6800State>;

export type Cpu6800MemoryAccess = MemoryAccess;

export type Cpu6800Instruction = FetchedInstruction;

export type Cpu6800StepRecord = InstructionStep<Cpu6800Snapshot> | WaitingStep<Cpu6800Snapshot>;

export type Cpu6800ResetRecord = StateTransition<Cpu6800Snapshot>;

export type Cpu6800InterruptSource = "irq" | "nmi";

/** External entry performs stack/vector accesses without fetching an instruction. */
export type Cpu6800InterruptRecord = StateTransition<Cpu6800Snapshot> & { readonly instruction: null } & (
  | { readonly source: Cpu6800InterruptSource; readonly outcome: "accepted" }
  | { readonly source: "irq"; readonly outcome: "ignored"; readonly reason: "masked" }
);

type OpcodeHandler = (instruction: InstructionContext) => void;
type AddressReader = (instruction: InstructionContext) => number;

const instructionPattern = opcodePattern<OpcodeHandler>;

/** Instruction-level Motorola 6800 with explicit boundary IRQ/NMI delivery. */
export class Cpu6800 {
  readonly #ram: Ram;
  readonly #state: Cpu6800State;
  readonly #atBoundary = executionBoundary("6800 step, reset, and interrupt calls must not be reentrant.");

  readonly #opcodeHandlers: Readonly<Partial<Record<number, OpcodeHandler>>>;

  constructor(ram: Ram, initialState: Cpu6800Snapshot) {
    if (ram.size !== 0x10000) throw new RangeError("The 6800 model requires exactly 64 KiB of RAM.");
    this.#ram = ram;
    this.#state = readState(cpu6800StateDescription, initialState);
    this.#opcodeHandlers = opcodeTable(this.#instructionEntries());
  }

  /** Inspect detached registers and flags without accessing RAM. */
  snapshot(): Cpu6800Snapshot {
    return copyState(cpu6800StateDescription, this.#state);
  }

  /** Read the reset vector, set I, and release WAI; preserve other state and RAM. */
  reset(): Cpu6800ResetRecord {
    return this.#atBoundary(() => {
      const before = this.snapshot();
      const { accesses, readByte } = recordMemory(this.#ram);
      this.#state.pc = this.#readWord(0xfffe, readByte);
      this.#state.flags.i = true;
      this.#state.waiting = false;
      return { before, after: this.snapshot(), accesses };
    });
  }

  /** Attempt one instruction; waiting CPUs do not fetch, and unsupported opcodes preserve state. */
  step(): Cpu6800StepRecord {
    return this.#atBoundary<Cpu6800StepRecord>(() => {
      const before = this.snapshot();
      if (this.#state.waiting) {
        return { before, after: this.snapshot(), instruction: null, accesses: [], outcome: "waiting" };
      }
      const { instruction, accesses, executed } = executeByteInstruction(this.#state, this.#ram, this.#opcodeHandlers, readWordBE);
      const record = { before, after: this.snapshot(), instruction, accesses };
      return executed
        ? { ...record, outcome: this.#state.waiting ? "waiting" : "executed" }
        : { ...record, outcome: "unsupported", reason: "opcode" };
    });
  }

  /** Offer a selected request at this boundary; the caller owns pending signals and NMI edges. */
  interrupt(source: Cpu6800InterruptSource): Cpu6800InterruptRecord {
    return this.#atBoundary<Cpu6800InterruptRecord>(() => {
      if (source !== "irq" && source !== "nmi") throw new RangeError("6800 interrupt source must be irq or nmi.");
      const before = this.snapshot();
      // Boundary offers consult current I; hardware look-ahead and pin sampling are unmodeled.
      if (source === "irq" && this.#state.flags.i) {
        return { before, after: this.snapshot(), instruction: null, accesses: [], source, outcome: "ignored", reason: "masked" };
      }
      const memory = recordMemory(this.#ram);
      semantics.enterInterrupt(this.#state, source === "irq" ? 0xfff8 : 0xfffc, memory);
      return { before, after: this.snapshot(), instruction: null, accesses: memory.accesses, source, outcome: "accepted" };
    });
  }

  // Opcode selectors and construction. Each group labels its own encoding fields.

  // mm in 1 r mm oooo: 00 is immediate; the other modes resolve a data address.
  readonly #memoryModes: readonly { bits: string; address: AddressReader }[] = [
    { bits: "01", address: ({ fetchByte }) => fetchByte() }, // Direct, page zero
    { bits: "10", address: ({ fetchByte }) => this.#indexedAddress(fetchByte()) }, // Indexed, unsigned offset
    { bits: "11", address: ({ fetchWord }) => fetchWord() }, // Extended
  ];
  // 01 tt oooo: tt=00 A, 01 B, 10 indexed, 11 extended; oooo selects the operation.
  // TST (1101) only reads; CLR (1111) only writes. JMP (1110) remains separate.
  static readonly #unaryOperations = motorolaUnaryOperations(semantics);

  readonly #operandHandlers = motorolaOperandBindings(() => this.#state, this.#memoryModes);

  #instructionEntries(): readonly OpcodeEntry<OpcodeHandler>[] {
    return [
      ...instructionPattern("0000 0001", () => semantics.nop(this.#state)), // NOP

      // 00001 ff v: ff=00 adjusts X; ff=01/10/11 clears or sets V/C/I.
      ...opcodeFamily("00001 00 d", { d: [semantics.inx, semantics.dex] }, ({ d: execute }) => () => execute(this.#state)), // INX / DEX; only Z changes
      ...opcodeFamily("00001 01 v", { v: [semantics.clv, semantics.sev] }, ({ v: execute }) => () => execute(this.#state)), // CLV / SEV
      ...opcodeFamily("00001 10 v", { v: [semantics.clc, semantics.sec] }, ({ v: execute }) => () => execute(this.#state)), // CLC / SEC
      ...opcodeFamily("00001 11 v", { v: [semantics.cli, semantics.sei] }, ({ v: execute }) => () => execute(this.#state)), // CLI / SEI

      // SBA subtracts B from A, ignoring incoming carry; CBA is chapter-owned.
      ...instructionPattern("0001000 0", () => semantics.sba(this.#state)), // SBA

      ...instructionPattern("0001 1001", () => semantics.daa(this.#state)), // DAA
      ...instructionPattern("0001 1011", () => semantics.aba(this.#state)), // ABA

      // 0010 cccc, cccc=tttp: bits 3..1 select a condition; bit 0 selects it (0) or its inverse (1).
      // ttt=000 has only BRA. The original 6800 leaves 21 unused; it has no BRN.
      ...opcodeFamily("0010 cccc", { c: motorolaBranchNames }, ({ c: name }) => name).flatMap(([opcode, name]) =>
        name === "brn" ? [] : [[opcode, (instruction: InstructionContext) => semantics[name](this.#state, instruction)] as const]),

      // 00110 p q r: q=1 pulls (p=0) or pushes (p=1) A/B (r=0/1).
      // q=0 manipulates SP/X. Every instruction in this group preserves all flags.
      ...instructionPattern("00110 0 0 0", () => semantics.tsx(this.#state)), // TSX
      ...instructionPattern("00110 0 0 1", () => semantics.ins(this.#state)), // INS
      ...opcodeFamily("00110 0 1 r", { r: [semantics.pulA, semantics.pulB] }, ({ r: execute }) => (instruction: InstructionContext) => execute(this.#state, instruction)), // PULA / PULB
      ...instructionPattern("00110 1 0 0", () => semantics.des(this.#state)), // DES
      ...instructionPattern("00110 1 0 1", () => semantics.txs(this.#state)), // TXS
      ...opcodeFamily("00110 1 1 r", { r: [semantics.pshA, semantics.pshB] }, ({ r: execute }) => (instruction: InstructionContext) => execute(this.#state, instruction)), // PSHA / PSHB
      ...instructionPattern("0011 1001", instruction => semantics.rts(this.#state, instruction)), // RTS
      ...instructionPattern("0011 1011", instruction => semantics.rti(this.#state, instruction)), // RTI

      // 0011111 s: both save the full frame; s=0 waits, s=1 enters the software vector.
      ...instructionPattern("0011111 0", instruction => semantics.wai(this.#state, instruction)), // WAI
      ...instructionPattern("0011111 1", instruction => semantics.swi(this.#state, instruction)), // SWI

      // 010 r oooo (tt=00/01): r selects A=0/B=1. 1110 is unused here.
      ...Cpu6800.#unaryOperations.flatMap(({ bits, registers }) => opcodeFamily(`010 r ${bits}`,
        { r: registers }, ({ r: execute }) => () => execute(this.#state))),

      // 011 m oooo (tt=10/11): m selects indexed=0/extended=1; JMP (1110) uses the address without reading data.
      ...this.#memoryUnaryHandlers("0110", ({ fetchByte }) => this.#indexedAddress(fetchByte())),
      ...this.#memoryUnaryHandlers("0111", ({ fetchWord }) => fetchWord()),

      // Chapter-owned encodings include their operand fetching and addressing.
      ...opcodeEntries(this.#state),

      // Remaining byte arithmetic uses 1 r mm oooo: r selects A/B, mm selects addressing.
      ...(["a", "b"] as const).flatMap((register, r) => ([
        ["0000", "sub"], ["0010", "sbc"], ["1001", "adc"], ["1011", "add"],
      ] as const).flatMap(([bits, operation]) => this.#operandHandlers(`1 ${r} mm ${bits}`,
        semantics[`${operation}${register}Immediate`], semantics[`${operation}${register}Memory`]))),

      // 10 mm 1101: mm=00 is BSR, 10/11 are indexed/extended JSR; 01 is undefined.
      ...instructionPattern("10 00 1101", instruction => semantics.bsr(this.#state, instruction)), // BSR rel
      ...instructionPattern("10 10 1101", instruction => semantics.jsr(this.#state, this.#indexedAddress(instruction.fetchByte()), instruction)), // JSR offset,X
      ...instructionPattern("10 11 1101", instruction => semantics.jsr(this.#state, instruction.fetchWord(), instruction)), // JSR addr

      // All 197 documented encodings are covered; undefined encodings remain unsupported.
    ];
  }

  #memoryUnaryHandlers(prefix: "0110" | "0111", address: AddressReader): readonly OpcodeEntry<OpcodeHandler>[] {
    return [
      ...Cpu6800.#unaryOperations.flatMap(({ bits, memory }) => instructionPattern(`${prefix} ${bits}`,
        instruction => memory(this.#state, address(instruction), instruction))),
      ...instructionPattern(`${prefix} 1110`, instruction => semantics.jump(this.#state, address(instruction))), // JMP
    ];
  }

  // Addressing. The original 6800 adds an unsigned displacement and leaves X unchanged.

  #indexedAddress(offset: number): number {
    return (this.#state.x + offset) & 0xffff;
  }

  // Memory operations.

  #readWord(address: number, readByte: InstructionContext["readByte"]): number {
    const high = readByte(address);
    const low = readByte((address + 1) & 0xffff);
    return (high << 8) | low;
  }
}
