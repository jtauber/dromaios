import { createEvents } from "./generated/68000-events.ts";
import { createExecution } from "./generated/68000-execution.ts";
import type { WordMemory } from "./word-execution.ts";
import { reset } from "./generated/68000-reset.ts";
import { sourceReaders } from "./generated/68000-state.ts";
import type { MemoryConnection } from "../memory/connection.ts";
import type { FetchedInstruction, StateTransition } from "./execution-records.ts";
import { checkUnsigned } from "../validation.ts";
import { executionBoundary } from "./execution-boundary.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess, RecordedMemory } from "./memory-access.ts";
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

/** Instruction-level Motorola 68000 with 32-bit registers and a 24-bit memory connection. */
export class Cpu68000 {
  readonly #memory: MemoryConnection;
  readonly #state: Cpu68000State;
  readonly #events: ReturnType<typeof createEvents>;
  readonly #connections: Cpu68000Connections | undefined;
  readonly #execute: ReturnType<typeof createExecution<Cpu68000ExceptionDelivery, Cpu68000AlignmentFault | Cpu68000BusFault>>;
  readonly #atBoundary = executionBoundary("68000 step, reset, and interrupt calls must not be reentrant.");

  constructor(memory: MemoryConnection, initialState: Cpu68000State, connections?: Cpu68000Connections) {
    if (memory.size !== 0x1000000) throw new RangeError("The 68000 model requires a 16 MiB memory address space.");
    this.#memory = memory;
    this.#state = readState(cpu68000StateDescription, initialState);
    this.#connections = connections;
    this.#events = createEvents(this.#state, error => error instanceof BusFault
      ? { ...this.#busFaultRecord(error), programSpace: error.programSpace } : undefined);
    this.#execute = createExecution(this.#state, {
      ...this.#events,
      memoryError: (fault, cursor, memory) => this.#events.memoryError(fault, cursor, true, memory),
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
      const before = this.snapshot();
      const accesses: Cpu68000InterruptAccess[] = [];
      const memory = this.#recordMemory(access => { accesses.push(access); });
      const result = this.#events.interrupt(level, acknowledge, memory,
        value => { accesses.push({ kind: "acknowledge", level, value }); });
      return { before, after: this.snapshot(), instruction: null, accesses, level, ...result };
    });
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

}
