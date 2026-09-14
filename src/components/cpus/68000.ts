import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition } from "./execution-records.ts";
import { signed8 } from "./binary.ts";
import { recordMemory } from "./memory-access.ts";
import type { ByteMemory, MemoryAccess, RecordedMemory } from "./memory-access.ts";
import { defineState, copyState, readState, unsigned, flag, group } from "./state.ts";
import type { StateValues } from "./state.js";
import { opcodeFamily, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.ts";
import { add } from "./alu.ts";

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
  readonly operation: "fetch" | "read" | "write";
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

interface InstructionContext extends ByteMemory {
  readonly nextAddress: () => number;
  readonly fetchWord: () => number;
  readonly fetchLong: () => number;
}

type OpcodeHandler = (cpu: Cpu68000, instruction: InstructionContext) => Cpu68000AlignmentFault | void;
type DataRegister = `d${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`;
type AddressRegister = `a${0 | 1 | 2 | 3 | 4 | 5 | 6}` | "usp" | "ssp";
type OperandSize = 8 | 16 | 32;
type Operand =
  | { readonly kind: "data"; readonly register: DataRegister }
  | { readonly kind: "address"; readonly register: AddressRegister }
  | { readonly kind: "memory"; readonly address: number }
  | { readonly kind: "immediate"; readonly value: number };

// Pending auto-updates are visible to the destination but commit only after alignment checks.
type AddressUpdates = Map<AddressRegister, number>;

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
    this.#state.ssp = this.#readMemory(32, 0, readByte);
    this.#state.pc = this.#readMemory(32, 4, readByte);
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
    const handler = Cpu68000.#opcodeHandlers[opcode];
    if (!handler) {
      return { before, after: this.snapshot(), accesses, instruction, outcome: "unsupported", reason: "opcode" };
    }
    const fault = handler(this, {
      nextAddress: () => cursor, fetchWord, readByte, writeByte,
      fetchLong: () => {
        const high = fetchWord();
        return ((high << 16) | fetchWord()) >>> 0;
      },
    });
    if (fault) {
      return { before, after: this.snapshot(), accesses, instruction, fault,
        outcome: "unsupported", reason: "unaligned-address" };
    }
    this.#state.pc = cursor;
    return { before, after: this.snapshot(), accesses, instruction, outcome: "executed" };
  }

  // Register views. Encoded A7 selects the currently active stored stack pointer.

  #addressRegister(code: number): AddressRegister {
    return code === 7 ? (this.#state.flags.s ? "ssp" : "usp") : Cpu68000.#addressRegisters[code]!;
  }

  // Opcode selectors and construction. Register and mode fields use numeric encoding order.

  static readonly #dataRegisters = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"] as const;
  static readonly #addressRegisters = ["a0", "a1", "a2", "a3", "a4", "a5", "a6"] as const;
  static readonly #selectors = [0, 1, 2, 3, 4, 5, 6, 7] as const;
  static readonly #immediateBytes = Array.from({ length: 0x100 }, (_, value) => value);

  // Bind encodings once per model; handlers receive the executing CPU and capture no instance state.
  static readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    // 0000 0110 ss mmm rrr: ss=10 selects long (00 byte, 01 word); EA mmm=000 selects Dn.
    ...opcodeFamily("0000 0110 10 000 rrr", { r: this.#dataRegisters }, ({ r: register }) => (cpu: Cpu68000, { fetchLong }: InstructionContext) => cpu.#addToRegister(register, fetchLong())), // ADDI.L #n,Dn

    // MOVE: 00 zz ddd mmm sss rrr. zz=01 byte, 10 long, 11 word.
    // Destination is register ddd then mode mmm; source is mode sss then register rrr.
    // Destination mode 001 is MOVEA (word/long only), with sign extension and no flag changes.
    ...this.#moveHandlers("00 01 ddd mmm sss rrr", 8), // MOVE.B <ea>,<ea>
    ...this.#moveHandlers("00 10 ddd mmm sss rrr", 32), // MOVE.L / MOVEA.L <ea>,<ea>
    ...this.#moveHandlers("00 11 ddd mmm sss rrr", 16), // MOVE.W / MOVEA.W <ea>,<ea>

    // 0111 rrr 0 iiiiiiii: rrr selects Dn; i is the signed immediate byte, extended to a long.
    // Bit 8 must be zero. Immediate values select handlers but do not add coverage forms.
    ...opcodeFamily("0111 rrr 0 iiiiiiii", { r: this.#dataRegisters, i: this.#immediateBytes }, ({ r: register, i: value }) => (cpu: Cpu68000) => cpu.#loadQuickRegister(register, value)), // MOVEQ #n,Dn

    // Other transfer families, arithmetic sizes/modes, control flow, and exceptions are deferred.
  ], 16);

  static #moveHandlers(pattern: string, size: OperandSize): readonly OpcodeEntry<OpcodeHandler>[] {
    const codes = this.#selectors;
    return opcodeFamily(pattern, { d: codes, m: codes, s: codes, r: codes }, ({ d, m, s, r }) => {
      // Mode 111: sources allow absolute word/long, PC displacement/index, and immediate;
      // destinations allow only absolute word/long. Byte transfers cannot read or write An.
      if ((s === 7 && r > 4) || (m === 7 && d > 1) || (size === 8 && (s === 1 || m === 1))) return undefined;
      return (cpu: Cpu68000, instruction: InstructionContext) => cpu.#move(size, s, r, m, d, instruction);
    }).flatMap(([opcode, handler]) => handler ? [[opcode, handler] as const] : []);
  }

  // Effective addresses. Resolve each operand once, source before destination.

  #resolveOperand(size: OperandSize, mode: number, code: number, instruction: InstructionContext, updates: AddressUpdates): Operand {
    const { fetchWord, fetchLong, nextAddress } = instruction;
    const register = this.#addressRegister(code);
    const base = updates.get(register) ?? this.#state[register];
    let address: number;
    switch (mode) {
      case 0b000: return { kind: "data", register: Cpu68000.#dataRegisters[code]! }; // Dn
      case 0b001: return { kind: "address", register }; // An
      case 0b010: address = base; break; // (An)
      case 0b011: // (An)+; A7 steps by two even for bytes.
        address = base;
        updates.set(register, (base + (size === 8 && code === 7 ? 2 : size / 8)) >>> 0);
        break;
      case 0b100: // -(An)
        address = (base - (size === 8 && code === 7 ? 2 : size / 8)) >>> 0;
        updates.set(register, address);
        break;
      case 0b101: address = base + (fetchWord() << 16 >> 16); break; // (d16,An)
      case 0b110: address = base + this.#indexOffset(fetchWord(), updates); break; // (d8,An,Xn)
      case 0b111:
        switch (code) {
          case 0b000: address = fetchWord() << 16 >> 16; break; // (xxx).W, sign-extended
          case 0b001: address = fetchLong(); break; // (xxx).L
          // PC-relative bases are the extension word's address, before fetching it.
          case 0b010: address = nextAddress() + (fetchWord() << 16 >> 16); break; // (d16,PC)
          case 0b011: address = nextAddress() + this.#indexOffset(fetchWord(), updates); break; // (d8,PC,Xn)
          case 0b100: return { kind: "immediate", value: size === 32 ? fetchLong() : fetchWord() }; // #n
          default: throw new Error("Unsupported effective address reached execution.");
        }
        break;
      default: throw new Error("Invalid effective-address mode.");
    }
    return { kind: "memory", address: address >>> 0 };
  }

  #indexOffset(extension: number, updates: AddressUpdates): number {
    // t rrr w 000 dddddddd: t=0 Dn / 1 An; w=0 signed word / 1 long; d is signed byte.
    // The original 68000 ignores bits 10–8: no scaling or full extension words.
    const code = (extension >>> 12) & 7;
    const addressRegister = this.#addressRegister(code);
    const index = extension & 0x8000 ? (updates.get(addressRegister) ?? this.#state[addressRegister])
      : this.#state[Cpu68000.#dataRegisters[code]!];
    return (extension & 0x0800 ? index : (index << 16 >> 16)) + signed8(extension & 0xff);
  }

  #readOperand(size: OperandSize, operand: Operand, readByte: ByteMemory["readByte"]): number {
    const value = operand.kind === "memory" ? this.#readMemory(size, operand.address, readByte)
      : operand.kind === "immediate" ? operand.value : this.#state[operand.register];
    return value % 2 ** size;
  }

  // Loads and stores. Source reads finish before resolving or writing the destination.

  #move(size: OperandSize, sourceMode: number, sourceCode: number, destinationMode: number, destinationCode: number,
    instruction: InstructionContext): Cpu68000AlignmentFault | void {
    const updates: AddressUpdates = new Map();
    const source = this.#resolveOperand(size, sourceMode, sourceCode, instruction, updates);
    if (source.kind === "memory" && size !== 8 && source.address % 2 !== 0) return { operation: "read", address: source.address };
    const value = this.#readOperand(size, source, instruction.readByte);
    const destination = this.#resolveOperand(size, destinationMode, destinationCode, instruction, updates);
    if (destination.kind === "memory" && size !== 8 && destination.address % 2 !== 0) return { operation: "write", address: destination.address };
    if (destination.kind === "immediate") throw new Error("Immediate destination reached execution.");
    for (const [register, address] of updates) this.#state[register] = address;
    if (destination.kind === "address") {
      this.#state[destination.register] = (size === 16 ? (value << 16 >> 16) : value) >>> 0;
    } else {
      if (destination.kind === "memory") this.#writeMemory(size, destination.address, value, instruction.writeByte);
      else this.#state[destination.register] = ((this.#state[destination.register] & ~(2 ** size - 1)) | value) >>> 0;
      this.#moveFlags(value, size);
    }
  }

  #loadQuickRegister(register: DataRegister, byte: number): void {
    const value = signed8(byte) >>> 0;
    this.#state[register] = value;
    this.#moveFlags(value);
  }

  // Arithmetic and flags.

  #addToRegister(register: DataRegister, value: number): void {
    const { result, carry, overflow } = add(32, this.#state[register], value);
    this.#state[register] = result;
    this.#state.flags.x = this.#state.flags.c = carry;
    this.#state.flags.n = (result & 0x80000000) !== 0;
    this.#state.flags.z = result === 0;
    this.#state.flags.v = overflow;
  }

  #moveFlags(value: number, size: OperandSize = 32): void {
    this.#state.flags.n = value >= 2 ** (size - 1);
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

  #readMemory(size: OperandSize, address: number, readByte: ByteMemory["readByte"]): number {
    let value = 0;
    for (let offset = 0; offset < size / 8; offset++) value = value * 0x100 + readByte(address + offset);
    return value;
  }

  #writeMemory(size: OperandSize, address: number, value: number, writeByte: ByteMemory["writeByte"]): void {
    for (let offset = 0; offset < size / 8; offset++) {
      writeByte(address + offset, (value >>> (size - 8 - offset * 8)) & 0xff);
    }
  }
}
