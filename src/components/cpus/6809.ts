import { opcodeEntries as chapterOpcodes } from "./generated/6809-base.ts";
import { instructions as stateActions, sourceReaders } from "./generated/6809-state.ts";
import { instructions as semantics } from "./generated/6809.ts";
import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition, InstructionStep, WaitingStep } from "./execution-records.ts";
import { executionBoundary } from "./execution-boundary.ts";
import { executeByteInstruction } from "./execute-byte-instruction.ts";
import { signed8, readWordBE } from "./binary.ts";
import { recordMemory } from "./memory-access.ts";
import type { ByteMemory, MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { copyState, readState } from "./state.ts";
import { cpu6809StateDescription } from "./state/6809.ts";
import type { Cpu6809State } from "./state/6809.ts";
import type { ReadonlyState } from "./state.js";
import type { OpcodeEntry } from "./opcodes.ts";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import { motorolaUnaryOperations, motorolaOperandBindings, motorolaByteMemoryBindings, motorolaBranchNames, motorola6809TransferForms } from "./motorola.ts";

export { cpu6809StateDescription } from "./state/6809.ts";
export type { Cpu6809State, Cpu6809Flags } from "./state/6809.ts";

export type Cpu6809Snapshot = ReadonlyState<Cpu6809State> & {
  readonly d: number;
};

export type Cpu6809MemoryAccess = MemoryAccess;

export type Cpu6809Instruction = FetchedInstruction;

export type Cpu6809StepRecord = InstructionStep<Cpu6809Snapshot> | WaitingStep<Cpu6809Snapshot>;

export type Cpu6809ResetRecord = StateTransition<Cpu6809Snapshot>;

export type Cpu6809InterruptSource = "irq" | "firq" | "nmi";

/** A masked request can release SYNC without entering an interrupt handler. */
export type Cpu6809InterruptRecord = StateTransition<Cpu6809Snapshot> & { readonly instruction: null } & (
  | { readonly source: Cpu6809InterruptSource; readonly outcome: "accepted" }
  | { readonly source: "irq" | "firq"; readonly outcome: "ignored" | "resumed"; readonly reason: "masked" }
  | { readonly source: "nmi"; readonly outcome: "ignored"; readonly reason: "unarmed" }
);

type OpcodeHandler = (instruction: InstructionContext) => "unsupported" | void;
type AddressedHandler = (address: number, instruction: InstructionContext) => void;
type OperandReader = (instruction: InstructionContext) => number;
type AddressReader = (instruction: InstructionContext) => number | undefined;

const instructionPattern = opcodePattern<OpcodeHandler>;
const addressPattern = opcodePattern<AddressedHandler>;

// Vector address, frame size, and masks applied AFTER saving the original CC.
const interruptEntries = {
  firq: { vector: 0xfff6, entire: false, masks: 0x50 },
  irq:  { vector: 0xfff8, entire: true, masks: 0x10 },
  nmi:  { vector: 0xfffc, entire: true, masks: 0x50 },
} as const;

/** Instruction-level Motorola 6809 with explicit boundary IRQ/FIRQ/NMI delivery. */
export class Cpu6809 {
  readonly #ram: Ram;
  readonly #opcodeHandlers: Readonly<Partial<Record<number, OpcodeHandler>>>;
  readonly #state: Cpu6809State;
  readonly #atBoundary = executionBoundary("6809 step, reset, and interrupt calls must not be reentrant.");

  constructor(ram: Ram, initialState: Omit<Cpu6809Snapshot, "d">) {
    if (ram.size !== 0x10000) {
      throw new RangeError("The 6809 model requires exactly 64 KiB of RAM.");
    }
    this.#ram = ram;
    this.#state = readState(cpu6809StateDescription, initialState);
    this.#opcodeHandlers = this.#createOpcodeHandlers();
  }

  /** Inspect a detached copy, including D derived from A/B, without accessing RAM. */
  snapshot(): Cpu6809Snapshot {
    const state = copyState(cpu6809StateDescription, this.#state);
    return { ...state, d: sourceReaders(state).views.D() };
  }

  /** Read the reset vector, set DP/F/I, release waits, and disarm NMI. */
  reset(): Cpu6809ResetRecord {
    return this.#atBoundary(() => {
      const before = this.snapshot();
      const { accesses, readByte } = recordMemory(this.#ram);
      this.#state.pc = this.#readWord(0xfffe, readByte);
      this.#state.dp = 0;
      this.#state.flags.f = true;
      this.#state.flags.i = true;
      this.#state.waitMode = "none";
      this.#state.nmiArmed = false;
      return { before, after: this.snapshot(), accesses };
    });
  }

  /** Attempt one instruction, or report an existing wait without accessing RAM. */
  step(): Cpu6809StepRecord {
    return this.#atBoundary(() => {
      const before = this.snapshot();
      if (this.#state.waitMode !== "none") {
        return { before, after: this.snapshot(), instruction: null, accesses: [], outcome: "waiting" };
      }
      const { instruction, accesses, executed } = executeByteInstruction(this.#state, this.#ram, this.#opcodeHandlers, readWordBE);
      const record = { before, after: this.snapshot(), instruction, accesses };
      return executed
        ? { ...record, outcome: this.#state.waitMode === "none" ? "executed" : "waiting" }
        : { ...record, outcome: "unsupported", reason: "opcode" };
    });
  }

  /** Offer one selected request; the caller owns pending signals, priorities, and NMI edges. */
  interrupt(source: Cpu6809InterruptSource): Cpu6809InterruptRecord {
    return this.#atBoundary<Cpu6809InterruptRecord>(() => {
      if (source !== "irq" && source !== "firq" && source !== "nmi") {
        throw new RangeError("6809 interrupt source must be irq, firq, or nmi.");
      }
      const before = this.snapshot();
      const idle = { before, instruction: null, accesses: [], source } as const;
      if (source === "nmi" && !this.#state.nmiArmed) {
        return { ...idle, after: this.snapshot(), source, outcome: "ignored", reason: "unarmed" };
      }
      if (source !== "nmi" && this.#state.flags[source === "irq" ? "i" : "f"]) {
        const outcome = this.#state.waitMode === "sync" ? "resumed" : "ignored";
        if (outcome === "resumed") this.#state.waitMode = "none";
        return { ...idle, after: this.snapshot(), source, outcome, reason: "masked" };
      }
      const memory = recordMemory(this.#ram);
      this.#enterInterrupt(source, memory);
      return { before, after: this.snapshot(), instruction: null, accesses: memory.accesses, source, outcome: "accepted" };
    });
  }

  // Register and flag views.

  get #d(): number { return sourceReaders(this.#state).views.D(); }

  // Opcode selectors and construction.

  // Unary encodings: 0000 oooo = direct, 010r oooo = A/B,
  // 0110 oooo = indexed, 0111 oooo = extended. r=0 selects A, r=1 selects B.
  // Generated register bodies are in A/B selector order; memory bodies receive one resolved address.
  // TST (1101) never writes. JMP (1110) changes PC and stays outside this inventory.
  static readonly #unaryOperations = motorolaUnaryOperations(semantics);

  // mm in 1 r mm oooo: 00 is immediate; the other modes resolve a data address.
  readonly #directOperandAddress: OperandReader = ({ fetchByte }) => this.#directAddress(fetchByte());
  readonly #indexedOperandAddress: AddressReader = instruction => this.#indexedAddress(instruction);
  readonly #extendedOperandAddress: OperandReader = ({ fetchWord }) => fetchWord();
  readonly #memoryModes = [
    { bits: "01", address: this.#directOperandAddress },
    { bits: "10", address: this.#indexedOperandAddress },
    { bits: "11", address: this.#extendedOperandAddress },
  ] as const;

  // TFR/EXG postbyte ssss dddd: selector bit 3 chooses word=0/byte=1.
  // 0000..0101 = D/X/Y/U/S/PC; 1000..1011 = A/B/CC/DP; other selectors are undefined.
  readonly #exchangeHandlers = this.#registerTransferHandlers("exg");
  readonly #transferHandlers = this.#registerTransferHandlers("tfr");

  readonly #operandHandlers = motorolaOperandBindings(() => this.#state, this.#memoryModes);
  readonly #indexedOperands = motorolaOperandBindings(() => this.#state, [this.#memoryModes[1]]);

  // Prefix 10 selects page 2. Word encodings retain mm=00/01/10/11 addressing.
  // Transfers append 0=load/1=store; immediate stores are undefined.
  readonly #page2Handlers = opcodeTable<OpcodeHandler>([
    ...instructionPattern("0011 1111", instruction => semantics.swi2(this.#state, instruction)), // SWI2
    ...this.#branchHandlers(true).filter(([opcode]) => opcode !== 0x20), // LBRN and LBcc; LBRA has base opcode 16
    ...this.#operandHandlers("10 mm 0011", semantics.cmpdImmediate, semantics.cmpdMemory), // CMPD
    ...this.#operandHandlers("10 mm 1100", semantics.cmpyImmediate, semantics.cmpyMemory), // CMPY
    ...this.#operandHandlers("10 mm 1110", semantics.ldyImmediate, semantics.ldyMemory), // LDY
    ...this.#operandHandlers("10 mm 1111", undefined, semantics.styMemory), // STY
    ...this.#operandHandlers("11 mm 1110", semantics.ldsImmediate, semantics.ldsMemory), // LDS; arms NMI
    ...this.#operandHandlers("11 mm 1111", undefined, semantics.stsMemory), // STS
  ]);
  // Prefix 11 selects page 3: the same comparison fields select U/S rather than D/Y.
  readonly #page3Handlers = opcodeTable<OpcodeHandler>([
    ...instructionPattern("0011 1111", instruction => semantics.swi3(this.#state, instruction)), // SWI3
    ...this.#operandHandlers("10 mm 0011", semantics.cmpuImmediate, semantics.cmpuMemory), // CMPU
    ...this.#operandHandlers("10 mm 1100", semantics.cmpsImmediate, semantics.cmpsMemory), // CMPS
  ]);

  // Base opcode page; 10/11 dispatch exactly one following opcode in their own page.
  #createOpcodeHandlers() {
    return opcodeTable<OpcodeHandler>([
      ...chapterOpcodes(this.#state),
      // 0000 oooo: direct unary operations; 1110 is JMP instead of a byte operation.
      ...this.#memoryUnaryHandlers("0000", this.#directOperandAddress),

      ...instructionPattern("0001 0000", instruction => this.#executeFollowingByte(this.#page2Handlers, instruction)),
      ...instructionPattern("0001 0001", instruction => this.#executeFollowingByte(this.#page3Handlers, instruction)),
      ...instructionPattern("0001 0010", () => semantics.nop(this.#state)), // NOP
      ...instructionPattern("0001 0011", () => semantics.sync(this.#state)), // SYNC
      ...instructionPattern("0001 0110", instruction => semantics.lbra(this.#state, instruction)), // LBRA rel16
      ...instructionPattern("0001 0111", instruction => semantics.lbsr(this.#state, instruction)), // LBSR rel16

      ...instructionPattern("0001 1001", () => semantics.daa(this.#state)), // DAA
      ...instructionPattern("0001 1010", instruction => semantics.orcc(this.#state, instruction)), // ORCC
      ...instructionPattern("0001 1100", instruction => semantics.andcc(this.#state, instruction)), // ANDCC
      ...instructionPattern("0001 1101", () => semantics.sex(this.#state)), // SEX
      // 0001111 t: t=0 exchanges, t=1 transfers; the postbyte selects same-width registers.
      ...instructionPattern("0001111 0", instruction => this.#executeFollowingByte(this.#exchangeHandlers, instruction)), // EXG
      ...instructionPattern("0001111 1", instruction => this.#executeFollowingByte(this.#transferHandlers, instruction)), // TFR

      // 0010 cccc, cccc=tttp: ttt selects T/HI/CC/NE/VC/PL/GE/GT; bit 0 inverts it.
      ...this.#branchHandlers(), // BRA / BRN / Bcc

      // 001100 rr: rr=00/01/10/11 selects X/Y/S/U; only X/Y replace Z.
      ...this.#addressedHandlers(this.#indexedOperandAddress, opcodeFamily("001100 rr", { r: [semantics.leax, semantics.leay, semantics.leas, semantics.leau] },
        ({ r: execute }) => (address: number) => execute(this.#state, address))), // LEAX / LEAY / LEAS / LEAU

      // 001101 s p: s=0 selects S, s=1 selects U; p=0 pushes, p=1 pulls.
      // Mask bits 7..0: PC, other stack pointer, Y, X, DP, B, A, CC (E F H I N Z V C).
      ...opcodeFamily("001101 s p", { s: [[semantics.pshs, semantics.puls], [semantics.pshu, semantics.pulu]], p: [0, 1] },
        ({ s: operations, p: direction }) => (instruction: InstructionContext) => operations[direction]!(this.#state, instruction)), // PSHS / PULS / PSHU / PULU
      ...instructionPattern("0011 1001", instruction => semantics.rts(this.#state, instruction)), // RTS
      ...instructionPattern("0011 1010", () => semantics.abx(this.#state)), // ABX, unsigned B; preserve flags
      ...instructionPattern("0011 1011", instruction => semantics.rti(this.#state, instruction)), // RTI
      ...instructionPattern("0011 1100", instruction => semantics.cwai(this.#state, instruction)), // CWAI #mask
      ...instructionPattern("0011 1101", () => semantics.mul(this.#state)), // MUL
      ...instructionPattern("0011 1111", instruction => semantics.swi(this.#state, instruction)), // SWI

      // 010 r oooo: A/B unary operations. TST updates flags without writing a result.
      ...Cpu6809.#unaryOperations.flatMap(({ bits, registers }) => opcodeFamily(`010 r ${bits}`,
        { r: registers }, ({ r: execute }) => () => execute(this.#state))),

      // 0110 oooo is indexed; 0111 oooo uses an extended address (including JMP).
      ...this.#memoryUnaryHandlers("0110", this.#indexedOperandAddress),
      ...this.#memoryUnaryHandlers("0111", this.#extendedOperandAddress),

      // Remaining 1 r 10 oooo forms use indexed postbytes; other modes come from the chapter.
      // CMP/BIT preserve A/B; arithmetic sets flags before writeback; loads/logic write before flags.
      // Stores apply flags after a successful write.
      ...motorolaByteMemoryBindings(semantics, this.#indexedOperands), // SUB/CMP/SBC/AND/BIT/LD/ST/EOR/ADC/OR/ADD

      // 10 mm 1101: mm=00 is BSR; the other modes are JSR.
      ...instructionPattern("10 00 1101", instruction => semantics.bsr(this.#state, instruction)), // BSR rel8
      ...this.#memoryModes.flatMap(({ bits, address }) => this.#addressedHandlers(address,
        addressPattern(`10 ${bits} 1101`, (address, instruction) => semantics.jsr(this.#state, address, instruction)))), // JSR

      // 10 mm 1100: CMPX uses immediate/direct/indexed/extended sources for mm=00/01/10/11.
      ...this.#indexedOperands("10 mm 1100", undefined, semantics.cmpxMemory), // CMPX

      // 1 r mm 0011: r=0 subtracts from D, r=1 adds to D.
      ...this.#indexedOperands("10 mm 0011", undefined, semantics.subdMemory), // SUBD
      ...this.#indexedOperands("11 mm 0011", undefined, semantics.adddMemory), // ADDD

      // 1 r mm 11tt: tt=00/01 select D load/store for r=1; tt=10/11 select X (r=0) or U (r=1).
      ...this.#indexedOperands("11 mm 1100", undefined, semantics.lddMemory), // LDD
      ...this.#indexedOperands("11 mm 1101", undefined, semantics.stdMemory), // STD
      ...this.#indexedOperands("10 mm 1110", undefined, semantics.ldxMemory), // LDX
      ...this.#indexedOperands("10 mm 1111", undefined, semantics.stxMemory), // STX
      ...this.#indexedOperands("11 mm 1110", undefined, semantics.lduMemory), // LDU
      ...this.#indexedOperands("11 mm 1111", undefined, semantics.stuMemory), // STU
    ]);
  }

  #registerTransferHandlers(operation: "tfr" | "exg") {
    const bodies: Readonly<Record<`${"tfr" | "exg"}_${string}_${string}`, (state: Cpu6809State) => void>> = semantics;
    return opcodeTable<OpcodeHandler>(motorola6809TransferForms.map(([postbyte, { source, target }]) =>
      [postbyte, () => bodies[`${operation}_${source}_${target}`]!(this.#state)]));
  }

  #executeFollowingByte(table: Readonly<Partial<Record<number, OpcodeHandler>>>, instruction: InstructionContext): "unsupported" | void {
    const handler = table[instruction.fetchByte()];
    return handler ? handler(instruction) : "unsupported";
  }

  #branchHandlers(long = false): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily("0010 cccc", { c: motorolaBranchNames }, ({ c: name }) =>
      (instruction: InstructionContext) => semantics[`${long ? "l" : ""}${name}`](this.#state, instruction));
  }

  // CLR also reads its operand here; the 6800 binds CLR to a write-only instruction.
  #memoryUnaryHandlers(prefix: "0000" | "0110" | "0111", address: AddressReader): readonly OpcodeEntry<OpcodeHandler>[] {
    return this.#addressedHandlers(address, [
      ...Cpu6809.#unaryOperations.flatMap(({ bits, memory }) => addressPattern(`${prefix} ${bits}`,
        (address, instruction) => memory(this.#state, address, instruction))),
      ...addressPattern(`${prefix} 1110`, address => semantics.jump(this.#state, address)), // JMP
    ]);
  }

  #addressedHandlers(resolve: AddressReader, entries: readonly OpcodeEntry<AddressedHandler>[]): readonly OpcodeEntry<OpcodeHandler>[] {
    return entries.map(([opcode, execute]) => [opcode, instruction => {
      const address = resolve(instruction);
      if (address === undefined) return "unsupported";
      execute(address, instruction);
    }]);
  }

  // Addressing.

  #directAddress(offset: number): number {
    return (this.#state.dp << 8) | offset;
  }

  #indexedAddress(instruction: InstructionContext): number | undefined {
    const postbyte = instruction.fetchByte();
    const { fetchByte, fetchWord, readByte } = instruction;
    // 0 rr nnnnn: rr=00 X, 01 Y, 10 U, 11 S; nnnnn is a signed five-bit offset.
    const register = (["x", "y", "u", "s"] as const)[(postbyte >>> 5) & 3]!;
    const base = this.#state[register];
    if (postbyte < 0x80) {
      const offset = postbyte & 0x1f;
      return (base + (offset < 16 ? offset : offset - 32)) & 0xffff;
    }

    // 1 rr i mmmm: i=1 reads a pointer at the computed address; mmmm selects the mode.
    // PC-relative forms ignore rr. Extended indirect has exactly the postbyte 10011111.
    const indirect = (postbyte & 0x10) !== 0;
    const mode = postbyte & 0x0f;
    let address: number;
    switch (mode) {
      case 0b0000: // ,R+ (no indirect form)
      case 0b0001: // ,R++
        if (indirect && mode === 0) return undefined;
        address = base;
        this.#state[register] = (base + mode + 1) & 0xffff;
        if (register === "s") this.#state.nmiArmed = true;
        break;
      case 0b0010: // ,-R (no indirect form)
      case 0b0011: // ,--R
        if (indirect && mode === 2) return undefined;
        address = (base - (mode - 1)) & 0xffff;
        this.#state[register] = address;
        if (register === "s") this.#state.nmiArmed = true;
        break;
      case 0b0100: address = base; break; // ,R
      case 0b0101: address = base + signed8(this.#state.b); break; // B,R
      case 0b0110: address = base + signed8(this.#state.a); break; // A,R
      case 0b1000: address = base + signed8(fetchByte()); break; // n8,R
      case 0b1001: address = base + fetchWord(); break; // n16,R
      case 0b1011: address = base + this.#d; break; // D,R
      case 0b1100: address = this.#relativeAddress(signed8(fetchByte())); break; // n8,PC
      case 0b1101: address = this.#relativeAddress(fetchWord()); break; // n16,PC
      case 0b1111:
        if (postbyte !== 0b1001_1111) return undefined;
        address = fetchWord(); // [address16]
        break;
      default: return undefined; // 0111, 1010, 1110 are reserved.
    }
    // Modulo 65536 also interprets D and word offsets as two's-complement values.
    address &= 0xffff;
    return indirect ? this.#readWord(address, readByte) : address;
  }

  // Control flow.

  #relativeAddress(offset: number): number {
    // PC is past the operand. Modulo 65536 also interprets a word's two's-complement offset.
    return (this.#state.pc + offset) & 0xffff;
  }

  // Interrupt entry and return share the mask-driven register stack operations.

  #saveInterruptFrame(entire: boolean, writeByte: ByteMemory["writeByte"]): void {
    this.#state.flags.e = entire;
    semantics.pushFrame(this.#state, entire ? 0xff : 0x81, { writeByte }); // Full frame or PC/CC only.
  }

  #enterInterrupt(source: keyof typeof interruptEntries, { readByte, writeByte }: ByteMemory): void {
    const { vector, entire, masks } = interruptEntries[source];
    // CWAI already saved a full frame, even when FIRQ is the request that wakes it.
    if (this.#state.waitMode !== "cwai") this.#saveInterruptFrame(entire, writeByte);
    stateActions.maskCC(this.#state, masks);
    this.#state.waitMode = "none";
    this.#state.pc = this.#readWord(vector, readByte);
  }

  // Memory operations.

  #readWord(address: number, readByte: InstructionContext["readByte"]): number {
    return readWordBE(() => {
      const byte = readByte(address);
      address = (address + 1) & 0xffff;
      return byte;
    });
  }
}
