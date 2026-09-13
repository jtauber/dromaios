import type { Ram } from "../memory/ram.js";
import { checkUnsigned } from "../validation.js";

export interface Cpu6809Flags {
  e: boolean;
  f: boolean;
  h: boolean;
  i: boolean;
  n: boolean;
  z: boolean;
  v: boolean;
  c: boolean;
}

export interface Cpu6809State {
  a: number;
  b: number;
  dp: number;
  x: number;
  y: number;
  s: number;
  u: number;
  pc: number;
  flags: Cpu6809Flags;
}

export type Cpu6809Snapshot = Readonly<Omit<Cpu6809State, "flags">> & {
  readonly flags: Readonly<Cpu6809Flags>;
  readonly d: number;
};

export interface Cpu6809MemoryAccess {
  readonly kind: "read" | "write";
  readonly address: number;
  readonly value: number;
}

export interface Cpu6809Instruction {
  readonly address: number;
  readonly bytes: readonly number[];
}

export type Cpu6809StepRecord = {
  readonly instruction: Cpu6809Instruction;
  readonly before: Cpu6809Snapshot;
  readonly after: Cpu6809Snapshot;
  readonly accesses: readonly Cpu6809MemoryAccess[];
} & (
  | { readonly outcome: "executed" }
  | { readonly outcome: "unsupported"; readonly reason: "opcode" }
);

export interface Cpu6809ResetRecord {
  readonly before: Cpu6809Snapshot;
  readonly after: Cpu6809Snapshot;
  readonly accesses: readonly Cpu6809MemoryAccess[];
}

interface InstructionContext {
  readonly fetchByte: () => number;
  readonly fetchWord: () => number;
  readonly readByte: (address: number) => number;
  readonly writeByte: (address: number, value: number) => void;
}

type OpcodeHandler = (instruction: InstructionContext) => void;
type StackPointer = "s" | "u";

function copyState(state: Omit<Cpu6809Snapshot, "d">): Cpu6809State {
  const flags = state.flags;
  // Copy declared stored fields only; a supplied D or metadata getter is ignored.
  return {
    a: state.a,
    b: state.b,
    dp: state.dp,
    x: state.x,
    y: state.y,
    s: state.s,
    u: state.u,
    pc: state.pc,
    flags: {
      e: flags.e, f: flags.f, h: flags.h, i: flags.i,
      n: flags.n, z: flags.z, v: flags.v, c: flags.c,
    },
  };
}

/** Instruction-level MC6809 subset for the 6809 examples. */
export class Cpu6809 {
  readonly #ram: Ram;
  readonly #state: Cpu6809State;
  readonly #opcodeHandlers: Readonly<Partial<Record<number, OpcodeHandler>>> = {
    0x34: ({ fetchByte, writeByte }) => this.#pushRegisters("s", fetchByte(), writeByte), // PSHS
    0x35: ({ fetchByte, readByte }) => this.#pullRegisters("s", fetchByte(), readByte), // PULS
    0x36: ({ fetchByte, writeByte }) => this.#pushRegisters("u", fetchByte(), writeByte), // PSHU
    0x37: ({ fetchByte, readByte }) => this.#pullRegisters("u", fetchByte(), readByte), // PULU
    0x86: ({ fetchByte }) => this.#loadAccumulator(fetchByte()), // LDA #n
    0x8b: ({ fetchByte }) => this.#addToAccumulator(fetchByte()), // ADDA #n
    0xb7: ({ fetchWord, writeByte }) => { // STA addr (extended)
      const address = fetchWord();
      const value = this.#state.a;
      writeByte(address, value);
      this.#setLoadStoreFlags(value);
    },
  };

  constructor(ram: Ram, initialState: Omit<Cpu6809Snapshot, "d">) {
    if (ram.size !== 0x10000) {
      throw new RangeError("The 6809 model requires exactly 64 KiB of RAM.");
    }
    const state = copyState(initialState);
    for (const name of ["a", "b", "dp"] as const) {
      checkUnsigned(name, state[name], 0xff);
    }
    for (const name of ["x", "y", "s", "u", "pc"] as const) {
      checkUnsigned(name, state[name], 0xffff);
    }
    for (const name of ["e", "f", "h", "i", "n", "z", "v", "c"] as const) {
      if (typeof state.flags[name] !== "boolean") {
        throw new TypeError(`Flag ${name} must be a boolean.`);
      }
    }
    this.#ram = ram;
    this.#state = state;
  }

  /** Inspect a detached copy, including D derived from A/B, without accessing RAM. */
  snapshot(): Cpu6809Snapshot {
    const state = copyState(this.#state);
    return { ...state, d: (state.a << 8) | state.b };
  }

  /** Reset PC, DP, F, and I with only the vector reads; preserve other state and RAM. */
  reset(): Cpu6809ResetRecord {
    const before = this.snapshot();
    const accesses: Cpu6809MemoryAccess[] = [];
    const high = this.#read(0xfffe, accesses);
    const low = this.#read(0xffff, accesses);
    this.#state.pc = (high << 8) | low;
    this.#state.dp = 0;
    this.#state.flags.f = true;
    this.#state.flags.i = true;
    return { before, after: this.snapshot(), accesses };
  }

  /** Attempt one instruction; unsupported bytes (including prefixes) leave state unchanged. */
  step(): Cpu6809StepRecord {
    const before = this.snapshot();
    const accesses: Cpu6809MemoryAccess[] = [];
    const address = this.#state.pc;
    const opcode = this.#read(address, accesses);
    const bytes = [opcode];
    const handler = this.#opcodeHandlers[opcode];
    if (handler) {
      // Advance only for supported instructions; operand fetches advance themselves.
      this.#state.pc = (address + 1) & 0xffff;
      const fetchByte = (): number => {
        const pc = this.#state.pc;
        const byte = this.#read(pc, accesses);
        this.#state.pc = (pc + 1) & 0xffff;
        bytes.push(byte);
        return byte;
      };
      handler({
        fetchByte,
        fetchWord: () => {
          const high = fetchByte();
          const low = fetchByte();
          return (high << 8) | low;
        },
        readByte: (address) => this.#read(address, accesses),
        writeByte: (address, value) => this.#write(address, value, accesses),
      });
    }

    const record = {
      instruction: { address, bytes },
      before,
      after: this.snapshot(),
      accesses,
    };
    return handler
      ? { ...record, outcome: "executed" }
      : { ...record, outcome: "unsupported", reason: "opcode" };
  }

  get #cc(): number {
    const flags = this.#state.flags;
    return (Number(flags.e) << 7) | (Number(flags.f) << 6)
      | (Number(flags.h) << 5) | (Number(flags.i) << 4)
      | (Number(flags.n) << 3) | (Number(flags.z) << 2)
      | (Number(flags.v) << 1) | Number(flags.c);
  }

  set #cc(value: number) {
    this.#state.flags = {
      e: (value & 0x80) !== 0, f: (value & 0x40) !== 0,
      h: (value & 0x20) !== 0, i: (value & 0x10) !== 0,
      n: (value & 0x08) !== 0, z: (value & 0x04) !== 0,
      v: (value & 0x02) !== 0, c: (value & 0x01) !== 0,
    };
  }

  #pushRegisters(stack: StackPointer, mask: number, writeByte: InstructionContext["writeByte"]): void {
    const pushByte = (value: number): void => {
      this.#state[stack] = (this.#state[stack] - 1) & 0xffff;
      writeByte(this.#state[stack], value);
    };
    const pushWord = (value: number): void => {
      pushByte(value & 0xff);
      pushByte(value >>> 8);
    };
    // Descending mask order; PC has already advanced past the postbyte.
    if (mask & 0x80) pushWord(this.#state.pc);
    if (mask & 0x40) pushWord(this.#state[stack === "s" ? "u" : "s"]);
    if (mask & 0x20) pushWord(this.#state.y);
    if (mask & 0x10) pushWord(this.#state.x);
    if (mask & 0x08) pushByte(this.#state.dp);
    if (mask & 0x04) pushByte(this.#state.b);
    if (mask & 0x02) pushByte(this.#state.a);
    if (mask & 0x01) pushByte(this.#cc);
  }

  #pullRegisters(stack: StackPointer, mask: number, readByte: InstructionContext["readByte"]): void {
    const pullByte = (): number => {
      const value = readByte(this.#state[stack]);
      this.#state[stack] = (this.#state[stack] + 1) & 0xffff;
      return value;
    };
    const pullWord = (): number => {
      const high = pullByte();
      return (high << 8) | pullByte();
    };
    // Reverse the push order; ordinary pulls do not apply load-instruction flags.
    if (mask & 0x01) this.#cc = pullByte();
    if (mask & 0x02) this.#state.a = pullByte();
    if (mask & 0x04) this.#state.b = pullByte();
    if (mask & 0x08) this.#state.dp = pullByte();
    if (mask & 0x10) this.#state.x = pullWord();
    if (mask & 0x20) this.#state.y = pullWord();
    if (mask & 0x40) this.#state[stack === "s" ? "u" : "s"] = pullWord();
    if (mask & 0x80) this.#state.pc = pullWord();
  }

  #loadAccumulator(value: number): void {
    this.#state.a = value;
    this.#setLoadStoreFlags(value);
  }

  #setLoadStoreFlags(value: number): void {
    this.#state.flags.n = (value & 0x80) !== 0;
    this.#state.flags.z = value === 0;
    this.#state.flags.v = false;
  }

  #addToAccumulator(value: number): void {
    const accumulator = this.#state.a;
    const sum = accumulator + value;
    const result = sum & 0xff;
    this.#loadAccumulator(result);
    this.#state.flags.h = (accumulator & 0x0f) + (value & 0x0f) > 0x0f;
    this.#state.flags.c = sum > 0xff;
    // Like-signed operands producing an opposite-signed result indicate overflow.
    this.#state.flags.v = (~(accumulator ^ value) & (accumulator ^ result) & 0x80) !== 0;
  }

  #read(address: number, accesses: Cpu6809MemoryAccess[]): number {
    const value = this.#ram.read(address);
    accesses.push({ kind: "read", address, value });
    return value;
  }

  #write(address: number, value: number, accesses: Cpu6809MemoryAccess[]): void {
    this.#ram.write(address, value);
    accesses.push({ kind: "write", address, value });
  }
}
