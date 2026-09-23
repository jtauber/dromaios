import { checkUnsigned } from "../validation.ts";
import type { WordException, WordExceptionPolicy, WordMemoryFault, WordMemory } from "./word-execution.ts";

/** A classified connection failure; arbitrary exceptions from the host never enter this path. */
export interface WordBusFault extends WordMemoryFault { readonly source: "bus-error" }
export type WordFault = WordMemoryFault | WordBusFault;
export type WordFaultRecord = Pick<WordMemoryFault, "operation" | "address"> & { readonly source?: "bus-error" };
export type WordMemoryError<A extends number, B extends number, C extends number> = (
  | { readonly source: "address-error"; readonly vector: A }
  | { readonly source: "bus-error"; readonly vector: B }
) & {
  readonly returnPc: number;
  readonly fault: Pick<WordMemoryFault, "operation" | "address"> & {
    readonly instructionRegister: number; readonly functionCode: C; readonly processingInstruction: boolean;
  };
  readonly entryFault?: WordFaultRecord;
};

interface Frame { readonly stack: number; readonly status: number }
export interface WordEventPolicy<S extends string, R extends string, A extends number, B extends number, C extends number> {
  readonly exceptions: Readonly<Record<S, WordExceptionPolicy>>;
  readonly capture: () => Frame;
  readonly instruction: () => number;
  readonly prepare: (stack: number, bytes: number) => void;
  readonly checkStack: (stack: number) => WordMemoryFault | void;
  readonly shortBytes: number;
  readonly shortFrame: (stack: number, status: number, returnPc: number, memory: WordMemory) => void;
  readonly vector: (vector: number, memory: WordMemory) => WordMemoryFault | void;
  readonly complete: (processing: boolean, vector: number) => void;
  readonly entryReturn: (returnPc: number, vector: number, vectorPhase: boolean) => number;
  readonly memory: {
    readonly addressVector: A; readonly busVector: B; readonly bytes: number;
    readonly codes: readonly C[];
    readonly functionCode: (program: boolean) => number;
    readonly begin: (vector: number) => void;
    readonly frame: (stack: number, status: number, returnPc: number, address: number, write: boolean, processing: boolean, code: number, memory: WordMemory) => void;
  };
  readonly terminal: () => boolean;
  readonly halt: () => void;
  readonly initial: { readonly terminal: () => boolean; readonly returnPc: () => number; readonly processing: () => boolean };
  readonly interrupt: {
    readonly minimum: number; readonly maximum: number;
    /** Zero admits an offer; positive selectors index the declared reasons. */
    readonly gate: (level: number) => number; readonly reasons: readonly R[];
    readonly accept: (level: number) => void;
    readonly autovector: (level: number) => number; readonly spurious: number; readonly vectorMaximum: number;
    readonly returnPc: () => number; readonly processing: boolean;
  };
}

/** Execute bounded entry phases. Frame bytes, gates, vectors, and recovery choices belong to the policy. */
export function wordEvents<S extends string, R extends string, A extends number, B extends number, C extends number>(
  policy: WordEventPolicy<S, R, A, B, C>, faultFromError: (error: unknown) => WordBusFault | undefined,
) {
  type MemoryError = WordMemoryError<A, B, C>;
  const publicFault = (fault: WordFault): WordFaultRecord => "source" in fault
    ? { source: fault.source, operation: fault.operation, address: fault.address } : fault;
  const attempt = (run: () => WordMemoryFault | void): WordFault | undefined => {
    try { return run() || undefined; }
    catch (error) { const fault = faultFromError(error); if (!fault) throw error; return fault; }
  };
  const prepare = (bytes: number): Frame => {
    const frame = policy.capture(); policy.prepare(frame.stack, bytes); return frame;
  };
  const memoryError = (fault: WordFault, returnPc: number, processing: boolean, memory: WordMemory): MemoryError => {
    const code = policy.memory.functionCode(fault.operation === "fetch" || (fault.programSpace ?? false));
    const functionCode = policy.memory.codes.find(candidate => candidate === code);
    if (functionCode === undefined) throw new Error("Fault function code is outside the declared choices.");
    const exception: MemoryError = {
      ...("source" in fault ? { source: "bus-error", vector: policy.memory.busVector } as const
        : { source: "address-error", vector: policy.memory.addressVector } as const), returnPc,
      fault: { operation: fault.operation, address: fault.address, instructionRegister: policy.instruction(), functionCode, processingInstruction: processing },
    };
    const frame = prepare(policy.memory.bytes);
    policy.memory.begin(exception.vector);
    const entryFault = attempt(() => {
      const alignment = policy.checkStack(frame.stack); if (alignment) return alignment;
      policy.memory.frame(frame.stack, frame.status, returnPc, fault.address, fault.operation === "write", processing, functionCode, memory);
      return policy.vector(exception.vector, memory);
    });
    if (!entryFault) return exception;
    policy.halt(); return { ...exception, entryFault: publicFault(entryFault) };
  };
  const finish = (frame: Frame, vector: number, returnPc: number, processing: boolean, memory: WordMemory, stackChecked = false): MemoryError | undefined => {
    let vectorPhase = false;
    const fault = attempt(() => {
      const alignment = stackChecked ? undefined : policy.checkStack(frame.stack); if (alignment) return alignment;
      policy.shortFrame(frame.stack, frame.status, returnPc, memory);
      vectorPhase = true;
      return policy.vector(vector, memory);
    });
    if (fault) return memoryError(fault, policy.entryReturn(returnPc, vector, vectorPhase), processing, memory);
    policy.complete(processing, vector);
    return undefined;
  };
  const exception = (request: WordException<S>, memory: WordMemory) => {
    const failed = finish(prepare(policy.shortBytes), request.vector, request.returnPc, policy.exceptions[request.source].completed, memory);
    return { exception: failed ?? request, delivered: failed === undefined };
  };
  const initialFetch = (fault: WordFault, memory: WordMemory) => {
    if (policy.initial.terminal()) { policy.halt(); return { fault: publicFault(fault) }; }
    return { exception: memoryError(fault, policy.initial.returnPc(), policy.initial.processing(), memory) };
  };
  const interrupt = (level: number, acknowledge: () => number | "autovector" | "spurious", memory: WordMemory,
    onAcknowledge: (value: number | "autovector" | "spurious") => void) => {
    const offer = policy.interrupt;
    checkUnsigned("Interrupt level", level, offer.maximum);
    if (level < offer.minimum) throw new RangeError(`Interrupt level must be in ${offer.minimum}..${offer.maximum}.`);
    const gate = offer.gate(level);
    if (gate) {
      const reason = offer.reasons[gate - 1];
      if (reason === undefined) throw new Error("Interrupt gate is outside the declared reasons.");
      return { outcome: "ignored", reason } as const;
    }
    if (typeof acknowledge !== "function") throw new TypeError("Interrupt delivery requires an acknowledge callback.");
    const returnPc = offer.returnPc(), frame = prepare(policy.shortBytes);
    const stackFault = policy.checkStack(frame.stack);
    if (stackFault) {
      const exception = memoryError(stackFault, returnPc, offer.processing, memory);
      return { outcome: policy.terminal() ? "halted" : "executed", exception } as const;
    }
    offer.accept(level);
    const value = acknowledge();
    if (value !== "autovector" && value !== "spurious") checkUnsigned("Interrupt vector", value, offer.vectorMaximum);
    const vector = value === "autovector" ? offer.autovector(level) : value === "spurious" ? offer.spurious : value;
    onAcknowledge(value);
    const exception = finish(frame, vector, returnPc, offer.processing, memory, true);
    return exception ? { outcome: policy.terminal() ? "halted" : "executed", exception } as const
      : { outcome: "accepted", vector, returnPc } as const;
  };
  return { exception, initialFetch, memoryError, faultFromError, interrupt };
}
