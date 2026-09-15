import type { Ram } from "../memory/ram.js";
import { pairViews } from "./register-pairs.ts";
import { Cpu8080Family } from "./8080-family.ts";
import type { ByteOperation, WordOperand } from "./8080-family.ts";
import { flagRegister } from "./flags.ts";
import type { FetchedInstruction, StateTransition, InstructionStep, HaltedStep } from "./execution-records.ts";
import { signed8, readWordLE } from "./binary.ts";
import { executionBoundary } from "./execution-boundary.ts";
import { recordPorts } from "./port-access.ts";
import type { BytePorts, PortAccess } from "./port-access.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext } from "./instruction-context.ts";
import { defineState, copyState, readState, unsigned, flag, boolean, choices, group } from "./state.ts";
import type { StateValues, ReadonlyState } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.js";
import { add, subtract, shiftLeft, shiftRight, evenParity8 } from "./alu.ts";
import type { ShiftResult } from "./alu.ts";

const bankFields = defineState({
  a: unsigned(8), b: unsigned(8), c: unsigned(8), d: unsigned(8), e: unsigned(8), h: unsigned(8), l: unsigned(8),
  flags: group({ s: flag, z: flag, h: flag, pv: flag, n: flag, c: flag }),
});

/** Stored fields and constraints shared by construction, snapshots, and machine parsing. */
export const cpuZ80StateDescription = defineState({
  ...bankFields, alternate: group(bankFields),
  ix: unsigned(16), iy: unsigned(16), pc: unsigned(16), sp: unsigned(16), i: unsigned(8), r: unsigned(8),
  iff1: boolean, iff2: boolean, im: choices(0, 1, 2), halted: boolean,
});

export type CpuZ80State = StateValues<typeof cpuZ80StateDescription>;
/** The six documented flags; undocumented F bits 3 and 5 are outside this model. */
export type CpuZ80Flags = CpuZ80State["flags"];

export type CpuZ80RegisterBank = StateValues<typeof bankFields>;

export type CpuZ80BankSnapshot = ReadonlyState<CpuZ80RegisterBank> & {
  readonly bc: number;
  readonly de: number;
  readonly hl: number;
};

export type CpuZ80Snapshot = CpuZ80BankSnapshot &
  Readonly<Omit<CpuZ80State, keyof CpuZ80RegisterBank | "alternate">> & {
    readonly alternate: CpuZ80BankSnapshot;
  };

export type CpuZ80MemoryAccess = MemoryAccess;
export type CpuZ80Access = MemoryAccess | PortAccess;

export type CpuZ80Instruction = FetchedInstruction;

export type CpuZ80StepRecord = InstructionStep<CpuZ80Snapshot, CpuZ80Access> | HaltedStep<CpuZ80Snapshot, CpuZ80Access>;

export type CpuZ80ResetRecord = StateTransition<CpuZ80Snapshot>;

interface InstructionContext extends WordInstructionContext, BytePorts {}
type OpcodeHandler = (instruction: InstructionContext) => void;
type IndexRegister = "ix" | "iy";
type RegisterPair = WordOperand | IndexRegister;
type AddressedHandler = (address: number, instruction: InstructionContext) => void;
type CbOperation = { readonly bits: string; readonly apply: ByteOperation; readonly writes: boolean };

// Fix the handler type once so pattern callbacks infer their instruction context.
const instructionPattern = opcodePattern<OpcodeHandler>;

// F = S Z 0 H 0 PV N C. Unmodeled bits 5/3 pack as zero, not hardware constants.
const packedFlags = flagRegister({ s: 7, z: 6, h: 4, pv: 2, n: 1, c: 0 });

/** Instruction-level Zilog Z80 subset with documented flags and opcode-fetch R updates. */
export class CpuZ80 extends Cpu8080Family<CpuZ80State> {
  readonly #ram: Ram;
  readonly #ports: BytePorts | undefined;
  readonly #atBoundary = executionBoundary("Z80 step and reset calls must not be reentrant.");

  constructor(ram: Ram, initialState: CpuZ80State, ports?: BytePorts) {
    if (ram.size !== 0x10000) throw new RangeError("The Z80 model requires exactly 64 KiB of RAM.");
    super(readState(cpuZ80StateDescription, initialState));
    this.#ram = ram;
    this.#ports = ports;
  }

  /** Inspect detached register banks and their derived pair views without reading RAM. */
  snapshot(): CpuZ80Snapshot {
    const state = copyState(cpuZ80StateDescription, this.state);
    return { ...state, ...pairViews(state), alternate: { ...state.alternate, ...pairViews(state.alternate) } };
  }

  /** Apply documented reset effects, release HALT, and preserve other stored state and RAM. */
  reset(): CpuZ80ResetRecord {
    return this.#atBoundary(() => {
      const before = this.snapshot();
      this.state.pc = 0;
      this.state.i = 0;
      this.state.r = 0;
      this.state.iff1 = false;
      this.state.iff2 = false;
      this.state.im = 0;
      this.state.halted = false;
      return { before, after: this.snapshot(), accesses: [] };
    });
  }

  /** Attempt one instruction or block iteration; unsupported or already halted attempts preserve all state. */
  step(): CpuZ80StepRecord {
    return this.#atBoundary(() => {
      const before = this.snapshot();
      if (this.state.halted) {
        return { before, after: this.snapshot(), instruction: null, accesses: [], outcome: "halted" };
      }
      const accesses: CpuZ80Access[] = [];
      const recordAccess = (access: CpuZ80Access): void => { accesses.push(access); };
      const { readByte, writeByte } = recordMemory(this.#ram, recordAccess);
      const { readPort, writePort } = recordPorts(this.#ports, recordAccess);
      const address = this.state.pc;
      const opcode = readByte(address);
      const bytes = [opcode];
      // Decode the complete opcode before changing PC/R. Prefixes select only documented pages.
      const nextEncodingByte = (): number => {
        const byte = readByte((address + bytes.length) & 0xffff);
        bytes.push(byte);
        return byte;
      };
      let handler: OpcodeHandler | undefined;
      let opcodeFetches = 1;
      if (opcode === 0xcb || opcode === 0xed) {
        const operation = nextEncodingByte();
        handler = (opcode === 0xcb ? this.#cbOpcodeHandlers : this.#edOpcodeHandlers)[operation];
        opcodeFetches = 2;
      } else if (opcode === 0xdd || opcode === 0xfd) {
        const index = opcode === 0xdd ? "ix" : "iy";
        const operation = nextEncodingByte();
        opcodeFetches = 2;
        if (operation === 0xcb) {
          const displacement = nextEncodingByte(), bitOpcode = nextEncodingByte();
          const execute = this.#indexedCbHandlers[bitOpcode];
          // Only DD/FD and CB are M1 fetches; displacement and final opcode do not advance R.
          if (execute) handler = instruction => execute(this.#indexedAddress(index, displacement), instruction);
        } else handler = (index === "ix" ? this.#ixOpcodeHandlers : this.#iyOpcodeHandlers)[operation];
      } else handler = this.#opcodeHandlers[opcode];
      if (handler) {
        this.state.pc = (address + bytes.length) & 0xffff;
        // Operand fetches below are ordinary reads and do not increment R.
        this.state.r = (this.state.r & 0x80) | ((this.state.r + opcodeFetches) & 0x7f);
        const fetchByte = (): number => {
          const byte = readByte(this.state.pc);
          this.state.pc = (this.state.pc + 1) & 0xffff;
          bytes.push(byte);
          return byte;
        };
        handler({
          fetchByte,
          fetchWord: () => readWordLE(fetchByte),
          readByte,
          writeByte,
          readPort,
          writePort,
        });
      }
      const record = { instruction: { address, bytes }, before, after: this.snapshot(), accesses };
      return handler
        ? { ...record, outcome: this.state.halted ? "halted" : "executed" }
        : { ...record, outcome: "unsupported", reason: "opcode" };
    });
  }

  // Register views.

  protected override get statusWord(): number {
    return (this.state.a << 8) | packedFlags.encode(this.state.flags);
  }

  protected override set statusWord(value: number) {
    this.state.a = value >>> 8;
    this.state.flags = packedFlags.decode(value);
  }

  // Opcode selectors and construction.

  // rrr selects B/C/D/E/H/L/(HL)/A; port and indexed-register forms omit rrr=110.
  readonly #byteRegisters = this.byteOperands.flatMap((register, code) => register === "(hl)" ? []
    : [{ register, bits: code.toString(2).padStart(3, "0") }]);

  // bbb selects a bit number; bind its mask once when constructing the CB page.
  readonly #bitMasks = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80] as const;

  // ooo selects the ALU operation in both 10 ooo rrr and 11 ooo 110.
  // Operations read live state and return the next A; CP returns A unchanged.
  protected override readonly aluOperations: readonly ByteOperation[] = [
    value => this.#add(value), // 000 ADD
    value => this.#add(value, this.state.flags.c ? 1 : 0), // 001 ADC
    value => this.#subtract(value), // 010 SUB
    value => this.#subtract(value, this.state.flags.c ? 1 : 0), // 011 SBC
    value => this.#parityResult(this.state.a & value, { h: true, c: false }), // 100 AND
    value => this.#parityResult(this.state.a ^ value, { h: false, c: false }), // 101 XOR
    value => this.#parityResult(this.state.a | value, { h: false, c: false }), // 110 OR
    value => this.#compare(value), // 111 CP
  ];

  // ccc=ffv: ff selects Z/C/PV/S; v is the required value, giving NZ/Z/NC/C/PO/PE/P/M.
  // Conditional JR uses just the first four tests.
  protected override readonly conditions = (["z", "c", "pv", "s"] as const).flatMap(flag =>
    [false, true].map(value => () => this.state.flags[flag] === value));

  // 00 ooo 111: accumulator/carry operations, in encoded order.
  protected override readonly accumulatorOperations: readonly (() => void)[] = [
    () => this.#rotateAccumulator(shiftLeft(8, this.state.a, (this.state.a & 0x80) !== 0 ? 1 : 0)), // 000 RLCA
    () => this.#rotateAccumulator(shiftRight(8, this.state.a, (this.state.a & 1) !== 0 ? 1 : 0)), // 001 RRCA
    () => this.#rotateAccumulator(shiftLeft(8, this.state.a, this.state.flags.c ? 1 : 0)), // 010 RLA
    () => this.#rotateAccumulator(shiftRight(8, this.state.a, this.state.flags.c ? 1 : 0)), // 011 RRA
    () => this.#decimalAdjust(), // 100 DAA
    () => this.#complementAccumulator(), // 101 CPL
    () => this.#setCarry(), // 110 SCF
    () => this.#complementCarry(), // 111 CCF
  ];

  // Shared 8080 families are defined in 8080-family.ts; these fill documented Z80 extension slots.
  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    ...this.baseInstructions(),
    // 00 yyy 000: yyy=001 exchanges AF, 010 is DJNZ, 011 is JR, and 1cc is conditional JR.
    ...instructionPattern("00 001 000", () => this.#exchangeAf()), // EX AF,AF'
    ...instructionPattern("00 010 000", ({ fetchByte }) => this.#decrementAndJump(fetchByte())), // DJNZ e
    ...instructionPattern("00 011 000", ({ fetchByte }) => this.#jumpRelative(fetchByte(), true)), // JR e
    ...opcodeFamily("00 1cc 000", { c: this.conditions.slice(0, 4) }, ({ c: condition }) => ({ fetchByte }: InstructionContext) => this.#jumpRelative(fetchByte(), condition())), // JR NZ/Z/NC/C,e
    // 11 01 d 011: d=0 outputs, d=1 inputs; old A supplies address bits 15..8.
    ...instructionPattern("11 01 0 011", ({ fetchByte, writePort }) => writePort((this.state.a << 8) | fetchByte(), this.state.a)), // OUT (n),A
    ...instructionPattern("11 01 1 011", ({ fetchByte, readPort }) => { this.state.a = readPort((this.state.a << 8) | fetchByte()); }), // IN A,(n); preserve all flags
    ...instructionPattern("11 01 1 001", () => this.#exchangeGeneralBanks()), // EXX
  ]);

  // CB's xx yyy rrr: xx=00 selects a shift; xx=01/10/11 selects BIT/RES/SET.
  // yyy is the shift selector for xx=00, otherwise the bit number; rrr selects B/C/D/E/H/L/(HL)/A.
  // Share the 31 operations with indexed CB, whose documented forms fix rrr=110 (memory).
  readonly #cbOperations: readonly CbOperation[] = [
    { bits: "00 000", apply: value => this.#shiftLeft(value, (value & 0x80) !== 0 ? 1 : 0), writes: true }, // RLC
    { bits: "00 001", apply: value => this.#shiftRight(value, (value & 1) !== 0 ? 1 : 0), writes: true }, // RRC
    { bits: "00 010", apply: value => this.#shiftLeft(value, this.state.flags.c ? 1 : 0), writes: true }, // RL
    { bits: "00 011", apply: value => this.#shiftRight(value, this.state.flags.c ? 1 : 0), writes: true }, // RR
    { bits: "00 100", apply: value => this.#shiftLeft(value, 0), writes: true }, // SLA
    { bits: "00 101", apply: value => this.#shiftRight(value, (value & 0x80) !== 0 ? 1 : 0), writes: true }, // SRA
    // 00 110 is undocumented SLL.
    { bits: "00 111", apply: value => this.#shiftRight(value, 0), writes: true }, // SRL
    ...this.#bitMasks.flatMap((mask, bit): CbOperation[] => [
      { bits: `01 ${bit.toString(2).padStart(3, "0")}`, apply: value => { this.#testBit(mask, value); return value; }, writes: false }, // BIT b
      { bits: `10 ${bit.toString(2).padStart(3, "0")}`, apply: value => value & ~mask, writes: true }, // RES b
      { bits: `11 ${bit.toString(2).padStart(3, "0")}`, apply: value => value | mask, writes: true }, // SET b
    ]),
  ];
  readonly #cbOpcodeHandlers = opcodeTable<OpcodeHandler>(this.#cbOperations.flatMap(({ bits, apply, writes }) =>
    opcodeFamily(`${bits} rrr`, { r: this.byteOperands }, ({ r: operand }) => instruction => this.modifyOperand(operand, apply, instruction, writes))));
  readonly #indexedCbHandlers = opcodeTable<AddressedHandler>(this.#cbOperations.flatMap(({ bits, apply, writes }) =>
    opcodePattern<AddressedHandler>(`${bits} 110`, (address, instruction) => this.#modifyMemory(address, apply, instruction, writes))));

  // DD/FD share one documented page, selecting IX/IY. No ignored-prefix or IXH/IYL aliases.
  readonly #ixOpcodeHandlers = opcodeTable<OpcodeHandler>(this.#indexHandlers("ix"));
  readonly #iyOpcodeHandlers = opcodeTable<OpcodeHandler>(this.#indexHandlers("iy"));

  // ED's 01 yyy zzz: zzz selects the family; each family below explains yyy.
  readonly #edOpcodeHandlers = opcodeTable<OpcodeHandler>([
    // 01 rrr 00 d: rrr selects a register; d=0 inputs, d=1 outputs through old BC.
    // rrr=110 is undocumented IN (C)/OUT (C),0 and is deliberately omitted.
    ...this.#byteRegisters.flatMap(({ register, bits }) => [
      ...instructionPattern(`01 ${bits} 00 0`, ({ readPort }) => {
        this.state[register] = this.#parityResult(readPort(this.readPair("bc")), { h: false, c: this.state.flags.c });
      }), // IN r,(C); update S/Z/H/PV/N and preserve C
      ...instructionPattern(`01 ${bits} 00 1`, ({ writePort }) => writePort(this.readPair("bc"), this.state[register])), // OUT (C),r; preserve flags
    ]),
    // 01 pp q 010/011: pp=BC/DE/HL/SP; q selects SBC/ADC or store/load.
    ...opcodeFamily("01 pp q 010", { p: this.registerPairs, q: [true, false] },
      ({ p: pair, q: subtracting }) => () => this.#wordCarry(this.readPair(pair), subtracting)), // SBC / ADC HL,ss
    ...opcodeFamily("01 pp 0 011", { p: this.registerPairs }, ({ p: pair }) =>
      ({ fetchWord, writeByte }: InstructionContext) => this.writeMemoryWord(fetchWord(), this.readPair(pair), writeByte)), // LD (nn),dd
    ...opcodeFamily("01 pp 1 011", { p: this.registerPairs }, ({ p: pair }) =>
      ({ fetchWord, readByte }: InstructionContext) => this.writePair(pair, this.readMemoryWord(fetchWord(), readByte))), // LD dd,(nn)
    ...instructionPattern("01 000 100", () => this.#negate()), // NEG; other ED x4 aliases are undocumented
    // 01 0 d s 111: d=0 writes I/R from A, d=1 loads A; s=0 selects I, s=1 selects R.
    ...opcodeFamily("01 0 0 s 111", { s: ["i", "r"] }, ({ s }) => () => { this.state[s] = this.state.a; }), // LD I/R,A
    ...opcodeFamily("01 0 1 s 111", { s: ["i", "r"] }, ({ s }) => () => this.#loadSpecial(s)), // LD A,I/R
    ...instructionPattern("01 10 0 111", instruction => this.#rotateDigits(false, instruction)), // RRD
    ...instructionPattern("01 10 1 111", instruction => this.#rotateDigits(true, instruction)), // RLD
    // 101 r d 00 c: r repeats, d=0 increments/1 decrements, c=0 copies/1 compares.
    ...opcodeFamily("101 r d 00 c", { r: [false, true], d: [1, -1], c: [false, true] },
      ({ r: repeat, d: delta, c: compare }) => (instruction: InstructionContext) => this.#block(delta, compare, repeat, instruction)), // LDI/R, LDD/R, CPI/R, CPD/R
    // 101 r d 01 o: r repeats, d=0 increments/1 decrements HL, o=0 inputs/1 outputs.
    ...opcodeFamily("101 r d 01 o", { r: [false, true], d: [1, -1], o: [false, true] },
      ({ r: repeat, d: delta, o: output }) => (instruction: InstructionContext) => this.#blockIo(delta, output, repeat, instruction)), // INI/R, IND/R, OUTI/OTIR, OUTD/OTDR
    // Interrupt controls, IM, RETI, and RETN remain deferred.
  ]);

  #indexHandlers(index: IndexRegister): readonly OpcodeEntry<OpcodeHandler>[] {
    // 00 pp 1 001 replaces HL with the index in both destination and pp=10 source.
    const pairs = ["bc", "de", index, "sp"] as const;
    const address = ({ fetchByte }: InstructionContext): number => this.#indexedAddress(index, fetchByte());
    return [
      ...opcodeFamily("00 pp 1 001", { p: pairs }, ({ p: pair }) => () => this.#addWord(index, this.readPair(pair))), // ADD IX/IY,pp
      ...instructionPattern("00 10 0 001", ({ fetchWord }) => { this.state[index] = fetchWord(); }), // LD IX/IY,nn
      ...instructionPattern("00 10 0 010", ({ fetchWord, writeByte }) => this.writeMemoryWord(fetchWord(), this.state[index], writeByte)), // LD (nn),IX/IY
      ...instructionPattern("00 10 1 010", ({ fetchWord, readByte }) => { this.state[index] = this.readMemoryWord(fetchWord(), readByte); }), // LD IX/IY,(nn)
      ...opcodeFamily("00 10 q 011", { q: [1, -1] }, ({ q: delta }) => () => { this.state[index] = (this.state[index] + delta) & 0xffff; }), // INC/DEC IX/IY
      ...instructionPattern("00 110 100", instruction => this.#modifyMemory(address(instruction), value => this.adjustByte(value, 1), instruction)), // INC (IX/IY+d)
      ...instructionPattern("00 110 101", instruction => this.#modifyMemory(address(instruction), value => this.adjustByte(value, -1), instruction)), // DEC (IX/IY+d)
      ...instructionPattern("00 110 110", instruction => { const target = address(instruction); instruction.writeByte(target, instruction.fetchByte()); }), // LD (IX/IY+d),n; fetch d before n
      // 01 rrr 110 / 01 110 rrr transfer to/from the seven byte registers, including real H/L.
      ...this.#byteRegisters.flatMap(({ register, bits }) => [
        ...instructionPattern(`01 ${bits} 110`, instruction => { this.state[register] = instruction.readByte(address(instruction)); }), // LD r,(IX/IY+d)
        ...instructionPattern(`01 110 ${bits}`, instruction => instruction.writeByte(address(instruction), this.state[register])), // LD (IX/IY+d),r
      ]),
      ...opcodeFamily("10 ooo 110", { o: this.aluOperations }, ({ o: apply }) => (instruction: InstructionContext) => {
        this.state.a = apply(instruction.readByte(address(instruction)));
      }), // ALU (IX/IY+d)
      ...instructionPattern("11 10 0 001", ({ readByte }) => { this.state[index] = this.stack.pop(readByte); }), // POP IX/IY
      ...instructionPattern("11 10 1 001", () => this.jump(this.state[index])), // JP (IX/IY); no displacement or target read
      ...instructionPattern("11 100 011", instruction => { this.state[index] = this.exchangeStack(this.state[index], instruction); }), // EX (SP),IX/IY
      ...instructionPattern("11 10 0 101", ({ writeByte }) => this.stack.push(this.state[index], writeByte)), // PUSH IX/IY
      ...instructionPattern("11 11 1 001", () => { this.state.sp = this.state[index]; }), // LD SP,IX/IY
    ];
  }

  // Addressing, loads, and exchanges.

  #indexedAddress(index: IndexRegister, displacement: number): number {
    return (this.state[index] + signed8(displacement)) & 0xffff;
  }

  #loadSpecial(register: "i" | "r"): void {
    this.state.a = this.#aluResult(this.state[register], { h: false, pv: this.state.iff2, n: false, c: this.state.flags.c });
  }

  protected override readPair(pair: RegisterPair): number {
    return pair === "ix" || pair === "iy" ? this.state[pair] : super.readPair(pair);
  }

  protected override writePair(pair: RegisterPair, value: number): void {
    if (pair === "ix" || pair === "iy") this.state[pair] = value;
    else super.writePair(pair, value);
  }

  #exchangeAf(): void {
    const { alternate } = this.state;
    [this.state.a, alternate.a] = [alternate.a, this.state.a];
    [this.state.flags, alternate.flags] = [alternate.flags, this.state.flags];
  }

  #exchangeGeneralBanks(): void {
    const { alternate } = this.state;
    for (const register of ["b", "c", "d", "e", "h", "l"] as const) {
      [this.state[register], alternate[register]] = [alternate[register], this.state[register]];
    }
  }

  // Relative control flow.

  #jumpRelative(displacement: number, take: boolean): void {
    // Both paths fetch the operand; PC now points past both instruction bytes.
    if (take) {
      const offset = signed8(displacement);
      this.state.pc = (this.state.pc + offset) & 0xffff;
    }
  }

  #decrementAndJump(displacement: number): void {
    // DJNZ decrements B without applying DEC's flag changes.
    this.state.b = (this.state.b - 1) & 0xff;
    this.#jumpRelative(displacement, this.state.b !== 0);
  }

  // Arithmetic, logic, and flags.

  #shiftLeft(value: number, incomingBit: 0 | 1): number {
    const { result, carry } = shiftLeft(8, value, incomingBit);
    return this.#parityResult(result, { h: false, c: carry });
  }

  #shiftRight(value: number, incomingBit: 0 | 1): number {
    const { result, carry } = shiftRight(8, value, incomingBit);
    return this.#parityResult(result, { h: false, c: carry });
  }

  #rotateAccumulator({ result, carry }: ShiftResult): void {
    this.state.a = result;
    this.state.flags.c = carry;
    this.state.flags.h = this.state.flags.n = false;
    // Unlike CB rotates, these four instructions preserve S/Z/PV.
  }

  #decimalAdjust(): void {
    const { a, flags } = this.state;
    const carry = flags.c || a > 0x99;
    const correction = ((flags.h || (a & 0x0f) > 9) ? 0x06 : 0) | (carry ? 0x60 : 0);
    // The digit thresholds apply for every input state; N selects addition or subtraction of the correction.
    const result = (a + (flags.n ? -correction : correction)) & 0xff;
    this.state.a = this.#parityResult(result, { h: ((a ^ result) & 0x10) !== 0, c: carry });
    this.state.flags.n = flags.n;
  }

  #complementAccumulator(): void {
    this.state.a ^= 0xff;
    this.state.flags.h = this.state.flags.n = true;
  }

  #setCarry(): void {
    this.state.flags.c = true;
    this.state.flags.h = this.state.flags.n = false;
  }

  #complementCarry(): void {
    this.state.flags.h = this.state.flags.c;
    this.state.flags.c = !this.state.flags.c;
    this.state.flags.n = false;
  }

  protected override addToHl(value: number): void {
    this.#addWord("hl", value);
  }

  #addWord(pair: "hl" | IndexRegister, value: number): void {
    const left = this.readPair(pair);
    const { result, carry } = add(16, left, value);
    this.writePair(pair, result);
    // For this word operation H reports bit 11 to bit 12, not the shared adder's low-nibble carry.
    this.state.flags.h = (left & 0x0fff) + (value & 0x0fff) > 0x0fff;
    this.state.flags.c = carry;
    this.state.flags.n = false;
    // S/Z/PV are preserved, including when the result is zero or changes sign.
  }

  #wordCarry(value: number, subtracting: boolean): void {
    const left = this.hl, carryIn = this.state.flags.c ? 1 : 0;
    const arithmetic = subtracting ? subtract(16, left, value, carryIn) : add(16, left, value, carryIn);
    const half = subtracting ? (left & 0x0fff) < (value & 0x0fff) + carryIn
      : (left & 0x0fff) + (value & 0x0fff) + carryIn > 0x0fff;
    this.hl = arithmetic.result;
    this.state.flags = { s: arithmetic.result >= 0x8000, z: arithmetic.result === 0,
      h: half, pv: arithmetic.overflow, n: subtracting, c: "borrow" in arithmetic ? arithmetic.borrow : arithmetic.carry };
  }

  #negate(): void {
    const { result, borrow, halfBorrow, overflow } = subtract(8, 0, this.state.a);
    this.state.a = this.#aluResult(result, { h: halfBorrow, pv: overflow, n: true, c: borrow });
  }

  #rotateDigits(left: boolean, { readByte, writeByte }: InstructionContext): void {
    const address = this.hl, memory = readByte(address), a = this.state.a;
    const nextMemory = left ? ((memory << 4) | (a & 0x0f)) & 0xff : ((a & 0x0f) << 4) | (memory >>> 4);
    const nextA = (a & 0xf0) | (left ? memory >>> 4 : memory & 0x0f);
    writeByte(address, nextMemory);
    this.state.a = this.#parityResult(nextA, { h: false, c: this.state.flags.c });
  }

  #block(delta: -1 | 1, compare: boolean, repeat: boolean, { readByte, writeByte }: InstructionContext): void {
    const value = readByte(this.hl), count = (this.readPair("bc") - 1) & 0xffff;
    if (compare) {
      const { result, halfBorrow } = subtract(8, this.state.a, value);
      this.#aluResult(result, { h: halfBorrow, pv: count !== 0, n: true, c: this.state.flags.c });
    } else {
      writeByte(this.readPair("de"), value);
      this.writePair("de", (this.readPair("de") + delta) & 0xffff);
      this.state.flags.h = this.state.flags.n = false;
      this.state.flags.pv = count !== 0;
    }
    this.hl = (this.hl + delta) & 0xffff;
    this.writePair("bc", count);
    // One iteration per step; repeating refetches both opcode bytes and advances R twice again.
    if (repeat && count !== 0 && (!compare || !this.state.flags.z)) this.state.pc = (this.state.pc - 2) & 0xffff;
  }

  // Block I/O: inputs use BC before decrementing B; outputs use BC afterward.

  #blockIo(delta: -1 | 1, output: boolean, repeat: boolean, { readByte, writeByte, readPort, writePort }: InstructionContext): void {
    const address = this.hl;
    const value = output ? readByte(address) : readPort(this.readPair("bc"));
    this.state.b = (this.state.b - 1) & 0xff;
    if (output) writePort(this.readPair("bc"), value);
    else writeByte(address, value);
    this.hl = (address + delta) & 0xffff;
    // NMOS block flags: input adds adjusted C; output adds L after HL changes.
    const sum = value + (output ? this.state.l : (this.state.c + delta) & 0xff);
    const carry = sum > 0xff;
    this.#aluResult(this.state.b, { h: carry, pv: evenParity8((sum & 7) ^ this.state.b), n: value >= 0x80, c: carry });
    if (repeat && this.state.b !== 0) {
      this.state.pc = (this.state.pc - 2) & 0xffff;
      this.#blockIoRepeatFlags();
    }
  }

  #blockIoRepeatFlags(): void {
    // The repeat phase also changes H/PV; snapshots expose this between iterations.
    const { b, flags } = this.state;
    let parityOperand = b;
    if (flags.c) {
      parityOperand += flags.n ? -1 : 1;
      flags.h = (b & 0x0f) === (flags.n ? 0 : 0x0f);
    }
    // Even adjustment parity preserves P/V; odd parity inverts it.
    flags.pv = flags.pv === evenParity8(parityOperand & 7);
  }

  #testBit(mask: number, value: number): void {
    const tested = value & mask;
    // The manual leaves S/PV unspecified. Model the observed Z80 behavior: S from bit 7, PV = Z.
    this.state.flags.s = (tested & 0x80) !== 0;
    this.state.flags.z = tested === 0;
    this.state.flags.h = true;
    this.state.flags.pv = tested === 0;
    this.state.flags.n = false;
    // BIT preserves C; RES and SET preserve every flag.
  }

  protected override adjustByte(value: number, delta: -1 | 1): number {
    const result = (value + delta) & 0xff;
    this.state.flags.s = (result & 0x80) !== 0;
    this.state.flags.z = result === 0;
    // INC carries out of bit 3; DEC borrows from bit 4. Both preserve C.
    this.state.flags.h = delta === 1 ? (value & 0x0f) === 0x0f : (value & 0x0f) === 0;
    this.state.flags.pv = value === (delta === 1 ? 0x7f : 0x80);
    this.state.flags.n = delta === -1;
    return result;
  }

  #add(value: number, carryIn: 0 | 1 = 0): number {
    const { result, carry, halfCarry, overflow } = add(8, this.state.a, value, carryIn);
    return this.#aluResult(result, { h: halfCarry, pv: overflow, n: false, c: carry });
  }

  #subtract(value: number, borrowIn: 0 | 1 = 0): number {
    const { result, borrow, halfBorrow, overflow } = subtract(8, this.state.a, value, borrowIn);
    // Z80 H and C both report borrows; N identifies subtraction.
    return this.#aluResult(result, { h: halfBorrow, pv: overflow, n: true, c: borrow });
  }

  // Logic and CB shifts use parity; DAA restores N from its input afterward.
  #parityResult(result: number, { h, c }: Pick<CpuZ80Flags, "h" | "c">): number {
    return this.#aluResult(result, { h, pv: evenParity8(result), n: false, c });
  }

  #aluResult(result: number, flags: Omit<CpuZ80Flags, "s" | "z">): number {
    this.state.flags = { s: (result & 0x80) !== 0, z: result === 0, ...flags };
    return result;
  }

  #compare(value: number): number {
    this.#subtract(value);
    return this.state.a;
  }

  // Indexed memory operands. BIT reads without writing.

  #modifyMemory(address: number, operation: ByteOperation, { readByte, writeByte }: InstructionContext, writes = true): void {
    const value = operation(readByte(address));
    if (writes) writeByte(address, value);
  }
}
