import { instructions as semantics } from "./generated/6809.ts";
import type { Ram } from "../memory/ram.js";
import { flagRegister } from "./flags.ts";
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
import { motorolaUnaryOperations, motorolaComparisonBindings, motorolaAccumulatorOperations, motorolaByteAlu, motorolaConditionPairs, motorolaArithmeticFlags } from "./motorola.ts";
import { add, subtract } from "./alu.ts";

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
type Accumulator = "a" | "b";
type StackPointer = "s" | "u";
type OperandReader = (instruction: InstructionContext) => number;
type AddressReader = (instruction: InstructionContext) => number | undefined;
type WordRegister = "d" | "x" | "y" | "u" | "s" | "pc";
type TransferRegister = WordRegister | Accumulator | "cc" | "dp";
type WordOperation = { readonly bits: string; readonly apply: (value: number) => void };
type WordTransfer = { readonly bits: string; readonly register: WordRegister };

const instructionPattern = opcodePattern<OpcodeHandler>;

// CC bits 7..0: E F H I N Z V C.
const packedFlags = flagRegister({ e: 7, f: 6, h: 5, i: 4, n: 3, z: 2, v: 1, c: 0 });
const addressPattern = opcodePattern<AddressedHandler>;

// Vector address, frame size, and masks applied AFTER saving the original CC.
const interruptEntries = {
  swi3: { vector: 0xfff2, entire: true, masks: 0x00 },
  swi2: { vector: 0xfff4, entire: true, masks: 0x00 },
  firq: { vector: 0xfff6, entire: false, masks: 0x50 },
  irq:  { vector: 0xfff8, entire: true, masks: 0x10 },
  swi:  { vector: 0xfffa, entire: true, masks: 0x50 },
  nmi:  { vector: 0xfffc, entire: true, masks: 0x50 },
} as const;

/** Instruction-level Motorola 6809 with explicit boundary IRQ/FIRQ/NMI delivery. */
export class Cpu6809 {
  readonly #ram: Ram;
  readonly #state: Cpu6809State;
  readonly #atBoundary = executionBoundary("6809 step, reset, and interrupt calls must not be reentrant.");
  readonly #alu = motorolaByteAlu(() => this.#state.flags);

  constructor(ram: Ram, initialState: Omit<Cpu6809Snapshot, "d">) {
    if (ram.size !== 0x10000) {
      throw new RangeError("The 6809 model requires exactly 64 KiB of RAM.");
    }
    this.#ram = ram;
    this.#state = readState(cpu6809StateDescription, initialState);
  }

  /** Inspect a detached copy, including D derived from A/B, without accessing RAM. */
  snapshot(): Cpu6809Snapshot {
    const state = copyState(cpu6809StateDescription, this.#state);
    return { ...state, d: (state.a << 8) | state.b };
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

  get #d(): number { return (this.#state.a << 8) | this.#state.b; }

  #readWordRegister(register: WordRegister): number {
    return register === "d" ? this.#d : this.#state[register];
  }

  #writeWordRegister(register: WordRegister, value: number): void {
    if (register === "d") {
      this.#state.a = value >>> 8;
      this.#state.b = value & 0xff;
    } else {
      this.#state[register] = value;
      if (register === "s") this.#state.nmiArmed = true;
    }
  }

  // Opcode selectors and construction.

  // Unary encodings: 0000 oooo = direct, 010r oooo = A/B,
  // 0110 oooo = indexed, 0111 oooo = extended. r=0 selects A, r=1 selects B.
  // Generated register bodies are in A/B selector order; memory bodies receive one resolved address.
  // TST (1101) never writes. JMP (1110) changes PC and stays outside this inventory.
  static readonly #unaryOperations = motorolaUnaryOperations(semantics);

  // 1 r mm oooo: r selects A/B; mm=00 immediate, 01 direct, 10 indexed, 11 extended.
  // Byte operations are shared with the 6800; CMP (0001) has generated bodies below.
  readonly #accumulatorOperations = motorolaAccumulatorOperations(() => this.#state, this.#alu);

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
  readonly #transferRegisters = ["d", "x", "y", "u", "s", "pc", undefined, undefined, "a", "b", "cc", "dp"] as const;

  readonly #comparisonHandlers = motorolaComparisonBindings(() => this.#state, this.#memoryModes);

  // Prefix 10 selects page 2. Word encodings retain mm=00/01/10/11 addressing.
  // Transfers append 0=load/1=store; immediate stores are undefined.
  readonly #page2Handlers = opcodeTable<OpcodeHandler>([
    ...instructionPattern("0011 1111", instruction => this.#enterInterrupt("swi2", instruction)), // SWI2
    ...this.#branchHandlers(({ fetchWord }) => fetchWord()).filter(([opcode]) => opcode !== 0x20), // LBRN and LBcc; LBRA has base opcode 16
    ...this.#comparisonHandlers("10 mm 0011", semantics.cmpdImmediate, semantics.cmpdMemory), // CMPD
    ...this.#comparisonHandlers("10 mm 1100", semantics.cmpyImmediate, semantics.cmpyMemory), // CMPY
    ...this.#wordHandlers([], [
      { bits: "10 mm 111", register: "y" }, // LDY / STY
      { bits: "11 mm 111", register: "s" }, // LDS / STS
    ]),
  ]);
  // Prefix 11 selects page 3: the same comparison fields select U/S rather than D/Y.
  readonly #page3Handlers = opcodeTable<OpcodeHandler>([
    ...instructionPattern("0011 1111", instruction => this.#enterInterrupt("swi3", instruction)), // SWI3
    ...this.#comparisonHandlers("10 mm 0011", semantics.cmpuImmediate, semantics.cmpuMemory), // CMPU
    ...this.#comparisonHandlers("10 mm 1100", semantics.cmpsImmediate, semantics.cmpsMemory), // CMPS
  ]);

  // Base opcode page; 10/11 dispatch exactly one following opcode in their own page.
  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    // 0000 oooo: direct unary operations; 1110 is JMP instead of a byte operation.
    ...this.#memoryUnaryHandlers("0000", this.#directOperandAddress),

    ...instructionPattern("0001 0000", instruction => this.#executePage(this.#page2Handlers, instruction)),
    ...instructionPattern("0001 0001", instruction => this.#executePage(this.#page3Handlers, instruction)),
    ...instructionPattern("0001 0010", () => {}), // NOP
    ...instructionPattern("0001 0011", () => { this.#state.waitMode = "sync"; }), // SYNC
    ...instructionPattern("0001 0110", ({ fetchWord }) => { this.#state.pc = this.#relativeAddress(fetchWord()); }), // LBRA rel16
    ...instructionPattern("0001 0111", ({ fetchWord, writeByte }) => this.#call(this.#relativeAddress(fetchWord()), writeByte)), // LBSR rel16

    ...instructionPattern("0001 1001", () => { this.#state.a = this.#alu.decimalAdjust(this.#state.a); }), // DAA
    ...instructionPattern("0001 1010", ({ fetchByte }) => this.#writeTransferRegister("cc", packedFlags.encode(this.#state.flags) | fetchByte())), // ORCC
    ...instructionPattern("0001 1100", ({ fetchByte }) => this.#writeTransferRegister("cc", packedFlags.encode(this.#state.flags) & fetchByte())), // ANDCC
    ...instructionPattern("0001 1101", () => this.#signExtend()), // SEX
    // 0001111 t: t=0 exchanges, t=1 transfers; the postbyte selects same-width registers.
    ...instructionPattern("0001111 0", ({ fetchByte }) => this.#transfer(fetchByte(), true)), // EXG
    ...instructionPattern("0001111 1", ({ fetchByte }) => this.#transfer(fetchByte(), false)), // TFR

    // 0010 ttt p: ttt selects T/HI/CC/NE/VC/PL/GE/GT; bit 0 inverts it.
    ...this.#branchHandlers(({ fetchByte }) => signed8(fetchByte())), // BRA / BRN / Bcc

    // 001100 rr: rr=00/01/10/11 selects X/Y/S/U; only X/Y replace Z.
    ...this.#addressedHandlers(this.#indexedOperandAddress, opcodeFamily("001100 rr", { r: ["x", "y", "s", "u"] },
      ({ r }) => (address: number) => this.#loadEffectiveAddress(r, address))), // LEAX / LEAY / LEAS / LEAU

    // 001101 s p: s=0 selects S, s=1 selects U; p=0 pushes, p=1 pulls.
    ...opcodeFamily("001101 s p", { s: ["s", "u"], p: [false, true] },
      ({ s, p }) => (instruction: InstructionContext) => this.#stackInstruction(s, p, instruction)), // PSHS / PULS / PSHU / PULU
    ...instructionPattern("0011 1001", ({ readByte }) => { this.#state.pc = this.#pullWord("s", readByte); }), // RTS
    ...instructionPattern("0011 1010", () => { this.#state.x = (this.#state.x + this.#state.b) & 0xffff; }), // ABX, unsigned B; preserve flags
    ...instructionPattern("0011 1011", ({ readByte }) => this.#returnFromInterrupt(readByte)), // RTI
    ...instructionPattern("0011 1100", instruction => this.#waitForInterrupt(instruction)), // CWAI #mask
    ...instructionPattern("0011 1101", () => this.#multiply()), // MUL
    ...instructionPattern("0011 1111", instruction => this.#enterInterrupt("swi", instruction)), // SWI

    // 010 r oooo: A/B unary operations. TST updates flags without writing a result.
    ...Cpu6809.#unaryOperations.flatMap(({ bits, registers }) => opcodeFamily(`010 r ${bits}`,
      { r: registers }, ({ r: execute }) => () => execute(this.#state))),

    // 0110 oooo is indexed; 0111 oooo uses an extended address (including JMP).
    ...this.#memoryUnaryHandlers("0110", this.#indexedOperandAddress),
    ...this.#memoryUnaryHandlers("0111", this.#extendedOperandAddress),

    // 1 r mm 0001: CMPA/B share all four addressing modes; r=0 selects A, r=1 selects B.
    ...this.#comparisonHandlers("10 mm 0001", semantics.cmpaImmediate, semantics.cmpaMemory), // CMPA
    ...this.#comparisonHandlers("11 mm 0001", semantics.cmpbImmediate, semantics.cmpbMemory), // CMPB

    // 1 r 00 oooo: remaining immediate A/B operations; word families occupy the remaining slots.
    ...this.#accumulatorOperations.flatMap(({ bits, apply }) => opcodeFamily(`1 r 00 ${bits}`,
      { r: ["a", "b"] }, ({ r }) => ({ fetchByte }: InstructionContext) => apply(r, fetchByte()))),
    ...instructionPattern("1 0 00 1101", ({ fetchByte, writeByte }) => this.#call(this.#relativeAddress(signed8(fetchByte())), writeByte)), // BSR rel8

    // 1 r mm oooo: the same operation selectors with a resolved memory address.
    ...this.#memoryModes.flatMap(({ bits, address }) => this.#memoryAccumulatorHandlers(bits, address)),

    // 10 mm 1100: CMPX uses immediate/direct/indexed/extended sources for mm=00/01/10/11.
    ...this.#comparisonHandlers("10 mm 1100", semantics.cmpxImmediate, semantics.cmpxMemory), // CMPX

    // 1 r mm 0011: r=0 subtracts from D, r=1 adds to D.
    ...this.#wordHandlers([
      { bits: "10 mm 0011", apply: value => this.#wordArithmetic("subtract", value) }, // SUBD
      { bits: "11 mm 0011", apply: value => this.#wordArithmetic("add", value) }, // ADDD
    ], [
      { bits: "11 mm 110", register: "d" }, // LDD / STD
      { bits: "10 mm 111", register: "x" }, // LDX / STX
      { bits: "11 mm 111", register: "u" }, // LDU / STU
    ]),
  ]);

  #executePage(table: Readonly<Partial<Record<number, OpcodeHandler>>>, instruction: InstructionContext): "unsupported" | void {
    const handler = table[instruction.fetchByte()];
    return handler ? handler(instruction) : "unsupported";
  }

  #branchHandlers(readOffset: OperandReader): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily("0010 ttt p", { t: motorolaConditionPairs, p: [false, true] },
      ({ t: test, p: invert }) => instruction => this.#branch(readOffset(instruction), test(this.#state.flags) !== invert));
  }

  // CLR also reads its operand here; the 6800 binds CLR to a write-only instruction.
  #memoryUnaryHandlers(prefix: "0000" | "0110" | "0111", address: AddressReader): readonly OpcodeEntry<OpcodeHandler>[] {
    return this.#addressedHandlers(address, [
      ...Cpu6809.#unaryOperations.flatMap(({ bits, memory }) => addressPattern(`${prefix} ${bits}`,
        (address, instruction) => memory(this.#state, address, instruction))),
      ...addressPattern(`${prefix} 1110`, address => { this.#state.pc = address; }), // JMP
    ]);
  }

  #memoryAccumulatorHandlers(mode: "01" | "10" | "11", address: AddressReader): readonly OpcodeEntry<OpcodeHandler>[] {
    return this.#addressedHandlers(address, [
      ...this.#accumulatorOperations.flatMap(({ bits, apply }) => opcodeFamily(`1 r ${mode} ${bits}`,
        { r: ["a", "b"] }, ({ r }) => (address: number, { readByte }: InstructionContext) => apply(r, readByte(address)))),
      ...opcodeFamily(`1 r ${mode} 0111`, { r: ["a", "b"] }, ({ r }) =>
        (address: number, { writeByte }: InstructionContext) => this.#storeAccumulator(r, address, writeByte)), // STA/B
      ...addressPattern(`1 0 ${mode} 1101`, (address, { writeByte }) => this.#call(address, writeByte)), // JSR
    ]);
  }

  #wordHandlers(operations: readonly WordOperation[], transfers: readonly WordTransfer[] = []): readonly OpcodeEntry<OpcodeHandler>[] {
    const reads: readonly WordOperation[] = [
      ...operations,
      ...transfers.map(({ bits, register }) => ({ bits: `${bits} 0`, apply: (value: number) => this.#loadWord(register, value) })),
    ];
    return [
      ...reads.flatMap(({ bits, apply }) => instructionPattern(bits.replace("mm", "00"), ({ fetchWord }) => apply(fetchWord()))),
      ...this.#memoryModes.flatMap(({ bits: mode, address }) => this.#addressedHandlers(address, [
        ...reads.flatMap(({ bits, apply }) => addressPattern(bits.replace("mm", mode), (address, { readByte }) => apply(this.#readWord(address, readByte)))),
        ...transfers.flatMap(({ bits, register }) => addressPattern(`${bits.replace("mm", mode)} 1`, (address, { writeByte }) => this.#storeWord(register, address, writeByte))),
      ])),
    ];
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

  // Loads and stores.

  #storeAccumulator(register: Accumulator, address: number, writeByte: InstructionContext["writeByte"]): void {
    const value = this.#state[register];
    writeByte(address, value);
    this.#alu.test(value);
  }

  #loadWord(register: WordRegister, value: number): void {
    this.#writeWordRegister(register, value);
    this.#alu.test(value, 16);
  }

  #storeWord(register: WordRegister, address: number, writeByte: InstructionContext["writeByte"]): void {
    // Address calculation (including auto-update of this register) precedes reading the source.
    const value = this.#readWordRegister(register);
    writeByte(address, value >>> 8);
    writeByte((address + 1) & 0xffff, value & 0xff);
    this.#alu.test(value, 16);
  }

  #loadEffectiveAddress(register: "x" | "y" | "s" | "u", address: number): void {
    this.#state[register] = address; // Overwrite any auto-update of the destination during addressing.
    if (register === "x" || register === "y") this.#state.flags.z = address === 0;
    if (register === "s") this.#state.nmiArmed = true;
  }

  #readTransferRegister(register: TransferRegister): number {
    if (register === "cc") return packedFlags.encode(this.#state.flags);
    return register === "d" ? this.#d : this.#state[register];
  }

  #writeTransferRegister(register: TransferRegister, value: number): void {
    if (register === "cc") this.#state.flags = packedFlags.decode(value);
    else if (register === "d") this.#writeWordRegister("d", value);
    else this.#state[register] = value;
    if (register === "s") this.#state.nmiArmed = true;
  }

  #transfer(postbyte: number, exchange: boolean): "unsupported" | void {
    const sourceCode = postbyte >>> 4, targetCode = postbyte & 0x0f;
    const source = this.#transferRegisters[sourceCode], target = this.#transferRegisters[targetCode];
    if (source === undefined || target === undefined || (sourceCode < 8) !== (targetCode < 8)) return "unsupported";
    // Read both originals before writing either, including CC and the PC after the postbyte.
    const value = this.#readTransferRegister(source), previous = this.#readTransferRegister(target);
    this.#writeTransferRegister(target, value);
    if (exchange) this.#writeTransferRegister(source, previous);
  }

  // Control flow.

  #relativeAddress(offset: number): number {
    // PC is past the operand. Modulo 65536 also interprets a word's two's-complement offset.
    return (this.#state.pc + offset) & 0xffff;
  }

  #branch(offset: number, take: boolean): void {
    if (take) this.#state.pc = this.#relativeAddress(offset);
  }

  #call(address: number, writeByte: InstructionContext["writeByte"]): void {
    // Fetch the complete operand before stacking the return PC on S, low byte first.
    this.#pushWord("s", this.#state.pc, writeByte);
    this.#state.pc = address;
  }

  // Interrupt entry and return share the mask-driven register stack operations.

  #saveInterruptFrame(entire: boolean, writeByte: ByteMemory["writeByte"]): void {
    this.#state.flags.e = entire;
    this.#pushRegisters("s", entire ? 0xff : 0x81, writeByte); // Full frame or PC/CC only.
  }

  #enterInterrupt(source: keyof typeof interruptEntries, { readByte, writeByte }: ByteMemory): void {
    const { vector, entire, masks } = interruptEntries[source];
    // CWAI already saved a full frame, even when FIRQ is the request that wakes it.
    if (this.#state.waitMode !== "cwai") this.#saveInterruptFrame(entire, writeByte);
    this.#state.flags = packedFlags.decode(packedFlags.encode(this.#state.flags) | masks);
    this.#state.waitMode = "none";
    this.#state.pc = this.#readWord(vector, readByte);
  }

  #waitForInterrupt({ fetchByte, writeByte }: InstructionContext): void {
    this.#state.flags = packedFlags.decode(packedFlags.encode(this.#state.flags) & fetchByte());
    this.#saveInterruptFrame(true, writeByte);
    this.#state.waitMode = "cwai";
  }

  #returnFromInterrupt(readByte: ByteMemory["readByte"]): void {
    this.#pullRegisters("s", 0x01, readByte); // Restored E, not hidden state, selects the frame.
    this.#pullRegisters("s", this.#state.flags.e ? 0xfe : 0x80, readByte);
    this.#state.nmiArmed = true;
  }

  // Stack operations.
  // Postbyte bits 7..0: PC, other stack pointer, Y, X, DP, B, A, CC.
  // Bit 6 always names the pointer not selected by the opcode's s bit.

  #stackInstruction(stack: StackPointer, pull: boolean, instruction: InstructionContext): void {
    const mask = instruction.fetchByte();
    if (pull) this.#pullRegisters(stack, mask, instruction.readByte);
    else this.#pushRegisters(stack, mask, instruction.writeByte);
    // Nonempty PSHS/PULS arm NMI; interrupt stacking and subroutine calls do not.
    if (stack === "s" && mask !== 0) this.#state.nmiArmed = true;
  }

  #pushRegisters(stack: StackPointer, mask: number, writeByte: InstructionContext["writeByte"]): void {
    const pushByte = (value: number): void => this.#pushByte(stack, value, writeByte);
    const pushWord = (value: number): void => this.#pushWord(stack, value, writeByte);
    // Descending mask order; PC has already advanced past the postbyte.
    if (mask & 0x80) pushWord(this.#state.pc);
    if (mask & 0x40) pushWord(this.#state[stack === "s" ? "u" : "s"]);
    if (mask & 0x20) pushWord(this.#state.y);
    if (mask & 0x10) pushWord(this.#state.x);
    if (mask & 0x08) pushByte(this.#state.dp);
    if (mask & 0x04) pushByte(this.#state.b);
    if (mask & 0x02) pushByte(this.#state.a);
    if (mask & 0x01) pushByte(packedFlags.encode(this.#state.flags));
  }

  #pullRegisters(stack: StackPointer, mask: number, readByte: InstructionContext["readByte"]): void {
    const pullByte = (): number => this.#pullByte(stack, readByte);
    const pullWord = (): number => this.#pullWord(stack, readByte);
    // Reverse the push order; ordinary pulls do not apply load-instruction flags.
    if (mask & 0x01) this.#state.flags = packedFlags.decode(pullByte());
    if (mask & 0x02) this.#state.a = pullByte();
    if (mask & 0x04) this.#state.b = pullByte();
    if (mask & 0x08) this.#state.dp = pullByte();
    if (mask & 0x10) this.#state.x = pullWord();
    if (mask & 0x20) this.#state.y = pullWord();
    if (mask & 0x40) {
      this.#state[stack === "s" ? "u" : "s"] = pullWord();
      if (stack === "u") this.#state.nmiArmed = true;
    }
    if (mask & 0x80) this.#state.pc = pullWord();
  }

  #pushByte(stack: StackPointer, value: number, writeByte: InstructionContext["writeByte"]): void {
    this.#state[stack] = (this.#state[stack] - 1) & 0xffff;
    writeByte(this.#state[stack], value);
  }

  #pushWord(stack: StackPointer, value: number, writeByte: InstructionContext["writeByte"]): void {
    this.#pushByte(stack, value & 0xff, writeByte);
    this.#pushByte(stack, value >>> 8, writeByte);
  }

  #pullByte(stack: StackPointer, readByte: InstructionContext["readByte"]): number {
    const value = readByte(this.#state[stack]);
    this.#state[stack] = (this.#state[stack] + 1) & 0xffff;
    return value;
  }

  #pullWord(stack: StackPointer, readByte: InstructionContext["readByte"]): number {
    return readWordBE(() => this.#pullByte(stack, readByte));
  }

  // Arithmetic and CPU-specific flag effects.

  #wordArithmetic(operation: "add" | "subtract", value: number): void {
    const arithmetic = operation === "add" ? add(16, this.#d, value) : subtract(16, this.#d, value);
    Object.assign(this.#state.flags, motorolaArithmeticFlags(16, arithmetic));
    this.#writeWordRegister("d", arithmetic.result);
  }

  #signExtend(): void {
    this.#state.a = this.#state.b < 0x80 ? 0 : 0xff;
    this.#state.flags.n = this.#state.b >= 0x80;
    this.#state.flags.z = this.#state.b === 0; // SEX preserves V, unlike a word load.
  }

  #multiply(): void {
    const product = this.#state.a * this.#state.b;
    this.#writeWordRegister("d", product);
    this.#state.flags.z = product === 0;
    this.#state.flags.c = (product & 0x80) !== 0; // Bit 7 supports rounding the high byte, not overflow.
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
