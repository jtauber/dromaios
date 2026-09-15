import type { Ram } from "../memory/ram.js";
import { flagRegister } from "./flags.ts";
import type { FetchedInstruction, StateTransition, InstructionStep } from "./execution-records.ts";
import { executeByteInstruction } from "./execute-byte-instruction.ts";
import { signed8, readWordBE } from "./binary.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { defineState, copyState, readState, unsigned, flag, group } from "./state.ts";
import type { StateValues, ReadonlyState } from "./state.js";
import type { OpcodeEntry } from "./opcodes.ts";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import { motorolaByteAlu, motorolaConditionPairs } from "./motorola.ts";
import { add, subtract, shiftLeft, shiftRight } from "./alu.ts";

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu6809StateDescription = defineState({
  a: unsigned(8), b: unsigned(8), dp: unsigned(8),
  x: unsigned(16), y: unsigned(16), s: unsigned(16), u: unsigned(16), pc: unsigned(16),
  flags: group({ e: flag, f: flag, h: flag, i: flag, n: flag, z: flag, v: flag, c: flag }),
});

export type Cpu6809State = StateValues<typeof cpu6809StateDescription>;
export type Cpu6809Flags = Cpu6809State["flags"];

export type Cpu6809Snapshot = ReadonlyState<Cpu6809State> & {
  readonly d: number;
};

export type Cpu6809MemoryAccess = MemoryAccess;

export type Cpu6809Instruction = FetchedInstruction;

export type Cpu6809StepRecord = InstructionStep<Cpu6809Snapshot>;

export type Cpu6809ResetRecord = StateTransition<Cpu6809Snapshot>;

type OpcodeHandler = (instruction: InstructionContext) => "unsupported" | void;
type AddressedHandler = (address: number, instruction: InstructionContext) => void;
type Accumulator = "a" | "b";
type StackPointer = "s" | "u";
type ByteOperation = (value: number) => number;
type AccumulatorOperation = (register: Accumulator, value: number) => void;
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

/** Instruction-level MC6809 subset for the 6809 examples. */
export class Cpu6809 {
  readonly #ram: Ram;
  readonly #state: Cpu6809State;
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

  /** Reset PC, DP, F, and I with only the vector reads; preserve other state and RAM. */
  reset(): Cpu6809ResetRecord {
    const before = this.snapshot();
    const { accesses, readByte } = recordMemory(this.#ram);
    const high = readByte(0xfffe);
    const low = readByte(0xffff);
    this.#state.pc = (high << 8) | low;
    this.#state.dp = 0;
    this.#state.flags.f = true;
    this.#state.flags.i = true;
    return { before, after: this.snapshot(), accesses };
  }

  /** Attempt one instruction; unsupported encodings (including prefixes) leave state unchanged. */
  step(): Cpu6809StepRecord {
    const before = this.snapshot();
    const { instruction, accesses, executed } = executeByteInstruction(this.#state, this.#ram, this.#opcodeHandlers, readWordBE);
    const record = { before, after: this.snapshot(), instruction, accesses };
    return executed
      ? { ...record, outcome: "executed" }
      : { ...record, outcome: "unsupported", reason: "opcode" };
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
    }
  }

  // Opcode selectors and construction.

  // Unary encodings: 0000 oooo = direct, 010r oooo = A/B,
  // 0110 oooo = indexed, 0111 oooo = extended. r=0 selects A, r=1 selects B.
  // TST (1101) is read-only and JMP (1110) changes PC; neither is a byte transform.
  readonly #unaryOperations: readonly { bits: string; apply: ByteOperation }[] = [
    { bits: "0000", apply: value => this.#alu.subtract(0, value) }, // NEG
    { bits: "0011", apply: value => this.#alu.complement(value) }, // COM
    { bits: "0100", apply: value => this.#alu.shift(shiftRight(8, value, 0)) }, // LSR
    { bits: "0110", apply: value => this.#alu.shift(shiftRight(8, value, this.#state.flags.c ? 1 : 0)) }, // ROR
    { bits: "0111", apply: value => this.#alu.shift(shiftRight(8, value, value >= 0x80 ? 1 : 0)) }, // ASR
    { bits: "1000", apply: value => this.#shiftLeft(value, 0) }, // ASL (LSL)
    { bits: "1001", apply: value => this.#shiftLeft(value, this.#state.flags.c ? 1 : 0) }, // ROL
    { bits: "1010", apply: value => this.#alu.adjust(value, -1) }, // DEC
    { bits: "1100", apply: value => this.#alu.adjust(value, 1) }, // INC
    { bits: "1111", apply: () => this.#alu.clear() }, // CLR
  ];

  // Accumulator encodings: 1 r mm oooo, r=0 A / r=1 B.
  // mm=00 immediate, 01 direct, 10 indexed, 11 extended.
  // The listed oooo values take byte operands; 0111 stores are separate below.
  readonly #accumulatorOperations: readonly { bits: string; apply: AccumulatorOperation }[] = [
    { bits: "0000", apply: (r, value) => { this.#state[r] = this.#alu.subtract(this.#state[r], value); } }, // SUBA/B
    { bits: "0001", apply: (r, value) => { this.#alu.subtract(this.#state[r], value); } }, // CMPA/B
    { bits: "0010", apply: (r, value) => { this.#state[r] = this.#alu.subtract(this.#state[r], value, this.#state.flags.c ? 1 : 0); } }, // SBCA/B
    { bits: "0100", apply: (r, value) => this.#loadAccumulator(r, this.#state[r] & value) }, // ANDA/B
    { bits: "0101", apply: (r, value) => this.#alu.test(this.#state[r] & value) }, // BITA/B
    { bits: "0110", apply: (r, value) => this.#loadAccumulator(r, value) }, // LDA/B
    { bits: "1000", apply: (r, value) => this.#loadAccumulator(r, this.#state[r] ^ value) }, // EORA/B
    { bits: "1001", apply: (r, value) => { this.#state[r] = this.#alu.add(this.#state[r], value, this.#state.flags.c ? 1 : 0); } }, // ADCA/B
    { bits: "1010", apply: (r, value) => this.#loadAccumulator(r, this.#state[r] | value) }, // ORA/B
    { bits: "1011", apply: (r, value) => { this.#state[r] = this.#alu.add(this.#state[r], value); } }, // ADDA/B
  ];

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

  // Prefix 10 selects page 2. Word encodings retain mm=00/01/10/11 addressing.
  // Transfers append 0=load/1=store; immediate stores are undefined.
  readonly #page2Handlers = opcodeTable<OpcodeHandler>([
    ...this.#branchHandlers(({ fetchWord }) => fetchWord()).filter(([opcode]) => opcode !== 0x20), // LBRN and LBcc; LBRA has base opcode 16
    ...this.#wordHandlers([
      { bits: "10 mm 0011", apply: value => this.#wordArithmetic("compare", "d", value) }, // CMPD
      { bits: "10 mm 1100", apply: value => this.#wordArithmetic("compare", "y", value) }, // CMPY
    ], [
      { bits: "10 mm 111", register: "y" }, // LDY / STY
      { bits: "11 mm 111", register: "s" }, // LDS / STS
    ]),
  ]);
  // Prefix 11 selects page 3: the same comparison fields select U/S rather than D/Y.
  readonly #page3Handlers = opcodeTable<OpcodeHandler>(this.#wordHandlers([
    { bits: "10 mm 0011", apply: value => this.#wordArithmetic("compare", "u", value) }, // CMPU
    { bits: "10 mm 1100", apply: value => this.#wordArithmetic("compare", "s", value) }, // CMPS
  ]));

  // Base opcode page; 10/11 dispatch exactly one following opcode in their own page.
  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    // 0000 oooo: direct unary operations; 1110 is JMP instead of a byte operation.
    ...this.#memoryUnaryHandlers("0000", this.#directOperandAddress),

    ...instructionPattern("0001 0000", instruction => this.#executePage(this.#page2Handlers, instruction)),
    ...instructionPattern("0001 0001", instruction => this.#executePage(this.#page3Handlers, instruction)),
    ...instructionPattern("0001 0010", () => {}), // NOP
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
    ...instructionPattern("001101 0 0", ({ fetchByte, writeByte }) => this.#pushRegisters("s", fetchByte(), writeByte)), // PSHS
    ...instructionPattern("001101 0 1", ({ fetchByte, readByte }) => this.#pullRegisters("s", fetchByte(), readByte)), // PULS
    ...instructionPattern("001101 1 0", ({ fetchByte, writeByte }) => this.#pushRegisters("u", fetchByte(), writeByte)), // PSHU
    ...instructionPattern("001101 1 1", ({ fetchByte, readByte }) => this.#pullRegisters("u", fetchByte(), readByte)), // PULU
    ...instructionPattern("0011 1001", ({ readByte }) => { this.#state.pc = this.#pullWord("s", readByte); }), // RTS
    ...instructionPattern("0011 1010", () => { this.#state.x = (this.#state.x + this.#state.b) & 0xffff; }), // ABX, unsigned B; preserve flags
    ...instructionPattern("0011 1101", () => this.#multiply()), // MUL

    // 010 r oooo: A/B unary operations. TST updates flags without writing a result.
    ...this.#unaryOperations.flatMap(({ bits, apply }) => opcodeFamily(`010 r ${bits}`, {
      r: ["a", "b"],
    }, ({ r: register }) => () => { this.#state[register] = apply(this.#state[register]); })),
    ...opcodeFamily("010 r 1101", { r: ["a", "b"] }, ({ r: register }) => () => this.#alu.test(this.#state[register])), // TSTA/B

    // 0110 oooo is indexed; 0111 oooo uses an extended address (including JMP).
    ...this.#memoryUnaryHandlers("0110", this.#indexedOperandAddress),
    ...this.#memoryUnaryHandlers("0111", this.#extendedOperandAddress),

    // 1 r 00 oooo: immediate A/B operations; word families occupy the remaining slots.
    ...this.#accumulatorOperations.flatMap(({ bits, apply }) => opcodeFamily(`1 r 00 ${bits}`,
      { r: ["a", "b"] }, ({ r }) => ({ fetchByte }: InstructionContext) => apply(r, fetchByte()))),
    ...instructionPattern("1 0 00 1101", ({ fetchByte, writeByte }) => this.#call(this.#relativeAddress(signed8(fetchByte())), writeByte)), // BSR rel8

    // 1 r mm oooo: the same operation selectors with a resolved memory address.
    ...this.#memoryModes.flatMap(({ bits, address }) => this.#memoryAccumulatorHandlers(bits, address)),

    // 1 r mm 0011: r=0 subtracts from D, r=1 adds to D. 10 mm 1100 compares X.
    ...this.#wordHandlers([
      { bits: "10 mm 0011", apply: value => this.#wordArithmetic("subtract", "d", value) }, // SUBD
      { bits: "11 mm 0011", apply: value => this.#wordArithmetic("add", "d", value) }, // ADDD
      { bits: "10 mm 1100", apply: value => this.#wordArithmetic("compare", "x", value) }, // CMPX
    ], [
      { bits: "11 mm 110", register: "d" }, // LDD / STD
      { bits: "10 mm 111", register: "x" }, // LDX / STX
      { bits: "11 mm 111", register: "u" }, // LDU / STU
    ]),
    // SYNC, CWAI, RTI, SWI/SWI2/SWI3, and undefined encodings remain unsupported.
  ]);

  #executePage(table: Readonly<Partial<Record<number, OpcodeHandler>>>, instruction: InstructionContext): "unsupported" | void {
    const handler = table[instruction.fetchByte()];
    return handler ? handler(instruction) : "unsupported";
  }

  #branchHandlers(readOffset: OperandReader): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily("0010 ttt p", { t: motorolaConditionPairs, p: [false, true] },
      ({ t: test, p: invert }) => instruction => this.#branch(readOffset(instruction), test(this.#state.flags) !== invert));
  }

  #memoryUnaryHandlers(prefix: "0000" | "0110" | "0111", address: AddressReader): readonly OpcodeEntry<OpcodeHandler>[] {
    return this.#addressedHandlers(address, [
      ...this.#unaryOperations.flatMap(({ bits, apply }) => addressPattern(`${prefix} ${bits}`,
        (address, instruction) => this.#modifyMemory(address, apply, instruction))),
      ...addressPattern(`${prefix} 1101`, (address, { readByte }) => this.#alu.test(readByte(address))), // TST
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
    const { fetchByte, fetchWord, readByte } = instruction;
    const postbyte = fetchByte();
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
        break;
      case 0b0010: // ,-R (no indirect form)
      case 0b0011: // ,--R
        if (indirect && mode === 2) return undefined;
        address = (base - (mode - 1)) & 0xffff;
        this.#state[register] = address;
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

  #loadAccumulator(register: Accumulator, value: number): void {
    this.#state[register] = value;
    this.#alu.test(value);
  }

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
  }

  #readTransferRegister(register: TransferRegister): number {
    if (register === "cc") return packedFlags.encode(this.#state.flags);
    return register === "d" ? this.#d : this.#state[register];
  }

  #writeTransferRegister(register: TransferRegister, value: number): void {
    if (register === "cc") this.#state.flags = packedFlags.decode(value);
    else if (register === "d") this.#writeWordRegister("d", value);
    else this.#state[register] = value;
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

  // Stack operations.
  // Postbyte bits 7..0: PC, other stack pointer, Y, X, DP, B, A, CC.
  // Bit 6 always names the pointer not selected by the opcode's s bit.

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
    if (mask & 0x40) this.#state[stack === "s" ? "u" : "s"] = pullWord();
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

  #wordArithmetic(operation: "add" | "subtract" | "compare", register: WordRegister, value: number): void {
    // Read after addressing: CMPX ,X++ compares the updated X, for example.
    const left = this.#readWordRegister(register);
    const arithmetic = operation === "add" ? add(16, left, value) : subtract(16, left, value);
    this.#alu.test(arithmetic.result, 16);
    this.#state.flags.v = arithmetic.overflow;
    this.#state.flags.c = "carry" in arithmetic ? arithmetic.carry : arithmetic.borrow;
    if (operation !== "compare") this.#writeWordRegister(register, arithmetic.result);
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

  // The 6809 preserves V for right shifts and replaces it for left shifts.

  #shiftLeft(value: number, incomingBit: 0 | 1): number {
    const result = this.#alu.shift(shiftLeft(8, value, incomingBit));
    this.#state.flags.v = this.#state.flags.n !== this.#state.flags.c;
    return result;
  }

  // Memory operations.

  #readWord(address: number, readByte: InstructionContext["readByte"]): number {
    return readWordBE(() => {
      const byte = readByte(address);
      address = (address + 1) & 0xffff;
      return byte;
    });
  }

  #modifyMemory(address: number, operation: ByteOperation, { readByte, writeByte }: InstructionContext): void {
    // CLR also reads the addressed byte. TST is bound separately because it never writes.
    const value = readByte(address);
    writeByte(address, operation(value));
  }
}
