import type { FetchedInstruction } from "./execution-records.ts";
import type { ByteMemory } from "./memory-access.ts";

/** Fetches retain logical addresses; the bus adapter owns physical projection and failure detection. */
export interface WordMemory extends ByteMemory {
  readonly fetchByte: (address: number) => number;
  readonly readProgramByte: (address: number) => number;
}
export interface WordInstructionContext extends ByteMemory, WordControlContext, DeviceResetContext {
  readonly readProgramByte: (address: number) => number;
  readonly fetchWord: () => number;
}
/** Chapter-generated address decoding stages updates locally; instruction definitions choose when to commit. */
export interface WordAddressContext {
  readonly resolveAddress: (size: 8 | 16 | 32, mode: number, code: number) => number;
  readonly commitAddressUpdates: () => void;
  readonly readProgramByte: (address: number) => number;
}

export interface WordMemoryFault {
  readonly operation: "fetch" | "read" | "write";
  readonly address: number;
  readonly programSpace?: boolean;
}
export interface WordException<Source extends string> {
  readonly source: Source;
  readonly vector: number;
  readonly returnPc: number;
}
export interface WordExceptionPolicy {
  readonly vector: number;
  readonly offset?: { readonly shift: number; readonly mask: number };
  readonly completed: boolean;
}
export interface WordDelivery<Source extends string, Exception, Fault> {
  readonly exception: (request: WordException<Source>, memory: WordMemory) => { readonly exception: Exception; readonly delivered: boolean };
  readonly initialFetch: (fault: WordMemoryFault, memory: WordMemory) => { readonly exception?: Exception; readonly fault?: Fault };
  readonly memoryError: (fault: WordMemoryFault, cursor: number, memory: WordMemory) => Exception;
  /** Return only the adapter's private modeled failure; arbitrary host throws must escape. */
  readonly faultFromError: (error: unknown) => WordMemoryFault | undefined;
}
export interface WordExecutionPolicy<Source extends string> {
  readonly bits: number;
  readonly order: "big" | "little";
  readonly alignment: 1 | 2;
  readonly counter: () => number;
  readonly terminal: () => boolean;
  readonly stopped: () => boolean;
  readonly pending: () => boolean;
  readonly sample: () => boolean;
  readonly pendingException: Source;
  readonly fetched: (opcode: number) => void;
  readonly retire: (address: number, sample: number) => void;
  readonly trace: (sample: number) => void;
  readonly unsupported: Source;
  readonly exceptions: Readonly<Record<Source, WordExceptionPolicy>>;
  readonly dispatch: (opcode: number, context: WordInstructionContext) => Source | "unsupported" | WordMemoryFault | void;
}
export interface WordStep<Exception, Fault> {
  readonly instruction: FetchedInstruction | null;
  readonly outcome: "executed" | "halted";
  readonly exception?: Exception;
  readonly fault?: Fault;
}

/** Execute an atomic-word fetch stream, keeping sequential cursor and selected target separate. */
export function wordExecution<Source extends string, Exception, Fault>(policy: WordExecutionPolicy<Source>,
  delivery: WordDelivery<Source, Exception, Fault>) {
  return (memory: WordMemory, resetDevices: () => void): WordStep<Exception, Fault> => {
    const address = policy.counter(), sample = policy.sample();
    const outcome = (): "halted" | "executed" => policy.terminal() ? "halted" : "executed";
    const request = (source: Source, opcode: number, cursor: number): WordException<Source> => {
      const { vector, offset, completed } = policy.exceptions[source];
      return { source, vector: vector + (offset ? (opcode >>> offset.shift) & offset.mask : 0),
        returnPc: completed ? cursor : address };
    };
    if (policy.terminal()) return { instruction: null, outcome: "halted" };
    if (policy.pending()) {
      const { exception } = delivery.exception(request(policy.pendingException, 0, address), memory);
      return { instruction: null, exception, outcome: outcome() };
    }
    if (policy.stopped()) return { instruction: null, outcome: "halted" };
    if (address % policy.alignment !== 0) {
      return { instruction: null, ...delivery.initialFetch({ operation: "fetch", address }, memory), outcome: outcome() };
    }
    const bytes: number[] = [];
    let cursor = address, target: number | undefined, instruction: FetchedInstruction | null = null;
    const fetchWord = (): number => {
      const first = memory.fetchByte(cursor), second = memory.fetchByte(cursor + 1);
      // A failed second transfer records its successful predecessor, but commits no partial word.
      cursor = (cursor + 2) % 2 ** policy.bits;
      bytes.push(first, second);
      return policy.order === "big" ? (first << 8) | second : (second << 8) | first;
    };
    try {
      const opcode = fetchWord();
      instruction = { address, bytes };
      policy.fetched(opcode);
      const result = policy.dispatch(opcode, { ...memory, fetchWord, nextAddress: () => cursor,
        jump: address => { target = address; }, resetDevices });
      if (typeof result === "string") {
        const source = result === "unsupported" ? policy.unsupported : result;
        const { exception, delivered } = delivery.exception(request(source, opcode, cursor), memory);
        if (delivered) policy.trace(sample && policy.exceptions[source].completed ? 1 : 0);
        return { instruction, exception, outcome: outcome() };
      }
      if (result) return { instruction, exception: delivery.memoryError(result, cursor, memory), outcome: outcome() };
      policy.retire(target ?? cursor, sample ? 1 : 0);
      return { instruction, outcome: policy.stopped() && !policy.pending() ? "halted" : "executed" };
    } catch (error) {
      const fault = delivery.faultFromError(error);
      if (!fault) throw error;
      const result = instruction ? { exception: delivery.memoryError(fault, cursor, memory) } : delivery.initialFetch(fault, memory);
      return { instruction, ...result, outcome: outcome() };
    }
  };
}


/** A rejected operand access; the CPU boundary owns exception delivery. */
export interface OperandAlignmentFault {
  readonly operation: "read" | "write";
  readonly address: number;
  readonly programSpace?: boolean;
}

/** Control flow selects a target independently of the sequential instruction-fetch cursor. */
export interface WordControlContext {
  readonly nextAddress: () => number;
  readonly jump: (address: number) => void;
}

/** A taken odd target is rejected before selection; no instruction byte is fetched there. */
export interface TargetAlignmentFault {
  readonly operation: "fetch";
  readonly address: number;
}

/** RESET asserts the connected device reset signal; it does not reset CPU state. */
export interface DeviceResetContext {
  readonly resetDevices: () => void;
}
