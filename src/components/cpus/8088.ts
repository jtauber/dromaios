import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition } from "./execution-records.ts";
import { signed8, readWordLE } from "./binary.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { defineState, copyState, readState, unsigned, flag, group } from "./state.ts";
import type { StateDescription } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import { evenParity8 } from "./alu.ts";

export interface Cpu8088Flags {
  cf: boolean;
  pf: boolean;
  af: boolean;
  zf: boolean;
  sf: boolean;
  tf: boolean;
  if: boolean;
  df: boolean;
  of: boolean;
}

export interface Cpu8088State {
  ax: number;
  bx: number;
  cx: number;
  dx: number;
  sp: number;
  bp: number;
  si: number;
  di: number;
  cs: number;
  ds: number;
  ss: number;
  es: number;
  ip: number;
  flags: Cpu8088Flags;
}

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu8088StateDescription = defineState({
  ax: unsigned(16), bx: unsigned(16), cx: unsigned(16), dx: unsigned(16),
  sp: unsigned(16), bp: unsigned(16), si: unsigned(16), di: unsigned(16),
  cs: unsigned(16), ds: unsigned(16), ss: unsigned(16), es: unsigned(16), ip: unsigned(16),
  flags: group({ cf: flag, pf: flag, af: flag, zf: flag, sf: flag, tf: flag, if: flag, df: flag, of: flag }),
} satisfies StateDescription<Cpu8088State>);

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

type OpcodeHandler = (instruction: InstructionContext) => void;
type OperandWidth = 8 | 16;
type WordRegister = "ax" | "cx" | "dx" | "bx" | "sp" | "bp" | "si" | "di";

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

  /** Attempt one instruction; unsupported opcodes and prefixes preserve all state and RAM. */
  step(): Cpu8088StepRecord {
    const before = this.snapshot();
    const { accesses, readByte, writeByte } = recordMemory(this.#ram);
    const address = before.pc;
    const opcode = readByte(address);
    const bytes = [opcode];
    const handler = this.#opcodeHandlers[opcode];
    if (handler) {
      this.#state.ip = (this.#state.ip + 1) & 0xffff;
      const fetchByte = (): number => {
        const value = readByte(physicalAddress(this.#state.cs, this.#state.ip));
        this.#state.ip = (this.#state.ip + 1) & 0xffff;
        bytes.push(value);
        return value;
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
    // 00 ooo 10 w: ooo=000 ADD / 111 CMP; 10 selects immediate-to-accumulator; w=0 AL, w=1 AX.
    ...opcodeFamily("00 000 10 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#addToAccumulator(width, instruction)), // ADD AL/AX,n
    ...opcodeFamily("00 111 10 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#compareAccumulator(width, instruction)), // CMP AL/AX,n

    // 0101 p rrr: p=0 pushes, p=1 pops; rrr selects AX,CX,DX,BX,SP,BP,SI,DI.
    ...opcodeFamily("0101 0 rrr", { r: this.#wordRegisters }, ({ r: register }) => ({ writeByte }: InstructionContext) => this.#pushRegister(register, writeByte)), // PUSH r16
    ...opcodeFamily("0101 1 rrr", { r: this.#wordRegisters }, ({ r: register }) => ({ readByte }: InstructionContext) => { this.#state[register] = this.#popWord(readByte); }), // POP r16

    // 0111 ttt p: all sixteen conditions above; every form fetches a signed byte displacement.
    ...opcodeFamily("0111 ttt p", { t: this.#jumpConditions, p: [false, true] },
      ({ t: test, p: invert }) => ({ fetchByte }: InstructionContext) => this.#jump(signed8(fetchByte()), test() !== invert)), // Jcc rel8

    // 1010 00 d w: d=0 loads, d=1 stores; w=0 AL, w=1 AX. The DS offset is always a word.
    ...opcodeFamily("1010 00 0 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#loadAccumulator(width, instruction)), // MOV AL/AX,[offset]
    ...opcodeFamily("1010 00 1 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#storeAccumulator(width, instruction)), // MOV [offset],AL/AX

    // 1011 w rrr: w selects byte/word; rrr=000–111 selects AL,CL,DL,BL,AH,CH,DH,BH
    // for w=0 and AX,CX,DX,BX,SP,BP,SI,DI for w=1. The immediate has that same width.
    ...opcodeFamily("1011 0 rrr", { r: this.#byteRegisters }, ({ r: register }) => ({ fetchByte }: InstructionContext) => this.#writeByteRegister(register, fetchByte())), // MOV r8,n
    ...opcodeFamily("1011 1 rrr", { r: this.#wordRegisters }, ({ r: register }) => ({ fetchWord }: InstructionContext) => { this.#state[register] = fetchWord(); }), // MOV r16,n

    // 1100 001i: i=0 includes an unsigned word stack adjustment; i=1 pops only IP.
    ...instructionPattern("1100 0010", ({ fetchWord, readByte }) => this.#return(fetchWord(), readByte)), // RET n
    ...instructionPattern("1100 0011", ({ readByte }) => this.#return(0, readByte)), // RET

    // E8/E9 use word displacements; EB is short JMP. EA (far JMP) remains unsupported.
    ...instructionPattern("1110 1000", ({ fetchWord, writeByte }) => this.#call(fetchWord(), writeByte)), // CALL rel16
    ...instructionPattern("1110 1001", ({ fetchWord }) => this.#jump(fetchWord())), // JMP rel16
    ...instructionPattern("1110 1011", ({ fetchByte }) => this.#jump(signed8(fetchByte()))), // JMP rel8

    // ModR/M forms, far transfers, prefixes, interrupts, and I/O remain deferred.
  ]);

  // Addressing, loads, and stores.

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

  #addToAccumulator(width: OperandWidth, { fetchByte, fetchWord }: InstructionContext): void {
    const value = width === 8 ? fetchByte() : fetchWord();
    const mask = width === 8 ? 0xff : 0xffff;
    const signBit = width === 8 ? 0x80 : 0x8000;
    const accumulator = this.#state.ax & mask;
    const sum = accumulator + value;
    const result = sum & mask;
    this.#writeAccumulator(width, result);
    this.#state.flags.cf = sum > mask;
    this.#state.flags.af = (accumulator & 0xf) + (value & 0xf) > 0xf;
    this.#state.flags.of = (~(accumulator ^ value) & (accumulator ^ result) & signBit) !== 0;
    this.#setResultFlags(width, result);
  }

  #compareAccumulator(width: OperandWidth, { fetchByte, fetchWord }: InstructionContext): void {
    const value = width === 8 ? fetchByte() : fetchWord();
    const mask = width === 8 ? 0xff : 0xffff;
    const signBit = width === 8 ? 0x80 : 0x8000;
    const accumulator = this.#state.ax & mask;
    const difference = accumulator - value;
    const result = difference & mask;
    this.#state.flags.cf = difference < 0;
    this.#state.flags.af = (accumulator & 0xf) < (value & 0xf);
    this.#state.flags.of = ((accumulator ^ value) & (accumulator ^ result) & signBit) !== 0;
    this.#setResultFlags(width, result);
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
