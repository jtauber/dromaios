import { opcodeEntries as chapterOpcodes, sourceReaders as chapterSources } from "./generated/6809-base.ts";
import { instructions as stateActions, sourceReaders } from "./generated/6809-state.ts";
import { instructions as semantics } from "./generated/6809.ts";
import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition, InstructionStep, WaitingStep } from "./execution-records.ts";
import { executionBoundary } from "./execution-boundary.ts";
import { executeByteInstruction } from "./execute-byte-instruction.ts";
import { readWordBE } from "./binary.ts";
import { recordMemory } from "./memory-access.ts";
import type { ByteMemory, MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { copyState, readState } from "./state.ts";
import { cpu6809StateDescription } from "./state/6809.ts";
import type { Cpu6809State } from "./state/6809.ts";
import type { ReadonlyState } from "./state.js";
import type { OpcodeEntry } from "./opcodes.ts";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import { motorolaOperandBindings, motorolaBranchNames, motorola6809TransferForms } from "./motorola.ts";

export { cpu6809StateDescription } from "./state/6809.ts";
export type { Cpu6809State, Cpu6809Flags } from "./state/6809.ts";

export type Cpu6809Snapshot = ReadonlyState<Cpu6809State> & {
  readonly d: number;
};

export type Cpu6809MemoryAccess = MemoryAccess;

export type Cpu6809Instruction = FetchedInstruction;

export type Cpu6809StepRecord = InstructionStep<Cpu6809Snapshot> | WaitingStep<Cpu6809Snapshot>;

export type Cpu6809ResetRecord = StateTransition<Cpu6809Snapshot>;

export type Cpu6809InterruptSource = "irq" | "firq" | "nmi";

/** A masked request can release SYNC without entering an interrupt handler. */
export type Cpu6809InterruptRecord = StateTransition<Cpu6809Snapshot> & { readonly instruction: null } & (
  | { readonly source: Cpu6809InterruptSource; readonly outcome: "accepted" }
  | { readonly source: "irq" | "firq"; readonly outcome: "ignored" | "resumed"; readonly reason: "masked" }
  | { readonly source: "nmi"; readonly outcome: "ignored"; readonly reason: "unarmed" }
);

type OpcodeHandler = (instruction: InstructionContext) => "unsupported" | void;
type OperandReader = (instruction: InstructionContext) => number;
type AddressReader = (instruction: InstructionContext) => number | undefined;

const instructionPattern = opcodePattern<OpcodeHandler>;

// Vector address, frame size, and masks applied AFTER saving the original CC.
const interruptEntries = {
  firq: { vector: 0xfff6, entire: false, masks: 0x50 },
  irq:  { vector: 0xfff8, entire: true, masks: 0x10 },
  nmi:  { vector: 0xfffc, entire: true, masks: 0x50 },
} as const;

/** Instruction-level Motorola 6809 with explicit boundary IRQ/FIRQ/NMI delivery. */
export class Cpu6809 {
  readonly #ram: Ram;
  readonly #opcodeHandlers: Readonly<Partial<Record<number, OpcodeHandler>>>;
  readonly #state: Cpu6809State;
  readonly #atBoundary = executionBoundary("6809 step, reset, and interrupt calls must not be reentrant.");

  constructor(ram: Ram, initialState: Omit<Cpu6809Snapshot, "d">) {
    if (ram.size !== 0x10000) {
      throw new RangeError("The 6809 model requires exactly 64 KiB of RAM.");
    }
    this.#ram = ram;
    this.#state = readState(cpu6809StateDescription, initialState);
    this.#opcodeHandlers = this.#createOpcodeHandlers();
  }

  /** Inspect a detached copy, including D derived from A/B, without accessing RAM. */
  snapshot(): Cpu6809Snapshot {
    const state = copyState(cpu6809StateDescription, this.#state);
    return { ...state, d: sourceReaders(state).views.D() };
  }

  /** Read the reset vector, set DP/F/I, release waits, and disarm NMI. */
  reset(): Cpu6809ResetRecord {
    return this.#atBoundary(() => {
      const before = this.snapshot();
      const { accesses, readByte } = recordMemory(this.#ram);
      this.#state.pc = this.#readWord(0xfffe, readByte);
      this.#state.dp = 0;
      this.#state.flags.f = true;
      this.#state.flags.i = true;
      this.#state.waitMode = "none";
      this.#state.nmiArmed = false;
      return { before, after: this.snapshot(), accesses };
    });
  }

  /** Attempt one instruction, or report an existing wait without accessing RAM. */
  step(): Cpu6809StepRecord {
    return this.#atBoundary(() => {
      const before = this.snapshot();
      if (this.#state.waitMode !== "none") {
        return { before, after: this.snapshot(), instruction: null, accesses: [], outcome: "waiting" };
      }
      const { instruction, accesses, executed } = executeByteInstruction(this.#state, this.#ram, this.#opcodeHandlers, readWordBE);
      const record = { before, after: this.snapshot(), instruction, accesses };
      return executed
        ? { ...record, outcome: this.#state.waitMode === "none" ? "executed" : "waiting" }
        : { ...record, outcome: "unsupported", reason: "opcode" };
    });
  }

  /** Offer one selected request; the caller owns pending signals, priorities, and NMI edges. */
  interrupt(source: Cpu6809InterruptSource): Cpu6809InterruptRecord {
    return this.#atBoundary<Cpu6809InterruptRecord>(() => {
      if (source !== "irq" && source !== "firq" && source !== "nmi") {
        throw new RangeError("6809 interrupt source must be irq, firq, or nmi.");
      }
      const before = this.snapshot();
      const idle = { before, instruction: null, accesses: [], source } as const;
      if (source === "nmi" && !this.#state.nmiArmed) {
        return { ...idle, after: this.snapshot(), source, outcome: "ignored", reason: "unarmed" };
      }
      if (source !== "nmi" && this.#state.flags[source === "irq" ? "i" : "f"]) {
        const outcome = this.#state.waitMode === "sync" ? "resumed" : "ignored";
        if (outcome === "resumed") this.#state.waitMode = "none";
        return { ...idle, after: this.snapshot(), source, outcome, reason: "masked" };
      }
      const memory = recordMemory(this.#ram);
      this.#enterInterrupt(source, memory);
      return { before, after: this.snapshot(), instruction: null, accesses: memory.accesses, source, outcome: "accepted" };
    });
  }

  // Opcode selectors and construction.

  // mm in 1 r mm oooo: 00 is immediate; the other modes resolve a data address.
  readonly #directOperandAddress: OperandReader = ({ fetchByte }) => this.#directAddress(fetchByte());
  readonly #indexedOperandAddress: AddressReader = instruction => {
    const address = chapterSources(this.#state).addresses.indexed(instruction);
    return address === "unsupported" ? undefined : address;
  };
  readonly #extendedOperandAddress: OperandReader = ({ fetchWord }) => fetchWord();
  readonly #memoryModes = [
    { bits: "01", address: this.#directOperandAddress },
    { bits: "10", address: this.#indexedOperandAddress },
    { bits: "11", address: this.#extendedOperandAddress },
  ] as const;

  // TFR/EXG postbyte ssss dddd: selector bit 3 chooses word=0/byte=1.
  // 0000..0101 = D/X/Y/U/S/PC; 1000..1011 = A/B/CC/DP; other selectors are undefined.
  readonly #exchangeHandlers = this.#registerTransferHandlers("exg");
  readonly #transferHandlers = this.#registerTransferHandlers("tfr");

  readonly #operandHandlers = motorolaOperandBindings(() => this.#state, this.#memoryModes);

  // Prefix 10 selects page 2. Word encodings retain mm=00/01/10/11 addressing.
  // Transfers append 0=load/1=store; immediate stores are undefined.
  readonly #page2Handlers = opcodeTable<OpcodeHandler>([
    ...instructionPattern("0011 1111", instruction => semantics.swi2(this.#state, instruction)), // SWI2
    ...this.#longBranchHandlers(), // LBRN and LBcc; LBRA has base opcode 16
    ...this.#operandHandlers("10 mm 0011", semantics.cmpdImmediate, semantics.cmpdMemory), // CMPD
    ...this.#operandHandlers("10 mm 1100", semantics.cmpyImmediate, semantics.cmpyMemory), // CMPY
    ...this.#operandHandlers("10 mm 1110", semantics.ldyImmediate, semantics.ldyMemory), // LDY
    ...this.#operandHandlers("10 mm 1111", undefined, semantics.styMemory), // STY
    ...this.#operandHandlers("11 mm 1110", semantics.ldsImmediate, semantics.ldsMemory), // LDS; arms NMI
    ...this.#operandHandlers("11 mm 1111", undefined, semantics.stsMemory), // STS
  ]);
  // Prefix 11 selects page 3: the same comparison fields select U/S rather than D/Y.
  readonly #page3Handlers = opcodeTable<OpcodeHandler>([
    ...instructionPattern("0011 1111", instruction => semantics.swi3(this.#state, instruction)), // SWI3
    ...this.#operandHandlers("10 mm 0011", semantics.cmpuImmediate, semantics.cmpuMemory), // CMPU
    ...this.#operandHandlers("10 mm 1100", semantics.cmpsImmediate, semantics.cmpsMemory), // CMPS
  ]);

  // Base opcode page; 10/11 dispatch exactly one following opcode in their own page.
  #createOpcodeHandlers() {
    return opcodeTable<OpcodeHandler>([
      ...chapterOpcodes(this.#state),
      ...instructionPattern("0001 0000", instruction => this.#executeFollowingByte(this.#page2Handlers, instruction)),
      ...instructionPattern("0001 0001", instruction => this.#executeFollowingByte(this.#page3Handlers, instruction)),
      ...instructionPattern("0001 0011", () => semantics.sync(this.#state)), // SYNC

      // 0001111 t: t=0 exchanges, t=1 transfers; the postbyte selects same-width registers.
      ...instructionPattern("0001111 0", instruction => this.#executeFollowingByte(this.#exchangeHandlers, instruction)), // EXG
      ...instructionPattern("0001111 1", instruction => this.#executeFollowingByte(this.#transferHandlers, instruction)), // TFR

      // 001101 s p: s=0 selects S, s=1 selects U; p=0 pushes, p=1 pulls.
      // Mask bits 7..0: PC, other stack pointer, Y, X, DP, B, A, CC (E F H I N Z V C).
      ...opcodeFamily("001101 s p", { s: [[semantics.pshs, semantics.puls], [semantics.pshu, semantics.pulu]], p: [0, 1] },
        ({ s: operations, p: direction }) => (instruction: InstructionContext) => operations[direction]!(this.#state, instruction)), // PSHS / PULS / PSHU / PULU
      ...instructionPattern("0011 1011", instruction => semantics.rti(this.#state, instruction)), // RTI
      ...instructionPattern("0011 1100", instruction => semantics.cwai(this.#state, instruction)), // CWAI #mask
      ...instructionPattern("0011 1111", instruction => semantics.swi(this.#state, instruction)), // SWI

    ]);
  }

  #registerTransferHandlers(operation: "tfr" | "exg") {
    const bodies: Readonly<Record<`${"tfr" | "exg"}_${string}_${string}`, (state: Cpu6809State) => void>> = semantics;
    return opcodeTable<OpcodeHandler>(motorola6809TransferForms.map(([postbyte, { source, target }]) =>
      [postbyte, () => bodies[`${operation}_${source}_${target}`]!(this.#state)]));
  }

  #executeFollowingByte(table: Readonly<Partial<Record<number, OpcodeHandler>>>, instruction: InstructionContext): "unsupported" | void {
    const handler = table[instruction.fetchByte()];
    return handler ? handler(instruction) : "unsupported";
  }

  // Page 10 has no BRA at 0010 0000; 0010 cccc otherwise retains the native condition codes.
  #longBranchHandlers(): readonly OpcodeEntry<OpcodeHandler>[] {
    return motorolaBranchNames.flatMap((name, condition) => name === "bra" ? [] :
      instructionPattern(`0010 ${condition.toString(2).padStart(4, "0")}`,
        instruction => semantics[`l${name}`](this.#state, instruction)));
  }

  // Addressing.

  #directAddress(offset: number): number {
    return (this.#state.dp << 8) | offset;
  }

  // Interrupt entry and return share the mask-driven register stack operations.

  #saveInterruptFrame(entire: boolean, writeByte: ByteMemory["writeByte"]): void {
    this.#state.flags.e = entire;
    semantics.pushFrame(this.#state, entire ? 0xff : 0x81, { writeByte }); // Full frame or PC/CC only.
  }

  #enterInterrupt(source: keyof typeof interruptEntries, { readByte, writeByte }: ByteMemory): void {
    const { vector, entire, masks } = interruptEntries[source];
    // CWAI already saved a full frame, even when FIRQ is the request that wakes it.
    if (this.#state.waitMode !== "cwai") this.#saveInterruptFrame(entire, writeByte);
    stateActions.maskCC(this.#state, masks);
    this.#state.waitMode = "none";
    this.#state.pc = this.#readWord(vector, readByte);
  }

  // Memory operations.

  #readWord(address: number, readByte: InstructionContext["readByte"]): number {
    return readWordBE(() => {
      const byte = readByte(address);
      address = (address + 1) & 0xffff;
      return byte;
    });
  }
}
