import type { Ram } from "../memory/ram.js";
import { readWordBE, readWordLE } from "./binary.ts";
import { executeByteInstruction } from "./execute-byte-instruction.ts";
import { executionBoundary } from "./execution-boundary.ts";
import type { HaltedStep, InstructionStep, StateTransition } from "./execution-records.ts";
import type { WordInstructionContext } from "./instruction-context.ts";
import { recordInterruptInstruction } from "./interrupt-instruction.ts";
import type { InterruptAcknowledge, InterruptInstruction } from "./interrupt-instruction.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import { recordPorts } from "./port-access.ts";
import type { BytePorts, PortAccess } from "./port-access.ts";

type Access = MemoryAccess | PortAccess;
type InterruptAccess = Access | InterruptAcknowledge;
export type ByteStep<Snapshot> = InstructionStep<Snapshot, Access> | HaltedStep<Snapshot, Access>;
export type SuppliedStep<Snapshot> = StateTransition<Snapshot, InterruptAccess> & {
  readonly instruction: InterruptInstruction;
} & ({ readonly outcome: "executed" | "halted" } | { readonly outcome: "unsupported"; readonly reason: "opcode" });

/** Bound chapter operations; the runtime owns recording and guards, not processor state. */
export interface ByteExecutionPolicy {
  readonly counter: { pc: number };
  readonly stopped: () => boolean;
  readonly reset: () => void;
  readonly retire: () => void;
  readonly acceptInterrupt: () => void;
  readonly word: "little" | "big";
  readonly opcodeAdvance: "dispatch" | "read";
  readonly interruptCounter: "preserve" | "advance";
  readonly handlers: Readonly<Partial<Record<number, (context: WordInstructionContext & BytePorts) => void>>>;
}

/** Validate the chapter's flat byte-memory contract before inspecting caller-supplied state. */
export function checkByteMemory(cpu: string, ram: Ram, bits: number): void {
  const size = 2 ** bits;
  if (ram.size !== size) {
    const amount = size >= 1024 ? `${size / 1024} KiB` : `${size} bytes`;
    throw new RangeError(`The ${cpu} model requires exactly ${amount} of RAM.`);
  }
}

/** One-byte dispatch, successful-read PC advances, and retained effects on thrown failures. */
export function byteExecution<Snapshot>(cpu: string, ram: Ram, ports: BytePorts | undefined,
  snapshot: () => Snapshot, policy: ByteExecutionPolicy) {
  const atBoundary = executionBoundary(`${cpu} step, reset, and interrupt calls must not be reentrant.`);
  const readWord = policy.word === "little" ? readWordLE : readWordBE;
  return {
    reset: (): StateTransition<Snapshot> => atBoundary(() => {
      const before = snapshot();
      policy.reset();
      return { before, after: snapshot(), accesses: [] };
    }),
    step: (): ByteStep<Snapshot> => atBoundary(() => {
      const before = snapshot();
      if (policy.stopped()) return { before, after: snapshot(), instruction: null, accesses: [], outcome: "halted" };
      const accesses: Access[] = [];
      const record = (access: Access): void => { accesses.push(access); };
      const { readPort, writePort } = recordPorts(ports, record);
      const execution = executeByteInstruction(policy.counter, ram, opcode => {
        const handler = policy.handlers[opcode];
        return handler && (context => handler({ ...context, readPort, writePort }));
      }, readWord, undefined, { opcodeAdvance: policy.opcodeAdvance, onAccess: record });
      if (execution.executed) policy.retire();
      const transition = { before, after: snapshot(), instruction: execution.instruction, accesses };
      return execution.executed
        ? { ...transition, outcome: policy.stopped() ? "halted" : "executed" }
        : { ...transition, outcome: "unsupported", reason: "opcode" };
    }),
    interrupt: (acknowledge: () => number): SuppliedStep<Snapshot> => atBoundary(() => {
      if (typeof acknowledge !== "function") throw new TypeError(`${cpu} interrupt requires an acknowledgement callback.`);
      const before = snapshot();
      policy.acceptInterrupt();
      const accesses: InterruptAccess[] = [];
      const record = (access: InterruptAccess): void => { accesses.push(access); };
      const { readByte, writeByte } = recordMemory(ram, record);
      const { readPort, writePort } = recordPorts(ports, record);
      const supplied = recordInterruptInstruction(acknowledge, record);
      const fetchByte = (): number => {
        const byte = supplied.fetchByte();
        if (policy.interruptCounter === "advance") policy.counter.pc = (policy.counter.pc + 1) & 0xffff;
        return byte;
      };
      const handler = policy.handlers[fetchByte()];
      if (handler) {
        handler({ readByte, writeByte, readPort, writePort, fetchByte, fetchWord: () => readWord(fetchByte) });
        policy.retire();
      }
      const transition = { before, after: snapshot(), instruction: supplied.instruction, accesses };
      return handler
        ? { ...transition, outcome: policy.stopped() ? "halted" : "executed" }
        : { ...transition, outcome: "unsupported", reason: "opcode" };
    }),
  };
}
