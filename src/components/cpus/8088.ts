import type { Ram } from "../memory/ram.js";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import { defineState, copyState, readState, unsigned, flag, group } from "./state.ts";
import type { StateDescription } from "./state.js";
import { opcodeFamily, opcodeTable } from "./opcodes.ts";
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

export interface Cpu8088Instruction {
  /** Physical start address; before.cs and before.ip retain its logical address. */
  readonly address: number;
  readonly bytes: readonly number[];
}

export type Cpu8088StepRecord = {
  readonly instruction: Cpu8088Instruction;
  readonly before: Cpu8088Snapshot;
  readonly after: Cpu8088Snapshot;
  readonly accesses: readonly Cpu8088MemoryAccess[];
} & (
  | { readonly outcome: "executed" }
  | { readonly outcome: "unsupported"; readonly reason: "opcode" }
);

export interface Cpu8088ResetRecord {
  readonly before: Cpu8088Snapshot;
  readonly after: Cpu8088Snapshot;
  readonly accesses: readonly Cpu8088MemoryAccess[];
}

interface InstructionContext {
  readonly fetchByte: () => number;
  readonly fetchWord: () => number;
  readonly readByte: (address: number) => number;
  readonly writeByte: (address: number, value: number) => void;
}

type OpcodeHandler = (instruction: InstructionContext) => void;
type OperandWidth = 8 | 16;

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
        fetchWord: () => {
          const low = fetchByte();
          return low | (fetchByte() << 8);
        },
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

  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    // 00 ooo 10 w: ooo=000 selects ADD; 10 selects immediate-to-accumulator; w=0 AL, w=1 AX.
    ...opcodeFamily("00 000 10 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#addToAccumulator(width, instruction)), // ADD AL/AX,n

    // 1010 00 d w: d=0 loads, d=1 stores; w=0 AL, w=1 AX. The DS offset is always a word.
    ...opcodeFamily("1010 00 0 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#loadAccumulator(width, instruction)), // MOV AL/AX,[offset]
    ...opcodeFamily("1010 00 1 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#storeAccumulator(width, instruction)), // MOV [offset],AL/AX

    // 1011 w rrr: w selects byte/word; rrr=000–111 selects AL,CL,DL,BL,AH,CH,DH,BH
    // for w=0 and AX,CX,DX,BX,SP,BP,SI,DI for w=1. The immediate has that same width.
    ...opcodeFamily("1011 0 rrr", { r: this.#byteRegisters }, ({ r: register }) => ({ fetchByte }: InstructionContext) => this.#writeByteRegister(register, fetchByte())), // MOV r8,n
    ...opcodeFamily("1011 1 rrr", { r: this.#wordRegisters }, ({ r: register }) => ({ fetchWord }: InstructionContext) => { this.#state[register] = fetchWord(); }), // MOV r16,n

    // ModR/M forms, prefixes, control flow, stack operations, interrupts, and I/O are deferred.
  ]);

  // Addressing, loads, and stores.

  #loadAccumulator(width: OperandWidth, { fetchWord, readByte }: InstructionContext): void {
    const address = physicalAddress(this.#state.ds, fetchWord());
    const low = readByte(address);
    const value = width === 8 ? low : low | (readByte((address + 1) & 0xfffff) << 8);
    this.#writeAccumulator(width, value);
  }

  #storeAccumulator(width: OperandWidth, { fetchWord, writeByte }: InstructionContext): void {
    const offset = fetchWord();
    const { ax, ds } = this.#state;
    const address = physicalAddress(ds, offset);
    // A data word occupies consecutive physical bytes, even at offset FFFF.
    writeByte(address, ax & 0xff);
    if (width === 16) writeByte((address + 1) & 0xfffff, ax >>> 8);
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
    this.#state.flags.zf = result === 0;
    this.#state.flags.sf = (result & signBit) !== 0;
    this.#state.flags.of = (~(accumulator ^ value) & (accumulator ^ result) & signBit) !== 0;
    // Parity is defined by the low byte even for word operations.
    this.#state.flags.pf = evenParity8(result & 0xff);
  }
}
