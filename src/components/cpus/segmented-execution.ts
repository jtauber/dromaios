import type { Ram } from "../memory/ram.ts";
import { executionBoundary } from "./execution-boundary.ts";
import type { HaltedStep, InstructionStep, StateTransition, WaitingStep } from "./execution-records.ts";
import type { InterruptDeferralContext, InterruptReportContext, ByteInstructionContext } from "./instruction-context.ts";
import { recordMemory } from "./memory-access.ts";
import type { ByteMemory, MemoryAccess } from "./memory-access.ts";
import { recordPorts } from "./port-access.ts";
import type { BytePorts, PortAccess } from "./port-access.ts";

type BoundaryContext = ByteInstructionContext & BytePorts & InterruptDeferralContext & InterruptReportContext;
interface Delivery { readonly source: string; readonly vector: number }
export interface PrefixInputs {
  readonly overridden: number;
  readonly segmentOverride: number;
  readonly repeatMode: number;
  readonly startIP: number;
}
export type SegmentPrefix = { readonly kind: "segment"; readonly read: () => number }
  | { readonly kind: "repeat"; readonly value: number } | { readonly kind: "ignore" };

export type SegmentedStep<S, A, F extends string, P extends Delivery> = (
  (InstructionStep<S, A> | HaltedStep<S, A> | WaitingStep<S, A>) & {
    readonly interrupt?: { readonly source: P["source"] | "software" | F; readonly vector: number };
  }
) | (StateTransition<S> & { readonly instruction: null; readonly outcome: "executed"; readonly interrupt: P })
  | (StateTransition<S, A> & { readonly instruction: null; readonly outcome: "executed"; readonly continuation: "wait"; readonly interrupt?: never });

/** Chapter-selected state operations; the runtime owns access recording and attempt-local captures. */
export interface SegmentedExecutionPolicy<Device, Fault extends string, Pending extends Delivery> {
  readonly memoryBits: number;
  readonly segment: () => number;
  readonly baseShift: number;
  readonly counter: { pc: number };
  readonly recordAddress: () => number;
  readonly fetched: () => void;
  readonly prefixLimit: number;
  readonly prefixes: Readonly<Partial<Record<number, SegmentPrefix>>>;
  readonly handlers: Readonly<Partial<Record<number, {
    readonly repeated: boolean;
    readonly execute: (inputs: PrefixInputs, context: BoundaryContext & Device) => "opcode" | "unsupported" | Fault | void;
  }>>>;
  readonly stopped: () => boolean;
  readonly waiting: () => boolean;
  readonly resume: (context: BoundaryContext & Device) => void;
  readonly reset: () => void;
  readonly sample: () => readonly boolean[];
  readonly retire: (intr: boolean, all: boolean, samples: readonly boolean[]) => void;
  readonly pending: {
    readonly delivery: Pending;
    readonly owed: () => boolean;
    readonly inhibited: () => boolean;
    readonly enter: (memory: ByteMemory) => void;
  };
  readonly faults: Readonly<Record<Fault, { readonly vector: number; readonly enter: (memory: ByteMemory) => void }>>;
}

/** Read-committed segmented fetching, replaceable prefixes, and one resumable body per boundary. */
export function segmentedExecution<S, Device, External, Fault extends string, Pending extends Delivery>(
  cpu: string, ram: Ram, ports: () => BytePorts | undefined, snapshot: () => S,
  devices: (record: (access: External) => void) => Device, policy: SegmentedExecutionPolicy<Device, Fault, Pending>,
) {
  type Access = MemoryAccess | PortAccess | External;
  const atBoundary = executionBoundary(`${cpu} step, reset, and interrupt calls must not be reentrant.`);
  const addressMask = 2 ** policy.memoryBits - 1;
  return {
    atBoundary,
    reset: (): StateTransition<S> => atBoundary(() => {
      const before = snapshot(); policy.reset();
      return { before, after: snapshot(), accesses: [] };
    }),
    step: (): SegmentedStep<S, Access, Fault, Pending> => atBoundary(() => {
      const before = snapshot(), pending = policy.pending;
      if (pending.owed() && !pending.inhibited()) {
        const memory = recordMemory(ram); pending.enter(memory);
        return { before, after: snapshot(), instruction: null, accesses: memory.accesses,
          outcome: "executed", interrupt: { ...pending.delivery } };
      }
      if (policy.stopped()) return { before, after: snapshot(), instruction: null, accesses: [], outcome: "halted" };
      const startIP = policy.counter.pc, address = policy.recordAddress(), resuming = policy.waiting(), samples = policy.sample();
      const accesses: Access[] = [], bytes: number[] = [];
      const record = (access: Access): void => { accesses.push(access); };
      const memory = recordMemory(ram, record);
      const fetchByte = (): number => {
        const byte = memory.readByte(((policy.segment() * 2 ** policy.baseShift) + policy.counter.pc) & addressMask);
        policy.fetched(); bytes.push(byte); return byte;
      };
      let intr = false, all = false;
      let interrupt: { readonly source: "software" | Fault; readonly vector: number } | undefined;
      const context = {
        readByte: memory.readByte, writeByte: memory.writeByte,
        ...recordPorts(ports(), record), ...devices(record),
        fetchByte,
        deferInterrupt: (scope: "intr" | "all"): void => { if (scope === "all") all = true; else intr = true; },
        reportInterrupt: (vector: number): void => { interrupt = { source: "software", vector }; },
      };
      let reason: "opcode" | "unsupported" | Fault | void = undefined;
      if (resuming) policy.resume(context);
      else {
        let overridden = 0, segmentOverride = 0, repeatMode = 0;
        reason = "unsupported";
        while (bytes.length < policy.prefixLimit) {
          const opcode = fetchByte(), prefix = policy.prefixes[opcode];
          if (prefix) {
            if (prefix.kind === "segment") { overridden = 1; segmentOverride = prefix.read(); }
            if (prefix.kind === "repeat") repeatMode = prefix.value;
            continue;
          }
          const handler = policy.handlers[opcode];
          if (handler && (repeatMode === 0 || handler.repeated)) {
            reason = handler.execute({ overridden, segmentOverride, repeatMode, startIP }, context);
          }
          break;
        }
      }
      const rejected = reason === "opcode" || reason === "unsupported";
      if (reason !== undefined && reason !== "unsupported" && reason !== "opcode") {
        const fault = policy.faults[reason]; fault.enter(memory);
        interrupt = { source: reason, vector: fault.vector };
      }
      if (rejected) policy.counter.pc = startIP;
      else policy.retire(intr, all, samples);
      const transition = { before, after: snapshot(), accesses };
      const waiting = policy.waiting() && !pending.owed();
      if (resuming) return waiting
        ? { ...transition, instruction: null, outcome: "waiting" }
        : { ...transition, instruction: null, outcome: "executed", continuation: "wait" };
      const recordWithInstruction = { ...transition, instruction: { address, bytes } };
      if (rejected) return { ...recordWithInstruction, outcome: "unsupported", reason: "opcode" };
      if (interrupt) return { ...recordWithInstruction, outcome: "executed", interrupt };
      if (waiting) return { ...recordWithInstruction, outcome: "waiting" };
      return { ...recordWithInstruction, outcome: policy.stopped() && !pending.owed() ? "halted" : "executed" };
    }),
  };
}
