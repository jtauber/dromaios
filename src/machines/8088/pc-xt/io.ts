import { I8259a } from "../../../components/devices/generated/i8259a.ts";
import type { I8259aSnapshot } from "../../../components/devices/generated/i8259a.ts";
import { I8255a } from "../../../components/devices/generated/i8255a.ts";
import type { I8255aSnapshot } from "../../../components/devices/generated/i8255a.ts";
import { IbmXtKeyboard } from "../../../components/devices/generated/ibm-xt-keyboard.ts";
import type { IbmXtKeyboardSnapshot } from "../../../components/devices/generated/ibm-xt-keyboard.ts";
import type { MemoryConnection } from "../../../components/memory/connection.ts";
import { checkUnsigned } from "../../../components/validation.ts";

export interface XtIoSnapshot {
  readonly pic: I8259aSnapshot;
  readonly ppi: I8255aSnapshot;
  readonly keyboard: IbmXtKeyboardSnapshot;
  readonly equipmentSwitches: number;
  readonly timer2: boolean;
}

/** XT board connections at canonical ports 20/21 and 60–63; no clock or BIOS services. */
export class XtIo implements MemoryConnection {
  readonly #pic: I8259a;
  readonly #ppi: I8255a;
  readonly #keyboard: IbmXtKeyboard;
  #equipmentSwitches: number;
  #timer2: boolean;

  constructor(state?: XtIoSnapshot) {
    if (state !== undefined && (!state.pic || !state.ppi || !state.keyboard)) {
      throw new TypeError("XT I/O state requires the PIC, PPI, and keyboard.");
    }
    this.#pic = new I8259a(state?.pic);
    this.#ppi = new I8255a(state?.ppi);
    this.#keyboard = new IbmXtKeyboard(state?.keyboard);
    // 256 KiB planar RAM, no 8087, 80-column colour, one drive, no POST loop.
    this.#equipmentSwitches = state === undefined ? 0x2d : state.equipmentSwitches;
    this.#timer2 = state === undefined ? false : state.timer2;
    checkUnsigned("XT equipment switches", this.#equipmentSwitches, 0xff);
    if (typeof this.#timer2 !== "boolean") throw new TypeError("Timer 2 output must be Boolean.");
    if (state !== undefined) {
      const pins = this.#ppi.driveB();
      if (state.keyboard.clock_high !== Boolean(pins & 0x40) || state.keyboard.clear !== Boolean(pins & 0x80)
        || state.ppi.input_a !== this.#keyboard.data() || state.ppi.input_b !== 0xff
        || state.ppi.input_c !== this.#portCInputs() || Boolean(state.pic.levels & 2) !== this.#keyboard.irq()) {
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

  snapshot(): XtIoSnapshot {
    return { pic: this.#pic.snapshot(), ppi: this.#ppi.snapshot(), keyboard: this.#keyboard.snapshot(),
      equipmentSwitches: this.#equipmentSwitches, timer2: this.#timer2 };
  }

  read(address: 0x20 | 0x21 | 0x60 | 0x61 | 0x62): number;
  read(address: number): number | "bus-error";
  read(address: number): number | "bus-error" {
    checkUnsigned("XT I/O offset", address, 0xff);
    if (address === 0x20 || address === 0x21) return this.#pic.read(address - 0x20);
    if (address >= 0x60 && address <= 0x63) return this.#ppi.read(address - 0x60);
    return "bus-error";
  }

  write(address: number, value: number): void | "bus-error" {
    checkUnsigned("XT I/O offset", address, 0xff);
    checkUnsigned("XT I/O byte", value, 0xff);
    if (address === 0x20 || address === 0x21) this.#pic.write(address - 0x20, value);
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
    if (line === 1) throw new RangeError("IRQ1 belongs to the XT keyboard receiver.");
    this.#pic.setLine(line, high);
  }

  setEquipmentSwitches(value: number): void {
    checkUnsigned("XT equipment switches", value, 0xff);
    this.#equipmentSwitches = value;
    this.#updateWiring();
  }

  setTimer2Output(high: boolean): void {
    if (typeof high !== "boolean") throw new TypeError("Timer 2 output must be Boolean.");
    this.#timer2 = high;
    this.#updateWiring();
  }

  /** Explicit device time for the reset-pulse detector; this does not advance a CPU or PIT. */
  advanceMicroseconds(elapsed: number): void {
    this.#keyboard.advanceMicroseconds(elapsed);
    this.#updateWiring();
  }

  reset(): void {
    this.#pic.reset(); this.#ppi.reset(); this.#keyboard.reset();
    this.#updateWiring();
  }

  #portCInputs(): number {
    const switches = this.#ppi.driveB() & 8 ? this.#equipmentSwitches >>> 4 : this.#equipmentSwitches & 0xf;
    // PC4 is spare (modelled low); parity and channel-check errors remain deasserted.
    return switches | (this.#timer2 ? 0x20 : 0);
  }

  #updateWiring(): void {
    const pins = this.#ppi.driveB();
    this.#keyboard.setControl(Boolean(pins & 0x40), Boolean(pins & 0x80));
    this.#ppi.setPortInputs(this.#keyboard.data(), 0xff, this.#portCInputs());
    this.#pic.setLine(1, this.#keyboard.irq());
  }
}
