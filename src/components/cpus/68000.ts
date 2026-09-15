import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition, InstructionStep, HaltedStep } from "./execution-records.ts";
import { signed8 } from "./binary.ts";
import { recordMemory } from "./memory-access.ts";
import type { ByteMemory, MemoryAccess, RecordedMemory } from "./memory-access.ts";
import { defineState, copyState, readState, unsigned, flag, boolean, group } from "./state.ts";
import type { StateValues, ReadonlyState } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.ts";
import { flagRegister, negativeZero } from "./flags.ts";
import { motorolaConditions, motorolaArithmeticFlags } from "./motorola.ts";
import { add, subtract, shiftLeft, shiftRight } from "./alu.ts";

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpu68000StateDescription = defineState({
  d0: unsigned(32), d1: unsigned(32), d2: unsigned(32), d3: unsigned(32),
  d4: unsigned(32), d5: unsigned(32), d6: unsigned(32), d7: unsigned(32),
  a0: unsigned(32), a1: unsigned(32), a2: unsigned(32), a3: unsigned(32),
  a4: unsigned(32), a5: unsigned(32), a6: unsigned(32),
  usp: unsigned(32), ssp: unsigned(32), pc: unsigned(32), interruptMask: unsigned(3), halted: boolean,
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

/** Detected synchronous exceptions whose frame delivery is outside the current model. */
export type Cpu68000Exception = "divide-by-zero" | "bounds-check" | "privilege-violation";
type InstructionFault = Cpu68000AlignmentFault | Cpu68000Exception;

export type Cpu68000StepRecord = InstructionStep<Cpu68000Snapshot> | HaltedStep<Cpu68000Snapshot> | (StateTransition<Cpu68000Snapshot> & {
  readonly outcome: "unsupported"; readonly reason: Cpu68000Exception;
  readonly instruction: Cpu68000Instruction;
}) | (StateTransition<Cpu68000Snapshot> & {
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

type OpcodeHandler = (cpu: Cpu68000, instruction: InstructionContext) => InstructionFault | void;
type ControlOperation = (cpu: Cpu68000, address: number, instruction: InstructionContext) => Cpu68000AlignmentFault | void;
type WordOperation = (cpu: Cpu68000, register: DataRegister, value: number) => Cpu68000Exception | void;
type DataRegister = `d${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`;
type AddressRegister = `a${0 | 1 | 2 | 3 | 4 | 5 | 6}` | "usp" | "ssp";
type OperandSize = 8 | 16 | 32;
type ShiftKind = "arithmetic" | "logical" | "extend" | "rotate";
type BitChange = (value: number, mask: number) => number;
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
    this.#state.halted = false;
    // Registers and condition codes not specified by reset retain their supplied values.
    return { before, after: this.snapshot(), accesses };
  }

  /** Attempt one instruction; rejections preserve state/RAM, and stopped CPUs do not fetch. */
  step(): Cpu68000StepRecord {
    const before = this.snapshot();
    const { accesses, readByte, writeByte } = this.#recordMemory();
    if (before.halted) return { before, after: this.snapshot(), accesses, instruction: null, outcome: "halted" };
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
    if (typeof fault === "string") {
      return { before, after: this.snapshot(), accesses, instruction, outcome: "unsupported", reason: fault };
    }
    if (fault) {
      return { before, after: this.snapshot(), accesses, instruction, fault,
        outcome: "unsupported", reason: "unaligned-address" };
    }
    this.#state.pc = cursor;
    return { before, after: this.snapshot(), accesses, instruction, outcome: this.#state.halted ? "halted" : "executed" };
  }

  // Register views. A7 selects the active stack; packed status derives from stored fields.

  #addressRegister(code: number): AddressRegister {
    return code === 7 ? (this.#state.flags.s ? "ssp" : "usp") : Cpu68000.#addressRegisters[code]!;
  }

  static readonly #conditionCode = flagRegister({ x: 4, n: 3, z: 2, v: 1, c: 0 });
  static readonly #systemFlags = flagRegister({ t: 15, s: 13 });

  get #status(): number {
    return Cpu68000.#systemFlags.encode(this.#state.flags) | (this.#state.interruptMask << 8)
      | Cpu68000.#conditionCode.encode(this.#state.flags);
  }

  #setStatus(value: number, full: boolean): void {
    Object.assign(this.#state.flags, Cpu68000.#conditionCode.decode(value));
    if (full) {
      Object.assign(this.#state.flags, Cpu68000.#systemFlags.decode(value));
      this.#state.interruptMask = (value >>> 8) & 7;
    }
  }

  // Opcode selectors and construction. Register and mode fields use numeric encoding order.

  static readonly #dataRegisters = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"] as const;
  static readonly #addressRegisters = ["a0", "a1", "a2", "a3", "a4", "a5", "a6"] as const;
  static readonly #selectors = [0, 1, 2, 3, 4, 5, 6, 7] as const;
  static readonly #sizes = [8, 16, 32, undefined] as const;
  static readonly #shiftKinds: readonly ShiftKind[] = ["arithmetic", "logical", "extend", "rotate"];
  static readonly #bitChanges: readonly (BitChange | undefined)[] = [
    undefined, // 00: BTST reads without writeback.
    (value, mask) => value ^ mask, // 01: BCHG
    (value, mask) => value & ~mask, // 10: BCLR
    (value, mask) => value | mask, // 11: BSET
  ];
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

    // Status immediates reuse EA=111100: f=0 CCR (low five bits), f=1 privileged SR.
    ...this.#statusImmediateHandlers("0000 0000 0 f 111100", (left, right) => left | right), // ORI #n,CCR/SR
    ...this.#statusImmediateHandlers("0000 0010 0 f 111100", (left, right) => left & right), // ANDI #n,CCR/SR
    ...this.#statusImmediateHandlers("0000 1010 0 f 111100", (left, right) => left ^ right), // EORI #n,CCR/SR

    // Bit operations: oo=00 BTST, 01 BCHG, 10 BCLR, 11 BSET; mmm rrr selects the tested operand.
    // Dn uses all 32 bits (bit number modulo 32); every other EA uses a byte (modulo 8).
    // Static form fetches a bit-number word before EA extensions; dynamic form reads Dbbb.
    // BTST also allows PC-relative EAs, and an immediate tested byte only in the dynamic form.
    // Other operations require data-alterable EAs. Dynamic mode 001 selects MOVEP below.
    ...this.#bitHandlers("0000 1000 oo mmm rrr", false), // BTST/BCHG/BCLR/BSET #n,<ea>
    ...this.#bitHandlers("0000 bbb 1 oo mmm rrr", true), // BTST/BCHG/BCLR/BSET Dn,<ea>

    // MOVEP: 0000 ddd 1 t s 001 aaa. t=0 memory to Dn, 1 Dn to memory;
    // s=0 word, 1 long. A signed displacement precedes alternate-byte transfers, even at odd addresses.
    ...opcodeFamily("0000 ddd 1 t s 001 aaa", { d: this.#dataRegisters, t: [false, true], s: [16, 32] as const, a: this.#selectors }, ({ d, t: store, s: size, a }) => (cpu: Cpu68000, instruction: InstructionContext) => cpu.#movePeripheral(d, a, size, store, instruction)), // MOVEP

    // MOVE: 00 zz ddd mmm sss rrr. zz=01 byte, 10 long, 11 word.
    // Destination is register ddd then mode mmm; source is mode sss then register rrr.
    // Destination mode 001 is MOVEA (word/long only), with sign extension and no flag changes.
    ...this.#moveHandlers("00 01 ddd mmm sss rrr", 8), // MOVE.B <ea>,<ea>
    ...this.#moveHandlers("00 10 ddd mmm sss rrr", 32), // MOVE.L / MOVEA.L <ea>,<ea>
    ...this.#moveHandlers("00 11 ddd mmm sss rrr", 16), // MOVE.W / MOVEA.W <ea>,<ea>

    // Unary ALU: 0100 oooo ss mmm rrr. ss=00 byte, 01 word, 10 long;
    // mmm rrr selects a data-alterable EA, even for TST on the original 68000.
    // ss=11 belongs to status transfers, TAS, or other instructions, not this family.
    ...this.#unaryHandlers("0100 0000 ss mmm rrr", (cpu, size, value) => cpu.#subtract(size, 0, value, true)), // NEGX <ea>
    ...this.#unaryHandlers("0100 0010 ss mmm rrr", (cpu, size) => cpu.#logic(size, 0)), // CLR <ea>
    ...this.#unaryHandlers("0100 0100 ss mmm rrr", (cpu, size, value) => cpu.#subtract(size, 0, value)), // NEG <ea>
    ...this.#unaryHandlers("0100 0110 ss mmm rrr", (cpu, size, value) => cpu.#logic(size, value ^ (2 ** size - 1))), // NOT <ea>
    ...this.#unaryHandlers("0100 1010 ss mmm rrr", (cpu, size, value) => { cpu.#setResultFlags(value, size); }), // TST <ea>

    // Status transfers: ss=11 reuses unary slots. Sources are data EAs, word-sized even for CCR.
    // MOVE from SR is unprivileged on the original 68000; its memory destination is read first.
    ...this.#fixedAluHandlers("0100 0000 11 mmm rrr", 16, cpu => cpu.#status), // MOVE SR,<ea>
    ...this.#statusMoveHandlers("0100 0100 11 mmm rrr", false), // MOVE <ea>,CCR
    ...this.#statusMoveHandlers("0100 0110 11 mmm rrr", true), // MOVE <ea>,SR
    // CHK: 0100 ddd 110 mmm rrr; signed Dn.W must lie between zero and a signed EA word.
    ...this.#wordSourceHandlers("0100 ddd 110 mmm rrr", (cpu, register, bound) => cpu.#checkBounds(register, bound)), // CHK.W <ea>,Dn

    // Fixed-size data operations: NBCD negates a packed byte; TAS tests the old byte then sets bit 7.
    ...this.#fixedAluHandlers("0100 1000 00 mmm rrr", 8, (cpu, _size, value) => cpu.#decimal(0, value, -1)), // NBCD <ea>
    ...this.#fixedAluHandlers("0100 1010 11 mmm rrr", 8, (cpu, _size, value) => { cpu.#setResultFlags(value, 8); return value | 0x80; }), // TAS <ea>

    // Register-only slots beside PEA and MOVEM. EXT.W extends byte to word; EXT.L extends word to long.
    ...opcodeFamily("0100 1000 01 000 rrr", { r: this.#dataRegisters }, ({ r }) => (cpu: Cpu68000) => cpu.#swapWords(r)), // SWAP Dn
    ...opcodeFamily("0100 1000 1 s 000 rrr", { s: [16, 32] as const, r: this.#dataRegisters }, ({ s, r }) => (cpu: Cpu68000) => cpu.#extend(r, s)), // EXT.W/L Dn

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
    // USP transfers: 0100 1110 0110 d rrr; d=0 An to USP, d=1 USP to An. Both are privileged.
    ...opcodeFamily("0100 1110 0110 d rrr", { d: [false, true], r: this.#selectors }, ({ d, r }) => (cpu: Cpu68000) => cpu.#moveUserStack(r, d)), // MOVE An,USP / USP,An
    ...opcodePattern("0100 1110 0111 0001", () => {}), // NOP
    ...opcodePattern("0100 1110 0111 0010", (cpu: Cpu68000, instruction: InstructionContext) => cpu.#stop(instruction)), // STOP #SR
    ...opcodePattern("0100 1110 0111 0111", (cpu: Cpu68000, instruction: InstructionContext) => cpu.#returnFromSubroutine(instruction, true)), // RTR
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
    // The d=1 register modes select the paired, decimal, and exchange families below.

    // Word sources beside data ALU: oooo ddd s11 mmm rrr, s=0 unsigned, 1 signed.
    // MUL reads Dn.W and writes Dn.L; DIV reads Dn.L and packs remainder:quotient into Dn.
    ...this.#wordSourceHandlers("1100 ddd 011 mmm rrr", (cpu, register, value) => cpu.#multiply(register, value, false)), // MULU.W <ea>,Dn
    ...this.#wordSourceHandlers("1100 ddd 111 mmm rrr", (cpu, register, value) => cpu.#multiply(register, value, true)), // MULS.W <ea>,Dn
    ...this.#wordSourceHandlers("1000 ddd 011 mmm rrr", (cpu, register, value) => cpu.#divide(register, value, false)), // DIVU.W <ea>,Dn
    ...this.#wordSourceHandlers("1000 ddd 111 mmm rrr", (cpu, register, value) => cpu.#divide(register, value, true)), // DIVS.W <ea>,Dn

    // Paired ALU: oooo ddd 1 ss 00 m rrr; ddd selects destination, rrr source.
    // ADDX/SUBX use m=0 for Dn,Dn and m=1 for -(An),-(An); ss=00/01/10 byte/word/long.
    // Both consume X and accumulate Z. CMPM fixes m=1 for (An)+,(An)+ and preserves X.
    ...this.#pairedAluHandlers("1001 ddd 1 ss 00 0 rrr", 0b000, (cpu, size, left, right) => cpu.#subtract(size, left, right, true)), // SUBX Dn,Dn
    ...this.#pairedAluHandlers("1001 ddd 1 ss 00 1 rrr", 0b100, (cpu, size, left, right) => cpu.#subtract(size, left, right, true)), // SUBX -(An),-(An)
    ...this.#pairedAluHandlers("1011 ddd 1 ss 00 1 rrr", 0b011, (cpu, size, left, right) => { cpu.#compare(size, left, right); }), // CMPM (An)+,(An)+
    ...this.#pairedAluHandlers("1101 ddd 1 ss 00 0 rrr", 0b000, (cpu, size, left, right) => cpu.#add(size, left, right, true)), // ADDX Dn,Dn
    ...this.#pairedAluHandlers("1101 ddd 1 ss 00 1 rrr", 0b100, (cpu, size, left, right) => cpu.#add(size, left, right, true)), // ADDX -(An),-(An)

    // Decimal: oooo ddd 10000 m rrr; oooo=1000 SBCD / 1100 ABCD, byte only.
    // ddd is destination, rrr source; m=0 Dn,Dn, m=1 -(An),-(An). Both consume X and accumulate Z.
    ...this.#decimalHandlers("1000 ddd 10000 m rrr", -1), // SBCD
    ...this.#decimalHandlers("1100 ddd 10000 m rrr", 1), // ABCD
    // EXG: 1100 ddd 1 ooooo rrr; ooooo=01000 Dn/Dn, 01001 An/An, 10001 Dn/An; no flags change.
    ...this.#exchangeHandlers("1100 ddd 1 01000 rrr", "data", "data"), // EXG Dn,Dn
    ...this.#exchangeHandlers("1100 ddd 1 01001 rrr", "address", "address"), // EXG An,An
    ...this.#exchangeHandlers("1100 ddd 1 10001 rrr", "data", "address"), // EXG Dn,An

    // Address ALU: oooo rrr s11 mmm eee. rrr selects An; s=0 signed word, 1 long source.
    // Every source EA is legal. The operation is always 32-bit; only CMPA changes flags.
    ...this.#addressAluHandlers("1001 rrr s11 mmm eee", (_cpu, _size, left, right) => (left - right) >>> 0), // SUBA <ea>,An
    ...this.#addressAluHandlers("1011 rrr s11 mmm eee", (cpu, size, left, right) => { cpu.#compare(size, left, right); }), // CMPA <ea>,An
    ...this.#addressAluHandlers("1101 rrr s11 mmm eee", (_cpu, _size, left, right) => (left + right) >>> 0), // ADDA <ea>,An

    // Register shifts: 1110 ccc d ss i tt rrr. d=0 right, 1 left; ss=00 byte, 01 word, 10 long.
    // i=0: ccc is an immediate count (000 means 8); i=1: Dccc supplies its low six bits (0..63).
    // tt=00 arithmetic, 01 logical, 10 rotate through X, 11 rotate; rrr selects the destination Dn.
    ...this.#registerShiftHandlers("1110 ccc d ss i tt rrr"), // ASR/ASL, LSR/LSL, ROXR/ROXL, ROR/ROL
    // ss=11 moves tt to bits 10..9: 1110 0 tt d 11 mmm rrr shifts a memory word once.
    // Only memory-alterable EAs are legal; bit 11=1 belongs to later chips' bit-field instructions.
    ...this.#memoryShiftHandlers("1110 0 tt d 11 mmm rrr"), // ASR/ASL, LSR/LSL, ROXR/ROXL, ROR/ROL <ea>

    // RESET (external devices), RTE, TRAP, TRAPV, and ILLEGAL await exception/device delivery.
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

  static #statusImmediateHandlers(pattern: string, apply: (left: number, right: number) => number): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { f: [false, true] }, ({ f: full }) => (cpu: Cpu68000, instruction: InstructionContext) => {
      if (full && !cpu.#state.flags.s) return "privilege-violation";
      cpu.#setStatus(apply(cpu.#status, instruction.fetchWord()), full);
    });
  }

  static #bitHandlers(pattern: string, fromRegister: boolean): readonly OpcodeEntry<OpcodeHandler>[] {
    const operands = { o: this.#bitChanges, m: this.#selectors, r: this.#selectors };
    const entries = fromRegister
      ? opcodeFamily(pattern, { b: this.#dataRegisters, ...operands }, ({ b, o, m, r }) => this.#bitHandler(o, m, r, b))
      : opcodeFamily(pattern, operands, ({ o, m, r }) => this.#bitHandler(o, m, r));
    return entries.flatMap(([opcode, handler]) => handler ? [[opcode, handler] as const] : []);
  }

  static #bitHandler(change: BitChange | undefined, mode: number, code: number, register?: DataRegister): OpcodeHandler | undefined {
    const lastSpecial = change ? 1 : register === undefined ? 3 : 4; // Absolute, PC-relative, or immediate.
    if (mode === 1 || (mode === 7 && code > lastSpecial)) return undefined;
    const size = mode === 0 ? 32 : 8;
    const apply: AluOperation = (cpu, width, value, bit) => cpu.#bit(width, value, bit, change);
    return (cpu, instruction) => {
      const bit = register === undefined ? instruction.fetchWord() : cpu.#state[register];
      return cpu.#effectiveAddressAlu(size, mode, code, bit, apply, instruction);
    };
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

  static #fixedAluHandlers(pattern: string, size: OperandSize, apply: AluOperation): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { m: this.#selectors, r: this.#selectors }, ({ m, r }) => {
      if (m === 1 || (m === 7 && r > 1)) return undefined;
      return (cpu: Cpu68000, instruction: InstructionContext) => cpu.#effectiveAddressAlu(size, m, r, 0, apply, instruction);
    }).flatMap(([opcode, handler]) => handler ? [[opcode, handler] as const] : []);
  }

  static #statusMoveHandlers(pattern: string, full: boolean): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { m: this.#selectors, r: this.#selectors }, ({ m, r }) => {
      if (m === 1 || (m === 7 && r > 4)) return undefined;
      return (cpu: Cpu68000, instruction: InstructionContext) => {
        if (full && !cpu.#state.flags.s) return "privilege-violation";
        return cpu.#readDataWord(m, r, instruction, value => { cpu.#setStatus(value, full); });
      };
    }).flatMap(([opcode, handler]) => handler ? [[opcode, handler] as const] : []);
  }

  static #wordSourceHandlers(pattern: string, apply: WordOperation): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { d: this.#dataRegisters, m: this.#selectors, r: this.#selectors }, ({ d, m, r }) => {
      if (m === 1 || (m === 7 && r > 4)) return undefined;
      return (cpu: Cpu68000, instruction: InstructionContext) => cpu.#readDataWord(m, r, instruction, value => apply(cpu, d, value));
    }).flatMap(([opcode, handler]) => handler ? [[opcode, handler] as const] : []);
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
    return opcodeFamily(pattern, { r: this.#selectors, s: this.#sizes, m: this.#selectors, e: this.#selectors }, ({ r, s: size, m, e }) => {
      if (size === undefined) return undefined;
      if (m === 7 && e > (source ? 4 : 1)) return undefined;
      if (m === 1 && (addressing !== "source" || size === 8)) return undefined;
      if (m === 0 && addressing === "memory-destination") return undefined;
      if (source) {
        return (cpu: Cpu68000, instruction: InstructionContext) => cpu.#pairedAlu(size, m, e, 0, r, apply, instruction);
      }
      return (cpu: Cpu68000, instruction: InstructionContext) => cpu.#effectiveAddressAlu(size, m, e, cpu.#state[Cpu68000.#dataRegisters[r]!] % 2 ** size, apply, instruction);
    }).flatMap(([opcode, handler]) => handler ? [[opcode, handler] as const] : []);
  }

  static #pairedAluHandlers(pattern: string, mode: 0 | 3 | 4, apply: AluOperation): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { d: this.#selectors, s: this.#sizes, r: this.#selectors }, ({ d, s: size, r }) => {
      if (size === undefined) return undefined;
      return (cpu: Cpu68000, instruction: InstructionContext) => cpu.#pairedAlu(size, mode, r, mode, d, apply, instruction);
    }).flatMap(([opcode, handler]) => handler ? [[opcode, handler] as const] : []);
  }

  static #decimalHandlers(pattern: string, direction: 1 | -1): readonly OpcodeEntry<OpcodeHandler>[] {
    const apply: AluOperation = (cpu, _size, left, right) => cpu.#decimal(left, right, direction);
    return opcodeFamily(pattern, { d: this.#selectors, m: [0, 4], r: this.#selectors }, ({ d, m: mode, r }) =>
      (cpu: Cpu68000, instruction: InstructionContext) => cpu.#pairedAlu(8, mode, r, mode, d, apply, instruction));
  }

  static #exchangeHandlers(pattern: string, leftBank: "data" | "address", rightBank: "data" | "address"): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { d: this.#selectors, r: this.#selectors }, ({ d, r }) => (cpu: Cpu68000) => {
      const left = leftBank === "data" ? Cpu68000.#dataRegisters[d]! : cpu.#addressRegister(d);
      const right = rightBank === "data" ? Cpu68000.#dataRegisters[r]! : cpu.#addressRegister(r);
      [cpu.#state[left], cpu.#state[right]] = [cpu.#state[right], cpu.#state[left]];
    });
  }

  static #addressAluHandlers(pattern: string, apply: AluOperation): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { r: this.#selectors, s: [16, 32] as const, m: this.#selectors, e: this.#selectors }, ({ r, s: size, m, e }) => {
      if (m === 7 && e > 4) return undefined;
      return (cpu: Cpu68000, instruction: InstructionContext) => cpu.#pairedAlu(size, m, e, 1, r, apply, instruction);
    }).flatMap(([opcode, handler]) => handler ? [[opcode, handler] as const] : []);
  }

  static #registerShiftHandlers(pattern: string): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { c: this.#selectors, d: [false, true], s: this.#sizes, i: [false, true], t: this.#shiftKinds, r: this.#selectors }, ({ c, d: left, s: size, i: fromRegister, t: kind, r }) => {
      if (size === undefined) return undefined;
      const apply: AluOperation = (cpu, width, value, count) => cpu.#shift(kind, left, width, value, count);
      return (cpu: Cpu68000, instruction: InstructionContext) => {
        // Capture the count before writing the destination, including Dn,Dn aliases.
        const count = fromRegister ? cpu.#state[Cpu68000.#dataRegisters[c]!] & 63 : c || 8;
        return cpu.#effectiveAddressAlu(size, 0, r, count, apply, instruction);
      };
    }).flatMap(([opcode, handler]) => handler ? [[opcode, handler] as const] : []);
  }

  static #memoryShiftHandlers(pattern: string): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { t: this.#shiftKinds, d: [false, true], m: this.#selectors, r: this.#selectors }, ({ t: kind, d: left, m, r }) => {
      if (m < 2 || (m === 7 && r > 1)) return undefined;
      const apply: AluOperation = (cpu, size, value, count) => cpu.#shift(kind, left, size, value, count);
      return (cpu: Cpu68000, instruction: InstructionContext) => cpu.#effectiveAddressAlu(16, m, r, 1, apply, instruction);
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

  #readDataWord(mode: number, code: number, instruction: InstructionContext,
    apply: (value: number) => Cpu68000Exception | void): InstructionFault | void {
    const updates: AddressUpdates = new Map();
    const operand = this.#resolveOperand(16, mode, code, instruction, updates);
    if (operand.kind === "memory" && operand.address % 2 !== 0) return { operation: "read", address: operand.address };
    const fault = apply(this.#readOperand(16, operand, instruction.readByte));
    if (fault) return fault;
    // Keep the resolved bank even if loading SR changes which stack pointer A7 selects.
    for (const [register, address] of updates) this.#state[register] = address;
  }

  #moveUserStack(code: number, load: boolean): Cpu68000Exception | void {
    if (!this.#state.flags.s) return "privilege-violation";
    const register = this.#addressRegister(code);
    if (load) this.#state[register] = this.#state.usp;
    else this.#state.usp = this.#state[register];
  }

  #movePeripheral(register: DataRegister, code: number, size: 16 | 32, store: boolean, instruction: InstructionContext): void {
    const address = (this.#state[this.#addressRegister(code)] + (instruction.fetchWord() << 16 >> 16)) >>> 0;
    if (store) this.#writeMemory(size, address, this.#state[register], instruction.writeByte, 2);
    else this.#writeOperand(size, { kind: "data", register }, this.#readMemory(size, address, instruction.readByte, 2), instruction.writeByte);
  }

  #extend(register: DataRegister, size: 16 | 32): void {
    const value = this.#state[register];
    const result = size === 16 ? (signed8(value & 0xff) & 0xffff) : (value << 16 >> 16) >>> 0;
    this.#state[register] = size === 16 ? ((value & 0xffff0000) | result) >>> 0 : result;
    this.#setResultFlags(result, size);
  }

  #swapWords(register: DataRegister): void {
    const value = this.#state[register];
    this.#state[register] = this.#logic(32, (value << 16) | (value >>> 16));
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

  #returnFromSubroutine(instruction: InstructionContext, restoreConditionCode = false): Cpu68000AlignmentFault | void {
    const stack = this.#addressRegister(7);
    const address = this.#state[stack];
    if (address % 2 !== 0) return { operation: "read", address };
    const conditionCode = restoreConditionCode ? this.#readMemory(16, address, instruction.readByte) : 0;
    const offset = restoreConditionCode ? 2 : 0;
    const target = this.#readMemory(32, address + offset, instruction.readByte);
    const fault = this.#jump(target, instruction);
    if (fault) return fault;
    this.#state[stack] = (address + offset + 4) >>> 0;
    if (restoreConditionCode) this.#setStatus(conditionCode, false);
  }

  #stop(instruction: InstructionContext): Cpu68000Exception | void {
    if (!this.#state.flags.s) return "privilege-violation";
    this.#setStatus(instruction.fetchWord(), true);
    this.#state.halted = true;
  }

  // Arithmetic and flags.

  #multiply(register: DataRegister, value: number, signed: boolean): void {
    const left = this.#state[register] & 0xffff;
    const result = signed ? (left << 16 >> 16) * (value << 16 >> 16) : left * value;
    this.#state[register] = result >>> 0;
    this.#setResultFlags(result >>> 0);
  }

  #divide(register: DataRegister, value: number, signed: boolean): Cpu68000Exception | void {
    if (value === 0) return "divide-by-zero";
    const dividend = signed ? this.#state[register] | 0 : this.#state[register];
    const divisor = signed ? value << 16 >> 16 : value;
    const quotient = Math.trunc(dividend / divisor);
    this.#state.flags.c = false;
    if (quotient < (signed ? -0x8000 : 0) || quotient > (signed ? 0x7fff : 0xffff)) {
      this.#state.flags.v = true;
      return; // Overflow preserves Dn and undefined N/Z; the source's auto-update still commits.
    }
    const remainder = dividend % divisor; // Signed remainder follows the dividend, including negative quotients.
    this.#state[register] = ((remainder << 16) | (quotient & 0xffff)) >>> 0;
    this.#setResultFlags(quotient & 0xffff, 16);
  }

  #checkBounds(register: DataRegister, value: number): Cpu68000Exception | void {
    const tested = this.#state[register] << 16 >> 16;
    if (tested < 0 || tested > (value << 16 >> 16)) return "bounds-check";
    // X is unchanged; this model also preserves the undefined N/Z/V/C on a successful check.
  }

  #immediate(size: OperandSize, mode: number, code: number, apply: AluOperation,
    instruction: InstructionContext): Cpu68000AlignmentFault | void {
    const value = this.#fetchImmediate(size, instruction);
    return this.#effectiveAddressAlu(size, mode, code, value, apply, instruction);
  }

  #effectiveAddressAlu(size: OperandSize, mode: number, code: number, value: number, apply: AluOperation,
    instruction: InstructionContext): Cpu68000AlignmentFault | void {
    const updates: AddressUpdates = new Map();
    const destination = this.#resolveOperand(size, mode, code, instruction, updates);
    if (destination.kind === "address") throw new Error("Invalid data-ALU destination reached execution.");
    if (destination.kind === "memory" && size !== 8 && destination.address % 2 !== 0) return { operation: "read", address: destination.address };
    this.#applyAlu(size, destination, value, apply, updates, instruction);
  }

  #pairedAlu(size: OperandSize, sourceMode: number, sourceCode: number, destinationMode: number, destinationCode: number,
    apply: AluOperation, instruction: InstructionContext): Cpu68000AlignmentFault | void {
    const updates: AddressUpdates = new Map();
    const source = this.#resolveOperand(size, sourceMode, sourceCode, instruction, updates);
    if (source.kind === "memory" && size !== 8 && source.address % 2 !== 0) return { operation: "read", address: source.address };
    let value = this.#readOperand(size, source, instruction.readByte);
    // Two auto-updates of the same An use successive addresses, source before destination.
    const destination = this.#resolveOperand(size, destinationMode, destinationCode, instruction, updates);
    if (destination.kind === "memory" && size !== 8 && destination.address % 2 !== 0) return { operation: "read", address: destination.address };
    if (destination.kind === "address") {
      if (size === 16) value = (value << 16 >> 16) >>> 0;
      size = 32;
    }
    this.#applyAlu(size, destination, value, apply, updates, instruction);
  }

  #applyAlu(size: OperandSize, destination: Operand, value: number,
    apply: AluOperation, updates: AddressUpdates, instruction: InstructionContext): void {
    // All alignment checks have passed. An destinations see source pre/post-updates.
    for (const [register, address] of updates) this.#state[register] = address;
    const result = apply(this, size, this.#readOperand(size, destination, instruction.readByte), value);
    // Comparisons and tests retain address auto-updates without writing a result.
    if (result !== undefined) {
      if (destination.kind === "immediate") throw new Error("An immediate operand cannot receive ALU writeback.");
      this.#writeOperand(size, destination, result, instruction.writeByte);
    }
  }

  #decimal(left: number, right: number, direction: 1 | -1): number {
    let carry = this.#state.flags.x ? 1 : 0;
    let result = 0;
    // One decimal correction per nibble; the same deterministic rule covers non-BCD inputs.
    for (const shift of [0, 4]) {
      let digit = ((left >>> shift) & 15) + direction * (((right >>> shift) & 15) + carry);
      carry = (direction === 1 ? digit > 9 : digit < 0) ? 1 : 0;
      if (carry) digit += direction * 6;
      result |= (digit & 15) << shift;
    }
    this.#state.flags.x = this.#state.flags.c = carry !== 0;
    this.#state.flags.z = this.#state.flags.z && result === 0;
    return result; // N/V are undefined in the manual; this model preserves them.
  }

  #bit(size: OperandSize, value: number, bit: number, change: BitChange | undefined): number | void {
    const mask = 2 ** (bit % size);
    this.#state.flags.z = (value & mask) === 0; // Test the original bit, before any change; preserve every other flag.
    if (change) return change(value, mask) >>> 0;
  }

  #logic(size: OperandSize, value: number): number {
    const result = value >>> 0;
    this.#setResultFlags(result, size);
    return result;
  }

  #add(size: OperandSize, left: number, right: number, extended = false): number {
    const zero = this.#state.flags.z;
    const { result, carry, overflow } = add(size, left, right, extended && this.#state.flags.x ? 1 : 0);
    this.#setResultFlags(result, size);
    this.#state.flags.x = this.#state.flags.c = carry;
    this.#state.flags.v = overflow;
    if (extended) this.#state.flags.z = zero && result === 0; // Preserve a nonzero earlier result.
    return result;
  }

  #subtract(size: OperandSize, left: number, right: number, extended = false): number {
    const zero = this.#state.flags.z;
    const result = this.#compare(size, left, right, extended && this.#state.flags.x ? 1 : 0);
    this.#state.flags.x = this.#state.flags.c;
    if (extended) this.#state.flags.z = zero && result === 0;
    return result;
  }

  #compare(size: OperandSize, left: number, right: number, borrowIn: 0 | 1 = 0): number {
    const facts = subtract(size, left, right, borrowIn);
    Object.assign(this.#state.flags, motorolaArithmeticFlags(size, facts));
    return facts.result;
  }

  #shift(kind: ShiftKind, left: boolean, size: OperandSize, value: number, count: number): number {
    const move = left ? shiftLeft : shiftRight;
    const sign = 2 ** (size - 1);
    let extend = this.#state.flags.x;
    let carry = kind === "extend" && extend; // A zero-count ROX copies X to C; other families clear C.
    let overflow = false;
    for (let bit = 0; bit < count; bit++) {
      let incoming = false;
      if (kind === "extend") incoming = extend;
      else if (kind === "rotate") incoming = left ? value >= sign : (value & 1) !== 0;
      else if (kind === "arithmetic" && !left) incoming = value >= sign;
      const shifted = move(size, value, incoming ? 1 : 0);
      // ASL remembers any sign change, even if later shifts restore the original sign.
      if (kind === "arithmetic" && left && (value >= sign) !== (shifted.result >= sign)) overflow = true;
      value = shifted.result;
      carry = shifted.carry;
      if (kind !== "rotate") extend = carry;
    }
    this.#setResultFlags(value, size); // Even a zero count replaces N/Z and clears V.
    this.#state.flags.x = extend;
    this.#state.flags.c = carry;
    this.#state.flags.v = overflow;
    return value;
  }

  #setResultFlags(value: number, size: OperandSize = 32): void {
    Object.assign(this.#state.flags, negativeZero(size, value), { v: false, c: false });
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

  #readMemory(size: OperandSize, address: number, readByte: ByteMemory["readByte"], stride = 1): number {
    let value = 0;
    for (let offset = 0; offset < size / 8; offset++) value = value * 0x100 + readByte(address + offset * stride);
    return value;
  }

  #writeMemory(size: OperandSize, address: number, value: number, writeByte: ByteMemory["writeByte"], stride = 1): void {
    for (let offset = 0; offset < size / 8; offset++) {
      writeByte(address + offset * stride, (value >>> (size - 8 - offset * 8)) & 0xff);
    }
  }
}
