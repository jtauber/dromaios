import type { Ram } from "../memory/ram.js";

export interface Cpu8080Flags {
  s: boolean;
  z: boolean;
  ac: boolean;
  p: boolean;
  cy: boolean;
}

export interface Cpu8080State {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  h: number;
  l: number;
  pc: number;
  sp: number;
  flags: Cpu8080Flags;
  interruptEnabled: boolean;
  halted: boolean;
}

export type Cpu8080Snapshot = Readonly<Omit<Cpu8080State, "flags">> & {
  readonly flags: Readonly<Cpu8080Flags>;
};

export interface Cpu8080MemoryAccess {
  readonly kind: "read" | "write";
  readonly address: number;
  readonly value: number;
}

export interface Cpu8080Instruction {
  readonly address: number;
  readonly bytes: readonly number[];
}

export type Cpu8080StepRecord = {
  readonly before: Cpu8080Snapshot;
  readonly after: Cpu8080Snapshot;
  readonly accesses: readonly Cpu8080MemoryAccess[];
} & (
  | { readonly outcome: "executed"; readonly instruction: Cpu8080Instruction }
  | {
    readonly outcome: "unsupported";
    readonly instruction: Cpu8080Instruction;
    readonly reason: "opcode";
  }
  | { readonly outcome: "halted"; readonly instruction: Cpu8080Instruction | null }
);

export interface Cpu8080ResetRecord {
  readonly before: Cpu8080Snapshot;
  readonly after: Cpu8080Snapshot;
  readonly accesses: readonly Cpu8080MemoryAccess[];
}

interface InstructionContext {
  readonly fetchByte: () => number;
  readonly fetchWord: () => number;
  readonly writeByte: (address: number, value: number) => void;
}

type OpcodeHandler = (instruction: InstructionContext) => void;

function copyState(state: Cpu8080Snapshot): Cpu8080State {
  const flags = state.flags;
  // Copy declared fields only, including non-enumerable fields and inherited getters.
  return {
    a: state.a,
    b: state.b,
    c: state.c,
    d: state.d,
    e: state.e,
    h: state.h,
    l: state.l,
    pc: state.pc,
    sp: state.sp,
    flags: { s: flags.s, z: flags.z, ac: flags.ac, p: flags.p, cy: flags.cy },
    interruptEnabled: state.interruptEnabled,
    halted: state.halted,
  };
}

function checkUnsigned(name: string, value: number, maximum: number): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 0 to ${maximum}.`);
  }
}

function hasEvenParity(byte: number): boolean {
  let setBits = 0;
  for (let bit = 0; bit < 8; bit++) {
    setBits += (byte >>> bit) & 1;
  }
  return setBits % 2 === 0;
}

/** Instruction-level Intel 8080 subset for the first 8080 example. */
export class Cpu8080 {
  readonly #ram: Ram;
  readonly #state: Cpu8080State;
  readonly #opcodeHandlers: Readonly<Partial<Record<number, OpcodeHandler>>> = {
    0x32: ({ fetchWord, writeByte }) => writeByte(fetchWord(), this.#state.a), // STA addr
    0x3e: ({ fetchByte }) => this.#loadAccumulator(fetchByte()), // MVI A,n
    0x76: () => this.#halt(), // HLT
    0xc6: ({ fetchByte }) => this.#addToAccumulator(fetchByte()), // ADI n
  };

  constructor(ram: Ram, initialState: Cpu8080Snapshot) {
    if (ram.size !== 0x10000) {
      throw new RangeError("The 8080 model requires exactly 64 KiB of RAM.");
    }
    const state = copyState(initialState);
    for (const name of ["a", "b", "c", "d", "e", "h", "l"] as const) {
      checkUnsigned(name, state[name], 0xff);
    }
    for (const name of ["pc", "sp"] as const) {
      checkUnsigned(name, state[name], 0xffff);
    }
    for (const name of ["s", "z", "ac", "p", "cy"] as const) {
      if (typeof state.flags[name] !== "boolean") {
        throw new TypeError(`Flag ${name} must be a boolean.`);
      }
    }
    if (typeof state.interruptEnabled !== "boolean" || typeof state.halted !== "boolean") {
      throw new TypeError("Interrupt enable and halted must be booleans.");
    }
    this.#ram = ram;
    this.#state = state;
  }

  /** Inspect a detached copy, readonly to TypeScript, without accessing RAM. */
  snapshot(): Cpu8080Snapshot {
    return copyState(this.#state);
  }

  /** Reset PC and control latches, preserving data registers, SP, flags, and RAM. */
  reset(): Cpu8080ResetRecord {
    const before = this.snapshot();
    this.#state.pc = 0;
    this.#state.interruptEnabled = false;
    this.#state.halted = false;
    return { before, after: this.snapshot(), accesses: [] };
  }

  /** Attempt one instruction; halted CPUs do not fetch and unsupported opcodes preserve state. */
  step(): Cpu8080StepRecord {
    const before = this.snapshot();
    if (this.#state.halted) {
      return {
        instruction: null,
        before,
        after: this.snapshot(),
        accesses: [],
        outcome: "halted",
      };
    }

    const accesses: Cpu8080MemoryAccess[] = [];
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
          const low = fetchByte();
          const high = fetchByte();
          return low | (high << 8);
        },
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
      ? { ...record, outcome: this.#state.halted ? "halted" : "executed" }
      : { ...record, outcome: "unsupported", reason: "opcode" };
  }

  #loadAccumulator(value: number): void {
    this.#state.a = value;
  }

  #addToAccumulator(value: number): void {
    const accumulator = this.#state.a;
    const sum = accumulator + value;
    const result = sum & 0xff;
    this.#state.a = result;
    this.#state.flags = {
      s: (result & 0x80) !== 0,
      z: result === 0,
      ac: (accumulator & 0x0f) + (value & 0x0f) > 0x0f,
      p: hasEvenParity(result),
      cy: sum > 0xff,
    };
  }

  #halt(): void {
    this.#state.halted = true;
  }

  #read(address: number, accesses: Cpu8080MemoryAccess[]): number {
    const value = this.#ram.read(address);
    accesses.push({ kind: "read", address, value });
    return value;
  }

  #write(address: number, value: number, accesses: Cpu8080MemoryAccess[]): void {
    this.#ram.write(address, value);
    accesses.push({ kind: "write", address, value });
  }
}
