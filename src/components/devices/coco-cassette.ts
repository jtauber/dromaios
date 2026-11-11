import { checkUnsigned } from "../validation.ts";
import { checkMachineSnapshot } from "../../machines/snapshot.ts";

export const cocoTapeSampleRate = 44_100;
export const cocoTapeSampleLimit = cocoTapeSampleRate * 120;
export type CocoTapeMode = "stop" | "play" | "record";
export interface CocoCassetteSnapshot {
  readonly name: string | null;
  readonly samples: readonly number[] | null;
  readonly writable: boolean;
  readonly mode: CocoTapeMode;
  readonly position: number;
  readonly phase: number;
}

/** A recorder attached to the CoCo, independent of BASIC, its CPU, and browser audio. */
export class CocoCassette {
  #name: string | null = null;
  #samples: number[] | null = null;
  #writable = false;
  #mode: CocoTapeMode = "stop";
  #position = 0;
  #phase = 0;
  readonly #changed: () => void;

  constructor(changed: () => void = () => {}, state?: CocoCassetteSnapshot) {
    this.#changed = changed;
    if (state === undefined) return;
    checkMachineSnapshot(state, ["name", "samples", "writable", "mode", "position", "phase"]);
    if (typeof state.writable !== "boolean" || !["stop", "play", "record"].includes(state.mode)) throw new TypeError("Invalid cassette transport.");
    if (typeof state.phase !== "number" || !Number.isFinite(state.phase) || state.phase < 0 || state.phase >= 1) throw new RangeError("Invalid cassette sample phase.");
    if (state.samples !== null) {
      this.#checkName(state.name); checkSamples(state.samples);
      this.#name = state.name; this.#samples = [...state.samples];
    } else if (state.name !== null || state.writable || state.mode !== "stop" || state.phase !== 0) throw new TypeError("Empty cassette must be stopped.");
    checkUnsigned("Cassette position", state.position, state.samples?.length ?? 0);
    if (state.mode === "record" && (!state.writable || state.position === cocoTapeSampleLimit)
      || state.mode === "play" && state.position === state.samples?.length) {
      throw new TypeError("Invalid cassette transport at the end of the tape.");
    }
    this.#writable = state.writable; this.#mode = state.mode; this.#position = state.position; this.#phase = state.phase;
  }

  inspect() { return { name: this.#name, length: this.#samples?.length ?? 0, position: this.#position,
    phase: this.#phase, mode: this.#mode, writable: this.#writable }; }
  get inputSample(): number { return this.#mode === "play" ? this.#samples![this.#position] ?? 128 : 128; }
  snapshot(): CocoCassetteSnapshot {
    return { name: this.#name, samples: this.#samples?.slice() ?? null, writable: this.#writable,
      mode: this.#mode, position: this.#position, phase: this.#phase };
  }
  samples(): Uint8Array {
    if (this.#samples === null) throw new Error("No tape is mounted.");
    return Uint8Array.from(this.#samples);
  }
  insert(name: string, samples: Uint8Array | readonly number[]): void {
    this.#checkName(name); checkSamples(samples);
    this.#name = name; this.#samples = Array.from(samples); this.#writable = false; this.rewind();
  }
  blank(name = "Untitled.wav"): void {
    this.#checkName(name); this.#name = name; this.#samples = []; this.#writable = true; this.rewind();
  }
  eject(): void { this.#name = null; this.#samples = null; this.#writable = false; this.rewind(); }
  writableCopy(): void {
    if (this.#samples === null) throw new Error("Mount a tape before making a writable copy.");
    this.#writable = true; this.#changed();
  }
  play(): void {
    if (this.#samples === null || this.#position >= this.#samples.length) throw new Error("Rewind a recorded tape before playing.");
    this.#mode = "play"; this.#changed();
  }
  record(): void {
    if (!this.#writable) throw new Error("Create a blank tape or make a writable copy before recording.");
    if (this.#position >= cocoTapeSampleLimit) throw new Error("The tape has reached its two-minute limit.");
    this.#mode = "record"; this.#changed();
  }
  stop(): void { this.#mode = "stop"; this.#changed(); }
  rewind(): void { this.#position = 0; this.#phase = 0; this.stop(); }

  /** Sample the interval's starting pins. Fractional progress survives pauses and checkpoints. */
  advance(clocks: number, hertz: number, motor: boolean, output: number): void {
    checkUnsigned("Cassette clocks", clocks, 0xffffffff); checkUnsigned("Cassette output", output, 255);
    if (!Number.isFinite(hertz) || hertz <= 0 || typeof motor !== "boolean") throw new RangeError("Invalid cassette clock or motor input.");
    if (!motor || this.#mode === "stop" || clocks === 0) return;
    const elapsed = this.#phase + clocks * cocoTapeSampleRate / hertz, count = Math.floor(elapsed);
    this.#phase = elapsed - count;
    const limit = this.#mode === "record" ? cocoTapeSampleLimit : this.#samples!.length;
    const end = Math.min(this.#position + count, limit);
    if (this.#mode === "record") {
      for (let i = this.#position; i < end; i++) this.#samples![i] = output;
    }
    this.#position = end;
    if (end === limit) { this.#phase = 0; this.#mode = "stop"; }
    if (count > 0) this.#changed();
  }

  #checkName(name: unknown): asserts name is string {
    if (typeof name !== "string" || !name.trim() || name.length > 255 || /[\x00-\x1f]/.test(name)) throw new TypeError("Invalid tape name.");
  }
}

function checkSamples(samples: Uint8Array | readonly number[]): void {
  if (!(samples instanceof Uint8Array) && !Array.isArray(samples) || samples.length > cocoTapeSampleLimit) throw new RangeError("Expected at most two minutes of tape samples.");
  for (const sample of samples) checkUnsigned("Tape sample", sample, 255);
}
