import { I8253Counter } from "./generated/i8253-counter.ts";
import type { I8253CounterSnapshot } from "./generated/i8253-counter.ts";
import type { MemoryConnection } from "../memory/connection.ts";
import { checkUnsigned } from "../validation.ts";

export interface I8253Snapshot {
  readonly channels: readonly [I8253CounterSnapshot, I8253CounterSnapshot, I8253CounterSnapshot];
}

/** Three copies of the literate counter, with the 8253's package address decoding. */
export class I8253 implements MemoryConnection {
  readonly #channels: readonly [I8253Counter, I8253Counter, I8253Counter];

  constructor(state?: I8253Snapshot) {
    if (state !== undefined && (!Array.isArray(state.channels) || state.channels.length !== 3
      || !state.channels[0] || !state.channels[1] || !state.channels[2])) {
      throw new TypeError("8253 state requires three counter snapshots.");
    }
    this.#channels = [new I8253Counter(state?.channels[0]), new I8253Counter(state?.channels[1]),
      new I8253Counter(state?.channels[2])];
  }

  get size(): number { return 4; }

  snapshot(): I8253Snapshot {
    return { channels: [this.#channels[0].snapshot(), this.#channels[1].snapshot(), this.#channels[2].snapshot()] };
  }

  read(address: 0 | 1 | 2): number;
  read(address: number): number | "bus-error";
  read(address: number): number | "bus-error" {
    checkUnsigned("8253 register", address, 3);
    return address === 3 ? "bus-error" : this.#channels[address]!.read(0);
  }

  write(address: number, value: number): void {
    checkUnsigned("8253 register", address, 3);
    checkUnsigned("8253 byte", value, 0xff);
    if (address !== 3) { this.#channels[address]!.write(0, value); return; }
    const selected = value >>> 6;
    if (selected === 3) throw new RangeError("The 8253 has no read-back command or counter 3.");
    this.#channels[selected]!.write(1, value & 0x3f);
  }

  count(channel: number): number { return this.#channel(channel).count(); }
  output(channel: number): boolean { return this.#channel(channel).output(); }
  setGate(channel: number, high: boolean): void { this.#channel(channel).setGate(high); }
  clock(channel: number): void { this.#channel(channel).clock(); }
  reset(): void { for (const channel of this.#channels) channel.reset(); }

  #channel(index: number): I8253Counter {
    checkUnsigned("8253 channel", index, 2);
    return this.#channels[index]!;
  }
}
