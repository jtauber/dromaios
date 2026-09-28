interface ExecutionOptions<Record> {
  readonly step: () => Record;
  readonly canStep: () => boolean;
  readonly onChange: () => void;
  /** Schedule one callback, returning a function that cancels it. */
  readonly schedule: (callback: () => void, delayMs: number) => () => void;
}

/** Pace single instructions, yielding between them without accumulating missed ticks. */
export function createExecutionController<Record>({ step, canStep, onChange, schedule }: ExecutionOptions<Record>) {
  let running = false;
  let delayMs = 1000;
  let error: string | undefined;
  let cancel = () => {};
  let generation = 0;
  const records: Record[] = [];
  let steps = 0;

  function cancelPending(): void {
    generation++;
    cancel();
    cancel = () => {};
  }

  function advance(): void {
    try {
      records.push(step());
      steps++;
      if (records.length > 12) records.shift();
    }
    catch (cause) {
      // A failed step may have partial effects. Keep them visible and do not retry it.
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function queue(): void {
    const token = generation;
    cancel = schedule(() => {
      // Cancellation also rejects callbacks already queued by the host before STOP.
      if (!running || token !== generation) return;
      cancel = () => {};
      if (canStep()) advance();
      if (error !== undefined || !canStep()) running = false;
      onChange();
      if (running) queue();
    }, delayMs);
  }

  return {
    get running() { return running; },
    get error() { return error; },
    get records(): readonly Record[] { return records; },
    get steps() { return steps; },
    run(): void {
      if (running || error !== undefined || !canStep()) return;
      running = true;
      queue();
      onChange();
    },
    stop(): void {
      cancelPending();
      running = false;
      onChange();
    },
    step(): void {
      if (running || error !== undefined || !canStep()) return;
      advance();
      onChange();
    },
    setDelay(value: number): void {
      if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError("The instruction delay must be a positive integer.");
      delayMs = value;
      cancelPending();
      if (running) queue();
    },
    reset(): void {
      cancelPending();
      running = false;
      error = undefined;
      records.length = 0;
      steps = 0;
      // The caller replaces its machine, then refreshes the view.
    },
  };
}
