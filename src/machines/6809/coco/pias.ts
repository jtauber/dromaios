import { Mc6821 } from "../../../components/devices/generated/mc6821.ts";
import { CocoSound } from "../../../components/devices/generated/coco-sound.ts";
import { CocoJoystick } from "../../../components/devices/generated/coco-joystick.ts";
import type { CocoJoystickSnapshot } from "../../../components/devices/generated/coco-joystick.ts";
import type { Mc6821Snapshot } from "../../../components/devices/generated/mc6821.ts";
import type { ByteMemoryConnection } from "../../../components/memory/connection.ts";
import { checkUnsigned } from "../../../components/validation.ts";
import { CocoKeyboard } from "./keyboard.ts";
import type { CocoKey, CocoKeyboardSnapshot } from "./keyboard.ts";

export interface CocoPiasSnapshot {
  readonly pia0: Mc6821Snapshot;
  readonly pia1: Mc6821Snapshot;
  readonly keyboard: CocoKeyboardSnapshot;
  readonly joysticks: Readonly<Record<CocoJoystickPort, CocoJoystickSnapshot>>;
}

export type CocoJoystickPort = "right" | "left";

/** CoCo wiring at FF00–FF3F; SAM, video decoding, and host input queues live elsewhere. */
export class CocoPias implements ByteMemoryConnection {
  readonly #pia0: Mc6821;
  readonly #pia1: Mc6821;
  readonly #keyboard: CocoKeyboard;
  readonly #sound = new CocoSound();
  readonly #joysticks: Readonly<Record<CocoJoystickPort, CocoJoystick>>;

  constructor(state?: CocoPiasSnapshot) {
    if (state !== undefined && (!state.pia0 || !state.pia1 || !state.keyboard || !state.joysticks?.right || !state.joysticks.left)) {
      throw new TypeError("CoCo PIA state requires both chips, the keyboard, and both joysticks.");
    }
    this.#pia0 = new Mc6821(state?.pia0);
    this.#pia1 = new Mc6821(state?.pia1);
    this.#keyboard = new CocoKeyboard(state?.keyboard);
    this.#joysticks = { right: new CocoJoystick(state?.joysticks.right), left: new CocoJoystick(state?.joysticks.left) };
    const pins = this.#inputPins();
    if (state !== undefined) {
      const a = this.#pia0.snapshot(), b = this.#pia1.snapshot();
      if (a.input_a !== pins.a || a.input_b !== pins.b || !a.ca2 || !a.cb2
        || b.input_a !== 0xff || b.input_b !== 0xff || !b.ca2 || !b.cb2) {
        throw new RangeError("PIA inputs do not match the CoCo wiring.");
      }
    }
    this.#updateInputPins();
  }

  get size(): number { return 0x40; }
  get irq(): boolean { return this.#pia0.irq(); }
  get firq(): boolean { return this.#pia1.irq(); }
  get videoPins(): number { return this.#pia1.pinsB(); }
  /** Normalized sound output; observing pins never acknowledges a PIA interrupt. */
  get soundLevel(): number {
    return this.#sound.output(this.#pia1.pinsA(), this.#pia1.pinsB(),
      this.#pia0.ca2High(), this.#pia0.cb2High(), this.#pia1.cb2High()) / 126;
  }

  snapshot(): CocoPiasSnapshot {
    return { pia0: this.#pia0.snapshot(), pia1: this.#pia1.snapshot(), keyboard: this.#keyboard.snapshot(),
      joysticks: { right: this.joystick("right"), left: this.joystick("left") } };
  }

  read(address: number): number {
    return this.#device(address).read(address & 3);
  }

  write(address: number, value: number): void {
    this.#device(address).write(address & 3, value);
    this.#updateInputPins();
  }

  setKey(key: CocoKey, pressed: boolean): void {
    this.#keyboard.setKey(key, pressed);
    this.#updateInputPins();
  }

  releaseKeys(): void {
    this.#keyboard.releaseAll();
    this.#updateInputPins();
  }

  joystick(port: CocoJoystickPort): CocoJoystickSnapshot { return this.#stick(port).snapshot(); }
  setJoystickPosition(port: CocoJoystickPort, x: number, y: number): void {
    this.#stick(port).setPosition(x, y); this.#updateInputPins();
  }
  connectJoystick(port: CocoJoystickPort, connected: boolean): void {
    this.#stick(port).connect(connected); this.#updateInputPins();
  }
  setJoystickButton(port: CocoJoystickPort, pressed: boolean): void {
    this.#stick(port).setButton(pressed); this.#updateInputPins();
  }
  releaseJoystickButtons(): void {
    this.#joysticks.right.setButton(false); this.#joysticks.left.setButton(false); this.#updateInputPins();
  }

  setHorizontalSync(high: boolean): void { this.#pia0.setCA1(high); }
  setFieldSync(high: boolean): void { this.#pia0.setCB1(high); }
  setCarrierDetect(high: boolean): void { this.#pia1.setCA1(high); }
  setCartridgeLine(high: boolean): void { this.#pia1.setCB1(high); }

  /** Reset the PIAs, preserving held keys and externally supplied control levels. */
  reset(): void {
    this.#pia0.reset(); this.#pia1.reset();
    this.#updateInputPins();
  }

  #device(address: number): Mc6821 {
    checkUnsigned("CoCo PIA offset", address, 0x3f);
    return address < 0x20 ? this.#pia0 : this.#pia1;
  }

  #stick(port: CocoJoystickPort): CocoJoystick {
    if (port !== "right" && port !== "left") throw new RangeError(`Unknown CoCo joystick port: ${port}`);
    return this.#joysticks[port];
  }

  #inputPins(): { readonly a: number; readonly b: number } {
    const { right, left } = this.#joysticks;
    const buttons = (right.buttonLow() ? 1 : 0) | (left.buttonLow() ? 2 : 0);
    // Fire grounds a matrix row. Resolve the whole network so held keys can
    // propagate that low level into columns and other rows.
    const pins = this.#keyboard.resolve(this.#pia0.driveA() & ~buttons, this.#pia0.driveB());
    const selected = this.#pia0.cb2High() ? left : right;
    const high = selected.comparatorHigh(this.#pia0.ca2High(), this.#pia1.pinsA());
    return { a: (pins.a & 0x7f) | (high ? 0x80 : 0), b: pins.b };
  }

  #updateInputPins(): void {
    const { a, b } = this.#inputPins();
    this.#pia0.setPortInputs(a, b);
  }
}
