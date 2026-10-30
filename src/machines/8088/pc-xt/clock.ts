import { checkUnsigned } from "../../../components/validation.ts";

/** Nominal XT crystal frequency; CPU CLK divides by 3 and PIT CLK by 12. */
export const xtOscillatorHz = 14_318_180;

export interface XtClockSnapshot { readonly ticks: number; }

/** Explicit oscillator time. CPU instruction costs are deliberately not inferred here. */
export class XtClock {
  #ticks: number;

  constructor(state?: XtClockSnapshot) {
    this.#ticks = state === undefined ? 0 : state.ticks;
    checkUnsigned("XT elapsed oscillator ticks", this.#ticks, Number.MAX_SAFE_INTEGER);
  }

  snapshot(): XtClockSnapshot { return { ticks: this.#ticks }; }
  reset(): void { this.#ticks = 0; }

  /** Visit every PIT boundary and the final partial interval, preserving integer phase. */
  advance(ticks: number, elapsed: (microseconds: number, pitClock: boolean) => void): void {
    checkUnsigned("XT oscillator interval", ticks, 0xffff_ffff);
    if (!Number.isSafeInteger(this.#ticks + ticks)) throw new RangeError("XT elapsed time exceeds its exact range.");
    while (ticks > 0) {
      const delta = Math.min(ticks, 12 - this.#ticks % 12);
      // Reduce before multiplying: even after years, both products remain exact integers.
      const phase = this.#ticks % xtOscillatorHz;
      const microseconds = Math.floor((phase + delta) * 1_000_000 / xtOscillatorHz)
        - Math.floor(phase * 1_000_000 / xtOscillatorHz);
      this.#ticks += delta;
      ticks -= delta;
      elapsed(microseconds, this.#ticks % 12 === 0);
    }
  }
}
