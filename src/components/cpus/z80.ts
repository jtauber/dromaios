import { instructions as semantics } from "./generated/z80.ts";
import { cpuZ80StateDescription } from "./state/z80.ts";
import type { CpuZ80State, CpuZ80Flags, CpuZ80RegisterBank } from "./state/z80.ts";
import type { Ram } from "../memory/ram.js";
import { pairViews } from "./register-pairs.ts";
import { Cpu8080Family } from "./8080-family.ts";
import type { AluInstruction, ByteInstruction, WordOperand } from "./8080-family.ts";
import { flagRegister } from "./flags.ts";
import type { FetchedInstruction, StateTransition, InstructionStep, HaltedStep } from "./execution-records.ts";
import { signed8, readWordLE } from "./binary.ts";
import { executionBoundary } from "./execution-boundary.ts";
import { recordInterruptInstruction } from "./interrupt-instruction.ts";
import type { InterruptInstruction, InterruptAcknowledge } from "./interrupt-instruction.ts";
import { recordPorts } from "./port-access.ts";
import type { BytePorts, PortAccess } from "./port-access.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext } from "./instruction-context.ts";
import { copyState, readState } from "./state.ts";
import type { ReadonlyState } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.js";
import { add, subtract, evenParity8 } from "./alu.ts";

export { cpuZ80StateDescription } from "./state/z80.ts";
export type { CpuZ80State, CpuZ80Flags, CpuZ80RegisterBank } from "./state/z80.ts";

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

export type CpuZ80InterruptSource = "irq" | "nmi";
export type CpuZ80InterruptAccess = CpuZ80Access | InterruptAcknowledge;

/** Mode 0 executes externally supplied bytes, without inventing a RAM fetch address. */
export type CpuZ80InterruptInstruction = InterruptInstruction;

export type CpuZ80InterruptRecord = StateTransition<CpuZ80Snapshot, CpuZ80InterruptAccess> & (
  | { readonly source: CpuZ80InterruptSource; readonly outcome: "ignored"; readonly reason: "deferred"; readonly instruction: null }
  | { readonly source: "irq"; readonly outcome: "ignored"; readonly reason: "disabled"; readonly instruction: null }
  | { readonly source: CpuZ80InterruptSource; readonly outcome: "accepted"; readonly instruction: null }
  | { readonly source: "irq"; readonly outcome: "executed" | "halted"; readonly instruction: CpuZ80InterruptInstruction }
  | { readonly source: "irq"; readonly outcome: "unsupported"; readonly reason: "opcode"; readonly instruction: CpuZ80InterruptInstruction }
);

interface InstructionContext extends WordInstructionContext, BytePorts {
  readonly deferInterrupt: () => void;
  readonly notifyReti: () => void;
}
type OpcodeHandler = (instruction: InstructionContext) => void;
type IndexRegister = "ix" | "iy";
type RegisterPair = WordOperand | IndexRegister;
type AddressedHandler = (address: number, instruction: InstructionContext) => void;

// Fix the handler type once so pattern callbacks infer their instruction context.
const instructionPattern = opcodePattern<OpcodeHandler>;

// F = S Z 0 H 0 PV N C. Unmodeled bits 5/3 pack as zero, not hardware constants.
const packedFlags = flagRegister({ s: 7, z: 6, h: 4, pv: 2, n: 1, c: 0 });

/** Instruction-level Zilog Z80 with documented opcodes and boundary IRQ/NMI delivery. */
export class CpuZ80 extends Cpu8080Family<CpuZ80State> {
  readonly #ram: Ram;
  readonly #ports: BytePorts | undefined;
  readonly #onReti: (() => void) | undefined;
  readonly #atBoundary = executionBoundary("Z80 step, reset, and interrupt calls must not be reentrant.");

  constructor(ram: Ram, initialState: CpuZ80State, ports?: BytePorts, onReti?: () => void) {
    if (ram.size !== 0x10000) throw new RangeError("The Z80 model requires exactly 64 KiB of RAM.");
    super(readState(cpuZ80StateDescription, initialState));
    this.#ram = ram;
    this.#ports = ports;
    this.#onReti = onReti;
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
      this.state.interruptDeferred = this.state.nmiDeferred = false;
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
      const { handler, opcodeFetches } = this.#decode(opcode, nextEncodingByte);
      if (handler) {
        this.state.pc = (address + bytes.length) & 0xffff;
        // Operand fetches below are ordinary reads and do not increment R.
        this.#refresh(opcodeFetches);
        const fetchByte = (): number => {
          const byte = readByte(this.state.pc);
          this.state.pc = (this.state.pc + 1) & 0xffff;
          bytes.push(byte);
          return byte;
        };
        this.#executeHandler(handler, {
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

  /** Offer a selected request; ignored offers neither acknowledge nor queue an interrupt. */
  interrupt(source: "nmi"): CpuZ80InterruptRecord;
  interrupt(source: "irq", acknowledge: () => number): CpuZ80InterruptRecord;
  interrupt(source: CpuZ80InterruptSource, acknowledge?: () => number): CpuZ80InterruptRecord {
    return this.#atBoundary<CpuZ80InterruptRecord>(() => {
      if (source !== "irq" && source !== "nmi") throw new RangeError("Z80 interrupt source must be irq or nmi.");
      if (source === "irq" && typeof acknowledge !== "function") throw new TypeError("Z80 IRQ requires an acknowledgement callback.");
      const before = this.snapshot();
      if (source === "irq" && !this.state.iff1) {
        return { before, after: this.snapshot(), instruction: null, accesses: [], source, outcome: "ignored", reason: "disabled" };
      }
      if (source === "nmi" ? this.state.nmiDeferred : this.state.interruptDeferred) {
        return { before, after: this.snapshot(), instruction: null, accesses: [], source, outcome: "ignored", reason: "deferred" };
      }
      const accesses: CpuZ80InterruptAccess[] = [];
      const recordAccess = (access: CpuZ80InterruptAccess): void => { accesses.push(access); };
      const { readByte, writeByte } = recordMemory(this.#ram, recordAccess);
      // Acceptance precedes device and stack access. NMI preserves IFF2, including nested NMI.
      this.state.halted = false;
      this.state.iff1 = false;
      this.#refresh(1);
      if (source === "nmi") {
        this.state.nmiDeferred = true;
        this.stack.call(0x0066, writeByte);
      } else {
        this.state.iff2 = false;
        this.state.interruptDeferred = false;
        const { instruction, fetchByte } = recordInterruptInstruction(acknowledge!, recordAccess);
        const opcode = fetchByte();
        if (this.state.im === 0) {
          const { handler } = this.#decode(opcode, (opcodeFetch = true) => {
            if (opcodeFetch) this.#refresh(1);
            return fetchByte();
          });
          if (handler) {
            const { readPort, writePort } = recordPorts(this.#ports, recordAccess);
            this.#executeHandler(handler, { readByte, writeByte, readPort, writePort, fetchByte, fetchWord: () => readWordLE(fetchByte) });
          }
          const record = { before, after: this.snapshot(), instruction, accesses, source };
          return handler
            ? { ...record, outcome: this.state.halted ? "halted" : "executed" }
            : { ...record, outcome: "unsupported", reason: "opcode" };
        }
        // IM 1 acknowledges but ignores the byte; IM 2 reads its vector AFTER pushing PC.
        this.stack.push(this.state.pc, writeByte);
        this.state.pc = this.state.im === 1 ? 0x0038 : this.readMemoryWord((this.state.i << 8) | opcode, readByte);
      }
      return { before, after: this.snapshot(), instruction: null, accesses, source, outcome: "accepted" };
    });
  }

  // Instruction decoding, retirement, and interrupt returns.

  #decode(opcode: number, nextByte: (opcodeFetch?: boolean) => number): { handler: OpcodeHandler | undefined; opcodeFetches: number } {
    if (opcode === 0xcb || opcode === 0xed) {
      return { handler: (opcode === 0xcb ? this.#cbOpcodeHandlers : this.#edOpcodeHandlers)[nextByte()], opcodeFetches: 2 };
    }
    if (opcode === 0xdd || opcode === 0xfd) {
      const index = opcode === 0xdd ? "ix" : "iy", operation = nextByte();
      if (operation === 0xcb) {
        // Displacement and final indexed-CB opcode are not M1 fetches.
        const displacement = nextByte(false), execute = this.#indexedCbHandlers[nextByte(false)];
        return { handler: execute && (instruction => execute(this.#indexedAddress(index, displacement), instruction)), opcodeFetches: 2 };
      }
      return { handler: (index === "ix" ? this.#ixOpcodeHandlers : this.#iyOpcodeHandlers)[operation], opcodeFetches: 2 };
    }
    return { handler: this.#opcodeHandlers[opcode], opcodeFetches: 1 };
  }

  #refresh(count: number): void {
    this.state.r = (this.state.r & 0x80) | ((this.state.r + count) & 0x7f);
  }

  #executeHandler(handler: OpcodeHandler, context: WordInstructionContext & BytePorts): void {
    let deferred = false, reti = false;
    handler({ ...context, deferInterrupt: () => { deferred = true; }, notifyReti: () => { reti = true; } });
    // A retired instruction consumes old inhibition; EI or an IFF-changing return renews IRQ inhibition.
    this.state.interruptDeferred = deferred;
    this.state.nmiDeferred = false;
    // Notify after architectural retirement; device failure cannot undo the completed return.
    if (reti) this.#onReti?.();
  }

  #returnFromInterrupt(notify: boolean, { readByte, deferInterrupt, notifyReti }: InstructionContext): void {
    this.stack.return(readByte);
    if (this.state.iff1 !== this.state.iff2) deferInterrupt();
    this.state.iff1 = this.state.iff2;
    if (notify) notifyReti();
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

  protected override readonly transfers = semantics;

  // d in 00 rrr 10d selects INC/DEC; the same memory bodies serve HL and resolved IX/IY operands.
  protected override readonly byteAdjustments: readonly ByteInstruction[] = (["inc", "dec"] as const).map(operation => operand => {
    const suffix = { b: "B", c: "C", d: "D", e: "E", h: "H", l: "L", a: "A" } as const;
    return operand === "(hl)" ? instruction => semantics[`${operation}Memory`](this.state, this.hl, instruction)
      : () => semantics[`${operation}${suffix[operand]}`](this.state);
  });

  // rrr selects B/C/D/E/H/L/(HL)/A; port and indexed-register forms omit rrr=110.
  readonly #byteRegisters = this.byteOperands.flatMap((register, code) => register === "(hl)" ? []
    : [{ register, suffix: ({ b: "B", c: "C", d: "D", e: "E", h: "H", l: "L", a: "A" } as const)[register], bits: code.toString(2).padStart(3, "0") }]);

  // ooo in 10 ooo rrr / 11 ooo 110 selects the same ALU family, including DD/FD memory forms.
  readonly #aluFamilies = ["add", "adc", "sub", "sbc", "and", "xor", "or", "cp"] as const;
  protected override readonly aluInstructions: readonly AluInstruction[] = this.#aluFamilies.map(operation => operand => {
    const suffix = { b: "B", c: "C", d: "D", e: "E", h: "H", l: "L", "(hl)": "M", a: "A", immediate: "Immediate" } as const;
    const execute = semantics[`${operation}${suffix[operand]}`];
    return instruction => execute(this.state, instruction);
  });

  // ccc=ffv: ff selects Z/C/PV/S; v is the required value, giving NZ/Z/NC/C/PO/PE/P/M.
  // Conditional JR uses just the first four tests.
  protected override readonly conditions = (["z", "c", "pv", "s"] as const).flatMap(flag =>
    [false, true].map(value => () => this.state.flags[flag] === value));

  // 00 ooo 111: accumulator/carry operations, in encoded order.
  protected override readonly accumulatorOperations: readonly (() => void)[] = [
    () => semantics.rlca(this.state), // 000 RLCA
    () => semantics.rrca(this.state), // 001 RRCA
    () => semantics.rla(this.state), // 010 RLA
    () => semantics.rra(this.state), // 011 RRA
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
    // 11 11 e 011: e selects DI/EI; EI inhibits IRQ through the following instruction.
    ...instructionPattern("11 11 0 011", () => { this.state.iff1 = this.state.iff2 = false; }), // DI
    ...instructionPattern("11 11 1 011", ({ deferInterrupt }) => { this.state.iff1 = this.state.iff2 = true; deferInterrupt(); }), // EI
  ]);

  // CB's xx yyy rrr: xx=00 selects a shift; xx=01/10/11 selects BIT/RES/SET.
  // yyy is the shift selector for xx=00, otherwise the bit number; rrr selects B/C/D/E/H/L/(HL)/A.
  // Indexed CB fixes rrr=110 (memory); each generated memory body receives one resolved address.
  readonly #cbOperations = [
    { bits: "00 000", name: "rlc" }, { bits: "00 001", name: "rrc" },
    { bits: "00 010", name: "rl" }, { bits: "00 011", name: "rr" },
    { bits: "00 100", name: "sla" }, { bits: "00 101", name: "sra" },
    // yyy=110 is undocumented SLL.
    { bits: "00 111", name: "srl" },
    ...([0, 1, 2, 3, 4, 5, 6, 7] as const).flatMap(bit => [
      { bits: `01 ${bit.toString(2).padStart(3, "0")}`, name: `bit${bit}` as const },
      { bits: `10 ${bit.toString(2).padStart(3, "0")}`, name: `res${bit}` as const },
      { bits: `11 ${bit.toString(2).padStart(3, "0")}`, name: `set${bit}` as const },
    ]),
  ] as const;
  readonly #cbOpcodeHandlers = opcodeTable<OpcodeHandler>(this.#cbOperations.flatMap(({ bits, name }) => opcodeFamily(`${bits} rrr`,
    { r: ["B", "C", "D", "E", "H", "L", "Memory", "A"] as const }, ({ r: target }): OpcodeHandler => target === "Memory"
      ? instruction => semantics[`${name}Memory`](this.state, this.hl, instruction) : () => semantics[`${name}${target}`](this.state))));
  readonly #indexedCbHandlers = opcodeTable<AddressedHandler>(this.#cbOperations.flatMap(({ bits, name }) =>
    opcodePattern<AddressedHandler>(`${bits} 110`, (address, instruction) => semantics[`${name}Memory`](this.state, address, instruction))));

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
    // d=0 stores, d=1 loads; ED's HL forms share the unprefixed bodies.
    ...opcodeFamily("01 pp d 011", { p: [
      [semantics.storeBCMemory, semantics.loadBCMemory], [semantics.storeDEMemory, semantics.loadDEMemory],
      [semantics[0x22], semantics[0x2a]], [semantics.storeSPMemory, semantics.loadSPMemory],
    ], d: [0, 1] }, ({ p: operations, d: direction }) => (instruction: InstructionContext) => operations[direction]!(this.state, instruction)), // LD (nn),dd / LD dd,(nn)
    ...instructionPattern("01 000 100", () => this.#negate()), // NEG; other ED x4 aliases are undocumented
    // 01 00 n 101: both returns restore IFF1 from IFF2; n=1 also notifies the device.
    ...instructionPattern("01 00 0 101", instruction => this.#returnFromInterrupt(false, instruction)), // RETN
    ...instructionPattern("01 00 1 101", instruction => this.#returnFromInterrupt(true, instruction)), // RETI
    // 01 0 mm 110: documented mode selectors 00/10/11 mean IM 0/1/2; 01 is an alias.
    ...([{ bits: "00", mode: 0 }, { bits: "10", mode: 1 }, { bits: "11", mode: 2 }] as const).flatMap(({ bits, mode }) =>
      instructionPattern(`01 0 ${bits} 110`, () => { this.state.im = mode; })), // IM 0/1/2
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
  ]);

  #indexHandlers(index: IndexRegister): readonly OpcodeEntry<OpcodeHandler>[] {
    // 00 pp 1 001 replaces HL with the index in both destination and pp=10 source.
    const pairs = ["bc", "de", index, "sp"] as const;
    const suffix = index === "ix" ? "IX" : "IY";
    const address = ({ fetchByte }: InstructionContext): number => this.#indexedAddress(index, fetchByte());
    return [
      ...opcodeFamily("00 pp 1 001", { p: pairs }, ({ p: pair }) => () => this.#addWord(index, this.readPair(pair))), // ADD IX/IY,pp
      ...instructionPattern("00 10 0 001", instruction => semantics[`immediate${suffix}Word`](this.state, instruction)), // LD IX/IY,nn
      ...instructionPattern("00 10 0 010", instruction => semantics[`store${suffix}Word`](this.state, instruction)), // LD (nn),IX/IY
      ...instructionPattern("00 10 1 010", instruction => semantics[`load${suffix}Word`](this.state, instruction)), // LD IX/IY,(nn)
      ...opcodeFamily("00 10 q 011", { q: [1, -1] }, ({ q: delta }) => () => { this.state[index] = (this.state[index] + delta) & 0xffff; }), // INC/DEC IX/IY
      ...instructionPattern("00 110 100", instruction => semantics.incMemory(this.state, address(instruction), instruction)), // INC (IX/IY+d)
      ...instructionPattern("00 110 101", instruction => semantics.decMemory(this.state, address(instruction), instruction)), // DEC (IX/IY+d)
      ...instructionPattern("00 110 110", instruction => semantics.storeImmediateMemory(this.state, address(instruction), instruction)), // LD (IX/IY+d),n; fetch d before n
      // 01 rrr 110 / 01 110 rrr transfer to/from the seven byte registers, including real H/L.
      ...this.#byteRegisters.flatMap(({ suffix, bits }) => [
        ...instructionPattern(`01 ${bits} 110`, instruction => semantics[`load${suffix}Memory`](this.state, address(instruction), instruction)), // LD r,(IX/IY+d)
        ...instructionPattern(`01 110 ${bits}`, instruction => semantics[`store${suffix}Memory`](this.state, address(instruction), instruction)), // LD (IX/IY+d),r
      ]),
      ...opcodeFamily("10 ooo 110", { o: this.#aluFamilies }, ({ o: operation }) => (instruction: InstructionContext) =>
        semantics[`${operation}Memory`](this.state, address(instruction), instruction)), // ALU (IX/IY+d)
      ...instructionPattern("11 10 0 001", ({ readByte }) => { this.state[index] = this.stack.pop(readByte); }), // POP IX/IY
      ...instructionPattern("11 10 1 001", () => this.jump(this.state[index])), // JP (IX/IY); no displacement or target read
      ...instructionPattern("11 100 011", instruction => { this.state[index] = this.exchangeStack(this.state[index], instruction); }), // EX (SP),IX/IY
      ...instructionPattern("11 10 0 101", ({ writeByte }) => this.stack.push(this.state[index], writeByte)), // PUSH IX/IY
      ...instructionPattern("11 11 1 001", () => semantics[`copy${suffix}Word`](this.state)), // LD SP,IX/IY
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

  // DAA, digit rotates, and port inputs use parity; DAA restores N from its input afterward.
  #parityResult(result: number, { h, c }: Pick<CpuZ80Flags, "h" | "c">): number {
    return this.#aluResult(result, { h, pv: evenParity8(result), n: false, c });
  }

  #aluResult(result: number, flags: Omit<CpuZ80Flags, "s" | "z">): number {
    this.state.flags = { s: (result & 0x80) !== 0, z: result === 0, ...flags };
    return result;
  }
}
