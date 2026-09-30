import type { SerialBatch } from "../../src/runtime/serial-session.js";

interface Session<Record> {
  readonly running: boolean;
  start(): void;
  stop(): void;
  run(budget: number): SerialBatch<Record>;
  drainOutput(): readonly number[];
}

/** Yield after each bounded batch; STOP invalidates even a callback already queued by the host. */
export function createSerialExecution<Record>(session: Session<Record>, options: {
  readonly schedule: (callback: () => void) => () => void;
  readonly output: (bytes: readonly number[]) => void;
  readonly onChange: () => void;
}) {
  let cancel = () => {}, generation = 0, steps = 0;
  let error: string | undefined;
  let reason = "Stopped";
  let records: readonly Record[] = [];

  function stop(): void {
    generation++;
    cancel(); cancel = () => {};
    session.stop();
  }
  function queue(): void {
    const token = generation;
    cancel = options.schedule(() => {
      if (token !== generation || !session.running) return;
      cancel = () => {};
      try {
        const batch = session.run(2000);
        steps += batch.records.length;
        records = [...records, ...batch.records].slice(-12);
        reason = batch.stopReason === "step-limit" ? "Running" : batch.stopReason;
      } catch (cause) {
        stop();
        error = cause instanceof Error ? cause.message : String(cause);
        reason = "Execution stopped";
      }
      options.output(session.drainOutput());
      options.onChange();
      if (session.running && token === generation) queue();
    });
  }
  return {
    get steps() { return steps; },
    get records() { return records; },
    get error() { return error; },
    get status() { return reason; },
    run(): void {
      if (session.running || error !== undefined) return;
      session.start(); reason = "Running";
      queue(); options.onChange();
    },
    stop(): void { stop(); reason = "Stopped"; options.onChange(); },
    clear(): void {
      stop(); error = undefined; reason = "Stopped"; steps = 0; records = [];
      // The caller changes the machine before rendering again.
    },
  };
}
