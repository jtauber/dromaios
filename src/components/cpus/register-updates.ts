/** Instruction-local reads and writes that have not yet reached stored registers. */
export interface RegisterUpdateContext {
  readonly readPendingRegister: (key: string, read: () => number) => number;
  readonly stageRegister: (key: string, value: number, write: (value: number) => void) => void;
}

/** Keep first-stage order and the latest value; committing retains entries for later operands. */
export function registerUpdates(): RegisterUpdateContext & { commit(): void } {
  const pending = new Map<string, { value: number; write(value: number): void }>();
  return {
    readPendingRegister: (key, read) => pending.get(key)?.value ?? read(),
    stageRegister: (key, value, write) => { pending.set(key, { value, write }); },
    commit: () => { for (const { value, write } of pending.values()) write(value); },
  };
}
