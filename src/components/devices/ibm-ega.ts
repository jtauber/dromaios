import { checkUnsigned } from "../validation.ts";

const planeSize = 0x10000;
// EGA dot clocks in Hz. The system board supplies the first, the adapter supplies the second.
const xtClock = 14_318_180, enhancedClock = 16_257_000;
// Colour Plane Enable bits 5:4 select the output wires sampled by Input Status 1.
const diagnosticPins = [[0, 2], [1, 3], [4, 5], [6, 6]] as const;

export interface IbmEgaSnapshot {
  readonly misc: number;
  readonly seqIndex: number;
  readonly gcIndex: number;
  readonly crtIndex: number;
  readonly attrIndex: number;
  readonly attrData: boolean;
  readonly phase: number;
  readonly field: number;
  readonly seq: readonly number[];
  readonly gc: readonly number[];
  readonly crt: readonly number[];
  readonly attr: readonly number[];
  readonly latch: readonly number[];
  readonly planes: readonly number[];
}

/** A 256 KiB EGA. Indexed registers and the CPU aperture are separate ISA address spaces. */
export class IbmEga {
  readonly size = 0x20000;
  readonly #seq = new Uint8Array(5);
  readonly #gc = new Uint8Array(9);
  readonly #crt = new Uint8Array(25);
  readonly #attr = new Uint8Array(20);
  readonly #latch = new Uint8Array(4);
  readonly #planes = new Uint8Array(4 * planeSize);
  #misc = 0;
  #seqIndex = 0;
  #gcIndex = 0;
  #crtIndex = 0;
  #attrIndex = 0;
  #attrData = false;
  #phase = 0;
  #field = 0;
  #lineTicks = 18;
  #frameTicks = 36;

  constructor(state?: IbmEgaSnapshot) {
    if (state === undefined) return;
    for (const [name, array] of [["seq", this.#seq], ["gc", this.#gc], ["crt", this.#crt],
      ["attr", this.#attr], ["latch", this.#latch], ["planes", this.#planes]] as const) {
      const bytes = state[name];
      if (!Array.isArray(bytes) || bytes.length !== array.length) throw new RangeError(`Invalid EGA ${name} length.`);
      for (const byte of bytes) checkUnsigned("EGA byte", byte, 255);
      array.set(bytes);
    }
    checkUnsigned("EGA miscellaneous output", state.misc, 255);
    checkUnsigned("EGA sequencer index", state.seqIndex, 7);
    checkUnsigned("EGA graphics index", state.gcIndex, 15);
    checkUnsigned("EGA CRTC index", state.crtIndex, 31);
    checkUnsigned("EGA attribute index", state.attrIndex, 63);
    if (typeof state.attrData !== "boolean") throw new TypeError("Invalid EGA attribute flip-flop.");
    this.#misc = state.misc; this.#seqIndex = state.seqIndex; this.#gcIndex = state.gcIndex;
    this.#crtIndex = state.crtIndex; this.#attrIndex = state.attrIndex; this.#attrData = state.attrData;
    this.#setTiming();
    checkUnsigned("EGA raster phase", state.phase, this.#frameTicks - 1);
    checkUnsigned("EGA field", state.field, 63);
    this.#phase = state.phase; this.#field = state.field;
  }

  reset(): void {
    this.#misc = this.#seqIndex = this.#gcIndex = this.#crtIndex = this.#attrIndex = this.#phase = 0;
    this.#attrData = false; this.#field = 0;
    for (const registers of [this.#seq, this.#gc, this.#crt, this.#attr, this.#latch]) registers.fill(0);
    this.#setTiming();
  }

  snapshot(): IbmEgaSnapshot {
    return { misc: this.#misc, seqIndex: this.#seqIndex, gcIndex: this.#gcIndex, crtIndex: this.#crtIndex,
      attrIndex: this.#attrIndex, attrData: this.#attrData, phase: this.#phase, field: this.#field, seq: Array.from(this.#seq),
      gc: Array.from(this.#gc), crt: Array.from(this.#crt), attr: Array.from(this.#attr),
      latch: Array.from(this.#latch), planes: Array.from(this.#planes) };
  }

  #setTiming(): void {
    const dotClock = this.#misc & 4 ? enhancedClock : xtClock;
    const dots = (this.#crt[0]! + 2) * this.cellWidth * (this.#seq[1]! & 8 ? 2 : 1);
    this.#lineTicks = Math.round(dots * xtClock / dotClock);
    const lines = (this.#crt[6]! | ((this.#crt[7]! & 1) << 8)) + 2;
    this.#frameTicks = lines * this.#lineTicks;
    this.#phase %= this.#frameTicks;
  }

  advanceOscillatorTicks(ticks: number): void {
    checkUnsigned("EGA oscillator ticks", ticks, 0xffff_ffff);
    this.#phase += ticks;
    if (this.#phase >= this.#frameTicks) {
      this.#field = (this.#field + Math.floor(this.#phase / this.#frameTicks)) & 63;
      this.#phase %= this.#frameTicks;
    }
  }

  #retrace(line: number): boolean {
    const start = this.#crt[0x10]! | ((this.#crt[7]! & 4) << 6);
    return line >= start && line - start < ((this.#crt[0x11]! - start) & 15);
  }

  get #crtPort(): number { return this.#misc & 1 ? 0x3d4 : 0x3b4; }
  readPort(port: number): number {
    if (port === 0x3c2) {
      // On the switch block OFF is open (one). Clock Select multiplexes SW1 through SW4.
      const sense = (0b1001 >> ((this.#misc >> 2) & 3)) & 1;
      return (sense << 4) | (this.#retrace(Math.floor(this.#phase / this.#lineTicks)) ? 0 : 0x80);
    }
    if (port === this.#crtPort + 6) {
      this.#attrData = false;
      const line = Math.floor(this.#phase / this.#lineTicks);
      const dot = Math.floor((this.#phase % this.#lineTicks) * (this.#crt[0]! + 2) * this.cellWidth / this.#lineTicks);
      const active = line < this.displayLines && dot < this.columns * this.cellWidth;
      const colour = active ? this.pixel(dot, line) : 0;
      const [low, high] = diagnosticPins[(this.#attr[0x12]! >> 4) & 3]!;
      return 4 | (active ? 0 : 1) | (this.#retrace(line) ? 8 : 0)
        | (((colour >> low) & 1) << 4) | (((colour >> high) & 1) << 5);
    }
    if (port === this.#crtPort + 1 && [0x0c, 0x0d, 0x0e, 0x0f].includes(this.#crtIndex)) return this.#crt[this.#crtIndex]!;
    return 0xff;
  }

  writePort(port: number, value: number): void {
    checkUnsigned("EGA port byte", value, 255);
    if (port === this.#crtPort) this.#crtIndex = value & 31;
    else if (port === this.#crtPort + 1) { this.#crt[this.#crtIndex] = value; this.#setTiming(); }
    else switch (port) {
      // The IBM ROM also writes index/data as a pair at 3C0/3C1. Both strobe the flip-flop.
      case 0x3c0: case 0x3c1:
        if (this.#attrData) this.#attr[this.#attrIndex & 31] = value;
        else this.#attrIndex = value & 63;
        this.#attrData = !this.#attrData;
        break;
      case 0x3c2: this.#misc = value; this.#setTiming(); break;
      case 0x3c4: this.#seqIndex = value & 7; break;
      case 0x3c5: this.#seq[this.#seqIndex] = value; this.#setTiming(); break;
      case 0x3ce: this.#gcIndex = value & 15; break;
      case 0x3cf: this.#gc[this.#gcIndex] = value; break;
    }
  }

  /** Decode A0000–BFFFF against the graphics controller's memory-map select. */
  #offset(address: number): number {
    checkUnsigned("EGA aperture address", address, this.size - 1);
    if (!(this.#misc & 2)) return -1;
    switch ((this.#gc[6]! >> 2) & 3) {
      case 0: return address;
      case 1: return address < 0x10000 ? address : -1;
      case 2: return address >= 0x10000 && address < 0x18000 ? address - 0x10000 : -1;
      default: return address >= 0x18000 ? address - 0x18000 : -1;
    }
  }

  #read(address: number, loadLatch: boolean): number {
    const offset = this.#offset(address);
    if (offset < 0) return 0xff;
    const paired = Boolean(this.#gc[5]! & 0x10);
    const cell = (paired ? offset >>> 1 : offset) & 0xffff;
    const plane = paired ? (this.#gc[4]! & 2) | (offset & 1) : this.#gc[4]! & 3;
    let match = 0xff;
    for (let p = 0; p < 4; p++) {
      const byte = this.#planes[p * planeSize + cell]!;
      if (loadLatch) this.#latch[p] = byte;
      if (this.#gc[7]! & (1 << p)) match &= this.#gc[2]! & (1 << p) ? byte : ~byte;
    }
    return this.#gc[5]! & 8 ? match : this.#planes[plane * planeSize + cell]!;
  }

  read(address: number): number { return this.#read(address, true); }
  peek(address: number): number { return this.#read(address, false); }

  write(address: number, value: number): void {
    checkUnsigned("EGA memory byte", value, 255);
    const offset = this.#offset(address);
    if (offset < 0) return;
    const paired = !(this.#seq[4]! & 4);
    const cell = (paired ? offset >>> 1 : offset) & 0xffff;
    const planes = this.#seq[2]! & (paired ? (offset & 1 ? 0xa : 0x5) : 0xf);
    const mode = this.#gc[5]! & 3, rotate = this.#gc[3]! & 7, mask = this.#gc[8]!;
    for (let p = 0; p < 4; p++) {
      const bit = 1 << p;
      if (!(planes & bit) || mode === 3) continue;
      const latch = this.#latch[p]!;
      let data = latch;
      if (mode !== 1) {
        if (mode === 2) data = value & bit ? 0xff : 0;
        else if (this.#gc[1]! & bit) data = this.#gc[0]! & bit ? 0xff : 0;
        else data = (value >>> rotate) | (value << (8 - rotate));
        switch ((this.#gc[3]! >> 3) & 3) {
          case 1: data &= latch; break;
          case 2: data |= latch; break;
          case 3: data ^= latch; break;
        }
        data = (data & mask) | (latch & ~mask);
      }
      this.#planes[p * planeSize + cell] = data;
    }
  }

  get textEnabled(): boolean { return Boolean(this.#attrIndex & 32) && !(this.#attr[0x10]! & 1) && !(this.#seq[1]! & 0x20); }
  get columns(): number { return this.#crt[1]! + 1; }
  get cellHeight(): number { return (this.#crt[9]! & 31) + 1; }
  get cellWidth(): number { return this.#seq[1]! & 1 ? 8 : 9; }
  get displayLines(): number { return (this.#crt[0x12]! | ((this.#crt[7]! & 2) << 7)) + 1; }
  get rows(): number { return Math.floor(this.displayLines / this.cellHeight); }

  #cell(row: number, column: number): number {
    const start = (this.#crt[0x0c]! << 8) | this.#crt[0x0d]!;
    return (start + row * this.#crt[0x13]! * 2 + column) & 0xffff;
  }

  character(row: number, column: number): number { return this.#planes[this.#cell(row, column)]!; }
  attribute(row: number, column: number): number { return this.#planes[planeSize + this.#cell(row, column)]!; }

  glyph(character: number, attribute: number, line: number): number {
    const font = (this.#seq[3]! >> (attribute & 8 ? 2 : 0)) & 3;
    return this.#planes[2 * planeSize + font * 0x4000 + character * 32 + line]!;
  }
  get repeatNinthDot(): boolean { return Boolean(this.#attr[0x10]! & 4); }
  colour(index: number): number { return this.#attr[index & 15]! & 63; }
  get blinkEnabled(): boolean { return Boolean(this.#attr[0x10]! & 8); }

  /** Six colour pins at an active raster position, also sampled by the POST diagnostic multiplexer. */
  pixel(x: number, y: number): number {
    const cell = this.#cell(Math.floor(y / this.cellHeight), Math.floor(x / this.cellWidth));
    const ch = this.#planes[cell]!, attr = this.#planes[planeSize + cell]!;
    const line = y % this.cellHeight, dot = x % this.cellWidth;
    const glyph = this.glyph(ch, attr, line);
    const ink = dot < 8 ? glyph & (0x80 >> dot) : this.repeatNinthDot && ch >= 0xc0 && ch <= 0xdf && (glyph & 1);
    const blink = this.blinkEnabled && (attr & 0x80) && (this.#field & 16);
    const cursor = cell === ((this.#crt[14]! << 8) | this.#crt[15]!) && !(this.#crt[10]! & 32)
      && line >= (this.#crt[10]! & 31) && line <= (this.#crt[11]! & 31) && !(this.#field & 16);
    const index = cursor || (ink && !blink) ? attr & 15 : (attr >> 4) & (this.blinkEnabled ? 7 : 15);
    return this.colour(index & this.#attr[0x12]!);
  }
}
