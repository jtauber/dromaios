import { I8259a } from "../../../components/devices/generated/i8259a.ts";
import type { I8259aSnapshot } from "../../../components/devices/generated/i8259a.ts";
import { I8255a } from "../../../components/devices/generated/i8255a.ts";
import type { I8255aSnapshot } from "../../../components/devices/generated/i8255a.ts";
import { IbmXtKeyboard } from "../../../components/devices/generated/ibm-xt-keyboard.ts";
import type { IbmXtKeyboardSnapshot } from "../../../components/devices/generated/ibm-xt-keyboard.ts";
import { I8253 } from "../../../components/devices/i8253.ts";
import type { I8253Snapshot } from "../../../components/devices/i8253.ts";
import { XtClock } from "./clock.ts";
import type { XtClockSnapshot } from "./clock.ts";
import type { MemoryConnection } from "../../../components/memory/connection.ts";
import { checkUnsigned } from "../../../components/validation.ts";

export interface XtIoSnapshot {
  readonly pic: I8259aSnapshot;
  readonly ppi: I8255aSnapshot;
  readonly keyboard: IbmXtKeyboardSnapshot;
  readonly equipmentSwitches: number;
  readonly pit: I8253Snapshot;
  readonly clock: XtClockSnapshot;
}

/** XT PIC, PIT, PPI, and keyboard wiring, driven by explicit oscillator intervals. */
export class XtIo implements MemoryConnection {
  readonly #pic: I8259a;
  readonly #ppi: I8255a;
  readonly #keyboard: IbmXtKeyboard;
  #equipmentSwitches: number;
  readonly #pit: I8253;
  readonly #clock: XtClock;

  constructor(state?: XtIoSnapshot) {
    if (state !== undefined && (!state.pic || !state.ppi || !state.keyboard || !state.pit || !state.clock)) {
      throw new TypeError("XT I/O state requires the PIC, PIT, PPI, keyboard, and clock.");
    }
    this.#pic = new I8259a(state?.pic);
    this.#ppi = new I8255a(state?.ppi);
    this.#keyboard = new IbmXtKeyboard(state?.keyboard);
    // 256 KiB planar RAM, no 8087, 80-column colour, one drive, no POST loop.
    this.#equipmentSwitches = state === undefined ? 0x2d : state.equipmentSwitches;
    this.#pit = new I8253(state?.pit);
    this.#clock = new XtClock(state?.clock);
    checkUnsigned("XT equipment switches", this.#equipmentSwitches, 0xff);
    if (state !== undefined) {
      const pins = this.#ppi.driveB();
      if (state.keyboard.clock_high !== Boolean(pins & 0x40) || state.keyboard.clear !== Boolean(pins & 0x80)
        || state.ppi.input_a !== this.#keyboard.data() || state.ppi.input_b !== 0xff
        || state.ppi.input_c !== this.#portCInputs() || Boolean(state.pic.levels & 2) !== this.#keyboard.irq()
        || Boolean(state.pic.levels & 1) !== this.#pit.output(0)
        || !state.pit.channels[0].gate || !state.pit.channels[1].gate
        || state.pit.channels[2].gate !== Boolean(pins & 1)) {
        throw new RangeError("Stored device inputs do not match the XT wiring.");
      }
    }
    this.#updateWiring();
  }

  get size(): number { return 0x100; }
  get irq(): boolean { return this.#pic.irq(); }
  get keyboardPending(): boolean { return this.#keyboard.irq(); }
  get keyboardData(): number { return this.#keyboard.data(); }
  get timer2Gate(): boolean { return Boolean(this.#ppi.driveB() & 1); }
  get speakerData(): boolean { return Boolean(this.#ppi.driveB() & 2); }
  get speakerLevel(): boolean { return this.speakerData && this.#pit.output(2); }
  get refreshOutput(): boolean { return this.#pit.output(1); }

  snapshot(): XtIoSnapshot {
    return { pic: this.#pic.snapshot(), ppi: this.#ppi.snapshot(), keyboard: this.#keyboard.snapshot(),
      equipmentSwitches: this.#equipmentSwitches, pit: this.#pit.snapshot(), clock: this.#clock.snapshot() };
  }

  read(address: 0x20 | 0x21 | 0x40 | 0x41 | 0x42 | 0x60 | 0x61 | 0x62): number;
  read(address: number): number | "bus-error";
  read(address: number): number | "bus-error" {
    checkUnsigned("XT I/O offset", address, 0xff);
    if (address === 0x20 || address === 0x21) return this.#pic.read(address - 0x20);
    if (address >= 0x40 && address <= 0x43) return this.#pit.read(address - 0x40);
    if (address >= 0x60 && address <= 0x63) return this.#ppi.read(address - 0x60);
    return "bus-error";
  }

  write(address: number, value: number): void | "bus-error" {
    checkUnsigned("XT I/O offset", address, 0xff);
    checkUnsigned("XT I/O byte", value, 0xff);
    if (address === 0x20 || address === 0x21) this.#pic.write(address - 0x20, value);
    else if (address >= 0x40 && address <= 0x43) this.#pit.write(address - 0x40, value);
    else if (address >= 0x60 && address <= 0x63) this.#ppi.write(address - 0x60, value);
    else return "bus-error";
    this.#updateWiring();
  }

  /** Called only from the CPU's accepted INTR callback. */
  acknowledge(): number {
    const vector = this.#pic.vector();
    this.#pic.acknowledge();
    return vector;
  }

  offerScanCode(byte: number): boolean {
    const accepted = this.#keyboard.offer(byte);
    this.#updateWiring();
    return accepted;
  }

  setInterruptLine(line: number, high: boolean): void {
    checkUnsigned("XT interrupt line", line, 7);
    if (line < 2) throw new RangeError("IRQ0/IRQ1 belong to the XT timer and keyboard receiver.");
    this.#pic.setLine(line, high);
  }

  setEquipmentSwitches(value: number): void {
    checkUnsigned("XT equipment switches", value, 0xff);
    this.#equipmentSwitches = value;
    this.#updateWiring();
  }

  /** Advance devices only; callers must supply time independently of untimed CPU steps. */
  advanceOscillatorTicks(ticks: number): void {
    this.#clock.advance(ticks, (microseconds, pitClock) => {
      this.#keyboard.advanceMicroseconds(microseconds);
      if (pitClock) for (let channel = 0; channel < 3; channel++) this.#pit.clock(channel);
      this.#updateWiring();
    });
  }

  reset(): void {
    this.#pit.reset(); this.#clock.reset();
    this.#pic.reset(); this.#ppi.reset(); this.#keyboard.reset();
    this.#updateWiring();
  }

  #portCInputs(): number {
    const switches = this.#ppi.driveB() & 8 ? this.#equipmentSwitches >>> 4 : this.#equipmentSwitches & 0xf;
    // PC4 is spare (modelled low); parity and channel-check errors remain deasserted.
    return switches | (this.#pit.output(2) ? 0x20 : 0);
  }

  #updateWiring(): void {
    const pins = this.#ppi.driveB();
    this.#pit.setGate(0, true); this.#pit.setGate(1, true); this.#pit.setGate(2, Boolean(pins & 1));
    this.#keyboard.setControl(Boolean(pins & 0x40), Boolean(pins & 0x80));
    this.#ppi.setPortInputs(this.#keyboard.data(), 0xff, this.#portCInputs());
    this.#pic.setLine(0, this.#pit.output(0));
    this.#pic.setLine(1, this.#keyboard.irq());
  }
}
