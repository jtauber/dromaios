import type { StateFields } from "../../state.ts";
import type { ChapterInterface } from "./interface.ts";
import { comment, snapshotInterface, stateAliases } from "./interface-shapes.ts";
import type { ChapterReset } from "./reset.ts";
import type { WordExecution } from "./word-execution.ts";

/** Bind public records and bus geometry from a complete word model, without CPU-name decisions. */
export function generateWordInterface(module: string, state: StateFields, api: ChapterInterface, policy: WordExecution, reset?: ChapterReset): string {
  if (!reset) throw new Error("A word public interface requires a reset contract.");
  const events = policy.events;
  if (!events) throw new Error("A word public interface requires chapter-owned events.");
  const name = api.name, q = JSON.stringify, schema = name[0]!.toLowerCase() + name.slice(1) + "StateDescription";
  const snapshot = snapshotInterface(api), size = 2 ** policy.memoryBits;
  const amount = size >= 1048576 ? `${size / 1048576} MiB` : size >= 1024 ? `${size / 1024} KiB` : `${size} byte`;
  return `// Generated from the chapter's public interface. Do not edit.
import { createEvents } from "./${module}-events.ts";
import { createExecution } from "./${module}-execution.ts";
import { reset } from "./${module}-reset.ts";
import { sourceReaders } from "./${module}-state.ts";
import { wordMemory, busFaultFromError, busFaultRecord } from "../word-memory.ts";
import { wordRuntime } from "../word-runtime.ts";
import type { WordAccess, WordInterruptAccess, WordInterruptVector } from "../word-runtime.ts";
import type { DeviceResetContext } from "../word-execution.ts";
import type { MemoryConnection } from "../../memory/connection.ts";
import type { FetchedInstruction, StateTransition } from "../execution-records.ts";
import type { MemoryAccess } from "../memory-access.ts";
import { copyState, readState } from "../state.ts";
import type { ReadonlyState } from "../state.ts";
import { ${schema} } from "../semantics/generated/state/${module}.ts";
import type { ${name}State, ${name}StoredState } from "../semantics/generated/state/${module}.ts";
export { ${schema} } from "../semantics/generated/state/${module}.ts";
export type { ${[name + "State", name + "StoredState", ...[...stateAliases(state), ...(api.banks ?? [])].map(alias => name + alias.name)].join(", ")} } from "../semantics/generated/state/${module}.ts";

${snapshot.types}
export type ${name}Snapshot = ReadonlyState<${name}State> & {
${snapshot.fields}
};
export type ${name}MemoryAccess = MemoryAccess;
export type ${name}Access = WordAccess;
export type ${name}Connections = DeviceResetContext;
export type ${name}InterruptLevel = ${Array.from({length: events.maximum - events.minimum + 1}, (_, index) => index + events.minimum).join(" | ")};
export type ${name}InterruptVector = WordInterruptVector;
export type ${name}InterruptAccess = WordInterruptAccess<${name}InterruptLevel>;
export type ${name}InterruptRecord = StateTransition<${name}Snapshot, ${name}InterruptAccess> & {
  readonly instruction: null;
  readonly level: ${name}InterruptLevel;
} & (
  | { readonly outcome: "accepted"; readonly vector: number; readonly returnPc: number }
  | { readonly outcome: "ignored"; readonly reason: ${events.reasons.map(value => q(value)).join(" | ")} }
  | { readonly outcome: "executed" | "halted"; readonly exception: ${name}MemoryErrorDelivery }
);

/** Instruction address is the full 32-bit PC; accesses contain physical addresses. */
export type ${name}Instruction = FetchedInstruction;

export interface ${name}MemoryFault {
  readonly operation: "fetch" | "read" | "write";
  /** Full logical address of the failed transfer. */
  readonly address: number;
}

export type ${name}AlignmentFault = ${name}MemoryFault;

export interface ${name}BusFault extends ${name}MemoryFault {
  readonly source: "bus-error";
}

/** Synchronous sources using the declared ${events.shortBytes}-byte supervisor frame. */
export type ${name}Exception = ${Object.keys(policy.exceptions).filter(source => source !== policy.pendingException).map(value => q(value)).join(" | ") || "never"};

export interface ${name}ShortExceptionDelivery {
  readonly source: ${name}Exception | ${q(policy.pendingException)};
  readonly vector: number;
  readonly returnPc: number;
}

interface MemoryErrorFrame {
  /** Fetch cursor, or the interrupted exception's vector address; no hardware prefetch advancement. */
  readonly returnPc: number;
  readonly fault: ${name}AlignmentFault & {
    readonly instructionRegister: number;
    readonly functionCode: ${events.codes.join(" | ")};
    readonly processingInstruction: boolean;
  };
  /** A second bus or address error during entry leaves the CPU terminally halted. */
  readonly entryFault?: ${name}AlignmentFault | ${name}BusFault;
}

export interface ${name}AddressErrorDelivery extends MemoryErrorFrame {
  readonly source: "address-error";
  readonly vector: ${events.addressVector};
}
export interface ${name}BusErrorDelivery extends MemoryErrorFrame {
  readonly source: "bus-error";
  readonly vector: ${events.busVector};
}
export type ${name}MemoryErrorDelivery = ${name}AddressErrorDelivery | ${name}BusErrorDelivery;
export type ${name}ExceptionDelivery = ${name}ShortExceptionDelivery | ${name}MemoryErrorDelivery;

export type ${name}StepRecord = StateTransition<${name}Snapshot, ${name}Access> & {
  readonly instruction: ${name}Instruction | null;
  readonly outcome: "executed" | "halted";
  readonly exception?: ${name}ExceptionDelivery;
  /** A failed first fetch after reset or memory-error entry halts without another frame. */
  readonly fault?: ${name}AlignmentFault | ${name}BusFault;
};

export type ${name}ResetRecord = StateTransition<${name}Snapshot> & {
  readonly fault?: ${name}AlignmentFault | ${name}BusFault;
};


function execution(state: ${name}StoredState, memory: MemoryConnection, snapshot: () => ${name}Snapshot, connections?: ${name}Connections) {
  const events = createEvents(state, busFaultFromError);
  const step = createExecution<${name}ExceptionDelivery, ${name}AlignmentFault | ${name}BusFault>(state, {
    ...events, memoryError: (fault, cursor, memory) => events.memoryError(fault, cursor, true, memory),
  });
  return wordRuntime<${name}Snapshot, ${name}ExceptionDelivery, ${name}AlignmentFault | ${name}BusFault, ${name}InterruptLevel, ReturnType<typeof events.interrupt>>(${q(module)}, snapshot, wordMemory(memory, ${policy.memoryBits}, ${policy.bits}), {
    reset: memory => reset(state, ${reset.memory ? "memory, " : ""}busFaultRecord), step, interrupt: events.interrupt,
  }, connections);
}

${comment(api.description)}
export class ${name} {
  readonly #state: ${name}StoredState;
  readonly #execution: ReturnType<typeof execution>;
  constructor(memory: MemoryConnection, initialState: ${name}State, connections?: ${name}Connections) {
    if (memory.size !== ${size}) throw new RangeError(${q(`The ${module} model requires a ${amount} memory address space.`)});
    this.#state = readState(${schema}, initialState);
    this.#execution = execution(this.#state, memory, () => this.snapshot(), connections);
  }
  snapshot(): ${name}Snapshot {
    const state = copyState(${schema}, this.#state), views = sourceReaders(state).views;
    return { ...state${snapshot.values.length ? ", " + snapshot.values.join(", ") : ""} };
  }
  reset(): ${name}ResetRecord { return this.#execution.reset(); }
  step(): ${name}StepRecord { return this.#execution.step(); }
  interrupt(level: ${name}InterruptLevel, acknowledge: () => ${name}InterruptVector): ${name}InterruptRecord {
    return this.#execution.interrupt(level, acknowledge);
  }
}
`;
}
