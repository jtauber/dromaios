import type { Ram } from "../memory/ram.js";
import { callStack16LE } from "./call-stack.ts";
import { pairViews, readRegisterPair, writeRegisterPair } from "./register-pairs.ts";
import type { RegisterPair as ByteRegisterPair } from "./register-pairs.ts";
import { flagRegister } from "./flags.ts";
import type { FetchedInstruction, StateTransition, InstructionStep, HaltedStep } from "./execution-records.ts";
import { signed8, readWordLE } from "./binary.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { defineState, copyState, readState, unsigned, flag, boolean, choices, group } from "./state.ts";
import type { StateValues, ReadonlyState } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.js";
import { add, subtract, shiftLeft, shiftRight, evenParity8 } from "./alu.ts";
import type { ShiftResult } from "./alu.ts";

const bankFields = defineState({
  a: unsigned(8), b: unsigned(8), c: unsigned(8), d: unsigned(8), e: unsigned(8), h: unsigned(8), l: unsigned(8),
  flags: group({ s: flag, z: flag, h: flag, pv: flag, n: flag, c: flag }),
});

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpuZ80StateDescription = defineState({
  ...bankFields, alternate: group(bankFields),
  ix: unsigned(16), iy: unsigned(16), pc: unsigned(16), sp: unsigned(16), i: unsigned(8), r: unsigned(8),
  iff1: boolean, iff2: boolean, im: choices(0, 1, 2), halted: boolean,
});

export type CpuZ80State = StateValues<typeof cpuZ80StateDescription>;
/** The six documented flags; undocumented F bits 3 and 5 are outside this model. */
export type CpuZ80Flags = CpuZ80State["flags"];

export type CpuZ80RegisterBank = StateValues<typeof bankFields>;

export type CpuZ80BankSnapshot = ReadonlyState<CpuZ80RegisterBank> & {
  readonly bc: number;
  readonly de: number;
  readonly hl: number;
};

export type CpuZ80Snapshot = CpuZ80BankSnapshot &
  Readonly<Omit<CpuZ80State, keyof CpuZ80RegisterBank | "alternate">> & {
    readonly alternate: CpuZ80BankSnapshot;
  };

export type CpuZ80MemoryAccess = MemoryAccess;

export type CpuZ80Instruction = FetchedInstruction;

export type CpuZ80StepRecord = InstructionStep<CpuZ80Snapshot> | HaltedStep<CpuZ80Snapshot>;

export type CpuZ80ResetRecord = StateTransition<CpuZ80Snapshot>;

type OpcodeHandler = (instruction: InstructionContext) => void;
type ByteOperation = (value: number) => number;
type ByteRegister = "a" | "b" | "c" | "d" | "e" | "h" | "l";
type ByteOperand = ByteRegister | "(hl)";
type RegisterPair = ByteRegisterPair | "sp" | "af";

// Fix the handler type once so pattern callbacks infer their instruction context.
const instructionPattern = opcodePattern<OpcodeHandler>;

// F = S Z 0 H 0 PV N C. Unmodeled bits 5/3 pack as zero, not hardware constants.
const packedFlags = flagRegister({ s: 7, z: 6, h: 4, pv: 2, n: 1, c: 0 });

/** Instruction-level Zilog Z80 subset with documented flags and opcode-fetch R updates. */
export class CpuZ80 {
  readonly #ram: Ram;
  readonly #state: CpuZ80State;
  readonly #stack: ReturnType<typeof callStack16LE>;

  constructor(ram: Ram, initialState: CpuZ80State) {
    if (ram.size !== 0x10000) throw new RangeError("The Z80 model requires exactly 64 KiB of RAM.");
    this.#ram = ram;
    this.#state = readState(cpuZ80StateDescription, initialState);
    this.#stack = callStack16LE(this.#state);
  }

  /** Inspect detached register banks and their derived pair views without reading RAM. */
  snapshot(): CpuZ80Snapshot {
    const state = copyState(cpuZ80StateDescription, this.#state);
    return { ...state, ...pairViews(state), alternate: { ...state.alternate, ...pairViews(state.alternate) } };
  }

  /** Apply documented reset effects, release HALT, and preserve other stored state and RAM. */
  reset(): CpuZ80ResetRecord {
    const before = this.snapshot();
    this.#state.pc = 0;
    this.#state.i = 0;
    this.#state.r = 0;
    this.#state.iff1 = false;
    this.#state.iff2 = false;
    this.#state.im = 0;
    this.#state.halted = false;
    return { before, after: this.snapshot(), accesses: [] };
  }

  /** Attempt one instruction; unsupported and already halted attempts preserve all state, including R. */
  step(): CpuZ80StepRecord {
    const before = this.snapshot();
    if (this.#state.halted) {
      return { before, after: this.snapshot(), instruction: null, accesses: [], outcome: "halted" };
    }
    const { accesses, readByte, writeByte } = recordMemory(this.#ram);
    const address = this.#state.pc;
    const opcode = readByte(address);
    const bytes = [opcode];
    // Decode before changing state so an unsupported CB operation is rejected atomically.
    // Each CB byte is an opcode fetch; DD/ED/FD still stop after the first byte.
    let handler: OpcodeHandler | undefined;
    if (opcode === 0xcb) {
      const operation = readByte((address + 1) & 0xffff);
      bytes.push(operation);
      handler = this.#cbOpcodeHandlers[operation];
    } else handler = this.#opcodeHandlers[opcode];
    if (handler) {
      this.#state.pc = (address + bytes.length) & 0xffff;
      // Operand fetches below are ordinary reads and do not increment R.
      this.#state.r = (this.#state.r & 0x80) | ((this.#state.r + bytes.length) & 0x7f);
      const fetchByte = (): number => {
        const byte = readByte(this.#state.pc);
        this.#state.pc = (this.#state.pc + 1) & 0xffff;
        bytes.push(byte);
        return byte;
      };
      handler({
        fetchByte,
        fetchWord: () => readWordLE(fetchByte),
        readByte,
        writeByte,
      });
    }
    const record = { instruction: { address, bytes }, before, after: this.snapshot(), accesses };
    return handler
      ? { ...record, outcome: this.#state.halted ? "halted" : "executed" }
      : { ...record, outcome: "unsupported", reason: "opcode" };
  }

  // Register views.

  get #hl(): number {
    return (this.#state.h << 8) | this.#state.l;
  }

  set #hl(value: number) {
    this.#state.h = value >>> 8;
    this.#state.l = value & 0xff;
  }

  get #af(): number {
    return (this.#state.a << 8) | packedFlags.encode(this.#state.flags);
  }

  set #af(value: number) {
    this.#state.a = value >>> 8;
    this.#state.flags = packedFlags.decode(value);
  }

  // Opcode selectors and construction.

  // rrr/ddd/sss select B/C/D/E/H/L/(HL)/A in order; 110 addresses RAM through HL.
  readonly #byteOperands = ["b", "c", "d", "e", "h", "l", "(hl)", "a"] as const;

  // pp selects BC/DE/HL/SP; byte-pair views share the 8080 register relationships.
  readonly #registerPairs = ["bc", "de", "hl", "sp"] as const;

  // qq selects BC/DE/HL/AF for the stack families; AF replaces pp's SP slot.
  readonly #stackPairs = ["bc", "de", "hl", "af"] as const;

  // bbb selects a bit number; bind its mask once when constructing the CB page.
  readonly #bitMasks = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80] as const;

  // ooo selects the ALU operation in both 10 ooo rrr and 11 ooo 110.
  // Operations read live state and return the next A; CP returns A unchanged.
  readonly #aluOperations: readonly ByteOperation[] = [
    value => this.#add(value), // 000 ADD
    value => this.#add(value, this.#state.flags.c ? 1 : 0), // 001 ADC
    value => this.#subtract(value), // 010 SUB
    value => this.#subtract(value, this.#state.flags.c ? 1 : 0), // 011 SBC
    value => this.#parityResult(this.#state.a & value, { h: true, c: false }), // 100 AND
    value => this.#parityResult(this.#state.a ^ value, { h: false, c: false }), // 101 XOR
    value => this.#parityResult(this.#state.a | value, { h: false, c: false }), // 110 OR
    value => this.#compare(value), // 111 CP
  ];

  // ccc=ffv: ff selects Z/C/PV/S; v is the required value, giving NZ/Z/NC/C/PO/PE/P/M.
  // Conditional JR uses just the first four tests.
  readonly #conditions = (["z", "c", "pv", "s"] as const).flatMap(flag =>
    [false, true].map(value => () => this.#state.flags[flag] === value));

  // Unprefixed opcode bits: 7 6 | 5 4 3 | 2 1 0 = xx yyy zzz.
  // xx selects a block; the other fields select its operation and operands.
  // Pair families split yyy into pp q. CB has its own second-byte table below.
  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    // xx=00, zzz=000: yyy selects NOP, EX AF,AF', DJNZ, JR, then 1cc conditional JR.
    ...instructionPattern("00 000 000", () => {}), // NOP
    ...instructionPattern("00 001 000", () => this.#exchangeAf()), // EX AF,AF'
    ...instructionPattern("00 010 000", ({ fetchByte }) => this.#decrementAndJump(fetchByte())), // DJNZ e
    ...instructionPattern("00 011 000", ({ fetchByte }) => this.#jumpRelative(fetchByte(), true)), // JR e
    ...opcodeFamily("00 1cc 000", { c: this.#conditions.slice(0, 4) }, ({ c: condition }) => ({ fetchByte }: InstructionContext) => this.#jumpRelative(fetchByte(), condition())), // JR NZ/Z/NC/C,e

    // 00 pp q 001: pp selects BC/DE/HL/SP; q=0 loads nn, q=1 adds the pair to HL.
    ...opcodeFamily("00 pp 0 001", { p: this.#registerPairs }, ({ p: pair }) => ({ fetchWord }: InstructionContext) => this.#writePair(pair, fetchWord())), // LD dd,nn
    ...opcodeFamily("00 pp 1 001", { p: this.#registerPairs }, ({ p: pair }) => () => this.#addHl(this.#readPair(pair))), // ADD HL,ss

    // 00 pp q 010: q=0 stores, q=1 loads. pp=00/01 uses A and (BC)/(DE);
    // pp=10 uses HL and (nn), pp=11 uses A and (nn). Word operands are low byte first.
    ...opcodeFamily("00 0p 0 010", { p: this.#registerPairs.slice(0, 2) }, ({ p: pair }) => ({ writeByte }: InstructionContext) => writeByte(this.#readPair(pair), this.#state.a)), // LD (BC)/(DE),A
    ...opcodeFamily("00 0p 1 010", { p: this.#registerPairs.slice(0, 2) }, ({ p: pair }) => ({ readByte }: InstructionContext) => { this.#state.a = readByte(this.#readPair(pair)); }), // LD A,(BC)/(DE)
    ...instructionPattern("00 10 0 010", ({ fetchWord, writeByte }) => this.#writeMemoryWord(fetchWord(), this.#hl, writeByte)), // LD (nn),HL
    ...instructionPattern("00 10 1 010", ({ fetchWord, readByte }) => { this.#hl = this.#readMemoryWord(fetchWord(), readByte); }), // LD HL,(nn)
    ...instructionPattern("00 11 0 010", ({ fetchWord, writeByte }) => writeByte(fetchWord(), this.#state.a)), // LD (nn),A
    ...instructionPattern("00 11 1 010", ({ fetchWord, readByte }) => { this.#state.a = readByte(fetchWord()); }), // LD A,(nn)

    // 00 pp q 011: q=0 increments, q=1 decrements the selected word pair; preserve every flag.
    ...opcodeFamily("00 pp q 011", { p: this.#registerPairs, q: [1, -1] }, ({ p: pair, q: delta }) => () => this.#writePair(pair, (this.#readPair(pair) + delta) & 0xffff)), // INC/DEC ss

    // 00 rrr zzz: rrr selects B/C/D/E/H/L/(HL)/A; zzz selects INC, DEC, or immediate LD.
    ...this.#modifyHandlers("00 rrr 100", value => this.#adjustByte(value, 1)), // INC r / (HL)
    ...this.#modifyHandlers("00 rrr 101", value => this.#adjustByte(value, -1)), // DEC r / (HL)
    ...opcodeFamily("00 rrr 110", { r: this.#byteOperands }, ({ r: operand }) => (instruction: InstructionContext) => this.#writeOperand(operand, instruction.fetchByte(), instruction)), // LD r,n / LD (HL),n

    // 00 yyy 111: yyy=000–011 rotates A while preserving S/Z/PV; 100–111 adjusts A or carry.
    ...instructionPattern("00 000 111", () => this.#rotateAccumulator(shiftLeft(8, this.#state.a, (this.#state.a & 0x80) !== 0 ? 1 : 0))), // RLCA
    ...instructionPattern("00 001 111", () => this.#rotateAccumulator(shiftRight(8, this.#state.a, (this.#state.a & 1) !== 0 ? 1 : 0))), // RRCA
    ...instructionPattern("00 010 111", () => this.#rotateAccumulator(shiftLeft(8, this.#state.a, this.#state.flags.c ? 1 : 0))), // RLA
    ...instructionPattern("00 011 111", () => this.#rotateAccumulator(shiftRight(8, this.#state.a, this.#state.flags.c ? 1 : 0))), // RRA
    ...instructionPattern("00 100 111", () => this.#decimalAdjust()), // DAA
    ...instructionPattern("00 101 111", () => this.#complementAccumulator()), // CPL
    ...instructionPattern("00 110 111", () => this.#setCarry()), // SCF
    ...instructionPattern("00 111 111", () => this.#complementCarry()), // CCF

    // 01 ddd sss: ddd (bits 5..3) selects destination; sss (bits 2..0) selects source.
    // 01 110 110 is HALT, not LD (HL),(HL); the binding handles this exception.
    ...opcodeFamily("01 ddd sss", { d: this.#byteOperands, s: this.#byteOperands }, ({ d: destination, s: source }) => this.#transferHandler(destination, source)), // LD r,r' / LD r,(HL) / LD (HL),r / HALT

    // 10 ooo rrr: ooo selects ADD/ADC/SUB/SBC/AND/XOR/OR/CP; rrr selects B/C/D/E/H/L/(HL)/A.
    ...opcodeFamily("10 ooo rrr", { o: this.#aluOperations, r: this.#byteOperands }, ({ o: operate, r: operand }) =>
      (instruction: InstructionContext) => { this.#state.a = operate(this.#readOperand(operand, instruction)); }), // ALU r / ALU (HL)

    // 11 ccc 000: conditional returns read the stack only when the condition is true.
    ...opcodeFamily("11 ccc 000", { c: this.#conditions }, ({ c: condition }) => ({ readByte }: InstructionContext) => this.#stack.return(readByte, condition())), // RET cc

    // 11 pp q 001: q=0 pops BC/DE/HL/AF; q=1 selects RET, EXX, JP (HL), or LD SP,HL.
    ...opcodeFamily("11 qq 0 001", { q: this.#stackPairs }, ({ q: pair }) => ({ readByte }: InstructionContext) => this.#writePair(pair, this.#stack.pop(readByte))), // POP qq
    ...instructionPattern("11 00 1 001", ({ readByte }) => this.#stack.return(readByte)), // RET
    ...instructionPattern("11 01 1 001", () => this.#exchangeGeneralBanks()), // EXX
    ...instructionPattern("11 10 1 001", () => this.#jump(this.#hl)), // JP (HL)
    ...instructionPattern("11 11 1 001", () => { this.#state.sp = this.#hl; }), // LD SP,HL

    // 11 ccc 010: all eight absolute jump conditions fetch nn on both paths.
    ...opcodeFamily("11 ccc 010", { c: this.#conditions }, ({ c: condition }) => ({ fetchWord }: InstructionContext) => this.#jump(fetchWord(), condition())), // JP cc,nn

    // 11 yyy 011: JP nn, CB prefix, OUT/IN, EX (SP),HL, EX DE,HL, DI/EI.
    // CB dispatches in step(); port I/O and interrupt controls stay deferred.
    ...instructionPattern("11 000 011", ({ fetchWord }) => this.#jump(fetchWord())), // JP nn
    ...instructionPattern("11 100 011", instruction => this.#exchangeStack(instruction)), // EX (SP),HL
    ...instructionPattern("11 101 011", () => this.#exchangeDeHl()), // EX DE,HL

    // 11 ccc 100: conditional calls always fetch nn, then push only on a taken path.
    ...opcodeFamily("11 ccc 100", { c: this.#conditions }, ({ c: condition }) => ({ fetchWord, writeByte }: InstructionContext) => this.#stack.call(fetchWord(), writeByte, condition())), // CALL cc,nn

    // 11 qq 0 101: PUSH uses BC/DE/HL/AF. Bit 3=1 includes unconditional CALL.
    ...opcodeFamily("11 qq 0 101", { q: this.#stackPairs }, ({ q: pair }) => ({ writeByte }: InstructionContext) => this.#stack.push(this.#readPair(pair), writeByte)), // PUSH qq
    ...instructionPattern("11 00 1 101", ({ fetchWord, writeByte }) => this.#stack.call(fetchWord(), writeByte)), // CALL nn

    // 11 ooo 110: the same ooo operations with an immediate byte instead of a register/memory selector.
    ...opcodeFamily("11 ooo 110", { o: this.#aluOperations }, ({ o: operate }) =>
      ({ fetchByte }: InstructionContext) => { this.#state.a = operate(fetchByte()); }), // ALU n

    // 11 ttt 111: ttt selects the restart address 00,08,10,18,20,28,30,38; it is an ordinary call.
    ...opcodeFamily("11 ttt 111", { t: [0x00, 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38] }, ({ t: address }) => ({ writeByte }: InstructionContext) => this.#stack.call(address, writeByte)), // RST p
  ]);

  // After CB (11001011), xx yyy rrr selects the operation and B/C/D/E/H/L/(HL)/A.
  // xx=00 uses yyy as the rotate/shift selector; xx=01/10/11 uses it as bit number bbb.
  readonly #cbOpcodeHandlers = opcodeTable<OpcodeHandler>([
    ...this.#modifyHandlers("00 000 rrr", value => this.#shiftLeft(value, (value & 0x80) !== 0 ? 1 : 0)), // RLC r / (HL)
    ...this.#modifyHandlers("00 001 rrr", value => this.#shiftRight(value, (value & 1) !== 0 ? 1 : 0)), // RRC r / (HL)
    ...this.#modifyHandlers("00 010 rrr", value => this.#shiftLeft(value, this.#state.flags.c ? 1 : 0)), // RL r / (HL)
    ...this.#modifyHandlers("00 011 rrr", value => this.#shiftRight(value, this.#state.flags.c ? 1 : 0)), // RR r / (HL)
    ...this.#modifyHandlers("00 100 rrr", value => this.#shiftLeft(value, 0)), // SLA r / (HL)
    ...this.#modifyHandlers("00 101 rrr", value => this.#shiftRight(value, (value & 0x80) !== 0 ? 1 : 0)), // SRA r / (HL)
    // 00 110 rrr is undocumented SLL and remains unsupported.
    ...this.#modifyHandlers("00 111 rrr", value => this.#shiftRight(value, 0)), // SRL r / (HL)

    ...this.#bitTestHandlers("01 bbb rrr"), // BIT b,r / (HL)
    ...this.#bitModifyHandlers("10 bbb rrr", (value, mask) => value & ~mask), // RES b,r / (HL)
    ...this.#bitModifyHandlers("11 bbb rrr", (value, mask) => value | mask), // SET b,r / (HL)
  ]);

  #transferHandler(destination: ByteOperand, source: ByteOperand): OpcodeHandler {
    if (destination === "(hl)" && source === "(hl)") return () => this.#halt();
    return instruction => this.#writeOperand(destination, this.#readOperand(source, instruction), instruction);
  }

  #modifyHandlers(pattern: string, operation: ByteOperation): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { r: this.#byteOperands }, ({ r: operand }) =>
      instruction => this.#modifyOperand(operand, operation, instruction));
  }

  #bitTestHandlers(pattern: string): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { b: this.#bitMasks, r: this.#byteOperands }, ({ b: mask, r: operand }) =>
      instruction => this.#testBit(mask, this.#readOperand(operand, instruction)));
  }

  #bitModifyHandlers(pattern: string, operation: (value: number, mask: number) => number): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { b: this.#bitMasks, r: this.#byteOperands }, ({ b: mask, r: operand }) => {
      const modify: ByteOperation = value => operation(value, mask);
      return instruction => this.#modifyOperand(operand, modify, instruction);
    });
  }

  // Addressing, loads, and exchanges.

  #readOperand(operand: ByteOperand, { readByte }: InstructionContext): number {
    return operand === "(hl)" ? readByte(this.#hl) : this.#state[operand];
  }

  #writeOperand(operand: ByteOperand, value: number, { writeByte }: InstructionContext): void {
    if (operand === "(hl)") writeByte(this.#hl, value);
    else this.#state[operand] = value;
  }

  #modifyOperand(operand: ByteOperand, operation: ByteOperation, instruction: InstructionContext): void {
    this.#writeOperand(operand, operation(this.#readOperand(operand, instruction)), instruction);
  }

  #readPair(pair: RegisterPair): number {
    if (pair === "sp") return this.#state.sp;
    if (pair === "af") return this.#af;
    return readRegisterPair(this.#state, pair);
  }

  #writePair(pair: RegisterPair, value: number): void {
    if (pair === "sp") this.#state.sp = value;
    else if (pair === "af") this.#af = value;
    else writeRegisterPair(this.#state, pair, value);
  }

  #exchangeAf(): void {
    const { alternate } = this.#state;
    [this.#state.a, alternate.a] = [alternate.a, this.#state.a];
    [this.#state.flags, alternate.flags] = [alternate.flags, this.#state.flags];
  }

  #exchangeGeneralBanks(): void {
    const { alternate } = this.#state;
    for (const register of ["b", "c", "d", "e", "h", "l"] as const) {
      [this.#state[register], alternate[register]] = [alternate[register], this.#state[register]];
    }
  }

  #exchangeDeHl(): void {
    [this.#state.d, this.#state.h] = [this.#state.h, this.#state.d];
    [this.#state.e, this.#state.l] = [this.#state.l, this.#state.e];
  }

  #exchangeStack({ readByte, writeByte }: InstructionContext): void {
    const { sp } = this.#state;
    const value = this.#readMemoryWord(sp, readByte);
    // EX reads low/high, then writes high/low, leaving SP fixed. Capture both bytes before changing HL.
    writeByte((sp + 1) & 0xffff, this.#state.h);
    writeByte(sp, this.#state.l);
    this.#hl = value;
  }

  // Control flow and stack.

  #jump(address: number, take = true): void {
    if (take) this.#state.pc = address;
  }

  #jumpRelative(displacement: number, take: boolean): void {
    // Both paths fetch the operand; PC now points past both instruction bytes.
    if (take) {
      const offset = signed8(displacement);
      this.#state.pc = (this.#state.pc + offset) & 0xffff;
    }
  }

  #decrementAndJump(displacement: number): void {
    // DJNZ decrements B without applying DEC's flag changes.
    this.#state.b = (this.#state.b - 1) & 0xff;
    this.#jumpRelative(displacement, this.#state.b !== 0);
  }

  #halt(): void {
    this.#state.halted = true;
  }

  // Arithmetic, logic, and flags.

  #shiftLeft(value: number, incomingBit: 0 | 1): number {
    const { result, carry } = shiftLeft(8, value, incomingBit);
    return this.#parityResult(result, { h: false, c: carry });
  }

  #shiftRight(value: number, incomingBit: 0 | 1): number {
    const { result, carry } = shiftRight(8, value, incomingBit);
    return this.#parityResult(result, { h: false, c: carry });
  }

  #rotateAccumulator({ result, carry }: ShiftResult): void {
    this.#state.a = result;
    this.#state.flags.c = carry;
    this.#state.flags.h = this.#state.flags.n = false;
    // Unlike CB rotates, these four instructions preserve S/Z/PV.
  }

  #decimalAdjust(): void {
    const { a, flags } = this.#state;
    const carry = flags.c || a > 0x99;
    const correction = ((flags.h || (a & 0x0f) > 9) ? 0x06 : 0) | (carry ? 0x60 : 0);
    // The digit thresholds apply for every input state; N selects addition or subtraction of the correction.
    const result = (a + (flags.n ? -correction : correction)) & 0xff;
    this.#state.a = this.#parityResult(result, { h: ((a ^ result) & 0x10) !== 0, c: carry });
    this.#state.flags.n = flags.n;
  }

  #complementAccumulator(): void {
    this.#state.a ^= 0xff;
    this.#state.flags.h = this.#state.flags.n = true;
  }

  #setCarry(): void {
    this.#state.flags.c = true;
    this.#state.flags.h = this.#state.flags.n = false;
  }

  #complementCarry(): void {
    this.#state.flags.h = this.#state.flags.c;
    this.#state.flags.c = !this.#state.flags.c;
    this.#state.flags.n = false;
  }

  #addHl(value: number): void {
    const hl = this.#hl;
    const { result, carry } = add(16, hl, value);
    this.#hl = result;
    // For this word operation H reports bit 11 to bit 12, not the shared adder's low-nibble carry.
    this.#state.flags.h = (hl & 0x0fff) + (value & 0x0fff) > 0x0fff;
    this.#state.flags.c = carry;
    this.#state.flags.n = false;
    // S/Z/PV are preserved, including when the result is zero or changes sign.
  }

  #testBit(mask: number, value: number): void {
    const tested = value & mask;
    // The manual leaves S/PV unspecified. Model the observed Z80 behavior: S from bit 7, PV = Z.
    this.#state.flags.s = (tested & 0x80) !== 0;
    this.#state.flags.z = tested === 0;
    this.#state.flags.h = true;
    this.#state.flags.pv = tested === 0;
    this.#state.flags.n = false;
    // BIT preserves C; RES and SET preserve every flag.
  }

  #adjustByte(value: number, delta: -1 | 1): number {
    const result = (value + delta) & 0xff;
    this.#state.flags.s = (result & 0x80) !== 0;
    this.#state.flags.z = result === 0;
    // INC carries out of bit 3; DEC borrows from bit 4. Both preserve C.
    this.#state.flags.h = delta === 1 ? (value & 0x0f) === 0x0f : (value & 0x0f) === 0;
    this.#state.flags.pv = value === (delta === 1 ? 0x7f : 0x80);
    this.#state.flags.n = delta === -1;
    return result;
  }

  #add(value: number, carryIn: 0 | 1 = 0): number {
    const { result, carry, halfCarry, overflow } = add(8, this.#state.a, value, carryIn);
    return this.#aluResult(result, { h: halfCarry, pv: overflow, n: false, c: carry });
  }

  #subtract(value: number, borrowIn: 0 | 1 = 0): number {
    const { result, borrow, halfBorrow, overflow } = subtract(8, this.#state.a, value, borrowIn);
    // Z80 H and C both report borrows; N identifies subtraction.
    return this.#aluResult(result, { h: halfBorrow, pv: overflow, n: true, c: borrow });
  }

  // Logic and CB shifts use parity; DAA restores N from its input afterward.
  #parityResult(result: number, { h, c }: Pick<CpuZ80Flags, "h" | "c">): number {
    return this.#aluResult(result, { h, pv: evenParity8(result), n: false, c });
  }

  #aluResult(result: number, flags: Omit<CpuZ80Flags, "s" | "z">): number {
    this.#state.flags = { s: (result & 0x80) !== 0, z: result === 0, ...flags };
    return result;
  }

  #compare(value: number): number {
    this.#subtract(value);
    return this.#state.a;
  }

  // Data words are little-endian and wrap independently of the instruction stream.

  #readMemoryWord(address: number, readByte: InstructionContext["readByte"]): number {
    const low = readByte(address);
    return low | (readByte((address + 1) & 0xffff) << 8);
  }

  #writeMemoryWord(address: number, value: number, writeByte: InstructionContext["writeByte"]): void {
    writeByte(address, value & 0xff);
    writeByte((address + 1) & 0xffff, value >>> 8);
  }
}
