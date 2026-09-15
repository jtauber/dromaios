import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition } from "./execution-records.ts";
import { signed8, readWordLE } from "./binary.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { defineState, copyState, readState, unsigned, flag, group } from "./state.ts";
import type { StateValues } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import { add, subtract, shiftLeft, shiftRight, evenParity8 } from "./alu.ts";
import type { ShiftResult } from "./alu.ts";

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu8088StateDescription = defineState({
  ax: unsigned(16), bx: unsigned(16), cx: unsigned(16), dx: unsigned(16),
  sp: unsigned(16), bp: unsigned(16), si: unsigned(16), di: unsigned(16),
  cs: unsigned(16), ds: unsigned(16), ss: unsigned(16), es: unsigned(16), ip: unsigned(16),
  flags: group({ cf: flag, pf: flag, af: flag, zf: flag, sf: flag, tf: flag, if: flag, df: flag, of: flag }),
});

export type Cpu8088State = StateValues<typeof cpu8088StateDescription>;
export type Cpu8088Flags = Cpu8088State["flags"];

export type Cpu8088Snapshot = Readonly<Omit<Cpu8088State, "flags">> & {
  readonly flags: Readonly<Cpu8088Flags>;
  readonly al: number;
  readonly ah: number;
  readonly bl: number;
  readonly bh: number;
  readonly cl: number;
  readonly ch: number;
  readonly dl: number;
  readonly dh: number;
  /** Physical address of CS:IP, for inspection and runner completion. */
  readonly pc: number;
};

/** Physical byte access on the 20-bit memory bus. */
export type Cpu8088MemoryAccess = MemoryAccess;

/** Instruction address is physical; before.cs and before.ip retain its logical address. */
export type Cpu8088Instruction = FetchedInstruction;

export type Cpu8088StepRecord = StateTransition<Cpu8088Snapshot> & {
  readonly instruction: Cpu8088Instruction;
} & (
  | { readonly outcome: "executed" }
  | { readonly outcome: "unsupported"; readonly reason: "opcode" }
);

export type Cpu8088ResetRecord = StateTransition<Cpu8088Snapshot>;

type OpcodeHandler = (instruction: InstructionContext) => "unsupported" | void;
type OperandWidth = 8 | 16;
type WordRegister = "ax" | "cx" | "dx" | "bx" | "sp" | "bp" | "si" | "di";
type AluOperation = (width: OperandWidth, left: number, right: number) => number | void;
type OperandOperation = (width: OperandWidth, operand: Operand, instruction: InstructionContext) => void;
type ShiftOperation = (width: OperandWidth, value: number) => ShiftResult;

// An instruction-local operand: memory closures capture one resolved segment and offset.
interface Operand {
  readonly read: () => number;
  readonly write: (value: number) => void;
}

const instructionPattern = opcodePattern<OpcodeHandler>;

interface ByteRegister {
  readonly word: "ax" | "cx" | "dx" | "bx";
  readonly shift: 0 | 8;
}

// The original 8088 has twenty address lines; carries beyond bit 19 are discarded.
function physicalAddress(segment: number, offset: number): number {
  return ((segment << 4) + offset) & 0xfffff;
}

/** Instruction-level Intel 8088 subset with flat 1 MiB RAM and segmented addresses. */
export class Cpu8088 {
  readonly #ram: Ram;
  readonly #state: Cpu8088State;

  constructor(ram: Ram, initialState: Cpu8088State) {
    if (ram.size !== 0x100000) throw new RangeError("The 8088 model requires exactly 1 MiB of RAM.");
    this.#ram = ram;
    this.#state = readState(cpu8088StateDescription, initialState);
  }

  /** Inspect detached state, byte-register views, and the physical PC without RAM access. */
  snapshot(): Cpu8088Snapshot {
    const state = copyState(cpu8088StateDescription, this.#state);
    return {
      ...state,
      al: state.ax & 0xff, ah: state.ax >>> 8,
      bl: state.bx & 0xff, bh: state.bx >>> 8,
      cl: state.cx & 0xff, ch: state.cx >>> 8,
      dl: state.dx & 0xff, dh: state.dx >>> 8,
      pc: physicalAddress(state.cs, state.ip),
    };
  }

  /** Set CS:IP to FFFF:0000, clear other segments and flags, and preserve general registers and RAM. */
  reset(): Cpu8088ResetRecord {
    const before = this.snapshot();
    this.#state.cs = 0xffff;
    this.#state.ip = 0;
    this.#state.ds = this.#state.ss = this.#state.es = 0;
    this.#state.flags = { cf: false, pf: false, af: false, zf: false, sf: false,
      tf: false, if: false, df: false, of: false };
    return { before, after: this.snapshot(), accesses: [] };
  }

  /** Attempt one instruction; unsupported encodings preserve all state and RAM. */
  step(): Cpu8088StepRecord {
    const before = this.snapshot();
    const { accesses, readByte, writeByte } = recordMemory(this.#ram);
    const address = before.pc;
    const opcode = readByte(address);
    const bytes = [opcode];
    const handler = this.#opcodeHandlers[opcode];
    let executed = false;
    if (handler) {
      this.#state.ip = (this.#state.ip + 1) & 0xffff;
      const fetchByte = (): number => {
        const value = readByte(physicalAddress(this.#state.cs, this.#state.ip));
        this.#state.ip = (this.#state.ip + 1) & 0xffff;
        bytes.push(value);
        return value;
      };
      executed = handler({
        fetchByte,
        fetchWord: () => readWordLE(fetchByte),
        readByte,
        writeByte,
      }) !== "unsupported";
      // Group handlers reject unused operation selectors before resolving or changing operands.
      if (!executed) this.#state.ip = before.ip;
    }
    const record = { instruction: { address, bytes }, before, after: this.snapshot(), accesses };
    return executed
      ? { ...record, outcome: "executed" }
      : { ...record, outcome: "unsupported", reason: "opcode" };
  }

  // Register views. Byte writes replace only the selected half of the stored word.

  #writeByteRegister({ word, shift }: ByteRegister, value: number): void {
    const mask = 0xff << shift;
    this.#state[word] = (this.#state[word] & ~mask) | (value << shift);
  }

  #writeAccumulator(width: OperandWidth, value: number): void {
    this.#state.ax = width === 8 ? (this.#state.ax & 0xff00) | value : value;
  }

  // Opcode selectors and construction. Arrays follow encoded register order.

  readonly #wordRegisters = ["ax", "cx", "dx", "bx", "sp", "bp", "si", "di"] as const;
  readonly #byteRegisters = [
    { word: "ax", shift: 0 }, { word: "cx", shift: 0 }, { word: "dx", shift: 0 }, { word: "bx", shift: 0 }, // AL, CL, DL, BL
    { word: "ax", shift: 8 }, { word: "cx", shift: 8 }, { word: "dx", shift: 8 }, { word: "bx", shift: 8 }, // AH, CH, DH, BH
  ] as const;
  readonly #operandWidths = [8, 16] as const;

  // 00 ooo ... and ModR/M mm ooo rrr share the same operation field.
  // Returning no value means CMP updates flags without a destination write.
  readonly #aluOperations: readonly AluOperation[] = [
    (width, left, right) => this.#add(width, left, right), // 000: ADD
    (width, left, right) => this.#logic(width, left | right), // 001: OR
    (width, left, right) => this.#add(width, left, right, this.#state.flags.cf ? 1 : 0), // 010: ADC
    (width, left, right) => this.#subtract(width, left, right, this.#state.flags.cf ? 1 : 0), // 011: SBB
    (width, left, right) => this.#logic(width, left & right), // 100: AND
    (width, left, right) => this.#subtract(width, left, right), // 101: SUB
    (width, left, right) => this.#logic(width, left ^ right), // 110: XOR
    (width, left, right) => { this.#subtract(width, left, right); }, // 111: CMP
  ];
  readonly #test: AluOperation = (width, left, right) => { this.#logic(width, left & right); };

  // F6/F7: mm ooo rrr selects TEST, unused /1, NOT, NEG, then deferred multiply/divide.
  readonly #unaryOperations: readonly (OperandOperation | undefined)[] = [
    (width, operand, instruction) => this.#testImmediate(width, operand, instruction), // 000: TEST r/m,n
    undefined, // 001: undocumented TEST alias
    (width, operand) => operand.write(operand.read() ^ (2 ** width - 1)), // 010: NOT
    (width, operand) => operand.write(this.#subtract(width, 0, operand.read())), // 011: NEG
  ];
  // FE/FF: only /0 and /1 adjust an operand; FF's other documented operations wait.
  readonly #adjustOperations: readonly OperandOperation[] = [
    (width, operand) => operand.write(this.#adjust(width, operand.read(), false)), // 000: INC
    (width, operand) => operand.write(this.#adjust(width, operand.read(), true)), // 001: DEC
  ];
  readonly #immediateMoveOperations: readonly OperandOperation[] = [
    (width, operand, instruction) => operand.write(this.#fetchImmediate(width, instruction)), // C6/C7 /0: MOV r/m,n
  ];

  // D0–D3: mm ooo rrr selects the one-bit operation. /6 is undocumented.
  // The inserted bit is the outgoing bit (rotate), CF (through carry), zero, or sign.
  readonly #shiftOperations: readonly (ShiftOperation | undefined)[] = [
    (width, value) => shiftLeft(width, value, (value & 2 ** (width - 1)) !== 0 ? 1 : 0), // 000: ROL
    (width, value) => shiftRight(width, value, (value & 1) !== 0 ? 1 : 0), // 001: ROR
    (width, value) => shiftLeft(width, value, this.#state.flags.cf ? 1 : 0), // 010: RCL
    (width, value) => shiftRight(width, value, this.#state.flags.cf ? 1 : 0), // 011: RCR
    (width, value) => shiftLeft(width, value, 0), // 100: SHL (SAL)
    (width, value) => shiftRight(width, value, 0), // 101: SHR
    undefined, // 110: undocumented
    (width, value) => shiftRight(width, value, (value & 2 ** (width - 1)) !== 0 ? 1 : 0), // 111: SAR
  ];

  // ModR/M mm ggg rrr: memory bases selected by rrr. BP selects SS; other bases use DS.
  // mm=00/01/10 adds no/signed-byte/word displacement; mm=11 selects a register.
  // The mm=00, rrr=110 exception is a direct word offset in DS, not [BP].
  readonly #memoryBases = [
    () => ({ segment: this.#state.ds, offset: this.#state.bx + this.#state.si }), // 000: BX+SI
    () => ({ segment: this.#state.ds, offset: this.#state.bx + this.#state.di }), // 001: BX+DI
    () => ({ segment: this.#state.ss, offset: this.#state.bp + this.#state.si }), // 010: BP+SI
    () => ({ segment: this.#state.ss, offset: this.#state.bp + this.#state.di }), // 011: BP+DI
    () => ({ segment: this.#state.ds, offset: this.#state.si }), // 100: SI
    () => ({ segment: this.#state.ds, offset: this.#state.di }), // 101: DI
    () => ({ segment: this.#state.ss, offset: this.#state.bp }), // 110: BP (except mm=00)
    () => ({ segment: this.#state.ds, offset: this.#state.bx }), // 111: BX
  ] as const;

  // 0111 ttt p: ttt selects the p=0 condition; p=1 inverts it.
  readonly #jumpConditions = [
    () => this.#state.flags.of, // 000: JO / JNO
    () => this.#state.flags.cf, // 001: JB (JC/JNAE) / JAE (JNC/JNB)
    () => this.#state.flags.zf, // 010: JE (JZ) / JNE (JNZ)
    () => this.#state.flags.cf || this.#state.flags.zf, // 011: JBE (JNA) / JA (JNBE)
    () => this.#state.flags.sf, // 100: JS / JNS
    () => this.#state.flags.pf, // 101: JP (JPE) / JNP (JPO)
    () => this.#state.flags.sf !== this.#state.flags.of, // 110: JL (JNGE) / JGE (JNL)
    () => this.#state.flags.zf || this.#state.flags.sf !== this.#state.flags.of, // 111: JLE (JNG) / JG (JNLE)
  ] as const;

  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    // 00 ooo 0 d w: ooo selects ADD/OR/ADC/SBB/AND/SUB/XOR/CMP above; w=0 byte, w=1 word.
    // ModR/M mm ggg rrr supplies operands; d=0 selects the r/m destination, d=1 register ggg.
    ...opcodeFamily("00 ooo 0 d w", { o: this.#aluOperations, d: [false, true], w: this.#operandWidths }, ({ o: operation, d: toRegister, w: width }) => (instruction: InstructionContext) => this.#aluRegisterMemory(operation, width, toRegister, instruction)), // ALU r/m,r / r,r/m
    // 00 ooo 10 w: same operations; destination is AL/AX, followed by an immediate of width w.
    ...opcodeFamily("00 ooo 10 w", { o: this.#aluOperations, w: this.#operandWidths }, ({ o: operation, w: width }) => (instruction: InstructionContext) => this.#aluAccumulator(operation, width, instruction)), // ALU AL/AX,n

    // 0100 s rrr: s=0 increments, s=1 decrements; rrr selects the word register. Preserve CF.
    ...opcodeFamily("0100 s rrr", { s: [false, true], r: this.#wordRegisters }, ({ s: decrement, r: register }) => () => this.#adjustRegister(register, decrement)), // INC/DEC r16

    // 0101 p rrr: p=0 pushes, p=1 pops; rrr selects AX,CX,DX,BX,SP,BP,SI,DI.
    ...opcodeFamily("0101 0 rrr", { r: this.#wordRegisters }, ({ r: register }) => ({ writeByte }: InstructionContext) => this.#pushRegister(register, writeByte)), // PUSH r16
    ...opcodeFamily("0101 1 rrr", { r: this.#wordRegisters }, ({ r: register }) => ({ readByte }: InstructionContext) => { this.#state[register] = this.#popWord(readByte); }), // POP r16

    // 0111 ttt p: all sixteen conditions above; every form fetches a signed byte displacement.
    ...opcodeFamily("0111 ttt p", { t: this.#jumpConditions, p: [false, true] },
      ({ t: test, p: invert }) => ({ fetchByte }: InstructionContext) => this.#jump(signed8(fetchByte()), test() !== invert)), // Jcc rel8

    // 1000 00 s w + mm ooo rrr: immediate ALU; s=1 allows only ADD/ADC/SBB/SUB/CMP.
    // w=0 uses a byte; w=1 uses a word for s=0 or a sign-extended byte for s=1.
    ...opcodeFamily("1000 00 s w", { s: [false, true], w: this.#operandWidths }, ({ s: shortImmediate, w: width }) => (instruction: InstructionContext) => this.#aluImmediate(width, shortImmediate, instruction)), // ALU r/m,n
    // 1000 010w + mm ggg rrr: AND flags without a write; ggg is the source register.
    ...opcodeFamily("1000 010 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#aluRegisterMemory(this.#test, width, false, instruction)), // TEST r/m,r
    // 1000 011w + mm ggg rrr: exchange the original operands, even when registers alias.
    ...opcodeFamily("1000 011 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#exchange(...this.#registerMemoryOperands(width, false, instruction))), // XCHG r/m,r
    // 1000 10 d w + mm ggg rrr: d=0 writes r/m, d=1 writes register ggg; no flags change.
    ...opcodeFamily("1000 10 d w", { d: [false, true], w: this.#operandWidths }, ({ d: toRegister, w: width }) => (instruction: InstructionContext) => this.#moveRegisterMemory(width, toRegister, instruction)), // MOV r/m,r / r,r/m

    // 1001 0rrr: exchange AX with the selected word register; 90 exchanges AX with itself (NOP).
    ...opcodeFamily("1001 0 rrr", { r: this.#wordRegisters }, ({ r: register }) => () => { [this.#state.ax, this.#state[register]] = [this.#state[register], this.#state.ax]; }), // XCHG AX,r16 / NOP

    // 1010 00 d w: d=0 loads, d=1 stores; w=0 AL, w=1 AX. The DS offset is always a word.
    ...opcodeFamily("1010 00 0 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#loadAccumulator(width, instruction)), // MOV AL/AX,[offset]
    ...opcodeFamily("1010 00 1 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#storeAccumulator(width, instruction)), // MOV [offset],AL/AX

    // 1010 100w: immediate TEST shares the accumulator ALU operand layout.
    ...opcodeFamily("1010 100 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#aluAccumulator(this.#test, width, instruction)), // TEST AL/AX,n

    // 1011 w rrr: w selects byte/word; rrr=000–111 selects AL,CL,DL,BL,AH,CH,DH,BH
    // for w=0 and AX,CX,DX,BX,SP,BP,SI,DI for w=1. The immediate has that same width.
    ...opcodeFamily("1011 0 rrr", { r: this.#byteRegisters }, ({ r: register }) => ({ fetchByte }: InstructionContext) => this.#writeByteRegister(register, fetchByte())), // MOV r8,n
    ...opcodeFamily("1011 1 rrr", { r: this.#wordRegisters }, ({ r: register }) => ({ fetchWord }: InstructionContext) => { this.#state[register] = fetchWord(); }), // MOV r16,n

    // 1100 001i: i=0 includes an unsigned word stack adjustment; i=1 pops only IP.
    ...instructionPattern("1100 0010", ({ fetchWord, readByte }) => this.#return(fetchWord(), readByte)), // RET n
    ...instructionPattern("1100 0011", ({ readByte }) => this.#return(0, readByte)), // RET

    // 1100 011w + mm 000 rrr: immediate MOV; every other operation selector is unused.
    ...opcodeFamily("1100 011 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#operandGroup(width, this.#immediateMoveOperations, instruction)), // MOV r/m,n
    // 1101 00vw + mm ooo rrr: v=0 shifts once, v=1 uses all eight bits of CL; w selects byte/word.
    ...opcodeFamily("1101 00 v w", { v: [false, true], w: this.#operandWidths }, ({ v: useCL, w: width }) => (instruction: InstructionContext) => this.#shift(width, useCL, instruction)), // ROL/ROR/RCL/RCR/SHL/SHR/SAR

    // E8/E9 use word displacements; EB is short JMP. EA (far JMP) remains unsupported.
    ...instructionPattern("1110 1000", ({ fetchWord, writeByte }) => this.#call(fetchWord(), writeByte)), // CALL rel16
    ...instructionPattern("1110 1001", ({ fetchWord }) => this.#jump(fetchWord())), // JMP rel16
    ...instructionPattern("1110 1011", ({ fetchByte }) => this.#jump(signed8(fetchByte()))), // JMP rel8

    // 1111 011w / 1111 111w: ModR/M's ooo selects the supported unary/adjust operations above.
    ...opcodeFamily("1111 011 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#operandGroup(width, this.#unaryOperations, instruction)), // TEST/NOT/NEG r/m
    ...opcodeFamily("1111 111 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#operandGroup(width, this.#adjustOperations, instruction)), // INC/DEC r/m

    // Other opcode groups, far transfers, prefixes, interrupts, and I/O remain deferred.
  ]);

  // Addressing, loads, stores, and exchanges.

  #operandGroup(width: OperandWidth, operations: readonly (OperandOperation | undefined)[], instruction: InstructionContext): "unsupported" | void {
    const modRM = instruction.fetchByte();
    const operation = operations[(modRM >>> 3) & 7];
    if (!operation) return "unsupported";
    operation(width, this.#registerMemoryOperand(width, modRM, instruction), instruction);
  }

  #fetchImmediate(width: OperandWidth, instruction: InstructionContext): number {
    return width === 8 ? instruction.fetchByte() : instruction.fetchWord();
  }

  #registerOperand(width: OperandWidth, selector: number): Operand {
    if (width === 8) {
      const register = this.#byteRegisters[selector]!;
      return {
        read: () => (this.#state[register.word] >>> register.shift) & 0xff,
        write: value => this.#writeByteRegister(register, value),
      };
    }
    const register = this.#wordRegisters[selector]!;
    return { read: () => this.#state[register], write: value => { this.#state[register] = value; } };
  }

  #registerMemoryOperand(width: OperandWidth, modRM: number, { fetchByte, fetchWord, readByte, writeByte }: InstructionContext): Operand {
    const mode = modRM >>> 6;
    const selector = modRM & 7;
    if (mode === 3) return this.#registerOperand(width, selector);
    const direct = mode === 0 && selector === 6;
    const base = direct ? { segment: this.#state.ds, offset: 0 } : this.#memoryBases[selector]!();
    const displacement = direct || mode === 2 ? fetchWord() : mode === 1 ? signed8(fetchByte()) : 0;
    const offset = (base.offset + displacement) & 0xffff;
    const { segment } = base;
    return width === 8 ? {
      read: () => readByte(physicalAddress(segment, offset)),
      write: value => writeByte(physicalAddress(segment, offset), value),
    } : {
      read: () => this.#readMemoryWord(segment, offset, readByte),
      write: value => this.#writeMemoryWord(segment, offset, value, writeByte),
    };
  }

  #registerMemoryOperands(width: OperandWidth, toRegister: boolean, instruction: InstructionContext): readonly [Operand, Operand] {
    const modRM = instruction.fetchByte();
    const register = this.#registerOperand(width, (modRM >>> 3) & 7);
    const memoryOrRegister = this.#registerMemoryOperand(width, modRM, instruction);
    return toRegister ? [register, memoryOrRegister] : [memoryOrRegister, register];
  }

  #moveRegisterMemory(width: OperandWidth, toRegister: boolean, instruction: InstructionContext): void {
    const [destination, source] = this.#registerMemoryOperands(width, toRegister, instruction);
    destination.write(source.read());
  }

  #exchange(left: Operand, right: Operand): void {
    const leftValue = left.read();
    const rightValue = right.read();
    left.write(rightValue);
    right.write(leftValue);
  }

  #loadAccumulator(width: OperandWidth, { fetchWord, readByte }: InstructionContext): void {
    const offset = fetchWord();
    const value = width === 8 ? readByte(physicalAddress(this.#state.ds, offset))
      : this.#readMemoryWord(this.#state.ds, offset, readByte);
    this.#writeAccumulator(width, value);
  }

  #storeAccumulator(width: OperandWidth, { fetchWord, writeByte }: InstructionContext): void {
    const offset = fetchWord();
    const { ax, ds } = this.#state;
    const address = physicalAddress(ds, offset);
    if (width === 8) writeByte(address, ax & 0xff);
    else this.#writeMemoryWord(ds, offset, ax, writeByte);
  }

  // Control flow and stack operations.

  #jump(displacement: number, take = true): void {
    // IP is past the operand. Modulo 65536 also interprets a word's two's-complement displacement.
    if (take) this.#state.ip = (this.#state.ip + displacement) & 0xffff;
  }

  #call(displacement: number, writeByte: InstructionContext["writeByte"]): void {
    // Fetch the complete displacement before writing the following IP to SS:SP.
    this.#pushWord(this.#state.ip, writeByte);
    this.#jump(displacement);
  }

  #return(discardBytes: number, readByte: InstructionContext["readByte"]): void {
    this.#state.ip = this.#popWord(readByte);
    this.#state.sp = (this.#state.sp + discardBytes) & 0xffff;
  }

  #pushRegister(register: WordRegister, writeByte: InstructionContext["writeByte"]): void {
    // The original 8088's PUSH SP stores the decremented pointer, unlike later x86 CPUs.
    const value = register === "sp" ? (this.#state.sp - 2) & 0xffff : this.#state[register];
    this.#pushWord(value, writeByte);
  }

  #pushWord(value: number, writeByte: InstructionContext["writeByte"]): void {
    this.#state.sp = (this.#state.sp - 2) & 0xffff;
    this.#writeMemoryWord(this.#state.ss, this.#state.sp, value, writeByte);
  }

  #popWord(readByte: InstructionContext["readByte"]): number {
    const value = this.#readMemoryWord(this.#state.ss, this.#state.sp, readByte);
    // POP SP assigns the popped value after this increment, replacing it entirely.
    this.#state.sp = (this.#state.sp + 2) & 0xffff;
    return value;
  }

  // Arithmetic and flags.

  #aluAccumulator(operation: AluOperation, width: OperandWidth, instruction: InstructionContext): void {
    const value = this.#fetchImmediate(width, instruction);
    this.#applyAlu(operation, width, this.#registerOperand(width, 0), value);
  }

  #aluRegisterMemory(operation: AluOperation, width: OperandWidth, toRegister: boolean, instruction: InstructionContext): void {
    const [destination, source] = this.#registerMemoryOperands(width, toRegister, instruction);
    this.#applyAlu(operation, width, destination, source.read());
  }

  #aluImmediate(width: OperandWidth, shortImmediate: boolean, instruction: InstructionContext): "unsupported" | void {
    const modRM = instruction.fetchByte();
    const selector = (modRM >>> 3) & 7;
    // Intel's 1979 table leaves /1, /4, and /6 unused for both 82 and 83.
    if (shortImmediate && (selector === 1 || selector === 4 || selector === 6)) return "unsupported";
    const destination = this.#registerMemoryOperand(width, modRM, instruction);
    const value = width === 8 ? instruction.fetchByte()
      : shortImmediate ? signed8(instruction.fetchByte()) & 0xffff : instruction.fetchWord();
    this.#applyAlu(this.#aluOperations[selector]!, width, destination, value);
  }

  #applyAlu(operation: AluOperation, width: OperandWidth, destination: Operand, value: number): void {
    const result = operation(width, destination.read(), value);
    if (result !== undefined) destination.write(result);
  }

  #adjustRegister(register: WordRegister, decrement: boolean): void {
    this.#state[register] = this.#adjust(16, this.#state[register], decrement);
  }

  #adjust(width: OperandWidth, value: number, decrement: boolean): number {
    const carry = this.#state.flags.cf;
    const result = decrement ? this.#subtract(width, value, 1) : this.#add(width, value, 1);
    this.#state.flags.cf = carry;
    return result;
  }

  #testImmediate(width: OperandWidth, operand: Operand, instruction: InstructionContext): void {
    this.#applyAlu(this.#test, width, operand, this.#fetchImmediate(width, instruction));
  }

  #shift(width: OperandWidth, useCL: boolean, instruction: InstructionContext): "unsupported" | void {
    const modRM = instruction.fetchByte();
    const selector = (modRM >>> 3) & 7;
    const operation = this.#shiftOperations[selector];
    if (!operation) return "unsupported";
    const operand = this.#registerMemoryOperand(width, modRM, instruction);
    // Capture CL before writing any destination, including CL or CX itself. The 8088 does not mask it to five bits.
    const count = useCL ? this.#state.cx & 0xff : 1;
    const value = operand.read();
    let result = value;
    for (let bit = 0; bit < count; bit++) {
      const shifted = operation(width, result);
      result = shifted.result;
      this.#state.flags.cf = shifted.carry;
    }
    // Only a one-bit operation defines OF; preserve its incoming value for larger counts.
    if (count === 1) this.#state.flags.of = ((value ^ result) & 2 ** (width - 1)) !== 0;
    // 000–011 are rotates; only the shift selectors 100/101/111 replace result flags.
    if (count > 0 && selector >= 4) {
      this.#setResultFlags(width, result);
      this.#state.flags.af = false; // Undefined after shifts; deterministic, as for logic.
    }
    // At this instruction-level boundary even count zero reads and writes the unchanged operand, preserving flags.
    operand.write(result);
  }

  #add(width: OperandWidth, left: number, right: number, carryIn: 0 | 1 = 0): number {
    const { result, carry, halfCarry, overflow } = add(width, left, right, carryIn);
    this.#state.flags.cf = carry;
    this.#state.flags.af = halfCarry;
    this.#state.flags.of = overflow;
    this.#setResultFlags(width, result);
    return result;
  }

  #subtract(width: OperandWidth, left: number, right: number, borrowIn: 0 | 1 = 0): number {
    const { result, borrow, halfBorrow, overflow } = subtract(width, left, right, borrowIn);
    this.#state.flags.cf = borrow;
    this.#state.flags.af = halfBorrow;
    this.#state.flags.of = overflow;
    this.#setResultFlags(width, result);
    return result;
  }

  #logic(width: OperandWidth, result: number): number {
    this.#state.flags.cf = this.#state.flags.of = false;
    // Intel leaves AF undefined for logic; clear it deterministically, matching the hardware fixtures.
    this.#state.flags.af = false;
    this.#setResultFlags(width, result);
    return result;
  }

  #setResultFlags(width: OperandWidth, result: number): void {
    this.#state.flags.zf = result === 0;
    this.#state.flags.sf = (result & (width === 8 ? 0x80 : 0x8000)) !== 0;
    // Parity is defined by the low byte even for word operations.
    this.#state.flags.pf = evenParity8(result & 0xff);
  }

  // Memory words. Each byte uses a wrapping 16-bit offset within its segment;
  // physicalAddress then wraps that byte's address onto the 20-bit bus.

  #readMemoryWord(segment: number, offset: number, readByte: InstructionContext["readByte"]): number {
    const low = readByte(physicalAddress(segment, offset));
    const high = readByte(physicalAddress(segment, (offset + 1) & 0xffff));
    return low | (high << 8);
  }

  #writeMemoryWord(segment: number, offset: number, value: number, writeByte: InstructionContext["writeByte"]): void {
    writeByte(physicalAddress(segment, offset), value & 0xff);
    writeByte(physicalAddress(segment, (offset + 1) & 0xffff), value >>> 8);
  }
}
