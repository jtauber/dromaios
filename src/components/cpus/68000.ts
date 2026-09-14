import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition } from "./execution-records.ts";
import { signed8 } from "./binary.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess, RecordedMemory } from "./memory-access.ts";
import { defineState, copyState, readState, unsigned, flag, group } from "./state.ts";
import type { StateValues } from "./state.js";
import { opcodeFamily, opcodeTable } from "./opcodes.ts";

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu68000StateDescription = defineState({
  d0: unsigned(32), d1: unsigned(32), d2: unsigned(32), d3: unsigned(32),
  d4: unsigned(32), d5: unsigned(32), d6: unsigned(32), d7: unsigned(32),
  a0: unsigned(32), a1: unsigned(32), a2: unsigned(32), a3: unsigned(32),
  a4: unsigned(32), a5: unsigned(32), a6: unsigned(32),
  usp: unsigned(32), ssp: unsigned(32), pc: unsigned(32), interruptMask: unsigned(3),
  flags: group({ x: flag, n: flag, z: flag, v: flag, c: flag, t: flag, s: flag }),
});

export type Cpu68000State = StateValues<typeof cpu68000StateDescription>;
export type Cpu68000Flags = Cpu68000State["flags"];

export type Cpu68000Snapshot = Readonly<Omit<Cpu68000State, "flags">> & {
  readonly flags: Readonly<Cpu68000Flags>;
  /** Active stack pointer: SSP in supervisor mode, USP in user mode. */
  readonly a7: number;
  /** Low 24 bits of the full 32-bit PC. */
  readonly physicalPc: number;
};

/** Physical byte access on the 24-bit memory bus. */
export type Cpu68000MemoryAccess = MemoryAccess;

/** Instruction address is the full 32-bit PC; accesses contain physical addresses. */
export type Cpu68000Instruction = FetchedInstruction;

export interface Cpu68000AlignmentFault {
  readonly operation: "fetch" | "write";
  /** Full address of the unaligned instruction or operand. */
  readonly address: number;
}

export type Cpu68000StepRecord = StateTransition<Cpu68000Snapshot> & (
  | { readonly outcome: "executed"; readonly instruction: Cpu68000Instruction }
  | { readonly outcome: "unsupported"; readonly reason: "opcode"; readonly instruction: Cpu68000Instruction }
  | { readonly outcome: "unsupported"; readonly reason: "unaligned-address";
      readonly instruction: Cpu68000Instruction | null; readonly fault: Cpu68000AlignmentFault }
);

export type Cpu68000ResetRecord = StateTransition<Cpu68000Snapshot>;

interface InstructionContext {
  readonly fetchLong: () => number;
  readonly writeLong: (address: number, value: number) => void;
}

type OpcodeHandler = (instruction: InstructionContext) => Cpu68000AlignmentFault | void;
type DataRegister = `d${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`;

/** Instruction-level Motorola 68000 subset with 32-bit registers and flat 16 MiB RAM. */
export class Cpu68000 {
  readonly #ram: Ram;
  readonly #state: Cpu68000State;

  constructor(ram: Ram, initialState: Cpu68000State) {
    if (ram.size !== 0x1000000) throw new RangeError("The 68000 model requires exactly 16 MiB of RAM.");
    this.#ram = ram;
    this.#state = readState(cpu68000StateDescription, initialState);
  }

  /** Inspect detached state, the active stack pointer, and the physical PC without RAM access. */
  snapshot(): Cpu68000Snapshot {
    const state = copyState(cpu68000StateDescription, this.#state);
    return { ...state, a7: state.flags.s ? state.ssp : state.usp, physicalPc: state.pc & 0xffffff };
  }

  /** Read the external-reset vectors, enter supervisor mode, clear trace, and mask interrupts. */
  reset(): Cpu68000ResetRecord {
    const before = this.snapshot();
    const { accesses, readByte } = this.#recordMemory();
    this.#state.ssp = this.#readLong(0, readByte);
    this.#state.pc = this.#readLong(4, readByte);
    this.#state.flags.s = true;
    this.#state.flags.t = false;
    this.#state.interruptMask = 7;
    // Registers and condition codes not specified by reset retain their supplied values.
    return { before, after: this.snapshot(), accesses };
  }

  /** Attempt one instruction; unsupported opcodes and alignment faults preserve all state and RAM. */
  step(): Cpu68000StepRecord {
    const before = this.snapshot();
    const { accesses, readByte, writeByte } = this.#recordMemory();
    const address = before.pc;
    if (address % 2 !== 0) {
      return { before, after: this.snapshot(), accesses, instruction: null,
        outcome: "unsupported", reason: "unaligned-address", fault: { operation: "fetch", address } };
    }
    const bytes: number[] = [];
    // Keep a local cursor so a rejected operand leaves the architectural PC unchanged.
    let cursor = address;
    const fetchWord = (): number => {
      const high = readByte(cursor);
      const low = readByte(cursor + 1);
      cursor = (cursor + 2) >>> 0;
      bytes.push(high, low);
      return (high << 8) | low;
    };
    const opcode = fetchWord();
    const instruction = { address, bytes };
    const handler = this.#opcodeHandlers[opcode];
    if (!handler) {
      return { before, after: this.snapshot(), accesses, instruction, outcome: "unsupported", reason: "opcode" };
    }
    const fault = handler({
      fetchLong: () => {
        const high = fetchWord();
        return ((high << 16) | fetchWord()) >>> 0;
      },
      writeLong: (address, value) => this.#writeLong(address, value, writeByte),
    });
    if (fault) {
      return { before, after: this.snapshot(), accesses, instruction, fault,
        outcome: "unsupported", reason: "unaligned-address" };
    }
    this.#state.pc = cursor;
    return { before, after: this.snapshot(), accesses, instruction, outcome: "executed" };
  }

  // Opcode selectors and construction. Register fields encode D0–D7 in numeric order.

  readonly #dataRegisters = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"] as const;
  readonly #immediateBytes = Array.from({ length: 0x100 }, (_, value) => value);

  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    // 0000 0110 ss mmm rrr: ss=10 selects long (00 byte, 01 word); EA mmm=000 selects Dn.
    ...opcodeFamily("0000 0110 10 000 rrr", { r: this.#dataRegisters }, ({ r: register }) => ({ fetchLong }: InstructionContext) => this.#addToRegister(register, fetchLong())), // ADDI.L #n,Dn

    // MOVE: 00 ss ddd mmm MMM rrr. ss=10 selects long (01 byte, 11 word).
    // Destination is register ddd then mode mmm; source is mode MMM then register rrr.
    // EA mode 000 selects Dn; mode 111 uses register 001 for absolute long, 100 for immediate.
    ...opcodeFamily("00 10 ddd 000 000 rrr", { d: this.#dataRegisters, r: this.#dataRegisters }, ({ d: destination, r: source }) => () => this.#loadRegister(destination, this.#state[source])), // MOVE.L Dm,Dn
    ...opcodeFamily("00 10 ddd 000 111 100", { d: this.#dataRegisters }, ({ d: destination }) => ({ fetchLong }: InstructionContext) => this.#loadRegister(destination, fetchLong())), // MOVE.L #n,Dn
    ...opcodeFamily("00 10 001 111 000 rrr", { r: this.#dataRegisters }, ({ r: source }) => ({ fetchLong, writeLong }: InstructionContext) => this.#storeRegister(source, fetchLong(), writeLong)), // MOVE.L Dn,(addr).L

    // 0111 rrr 0 iiiiiiii: rrr selects Dn; i is the signed immediate byte, extended to a long.
    // Bit 8 must be zero. Immediate values select handlers but do not add coverage forms.
    ...opcodeFamily("0111 rrr 0 iiiiiiii", { r: this.#dataRegisters, i: this.#immediateBytes }, ({ r: register, i: value }) => () => this.#loadQuickRegister(register, value)), // MOVEQ #n,Dn

    // Address-register operations, other sizes and addressing modes, control flow, and exceptions are deferred.
  ], 16);

  // Loads and stores.

  #loadRegister(register: DataRegister, value: number): void {
    this.#state[register] = value;
    this.#moveFlags(value);
  }

  #loadQuickRegister(register: DataRegister, byte: number): void {
    this.#loadRegister(register, signed8(byte) >>> 0);
  }

  #storeRegister(register: DataRegister, address: number, writeLong: InstructionContext["writeLong"]): Cpu68000AlignmentFault | void {
    // Long operands require word alignment, not four-byte alignment.
    if (address % 2 !== 0) return { operation: "write", address };
    const value = this.#state[register];
    writeLong(address, value);
    this.#moveFlags(value);
  }

  // Arithmetic and flags.

  #addToRegister(register: DataRegister, value: number): void {
    const original = this.#state[register];
    const sum = original + value;
    const result = sum >>> 0;
    this.#state[register] = result;
    this.#state.flags.x = this.#state.flags.c = sum > 0xffffffff;
    this.#state.flags.n = (result & 0x80000000) !== 0;
    this.#state.flags.z = result === 0;
    this.#state.flags.v = (~(original ^ value) & (original ^ result) & 0x80000000) !== 0;
  }

  #moveFlags(value: number): void {
    this.#state.flags.n = (value & 0x80000000) !== 0;
    this.#state.flags.z = value === 0;
    this.#state.flags.v = this.#state.flags.c = false;
  }

  // Memory access. Only bus addresses discard the high eight bits.

  #recordMemory(): RecordedMemory {
    const { accesses, readByte, writeByte } = recordMemory(this.#ram);
    return {
      accesses,
      readByte: address => readByte(address & 0xffffff),
      writeByte: (address, value) => writeByte(address & 0xffffff, value),
    };
  }

  #readLong(address: number, readByte: RecordedMemory["readByte"]): number {
    const high = (readByte(address) << 8) | readByte(address + 1);
    const low = (readByte(address + 2) << 8) | readByte(address + 3);
    return ((high << 16) | low) >>> 0;
  }

  #writeLong(address: number, value: number, writeByte: RecordedMemory["writeByte"]): void {
    for (const [offset, byte] of [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].entries()) {
      writeByte(address + offset, byte);
    }
  }
}
