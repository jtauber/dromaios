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
  | { readonly outcome: "unsupported"; readonly instruction: Cpu8080Instruction }
  | { readonly outcome: "halted"; readonly instruction: Cpu8080Instruction | null }
);

function copyState(state: Cpu8080Snapshot): Cpu8080State {
  const flags = state.flags;
  // Read only model fields; inputs may have extra properties or inherited getters.
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

/** Instruction-level 8080 model. Supports MVI A,n (3E), ADI n (C6), and STA addr (32). */
export class Cpu8080 {
  readonly #ram: Ram;
  readonly #state: Cpu8080State;

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
  reset(): void {
    this.#state.pc = 0;
    this.#state.interruptEnabled = false;
    this.#state.halted = false;
  }

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
    if (opcode === 0x3e) {
      const immediate = this.#read((address + 1) & 0xffff, accesses);
      this.#state.a = immediate;
      this.#state.pc = (address + 2) & 0xffff;
      return {
        instruction: { address, bytes: [opcode, immediate] },
        before,
        after: this.snapshot(),
        accesses,
        outcome: "executed",
      };
    }

    if (opcode === 0xc6) {
      const immediate = this.#read((address + 1) & 0xffff, accesses);
      const accumulator = this.#state.a;
      const sum = accumulator + immediate;
      const result = sum & 0xff;
      this.#state.a = result;
      this.#state.flags = {
        s: (result & 0x80) !== 0,
        z: result === 0,
        ac: (accumulator & 0x0f) + (immediate & 0x0f) > 0x0f,
        p: hasEvenParity(result),
        cy: sum > 0xff,
      };
      this.#state.pc = (address + 2) & 0xffff;
      return {
        instruction: { address, bytes: [opcode, immediate] },
        before,
        after: this.snapshot(),
        accesses,
        outcome: "executed",
      };
    }

    if (opcode === 0x32) {
      const low = this.#read((address + 1) & 0xffff, accesses);
      const high = this.#read((address + 2) & 0xffff, accesses);
      const destination = low | (high << 8);
      this.#write(destination, this.#state.a, accesses);
      this.#state.pc = (address + 3) & 0xffff;
      return {
        instruction: { address, bytes: [opcode, low, high] },
        before,
        after: this.snapshot(),
        accesses,
        outcome: "executed",
      };
    }

    return {
      instruction: { address, bytes: [opcode] },
      before,
      after: this.snapshot(),
      accesses,
      outcome: "unsupported",
    };
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
