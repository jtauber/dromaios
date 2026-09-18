import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition, InstructionStep, HaltedStep, WaitingStep } from "./execution-records.ts";
import { signed8, readWordLE } from "./binary.ts";
import { recordMemory } from "./memory-access.ts";
import type { ByteMemory, MemoryAccess } from "./memory-access.ts";
import { recordPorts } from "./port-access.ts";
import type { BytePorts, PortAccess } from "./port-access.ts";
import { executionBoundary } from "./execution-boundary.ts";
import type { WordInstructionContext, InterruptDeferralContext, InterruptReportContext } from "./instruction-context.ts";
import { copyState, readState } from "./state.ts";
import { cpu8088StateDescription } from "./state/8088.ts";
import type { Cpu8088State, Cpu8088Flags } from "./state/8088.ts";
import { instructions as semantics, opcodeEntries } from "./generated/8088.ts";
import { instructions as transfers } from "./generated/8088-transfers.ts";
import { instructions as alu } from "./generated/8088-alu.ts";
import { instructions as unary } from "./generated/8088-unary.ts";
import { instructions as stack } from "./generated/8088-stack.ts";
import { instructions as addressing } from "./generated/8088-addressing.ts";
import { instructions as strings } from "./generated/8088-strings.ts";
import { instructions as arithmetic } from "./generated/8088-arithmetic.ts";
import { instructions as control } from "./generated/8088-control.ts";
import { record8088External } from "./8088-external.ts";
import type { Cpu8088ExternalAccess, Cpu8088ExternalConnections, Cpu8088ExternalContext } from "./8088-external.ts";
import type { ReadonlyState } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.ts";
import { checkUnsigned } from "../validation.ts";

export type { Cpu8088Escape } from "./8088-external.ts";
export { cpu8088StateDescription } from "./state/8088.ts";
export type { Cpu8088State, Cpu8088Flags } from "./state/8088.ts";

export type Cpu8088Snapshot = ReadonlyState<Cpu8088State> & {
  readonly al: number;
  readonly ah: number;
  readonly bl: number;
  readonly bh: number;
  readonly cl: number;
  readonly ch: number;
  readonly dl: number;
  readonly dh: number;
  /** Physical address of CS:IP, for inspection and runner completion. */
  readonly pc: number;
};

/** Physical byte access on the 20-bit memory bus. */
export type Cpu8088MemoryAccess = MemoryAccess;

/** Independent machine-owned port and coprocessor connections. */
export interface Cpu8088Connections extends Cpu8088ExternalConnections { readonly ports?: BytePorts }

export type Cpu8088Access = MemoryAccess | PortAccess | Cpu8088ExternalAccess;

/** Instruction address is physical; before.cs and before.ip retain its logical address. */
export type Cpu8088Instruction = FetchedInstruction;

/** Interrupt delivery uses a type byte to select a four-byte vector at physical address type * 4. */
export interface Cpu8088Delivery {
  readonly source: "software" | "divide-error" | "trap";
  readonly vector: number;
}

export type Cpu8088StepRecord = (
  (InstructionStep<Cpu8088Snapshot, Cpu8088Access> | HaltedStep<Cpu8088Snapshot, Cpu8088Access>
    | WaitingStep<Cpu8088Snapshot, Cpu8088Access>) & {
    readonly interrupt?: Cpu8088Delivery;
  }
) | (StateTransition<Cpu8088Snapshot> & {
  readonly instruction: null;
  readonly outcome: "executed";
  readonly interrupt: { readonly source: "trap"; readonly vector: 1 };
}) | (StateTransition<Cpu8088Snapshot, Cpu8088Access> & {
  readonly instruction: null;
  readonly outcome: "executed";
  readonly continuation: "wait";
  readonly interrupt?: never;
});

export type Cpu8088InterruptSource = "intr" | "nmi";
export type Cpu8088InterruptAccess = MemoryAccess | { readonly kind: "acknowledge"; readonly value: number };
export type Cpu8088InterruptRecord = StateTransition<Cpu8088Snapshot, Cpu8088InterruptAccess> & {
  readonly source: Cpu8088InterruptSource;
  readonly instruction: null;
} & (
  | { readonly outcome: "accepted"; readonly vector: number }
  | { readonly outcome: "ignored"; readonly reason: "masked" | "deferred" }
);

export type Cpu8088ResetRecord = StateTransition<Cpu8088Snapshot>;

interface InstructionContext extends WordInstructionContext, BytePorts, InterruptDeferralContext, InterruptReportContext, Cpu8088ExternalContext {
  readonly startIp: number;
  readonly segment: number | undefined;
  // F3 repeats while equal, F2 while unequal; only CMPS/SCAS test the condition.
  readonly repeat: boolean | undefined;
}
type Rejection = "opcode" | "divide-error";
type OpcodeHandler = (instruction: InstructionContext) => Rejection | void;
type OperandWidth = 8 | 16;
type AluOperation = typeof aluOperations[number] | "TEST";
type BinaryOperation = AluOperation | "move" | "exchange";
type UnaryOperation = "INC" | "DEC" | "NOT" | "NEG";
type SegmentRegister = "es" | "cs" | "ss" | "ds";
type StringOperation = "move" | "compare" | "store" | "load" | "scan";
interface MemoryAddress { readonly segment: number; readonly offset: number }

// Definitions specialize register selectors; memory bodies take one captured segment and offset.
const resolvedOperands = { ...transfers, ...alu };
const registerOperations: Readonly<Record<`${BinaryOperation}_${OperandWidth}_${number}_${number}`, (state: Cpu8088State) => void>> = resolvedOperands;
const memoryOperations: Readonly<Partial<Record<`${"load" | "store" | "exchangeMemory" | `${AluOperation}_${"fromMemory" | "toMemory"}`}_${OperandWidth}_${number}`,
  (state: Cpu8088State, segment: number, offset: number, instruction: ByteMemory) => void>>> = resolvedOperands;
const memoryImmediates: Readonly<Record<`immediate_${OperandWidth}`,
  (state: Cpu8088State, segment: number, offset: number, instruction: InstructionContext) => void>> = transfers;
const opcodeBodies: Readonly<Partial<Record<number, (state: Cpu8088State, instruction: InstructionContext) => Rejection | void>>> = semantics;

// 00 ooo ... and ModR/M mm ooo rrr share this operation field.
const aluOperations = ["ADD", "OR", "ADC", "SBB", "AND", "SUB", "XOR", "CMP"] as const;
const immediateRegisterAlu: Readonly<Partial<Record<`${AluOperation}_${"immediate" | "signed"}_${OperandWidth}_${number}`,
  (state: Cpu8088State, instruction: InstructionContext) => void>>> = alu;
const immediateMemoryAlu: Readonly<Partial<Record<`${AluOperation}_${"immediate" | "signed"}_${OperandWidth}_memory`,
  (state: Cpu8088State, segment: number, offset: number, instruction: InstructionContext) => void>>> = alu;

const unaryRegister: Readonly<Record<`${UnaryOperation}_${OperandWidth}_${number}`, (state: Cpu8088State) => void>> = unary;
const unaryMemory: Readonly<Record<`${UnaryOperation}_${OperandWidth}_memory`,
  (state: Cpu8088State, segment: number, offset: number, instruction: ByteMemory) => void>> = unary;

type ArithmeticOperation = "MUL" | "IMUL" | "DIV" | "IDIV" | `shift_${number}_${"one" | "cl"}`;
const arithmeticRegisters: Readonly<Record<`${ArithmeticOperation}_${OperandWidth}_${number}`,
  (state: Cpu8088State) => Rejection | void>> = arithmetic;
const arithmeticMemory: Readonly<Record<`${ArithmeticOperation}_${OperandWidth}_memory`,
  (state: Cpu8088State, segment: number, offset: number, instruction: ByteMemory) => Rejection | void>> = arithmetic;

type StackOperation = "PUSH" | "POP" | "CALL" | "CALL_far" | "JMP" | "JMP_far";
const stackRegisters: Readonly<Record<`${"CALL" | "JMP"}_${number}`,
  (state: Cpu8088State, instruction: ByteMemory) => void>> = stack;
const stackMemory: Readonly<Record<`${StackOperation}_memory`,
  (state: Cpu8088State, segment: number, offset: number, instruction: ByteMemory) => void>> = stack;

type SegmentMove = `segment_${"load" | "store"}_${"es" | "cs" | "ss" | "ds"}`;
const segmentRegisters: Readonly<Partial<Record<`${SegmentMove}_${number}`,
  (state: Cpu8088State, instruction: InstructionContext) => void>>> = addressing;
const addressMemory: Readonly<Partial<Record<`${SegmentMove}_memory` | `${"LES" | "LDS"}_${number}`,
  (state: Cpu8088State, segment: number, offset: number, instruction: InstructionContext) => void>>> = addressing;
const effectiveOffsets: Readonly<Record<`LEA_${number}`, (state: Cpu8088State, offset: number) => void>> = addressing;

type StringKey = `${StringOperation}_${OperandWidth}`;
const plainStrings: Readonly<Record<StringKey, (state: Cpu8088State, instruction: ByteMemory) => void>> = strings;
const overriddenStrings: Readonly<Record<`${StringKey}_override`,
  (state: Cpu8088State, segment: number, instruction: ByteMemory) => void>> = strings;
const repeatedStrings: Readonly<Partial<Record<`${StringKey}_${"repe" | "repne"}`,
  (state: Cpu8088State, startIP: number, instruction: ByteMemory) => void>>> = strings;
const overriddenRepeatedStrings: Readonly<Partial<Record<`${StringKey}_${"repe" | "repne"}_override`,
  (state: Cpu8088State, segment: number, startIP: number, instruction: ByteMemory) => void>>> = strings;

const instructionPattern = opcodePattern<OpcodeHandler>;

// The original 8088 has twenty address lines; carries beyond bit 19 are discarded.
function physicalAddress(segment: number, offset: number): number {
  return ((segment << 4) + offset) & 0xfffff;
}

/** Instruction-level Intel 8088 with flat 1 MiB RAM and segmented addresses. */
export class Cpu8088 {
  readonly #ram: Ram;
  readonly #state: Cpu8088State;
  readonly #opcodeHandlers: Readonly<Partial<Record<number, OpcodeHandler>>>;
  readonly #connections: Cpu8088Connections | undefined;
  readonly #atBoundary = executionBoundary("8088 step, reset, and interrupt calls must not be reentrant.");

  constructor(ram: Ram, initialState: Cpu8088State, connections?: Cpu8088Connections) {
    if (ram.size !== 0x100000) throw new RangeError("The 8088 model requires exactly 1 MiB of RAM.");
    this.#ram = ram;
    this.#state = readState(cpu8088StateDescription, initialState);
    this.#connections = connections;
    this.#opcodeHandlers = opcodeTable(this.#instructionEntries());
  }

  /** Inspect detached state, byte-register views, and the physical PC without RAM access. */
  snapshot(): Cpu8088Snapshot {
    const state = copyState(cpu8088StateDescription, this.#state);
    return {
      ...state,
      al: state.ax & 0xff, ah: state.ax >>> 8,
      bl: state.bx & 0xff, bh: state.bx >>> 8,
      cl: state.cx & 0xff, ch: state.cx >>> 8,
      dl: state.dx & 0xff, dh: state.dx >>> 8,
      pc: physicalAddress(state.cs, state.ip),
    };
  }

  /** Set CS:IP to FFFF:0000; clear other segments, flags, halt/wait, and recognition latches; preserve general registers and RAM. */
  reset(): Cpu8088ResetRecord {
    return this.#atBoundary<Cpu8088ResetRecord>(() => {
      const before = this.snapshot();
      this.#state.cs = 0xffff;
      this.#state.ip = 0;
      this.#state.halted = this.#state.waiting = false;
      this.#state.interruptDeferred = this.#state.recognitionDeferred = this.#state.trapPending = false;
      this.#state.ds = this.#state.ss = this.#state.es = 0;
      this.#state.flags = { cf: false, pf: false, af: false, zf: false, sf: false,
        tf: false, if: false, df: false, of: false };
      return { before, after: this.snapshot(), accesses: [] };
    });
  }

  /** Deliver an owed trap, sample a waiting TEST input, or attempt one instruction/REP iteration. */
  step(): Cpu8088StepRecord {
    return this.#atBoundary<Cpu8088StepRecord>(() => {
      const before = this.snapshot();
      if (this.#state.trapPending && !this.#state.recognitionDeferred) {
        const memory = recordMemory(this.#ram);
        this.#state.trapPending = false;
        control.enterInterrupt(this.#state, 1, memory);
        return { before, after: this.snapshot(), instruction: null, accesses: memory.accesses,
          outcome: "executed", interrupt: { source: "trap", vector: 1 } };
      }
      if (this.#state.halted) return { before, after: this.snapshot(), instruction: null, accesses: [], outcome: "halted" };
      const accesses: Cpu8088Access[] = [];
      const recordAccess = (access: Cpu8088Access): void => { accesses.push(access); };
      const { readByte, writeByte } = recordMemory(this.#ram, recordAccess);
      const { readPort, writePort } = recordPorts(this.#connections?.ports, recordAccess);
      const { readTest, sendEscape } = record8088External(this.#connections, recordAccess);
      const bytes: number[] = [];
      const fetchByte = (): number => {
        const value = readByte(physicalAddress(this.#state.cs, this.#state.ip));
        this.#state.ip = (this.#state.ip + 1) & 0xffff;
        bytes.push(value);
        return value;
      };
      // Prefixes are local to this attempt. Later prefixes of the same kind replace earlier ones.
      let segment: number | undefined;
      let repeat: boolean | undefined;
      let reason: Rejection | void = "opcode";
      let interruptDeferred = false, recognitionDeferred = false;
      let interrupt: Cpu8088Delivery | undefined;
      const context = {
        startIp: before.ip, fetchByte, fetchWord: () => readWordLE(fetchByte), readByte, writeByte, readPort, writePort, readTest, sendEscape,
        deferInterrupt: (scope: "intr" | "all"): void => {
          if (scope === "all") recognitionDeferred = true;
          else interruptDeferred = true;
        },
        reportInterrupt: (vector: number): void => { interrupt = { source: "software", vector }; },
      };
      if (before.waiting) reason = control.resumeWait(this.#state, context);
      else {
        // A full code segment of prefixes cannot reach an opcode; bound the attempt without a later-x86 length limit.
        while (bytes.length < 0x10000) {
          const opcode = fetchByte();
          const override = this.#segmentOverrides[opcode];
          if (override) { segment = this.#state[override]; continue; }
          if (opcode === 0xf0) continue; // LOCK has no bus-arbitration effect in this CPU-and-RAM model.
          if (opcode === 0xf2 || opcode === 0xf3) { repeat = opcode === 0xf3; continue; }
          const handler = this.#opcodeHandlers[opcode];
          if (handler && (repeat === undefined || this.#stringHandlers.some(([code]) => code === opcode))) {
            reason = handler({ ...context, segment, repeat });
          }
          break;
        }
      }
      if (reason === "divide-error") {
        // Original 8088 type 0 returns AFTER DIV/IDIV, unlike later x86 fault restart.
        control.enterInterrupt(this.#state, 0, { readByte, writeByte });
        interrupt = { source: "divide-error", vector: 0 };
      }
      if (reason === "opcode") this.#state.ip = before.ip;
      else {
        this.#state.interruptDeferred = interruptDeferred;
        this.#state.recognitionDeferred = recognitionDeferred;
        // Instructions and busy WAIT polls sample TF; POPF/IRET cannot retroactively change the owed trap.
        this.#state.trapPending = before.trapPending || before.flags.tf;
      }
      const transition = { before, after: this.snapshot(), accesses };
      if (before.waiting) {
        return this.#state.waiting && !this.#state.trapPending
          ? { ...transition, instruction: null, outcome: "waiting" }
          : { ...transition, instruction: null, outcome: "executed", continuation: "wait" };
      }
      const record = { ...transition, instruction: { address: before.pc, bytes } };
      if (reason === "opcode") return { ...record, outcome: "unsupported", reason };
      if (interrupt) return { ...record, outcome: "executed", interrupt };
      if (this.#state.waiting && !this.#state.trapPending) return { ...record, outcome: "waiting" };
      // A trapped HLT still allows the runner to reach its pending type-1 entry.
      return { ...record, outcome: this.#state.halted && !this.#state.trapPending ? "halted" : "executed" };
    });
  }

  /** Offer INTR or a selected NMI edge. Ignored requests remain the caller's responsibility. */
  interrupt(source: "nmi"): Cpu8088InterruptRecord;
  interrupt(source: "intr", acknowledge: () => number): Cpu8088InterruptRecord;
  interrupt(source: Cpu8088InterruptSource, acknowledge?: () => number): Cpu8088InterruptRecord {
    return this.#atBoundary<Cpu8088InterruptRecord>(() => {
      if (source !== "intr" && source !== "nmi") throw new TypeError("8088 interrupt source must be intr or nmi.");
      const before = this.snapshot();
      const deferred = this.#state.recognitionDeferred || (source === "intr" && this.#state.interruptDeferred);
      if (deferred || (source === "intr" && !this.#state.flags.if)) {
        return { before, after: this.snapshot(), source, instruction: null, accesses: [], outcome: "ignored",
          reason: deferred ? "deferred" : "masked" };
      }
      if (source === "intr" && typeof acknowledge !== "function") throw new TypeError("INTR requires an acknowledge callback.");
      this.#state.halted = this.#state.waiting = false;
      const accesses: Cpu8088InterruptAccess[] = [];
      const memory = recordMemory(this.#ram, access => { accesses.push(access); });
      let vector = 2;
      if (source === "intr") {
        vector = acknowledge!();
        checkUnsigned("Interrupt vector", vector, 0xff);
        accesses.push({ kind: "acknowledge", value: vector });
      }
      control.enterInterrupt(this.#state, vector, memory);
      return { before, after: this.snapshot(), source, instruction: null, accesses, outcome: "accepted", vector };
    });
  }

  // Opcode selectors and construction. Arrays follow encoded register order.

  readonly #segmentRegisters = ["es", "cs", "ss", "ds"] as const;
  readonly #segmentOverrides = opcodeTable<SegmentRegister>(opcodeFamily("001 ss 110", { s: this.#segmentRegisters }, ({ s }) => s));
  readonly #operandWidths = [8, 16] as const;

  // ModR/M mm ggg rrr: memory bases selected by rrr. BP selects SS; other bases use DS.
  // mm=00/01/10 adds no/signed-byte/word displacement; mm=11 selects a register.
  // The mm=00, rrr=110 exception is a direct word offset in DS, not [BP].
  readonly #memoryBases = [
    () => ({ segment: this.#state.ds, offset: this.#state.bx + this.#state.si }), // 000: BX+SI
    () => ({ segment: this.#state.ds, offset: this.#state.bx + this.#state.di }), // 001: BX+DI
    () => ({ segment: this.#state.ss, offset: this.#state.bp + this.#state.si }), // 010: BP+SI
    () => ({ segment: this.#state.ss, offset: this.#state.bp + this.#state.di }), // 011: BP+DI
    () => ({ segment: this.#state.ds, offset: this.#state.si }), // 100: SI
    () => ({ segment: this.#state.ds, offset: this.#state.di }), // 101: DI
    () => ({ segment: this.#state.ss, offset: this.#state.bp }), // 110: BP (except mm=00)
    () => ({ segment: this.#state.ds, offset: this.#state.bx }), // 111: BX
  ] as const;

  // 1010 ooo w: ooo=010 MOVS, 011 CMPS, 101 STOS, 110 LODS, 111 SCAS; w=0 byte/1 word.
  // ooo=000/001 and 100 belong to absolute MOV and immediate TEST, respectively.
  readonly #stringHandlers: readonly OpcodeEntry<OpcodeHandler>[] = ([
    ["010", "move"], ["011", "compare"], ["101", "store"], ["110", "load"], ["111", "scan"],
  ] as const).flatMap(([bits, operation]) => opcodeFamily(`1010 ${bits} w`, { w: this.#operandWidths },
    ({ w: width }) => instruction => this.#string(operation, width, instruction)));

  #instructionEntries(): readonly OpcodeEntry<OpcodeHandler>[] {
    return [
      ...opcodeEntries(this.#state),
      // 00 ooo 0 d w: ooo selects ADD/OR/ADC/SBB/AND/SUB/XOR/CMP above; w=0 byte, w=1 word.
      // ModR/M mm ggg rrr supplies operands; d=0 selects the r/m destination, d=1 register ggg.
      ...opcodeFamily("00 ooo 0 d w", { o: aluOperations, d: [false, true], w: this.#operandWidths }, ({ o: operation, d: toRegister, w: width }) => (instruction: InstructionContext) => this.#binary(operation, width, toRegister, instruction)), // ALU r/m,r / r,r/m

      // 1000 00 s w + mm ooo rrr: immediate ALU; s=1 allows only ADD/ADC/SBB/SUB/CMP.
      // w=0 uses a byte; w=1 uses a word for s=0 or a sign-extended byte for s=1.
      ...opcodeFamily("1000 00 s w", { s: [false, true], w: this.#operandWidths }, ({ s: shortImmediate, w: width }) => (instruction: InstructionContext) => this.#aluImmediate(width, shortImmediate, instruction)), // ALU r/m,n
      // 1000 010w + mm ggg rrr: AND flags without a write; ggg is the source register.
      ...opcodeFamily("1000 010 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#binary("TEST", width, false, instruction)), // TEST r/m,r
      // 1000 011w + mm ggg rrr: exchange the original operands, even when registers alias.
      ...opcodeFamily("1000 011 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#binary("exchange", width, false, instruction)), // XCHG r/m,r
      // 1000 10 d w + mm ggg rrr: d=0 writes r/m, d=1 writes register ggg; no flags change.
      ...opcodeFamily("1000 10 d w", { d: [false, true], w: this.#operandWidths }, ({ d: toRegister, w: width }) => (instruction: InstructionContext) => this.#binary("move", width, toRegister, instruction)), // MOV r/m,r / r,r/m

      // 1000 11 d 0 + mm 0ss rrr moves segment registers; loading CS is undocumented.
      ...opcodeFamily("1000 11 d 0", { d: [false, true] }, ({ d: toSegment }) => (instruction: InstructionContext) => this.#moveSegment(toSegment, instruction)), // MOV r/m16,Sreg / Sreg,r/m16
      ...instructionPattern("1000 1101", instruction => this.#loadAddress(undefined, instruction)), // LEA r16,m
      ...instructionPattern("1000 1111", instruction => this.#popOperand(instruction)), // POP r/m16, only /0

      // 1010 00 d w: d=0 loads, d=1 stores; w=0 AL, w=1 AX. The DS offset is always a word.
      ...opcodeFamily("1010 00 0 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#moveAbsolute(width, true, instruction)), // MOV AL/AX,[offset]
      ...opcodeFamily("1010 00 1 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#moveAbsolute(width, false, instruction)), // MOV [offset],AL/AX

      ...this.#stringHandlers, // MOVS/CMPS/STOS/LODS/SCAS, with optional REP

      // 1100 010s loads a far pointer into a general register and ES (s=0) or DS (s=1).
      ...opcodeFamily("1100 010 s", { s: ["es", "ds"] }, ({ s: segment }) => (instruction: InstructionContext) => this.#loadAddress(segment, instruction)), // LES / LDS

      // 1100 011w + mm 000 rrr: immediate MOV; every other operation selector is unused.
      ...opcodeFamily("1100 011 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#moveImmediate(width, instruction)), // MOV r/m,n
      // 1101 00vw + mm ooo rrr: v=0 shifts once, v=1 uses all eight bits of CL; w selects byte/word.
      ...opcodeFamily("1101 00 v w", { v: [false, true], w: this.#operandWidths }, ({ v: useCL, w: width }) => (instruction: InstructionContext) => this.#shift(width, useCL, instruction)), // ROL/ROR/RCL/RCR/SHL/SHR/SAR

      ...instructionPattern("1101 0111", instruction => this.#translate(instruction)), // XLAT

      // 1101 1ooo + mm ppp rrr: ooo:ppp is the six-bit external opcode; mm/rrr selects its source.
      ...opcodeFamily("1101 1ooo", { o: [0, 1, 2, 3, 4, 5, 6, 7] }, ({ o }) => (instruction: InstructionContext) => this.#escape(o, instruction)), // ESC

      // 1111 011w: ModR/M mm ooo rrr selects TEST, unused /1, NOT, NEG, MUL, IMUL, DIV, IDIV.
      ...opcodeFamily("1111 011 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#unary(width, instruction)), // TEST/NOT/NEG/MUL/IMUL/DIV/IDIV r/m
      // 1111 111w: /0..1 adjusts either width; /2..6 accepts only words for CALL/JMP/PUSH.
      ...opcodeFamily("1111 111 w", { w: this.#operandWidths },
        ({ w: width }) => (instruction: InstructionContext) => this.#adjustOrWordGroup(width, instruction)),
    ];
  }

  // Resolve ESC's operand through the ordinary decoder; the body owns its dummy read and device effect.
  #escape(highOpcode: number, instruction: InstructionContext): void {
    const modRM = instruction.fetchByte();
    if (modRM >= 0xc0) control.escapeRegister(this.#state, highOpcode, modRM, instruction);
    else {
      const { segment, offset } = this.#effectiveAddress(modRM, instruction);
      control.escapeMemory(this.#state, highOpcode, modRM, segment, offset, instruction);
    }
  }

  // Memory-only callers reject mod=11 before asking for an effective address.
  #effectiveAddress(modRM: number, { fetchByte, fetchWord, segment }: InstructionContext): MemoryAddress {
    const mode = modRM >>> 6, selector = modRM & 7;
    const direct = mode === 0 && selector === 6;
    const base = direct ? { segment: this.#state.ds, offset: 0 } : this.#memoryBases[selector]!();
    const displacement = direct || mode === 2 ? fetchWord() : mode === 1 ? signed8(fetchByte()) : 0;
    return { segment: segment ?? base.segment, offset: (base.offset + displacement) & 0xffff };
  }

  #binary(operation: BinaryOperation, width: OperandWidth, toRegister: boolean, instruction: InstructionContext): void {
    const modRM = instruction.fetchByte(), register = (modRM >>> 3) & 7, rm = modRM & 7;
    if (modRM >= 0xc0) {
      const [destination, source] = toRegister ? [register, rm] : [rm, register];
      registerOperations[`${operation}_${width}_${destination}_${source}`]!(this.#state);
    } else {
      const { segment, offset } = this.#effectiveAddress(modRM, instruction);
      const body = operation === "move" ? (toRegister ? "load" : "store") : operation === "exchange" ? "exchangeMemory"
        : `${operation}_${toRegister ? "fromMemory" : "toMemory"}` as const;
      memoryOperations[`${body}_${width}_${register}`]!(this.#state, segment, offset, instruction);
    }
  }

  #moveImmediate(width: OperandWidth, instruction: InstructionContext): Rejection | void {
    const modRM = instruction.fetchByte();
    if (((modRM >>> 3) & 7) !== 0) return "opcode"; // C6/C7 admit only /0; reject before displacement or immediate fetching.
    if (modRM >= 0xc0) opcodeBodies[(width === 8 ? 0xb0 : 0xb8) + (modRM & 7)]!(this.#state, instruction);
    else {
      const { segment, offset } = this.#effectiveAddress(modRM, instruction);
      memoryImmediates[`immediate_${width}`](this.#state, segment, offset, instruction);
    }
  }

  #moveAbsolute(width: OperandWidth, toAccumulator: boolean, instruction: InstructionContext): void {
    const offset = instruction.fetchWord(), segment = instruction.segment ?? this.#state.ds;
    memoryOperations[`${toAccumulator ? "load" : "store"}_${width}_0`]!(this.#state, segment, offset, instruction);
  }

  #moveSegment(toSegment: boolean, instruction: InstructionContext): Rejection | void {
    const modRM = instruction.fetchByte(), segment = this.#segmentRegisters[(modRM >>> 3) & 7];
    if (!segment || (toSegment && segment === "cs")) return "opcode";
    const operation = `segment_${toSegment ? "load" : "store"}_${segment}` as const;
    if (modRM >= 0xc0) segmentRegisters[`${operation}_${modRM & 7}`]!(this.#state, instruction);
    else {
      const { segment, offset } = this.#effectiveAddress(modRM, instruction);
      addressMemory[`${operation}_memory`]!(this.#state, segment, offset, instruction);
    }
  }

  #loadAddress(segment: "es" | "ds" | undefined, instruction: InstructionContext): Rejection | void {
    const modRM = instruction.fetchByte();
    if (modRM >= 0xc0) return "opcode";
    const register = (modRM >>> 3) & 7, address = this.#effectiveAddress(modRM, instruction);
    if (segment === undefined) effectiveOffsets[`LEA_${register}`]!(this.#state, address.offset);
    else addressMemory[`${segment === "es" ? "LES" : "LDS"}_${register}`]!(this.#state, address.segment, address.offset, instruction);
  }

  #translate(instruction: InstructionContext): void {
    if (instruction.segment === undefined) addressing.XLAT(this.#state, instruction);
    else addressing.XLAT_override(this.#state, instruction.segment, instruction);
  }

  // Prefix selection stays in the decoder; generated string bodies execute one element per step.
  #string(operation: StringOperation, width: OperandWidth, instruction: InstructionContext): Rejection | void {
    const { repeat, segment, startIp } = instruction, key = `${operation}_${width}` as const;
    if (repeat === false && operation !== "compare" && operation !== "scan") return "opcode";
    if (repeat === undefined) {
      if (segment === undefined) plainStrings[key](this.#state, instruction);
      else overriddenStrings[`${key}_override`](this.#state, segment, instruction);
    } else {
      const repeated = `${key}_${repeat ? "repe" : "repne"}` as const;
      if (segment === undefined) repeatedStrings[repeated]!(this.#state, startIp, instruction);
      else overriddenRepeatedStrings[`${repeated}_override`]!(this.#state, segment, startIp, instruction);
    }
  }

  // Control flow and stack operations.

  #popOperand(instruction: InstructionContext): Rejection | void {
    const modRM = instruction.fetchByte();
    if ((modRM & 0x38) !== 0) return "opcode";
    return this.#stackOperand("POP", modRM, instruction);
  }

  #adjustOrWordGroup(width: OperandWidth, instruction: InstructionContext): Rejection | void {
    const modRM = instruction.fetchByte(), operation = (modRM >>> 3) & 7;
    if ((width === 8 && operation > 1) || operation === 7) return "opcode";
    if (operation < 2) return this.#modify(operation === 0 ? "INC" : "DEC", width, modRM, instruction);
    // FF /2..6: near CALL, far CALL, near JMP, far JMP, PUSH.
    return this.#stackOperand((["CALL", "CALL_far", "JMP", "JMP_far", "PUSH"] as const)[operation - 2]!, modRM, instruction);
  }

  #stackOperand(operation: StackOperation, modRM: number, instruction: InstructionContext): Rejection | void {
    if (modRM >= 0xc0) {
      if (operation === "CALL_far" || operation === "JMP_far") return "opcode";
      const register = modRM & 7;
      if (operation === "PUSH" || operation === "POP") opcodeBodies[(operation === "PUSH" ? 0x50 : 0x58) + register]!(this.#state, instruction);
      else stackRegisters[`${operation}_${register}`]!(this.#state, instruction);
    } else {
      const { segment, offset } = this.#effectiveAddress(modRM, instruction);
      stackMemory[`${operation}_memory`](this.#state, segment, offset, instruction);
    }
  }

  // Arithmetic and flags.

  #aluImmediate(width: OperandWidth, shortImmediate: boolean, instruction: InstructionContext): Rejection | void {
    const modRM = instruction.fetchByte(), selector = (modRM >>> 3) & 7;
    // Intel's 1979 table leaves /1, /4, and /6 unused for both 82 and 83.
    if (shortImmediate && (selector === 1 || selector === 4 || selector === 6)) return "opcode";
    this.#immediateAlu(aluOperations[selector]!, width, modRM, shortImmediate && width === 16, instruction);
  }

  #immediateAlu(operation: AluOperation, width: OperandWidth, modRM: number, signed: boolean, instruction: InstructionContext): void {
    const source = signed ? "signed" : "immediate";
    if (modRM >= 0xc0) immediateRegisterAlu[`${operation}_${source}_${width}_${modRM & 7}`]!(this.#state, instruction);
    else {
      const { segment, offset } = this.#effectiveAddress(modRM, instruction);
      immediateMemoryAlu[`${operation}_${source}_${width}_memory`]!(this.#state, segment, offset, instruction);
    }
  }

  #unary(width: OperandWidth, instruction: InstructionContext): Rejection | void {
    const modRM = instruction.fetchByte(), selector = (modRM >>> 3) & 7;
    if (selector === 0) return this.#immediateAlu("TEST", width, modRM, false, instruction);
    if (selector === 1) return "opcode";
    if (selector < 4) return this.#modify(selector === 2 ? "NOT" : "NEG", width, modRM, instruction);
    return this.#arithmeticOperand((["MUL", "IMUL", "DIV", "IDIV"] as const)[selector - 4]!, width, modRM, instruction);
  }

  #modify(operation: UnaryOperation, width: OperandWidth, modRM: number, instruction: InstructionContext): void {
    if (modRM >= 0xc0) unaryRegister[`${operation}_${width}_${modRM & 7}`]!(this.#state);
    else {
      const { segment, offset } = this.#effectiveAddress(modRM, instruction);
      unaryMemory[`${operation}_${width}_memory`](this.#state, segment, offset, instruction);
    }
  }

  #shift(width: OperandWidth, useCL: boolean, instruction: InstructionContext): Rejection | void {
    const modRM = instruction.fetchByte(), selector = (modRM >>> 3) & 7;
    if (selector === 6) return "opcode";
    return this.#arithmeticOperand(`shift_${selector}_${useCL ? "cl" : "one"}`, width, modRM, instruction);
  }

  #arithmeticOperand(operation: ArithmeticOperation, width: OperandWidth, modRM: number, instruction: InstructionContext): Rejection | void {
    if (modRM >= 0xc0) return arithmeticRegisters[`${operation}_${width}_${modRM & 7}`]!(this.#state);
    const { segment, offset } = this.#effectiveAddress(modRM, instruction);
    return arithmeticMemory[`${operation}_${width}_memory`]!(this.#state, segment, offset, instruction);
  }
}
