import { executionBoundary } from "../components/cpus/execution-boundary.ts";
import { checkUnsigned } from "../components/validation.ts";

interface SerialMachine {
  readonly cpu: {
    step(): { readonly outcome: "executed" | "halted" | "waiting" | "unsupported" };
  };
  readonly serial: { offer(byte: number): boolean };
  reset(): unknown;
}
type Step = ReturnType<SerialMachine["cpu"]["step"]>;
type Bytes = readonly number[] | Uint8Array;

export interface SerialBatch<Record> {
  readonly records: readonly Record[];
  readonly stopReason: "paused" | "step-limit" | "halted" | "waiting" | "unsupported";
}

export interface SerialTransportSnapshot {
  readonly tape: readonly number[];
  readonly tapePosition: number;
  readonly input: readonly number[];
  readonly output: readonly number[];
}

/** Host transport and execution controls. The supplied factory owns all hardware configuration. */
export class SerialSession<Machine extends SerialMachine> {
  readonly #createMachine: (output: (byte: number) => void) => Machine;
  readonly #atBoundary = executionBoundary("Serial-session mutations must not be reentrant.");
  #instance: { machine: Machine; output: number[] };
  #tape: Uint8Array;
  #tapePosition = 0;
  #input: number[] = [];
  #inputPosition = 0;
  #running = false;

  constructor(createMachine: (output: (byte: number) => void) => Machine, tape: Bytes = [],
    restoreMachine?: (output: (byte: number) => void) => Machine) {
    this.#createMachine = createMachine;
    this.#tape = copyBytes(tape);
    // A restored first instance must not change what a later reload constructs.
    this.#instance = this.#create(restoreMachine);
  }

  get machine(): Machine { return this.#instance.machine; }
  get running(): boolean { return this.#running; }
  get tapePosition(): number { return this.#tapePosition; }
  get tapeLength(): number { return this.#tape.length; }
  get pendingInput(): number { return this.#input.length - this.#inputPosition; }

  /** Host state only; save the machine's snapshot at the same instruction boundary. */
  snapshotTransport(): SerialTransportSnapshot {
    return this.#atBoundary(() => ({
      tape: Array.from(this.#tape), tapePosition: this.#tapePosition,
      input: this.#input.slice(this.#inputPosition), output: [...this.#instance.output],
    }));
  }

  /** Restore owned queues without offering bytes or starting execution. */
  restoreTransport(state: SerialTransportSnapshot): void {
    this.#atBoundary(() => {
      const tape = copyBytes(state.tape), input = copyBytes(state.input), output = copyBytes(state.output);
      checkUnsigned("Tape position", state.tapePosition, tape.length);
      this.#running = false;
      this.#tape = tape; this.#tapePosition = state.tapePosition;
      this.#input = Array.from(input); this.#inputPosition = 0;
      // The machine's callback closes over this buffer; retain that identity.
      this.#instance.output.length = 0;
      for (const byte of output) this.#instance.output.push(byte);
    });
  }

  /** Queue raw keyboard bytes after the tape; no echo, line editing, or character conversion. */
  send(bytes: Bytes): void {
    this.#atBoundary(() => {
      const copy = copyBytes(bytes);
      this.#input = this.#input.slice(this.#inputPosition);
      this.#inputPosition = 0;
      for (const byte of copy) this.#input.push(byte);
    });
  }

  start(): void { this.#atBoundary(() => { this.#running = true; }); }
  stop(): void { this.#atBoundary(() => { this.#running = false; }); }

  /** Execute one instruction while stopped, including the normal input offer. */
  step(): ReturnType<Machine["cpu"]["step"]>;
  step(): Step {
    return this.#atBoundary(() => {
      if (this.#running) throw new Error("Stop the serial session before single-stepping.");
      return this.#step();
    });
  }

  /** A synchronous batch; browser scheduling and transcript/history limits belong to its caller. */
  run(maxSteps: number): SerialBatch<ReturnType<Machine["cpu"]["step"]>>;
  run(maxSteps: number): SerialBatch<Step> {
    return this.#atBoundary(() => {
      checkUnsigned("maxSteps", maxSteps, Number.MAX_SAFE_INTEGER);
      if (!this.#running) return { records: [], stopReason: "paused" };
      const records: Step[] = [];
      try {
        for (let count = 0; count < maxSteps; count++) {
          const record = this.#step();
          records.push(record);
          if (record.outcome !== "executed") {
            this.#running = false;
            return { records, stopReason: record.outcome };
          }
        }
        return { records, stopReason: "step-limit" };
      } catch (error) {
        this.#running = false;
        throw error;
      }
    });
  }

  /** Transfer ownership of captured output to the host; repeated drains do not duplicate bytes. */
  drainOutput(): readonly number[] {
    return this.#atBoundary(() => this.#instance.output.splice(0));
  }

  /** Stop, apply the machine's reset, and discard host input. Keep captured output. */
  reset(): ReturnType<Machine["reset"]>;
  reset(): unknown {
    return this.#atBoundary(() => {
      this.#running = false;
      const record = this.machine.reset();
      this.#clearInput();
      return record;
    });
  }

  /** Reconstruct a stopped machine with a fresh tape, input queue, and output capture. */
  reload(tape: Bytes = []): void {
    this.#atBoundary(() => {
      const bytes = copyBytes(tape), instance = this.#create();
      this.#running = false;
      this.#clearInput();
      this.#tape = bytes;
      this.#instance = instance;
    });
  }

  #create(createMachine = this.#createMachine): { machine: Machine; output: number[] } {
    // Each generation captures its own buffer; old machine references cannot write into a reload.
    const output: number[] = [];
    const machine = createMachine(byte => { checkUnsigned("Serial output byte", byte, 0xff); output.push(byte); });
    return { machine, output };
  }

  #clearInput(): void {
    this.#tape = new Uint8Array(); this.#tapePosition = 0;
    this.#input = []; this.#inputPosition = 0;
  }

  #step(): Step {
    if (this.#tapePosition < this.#tape.length) {
      if (this.machine.serial.offer(this.#tape[this.#tapePosition]!)) this.#tapePosition++;
    } else if (this.#inputPosition < this.#input.length) {
      if (this.machine.serial.offer(this.#input[this.#inputPosition]!)) this.#inputPosition++;
      if (this.#inputPosition === this.#input.length) { this.#input = []; this.#inputPosition = 0; }
    }
    return this.machine.cpu.step();
  }
}

/** Copy and validate the entire offer before any queue or machine changes. */
function copyBytes(bytes: Bytes): Uint8Array {
  if (!Array.isArray(bytes) && !(bytes instanceof Uint8Array)) throw new TypeError("Serial bytes require an array.");
  return Uint8Array.from(bytes, byte => { checkUnsigned("Serial input byte", byte, 0xff); return byte; });
}
