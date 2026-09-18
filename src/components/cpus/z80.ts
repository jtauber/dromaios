import { instructions as semantics } from "./generated/z80.ts";
import { cpuZ80StateDescription } from "./state/z80.ts";
import type { CpuZ80State, CpuZ80RegisterBank } from "./state/z80.ts";
import type { Ram } from "../memory/ram.js";
import { pairViews } from "./register-pairs.ts";
import { callStack16LE } from "./call-stack.ts";
import { Cpu8080Family } from "./8080-family.ts";
import type { AluInstruction, ByteInstruction } from "./8080-family.ts";
import type { FetchedInstruction, StateTransition, InstructionStep, HaltedStep } from "./execution-records.ts";
import { signed8, readWordLE } from "./binary.ts";
import { executionBoundary } from "./execution-boundary.ts";
import { recordInterruptInstruction } from "./interrupt-instruction.ts";
import type { InterruptInstruction, InterruptAcknowledge } from "./interrupt-instruction.ts";
import { recordPorts } from "./port-access.ts";
import type { BytePorts, PortAccess } from "./port-access.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext, InterruptDeferralContext, RetiNotificationContext } from "./instruction-context.ts";
import { copyState, readState } from "./state.ts";
import type { ReadonlyState } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.js";

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

interface InstructionContext extends WordInstructionContext, BytePorts, InterruptDeferralContext<"irq">, RetiNotificationContext {}
type OpcodeHandler = (instruction: InstructionContext) => void;
type IndexRegister = "ix" | "iy";
type AddressedHandler = (address: number, instruction: InstructionContext) => void;

// Fix the handler type once so pattern callbacks infer their instruction context.
const instructionPattern = opcodePattern<OpcodeHandler>;

/** Instruction-level Zilog Z80 with documented opcodes and boundary IRQ/NMI delivery. */
export class CpuZ80 extends Cpu8080Family<CpuZ80State> {
  readonly #stack = callStack16LE(this.state);
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
        this.#stack.call(0x0066, writeByte);
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
        this.#stack.push(this.state.pc, writeByte);
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

  // Opcode selectors and construction.

  protected override readonly generatedInstructions = semantics;

  // d in 00 rrr 10d selects INC/DEC; the same memory bodies serve HL and resolved IX/IY operands.
  protected override readonly byteAdjustments: readonly ByteInstruction[] = (["inc", "dec"] as const).map(operation => operand => {
    const suffix = { b: "B", c: "C", d: "D", e: "E", h: "H", l: "L", a: "A" } as const;
    return operand === "(hl)" ? instruction => semantics[`${operation}Memory`](this.state, this.hl, instruction)
      : () => semantics[`${operation}${suffix[operand]}`](this.state);
  });

  // rrr selects B/C/D/E/H/L/(HL)/A; port and indexed-register forms omit rrr=110.
  readonly #byteRegisters = this.byteOperands.flatMap((register, code) => register === "(hl)" ? []
    : [{ suffix: ({ b: "B", c: "C", d: "D", e: "E", h: "H", l: "L", a: "A" } as const)[register], bits: code.toString(2).padStart(3, "0") }]);

  // ooo in 10 ooo rrr / 11 ooo 110 selects the same ALU family, including DD/FD memory forms.
  readonly #aluFamilies = ["add", "adc", "sub", "sbc", "and", "xor", "or", "cp"] as const;
  protected override readonly aluInstructions: readonly AluInstruction[] = this.#aluFamilies.map(operation => operand => {
    const suffix = { b: "B", c: "C", d: "D", e: "E", h: "H", l: "L", "(hl)": "M", a: "A", immediate: "Immediate" } as const;
    const execute = semantics[`${operation}${suffix[operand]}`];
    return instruction => execute(this.state, instruction);
  });

  // 00 ooo 111: accumulator/carry operations, in encoded order.
  protected override readonly accumulatorOperations: readonly (() => void)[] = [
    () => semantics.rlca(this.state), // 000 RLCA
    () => semantics.rrca(this.state), // 001 RRCA
    () => semantics.rla(this.state), // 010 RLA
    () => semantics.rra(this.state), // 011 RRA
    () => semantics[0x27](this.state), // 100 DAA
    () => semantics[0x2f](this.state), // 101 CPL
    () => semantics[0x37](this.state), // 110 SCF
    () => semantics[0x3f](this.state), // 111 CCF
  ];

  // Shared 8080 families are defined in 8080-family.ts; these fill documented Z80 extension slots.
  readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    ...this.baseInstructions(),
    // 00 yyy 000: yyy=001 exchanges AF, 010 is DJNZ, 011 is JR, and 1cc is conditional JR.
    ...instructionPattern("00 001 000", () => semantics.exchangeAf(this.state)), // EX AF,AF'
    ...instructionPattern("00 010 000", instruction => semantics.djnz(this.state, instruction)), // DJNZ e
    ...instructionPattern("00 011 000", instruction => semantics.jr(this.state, instruction)), // JR e
    ...opcodeFamily("00 1cc 000", { c: [semantics.jrNZ, semantics.jrZ, semantics.jrNC, semantics.jrC] },
      ({ c: execute }) => (instruction: InstructionContext) => execute(this.state, instruction)), // JR NZ/Z/NC/C,e
    // 11 01 d 011: d=0 outputs, d=1 inputs; old A supplies address bits 15..8.
    ...instructionPattern("11 01 0 011", instruction => semantics.output(this.state, instruction)), // OUT (n),A
    ...instructionPattern("11 01 1 011", instruction => semantics.input(this.state, instruction)), // IN A,(n); preserve all flags
    ...instructionPattern("11 01 1 001", () => semantics.exchangeGeneralBanks(this.state)), // EXX
    // 11 11 e 011: e selects DI/EI; EI inhibits IRQ through the following instruction.
    ...instructionPattern("11 11 0 011", () => semantics.di(this.state)), // DI
    ...instructionPattern("11 11 1 011", instruction => semantics.ei(this.state, instruction)), // EI
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
    ...this.#byteRegisters.flatMap(({ suffix, bits }) => [
      ...instructionPattern(`01 ${bits} 00 0`, instruction => semantics[`input${suffix}`]!(this.state, instruction)), // IN r,(C)
      ...instructionPattern(`01 ${bits} 00 1`, instruction => semantics[`output${suffix}`]!(this.state, instruction)), // OUT (C),r
    ]),
    // 01 pp q 010/011: pp=BC/DE/HL/SP; q selects SBC/ADC or store/load.
    ...opcodeFamily("01 pp q 010", { p: ["BC", "DE", "HL", "SP"], q: ["sbc", "adc"] },
      ({ p: pair, q: operation }) => () => semantics[`${operation}HL${pair}`]!(this.state)), // SBC / ADC HL,ss
    // d=0 stores, d=1 loads; ED's HL forms share the unprefixed bodies.
    ...opcodeFamily("01 pp d 011", { p: [
      [semantics.storeBCMemory, semantics.loadBCMemory], [semantics.storeDEMemory, semantics.loadDEMemory],
      [semantics[0x22], semantics[0x2a]], [semantics.storeSPMemory, semantics.loadSPMemory],
    ], d: [0, 1] }, ({ p: operations, d: direction }) => (instruction: InstructionContext) => operations[direction]!(this.state, instruction)), // LD (nn),dd / LD dd,(nn)
    ...instructionPattern("01 000 100", () => semantics.neg(this.state)), // NEG; other ED x4 aliases are undocumented
    // 01 00 n 101: both returns restore IFF1 from IFF2; n=1 also notifies the device.
    ...instructionPattern("01 00 0 101", instruction => semantics.retn(this.state, instruction)), // RETN
    ...instructionPattern("01 00 1 101", instruction => semantics.reti(this.state, instruction)), // RETI
    // 01 0 mm 110: documented mode selectors 00/10/11 mean IM 0/1/2; 01 is an alias.
    ...([{ bits: "00", mode: 0 }, { bits: "10", mode: 1 }, { bits: "11", mode: 2 }] as const).flatMap(({ bits, mode }) =>
      instructionPattern(`01 0 ${bits} 110`, () => semantics[`im${mode}`](this.state))), // IM 0/1/2
    // 01 0 d s 111: d=0 writes I/R from A, d=1 loads A; s=0 selects I, s=1 selects R.
    ...opcodeFamily("01 0 0 s 111", { s: [semantics.loadIFromA, semantics.loadRFromA] }, ({ s: execute }) => () => execute(this.state)), // LD I/R,A
    ...opcodeFamily("01 0 1 s 111", { s: [semantics.loadAFromI, semantics.loadAFromR] }, ({ s: execute }) => () => execute(this.state)), // LD A,I/R
    ...instructionPattern("01 10 0 111", instruction => semantics.rrd(this.state, instruction)), // RRD
    ...instructionPattern("01 10 1 111", instruction => semantics.rld(this.state, instruction)), // RLD
    // 101 r d 00 c: r repeats, d=0 increments/1 decrements, c=0 copies/1 compares.
    ...opcodeFamily("101 r d 00 c", { r: [
      [[semantics.ldi, semantics.cpi], [semantics.ldd, semantics.cpd]],
      [[semantics.ldir, semantics.cpir], [semantics.lddr, semantics.cpdr]],
    ], d: [0, 1], c: [0, 1] }, ({ r: directions, d: direction, c: operation }) =>
      (instruction: InstructionContext) => directions[direction]![operation]!(this.state, instruction)), // LDI/R, LDD/R, CPI/R, CPD/R
    // 101 r d 01 o: r repeats, d=0 increments/1 decrements HL, o=0 inputs/1 outputs.
    ...opcodeFamily("101 r d 01 o", { r: [
      [[semantics.ini, semantics.outi], [semantics.ind, semantics.outd]],
      [[semantics.inir, semantics.otir], [semantics.indr, semantics.otdr]],
    ], d: [0, 1], o: [0, 1] }, ({ r: directions, d: direction, o: operation }) =>
      (instruction: InstructionContext) => directions[direction]![operation]!(this.state, instruction)), // INI/R, IND/R, OUTI/OTIR, OUTD/OTDR
  ]);

  #indexHandlers(index: IndexRegister): readonly OpcodeEntry<OpcodeHandler>[] {
    // 00 pp 1 001 replaces HL with the index in both destination and pp=10 source.
    const suffix = index === "ix" ? "IX" : "IY";
    const additions = index === "ix" ? [semantics.addIXBC, semantics.addIXDE, semantics.addIXIX, semantics.addIXSP]
      : [semantics.addIYBC, semantics.addIYDE, semantics.addIYIY, semantics.addIYSP];
    const address = ({ fetchByte }: InstructionContext): number => this.#indexedAddress(index, fetchByte());
    return [
      ...opcodeFamily("00 pp 1 001", { p: additions }, ({ p: execute }) => () => execute(this.state)), // ADD IX/IY,pp
      ...instructionPattern("00 10 0 001", instruction => semantics[`immediate${suffix}Word`](this.state, instruction)), // LD IX/IY,nn
      ...instructionPattern("00 10 0 010", instruction => semantics[`store${suffix}Word`](this.state, instruction)), // LD (nn),IX/IY
      ...instructionPattern("00 10 1 010", instruction => semantics[`load${suffix}Word`](this.state, instruction)), // LD IX/IY,(nn)
      ...opcodeFamily("00 10 q 011", { q: ["inc", "dec"] }, ({ q: operation }) => () => semantics[`${operation}${suffix}Word`]!(this.state)), // INC/DEC IX/IY
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
      ...instructionPattern("11 10 0 001", instruction => semantics[`pop${suffix}`](this.state, instruction)), // POP IX/IY
      ...instructionPattern("11 10 1 001", () => semantics[`jump${suffix}`](this.state)), // JP (IX/IY); no displacement or target read
      ...instructionPattern("11 100 011", instruction => semantics[`exchange${suffix}Word`](this.state, instruction)), // EX (SP),IX/IY
      ...instructionPattern("11 10 0 101", instruction => semantics[`push${suffix}`](this.state, instruction)), // PUSH IX/IY
      ...instructionPattern("11 11 1 001", () => semantics[`copy${suffix}Word`](this.state)), // LD SP,IX/IY
    ];
  }

  // Addressing.

  #indexedAddress(index: IndexRegister, displacement: number): number {
    return (this.state[index] + signed8(displacement)) & 0xffff;
  }
}
