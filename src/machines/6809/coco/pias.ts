import { Mc6821 } from "../../../components/devices/generated/mc6821.ts";
import type { Mc6821Snapshot } from "../../../components/devices/generated/mc6821.ts";
import type { ByteMemoryConnection } from "../../../components/memory/connection.ts";
import { checkUnsigned } from "../../../components/validation.ts";
import { CocoKeyboard } from "./keyboard.ts";
import type { CocoKey, CocoKeyboardSnapshot } from "./keyboard.ts";

export interface CocoPiasSnapshot {
  readonly pia0: Mc6821Snapshot;
  readonly pia1: Mc6821Snapshot;
  readonly keyboard: CocoKeyboardSnapshot;
}

/** CoCo wiring at FF00–FF3F; SAM, video decoding, and host input queues live elsewhere. */
export class CocoPias implements ByteMemoryConnection {
  readonly #pia0: Mc6821;
  readonly #pia1: Mc6821;
  readonly #keyboard: CocoKeyboard;

  constructor(state?: CocoPiasSnapshot) {
    if (state !== undefined && (!state.pia0 || !state.pia1 || !state.keyboard)) {
      throw new TypeError("CoCo PIA state requires both chips and the keyboard.");
    }
    this.#pia0 = new Mc6821(state?.pia0);
    this.#pia1 = new Mc6821(state?.pia1);
    this.#keyboard = new CocoKeyboard(state?.keyboard);
    const pins = this.#keyboard.resolve(this.#pia0.driveA(), this.#pia0.driveB());
    if (state !== undefined) {
      const a = this.#pia0.snapshot(), b = this.#pia1.snapshot();
      if (a.input_a !== pins.a || a.input_b !== pins.b || !a.ca2 || !a.cb2
        || b.input_a !== 0xff || b.input_b !== 0xff || !b.ca2 || !b.cb2) {
        throw new RangeError("PIA inputs do not match the CoCo wiring.");
      }
    }
    this.#updateKeyboardPins();
  }

  get size(): number { return 0x40; }
  get irq(): boolean { return this.#pia0.irq(); }
  get firq(): boolean { return this.#pia1.irq(); }
  get videoPins(): number { return this.#pia1.pinsB(); }

  snapshot(): CocoPiasSnapshot {
    return { pia0: this.#pia0.snapshot(), pia1: this.#pia1.snapshot(), keyboard: this.#keyboard.snapshot() };
  }

  read(address: number): number {
    return this.#device(address).read(address & 3);
  }

  write(address: number, value: number): void {
    this.#device(address).write(address & 3, value);
    this.#updateKeyboardPins();
  }

  setKey(key: CocoKey, pressed: boolean): void {
    this.#keyboard.setKey(key, pressed);
    this.#updateKeyboardPins();
  }

  releaseKeys(): void {
    this.#keyboard.releaseAll();
    this.#updateKeyboardPins();
  }

  setHorizontalSync(high: boolean): void { this.#pia0.setCA1(high); }
  setFieldSync(high: boolean): void { this.#pia0.setCB1(high); }
  setCarrierDetect(high: boolean): void { this.#pia1.setCA1(high); }
  setCartridgeLine(high: boolean): void { this.#pia1.setCB1(high); }

  /** Reset the PIAs, preserving held keys and externally supplied control levels. */
  reset(): void {
    this.#pia0.reset(); this.#pia1.reset();
    this.#updateKeyboardPins();
  }

  #device(address: number): Mc6821 {
    checkUnsigned("CoCo PIA offset", address, 0x3f);
    return address < 0x20 ? this.#pia0 : this.#pia1;
  }

  #updateKeyboardPins(): void {
    const { a, b } = this.#keyboard.resolve(this.#pia0.driveA(), this.#pia0.driveB());
    this.#pia0.setPortInputs(a, b);
  }
}
