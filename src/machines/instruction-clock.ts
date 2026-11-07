import { checkMachineSnapshot } from "./snapshot.js";

/** Accumulate CPU clocks at completed instruction and interrupt boundaries. */
export class InstructionClock {
  #ticks: number;

  constructor(state: { readonly ticks: number } = { ticks: 0 }) {
    checkMachineSnapshot(state, ["ticks"]);
    checkTicks(state.ticks);
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
