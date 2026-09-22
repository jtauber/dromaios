import { sourceReaders } from "./generated/68000-state.ts";
import type { MemoryConnection } from "../memory/connection.ts";
import type { FetchedInstruction, StateTransition } from "./execution-records.ts";
import { checkUnsigned } from "../validation.ts";
import { signed8 } from "./binary.ts";
import { executionBoundary } from "./execution-boundary.ts";
import { recordMemory } from "./memory-access.ts";
import type { ByteMemory, MemoryAccess, RecordedMemory } from "./memory-access.ts";
import { copyState, readState } from "./state.ts";
import type { ReadonlyState } from "./state.ts";
import { cpu68000StateDescription } from "./state/68000.ts";
import type { Cpu68000State, Cpu68000Flags } from "./state/68000.ts";
export { cpu68000StateDescription } from "./state/68000.ts";
export type { Cpu68000State, Cpu68000Flags } from "./state/68000.ts";
import { instructions as generated } from "./generated/68000.ts";
import { instructions as quick } from "./generated/68000-quick.ts";
import { opcodeInstructions as moves } from "./generated/68000-moves.ts";
import { opcodeInstructions as logic } from "./generated/68000-logic.ts";
import { opcodeInstructions as arithmetic } from "./generated/68000-arithmetic.ts";
import { instructions as bitBodies } from "./generated/68000-bits.ts";
import { bitForms68000 } from "./68000-bits.ts";
import { instructions as wordArithmeticBodies } from "./generated/68000-word-arithmetic.ts";
import { instructions as controlBodies } from "./generated/68000-control.ts";
import { instructions as systemBodies } from "./generated/68000-system.ts";
import { systemForms68000 } from "./68000-system.ts";
import { instructions as transferBodies } from "./generated/68000-transfers.ts";
import { transferForms68000 } from "./68000-transfers.ts";
import { controlForms68000 } from "./68000-control.ts";
import { instructions as decimalBodies } from "./generated/68000-decimal.ts";
import { wordArithmeticForms68000, decimalForms68000 } from "./68000-arithmetic.ts";
import type { Cpu68000AddressContext, Cpu68000ControlContext, Cpu68000ResetContext } from "./68000-context.ts";
import { opcodeFamily, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.ts";

export type Cpu68000Snapshot = ReadonlyState<Cpu68000State> & {
  /** Active stack pointer: SSP in supervisor mode, USP in user mode. */
  readonly a7: number;
  /** Low 24 bits of the full 32-bit PC. */
  readonly physicalPc: number;
};

/** Physical byte access on the 24-bit memory bus. */
export type Cpu68000MemoryAccess = MemoryAccess;
export type Cpu68000Access = MemoryAccess | { readonly kind: "reset" };

/** Host-owned devices; RESET invokes this connection without reinitializing the CPU. */
export type Cpu68000Connections = Cpu68000ResetContext;

export type Cpu68000InterruptLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Cpu68000InterruptVector = number | "autovector" | "spurious";
export type Cpu68000InterruptAccess = MemoryAccess | {
  readonly kind: "acknowledge";
  readonly level: Cpu68000InterruptLevel;
  readonly value: Cpu68000InterruptVector;
};
export type Cpu68000InterruptRecord = StateTransition<Cpu68000Snapshot, Cpu68000InterruptAccess> & {
  readonly instruction: null;
  readonly level: Cpu68000InterruptLevel;
} & (
  | { readonly outcome: "accepted"; readonly vector: number; readonly returnPc: number }
  | { readonly outcome: "ignored"; readonly reason: "masked" | "trace-pending" | "faulted" }
  | { readonly outcome: "executed" | "halted"; readonly exception: Cpu68000MemoryErrorDelivery }
);

/** Instruction address is the full 32-bit PC; accesses contain physical addresses. */
export type Cpu68000Instruction = FetchedInstruction;

export interface Cpu68000MemoryFault {
  readonly operation: "fetch" | "read" | "write";
  /** Full logical address of the failed transfer. */
  readonly address: number;
}

export type Cpu68000AlignmentFault = Cpu68000MemoryFault;

export interface Cpu68000BusFault extends Cpu68000MemoryFault {
  readonly source: "bus-error";
}

/** Synchronous sources using the original 68000's six-byte supervisor frame. */
export type Cpu68000Exception = "divide-by-zero" | "bounds-check" | "privilege-violation"
  | "trap" | "overflow-trap" | "illegal-instruction" | "line-a" | "line-f";

export interface Cpu68000ShortExceptionDelivery {
  readonly source: Cpu68000Exception | "trace";
  readonly vector: number;
  readonly returnPc: number;
}

interface MemoryErrorFrame {
  /** Fetch cursor, or the interrupted exception's vector address; no hardware prefetch advancement. */
  readonly returnPc: number;
  readonly fault: Cpu68000AlignmentFault & {
    readonly instructionRegister: number;
    readonly functionCode: 1 | 2 | 5 | 6;
    readonly processingInstruction: boolean;
  };
  /** A second bus or address error during entry leaves the CPU terminally halted. */
  readonly entryFault?: Cpu68000AlignmentFault | Cpu68000BusFault;
}

export interface Cpu68000AddressErrorDelivery extends MemoryErrorFrame {
  readonly source: "address-error";
  readonly vector: 3;
}
export interface Cpu68000BusErrorDelivery extends MemoryErrorFrame {
  readonly source: "bus-error";
  readonly vector: 2;
}
export type Cpu68000MemoryErrorDelivery = Cpu68000AddressErrorDelivery | Cpu68000BusErrorDelivery;
export type Cpu68000ExceptionDelivery = Cpu68000ShortExceptionDelivery | Cpu68000MemoryErrorDelivery;
// Detection retains the access space until the exception captures its function code.
interface AlignmentFault extends Cpu68000MemoryFault { readonly programSpace?: boolean }
type InstructionFault = AlignmentFault | Cpu68000Exception;

// Only an explicit connection result creates this private unwinding signal. Host throws propagate.
class BusFault implements AlignmentFault {
  readonly operation: "fetch" | "read" | "write";
  readonly address: number;
  readonly programSpace: boolean;
  vector?: number;
  constructor(operation: "fetch" | "read" | "write", address: number, programSpace: boolean) {
    this.operation = operation;
    this.address = address;
    this.programSpace = programSpace;
  }
}

export type Cpu68000StepRecord = StateTransition<Cpu68000Snapshot, Cpu68000Access> & {
  readonly instruction: Cpu68000Instruction | null;
  readonly outcome: "executed" | "halted";
  readonly exception?: Cpu68000ExceptionDelivery;
  /** A failed first fetch after reset or memory-error entry halts without another frame. */
  readonly fault?: Cpu68000AlignmentFault | Cpu68000BusFault;
};

export type Cpu68000ResetRecord = StateTransition<Cpu68000Snapshot> & {
  readonly fault?: Cpu68000AlignmentFault | Cpu68000BusFault;
};

interface MemoryContext extends ByteMemory {
  readonly fetchByte: (address: number) => number;
  readonly readProgramByte: (address: number) => number;
}

interface InstructionContext extends MemoryContext, Cpu68000ControlContext, Cpu68000ResetContext {
  readonly fetchWord: () => number;
  readonly fetchLong: () => number;
}

// Shared bodies receive decoded selectors and only the context capabilities their stages require.
const operandBodies: Readonly<Record<string, (state: Cpu68000State, sourceMode: number, sourceCode: number,
  destinationMode: number, destinationCode: number, instruction: InstructionContext & Cpu68000AddressContext) => InstructionFault | void>> = { ...bitBodies, ...wordArithmeticBodies, ...decimalBodies };

const controlInstructions: Readonly<Record<string, (state: Cpu68000State, mode: number, code: number, displacement: number,
  instruction: InstructionContext & Cpu68000AddressContext) => InstructionFault | void>> = controlBodies;

const transferInstructions: Readonly<Record<string, (state: Cpu68000State, mode: number, code: number,
  instruction: InstructionContext & Cpu68000AddressContext) => InstructionFault | void>> = transferBodies;

const systemInstructions: Readonly<Record<string, (state: Cpu68000State, mode: number, code: number,
  instruction: InstructionContext & Cpu68000AddressContext) => InstructionFault | void>> = systemBodies;

type OpcodeHandler = (cpu: Cpu68000, instruction: InstructionContext) => InstructionFault | void;
type AddressRegister = `a${0 | 1 | 2 | 3 | 4 | 5 | 6}` | "usp" | "ssp";
type OperandSize = 8 | 16 | 32;
// Pending auto-updates are visible to the destination but commit only after alignment checks.
type AddressUpdates = Map<AddressRegister, number>;
interface ExceptionFrame { readonly stack: number; readonly status: number }

/** Instruction-level Motorola 68000 with 32-bit registers and a 24-bit memory connection. */
export class Cpu68000 {
  readonly #memory: MemoryConnection;
  readonly #state: Cpu68000State;
  readonly #readers: ReturnType<typeof sourceReaders>;
  readonly #connections: Cpu68000Connections | undefined;
  readonly #atBoundary = executionBoundary("68000 step, reset, and interrupt calls must not be reentrant.");

  constructor(memory: MemoryConnection, initialState: Cpu68000State, connections?: Cpu68000Connections) {
    if (memory.size !== 0x1000000) throw new RangeError("The 68000 model requires a 16 MiB memory address space.");
    this.#memory = memory;
    this.#state = readState(cpu68000StateDescription, initialState);
    this.#readers = sourceReaders(this.#state);
    this.#connections = connections;
  }

  /** Inspect detached state, the active stack pointer, and the physical PC without RAM access. */
  snapshot(): Cpu68000Snapshot {
    const state = copyState(cpu68000StateDescription, this.#state);
    const { views } = sourceReaders(state);
    return { ...state, a7: views.A7(), physicalPc: views.PHYSICALPC() };
  }

  /** Read the external-reset vectors, enter supervisor mode, clear trace, and mask interrupts. */
  reset(): Cpu68000ResetRecord {
    return this.#atBoundary((): Cpu68000ResetRecord => {
      const before = this.snapshot();
      const { accesses, readProgramByte } = this.#recordMemory();
      let fault: Cpu68000AlignmentFault | Cpu68000BusFault | undefined;
      try {
        // Reset vectors occupy supervisor program space. Each complete long commits independently.
        this.#state.ssp = this.#readMemory(32, 0, readProgramByte);
        this.#state.pc = this.#readMemory(32, 4, readProgramByte);
        if (this.#state.pc % 2) fault = { operation: "fetch", address: this.#state.pc };
      } catch (error) {
        if (!(error instanceof BusFault)) throw error;
        fault = this.#busFaultRecord(error);
      }
      this.#state.flags.s = true;
      this.#state.flags.t = false;
      this.#state.interruptMask = 7;
      this.#state.halted = this.#state.tracePending = false;
      this.#state.faulted = fault !== undefined;
      this.#state.entry = { kind: "reset", vector: 0 };
      // Registers and condition codes not specified by reset retain their supplied values.
      return { before, after: this.snapshot(), accesses, ...(fault ? { fault } : {}) };
    });
  }

  /** Deliver an owed trace, or attempt one instruction with its synchronous exception. */
  step(): Cpu68000StepRecord {
    return this.#atBoundary((): Cpu68000StepRecord => {
      const before = this.snapshot();
      const accesses: Cpu68000Access[] = [];
      const memory = this.#recordMemory(access => { accesses.push(access); });
      if (before.faulted) return { before, after: this.snapshot(), accesses, instruction: null, outcome: "halted" };
      if (before.tracePending) {
        const exception = this.#enterException({ source: "trace", vector: 9, returnPc: before.pc }, memory);
        return { before, after: this.snapshot(), accesses, instruction: null, exception,
          outcome: this.#state.faulted ? "halted" : "executed" };
      }
      if (before.halted) return { before, after: this.snapshot(), accesses, instruction: null, outcome: "halted" };
      const address = before.pc;
      if (address % 2 !== 0) {
        const delivery = this.#initialFetchFault({ operation: "fetch", address }, memory);
        return { before, after: this.snapshot(), accesses, instruction: null, ...delivery,
          outcome: this.#state.faulted ? "halted" : "executed" };
      }
      const bytes: number[] = [];
      // Keep the sequential fetch cursor even when a call selects its target before stacking.
      let cursor = address;
      let target: number | undefined;
      let instruction: Cpu68000Instruction | null = null;
      const fetchWord = (): number => {
        const high = memory.fetchByte(cursor);
        const low = memory.fetchByte(cursor + 1);
        cursor = (cursor + 2) >>> 0;
        bytes.push(high, low);
        return (high << 8) | low;
      };
      try {
        const opcode = this.#state.ir = fetchWord();
        instruction = { address, bytes };
        this.#state.entry = { kind: "none", vector: 0 };
        const handler = Cpu68000.#opcodeHandlers[opcode];
        // Unmatched words fault during decoding, before extensions or operands.
        const fault = handler ? handler(this, {
          ...memory, nextAddress: () => cursor, fetchWord,
          resetDevices: () => {
            if (!this.#connections) throw new Error("RESET requires a connected device reset callback.");
            this.#connections.resetDevices();
            accesses.push({ kind: "reset" });
          },
          jump: address => { target = address; },
          fetchLong: () => {
            const high = fetchWord();
            return ((high << 16) | fetchWord()) >>> 0;
          },
        }) : "illegal-instruction";
        if (typeof fault === "string") {
          const { vector, instructionCompleted } = Cpu68000.#exceptions[fault];
          const requested = {
            source: fault,
            vector: vector + (fault === "trap" ? opcode & 15 : 0),
            // Faulting instructions restart; arithmetic and explicit traps resume after their operands.
            returnPc: instructionCompleted ? cursor : address,
          };
          const exception = this.#enterException(requested, memory);
          // Only completed instructions can owe a trace after their synchronous exception.
          if (exception.source !== "address-error" && exception.source !== "bus-error") this.#state.tracePending = before.flags.t && instructionCompleted;
          return { before, after: this.snapshot(), accesses, instruction, exception,
            outcome: this.#state.faulted ? "halted" : "executed" };
        }
        if (fault) {
          const exception = this.#memoryError(fault, cursor, true, memory);
          return { before, after: this.snapshot(), accesses, instruction, exception,
            outcome: this.#state.faulted ? "halted" : "executed" };
        }
        this.#state.pc = target ?? cursor;
        this.#state.tracePending = before.flags.t; // Sample T before execution, including SR loads and RTE.
        return { before, after: this.snapshot(), accesses, instruction, outcome: this.#state.halted && !this.#state.tracePending ? "halted" : "executed" };
      } catch (error) {
        if (!(error instanceof BusFault)) throw error;
        const delivery = instruction ? { exception: this.#memoryError(error, cursor, true, memory) }
          : this.#initialFetchFault(error, memory);
        return { before, after: this.snapshot(), accesses, instruction, ...delivery,
          outcome: this.#state.faulted ? "halted" : "executed" };
      }
    });
  }

  /** Offer one selected level; a level-7 offer represents a new edge or an eligible held request. */
  interrupt(level: Cpu68000InterruptLevel, acknowledge: () => Cpu68000InterruptVector): Cpu68000InterruptRecord {
    return this.#atBoundary((): Cpu68000InterruptRecord => {
      checkUnsigned("Interrupt level", level, 7);
      if (level < 1) throw new RangeError("Interrupt level must be in 1..7.");
      const before = this.snapshot();
      const idle = { before, after: this.snapshot(), instruction: null, accesses: [], level } as const;
      if (before.faulted) return { ...idle, outcome: "ignored", reason: "faulted" };
      if (before.tracePending) return { ...idle, outcome: "ignored", reason: "trace-pending" };
      if (level !== 7 && level <= before.interruptMask) return { ...idle, outcome: "ignored", reason: "masked" };
      if (typeof acknowledge !== "function") throw new TypeError("Interrupt delivery requires an acknowledge callback.");
      const accesses: Cpu68000InterruptAccess[] = [];
      const memory = this.#recordMemory(access => { accesses.push(access); });
      const frame = this.#beginException(6);
      const stackFault = this.#stackFault(frame);
      if (stackFault) {
        const exception = this.#memoryError(stackFault, before.pc, false, memory);
        return { ...idle, after: this.snapshot(), accesses, outcome: "halted", exception };
      }
      this.#state.interruptMask = level;
      const value = acknowledge();
      if (value !== "autovector" && value !== "spurious") checkUnsigned("Interrupt vector", value, 255);
      const vector = value === "autovector" ? 24 + level : value === "spurious" ? 24 : value;
      accesses.push({ kind: "acknowledge", level, value });
      let fault: AlignmentFault | undefined;
      try {
        fault = this.#finishException(vector, before.pc, frame, memory);
      } catch (error) {
        if (!(error instanceof BusFault)) throw error;
        fault = error;
      }
      if (fault) {
        const returnPc = fault.operation === "fetch" || (fault instanceof BusFault && fault.vector !== undefined) ? vector * 4 : before.pc;
        const exception = this.#memoryError(fault, returnPc, false, memory);
        return { ...idle, after: this.snapshot(), accesses, exception,
          outcome: this.#state.faulted ? "halted" : "executed" };
      }
      this.#state.entry = { kind: "exception", vector };
      return { before, after: this.snapshot(), instruction: null, accesses, level, outcome: "accepted", vector, returnPc: before.pc };
    });
  }

  // Register views. A7 selects the active stack; packed status derives from stored fields.

  #addressRegister(code: number): AddressRegister {
    return Cpu68000.#addressRegisters[this.#readers.sources.selectAddressRegister(code)]!;
  }

  get #status(): number {
    return this.#readers.views.SR();
  }

  // Opcode selectors and construction. Register and mode fields use numeric encoding order.

  // Completion determines both the saved PC and whether tracing follows entry.
  static readonly #exceptions = {
    "illegal-instruction": { vector: 4, instructionCompleted: false },
    "divide-by-zero": { vector: 5, instructionCompleted: true },
    "bounds-check": { vector: 6, instructionCompleted: true },
    "overflow-trap": { vector: 7, instructionCompleted: true },
    "privilege-violation": { vector: 8, instructionCompleted: false },
    "line-a": { vector: 10, instructionCompleted: false },
    "line-f": { vector: 11, instructionCompleted: false },
    "trap": { vector: 32, instructionCompleted: true },
  } as const satisfies Record<Cpu68000Exception, { readonly vector: number; readonly instructionCompleted: boolean }>;

  static readonly #dataRegisters = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"] as const;
  static readonly #addressRegisters = ["a0", "a1", "a2", "a3", "a4", "a5", "a6", "usp", "ssp"] as const;
  static readonly #immediateBytes = Array.from({ length: 0x100 }, (_, value) => value);

  // Bind encodings once per model; handlers receive the executing CPU and capture no instance state.
  static readonly #opcodeHandlers = opcodeTable<OpcodeHandler>([
    // Chapter register families select storage before access; unknown selections are illegal.
    ...Object.entries(generated).map(([opcode, execute]): OpcodeEntry<OpcodeHandler> =>
      [Number(opcode), cpu => execute(cpu.#state) === "unsupported" ? "illegal-instruction" : undefined]),
    // 00 zz ddd mmm sss rrr: chapter legality, native extraction of the four EA fields.
    ...Object.entries(moves).map(([word, execute]): OpcodeEntry<OpcodeHandler> => {
      const opcode = Number(word), sourceMode = (opcode >>> 3) & 7, sourceCode = opcode & 7;
      const destinationMode = (opcode >>> 6) & 7, destinationCode = (opcode >>> 9) & 7;
      return [opcode, (cpu, instruction) => {
        const fault = execute(cpu.#state, sourceMode, sourceCode, destinationMode, destinationCode, cpu.#addressContext(instruction));
        return fault === "unsupported" ? "illegal-instruction" : fault;
      }];
    }),
    // Logical/unary families bind register roles; mmm/eee is the one variable EA.
    ...Object.entries(logic).map(([word, execute]): OpcodeEntry<OpcodeHandler> => {
      const opcode = Number(word), mode = (opcode >>> 3) & 7, code = opcode & 7;
      return [opcode, (cpu, instruction) => {
        const fault = execute(cpu.#state, mode, code, cpu.#addressContext(instruction));
        return fault === "unsupported" ? "illegal-instruction" : fault;
      }];
    }),
    // Arithmetic receives raw mmm/eee and rrr/qqq; the chapter assigns operand roles.
    ...Object.entries(arithmetic).map(([word, execute]): OpcodeEntry<OpcodeHandler> => {
      const opcode = Number(word), mode = (opcode >>> 3) & 7, code = opcode & 7, upperCode = (opcode >>> 9) & 7;
      return [opcode, (cpu, instruction) => {
        const fault = execute(cpu.#state, mode, code, upperCode, cpu.#addressContext(instruction));
        return fault === "unsupported" ? "illegal-instruction" : fault;
      }];
    }),
    ...[
      ...bitForms68000,
      ...wordArithmeticForms68000, ...decimalForms68000,
    ].map(({ opcode, body, sourceMode, sourceCode, destinationMode, destinationCode }): OpcodeEntry<OpcodeHandler> =>
      [opcode, (cpu, instruction) => operandBodies[body]!(cpu.#state, sourceMode, sourceCode, destinationMode, destinationCode, cpu.#addressContext(instruction))]),
    // Control definitions retain native condition, cursor, target, and stack stages.
    ...controlForms68000.map(({ opcode, body, mode, code, displacement }): OpcodeEntry<OpcodeHandler> =>
      [opcode, (cpu, instruction) => controlInstructions[body]!(cpu.#state, mode, code, displacement, cpu.#addressContext(instruction))]),
    ...transferForms68000.map(({ opcode, body, mode, code }): OpcodeEntry<OpcodeHandler> =>
      [opcode, (cpu, instruction) => transferInstructions[body]!(cpu.#state, mode, code, cpu.#addressContext(instruction))]),
    ...systemForms68000.map(({ opcode, body, mode, code }): OpcodeEntry<OpcodeHandler> =>
      [opcode, (cpu, instruction) => systemInstructions[body]!(cpu.#state, mode, code, cpu.#addressContext(instruction))]),
    // 0111 rrr 0 iiiiiiii: rrr selects Dn; i is the signed immediate byte, extended to a long.
    // Bit 8 must be zero. Immediate values select handlers but do not add coverage forms.
    ...opcodeFamily("0111 rrr 0 iiiiiiii", { r: this.#dataRegisters, i: this.#immediateBytes }, ({ r: register, i: value }) => (cpu: Cpu68000) => quick[register](cpu.#state, value)), // MOVEQ #n,Dn

  ], 16);

  // Exception entry. The original 68000 has no stacked frame-format word.

  #beginException(bytes: 6 | 14): ExceptionFrame {
    const stack = this.#state.ssp;
    const status = this.#status;
    this.#state.flags.s = true;
    this.#state.flags.t = false;
    this.#state.halted = this.#state.tracePending = false;
    this.#state.ssp = (stack - bytes) >>> 0;
    return { stack, status };
  }

  #stackFault({ stack }: ExceptionFrame): AlignmentFault | undefined {
    return stack % 2 ? { operation: "write", address: (stack - 2) >>> 0 } : undefined;
  }

  #loadVector(vector: number, readByte: ByteMemory["readByte"]): AlignmentFault | undefined {
    try {
      this.#state.pc = this.#readMemory(32, vector * 4, readByte);
    } catch (error) {
      if (error instanceof BusFault) error.vector = vector;
      throw error;
    }
    return this.#state.pc % 2 ? { operation: "fetch", address: this.#state.pc } : undefined;
  }

  #finishException(vector: number, returnPc: number, { stack, status }: ExceptionFrame, { readByte, writeByte }: ByteMemory): AlignmentFault | undefined {
    // PC low, SR, PC high; the final frame is SR at SSP and the full PC at SSP+2.
    this.#writeMemory(16, (stack - 2) >>> 0, returnPc & 0xffff, writeByte);
    this.#writeMemory(16, (stack - 6) >>> 0, status, writeByte);
    this.#writeMemory(16, (stack - 4) >>> 0, returnPc >>> 16, writeByte);
    // Stacking precedes vector reads: an overlapping frame changes the vector we actually load.
    return this.#loadVector(vector, readByte);
  }

  #enterException(exception: Cpu68000ShortExceptionDelivery, memory: ByteMemory): Cpu68000ExceptionDelivery {
    const frame = this.#beginException(6);
    // Group-2 traps count as instruction processing; trace/illegal/privilege/line faults do not.
    const processing = exception.source !== "trace" && Cpu68000.#exceptions[exception.source].instructionCompleted;
    let fault: AlignmentFault | undefined;
    try {
      fault = this.#stackFault(frame) ?? this.#finishException(exception.vector, exception.returnPc, frame, memory);
    } catch (error) {
      if (!(error instanceof BusFault)) throw error;
      fault = error;
    }
    if (!fault) {
      this.#state.entry = { kind: processing ? "trap" : "exception", vector: exception.vector };
      return exception;
    }
    const returnPc = fault.operation === "fetch" || (fault instanceof BusFault && fault.vector !== undefined)
      ? exception.vector * 4 : exception.returnPc;
    return this.#memoryError(fault, returnPc, processing, memory);
  }

  #initialFetchFault(fault: AlignmentFault, memory: ByteMemory): Pick<Cpu68000StepRecord, "exception" | "fault"> {
    const { kind, vector } = this.#state.entry;
    if (kind === "reset" || kind === "fault") {
      this.#state.faulted = true;
      return { fault: fault instanceof BusFault ? this.#busFaultRecord(fault) : fault };
    }
    return { exception: this.#memoryError(fault, kind === "none" ? this.#state.pc : vector * 4,
      kind === "none" || kind === "trap", memory) };
  }

  #memoryError(fault: AlignmentFault, returnPc: number, processingInstruction: boolean, memory: ByteMemory): Cpu68000MemoryErrorDelivery {
    // PC-relative data reads still use program space; I/N below describes a different distinction.
    const program = fault.operation === "fetch" || fault.programSpace;
    const functionCode = this.#state.flags.s ? (program ? 6 : 5) : (program ? 2 : 1);
    const exception: Cpu68000MemoryErrorDelivery = {
      ...(fault instanceof BusFault ? { source: "bus-error", vector: 2 } as const : { source: "address-error", vector: 3 } as const), returnPc,
      fault: { operation: fault.operation, address: fault.address, instructionRegister: this.#state.ir, functionCode, processingInstruction },
    };
    const frame = this.#beginException(14);
    this.#state.entry = { kind: "fault", vector: exception.vector };
    let entryFault: Cpu68000AlignmentFault | Cpu68000BusFault | undefined = this.#stackFault(frame);
    try {
      if (!entryFault) {
        // Seven words, pushed from the old SSP downwards. Reserved status bits are zero.
        // At new SSP: SSW, fault address (long), IR, SR, saved PC (long).
        const specialStatus = (fault.operation === "write" ? 0 : 0x10) | (processingInstruction ? 0 : 8) | functionCode;
        const words = [returnPc & 0xffff, returnPc >>> 16, frame.status, this.#state.ir,
          fault.address & 0xffff, fault.address >>> 16, specialStatus];
        for (const [index, word] of words.entries()) this.#writeMemory(16, (frame.stack - 2 * (index + 1)) >>> 0, word, memory.writeByte);
        entryFault = this.#loadVector(exception.vector, memory.readByte);
      }
    } catch (error) {
      if (!(error instanceof BusFault)) throw error;
      entryFault = this.#busFaultRecord(error);
    }
    if (!entryFault) return exception;
    // A bus or address error during either error's entry cannot stack another frame.
    this.#state.faulted = true;
    return { ...exception, entryFault };
  }

  #busFaultRecord({ operation, address }: BusFault): Cpu68000BusFault {
    return { source: "bus-error", operation, address };
  }

  // Effective addresses. Resolve each operand once, source before destination.

  #resolveAddress(size: OperandSize, mode: number, code: number, instruction: InstructionContext, updates: AddressUpdates): number {
    const { fetchWord, fetchLong, nextAddress } = instruction;
    const register = this.#addressRegister(code);
    const base = updates.get(register) ?? this.#state[register];
    let address: number;
    switch (mode) {
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
          default: throw new Error("Unsupported effective address reached execution.");
        }
        break;
      default: throw new Error("Invalid effective-address mode.");
    }
    return address >>> 0;
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

  #addressContext(instruction: InstructionContext): InstructionContext & Cpu68000AddressContext {
    const updates: AddressUpdates = new Map();
    return { ...instruction,
      resolveAddress: (size, mode, code) => this.#resolveAddress(size, mode, code, instruction, updates),
      commitAddressUpdates: () => { for (const [register, address] of updates) this.#state[register] = address; },
    };
  }

  // Memory access. Only bus addresses discard the high eight bits.

  #recordMemory(onAccess?: (access: MemoryAccess) => void): RecordedMemory & MemoryContext {
    // Only our private token crosses the recorder. Thrown host values, even "bus-error", escape unchanged.
    const failed = Symbol("failed memory transfer");
    const { accesses, readByte, writeByte } = recordMemory({
      read: address => {
        const value = this.#memory.read(address);
        if (value === "bus-error") throw failed;
        checkUnsigned("Memory byte", value, 255);
        return value;
      },
      write: (address, value) => {
        const result = this.#memory.write(address, value);
        if (result === "bus-error") throw failed;
        if (result !== undefined) throw new TypeError("A successful memory write must return nothing.");
      },
    }, onAccess);
    const read = (address: number, operation: "fetch" | "read", programSpace: boolean): number => {
      try {
        return readByte(address & 0xffffff);
      } catch (error) {
        if (error !== failed) throw error;
        throw new BusFault(operation, address >>> 0, programSpace);
      }
    };
    return {
      accesses,
      readByte: address => read(address, "read", false),
      readProgramByte: address => read(address, "read", true),
      fetchByte: address => read(address, "fetch", true),
      writeByte: (address, value) => {
        try {
          writeByte(address & 0xffffff, value);
        } catch (error) {
          if (error !== failed) throw error;
          throw new BusFault("write", address >>> 0, false);
        }
      },
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
