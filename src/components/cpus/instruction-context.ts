import type { ByteMemory } from "./memory-access.ts";

/** Byte operands fetched from the instruction stream, plus separate data-memory access. */
export interface ByteInstructionContext extends ByteMemory {
  readonly fetchByte: () => number;
}

/** Request recognition inhibition at successful retirement, without changing stored latches now. */
export interface InterruptDeferralContext<Scope extends "irq" | "intr" | "all" = "intr" | "all"> {
  readonly deferInterrupt: (scope: Scope) => void;
}

/** Adds a 16-bit operand fetch in the CPU's byte order. */
export interface WordInstructionContext extends ByteInstructionContext {
  readonly fetchWord: () => number;
}

/** Record a RETI request now; notify the device only after successful retirement. */
export interface RetiNotificationContext {
  readonly notifyReti: () => void;
}

/** Report completed software delivery; the definition has already performed all vector and frame effects. */
export interface InterruptReportContext {
  readonly reportInterrupt: (vector: number) => void;
}
