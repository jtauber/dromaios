import type { Ram } from "../memory/ram.js";
import { readWordBE, readWordLE } from "./binary.ts";
import { executionBoundary } from "./execution-boundary.ts";
import type { ByteStep } from "./byte-execution.ts";
import type { StateTransition } from "./execution-records.ts";
import type { InterruptDeferralContext, RetiNotificationContext, WordInstructionContext } from "./instruction-context.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import { recordPorts } from "./port-access.ts";
import type { BytePorts, PortAccess } from "./port-access.ts";

type InstructionContext = WordInstructionContext & BytePorts & InterruptDeferralContext<"irq"> & RetiNotificationContext;
type OpcodeHandler = (context: InstructionContext) => void;

/** A decoder reads the entire encoding before the runtime commits its counter and fetch effects. */
export interface DecodedExecutionPolicy {
  readonly memoryBits: number;
  readonly counter: { pc: number };
  readonly stopped: () => boolean;
  readonly reset: () => void;
  readonly retire: (deferred: boolean) => void;
  readonly opcodeFetched: (count: number) => void;
  readonly notifyReti?: () => void;
  readonly word: "little" | "big";
  readonly decode: (opcode: number, nextByte: (opcodeFetch?: boolean) => number) => {
    readonly handler: OpcodeHandler | undefined;
    readonly opcodeFetches: number;
  };
}

/** Full-encoding validation, live-counter operand reads, and retirement only after a completed body. */
export function decodedExecution<Snapshot>(cpu: string, ram: Ram, ports: BytePorts | undefined,
  snapshot: () => Snapshot, policy: DecodedExecutionPolicy) {
  const atBoundary = executionBoundary(`${cpu} step, reset, and interrupt calls must not be reentrant.`);
  const addressMask = 2 ** policy.memoryBits - 1;
  const readWord = policy.word === "little" ? readWordLE : readWordBE;
  const execute = (handler: OpcodeHandler, context: WordInstructionContext & BytePorts): void => {
    let deferred = false, reti = false;
    handler({ ...context, deferInterrupt: () => { deferred = true; }, notifyReti: () => { reti = true; } });
    policy.retire(deferred);
    // Device notification observes the completed return and cannot undo its retirement.
    if (reti) policy.notifyReti?.();
  };
  return {
    // External interrupt entry shares the guard, decoder, fetch effects, and retirement.
    atBoundary, decode: policy.decode, opcodeFetched: policy.opcodeFetched, execute,
    reset: (): StateTransition<Snapshot> => atBoundary(() => {
      const before = snapshot();
      policy.reset();
      return { before, after: snapshot(), accesses: [] };
    }),
    step: (): ByteStep<Snapshot> => atBoundary(() => {
      const before = snapshot();
      if (policy.stopped()) return { before, after: snapshot(), instruction: null, accesses: [], outcome: "halted" };
      const accesses: (MemoryAccess | PortAccess)[] = [];
      const record = (access: MemoryAccess | PortAccess): void => { accesses.push(access); };
      const { readByte, writeByte } = recordMemory(ram, record);
      const { readPort, writePort } = recordPorts(ports, record);
      const address = policy.counter.pc, bytes = [readByte(address)];
      const nextEncodingByte = (): number => {
        const byte = readByte((address + bytes.length) & addressMask);
        bytes.push(byte);
        return byte;
      };
      const { handler, opcodeFetches } = policy.decode(bytes[0]!, nextEncodingByte);
      if (handler) {
        policy.counter.pc = (address + bytes.length) & addressMask;
        policy.opcodeFetched(opcodeFetches);
        const fetchByte = (): number => {
          const byte = readByte(policy.counter.pc);
          policy.counter.pc = (policy.counter.pc + 1) & addressMask;
          bytes.push(byte);
          return byte;
        };
        execute(handler, { fetchByte, fetchWord: () => readWord(fetchByte), readByte, writeByte, readPort, writePort });
      }
      const transition = { before, after: snapshot(), instruction: { address, bytes }, accesses };
      return handler
        ? { ...transition, outcome: policy.stopped() ? "halted" : "executed" }
        : { ...transition, outcome: "unsupported", reason: "opcode" };
    }),
  };
}
