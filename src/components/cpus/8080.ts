import type { Ram } from "../memory/ram.js";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import { defineState, copyState, readState, unsigned, flag, boolean, group } from "./state.ts";
import type { StateDescription } from "./state.js";
import { add8, evenParity8 } from "./alu.ts";

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

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu8080StateDescription = defineState({
  a: unsigned(8), b: unsigned(8), c: unsigned(8), d: unsigned(8), e: unsigned(8), h: unsigned(8), l: unsigned(8),
  pc: unsigned(16), sp: unsigned(16),
  flags: group({ s: flag, z: flag, ac: flag, p: flag, cy: flag }),
  interruptEnabled: boolean, halted: boolean,
} satisfies StateDescription<Cpu8080State>);

export type Cpu8080Snapshot = Readonly<Omit<Cpu8080State, "flags">> & {
  readonly flags: Readonly<Cpu8080Flags>;
  readonly bc: number;
  readonly de: number;
  readonly hl: number;
};

export type Cpu8080MemoryAccess = MemoryAccess;

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

interface WordOperand {
  readonly read: () => number;
  readonly write: (value: number) => void;
}

/** Instruction-level Intel 8080 subset for the 8080 examples. */
export class Cpu8080 {
  readonly #ram: Ram;
  readonly #state: Cpu8080State;

  constructor(ram: Ram, initialState: Omit<Cpu8080Snapshot, "bc" | "de" | "hl">) {
    if (ram.size !== 0x10000) {
      throw new RangeError("The 8080 model requires exactly 64 KiB of RAM.");
    }
    this.#ram = ram;
    this.#state = readState(cpu8080StateDescription, initialState);
  }

  /** Inspect a detached copy, readonly to TypeScript, without accessing RAM. */
  snapshot(): Cpu8080Snapshot {
    return { ...copyState(cpu8080StateDescription, this.#state), bc: this.#bc, de: this.#de, hl: this.#hl };
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

    const { accesses, readByte, writeByte } = recordMemory(this.#ram);
    const address = this.#state.pc;
    const opcode = readByte(address);
    const bytes = [opcode];
    const handler = this.#opcodeHandlers[opcode];
    if (handler) {
      // Advance only for supported instructions; operand fetches advance themselves.
      this.#state.pc = (address + 1) & 0xffff;
      const fetchByte = (): number => {
        const pc = this.#state.pc;
        const byte = readByte(pc);
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
        readByte,
        writeByte,
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

  // Register and flag views.

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

  get #psw(): number {
    const { a, flags } = this.#state;
    // A is the high byte; the low byte is S Z 0 AC 0 P 1 CY.
    return (a << 8) | (Number(flags.s) << 7) | (Number(flags.z) << 6)
      | (Number(flags.ac) << 4) | (Number(flags.p) << 2) | 0x02 | Number(flags.cy);
  }

  set #psw(value: number) {
    this.#state.a = value >>> 8;
    this.#state.flags = {
      s: (value & 0x80) !== 0, z: (value & 0x40) !== 0,
      ac: (value & 0x10) !== 0, p: (value & 0x04) !== 0, cy: (value & 0x01) !== 0,
    };
  }

  // Opcode selectors and construction.

  #registerOperand(name: ByteRegister): ByteOperand {
    return {
      read: () => this.#state[name],
      write: (_instruction, value) => { this.#state[name] = value; },
    };
  }

  // Three-bit byte-register selector; M denotes the memory byte at HL.
  readonly #byteOperands: readonly ByteOperand[] = [
    this.#registerOperand("b"), // 000 B
    this.#registerOperand("c"), // 001 C
    this.#registerOperand("d"), // 010 D
    this.#registerOperand("e"), // 011 E
    this.#registerOperand("h"), // 100 H
    this.#registerOperand("l"), // 101 L
    { // 110 M
      read: ({ readByte }) => readByte(this.#hl),
      write: ({ writeByte }, value) => writeByte(this.#hl, value),
    },
    this.#registerOperand("a"), // 111 A
  ];
  // Two-bit pair selector; 11 is supplied by each family (SP or PSW).
  readonly #registerPairs: readonly WordOperand[] = [
    { read: () => this.#bc, write: value => { this.#bc = value; } }, // 00 BC
    { read: () => this.#de, write: value => { this.#de = value; } }, // 01 DE
    { read: () => this.#hl, write: value => { this.#hl = value; } }, // 10 HL
  ];

  // Word operations use SP for pp=11; stack operations use PSW instead.
  readonly #wordOperands: readonly WordOperand[] = [
    ...this.#registerPairs,
    { read: () => this.#state.sp, write: value => { this.#state.sp = value; } }, // 11 SP
  ];
  readonly #stackOperands: readonly WordOperand[] = [
    ...this.#registerPairs,
    { read: () => this.#psw, write: value => { this.#psw = value; } }, // 11 PSW
  ];

  // Three-bit ALU selector, shared by register/memory and immediate forms.
  // These closures read state at execution; CMP updates flags but retains A.
  readonly #aluOperations: readonly ((value: number) => number)[] = [
    value => this.#add(value), // 000 ADD / ADI
    value => this.#add(value, this.#state.flags.cy ? 1 : 0), // 001 ADC / ACI
    value => this.#subtract(value), // 010 SUB / SUI
    value => this.#subtract(value, Number(this.#state.flags.cy)), // 011 SBB / SBI
    value => this.#and(value), // 100 ANA / ANI
    value => this.#xor(value), // 101 XRA / XRI
    value => this.#or(value), // 110 ORA / ORI
    value => this.#compare(value), // 111 CMP / CPI
  ];

  // ccc = ff v: ff selects Z, CY, P, S; v is the required flag value (0 or 1).
  // Predicates read flags at execution.
  readonly #conditions: readonly (() => boolean)[] = [
    () => !this.#state.flags.z, // 00 0: NZ
    () => this.#state.flags.z, // 00 1: Z
    () => !this.#state.flags.cy, // 01 0: NC
    () => this.#state.flags.cy, // 01 1: C
    () => !this.#state.flags.p, // 10 0: PO
    () => this.#state.flags.p, // 10 1: PE
    () => !this.#state.flags.s, // 11 0: P
    () => this.#state.flags.s, // 11 1: M
  ];

  // Opcode bits: 7 6 | 5 4 3 | 2 1 0 = xx yyy zzz.
  // xx selects a block below; the roles of yyy and zzz depend on that block.
  // yyy can select a byte register, ALU operation, condition, or restart vector.
  // For pair families, split yyy into pp q: pp selects a pair, q an operation.
  // Binary separators follow these fields; repeated letters below mark selectors.
  // Only documented, implemented encodings enter the table.
  readonly #opcodeHandlers: Readonly<Partial<Record<number, OpcodeHandler>>> = {
    // xx = 00: zzz selects the family; yyy selects its register or operation.
    0b00_000_000: () => {}, // NOP; other 00 yyy 000 encodings are undocumented.

    // 00 pp q 001: q=0 LXI, q=1 DAD.
    ...this.#loadAddWordHandlers(),

    // 00 pp q 010: q=0 store, q=1 load.
    // pp=00/01: A through BC/DE; pp=10/11: HL/A at a direct address operand.
    0b00_00_0_010: ({ writeByte }) => writeByte(this.#bc, this.#state.a), // STAX B
    0b00_00_1_010: ({ readByte }) => this.#loadAccumulator(readByte(this.#bc)), // LDAX B
    0b00_01_0_010: ({ writeByte }) => writeByte(this.#de, this.#state.a), // STAX D
    0b00_01_1_010: ({ readByte }) => this.#loadAccumulator(readByte(this.#de)), // LDAX D
    0b00_10_0_010: ({ fetchWord, writeByte }) => this.#storeHl(fetchWord(), writeByte), // SHLD addr
    0b00_10_1_010: ({ fetchWord, readByte }) => this.#loadHl(fetchWord(), readByte), // LHLD addr
    0b00_11_0_010: ({ fetchWord, writeByte }) => writeByte(fetchWord(), this.#state.a), // STA addr
    0b00_11_1_010: ({ fetchWord, readByte }) => this.#loadAccumulator(readByte(fetchWord())), // LDA addr

    // 00 pp q 011: q=0 INX, q=1 DCX.
    ...this.#incrementDecrementWordHandlers(),

    // 00 ddd 100: INR; ddd selects the destination byte operand.
    ...this.#incrementByteHandlers(),

    // 00 ddd 101: DCR.
    ...this.#decrementByteHandlers(),

    // 00 ddd 110: MVI.
    ...this.#immediateLoadHandlers(),

    // 00 ooo 111: ooo selects an accumulator/carry operation (a separate selector from ALU ooo).
    0b00_000_111: () => this.#rotateLeft(this.#state.a >>> 7), // RLC
    0b00_001_111: () => this.#rotateRight(this.#state.a & 1), // RRC
    0b00_010_111: () => this.#rotateLeft(Number(this.#state.flags.cy)), // RAL
    0b00_011_111: () => this.#rotateRight(Number(this.#state.flags.cy)), // RAR
    0b00_100_111: () => this.#decimalAdjust(), // DAA
    0b00_101_111: () => { this.#state.a ^= 0xff; }, // CMA
    0b00_110_111: () => { this.#state.flags.cy = true; }, // STC
    0b00_111_111: () => { this.#state.flags.cy = !this.#state.flags.cy; }, // CMC

    // xx = 01: 01 ddd sss moves source sss to destination ddd.
    ...this.#moveHandlers(),
    0b01_110_110: () => this.#halt(), // HLT replaces MOV M,M (ddd=sss=110).

    // xx = 10: 10 ooo sss applies ALU operation ooo to source sss and A.
    ...this.#registerAluHandlers(),

    // xx = 11: zzz selects control flow, stack operations, or immediate ALU.
    // 11 ccc 000: conditional RET; ccc selects the condition.
    ...this.#conditionalReturnHandlers(),

    // 11 pp q 001: q=0 POP; pp selects BC, DE, HL, PSW.
    ...this.#popHandlers(),
    // q=1 selects these operations instead; pp=01 is undocumented.
    0b11_00_1_001: ({ readByte }) => this.#return(readByte), // RET
    0b11_10_1_001: () => this.#jump(this.#hl), // PCHL
    0b11_11_1_001: () => { this.#state.sp = this.#hl; }, // SPHL

    // 11 ccc 010: conditional JMP.
    ...this.#conditionalJumpHandlers(),

    // 11 yyy 011: miscellaneous operations selected by yyy.
    // 001 is undocumented; 010/011 (OUT/IN) and 110/111 (DI/EI) are deferred.
    0b11_000_011: ({ fetchWord }) => this.#jump(fetchWord()), // JMP addr
    0b11_100_011: (instruction) => this.#exchangeStack(instruction), // XTHL
    0b11_101_011: () => this.#exchangeDeHl(), // XCHG

    // 11 ccc 100: conditional CALL.
    ...this.#conditionalCallHandlers(),

    // 11 pp q 101: q=0 PUSH; pp selects BC, DE, HL, PSW.
    ...this.#pushHandlers(),
    // q=1 selects CALL instead; only pp=00 is documented.
    0b11_00_1_101: ({ fetchWord, writeByte }) => this.#call(fetchWord(), writeByte), // CALL addr

    // 11 ooo 110: same ALU selector as 10 ooo sss, with an immediate byte.
    ...this.#immediateAluHandlers(),

    // 11 nnn 111: call the vector at nnn * 8.
    ...this.#restartHandlers(),
  };

  // Family builders follow the opcode table's xx/zzz order.

  #loadAddWordHandlers(): Partial<Record<number, OpcodeHandler>> {
    // 00 pp q 001: pp selects BC, DE, HL, SP; q=0 LXI, q=1 DAD.
    const handlers: Partial<Record<number, OpcodeHandler>> = {};
    for (const [pairCode, operand] of this.#wordOperands.entries()) {
      handlers[0b00_00_0_001 | (pairCode << 4)] = ({ fetchWord }) => operand.write(fetchWord());
      handlers[0b00_00_1_001 | (pairCode << 4)] = () => this.#addToHl(operand.read());
    }
    return handlers;
  }

  #incrementDecrementWordHandlers(): Partial<Record<number, OpcodeHandler>> {
    // 00 pp q 011: pp selects BC, DE, HL, SP; q=0 INX, q=1 DCX.
    const handlers: Partial<Record<number, OpcodeHandler>> = {};
    for (const [pairCode, operand] of this.#wordOperands.entries()) {
      handlers[0b00_00_0_011 | (pairCode << 4)] = () => operand.write((operand.read() + 1) & 0xffff);
      handlers[0b00_00_1_011 | (pairCode << 4)] = () => operand.write((operand.read() - 1) & 0xffff);
    }
    return handlers;
  }

  #incrementByteHandlers(): Partial<Record<number, OpcodeHandler>> {
    // 00 ddd 100: INR; ddd selects #byteOperands.
    const handlers: Partial<Record<number, OpcodeHandler>> = {};
    for (const [operandCode, operand] of this.#byteOperands.entries()) {
      handlers[0b00_000_100 | (operandCode << 3)] = instruction =>
        operand.write(instruction, this.#increment(operand.read(instruction)));
    }
    return handlers;
  }

  #decrementByteHandlers(): Partial<Record<number, OpcodeHandler>> {
    // 00 ddd 101: DCR; ddd selects #byteOperands.
    const handlers: Partial<Record<number, OpcodeHandler>> = {};
    for (const [operandCode, operand] of this.#byteOperands.entries()) {
      handlers[0b00_000_101 | (operandCode << 3)] = instruction =>
        operand.write(instruction, this.#decrement(operand.read(instruction)));
    }
    return handlers;
  }

  #immediateLoadHandlers(): Partial<Record<number, OpcodeHandler>> {
    // 00 ddd 110: MVI; ddd selects #byteOperands.
    const handlers: Partial<Record<number, OpcodeHandler>> = {};
    for (const [operandCode, operand] of this.#byteOperands.entries()) {
      handlers[0b00_000_110 | (operandCode << 3)] = instruction =>
        operand.write(instruction, instruction.fetchByte());
    }
    return handlers;
  }

  #moveHandlers(): Partial<Record<number, OpcodeHandler>> {
    // 01 ddd sss: both fields use the three-bit #byteOperands selector.
    const handlers: Partial<Record<number, OpcodeHandler>> = {};
    for (const [destinationCode, destination] of this.#byteOperands.entries()) {
      for (const [sourceCode, source] of this.#byteOperands.entries()) {
        const opcode = 0b01_000_000 | (destinationCode << 3) | sourceCode;
        if (opcode === 0b01_110_110) continue; // HLT occupies the MOV M,M slot.
        handlers[opcode] = instruction => destination.write(instruction, source.read(instruction));
      }
    }
    return handlers;
  }

  #registerAluHandlers(): Partial<Record<number, OpcodeHandler>> {
    // 10 ooo sss: ooo selects #aluOperations; sss selects #byteOperands.
    const handlers: Partial<Record<number, OpcodeHandler>> = {};
    for (const [operationCode, operation] of this.#aluOperations.entries()) {
      for (const [sourceCode, source] of this.#byteOperands.entries()) {
        handlers[0b10_000_000 | (operationCode << 3) | sourceCode] = instruction => {
          this.#state.a = operation(source.read(instruction));
        };
      }
    }
    return handlers;
  }

  #conditionalReturnHandlers(): Partial<Record<number, OpcodeHandler>> {
    // 11 ccc 000: conditional RET; ccc selects #conditions.
    const handlers: Partial<Record<number, OpcodeHandler>> = {};
    for (const [conditionCode, condition] of this.#conditions.entries()) {
      handlers[0b11_000_000 | (conditionCode << 3)] = ({ readByte }) =>
        this.#return(readByte, condition());
    }
    return handlers;
  }

  #popHandlers(): Partial<Record<number, OpcodeHandler>> {
    // 11 pp 0 001: POP; pp selects BC, DE, HL, PSW.
    const handlers: Partial<Record<number, OpcodeHandler>> = {};
    for (const [pairCode, operand] of this.#stackOperands.entries()) {
      handlers[0b11_00_0_001 | (pairCode << 4)] = ({ readByte }) =>
        operand.write(this.#popWord(readByte));
    }
    return handlers;
  }

  #conditionalJumpHandlers(): Partial<Record<number, OpcodeHandler>> {
    // 11 ccc 010: conditional JMP; ccc selects #conditions.
    const handlers: Partial<Record<number, OpcodeHandler>> = {};
    for (const [conditionCode, condition] of this.#conditions.entries()) {
      handlers[0b11_000_010 | (conditionCode << 3)] = ({ fetchWord }) =>
        this.#jump(fetchWord(), condition());
    }
    return handlers;
  }

  #conditionalCallHandlers(): Partial<Record<number, OpcodeHandler>> {
    // 11 ccc 100: conditional CALL; ccc selects #conditions.
    const handlers: Partial<Record<number, OpcodeHandler>> = {};
    for (const [conditionCode, condition] of this.#conditions.entries()) {
      handlers[0b11_000_100 | (conditionCode << 3)] = ({ fetchWord, writeByte }) =>
        this.#call(fetchWord(), writeByte, condition());
    }
    return handlers;
  }

  #pushHandlers(): Partial<Record<number, OpcodeHandler>> {
    // 11 pp 0 101: PUSH; pp selects BC, DE, HL, PSW.
    const handlers: Partial<Record<number, OpcodeHandler>> = {};
    for (const [pairCode, operand] of this.#stackOperands.entries()) {
      handlers[0b11_00_0_101 | (pairCode << 4)] = ({ writeByte }) =>
        this.#pushWord(operand.read(), writeByte);
    }
    return handlers;
  }

  #immediateAluHandlers(): Partial<Record<number, OpcodeHandler>> {
    // 11 ooo 110: the same #aluOperations selector, with a fetched operand.
    const handlers: Partial<Record<number, OpcodeHandler>> = {};
    for (const [operationCode, operation] of this.#aluOperations.entries()) {
      handlers[0b11_000_110 | (operationCode << 3)] = ({ fetchByte }) => {
        this.#state.a = operation(fetchByte());
      };
    }
    return handlers;
  }

  #restartHandlers(): Partial<Record<number, OpcodeHandler>> {
    const handlers: Partial<Record<number, OpcodeHandler>> = {};
    // RST: 11 nnn 111; nnn selects the vector at nnn * 8.
    for (let vectorCode = 0; vectorCode < 8; vectorCode++) {
      handlers[0b11_000_111 | (vectorCode << 3)] = ({ writeByte }) =>
        this.#call(vectorCode << 3, writeByte);
    }
    return handlers;
  }

  // Loads, stores, and exchanges.

  #loadAccumulator(value: number): void {
    this.#state.a = value;
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

  // Control flow and stack operations.

  #halt(): void {
    this.#state.halted = true;
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

  // Arithmetic, logic, and flags.

  #add(value: number, carryIn: 0 | 1 = 0): number {
    const { result, halfCarry, carry } = add8(this.#state.a, value, carryIn);
    return this.#aluResult(result, halfCarry, carry);
  }

  #subtract(value: number, borrow = 0): number {
    const accumulator = this.#state.a;
    const difference = accumulator - value - borrow;
    // The 8080 complements the adder's full carry for subtraction, but not AC.
    return this.#aluResult(difference, (accumulator & 0x0f) >= (value & 0x0f) + borrow, difference < 0);
  }

  #and(value: number): number {
    const accumulator = this.#state.a;
    // ANA clears CY; AC is bit 3 of A OR the operand.
    return this.#aluResult(accumulator & value, ((accumulator | value) & 0x08) !== 0, false);
  }

  #xor(value: number): number {
    return this.#aluResult(this.#state.a ^ value, false, false);
  }

  #or(value: number): number {
    return this.#aluResult(this.#state.a | value, false, false);
  }

  #compare(value: number): number {
    this.#subtract(value);
    // Use subtraction's flags, but retain A as the ALU result.
    return this.#state.a;
  }

  #increment(value: number): number {
    return this.#aluResult(value + 1, (value & 0x0f) === 0x0f, this.#state.flags.cy);
  }

  #decrement(value: number): number {
    // As with SUB, AC is the inverse of the low-nibble borrow; CY is preserved.
    return this.#aluResult(value - 1, (value & 0x0f) !== 0, this.#state.flags.cy);
  }

  #addToHl(value: number): void {
    const sum = this.#hl + value;
    this.#hl = sum & 0xffff;
    this.#state.flags.cy = sum > 0xffff;
  }

  #decimalAdjust(): void {
    const accumulator = this.#state.a;
    const low = accumulator & 0x0f;
    const lowCorrection = low > 9 || this.#state.flags.ac ? 0x06 : 0;
    // Select both corrections from the original state; preserve incoming CY.
    const cy = accumulator > 0x99 || this.#state.flags.cy;
    const correction = lowCorrection + (cy ? 0x60 : 0);
    this.#state.a = this.#aluResult(accumulator + correction, low + lowCorrection > 0x0f, cy);
  }

  #rotateLeft(lowBit: number): void {
    const accumulator = this.#state.a;
    this.#state.a = ((accumulator << 1) & 0xff) | lowBit;
    this.#state.flags.cy = (accumulator & 0x80) !== 0;
  }

  #rotateRight(highBit: number): void {
    const accumulator = this.#state.a;
    this.#state.a = (accumulator >>> 1) | (highBit << 7);
    this.#state.flags.cy = (accumulator & 1) !== 0;
  }

  #aluResult(value: number, ac: boolean, cy: boolean): number {
    const result = value & 0xff;
    this.#state.flags = {
      s: (result & 0x80) !== 0,
      z: result === 0,
      ac,
      p: evenParity8(result),
      cy,
    };
    return result;
  }
}
