import { createExecution, exceptions } from "./generated/68000-execution.ts";
import type { WordMemory } from "./word-execution.ts";
import { reset } from "./generated/68000-reset.ts";
import { sourceReaders } from "./generated/68000-state.ts";
import type { MemoryConnection } from "../memory/connection.ts";
import type { FetchedInstruction, StateTransition } from "./execution-records.ts";
import { checkUnsigned } from "../validation.ts";
import { executionBoundary } from "./execution-boundary.ts";
import { recordMemory } from "./memory-access.ts";
import type { ByteMemory, MemoryAccess, RecordedMemory } from "./memory-access.ts";
import { copyState, readState } from "./state.ts";
import type { ReadonlyState } from "./state.ts";
import { cpu68000StateDescription } from "./state/68000.ts";
import type { Cpu68000State } from "./state/68000.ts";
export { cpu68000StateDescription } from "./state/68000.ts";
export type { Cpu68000State, Cpu68000Flags } from "./state/68000.ts";
import type { Cpu68000ResetContext } from "./68000-context.ts";

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

type OperandSize = 8 | 16 | 32;
interface ExceptionFrame { readonly stack: number; readonly status: number }

/** Instruction-level Motorola 68000 with 32-bit registers and a 24-bit memory connection. */
export class Cpu68000 {
  readonly #memory: MemoryConnection;
  readonly #state: Cpu68000State;
  readonly #readers: ReturnType<typeof sourceReaders>;
  readonly #connections: Cpu68000Connections | undefined;
  readonly #execute: ReturnType<typeof createExecution<Cpu68000ExceptionDelivery, Cpu68000AlignmentFault | Cpu68000BusFault>>;
  readonly #atBoundary = executionBoundary("68000 step, reset, and interrupt calls must not be reentrant.");

  constructor(memory: MemoryConnection, initialState: Cpu68000State, connections?: Cpu68000Connections) {
    if (memory.size !== 0x1000000) throw new RangeError("The 68000 model requires a 16 MiB memory address space.");
    this.#memory = memory;
    this.#state = readState(cpu68000StateDescription, initialState);
    this.#readers = sourceReaders(this.#state);
    this.#connections = connections;
    this.#execute = createExecution(this.#state, {
      exception: (request, memory) => {
        const exception = this.#enterException(request, memory);
        return { exception, delivered: !("fault" in exception) };
      },
      initialFetch: (fault, memory) => this.#initialFetchFault(fault, memory),
      memoryError: (fault, cursor, memory) => this.#memoryError(fault, cursor, true, memory),
      faultFromError: error => error instanceof BusFault ? error : undefined,
    });
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
      const memory = this.#recordMemory();
      const fault = reset(this.#state, memory, error => error instanceof BusFault ? this.#busFaultRecord(error) : undefined);
      const { accesses } = memory;
      return { before, after: this.snapshot(), accesses, ...(fault ? { fault } : {}) };
    });
  }

  /** Deliver an owed trace, or attempt one instruction with its synchronous exception. */
  step(): Cpu68000StepRecord {
    return this.#atBoundary((): Cpu68000StepRecord => {
      const before = this.snapshot();
      const accesses: Cpu68000Access[] = [];
      const memory = this.#recordMemory(access => { accesses.push(access); });
      const result = this.#execute(memory, () => {
        if (!this.#connections) throw new Error("RESET requires a connected device reset callback.");
        this.#connections.resetDevices();
        accesses.push({ kind: "reset" });
      });
      return { before, after: this.snapshot(), accesses, ...result };
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

  get #status(): number {
    return this.#readers.views.SR();
  }

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
    const processing = exceptions[exception.source].completed;
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

  // Memory access. Only bus addresses discard the high eight bits.

  #recordMemory(onAccess?: (access: MemoryAccess) => void): RecordedMemory & WordMemory {
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
