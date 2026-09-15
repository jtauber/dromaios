import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition, InstructionStep } from "./execution-records.ts";
import { signed8 } from "./binary.ts";
import { recordMemory } from "./memory-access.ts";
import type { ByteMemory, MemoryAccess, RecordedMemory } from "./memory-access.ts";
import { defineState, copyState, readState, unsigned, flag, group } from "./state.ts";
import type { StateValues, ReadonlyState } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.ts";
import { motorolaConditions } from "./motorola.ts";
import { add, subtract } from "./alu.ts";

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

export type Cpu68000Snapshot = ReadonlyState<Cpu68000State> & {
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

export type Cpu68000StepRecord = InstructionStep<Cpu68000Snapshot> | (StateTransition<Cpu68000Snapshot> & {
  readonly outcome: "unsupported"; readonly reason: "unaligned-address";
  readonly instruction: Cpu68000Instruction | null; readonly fault: Cpu68000AlignmentFault;
});

export type Cpu68000ResetRecord = StateTransition<Cpu68000Snapshot>;

interface InstructionContext extends ByteMemory {
  readonly nextAddress: () => number;
  readonly jump: (address: number) => void;
  readonly fetchWord: () => number;
  readonly fetchLong: () => number;
}

type OpcodeHandler = (cpu: Cpu68000, instruction: InstructionContext) => Cpu68000AlignmentFault | void;
type ControlOperation = (cpu: Cpu68000, address: number, instruction: InstructionContext) => Cpu68000AlignmentFault | void;
type DataRegister = `d${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`;
type AddressRegister = `a${0 | 1 | 2 | 3 | 4 | 5 | 6}` | "usp" | "ssp";
type OperandSize = 8 | 16 | 32;
// A result requests writeback; comparisons and tests update flags and return nothing.
type AluOperation = (cpu: Cpu68000, size: OperandSize, left: number, right: number) => number | void;
// The EA field's role and permitted set; only plain sources allow An (word/long).
type AluAddressing = "source" | "data-source" | "memory-destination" | "data-destination";
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
    // Fetching and jumps share a local cursor; only a successful instruction commits PC.
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
      jump: target => { cursor = target; },
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
  static readonly #sizes = [8, 16, 32, undefined] as const;
  static readonly #immediateBytes = Array.from({ length: 0x100 }, (_, value) => value);

  // cccc condition encodings. BRA uses T; BSR replaces F in the branch family.
  // DBcc and Scc use all sixteen tests directly; DBF is also called DBRA.
  // The shared Motorola table orders T/F, HI/LS, CC/CS, NE/EQ, VC/VS, PL/MI, GE/LT, GT/LE.
  // Bind encodings once per model; handlers receive the executing CPU and capture no instance state.
  static readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    // Immediate ALU: 0000 ooo 0 ss mmm rrr. ooo selects the operation below;
    // ss=00 byte, 01 word, 10 long (11 reserved); mmm rrr selects a data-alterable EA.
    // An, PC-relative, and immediate destinations are excluded, including CCR/SR encodings.
    ...this.#immediateHandlers("0000 000 0 ss mmm rrr", (cpu, size, left, right) => cpu.#logic(size, left | right)), // ORI #n,<ea>
    ...this.#immediateHandlers("0000 001 0 ss mmm rrr", (cpu, size, left, right) => cpu.#logic(size, left & right)), // ANDI #n,<ea>
    ...this.#immediateHandlers("0000 010 0 ss mmm rrr", (cpu, size, left, right) => cpu.#subtract(size, left, right)), // SUBI #n,<ea>
    ...this.#immediateHandlers("0000 011 0 ss mmm rrr", (cpu, size, left, right) => cpu.#add(size, left, right)), // ADDI #n,<ea>
    ...this.#immediateHandlers("0000 101 0 ss mmm rrr", (cpu, size, left, right) => cpu.#logic(size, left ^ right)), // EORI #n,<ea>
    ...this.#immediateHandlers("0000 110 0 ss mmm rrr", (cpu, size, left, right) => { cpu.#compare(size, left, right); }), // CMPI #n,<ea>

    // MOVE: 00 zz ddd mmm sss rrr. zz=01 byte, 10 long, 11 word.
    // Destination is register ddd then mode mmm; source is mode sss then register rrr.
    // Destination mode 001 is MOVEA (word/long only), with sign extension and no flag changes.
    ...this.#moveHandlers("00 01 ddd mmm sss rrr", 8), // MOVE.B <ea>,<ea>
    ...this.#moveHandlers("00 10 ddd mmm sss rrr", 32), // MOVE.L / MOVEA.L <ea>,<ea>
    ...this.#moveHandlers("00 11 ddd mmm sss rrr", 16), // MOVE.W / MOVEA.W <ea>,<ea>

    // Unary ALU: 0100 oooo ss mmm rrr. ss=00 byte, 01 word, 10 long;
    // mmm rrr selects a data-alterable EA, even for TST on the original 68000.
    // ss=11 belongs to status transfers, TAS, or other instructions, not this family.
    ...this.#unaryHandlers("0100 0000 ss mmm rrr", (cpu, size, value) => cpu.#negateExtended(size, value)), // NEGX <ea>
    ...this.#unaryHandlers("0100 0010 ss mmm rrr", (cpu, size) => cpu.#logic(size, 0)), // CLR <ea>
    ...this.#unaryHandlers("0100 0100 ss mmm rrr", (cpu, size, value) => cpu.#subtract(size, 0, value)), // NEG <ea>
    ...this.#unaryHandlers("0100 0110 ss mmm rrr", (cpu, size, value) => cpu.#logic(size, value ^ (2 ** size - 1))), // NOT <ea>
    ...this.#unaryHandlers("0100 1010 ss mmm rrr", (cpu, size, value) => { cpu.#setResultFlags(value, size); }), // TST <ea>

    // Control EAs: mmm rrr permits (An), displacement/index, absolute, and PC-relative;
    // register-direct, postincrement, predecrement, and immediate are excluded.
    // 0100 aaa 111 mmm rrr: aaa selects the address register receiving the EA itself.
    ...this.#leaHandlers("0100 aaa 111 mmm rrr"), // LEA <ea>,An
    ...this.#controlHandlers("0100 1000 01 mmm rrr", (cpu, address, instruction) => cpu.#pushLong(address, instruction)), // PEA <ea>

    // MOVEM: 0100 1 d 00 1 s mmm rrr. d=0 registers to memory, 1 memory to registers;
    // s=0 word, 1 long. Stores permit alterable control EAs plus -(An);
    // loads permit all control EAs plus (An)+. The next word is the register mask.
    ...this.#movemHandlers("0100 1 d 00 1 s mmm rrr"), // MOVEM.W/L <list>,<ea> / <ea>,<list>

    // 0100 1110 0101 u rrr: rrr selects An; u=0 LINK (signed word allocation), 1 UNLK.
    ...opcodeFamily("0100 1110 0101 0 rrr", { r: this.#selectors }, ({ r }) => (cpu: Cpu68000, instruction: InstructionContext) => cpu.#link(r, instruction)), // LINK An,#d16
    ...opcodeFamily("0100 1110 0101 1 rrr", { r: this.#selectors }, ({ r }) => (cpu: Cpu68000, instruction: InstructionContext) => cpu.#unlink(r, instruction)), // UNLK An
    ...opcodePattern("0100 1110 0111 0101", (cpu: Cpu68000, instruction: InstructionContext) => cpu.#returnFromSubroutine(instruction)), // RTS
    // 0100 1110 1 j mmm rrr: j=0 JSR pushes the return PC; j=1 JMP transfers directly.
    ...this.#controlHandlers("0100 1110 10 mmm rrr", (cpu, address, instruction) => cpu.#call(address, instruction)), // JSR <ea>
    ...this.#controlHandlers("0100 1110 11 mmm rrr", (cpu, address, instruction) => cpu.#jump(address, instruction)), // JMP <ea>

    // Quick ALU: 0101 qqq d ss mmm rrr. qqq=000 means 8, otherwise 1..7;
    // d=0 ADDQ, 1 SUBQ; ss=00 byte, 01 word, 10 long. An allows word/long,
    // always operates on all 32 bits, and preserves flags. Other EAs are data-alterable.
    ...this.#quickHandlers("0101 qqq 0 ss mmm rrr", 1), // ADDQ #n,<ea>
    ...this.#quickHandlers("0101 qqq 1 ss mmm rrr", -1), // SUBQ #n,<ea>
    // ss=11 repurposes bits 11..8 as cccc: 0101 cccc 11 mmm rrr is Scc.
    // Scc writes a condition byte to a data-alterable EA; mmm=001 instead selects DBcc.
    ...this.#conditionHandlers("0101 cccc 11 mmm rrr"), // Scc <ea>
    // 0101 cccc 11001 rrr: cccc is the termination condition; rrr selects Dn.W.
    // The following signed word is relative to the extension word's address.
    ...opcodeFamily("0101 cccc 11001 rrr", { c: motorolaConditions, r: this.#dataRegisters }, ({ c: test, r: register }) => (cpu: Cpu68000, instruction: InstructionContext) => cpu.#decrementBranch(register, test(cpu.#state.flags), instruction)), // DBcc Dn,<label>

    // 0110 cccc dddddddd: cccc=0000 BRA, 0001 BSR, otherwise Bcc using the tests above.
    // d is a signed byte; 00 fetches a signed word. FF remains -1 on the original 68000.
    ...this.#branchHandlers("0110 cccc dddddddd"), // BRA / BSR / Bcc <label>

    // 0111 rrr 0 iiiiiiii: rrr selects Dn; i is the signed immediate byte, extended to a long.
    // Bit 8 must be zero. Immediate values select handlers but do not add coverage forms.
    ...opcodeFamily("0111 rrr 0 iiiiiiii", { r: this.#dataRegisters, i: this.#immediateBytes }, ({ r: register, i: value }) => (cpu: Cpu68000) => cpu.#loadQuickRegister(register, value)), // MOVEQ #n,Dn

    // Data ALU: oooo rrr d ss mmm eee. rrr selects Dn; ss=00 byte, 01 word, 10 long.
    // d=0 reads EA into arithmetic/logic on Dn; d=1 reads/modifies/writes EA using Dn.
    // Data sources exclude An; plain sources permit An for word/long. Destinations
    // allow alterable memory, with Dn also allowed for EOR's data-destination form.
    ...this.#dataAluHandlers("1000 rrr 0 ss mmm eee", "data-source", (cpu, size, left, right) => cpu.#logic(size, left | right)), // OR <ea>,Dn
    ...this.#dataAluHandlers("1000 rrr 1 ss mmm eee", "memory-destination", (cpu, size, left, right) => cpu.#logic(size, left | right)), // OR Dn,<ea>
    ...this.#dataAluHandlers("1001 rrr 0 ss mmm eee", "source", (cpu, size, left, right) => cpu.#subtract(size, left, right)), // SUB <ea>,Dn
    ...this.#dataAluHandlers("1001 rrr 1 ss mmm eee", "memory-destination", (cpu, size, left, right) => cpu.#subtract(size, left, right)), // SUB Dn,<ea>
    ...this.#dataAluHandlers("1011 rrr 0 ss mmm eee", "source", (cpu, size, left, right) => { cpu.#compare(size, left, right); }), // CMP <ea>,Dn
    ...this.#dataAluHandlers("1011 rrr 1 ss mmm eee", "data-destination", (cpu, size, left, right) => cpu.#logic(size, left ^ right)), // EOR Dn,<ea>
    ...this.#dataAluHandlers("1100 rrr 0 ss mmm eee", "data-source", (cpu, size, left, right) => cpu.#logic(size, left & right)), // AND <ea>,Dn
    ...this.#dataAluHandlers("1100 rrr 1 ss mmm eee", "memory-destination", (cpu, size, left, right) => cpu.#logic(size, left & right)), // AND Dn,<ea>
    ...this.#dataAluHandlers("1101 rrr 0 ss mmm eee", "source", (cpu, size, left, right) => cpu.#add(size, left, right)), // ADD <ea>,Dn
    ...this.#dataAluHandlers("1101 rrr 1 ss mmm eee", "memory-destination", (cpu, size, left, right) => cpu.#add(size, left, right)), // ADD Dn,<ea>
    // Excluded d=1 register modes belong to SBCD, SUBX, CMPM, ABCD/EXG, or ADDX.

    // Address ALU: oooo rrr s11 mmm eee. rrr selects An; s=0 signed word, 1 long source.
    // Every source EA is legal. The operation is always 32-bit; only CMPA changes flags.
    ...this.#addressAluHandlers("1001 rrr s11 mmm eee", (_cpu, _size, left, right) => (left - right) >>> 0), // SUBA <ea>,An
    ...this.#addressAluHandlers("1011 rrr s11 mmm eee", (cpu, size, left, right) => { cpu.#compare(size, left, right); }), // CMPA <ea>,An
    ...this.#addressAluHandlers("1101 rrr s11 mmm eee", (_cpu, _size, left, right) => (left + right) >>> 0), // ADDA <ea>,An

    // Other ALU families, status operations, and exceptions are deferred.
  ], 16);

  static #immediateHandlers(pattern: string, apply: AluOperation): readonly OpcodeEntry<OpcodeHandler>[] {
    return this.#sizedDataHandlers(pattern, (size, mode, code) =>
      (cpu, instruction) => cpu.#immediate(size, mode, code, apply, instruction));
  }

  static #sizedDataHandlers(pattern: string, bind: (size: OperandSize, mode: number, code: number) => OpcodeHandler): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { s: this.#sizes, m: this.#selectors, r: this.#selectors }, ({ s: size, m, r }) => {
      if (size === undefined || m === 1 || (m === 7 && r > 1)) return undefined;
      return bind(size, m, r);
    }).flatMap(([opcode, handler]) => handler ? [[opcode, handler] as const] : []);
  }

  static #moveHandlers(pattern: string, size: OperandSize): readonly OpcodeEntry<OpcodeHandler>[] {
    const codes = this.#selectors;
    return opcodeFamily(pattern, { d: codes, m: codes, s: codes, r: codes }, ({ d, m, s, r }) => {
      // Mode 111: sources allow absolute word/long, PC displacement/index, and immediate;
      // destinations allow only absolute word/long. Byte transfers cannot read or write An.
      if ((s === 7 && r > 4) || (m === 7 && d > 1) || (size === 8 && (s === 1 || m === 1))) return undefined;
      return (cpu: Cpu68000, instruction: InstructionContext) => cpu.#move(size, s, r, m, d, instruction);
    }).flatMap(([opcode, handler]) => handler ? [[opcode, handler] as const] : []);
  }

  static #unaryHandlers(pattern: string, apply: AluOperation): readonly OpcodeEntry<OpcodeHandler>[] {
    // CLR reads its memory destination before clearing it on the original 68000.
    return this.#sizedDataHandlers(pattern, (size, mode, code) =>
      (cpu, instruction) => cpu.#effectiveAddressAlu(size, mode, code, 0, apply, instruction));
  }

  static #isControlAddress(mode: number, code: number): boolean {
    return mode === 0b010 || mode === 0b101 || mode === 0b110 || (mode === 0b111 && code <= 0b011);
  }

  static #leaHandlers(pattern: string): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { a: this.#selectors, m: this.#selectors, r: this.#selectors }, ({ a, m, r }) => {
      if (!this.#isControlAddress(m, r)) return undefined;
      return (cpu: Cpu68000, instruction: InstructionContext) => {
        cpu.#state[cpu.#addressRegister(a)] = cpu.#controlAddress(m, r, instruction);
      };
    }).flatMap(([opcode, handler]) => handler ? [[opcode, handler] as const] : []);
  }

  static #controlHandlers(pattern: string, apply: ControlOperation): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { m: this.#selectors, r: this.#selectors }, ({ m, r }) => {
      if (!this.#isControlAddress(m, r)) return undefined;
      return (cpu: Cpu68000, instruction: InstructionContext) => apply(cpu, cpu.#controlAddress(m, r, instruction), instruction);
    }).flatMap(([opcode, handler]) => handler ? [[opcode, handler] as const] : []);
  }

  static #movemHandlers(pattern: string): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { d: [false, true], s: [16, 32] as const, m: this.#selectors, r: this.#selectors }, ({ d: load, s: size, m, r }) => {
      const control = this.#isControlAddress(m, r) && (load || m !== 0b111 || r <= 0b001);
      if (!control && m !== (load ? 0b011 : 0b100)) return undefined;
      return (cpu: Cpu68000, instruction: InstructionContext) => cpu.#moveMultiple(size, load, m, r, instruction);
    }).flatMap(([opcode, handler]) => handler ? [[opcode, handler] as const] : []);
  }

  static #quickHandlers(pattern: string, direction: 1 | -1): readonly OpcodeEntry<OpcodeHandler>[] {
    const apply: AluOperation = direction === 1 ? (cpu, size, left, right) => cpu.#add(size, left, right)
      : (cpu, size, left, right) => cpu.#subtract(size, left, right);
    return opcodeFamily(pattern, { q: [8, 1, 2, 3, 4, 5, 6, 7], s: this.#sizes, m: this.#selectors, r: this.#selectors }, ({ q: amount, s: size, m, r }) => {
      if (size === undefined || (m === 1 && size === 8) || (m === 7 && r > 1)) return undefined;
      if (m === 1) return (cpu: Cpu68000) => {
        const register = cpu.#addressRegister(r);
        cpu.#state[register] = (cpu.#state[register] + direction * amount) >>> 0;
      };
      return (cpu: Cpu68000, instruction: InstructionContext) => cpu.#effectiveAddressAlu(size, m, r, amount, apply, instruction);
    }).flatMap(([opcode, handler]) => handler ? [[opcode, handler] as const] : []);
  }

  static #conditionHandlers(pattern: string): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { c: motorolaConditions, m: this.#selectors, r: this.#selectors }, ({ c: test, m, r }) => {
      if (m === 1 || (m === 7 && r > 1)) return undefined;
      const apply: AluOperation = cpu => test(cpu.#state.flags) ? 0xff : 0;
      // Like CLR, Scc reads before writing memory on the original 68000; flags are preserved.
      return (cpu: Cpu68000, instruction: InstructionContext) => cpu.#effectiveAddressAlu(8, m, r, 0, apply, instruction);
    }).flatMap(([opcode, handler]) => handler ? [[opcode, handler] as const] : []);
  }

  static #branchHandlers(pattern: string): readonly OpcodeEntry<OpcodeHandler>[] {
    const conditions = motorolaConditions.map((test, code) => ({ test, code }));
    return opcodeFamily(pattern, { c: conditions, d: this.#immediateBytes }, ({ c: { test, code }, d: byte }) => {
      // The F encoding is a subroutine call, selected while building the table.
      if (code === 0b0001) return (cpu: Cpu68000, instruction: InstructionContext) => cpu.#call(cpu.#branchTarget(byte, instruction), instruction);
      return (cpu: Cpu68000, instruction: InstructionContext) => cpu.#branch(byte, test(cpu.#state.flags), instruction);
    });
  }

  static #dataAluHandlers(pattern: string, addressing: AluAddressing, apply: AluOperation): readonly OpcodeEntry<OpcodeHandler>[] {
    const source = addressing === "source" || addressing === "data-source";
    return opcodeFamily(pattern, { r: this.#dataRegisters, s: this.#sizes, m: this.#selectors, e: this.#selectors }, ({ r: register, s: size, m, e }) => {
      if (size === undefined) return undefined;
      if (m === 7 && e > (source ? 4 : 1)) return undefined;
      if (m === 1 && (addressing !== "source" || size === 8)) return undefined;
      if (m === 0 && addressing === "memory-destination") return undefined;
      if (source) {
        return (cpu: Cpu68000, instruction: InstructionContext) => cpu.#registerAlu(size, m, e, { kind: "data", register }, apply, instruction);
      }
      return (cpu: Cpu68000, instruction: InstructionContext) => cpu.#effectiveAddressAlu(size, m, e, cpu.#state[register] % 2 ** size, apply, instruction);
    }).flatMap(([opcode, handler]) => handler ? [[opcode, handler] as const] : []);
  }

  static #addressAluHandlers(pattern: string, apply: AluOperation): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { r: this.#selectors, s: [16, 32] as const, m: this.#selectors, e: this.#selectors }, ({ r, s: size, m, e }) => {
      if (m === 7 && e > 4) return undefined;
      return (cpu: Cpu68000, instruction: InstructionContext) => cpu.#registerAlu(size, m, e, { kind: "address", register: cpu.#addressRegister(r) }, apply, instruction);
    }).flatMap(([opcode, handler]) => handler ? [[opcode, handler] as const] : []);
  }

  // Effective addresses. Resolve each operand once, source before destination.

  #controlAddress(mode: number, code: number, instruction: InstructionContext): number {
    const operand = this.#resolveOperand(32, mode, code, instruction, new Map());
    if (operand.kind !== "memory") throw new Error("Invalid control address reached execution.");
    return operand.address;
  }

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
          case 0b100: return { kind: "immediate", value: this.#fetchImmediate(size, instruction) }; // #n
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

  #writeOperand(size: OperandSize, operand: Exclude<Operand, { kind: "immediate" }>, value: number, writeByte: ByteMemory["writeByte"]): void {
    if (operand.kind === "address") this.#state[operand.register] = (size === 16 ? (value << 16 >> 16) : value) >>> 0;
    else if (operand.kind === "memory") this.#writeMemory(size, operand.address, value, writeByte);
    else this.#state[operand.register] = ((this.#state[operand.register] & ~(2 ** size - 1)) | value) >>> 0;
  }

  #fetchImmediate(size: OperandSize, { fetchWord, fetchLong }: InstructionContext): number {
    // Byte immediates occupy a word whose high byte is ignored.
    return size === 32 ? fetchLong() : fetchWord() % 2 ** size;
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
    this.#writeOperand(size, destination, value, instruction.writeByte);
    if (destination.kind !== "address") this.#setResultFlags(value, size);
  }

  #loadQuickRegister(register: DataRegister, byte: number): void {
    const value = signed8(byte) >>> 0;
    this.#state[register] = value;
    this.#setResultFlags(value);
  }

  #moveMultiple(size: 16 | 32, load: boolean, mode: number, code: number,
    instruction: InstructionContext): Cpu68000AlignmentFault | void {
    const mask = instruction.fetchWord();
    const predecrement = mode === 0b100;
    const postincrement = mode === 0b011;
    const base = this.#addressRegister(code);
    // MOVEM updates once for the whole list, rather than once through the ordinary EA resolver.
    let address = predecrement || postincrement ? this.#state[base] : this.#controlAddress(mode, code, instruction);
    if (mask === 0) return; // No transfers: no alignment requirement or base update.
    const firstAddress = predecrement ? (address - size / 8) >>> 0 : address;
    if (firstAddress % 2 !== 0) return { operation: load ? "read" : "write", address: firstAddress };
    // Normal mask bits 0..15 select D0..D7,A0..A7. Predecrement reverses that list.
    for (let bit = 0; bit < 16; bit++) {
      if (!(mask & (1 << bit))) continue;
      const selector = predecrement ? 15 - bit : bit;
      const register = selector < 8 ? Cpu68000.#dataRegisters[selector]! : this.#addressRegister(selector - 8);
      if (predecrement) address = (address - size / 8) >>> 0;
      if (load) {
        const value = this.#readMemory(size, address, instruction.readByte);
        this.#state[register] = (size === 16 ? (value << 16 >> 16) : value) >>> 0;
      } else this.#writeMemory(size, address, this.#state[register], instruction.writeByte);
      if (!predecrement) address = (address + size / 8) >>> 0;
    }
    // On the 68000 a stored base is its original value; a loaded postincrement base is discarded.
    if (predecrement || postincrement) this.#state[base] = address;
  }

  // Control flow and stack. Validate taken targets before committing counter or stack changes.

  #branchTarget(byte: number, instruction: InstructionContext): number {
    const base = instruction.nextAddress();
    const displacement = byte === 0 ? (instruction.fetchWord() << 16 >> 16) : signed8(byte);
    return (base + displacement) >>> 0;
  }

  #jump(target: number, instruction: InstructionContext): Cpu68000AlignmentFault | void {
    if (target % 2 !== 0) return { operation: "fetch", address: target };
    instruction.jump(target);
  }

  #branch(byte: number, take: boolean, instruction: InstructionContext): Cpu68000AlignmentFault | void {
    const target = this.#branchTarget(byte, instruction);
    if (take) return this.#jump(target, instruction);
  }

  #decrementBranch(register: DataRegister, condition: boolean, instruction: InstructionContext): Cpu68000AlignmentFault | void {
    const target = this.#branchTarget(0, instruction);
    if (condition) return;
    const counter = (this.#state[register] - 1) & 0xffff;
    if (counter !== 0xffff) {
      const fault = this.#jump(target, instruction);
      if (fault) return fault;
    }
    // DBcc changes only the low word, without arithmetic flag updates.
    this.#writeOperand(16, { kind: "data", register }, counter, instruction.writeByte);
  }

  #call(target: number, instruction: InstructionContext): Cpu68000AlignmentFault | void {
    const returnAddress = instruction.nextAddress();
    const stack = this.#addressRegister(7);
    const address = (this.#state[stack] - 4) >>> 0;
    if (address % 2 !== 0) return { operation: "write", address };
    const fault = this.#jump(target, instruction);
    if (fault) return fault;
    this.#writeMemory(32, address, returnAddress, instruction.writeByte);
    this.#state[stack] = address;
  }

  #pushLong(value: number, instruction: InstructionContext): Cpu68000AlignmentFault | void {
    const stack = this.#addressRegister(7);
    const address = (this.#state[stack] - 4) >>> 0;
    if (address % 2 !== 0) return { operation: "write", address };
    this.#writeMemory(32, address, value, instruction.writeByte);
    this.#state[stack] = address;
  }

  #link(code: number, instruction: InstructionContext): Cpu68000AlignmentFault | void {
    const displacement = instruction.fetchWord() << 16 >> 16;
    const register = this.#addressRegister(code);
    const stack = this.#addressRegister(7);
    const address = (this.#state[stack] - 4) >>> 0;
    if (address % 2 !== 0) return { operation: "write", address };
    // LINK A7 saves the decremented SP, then applies the signed allocation to it.
    this.#writeMemory(32, address, code === 7 ? address : this.#state[register], instruction.writeByte);
    this.#state[register] = address;
    this.#state[stack] = (address + displacement) >>> 0;
  }

  #unlink(code: number, instruction: InstructionContext): Cpu68000AlignmentFault | void {
    const register = this.#addressRegister(code);
    const stack = this.#addressRegister(7);
    const address = this.#state[register];
    if (address % 2 !== 0) return { operation: "read", address };
    const value = this.#readMemory(32, address, instruction.readByte);
    this.#state[stack] = (address + 4) >>> 0;
    this.#state[register] = value; // UNLK A7 leaves the popped value itself in SP.
  }

  #returnFromSubroutine(instruction: InstructionContext): Cpu68000AlignmentFault | void {
    const stack = this.#addressRegister(7);
    const address = this.#state[stack];
    if (address % 2 !== 0) return { operation: "read", address };
    const target = this.#readMemory(32, address, instruction.readByte);
    const fault = this.#jump(target, instruction);
    if (fault) return fault;
    this.#state[stack] = (address + 4) >>> 0;
  }

  // Arithmetic and flags.

  #immediate(size: OperandSize, mode: number, code: number, apply: AluOperation,
    instruction: InstructionContext): Cpu68000AlignmentFault | void {
    const value = this.#fetchImmediate(size, instruction);
    return this.#effectiveAddressAlu(size, mode, code, value, apply, instruction);
  }

  #effectiveAddressAlu(size: OperandSize, mode: number, code: number, value: number, apply: AluOperation,
    instruction: InstructionContext): Cpu68000AlignmentFault | void {
    const updates: AddressUpdates = new Map();
    const destination = this.#resolveOperand(size, mode, code, instruction, updates);
    if (destination.kind === "immediate" || destination.kind === "address") throw new Error("Invalid data-ALU destination reached execution.");
    if (destination.kind === "memory" && size !== 8 && destination.address % 2 !== 0) return { operation: "read", address: destination.address };
    this.#applyAlu(size, destination, value, apply, updates, instruction);
  }

  #registerAlu(size: OperandSize, mode: number, code: number, destination: Extract<Operand, { kind: "data" | "address" }>,
    apply: AluOperation, instruction: InstructionContext): Cpu68000AlignmentFault | void {
    const updates: AddressUpdates = new Map();
    const source = this.#resolveOperand(size, mode, code, instruction, updates);
    if (source.kind === "memory" && size !== 8 && source.address % 2 !== 0) return { operation: "read", address: source.address };
    let value = this.#readOperand(size, source, instruction.readByte);
    if (destination.kind === "address") {
      if (size === 16) value = (value << 16 >> 16) >>> 0;
      size = 32;
    }
    this.#applyAlu(size, destination, value, apply, updates, instruction);
  }

  #applyAlu(size: OperandSize, destination: Exclude<Operand, { kind: "immediate" }>, value: number,
    apply: AluOperation, updates: AddressUpdates, instruction: InstructionContext): void {
    // All alignment checks have passed. An destinations see source pre/post-updates.
    for (const [register, address] of updates) this.#state[register] = address;
    const result = apply(this, size, this.#readOperand(size, destination, instruction.readByte), value);
    // Comparisons and tests retain address auto-updates without writing a result.
    if (result !== undefined) this.#writeOperand(size, destination, result, instruction.writeByte);
  }

  #logic(size: OperandSize, value: number): number {
    const result = value >>> 0;
    this.#setResultFlags(result, size);
    return result;
  }

  #add(size: OperandSize, left: number, right: number): number {
    const { result, carry, overflow } = add(size, left, right);
    this.#setResultFlags(result, size);
    this.#state.flags.x = this.#state.flags.c = carry;
    this.#state.flags.v = overflow;
    return result;
  }

  #subtract(size: OperandSize, left: number, right: number): number {
    const result = this.#compare(size, left, right);
    this.#state.flags.x = this.#state.flags.c;
    return result;
  }

  #negateExtended(size: OperandSize, value: number): number {
    const zero = this.#state.flags.z;
    const { result, borrow, overflow } = subtract(size, 0, value, this.#state.flags.x ? 1 : 0);
    this.#setResultFlags(result, size);
    this.#state.flags.x = this.#state.flags.c = borrow;
    this.#state.flags.v = overflow;
    this.#state.flags.z = zero && result === 0; // Accumulate zero across a multi-precision negation.
    return result;
  }

  #compare(size: OperandSize, left: number, right: number): number {
    const { result, borrow, overflow } = subtract(size, left, right);
    this.#setResultFlags(result, size);
    this.#state.flags.c = borrow;
    this.#state.flags.v = overflow;
    return result;
  }

  #setResultFlags(value: number, size: OperandSize = 32): void {
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
