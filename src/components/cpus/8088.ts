import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition, InstructionStep, HaltedStep, WaitingStep } from "./execution-records.ts";
import { signed8, readWordLE } from "./binary.ts";
import { flagRegister } from "./flags.ts";
import { recordMemory } from "./memory-access.ts";
import type { ByteMemory, MemoryAccess } from "./memory-access.ts";
import { recordPorts } from "./port-access.ts";
import type { BytePorts, PortAccess } from "./port-access.ts";
import { executionBoundary } from "./execution-boundary.ts";
import type { WordInstructionContext } from "./instruction-context.ts";
import { copyState, readState } from "./state.ts";
import { cpu8088StateDescription } from "./state/8088.ts";
import type { Cpu8088State, Cpu8088Flags } from "./state/8088.ts";
import { byteRegisters8088, wordRegisters8088 } from "./8088-registers.ts";
import type { ByteRegister8088, WordRegister8088 as WordRegister } from "./8088-registers.ts";
import { opcodeEntries } from "./generated/8088.ts";
import type { ReadonlyState } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.ts";
import { add, subtract, shiftLeft, shiftRight, evenParity8 } from "./alu.ts";
import type { ShiftResult } from "./alu.ts";
import { checkUnsigned } from "../validation.ts";

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

/** ESC carries six external opcode bits; register forms expose the selector, never a CPU register value. */
export interface Cpu8088Escape {
  readonly opcode: number;
  readonly modRM: number;
  readonly memory: {
    readonly segment: number;
    readonly offset: number;
    readonly address: number;
    readonly value: number;
  } | null;
}

/** Device state and TEST pin level belong to the machine, independently of CPU snapshots. */
export interface Cpu8088Connections {
  readonly ports?: BytePorts;
  readonly escape?: (instruction: Cpu8088Escape) => void;
  /** Physical TEST level: high waits; low permits the next instruction. */
  readonly test?: () => boolean;
}

export type Cpu8088Access = MemoryAccess | PortAccess
  | (Cpu8088Escape & { readonly kind: "escape" })
  | { readonly kind: "test"; readonly high: boolean };

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

interface InstructionContext extends WordInstructionContext, BytePorts {
  readonly startIp: number;
  readonly segment: number | undefined;
  // F3 repeats while equal, F2 while unequal; only CMPS/SCAS test the condition.
  readonly repeat: boolean | undefined;
  readonly deferInterrupt: (scope: "intr" | "all") => void;
  readonly interrupt: (vector: number) => void;
  readonly recordAccess: (access: Cpu8088Access) => void;
}
type Rejection = "opcode" | "divide-error";
type OpcodeHandler = (instruction: InstructionContext) => Rejection | void;
type OperandWidth = 8 | 16;
type AluOperation = (width: OperandWidth, left: number, right: number) => number | void;
type OperandOperation = (width: OperandWidth, operand: Operand, instruction: InstructionContext) => Rejection | void;
type SegmentRegister = "es" | "cs" | "ss" | "ds";
type StringOperation = "move" | "compare" | "store" | "load" | "scan";
interface MemoryAddress { readonly segment: number; readonly offset: number }
type ShiftOperation = (width: OperandWidth, value: number) => ShiftResult;

// An instruction-local operand: memory closures capture one resolved segment and offset.
interface Operand {
  readonly read: () => number;
  readonly write: (value: number) => void;
}

const instructionPattern = opcodePattern<OpcodeHandler>;
const statusBits = { cf: 0, pf: 2, af: 4, zf: 6, sf: 7 } as const;
const statusByte = flagRegister(statusBits, 0x02);
// Original 8088 FLAGS: bits 15..12 and 1 pack as ones; bits 5/3 pack as zeros.
const packedFlags = flagRegister({ ...statusBits, tf: 8, if: 9, df: 10, of: 11 }, 0xf002);

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
        this.#enterInterrupt(1, memory);
        return { before, after: this.snapshot(), instruction: null, accesses: memory.accesses,
          outcome: "executed", interrupt: { source: "trap", vector: 1 } };
      }
      if (this.#state.halted) return { before, after: this.snapshot(), instruction: null, accesses: [], outcome: "halted" };
      const accesses: Cpu8088Access[] = [];
      const recordAccess = (access: Cpu8088Access): void => { accesses.push(access); };
      const { readByte, writeByte } = recordMemory(this.#ram, recordAccess);
      const { readPort, writePort } = recordPorts(this.#connections?.ports, recordAccess);
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
        startIp: before.ip, fetchByte, fetchWord: () => readWordLE(fetchByte), readByte, writeByte, readPort, writePort, recordAccess,
        deferInterrupt: (scope: "intr" | "all"): void => {
          if (scope === "all") recognitionDeferred = true;
          else interruptDeferred = true;
        },
        interrupt: (vector: number): void => {
          this.#enterInterrupt(vector, { readByte, writeByte });
          interrupt = { source: "software", vector };
        },
      };
      if (before.waiting) reason = this.#wait(true, context);
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
        this.#enterInterrupt(0, { readByte, writeByte });
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
      this.#enterInterrupt(vector, memory);
      return { before, after: this.snapshot(), source, instruction: null, accesses, outcome: "accepted", vector };
    });
  }

  // Interrupt entry and flag restoration share the ordinary segmented stack operations.

  #enterInterrupt(vector: number, { readByte, writeByte }: ByteMemory): void {
    // Read the complete vector BEFORE writing the frame, including when the stack overlaps the IVT.
    const target = this.#readPointer({ segment: 0, offset: vector * 4 }, readByte);
    const flags = packedFlags.encode(this.#state.flags);
    this.#state.flags.if = this.#state.flags.tf = false;
    this.#state.halted = this.#state.waiting = this.#state.interruptDeferred = this.#state.recognitionDeferred = false;
    this.#pushWord(flags, writeByte);
    this.#pushWord(this.#state.cs, writeByte);
    this.#pushWord(this.#state.ip, writeByte);
    this.#state.cs = target.segment;
    this.#state.ip = target.offset;
    // Higher-priority delivery must not discard a single-step trap already owed at this boundary.
  }

  #restoreFlags(instruction: InstructionContext): void {
    const flags = packedFlags.decode(this.#popWord(instruction.readByte));
    if (!this.#state.flags.if && flags.if) instruction.deferInterrupt("intr");
    this.#state.flags = flags;
  }

  #loadSegment(segment: SegmentRegister, value: number, instruction: InstructionContext): void {
    this.#state[segment] = value;
    // Original 8088 MOV/POP inhibits all interrupt recognition for EVERY segment, not only SS.
    instruction.deferInterrupt("all");
  }

  // Register views. Byte writes replace only the selected half of the stored word.

  #writeByteRegister({ word, shift }: ByteRegister8088, value: number): void {
    const mask = 0xff << shift;
    this.#state[word] = (this.#state[word] & ~mask) | (value << shift);
  }

  // Opcode selectors and construction. Arrays follow encoded register order.

  readonly #segmentRegisters = ["es", "cs", "ss", "ds"] as const;
  readonly #segmentOverrides = opcodeTable<SegmentRegister>(opcodeFamily("001 ss 110", { s: this.#segmentRegisters }, ({ s }) => s));
  readonly #wordRegisters = wordRegisters8088;
  readonly #byteRegisters = byteRegisters8088;
  readonly #operandWidths = [8, 16] as const;

  // 00 ooo ... and ModR/M mm ooo rrr share the same operation field.
  // Returning no value means CMP updates flags without a destination write.
  readonly #aluOperations: readonly AluOperation[] = [
    (width, left, right) => this.#add(width, left, right), // 000: ADD
    (width, left, right) => this.#logic(width, left | right), // 001: OR
    (width, left, right) => this.#add(width, left, right, this.#state.flags.cf ? 1 : 0), // 010: ADC
    (width, left, right) => this.#subtract(width, left, right, this.#state.flags.cf ? 1 : 0), // 011: SBB
    (width, left, right) => this.#logic(width, left & right), // 100: AND
    (width, left, right) => this.#subtract(width, left, right), // 101: SUB
    (width, left, right) => this.#logic(width, left ^ right), // 110: XOR
    (width, left, right) => { this.#subtract(width, left, right); }, // 111: CMP
  ];
  readonly #test: AluOperation = (width, left, right) => { this.#logic(width, left & right); };

  // F6/F7: mm ooo rrr selects TEST, unused /1, NOT, NEG, MUL, IMUL, DIV, IDIV.
  readonly #unaryOperations: readonly (OperandOperation | undefined)[] = [
    (width, operand, instruction) => this.#testImmediate(width, operand, instruction), // 000: TEST r/m,n
    undefined, // 001: undocumented TEST alias
    (width, operand) => operand.write(operand.read() ^ (2 ** width - 1)), // 010: NOT
    (width, operand) => operand.write(this.#subtract(width, 0, operand.read())), // 011: NEG
    (width, operand) => this.#multiply(width, operand.read(), false), // 100: MUL
    (width, operand) => this.#multiply(width, operand.read(), true), // 101: IMUL
    (width, operand) => this.#divide(width, operand.read(), false), // 110: DIV
    (width, operand) => this.#divide(width, operand.read(), true), // 111: IDIV
  ];
  // FE/FF /0 and /1 adjust an operand. FF /2..6 use the word-group decoder.
  readonly #adjustOperations: readonly OperandOperation[] = [
    (width, operand) => operand.write(this.#adjust(width, operand.read(), false)), // 000: INC
    (width, operand) => operand.write(this.#adjust(width, operand.read(), true)), // 001: DEC
  ];
  readonly #immediateMoveOperations: readonly OperandOperation[] = [
    (width, operand, instruction) => operand.write(this.#fetchImmediate(width, instruction)), // C6/C7 /0: MOV r/m,n
  ];

  // D0–D3: mm ooo rrr selects the one-bit operation. /6 is undocumented.
  // The inserted bit is the outgoing bit (rotate), CF (through carry), zero, or sign.
  readonly #shiftOperations: readonly (ShiftOperation | undefined)[] = [
    (width, value) => shiftLeft(width, value, (value & 2 ** (width - 1)) !== 0 ? 1 : 0), // 000: ROL
    (width, value) => shiftRight(width, value, (value & 1) !== 0 ? 1 : 0), // 001: ROR
    (width, value) => shiftLeft(width, value, this.#state.flags.cf ? 1 : 0), // 010: RCL
    (width, value) => shiftRight(width, value, this.#state.flags.cf ? 1 : 0), // 011: RCR
    (width, value) => shiftLeft(width, value, 0), // 100: SHL (SAL)
    (width, value) => shiftRight(width, value, 0), // 101: SHR
    undefined, // 110: undocumented
    (width, value) => shiftRight(width, value, (value & 2 ** (width - 1)) !== 0 ? 1 : 0), // 111: SAR
  ];

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

  // 0111 ttt p: ttt selects the p=0 condition; p=1 inverts it.
  readonly #jumpConditions = [
    () => this.#state.flags.of, // 000: JO / JNO
    () => this.#state.flags.cf, // 001: JB (JC/JNAE) / JAE (JNC/JNB)
    () => this.#state.flags.zf, // 010: JE (JZ) / JNE (JNZ)
    () => this.#state.flags.cf || this.#state.flags.zf, // 011: JBE (JNA) / JA (JNBE)
    () => this.#state.flags.sf, // 100: JS / JNS
    () => this.#state.flags.pf, // 101: JP (JPE) / JNP (JPO)
    () => this.#state.flags.sf !== this.#state.flags.of, // 110: JL (JNGE) / JGE (JNL)
    () => this.#state.flags.zf || this.#state.flags.sf !== this.#state.flags.of, // 111: JLE (JNG) / JG (JNLE)
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
      ...opcodeFamily("00 ooo 0 d w", { o: this.#aluOperations, d: [false, true], w: this.#operandWidths }, ({ o: operation, d: toRegister, w: width }) => (instruction: InstructionContext) => this.#aluRegisterMemory(operation, width, toRegister, instruction)), // ALU r/m,r / r,r/m

      // 000 ss 11p: ss selects ES/CS/SS/DS; p=0 PUSH, p=1 POP. POP CS is undocumented.
      ...opcodeFamily("000 ss 110", { s: this.#segmentRegisters }, ({ s }) => ({ writeByte }: InstructionContext) => this.#pushWord(this.#state[s], writeByte)),
      ...instructionPattern("000 00 111", instruction => this.#loadSegment("es", this.#popWord(instruction.readByte), instruction)), // POP ES
      ...instructionPattern("000 10 111", instruction => this.#loadSegment("ss", this.#popWord(instruction.readByte), instruction)), // POP SS
      ...instructionPattern("000 11 111", instruction => this.#loadSegment("ds", this.#popWord(instruction.readByte), instruction)), // POP DS

      // 001 u s 111: u=0 packed decimal (DAA/DAS), u=1 unpacked (AAA/AAS); s=0 add/1 subtract.
      ...opcodeFamily("001 0 s 111", { s: [false, true] }, ({ s: subtracting }) => () => this.#decimalAdjust(subtracting)),
      ...opcodeFamily("001 1 s 111", { s: [false, true] }, ({ s: subtracting }) => () => this.#asciiAdjust(subtracting)),

      // 0101 p rrr: p=0 pushes, p=1 pops; rrr selects AX,CX,DX,BX,SP,BP,SI,DI.
      ...opcodeFamily("0101 0 rrr", { r: this.#wordRegisters }, ({ r: register }) => ({ writeByte }: InstructionContext) => this.#pushRegister(register, writeByte)), // PUSH r16
      ...opcodeFamily("0101 1 rrr", { r: this.#wordRegisters }, ({ r: register }) => ({ readByte }: InstructionContext) => { this.#state[register] = this.#popWord(readByte); }), // POP r16

      // 0111 ttt p: all sixteen conditions above; every form fetches a signed byte displacement.
      ...opcodeFamily("0111 ttt p", { t: this.#jumpConditions, p: [false, true] },
        ({ t: test, p: invert }) => ({ fetchByte }: InstructionContext) => this.#jump(signed8(fetchByte()), test() !== invert)), // Jcc rel8

      // 1000 00 s w + mm ooo rrr: immediate ALU; s=1 allows only ADD/ADC/SBB/SUB/CMP.
      // w=0 uses a byte; w=1 uses a word for s=0 or a sign-extended byte for s=1.
      ...opcodeFamily("1000 00 s w", { s: [false, true], w: this.#operandWidths }, ({ s: shortImmediate, w: width }) => (instruction: InstructionContext) => this.#aluImmediate(width, shortImmediate, instruction)), // ALU r/m,n
      // 1000 010w + mm ggg rrr: AND flags without a write; ggg is the source register.
      ...opcodeFamily("1000 010 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#aluRegisterMemory(this.#test, width, false, instruction)), // TEST r/m,r
      // 1000 011w + mm ggg rrr: exchange the original operands, even when registers alias.
      ...opcodeFamily("1000 011 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#exchange(...this.#registerMemoryOperands(width, false, instruction))), // XCHG r/m,r
      // 1000 10 d w + mm ggg rrr: d=0 writes r/m, d=1 writes register ggg; no flags change.
      ...opcodeFamily("1000 10 d w", { d: [false, true], w: this.#operandWidths }, ({ d: toRegister, w: width }) => (instruction: InstructionContext) => this.#moveRegisterMemory(width, toRegister, instruction)), // MOV r/m,r / r,r/m

      // 1000 11 d 0 + mm 0ss rrr moves segment registers; loading CS is undocumented.
      ...opcodeFamily("1000 11 d 0", { d: [false, true] }, ({ d: toSegment }) => (instruction: InstructionContext) => this.#moveSegment(toSegment, instruction)), // MOV r/m16,Sreg / Sreg,r/m16
      ...instructionPattern("1000 1101", instruction => this.#loadAddress(undefined, instruction)), // LEA r16,m
      ...instructionPattern("1000 1111", instruction => this.#popOperand(instruction)), // POP r/m16, only /0

      // 1001 1ooo: sign extension, far CALL, WAIT, and packed flag transfers.
      ...instructionPattern("1001 1000", () => { this.#state.ax = signed8(this.#state.ax & 0xff) & 0xffff; }), // CBW
      ...instructionPattern("1001 1001", () => { this.#state.dx = this.#state.ax >= 0x8000 ? 0xffff : 0; }), // CWD
      ...instructionPattern("1001 1010", instruction => this.#farImmediate(true, instruction)), // CALL ptr16:16
      ...instructionPattern("1001 1011", instruction => this.#wait(false, instruction)), // WAIT
      ...instructionPattern("1001 1100", ({ writeByte }) => this.#pushWord(packedFlags.encode(this.#state.flags), writeByte)), // PUSHF
      ...instructionPattern("1001 1101", instruction => this.#restoreFlags(instruction)), // POPF
      ...instructionPattern("1001 1110", () => { Object.assign(this.#state.flags, statusByte.decode(this.#state.ax >>> 8)); }), // SAHF
      ...instructionPattern("1001 1111", () => { this.#state.ax = (statusByte.encode(this.#state.flags) << 8) | (this.#state.ax & 0xff); }), // LAHF

      // 1010 00 d w: d=0 loads, d=1 stores; w=0 AL, w=1 AX. The DS offset is always a word.
      ...opcodeFamily("1010 00 0 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#moveAbsolute(width, true, instruction)), // MOV AL/AX,[offset]
      ...opcodeFamily("1010 00 1 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#moveAbsolute(width, false, instruction)), // MOV [offset],AL/AX

      ...this.#stringHandlers, // MOVS/CMPS/STOS/LODS/SCAS, with optional REP

      // 1100 001i: i=0 includes an unsigned word stack adjustment; i=1 pops only IP.
      ...instructionPattern("1100 0010", ({ fetchWord, readByte }) => this.#return(fetchWord(), readByte)), // RET n
      ...instructionPattern("1100 0011", ({ readByte }) => this.#return(0, readByte)), // RET

      // 1100 010s loads a far pointer into a general register and ES (s=0) or DS (s=1).
      ...opcodeFamily("1100 010 s", { s: ["es", "ds"] }, ({ s: segment }) => (instruction: InstructionContext) => this.#loadAddress(segment, instruction)), // LES / LDS
      ...instructionPattern("1100 1010", ({ fetchWord, readByte }) => this.#returnFar(fetchWord(), readByte)), // RETF n
      ...instructionPattern("1100 1011", ({ readByte }) => this.#returnFar(0, readByte)), // RETF

      // 1100 11tt: tt=00 breakpoint, 01 immediate type, 10 overflow, 11 interrupt return.
      ...instructionPattern("1100 1100", ({ interrupt }) => interrupt(3)), // INT3
      ...instructionPattern("1100 1101", ({ fetchByte, interrupt }) => interrupt(fetchByte())), // INT n
      ...instructionPattern("1100 1110", ({ interrupt }) => { if (this.#state.flags.of) interrupt(4); }), // INTO
      ...instructionPattern("1100 1111", instruction => {
        this.#returnFar(0, instruction.readByte);
        this.#restoreFlags(instruction);
      }), // IRET

      // 1100 011w + mm 000 rrr: immediate MOV; every other operation selector is unused.
      ...opcodeFamily("1100 011 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#operandGroup(width, this.#immediateMoveOperations, instruction)), // MOV r/m,n
      // 1101 00vw + mm ooo rrr: v=0 shifts once, v=1 uses all eight bits of CL; w selects byte/word.
      ...opcodeFamily("1101 00 v w", { v: [false, true], w: this.#operandWidths }, ({ v: useCL, w: width }) => (instruction: InstructionContext) => this.#shift(width, useCL, instruction)), // ROL/ROR/RCL/RCR/SHL/SHR/SAR

      // 1101 010d: AAM/AAD have a documented fixed second byte 0A, not a general radix operand.
      ...opcodeFamily("1101 010 d", { d: [false, true] }, ({ d: beforeDivision }) => (instruction: InstructionContext) => this.#adjustRadix(beforeDivision, instruction)),
      ...instructionPattern("1101 0111", instruction => this.#translate(instruction)), // XLAT

      // 1101 1ooo + mm ppp rrr: ooo:ppp is the six-bit external opcode; mm/rrr selects its source.
      ...opcodeFamily("1101 1ooo", { o: [0, 1, 2, 3, 4, 5, 6, 7] }, ({ o }) => (instruction: InstructionContext) => this.#escape(o, instruction)), // ESC

      // 1110 00cc: cc=00 LOOPNE, 01 LOOPE, 10 LOOP, 11 JCXZ; all fetch a signed byte.
      ...opcodeFamily("1110 00 cc", { c: ["not-equal", "equal", "always", "zero"] },
        ({ c: condition }) => ({ fetchByte }: InstructionContext) => this.#loop(condition, signed8(fetchByte()))),

      // 1110 r 1 d w: r=0 immediate port/1 DX; d=0 IN/1 OUT; w=0 AL/1 AX.
      ...opcodeFamily("1110 r 1 d w", { r: [false, true], d: [false, true], w: this.#operandWidths },
        ({ r: useDx, d: output, w: width }) => (instruction: InstructionContext) => this.#transferPort(width, output, useDx ? this.#state.dx : instruction.fetchByte(), instruction)), // IN/OUT AL/AX,n/DX

      // E8/E9 use word displacements; EA carries a far pointer and EB a short displacement.
      ...instructionPattern("1110 1000", ({ fetchWord, writeByte }) => this.#call(fetchWord(), writeByte)), // CALL rel16
      ...instructionPattern("1110 1001", ({ fetchWord }) => this.#jump(fetchWord())), // JMP rel16
      ...instructionPattern("1110 1010", instruction => this.#farImmediate(false, instruction)), // JMP ptr16:16
      ...instructionPattern("1110 1011", ({ fetchByte }) => this.#jump(signed8(fetchByte()))), // JMP rel8

      // 1111 011w / 1111 111w: ModR/M's ooo selects the supported unary/adjust operations above.
      ...opcodeFamily("1111 011 w", { w: this.#operandWidths }, ({ w: width }) => (instruction: InstructionContext) => this.#operandGroup(width, this.#unaryOperations, instruction)), // TEST/NOT/NEG/MUL/IMUL/DIV/IDIV r/m
      ...instructionPattern("1111 1110", instruction => this.#operandGroup(8, this.#adjustOperations, instruction)), // INC/DEC r/m8
      ...instructionPattern("1111 1111", instruction => this.#wordGroup(instruction)), // INC/DEC/CALL/JMP/PUSH r/m16

      // 1111 010h: HLT (h=0), CMC (h=1). 1111 1f0v: f=0 carry, f=1 direction; v is its value.
      ...instructionPattern("1111 0100", () => { this.#state.halted = true; }), // HLT
      ...instructionPattern("1111 0101", () => { this.#state.flags.cf = !this.#state.flags.cf; }), // CMC
      ...opcodeFamily("1111 1 f 0 v", { f: ["cf", "df"], v: [false, true] }, ({ f: flag, v: value }) => () => { this.#state.flags[flag] = value; }), // CLC/STC, CLD/STD

      // 1111 101v: v writes IF; only a 0-to-1 transition defers INTR through the next instruction.
      ...opcodeFamily("1111 101 v", { v: [false, true] }, ({ v: enabled }) => (instruction: InstructionContext) => {
        if (enabled && !this.#state.flags.if) instruction.deferInterrupt("intr");
        this.#state.flags.if = enabled;
      }), // CLI/STI
    ];
  }

  // External transfers and synchronization, then ordinary addressing and data transfers.

  #escape(highOpcode: number, instruction: InstructionContext): void {
    const modRM = instruction.fetchByte();
    const address = modRM < 0xc0 ? this.#effectiveAddress(modRM, instruction) : null;
    const memory = address && { ...address, address: physicalAddress(address.segment, address.offset),
      value: this.#readMemoryWord(address.segment, address.offset, instruction.readByte) };
    const escape = { opcode: (highOpcode << 3) | ((modRM >>> 3) & 7), modRM, memory };
    // A disconnected ESC still makes its dummy word read. A connected device gets a detached request.
    this.#connections?.escape?.({ ...escape, memory: memory && { ...memory } });
    instruction.recordAccess({ kind: "escape", ...escape });
  }

  #wait(resuming: boolean, { recordAccess, deferInterrupt }: Pick<InstructionContext, "recordAccess" | "deferInterrupt">): void {
    if (!this.#connections?.test) throw new TypeError("8088 WAIT requires a TEST input connection.");
    const high = this.#connections.test();
    if (typeof high !== "boolean") throw new TypeError("8088 TEST input must return a Boolean pin level.");
    recordAccess({ kind: "test", high });
    this.#state.waiting = high;
    // While waiting, IP identifies the WAIT opcode. Interrupt entry can save it without hidden restart state.
    if (high && !resuming) this.#state.ip = (this.#state.ip - 1) & 0xffff;
    if (!high && resuming) this.#state.ip = (this.#state.ip + 1) & 0xffff;
    // TEST release defers recognition through the next instruction (normally ESC); busy polls allow entry.
    if (!high) deferInterrupt("all");
  }

  #transferPort(width: OperandWidth, output: boolean, port: number, { readPort, writePort }: BytePorts): void {
    const accumulator = this.#registerOperand(width, 0);
    // The 8088 transfers low then high bytes, wrapping within its unsegmented 16-bit port space.
    if (output) {
      const value = accumulator.read();
      writePort(port, value & 0xff);
      if (width === 16) writePort((port + 1) & 0xffff, value >>> 8);
    } else {
      const low = readPort(port);
      const value = width === 8 ? low : low | (readPort((port + 1) & 0xffff) << 8);
      accumulator.write(value); // Commit IN only after every byte has been read successfully.
    }
  }

  #operandGroup(width: OperandWidth, operations: readonly (OperandOperation | undefined)[], instruction: InstructionContext): Rejection | void {
    const modRM = instruction.fetchByte();
    const operation = operations[(modRM >>> 3) & 7];
    if (!operation) return "opcode";
    return operation(width, this.#registerMemoryOperand(width, modRM, instruction), instruction);
  }

  #fetchImmediate(width: OperandWidth, instruction: InstructionContext): number {
    return width === 8 ? instruction.fetchByte() : instruction.fetchWord();
  }

  #registerOperand(width: OperandWidth, selector: number): Operand {
    if (width === 8) {
      const register = this.#byteRegisters[selector]!;
      return {
        read: () => (this.#state[register.word] >>> register.shift) & 0xff,
        write: value => this.#writeByteRegister(register, value),
      };
    }
    const register = this.#wordRegisters[selector]!;
    return { read: () => this.#state[register], write: value => { this.#state[register] = value; } };
  }

  #registerMemoryOperand(width: OperandWidth, modRM: number, instruction: InstructionContext): Operand {
    if (modRM >= 0xc0) return this.#registerOperand(width, modRM & 7);
    const { segment, offset } = this.#effectiveAddress(modRM, instruction);
    return this.#memoryOperand(width, segment, offset, instruction);
  }

  // Memory-only callers reject mod=11 before asking for an effective address.
  #effectiveAddress(modRM: number, { fetchByte, fetchWord, segment }: InstructionContext): MemoryAddress {
    const mode = modRM >>> 6, selector = modRM & 7;
    const direct = mode === 0 && selector === 6;
    const base = direct ? { segment: this.#state.ds, offset: 0 } : this.#memoryBases[selector]!();
    const displacement = direct || mode === 2 ? fetchWord() : mode === 1 ? signed8(fetchByte()) : 0;
    return { segment: segment ?? base.segment, offset: (base.offset + displacement) & 0xffff };
  }

  #memoryOperand(width: OperandWidth, segment: number, offset: number, { readByte, writeByte }: InstructionContext): Operand {
    return width === 8 ? {
      read: () => readByte(physicalAddress(segment, offset)),
      write: value => writeByte(physicalAddress(segment, offset), value),
    } : {
      read: () => this.#readMemoryWord(segment, offset, readByte),
      write: value => this.#writeMemoryWord(segment, offset, value, writeByte),
    };
  }

  #registerMemoryOperands(width: OperandWidth, toRegister: boolean, instruction: InstructionContext): readonly [Operand, Operand] {
    const modRM = instruction.fetchByte();
    const register = this.#registerOperand(width, (modRM >>> 3) & 7);
    const memoryOrRegister = this.#registerMemoryOperand(width, modRM, instruction);
    return toRegister ? [register, memoryOrRegister] : [memoryOrRegister, register];
  }

  #moveRegisterMemory(width: OperandWidth, toRegister: boolean, instruction: InstructionContext): void {
    const [destination, source] = this.#registerMemoryOperands(width, toRegister, instruction);
    destination.write(source.read());
  }

  #exchange(left: Operand, right: Operand): void {
    const leftValue = left.read();
    const rightValue = right.read();
    left.write(rightValue);
    right.write(leftValue);
  }

  #moveAbsolute(width: OperandWidth, toAccumulator: boolean, instruction: InstructionContext): void {
    const offset = instruction.fetchWord();
    const accumulator = this.#registerOperand(width, 0);
    const memory = this.#memoryOperand(width, instruction.segment ?? this.#state.ds, offset, instruction);
    const [destination, source] = toAccumulator ? [accumulator, memory] : [memory, accumulator];
    destination.write(source.read());
  }

  #moveSegment(toSegment: boolean, instruction: InstructionContext): Rejection | void {
    const modRM = instruction.fetchByte(), selector = (modRM >>> 3) & 7;
    const segment = this.#segmentRegisters[selector];
    if (!segment || (toSegment && segment === "cs")) return "opcode";
    const operand = this.#registerMemoryOperand(16, modRM, instruction);
    if (toSegment) this.#loadSegment(segment, operand.read(), instruction);
    else operand.write(this.#state[segment]);
  }

  #loadAddress(segment: "es" | "ds" | undefined, instruction: InstructionContext): Rejection | void {
    const modRM = instruction.fetchByte();
    if (modRM >= 0xc0) return "opcode";
    const register = this.#wordRegisters[(modRM >>> 3) & 7]!;
    const address = this.#effectiveAddress(modRM, instruction);
    if (segment === undefined) this.#state[register] = address.offset; // LEA performs no data read.
    else {
      const pointer = this.#readPointer(address, instruction.readByte);
      this.#state[register] = pointer.offset;
      this.#state[segment] = pointer.segment;
    }
  }

  #translate(instruction: InstructionContext): void {
    const offset = (this.#state.bx + (this.#state.ax & 0xff)) & 0xffff;
    this.#registerOperand(8, 0).write(instruction.readByte(physicalAddress(instruction.segment ?? this.#state.ds, offset)));
  }

  // String primitives perform one element per step; repeats refetch their prefixes on the next step.

  #string(operation: StringOperation, width: OperandWidth, instruction: InstructionContext): Rejection | void {
    const { repeat } = instruction;
    const compares = operation === "compare" || operation === "scan";
    if (repeat === false && !compares) return "opcode"; // REPNE is documented for CMPS/SCAS.
    if (repeat !== undefined && this.#state.cx === 0) return;
    const source = this.#memoryOperand(width, instruction.segment ?? this.#state.ds, this.#state.si, instruction);
    const destination = this.#memoryOperand(width, this.#state.es, this.#state.di, instruction);
    const accumulator = this.#registerOperand(width, 0);
    switch (operation) {
      case "move": destination.write(source.read()); break;
      case "compare": this.#subtract(width, source.read(), destination.read()); break;
      case "store": destination.write(accumulator.read()); break;
      case "load": accumulator.write(source.read()); break;
      case "scan": this.#subtract(width, accumulator.read(), destination.read()); break;
    }
    const delta = (this.#state.flags.df ? -1 : 1) * (width / 8);
    if (operation === "move" || operation === "compare" || operation === "load") this.#state.si = (this.#state.si + delta) & 0xffff;
    if (operation !== "load") this.#state.di = (this.#state.di + delta) & 0xffff;
    if (repeat !== undefined) {
      this.#state.cx = (this.#state.cx - 1) & 0xffff;
      if (this.#state.cx !== 0 && (!compares || this.#state.flags.zf === repeat)) this.#state.ip = instruction.startIp;
    }
  }

  // Control flow and stack operations.

  #jump(displacement: number, take = true): void {
    // IP is past the operand. Modulo 65536 also interprets a word's two's-complement displacement.
    if (take) this.#state.ip = (this.#state.ip + displacement) & 0xffff;
  }

  #call(displacement: number, writeByte: InstructionContext["writeByte"]): void {
    // Fetch the complete displacement before writing the following IP to SS:SP.
    this.#pushWord(this.#state.ip, writeByte);
    this.#jump(displacement);
  }

  #return(discardBytes: number, readByte: InstructionContext["readByte"]): void {
    this.#state.ip = this.#popWord(readByte);
    this.#state.sp = (this.#state.sp + discardBytes) & 0xffff;
  }

  #pushRegister(register: WordRegister, writeByte: InstructionContext["writeByte"]): void {
    // The original 8088's PUSH SP stores the decremented pointer, unlike later x86 CPUs.
    const value = register === "sp" ? (this.#state.sp - 2) & 0xffff : this.#state[register];
    this.#pushWord(value, writeByte);
  }

  #pushWord(value: number, writeByte: InstructionContext["writeByte"]): void {
    this.#state.sp = (this.#state.sp - 2) & 0xffff;
    this.#writeMemoryWord(this.#state.ss, this.#state.sp, value, writeByte);
  }

  #popWord(readByte: InstructionContext["readByte"]): number {
    const value = this.#readMemoryWord(this.#state.ss, this.#state.sp, readByte);
    // POP SP assigns the popped value after this increment, replacing it entirely.
    this.#state.sp = (this.#state.sp + 2) & 0xffff;
    return value;
  }

  #popOperand(instruction: InstructionContext): Rejection | void {
    const modRM = instruction.fetchByte();
    if ((modRM & 0x38) !== 0) return "opcode";
    const destination = this.#registerMemoryOperand(16, modRM, instruction);
    destination.write(this.#popWord(instruction.readByte));
  }

  #wordGroup(instruction: InstructionContext): Rejection | void {
    const modRM = instruction.fetchByte(), operation = (modRM >>> 3) & 7;
    if (operation === 7 || ((operation === 3 || operation === 5) && modRM >= 0xc0)) return "opcode";
    if (operation === 3 || operation === 5) {
      const pointer = this.#readPointer(this.#effectiveAddress(modRM, instruction), instruction.readByte);
      this.#farTransfer(pointer, operation === 3, instruction.writeByte);
      return;
    }
    const operand = this.#registerMemoryOperand(16, modRM, instruction);
    if (operation < 2) return this.#adjustOperations[operation]!(16, operand, instruction);
    const value = operand.read();
    if (operation === 2) this.#pushWord(this.#state.ip, instruction.writeByte); // CALL r/m16
    if (operation === 6) {
      // FF /6's register SP form has the same original-8088 rule as opcode 54.
      this.#pushWord(modRM === 0xf4 ? (value - 2) & 0xffff : value, instruction.writeByte);
    } else this.#state.ip = value; // CALL / JMP r/m16
  }

  #farImmediate(call: boolean, instruction: InstructionContext): void {
    const offset = instruction.fetchWord(), segment = instruction.fetchWord();
    this.#farTransfer({ segment, offset }, call, instruction.writeByte);
  }

  #farTransfer(pointer: MemoryAddress, call: boolean, writeByte: InstructionContext["writeByte"]): void {
    // Capture both target words before a call's stack writes can overlap the pointer or instruction.
    if (call) {
      this.#pushWord(this.#state.cs, writeByte);
      this.#pushWord(this.#state.ip, writeByte);
    }
    this.#state.cs = pointer.segment;
    this.#state.ip = pointer.offset;
  }

  #returnFar(discardBytes: number, readByte: InstructionContext["readByte"]): void {
    const ip = this.#popWord(readByte), cs = this.#popWord(readByte);
    this.#state.ip = ip;
    this.#state.cs = cs;
    this.#state.sp = (this.#state.sp + discardBytes) & 0xffff;
  }

  #loop(condition: "not-equal" | "equal" | "always" | "zero", displacement: number): void {
    if (condition === "zero") this.#jump(displacement, this.#state.cx === 0);
    else {
      this.#state.cx = (this.#state.cx - 1) & 0xffff;
      this.#jump(displacement, this.#state.cx !== 0 && (condition === "always" || this.#state.flags.zf === (condition === "equal")));
    }
  }

  // Arithmetic and flags.

  #aluRegisterMemory(operation: AluOperation, width: OperandWidth, toRegister: boolean, instruction: InstructionContext): void {
    const [destination, source] = this.#registerMemoryOperands(width, toRegister, instruction);
    this.#applyAlu(operation, width, destination, source.read());
  }

  #aluImmediate(width: OperandWidth, shortImmediate: boolean, instruction: InstructionContext): Rejection | void {
    const modRM = instruction.fetchByte();
    const selector = (modRM >>> 3) & 7;
    // Intel's 1979 table leaves /1, /4, and /6 unused for both 82 and 83.
    if (shortImmediate && (selector === 1 || selector === 4 || selector === 6)) return "opcode";
    const destination = this.#registerMemoryOperand(width, modRM, instruction);
    const value = width === 8 ? instruction.fetchByte()
      : shortImmediate ? signed8(instruction.fetchByte()) & 0xffff : instruction.fetchWord();
    this.#applyAlu(this.#aluOperations[selector]!, width, destination, value);
  }

  #applyAlu(operation: AluOperation, width: OperandWidth, destination: Operand, value: number): void {
    const result = operation(width, destination.read(), value);
    if (result !== undefined) destination.write(result);
  }

  #adjust(width: OperandWidth, value: number, decrement: boolean): number {
    const carry = this.#state.flags.cf;
    const result = decrement ? this.#subtract(width, value, 1) : this.#add(width, value, 1);
    this.#state.flags.cf = carry;
    return result;
  }

  #testImmediate(width: OperandWidth, operand: Operand, instruction: InstructionContext): void {
    this.#applyAlu(this.#test, width, operand, this.#fetchImmediate(width, instruction));
  }

  #shift(width: OperandWidth, useCL: boolean, instruction: InstructionContext): Rejection | void {
    const modRM = instruction.fetchByte();
    const selector = (modRM >>> 3) & 7;
    const operation = this.#shiftOperations[selector];
    if (!operation) return "opcode";
    const operand = this.#registerMemoryOperand(width, modRM, instruction);
    // Capture CL before writing any destination, including CL or CX itself. The 8088 does not mask it to five bits.
    const count = useCL ? this.#state.cx & 0xff : 1;
    const value = operand.read();
    let result = value;
    for (let bit = 0; bit < count; bit++) {
      const shifted = operation(width, result);
      result = shifted.result;
      this.#state.flags.cf = shifted.carry;
    }
    // Only a one-bit operation defines OF; preserve its incoming value for larger counts.
    if (count === 1) this.#state.flags.of = ((value ^ result) & 2 ** (width - 1)) !== 0;
    // 000–011 are rotates; only the shift selectors 100/101/111 replace result flags.
    if (count > 0 && selector >= 4) {
      this.#setResultFlags(width, result);
      this.#state.flags.af = false; // Undefined after shifts; deterministic, as for logic.
    }
    // At this instruction-level boundary even count zero reads and writes the unchanged operand, preserving flags.
    operand.write(result);
  }

  #multiply(width: OperandWidth, value: number, signed: boolean): void {
    const modulus = 2 ** width, sign = modulus / 2;
    const accumulator = this.#state.ax % modulus;
    const left = signed && accumulator >= sign ? accumulator - modulus : accumulator;
    const right = signed && value >= sign ? value - modulus : value;
    const product = left * right; // Even a 16-bit product is exact as a JavaScript number.
    this.#state.ax = product & 0xffff;
    if (width === 16) this.#state.dx = (product >>> 16) & 0xffff;
    this.#state.flags.cf = this.#state.flags.of = signed ? product < -sign || product >= sign : product >= modulus;
    // Other arithmetic flags are undefined on hardware; preserve them under the model policy.
  }

  #divide(width: OperandWidth, value: number, signed: boolean): Rejection | void {
    const modulus = 2 ** width, sign = modulus / 2;
    // Multiplication, rather than a signed bitwise OR, preserves an unsigned DX:AX dividend.
    const raw = width === 8 ? this.#state.ax : this.#state.dx * 0x10000 + this.#state.ax;
    const dividend = signed && raw >= modulus * modulus / 2 ? raw - modulus * modulus : raw;
    const divisor = signed && value >= sign ? value - modulus : value;
    const quotient = Math.trunc(dividend / divisor);
    // The original 8088 rejects the most negative quotient too: -128 / -32768 are divide errors.
    if (value === 0 || (signed ? quotient <= -sign || quotient >= sign : quotient >= modulus)) return "divide-error";
    const remainder = dividend % divisor;
    if (width === 8) this.#state.ax = ((remainder & 0xff) << 8) | (quotient & 0xff);
    else { this.#state.ax = quotient & 0xffff; this.#state.dx = remainder & 0xffff; }
    // Every arithmetic flag is undefined after division; preserve all flags.
  }

  #decimalAdjust(subtracting: boolean): void {
    const value = this.#state.ax & 0xff, flags = this.#state.flags;
    // Original 8088 hardware uses 9F, rather than 99, as the high-digit threshold when AF was set.
    const low = (value & 0x0f) > 9 || flags.af, high = value > (flags.af ? 0x9f : 0x99) || flags.cf;
    const correction = (low ? 6 : 0) + (high ? 0x60 : 0);
    const result = (value + (subtracting ? -correction : correction)) & 0xff;
    flags.af = low;
    flags.cf = high;
    this.#registerOperand(8, 0).write(result);
    this.#setResultFlags(8, result); // OF is undefined and preserved.
  }

  #asciiAdjust(subtracting: boolean): void {
    const value = this.#state.ax & 0xff, high = this.#state.ax >>> 8;
    const adjust = (value & 0x0f) > 9 || this.#state.flags.af;
    const delta = adjust ? (subtracting ? -1 : 1) : 0;
    // On the original 8088 the byte adjustments are separate: no extra AL carry/borrow enters AH.
    this.#state.ax = (((high + delta) & 0xff) << 8) | ((value + 6 * delta) & 0x0f);
    this.#state.flags.af = this.#state.flags.cf = adjust;
    // OF/SF/ZF/PF are undefined and preserved.
  }

  #adjustRadix(beforeDivision: boolean, { fetchByte }: InstructionContext): Rejection | void {
    if (fetchByte() !== 0x0a) return "opcode";
    const low = this.#state.ax & 0xff;
    this.#state.ax = beforeDivision ? ((this.#state.ax >>> 8) * 10 + low) & 0xff
      : (Math.trunc(low / 10) << 8) | (low % 10);
    this.#setResultFlags(8, this.#state.ax & 0xff); // CF/AF/OF are undefined and preserved.
  }

  #add(width: OperandWidth, left: number, right: number, carryIn: 0 | 1 = 0): number {
    const { result, carry, halfCarry, overflow } = add(width, left, right, carryIn);
    this.#state.flags.cf = carry;
    this.#state.flags.af = halfCarry;
    this.#state.flags.of = overflow;
    this.#setResultFlags(width, result);
    return result;
  }

  #subtract(width: OperandWidth, left: number, right: number, borrowIn: 0 | 1 = 0): number {
    const { result, borrow, halfBorrow, overflow } = subtract(width, left, right, borrowIn);
    this.#state.flags.cf = borrow;
    this.#state.flags.af = halfBorrow;
    this.#state.flags.of = overflow;
    this.#setResultFlags(width, result);
    return result;
  }

  #logic(width: OperandWidth, result: number): number {
    this.#state.flags.cf = this.#state.flags.of = false;
    // Intel leaves AF undefined for logic; clear it deterministically, matching the hardware fixtures.
    this.#state.flags.af = false;
    this.#setResultFlags(width, result);
    return result;
  }

  #setResultFlags(width: OperandWidth, result: number): void {
    this.#state.flags.zf = result === 0;
    this.#state.flags.sf = (result & (width === 8 ? 0x80 : 0x8000)) !== 0;
    // Parity is defined by the low byte even for word operations.
    this.#state.flags.pf = evenParity8(result & 0xff);
  }

  // Memory words. Each byte uses a wrapping 16-bit offset within its segment;
  // physicalAddress then wraps that byte's address onto the 20-bit bus.

  #readPointer({ segment, offset }: MemoryAddress, readByte: InstructionContext["readByte"]): MemoryAddress {
    const target = this.#readMemoryWord(segment, offset, readByte);
    const targetSegment = this.#readMemoryWord(segment, (offset + 2) & 0xffff, readByte);
    return { segment: targetSegment, offset: target };
  }

  #readMemoryWord(segment: number, offset: number, readByte: InstructionContext["readByte"]): number {
    const low = readByte(physicalAddress(segment, offset));
    const high = readByte(physicalAddress(segment, (offset + 1) & 0xffff));
    return low | (high << 8);
  }

  #writeMemoryWord(segment: number, offset: number, value: number, writeByte: InstructionContext["writeByte"]): void {
    writeByte(physicalAddress(segment, offset), value & 0xff);
    writeByte(physicalAddress(segment, (offset + 1) & 0xffff), value >>> 8);
  }
}
