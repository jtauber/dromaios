import type { Ram } from "../memory/ram.js";
import { defineState, copyState, readState, unsigned, flag, boolean, array, group } from "./state.ts";
import type { StateDescription } from "./state.js";
import { opcodePattern, opcodeTable } from "./opcodes.ts";

export interface Cpu8008Flags {
  s: boolean;
  z: boolean;
  p: boolean;
  c: boolean;
}

/** Eight physical address registers; stackIndex selects the current program counter. */
export type Cpu8008AddressStack = [number, number, number, number, number, number, number, number];

export interface Cpu8008State {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  h: number;
  l: number;
  flags: Cpu8008Flags;
  addressStack: Readonly<Cpu8008AddressStack>;
  stackIndex: number;
  halted: boolean;
}

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu8008StateDescription = defineState({
  a: unsigned(8), b: unsigned(8), c: unsigned(8), d: unsigned(8), e: unsigned(8), h: unsigned(8), l: unsigned(8),
  flags: group({ s: flag, z: flag, p: flag, c: flag }),
  addressStack: array(8, unsigned(14)), stackIndex: unsigned(3), halted: boolean,
} satisfies StateDescription<Cpu8008State>);

export type Cpu8008Snapshot = Readonly<Omit<Cpu8008State, "flags">> & {
  readonly flags: Readonly<Cpu8008Flags>;
  readonly pc: number;
  /** Raw H:L byte pair; memory addressing uses only its low 14 bits. */
  readonly hl: number;
};

export interface Cpu8008MemoryAccess {
  readonly kind: "read" | "write";
  readonly address: number;
  readonly value: number;
}

export interface Cpu8008Instruction {
  readonly address: number;
  readonly bytes: readonly number[];
}

export type Cpu8008StepRecord = {
  readonly before: Cpu8008Snapshot;
  readonly after: Cpu8008Snapshot;
  readonly accesses: readonly Cpu8008MemoryAccess[];
} & (
  | { readonly outcome: "executed"; readonly instruction: Cpu8008Instruction }
  | { readonly outcome: "unsupported"; readonly instruction: Cpu8008Instruction; readonly reason: "opcode" }
  | { readonly outcome: "halted"; readonly instruction: Cpu8008Instruction | null }
);

export interface Cpu8008ResetRecord {
  readonly before: Cpu8008Snapshot;
  readonly after: Cpu8008Snapshot;
  readonly accesses: readonly Cpu8008MemoryAccess[];
}

interface InstructionContext {
  readonly fetchByte: () => number;
  readonly fetchAddress: () => number;
  readonly writeByte: (address: number, value: number) => void;
}

type OpcodeHandler = (instruction: InstructionContext) => void;
type StoredState = Omit<Cpu8008State, "addressStack"> & { addressStack: Cpu8008AddressStack };

/** Instruction-level Intel 8008 subset with its native encodings and 14-bit addresses. */
export class Cpu8008 {
  readonly #ram: Ram;
  readonly #state: StoredState;

  constructor(ram: Ram, initialState: Cpu8008State) {
    if (ram.size !== 0x4000) throw new RangeError("The 8008 model requires exactly 16 KiB of RAM.");
    this.#ram = ram;
    this.#state = readState(cpu8008StateDescription, initialState);
  }

  /** Inspect detached state, the selected PC, and the raw H:L pair without RAM accesses. */
  snapshot(): Cpu8008Snapshot {
    return { ...copyState(cpu8008StateDescription, this.#state), pc: this.#pc, hl: this.#hl };
  }

  /** Model settled power-on clearing and STOPPED, not an interrupt or a lesson restart. */
  reset(): Cpu8008ResetRecord {
    const before = this.snapshot();
    for (const name of ["a", "b", "c", "d", "e", "h", "l"] as const) this.#state[name] = 0;
    this.#state.addressStack.fill(0);
    this.#state.stackIndex = 0;
    this.#state.halted = true;
    // The startup description does not specify flag values; preserve them as model policy.
    return { before, after: this.snapshot(), accesses: [] };
  }

  /** Attempt one instruction; unsupported and already halted attempts preserve all state. */
  step(): Cpu8008StepRecord {
    const before = this.snapshot();
    if (this.#state.halted) {
      return { before, after: this.snapshot(), instruction: null, accesses: [], outcome: "halted" };
    }
    const accesses: Cpu8008MemoryAccess[] = [];
    const address = this.#pc;
    const opcode = this.#read(address, accesses);
    const bytes = [opcode];
    const handler = this.#opcodeHandlers[opcode];
    if (handler) {
      this.#pc = (address + 1) & 0x3fff;
      const fetchByte = () => {
        const byte = this.#read(this.#pc, accesses);
        this.#pc = (this.#pc + 1) & 0x3fff;
        bytes.push(byte);
        return byte;
      };
      handler({
        fetchByte,
        fetchAddress: () => {
          const low = fetchByte();
          const high = fetchByte();
          return ((high & 0x3f) << 8) | low;
        },
        writeByte: (address, value) => this.#write(address, value, accesses),
      });
    }
    const record = { instruction: { address, bytes }, before, after: this.snapshot(), accesses };
    return handler
      ? { ...record, outcome: this.#state.halted ? "halted" : "executed" }
      : { ...record, outcome: "unsupported", reason: "opcode" };
  }

  // Register views. PC is a selected address register, not duplicate stored state.

  get #pc(): number {
    // Construction validates the selector and all eight slots.
    return this.#state.addressStack[this.#state.stackIndex]!;
  }

  set #pc(value: number) {
    this.#state.addressStack[this.#state.stackIndex] = value;
  }

  get #hl(): number {
    return (this.#state.h << 8) | this.#state.l;
  }

  // Opcode construction. Bits 7 6 | 5 4 3 | 2 1 0 = xx yyy zzz.
  // Register selectors: 000 A, 001 B, 010 C, 011 D, 100 E, 101 H, 110 L, 111 M.
  // M means RAM at H:L masked to 14 bits. These are native 8008 encodings.
  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    // 00 000 00x: both x values encode HLT, occupying the absent IN A/DC A slots.
    ...opcodePattern("00 000 00x", () => this.#halt()), // HLT (00/01)

    // 00 ooo 100: immediate ALU; ooo=000 selects ADI. Other operations are omitted.
    ...opcodePattern("00 000 100", ({ fetchByte }: InstructionContext) => this.#addToAccumulator(fetchByte())), // ADI n

    // 00 rrr 110: immediate register load; only rrr=000/101/110 (A/H/L) are implemented.
    ...opcodePattern("00 000 110", ({ fetchByte }: InstructionContext) => this.#loadRegister("a", fetchByte())), // LAI n
    ...opcodePattern("00 101 110", ({ fetchByte }: InstructionContext) => this.#loadRegister("h", fetchByte())), // LHI n
    ...opcodePattern("00 110 110", ({ fetchByte }: InstructionContext) => this.#loadRegister("l", fetchByte())), // LLI n

    // 00 xxx 111: RET. Bits 5–3 are don't-care bits: all eight encodings return.
    ...opcodePattern("00 xxx 111", () => this.#return()), // RET

    // 01 xxx 100/110: JMP/CAL. Again xxx is ignored, not a register or condition.
    // The following bytes supply the address as llllllll, xxhhhhhh (low byte first).
    ...opcodePattern("01 xxx 100", ({ fetchAddress }: InstructionContext) => this.#jump(fetchAddress())), // JMP addr
    ...opcodePattern("01 xxx 110", ({ fetchAddress }: InstructionContext) => this.#call(fetchAddress())), // CAL addr

    // Conditional jumps/calls/returns, RST, I/O, and xx=10 ALU forms remain unsupported.

    // 11 ddd sss: loads; ddd=111 selects M and sss=000 selects A. The M,M slot is HLT.
    ...opcodePattern("11 111 000", ({ writeByte }: InstructionContext) => writeByte(this.#hl & 0x3fff, this.#state.a)), // LMA
    ...opcodePattern("11 111 111", () => this.#halt()), // HLT (FF), not a memory-to-memory load.
  ]);

  // Loads.

  #loadRegister(register: "a" | "h" | "l", value: number): void {
    this.#state[register] = value;
  }

  // Control flow.

  #jump(address: number): void {
    this.#pc = address;
  }

  #call(address: number): void {
    // All three bytes have advanced the caller's slot to the return address.
    // The next physical slot becomes PC; an eighth nested call overwrites the oldest return.
    this.#state.stackIndex = (this.#state.stackIndex + 1) & 7;
    this.#pc = address;
  }

  #return(): void {
    // Opcode fetch already advanced the outgoing slot. Retain it when selecting the caller.
    this.#state.stackIndex = (this.#state.stackIndex + 7) & 7;
  }

  #halt(): void {
    this.#state.halted = true;
  }

  // Arithmetic and flags.

  #addToAccumulator(value: number): void {
    const sum = this.#state.a + value;
    const result = sum & 0xff;
    this.#state.a = result;
    let parity = result;
    parity ^= parity >> 4;
    parity ^= parity >> 2;
    parity ^= parity >> 1;
    this.#state.flags = { s: (result & 0x80) !== 0, z: result === 0, p: (parity & 1) === 0, c: sum > 0xff };
  }

  // Recorded memory access.

  #read(address: number, accesses: Cpu8008MemoryAccess[]): number {
    const value = this.#ram.read(address);
    accesses.push({ kind: "read", address, value });
    return value;
  }

  #write(address: number, value: number, accesses: Cpu8008MemoryAccess[]): void {
    this.#ram.write(address, value);
    accesses.push({ kind: "write", address, value });
  }
}
