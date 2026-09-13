import type { Ram } from "../memory/ram.js";
import { defineState, copyState, readState, unsigned, flag, group } from "./state.ts";
import type { StateDescription } from "./state.js";
import { opcodePattern, opcodeTable } from "./opcodes.ts";

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

export interface Cpu8088MemoryAccess {
  readonly kind: "read" | "write";
  /** Physical address on the 20-bit memory bus. */
  readonly address: number;
  readonly value: number;
}

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
  readonly fetchWord: () => number;
  readonly writeByte: (address: number, value: number) => void;
}

type OpcodeHandler = (instruction: InstructionContext) => void;

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
    const accesses: Cpu8088MemoryAccess[] = [];
    const address = before.pc;
    const opcode = this.#read(address, accesses);
    const bytes = [opcode];
    const handler = this.#opcodeHandlers[opcode];
    if (handler) {
      this.#state.ip = (this.#state.ip + 1) & 0xffff;
      const fetchByte = (): number => {
        const value = this.#read(physicalAddress(this.#state.cs, this.#state.ip), accesses);
        this.#state.ip = (this.#state.ip + 1) & 0xffff;
        bytes.push(value);
        return value;
      };
      handler({
        fetchWord: () => {
          const low = fetchByte();
          return low | (fetchByte() << 8);
        },
        writeByte: (address, value) => this.#write(address, value, accesses),
      });
    }
    const record = { instruction: { address, bytes }, before, after: this.snapshot(), accesses };
    return handler
      ? { ...record, outcome: "executed" }
      : { ...record, outcome: "unsupported", reason: "opcode" };
  }

  // Opcode construction. Fixed fields keep the initial subset and its missing forms explicit.

  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    // 00 ooo 10 w: ooo=000 selects ADD; 10 selects immediate-to-accumulator; w=1 selects AX.
    ...opcodePattern("00 000 10 1", ({ fetchWord }: InstructionContext) => this.#addToAccumulator(fetchWord())), // ADD AX,n

    // 1010 00 d w: d=1 stores the accumulator to DS:offset; w=1 selects a word.
    ...opcodePattern("1010 00 1 1", ({ fetchWord, writeByte }: InstructionContext) => this.#storeAccumulator(fetchWord(), writeByte)), // MOV [offset],AX

    // 1011 w rrr: w=1 selects a word; rrr=000 selects AX (001 CX, 010 DX, 011 BX,
    // 100 SP, 101 BP, 110 SI, 111 DI). Other register and byte forms remain unsupported.
    ...opcodePattern("1011 1 000", ({ fetchWord }: InstructionContext) => { this.#state.ax = fetchWord(); }), // MOV AX,n

    // ModR/M forms, prefixes, control flow, stack operations, interrupts, and I/O are deferred.
  ]);

  // Addressing and stores.

  #storeAccumulator(offset: number, writeByte: InstructionContext["writeByte"]): void {
    const { ax, ds } = this.#state;
    const address = physicalAddress(ds, offset);
    // A data word occupies consecutive physical bytes, even at offset FFFF.
    writeByte(address, ax & 0xff);
    writeByte((address + 1) & 0xfffff, ax >>> 8);
  }

  // Arithmetic and flags.

  #addToAccumulator(value: number): void {
    const accumulator = this.#state.ax;
    const sum = accumulator + value;
    const result = sum & 0xffff;
    this.#state.ax = result;
    this.#state.flags.cf = sum > 0xffff;
    this.#state.flags.af = (accumulator & 0xf) + (value & 0xf) > 0xf;
    this.#state.flags.zf = result === 0;
    this.#state.flags.sf = (result & 0x8000) !== 0;
    this.#state.flags.of = (~(accumulator ^ value) & (accumulator ^ result) & 0x8000) !== 0;
    // Parity is defined by the low byte even for word operations; fold its bits to one.
    let parity = result & 0xff;
    parity ^= parity >>> 4;
    parity ^= parity >>> 2;
    parity ^= parity >>> 1;
    this.#state.flags.pf = (parity & 1) === 0;
  }

  // Recorded memory access.

  #read(address: number, accesses: Cpu8088MemoryAccess[]): number {
    const value = this.#ram.read(address);
    accesses.push({ kind: "read", address, value });
    return value;
  }

  #write(address: number, value: number, accesses: Cpu8088MemoryAccess[]): void {
    this.#ram.write(address, value);
    accesses.push({ kind: "write", address, value });
  }
}
