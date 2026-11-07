import { checkMachineSnapshot } from "./snapshot.js";

/** Accumulate CPU clocks at completed instruction and interrupt boundaries. */
export class InstructionClock {
  #ticks: number;
  readonly hertz: number | undefined;

  constructor(state: { readonly ticks: number } = { ticks: 0 }, hertz?: number) {
    if (hertz !== undefined && (!Number.isFinite(hertz) || hertz <= 0 || hertz > Number.MAX_SAFE_INTEGER)) {
      throw new RangeError("CPU clock frequency must be positive and at most 9007199254740991 Hz.");
    }
    checkMachineSnapshot(state, ["ticks"]);
    checkTicks(state.ticks);
    this.hertz = hertz;
    this.#ticks = state.ticks;
  }

  get ticks(): number { return this.#ticks; }

  snapshot(): { readonly ticks: number } { return { ticks: this.#ticks }; }

  advance(ticks: number): void {
    checkTicks(ticks);
    const total = this.#ticks + ticks;
    checkTicks(total);
    this.#ticks = total;
  }
}

function checkTicks(ticks: number): void {
  if (!Number.isSafeInteger(ticks) || ticks < 0) throw new RangeError("CPU clocks must be a nonnegative safe integer.");
}
