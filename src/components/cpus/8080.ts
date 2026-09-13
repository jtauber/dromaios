import type { Ram } from "../memory/ram.js";
import { checkUnsigned } from "../validation.js";

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
  readonly bc: number;
  readonly de: number;
  readonly hl: number;
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
  readonly readByte: (address: number) => number;
  readonly writeByte: (address: number, value: number) => void;
}

type OpcodeHandler = (instruction: InstructionContext) => void;

type ByteRegister = "b" | "c" | "d" | "e" | "h" | "l" | "a";

interface ByteOperand {
  readonly read: (instruction: InstructionContext) => number;
  readonly write: (instruction: InstructionContext, value: number) => void;
}

function copyState(state: Omit<Cpu8080Snapshot, "bc" | "de" | "hl">): Cpu8080State {
  const flags = state.flags;
  // Copy declared stored fields only; supplied pair views and metadata are ignored.
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

function hasEvenParity(byte: number): boolean {
  let setBits = 0;
  for (let bit = 0; bit < 8; bit++) {
    setBits += (byte >>> bit) & 1;
  }
  return setBits % 2 === 0;
}

/** Instruction-level Intel 8080 subset for the 8080 examples. */
export class Cpu8080 {
  readonly #ram: Ram;
  readonly #state: Cpu8080State;
  // Intel's three-bit register encoding: B, C, D, E, H, L, M, A.
  readonly #byteOperands: readonly ByteOperand[] = [
    this.#registerOperand("b"), this.#registerOperand("c"),
    this.#registerOperand("d"), this.#registerOperand("e"),
    this.#registerOperand("h"), this.#registerOperand("l"),
    {
      read: ({ readByte }) => readByte(this.#hl),
      write: ({ writeByte }, value) => writeByte(this.#hl, value),
    },
    this.#registerOperand("a"),
  ];
  readonly #opcodeHandlers: Readonly<Partial<Record<number, OpcodeHandler>>> = {
    ...this.#transferHandlers(),
    0x01: ({ fetchWord }) => { this.#bc = fetchWord(); }, // LXI B,nn
    0x02: ({ writeByte }) => writeByte(this.#bc, this.#state.a), // STAX B
    0x03: () => { this.#bc = (this.#bc + 1) & 0xffff; }, // INX B
    0x0a: ({ readByte }) => this.#loadAccumulator(readByte(this.#bc)), // LDAX B
    0x11: ({ fetchWord }) => { this.#de = fetchWord(); }, // LXI D,nn
    0x12: ({ writeByte }) => writeByte(this.#de, this.#state.a), // STAX D
    0x13: () => { this.#de = (this.#de + 1) & 0xffff; }, // INX D
    0x1a: ({ readByte }) => this.#loadAccumulator(readByte(this.#de)), // LDAX D
    0x21: ({ fetchWord }) => { this.#hl = fetchWord(); }, // LXI H,nn
    0x22: ({ fetchWord, writeByte }) => this.#storeHl(fetchWord(), writeByte), // SHLD addr
    0x23: () => { this.#hl = (this.#hl + 1) & 0xffff; }, // INX H
    0x2a: ({ fetchWord, readByte }) => this.#loadHl(fetchWord(), readByte), // LHLD addr
    0x31: ({ fetchWord }) => { this.#state.sp = fetchWord(); }, // LXI SP,nn
    0x32: ({ fetchWord, writeByte }) => writeByte(fetchWord(), this.#state.a), // STA addr
    0x33: () => { this.#state.sp = (this.#state.sp + 1) & 0xffff; }, // INX SP
    0x3a: ({ fetchWord, readByte }) => this.#loadAccumulator(readByte(fetchWord())), // LDA addr
    0x76: () => this.#halt(), // HLT
    0xc0: ({ readByte }) => this.#return(readByte, !this.#state.flags.z), // RNZ
    0xc1: ({ readByte }) => { this.#bc = this.#popWord(readByte); }, // POP B
    0xc2: ({ fetchWord }) => this.#jump(fetchWord(), !this.#state.flags.z), // JNZ addr
    0xc3: ({ fetchWord }) => this.#jump(fetchWord()), // JMP addr
    0xc4: ({ fetchWord, writeByte }) => this.#call(fetchWord(), writeByte, !this.#state.flags.z), // CNZ addr
    0xc5: ({ writeByte }) => this.#pushWord(this.#bc, writeByte), // PUSH B
    0xc6: ({ fetchByte }) => this.#addToAccumulator(fetchByte()), // ADI n
    0xc7: ({ writeByte }) => this.#call(0x00, writeByte), // RST 0
    0xc8: ({ readByte }) => this.#return(readByte, this.#state.flags.z), // RZ
    0xc9: ({ readByte }) => this.#return(readByte), // RET
    0xca: ({ fetchWord }) => this.#jump(fetchWord(), this.#state.flags.z), // JZ addr
    0xcc: ({ fetchWord, writeByte }) => this.#call(fetchWord(), writeByte, this.#state.flags.z), // CZ addr
    0xcd: ({ fetchWord, writeByte }) => this.#call(fetchWord(), writeByte), // CALL addr
    0xcf: ({ writeByte }) => this.#call(0x08, writeByte), // RST 1
    0xd0: ({ readByte }) => this.#return(readByte, !this.#state.flags.cy), // RNC
    0xd1: ({ readByte }) => { this.#de = this.#popWord(readByte); }, // POP D
    0xd2: ({ fetchWord }) => this.#jump(fetchWord(), !this.#state.flags.cy), // JNC addr
    0xd4: ({ fetchWord, writeByte }) => this.#call(fetchWord(), writeByte, !this.#state.flags.cy), // CNC addr
    0xd5: ({ writeByte }) => this.#pushWord(this.#de, writeByte), // PUSH D
    0xd7: ({ writeByte }) => this.#call(0x10, writeByte), // RST 2
    0xd8: ({ readByte }) => this.#return(readByte, this.#state.flags.cy), // RC
    0xda: ({ fetchWord }) => this.#jump(fetchWord(), this.#state.flags.cy), // JC addr
    0xdc: ({ fetchWord, writeByte }) => this.#call(fetchWord(), writeByte, this.#state.flags.cy), // CC addr
    0xdf: ({ writeByte }) => this.#call(0x18, writeByte), // RST 3
    0xe0: ({ readByte }) => this.#return(readByte, !this.#state.flags.p), // RPO
    0xe1: ({ readByte }) => { this.#hl = this.#popWord(readByte); }, // POP H
    0xe2: ({ fetchWord }) => this.#jump(fetchWord(), !this.#state.flags.p), // JPO addr
    0xe3: (instruction) => this.#exchangeStack(instruction), // XTHL
    0xe4: ({ fetchWord, writeByte }) => this.#call(fetchWord(), writeByte, !this.#state.flags.p), // CPO addr
    0xe5: ({ writeByte }) => this.#pushWord(this.#hl, writeByte), // PUSH H
    0xe7: ({ writeByte }) => this.#call(0x20, writeByte), // RST 4
    0xe8: ({ readByte }) => this.#return(readByte, this.#state.flags.p), // RPE
    0xe9: () => this.#jump(this.#hl), // PCHL
    0xea: ({ fetchWord }) => this.#jump(fetchWord(), this.#state.flags.p), // JPE addr
    0xeb: () => this.#exchangeDeHl(), // XCHG
    0xec: ({ fetchWord, writeByte }) => this.#call(fetchWord(), writeByte, this.#state.flags.p), // CPE addr
    0xef: ({ writeByte }) => this.#call(0x28, writeByte), // RST 5
    0xf0: ({ readByte }) => this.#return(readByte, !this.#state.flags.s), // RP
    0xf2: ({ fetchWord }) => this.#jump(fetchWord(), !this.#state.flags.s), // JP addr
    0xf4: ({ fetchWord, writeByte }) => this.#call(fetchWord(), writeByte, !this.#state.flags.s), // CP addr
    0xf7: ({ writeByte }) => this.#call(0x30, writeByte), // RST 6
    0xf8: ({ readByte }) => this.#return(readByte, this.#state.flags.s), // RM
    0xf9: () => { this.#state.sp = this.#hl; }, // SPHL
    0xfa: ({ fetchWord }) => this.#jump(fetchWord(), this.#state.flags.s), // JM addr
    0xfc: ({ fetchWord, writeByte }) => this.#call(fetchWord(), writeByte, this.#state.flags.s), // CM addr
    0xff: ({ writeByte }) => this.#call(0x38, writeByte), // RST 7
  };

  constructor(ram: Ram, initialState: Omit<Cpu8080Snapshot, "bc" | "de" | "hl">) {
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
    return { ...copyState(this.#state), bc: this.#bc, de: this.#de, hl: this.#hl };
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
      ? { ...record, outcome: this.#state.halted ? "halted" : "executed" }
      : { ...record, outcome: "unsupported", reason: "opcode" };
  }

  #registerOperand(name: ByteRegister): ByteOperand {
    return {
      read: () => this.#state[name],
      write: (_instruction, value) => { this.#state[name] = value; },
    };
  }

  #transferHandlers(): Partial<Record<number, OpcodeHandler>> {
    const handlers: Partial<Record<number, OpcodeHandler>> = {};
    for (const [destinationCode, destination] of this.#byteOperands.entries()) {
      handlers[0x06 | (destinationCode << 3)] = instruction =>
        destination.write(instruction, instruction.fetchByte()); // MVI r,n
      for (const [sourceCode, source] of this.#byteOperands.entries()) {
        const opcode = 0x40 | (destinationCode << 3) | sourceCode;
        if (opcode === 0x76) continue; // HLT occupies the otherwise unused MOV M,M slot.
        handlers[opcode] = instruction => destination.write(instruction, source.read(instruction));
      }
    }
    return handlers;
  }

  get #bc(): number {
    return (this.#state.b << 8) | this.#state.c;
  }

  set #bc(value: number) {
    this.#state.b = value >>> 8;
    this.#state.c = value & 0xff;
  }

  get #de(): number {
    return (this.#state.d << 8) | this.#state.e;
  }

  set #de(value: number) {
    this.#state.d = value >>> 8;
    this.#state.e = value & 0xff;
  }

  get #hl(): number {
    return (this.#state.h << 8) | this.#state.l;
  }

  set #hl(value: number) {
    this.#state.h = value >>> 8;
    this.#state.l = value & 0xff;
  }

  #loadHl(address: number, readByte: InstructionContext["readByte"]): void {
    const low = readByte(address);
    const high = readByte((address + 1) & 0xffff);
    this.#hl = low | (high << 8);
  }

  #storeHl(address: number, writeByte: InstructionContext["writeByte"]): void {
    writeByte(address, this.#state.l);
    writeByte((address + 1) & 0xffff, this.#state.h);
  }

  #exchangeDeHl(): void {
    const de = this.#de;
    this.#de = this.#hl;
    this.#hl = de;
  }

  #exchangeStack({ readByte, writeByte }: InstructionContext): void {
    const address = this.#state.sp;
    const highAddress = (address + 1) & 0xffff;
    const low = readByte(address);
    const high = readByte(highAddress);
    writeByte(highAddress, this.#state.h);
    writeByte(address, this.#state.l);
    this.#hl = low | (high << 8);
  }

  #jump(address: number, take = true): void {
    if (take) this.#state.pc = address;
  }

  #call(address: number, writeByte: InstructionContext["writeByte"], take = true): void {
    if (!take) return;
    // Instruction fetching has already advanced PC to the return address.
    this.#pushWord(this.#state.pc, writeByte);
    this.#state.pc = address;
  }

  #return(readByte: InstructionContext["readByte"], take = true): void {
    if (take) this.#state.pc = this.#popWord(readByte);
  }

  #pushWord(value: number, writeByte: InstructionContext["writeByte"]): void {
    this.#state.sp = (this.#state.sp - 1) & 0xffff;
    writeByte(this.#state.sp, value >>> 8);
    this.#state.sp = (this.#state.sp - 1) & 0xffff;
    writeByte(this.#state.sp, value & 0xff);
  }

  #popWord(readByte: InstructionContext["readByte"]): number {
    const low = readByte(this.#state.sp);
    this.#state.sp = (this.#state.sp + 1) & 0xffff;
    const high = readByte(this.#state.sp);
    this.#state.sp = (this.#state.sp + 1) & 0xffff;
    return low | (high << 8);
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
