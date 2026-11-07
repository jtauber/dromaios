import type { MemoryConnection } from "../memory/connection.ts";
import { checkUnsigned } from "../validation.ts";
import { Dos33Disk, dos33SectorSpan } from "./dos33-disk.ts";

export interface DiskIIState {
  readonly halfTrack: number;
  readonly phase: number;
  readonly position: number;
  readonly motor: boolean;
  readonly drive: number;
  readonly q6: boolean;
  readonly q7: boolean;
  readonly latch: number;
  readonly byteClocks: number;
}
export interface DiskIISnapshot extends DiskIIState {
  readonly bootstrap: readonly number[] | null;
  readonly media: readonly number[] | null;
  readonly writable?: boolean;
  readonly shifted?: readonly number[];
  readonly writeStart?: number;
}

export interface DiskIITransfer {
  readonly kind: "read" | "write"; // CPU samples a ready disk byte, or shifts the write latch; not the CPU bus direction.
  readonly halfTrack: number;
  readonly track: number;
  readonly position: number; // Encoded byte consumed by the CPU, or position of a write shift.
  readonly length: number;
  readonly value: number;
  /** Bytes rotated since the preceding ready-byte read; capped at a full track. Absent on the first read. */
  readonly distance?: number;
}

// Adjacent energized phases move a half track; opposite phases use the reference's convention.
const phaseDelta = [[0, 1, 2, -1], [-1, 0, 1, 2], [-2, -1, 0, 1], [1, -2, -1, 0]] as const;
const clocksPerByte = 32, readyClocks = 8;
const powerOn = { halfTrack: 0, phase: 0, position: 0, motor: false, drive: 1, q6: false, q7: false, latch: 0, byteClocks: 0 };

/** Clocked byte rotation, with sector-image writes. The machine chapter owns accuracy limits. */
export class Apple2DiskII implements MemoryConnection {
  #state: { -readonly [K in keyof DiskIIState]: DiskIIState[K] };
  #bootstrap: readonly number[] | null = null;
  #media: Dos33Disk | null = null;
  #shifted: number[] = [];
  #writeStart: number | undefined;
  #readDistance: number | undefined;
  readonly #observers = new Set<(transfer: DiskIITransfer) => void>();

  constructor(initialState?: DiskIISnapshot) {
    this.#state = { ...powerOn };
    if (initialState === undefined) return;
    const { bootstrap, media, writable = false, shifted = [], writeStart, ...state } = initialState;
    if (Object.keys(state).length !== Object.keys(powerOn).length) throw new TypeError("Invalid Disk II snapshot fields.");
    for (const [field, maximum] of [["halfTrack", 68], ["phase", 3], ["position", Number.MAX_SAFE_INTEGER], ["drive", 2], ["latch", 255], ["byteClocks", clocksPerByte - 1]] as const) {
      checkUnsigned(`Disk II ${field}`, state[field], maximum);
    }
    if (state.drive === 0) throw new RangeError("Disk II drive is 1 or 2.");
    for (const field of ["motor", "q6", "q7"] as const) if (typeof state[field] !== "boolean") throw new TypeError(`Disk II ${field} must be Boolean.`);
    if (bootstrap !== null) this.install(bootstrap);
    if (typeof writable !== "boolean" || (writable && media === null)) throw new TypeError("Invalid Disk II write permission.");
    if (media !== null) this.insert(new Dos33Disk(media, { writable }));
    if (!Array.isArray(shifted) || shifted.length > dos33SectorSpan
      || (shifted.length && !(writable && state.q7 && state.motor && state.drive === 1))) throw new TypeError("Invalid Disk II write stream.");
    for (const byte of shifted) checkUnsigned("Shifted disk byte", byte, 255);
    this.#shifted = [...shifted];
    const length = this.#media?.trackLength(Math.floor(state.halfTrack / 2)) ?? 1;
    if (state.position >= length) throw new RangeError("Invalid disk position.");
    if (writeStart !== undefined) checkUnsigned("Disk II write start", writeStart, length - 1);
    if (Boolean(shifted.length) !== (writeStart !== undefined)) throw new TypeError("Disk II pending write requires its starting position.");
    this.#writeStart = writeStart;
    this.#state = { ...state };
  }

  /** Local 00–0F: switches; 100–1FF: card ROM. The machine maps each window separately. */
  get size(): number { return 0x200; }
  snapshot(): DiskIISnapshot {
    return { ...this.#state, bootstrap: this.#bootstrap, media: this.#media?.snapshot() ?? null,
      ...(this.#media?.writable && { writable: true }), ...(this.#shifted.length && { shifted: [...this.#shifted], writeStart: this.#writeStart! }) };
  }
  exportImage(): Uint8Array {
    if (!this.#media) throw new Error("No disk in drive 1.");
    return this.#media.exportImage();
  }
  /** Host inspectors see committed sectors without selecting a switch or rotating the stream. */
  inspectMedium(): Pick<Dos33Disk, "snapshot" | "inspectTrack" | "observeWrites"> | null { return this.#media; }
  inspect(): DiskIIState & { readonly installed: boolean; readonly loaded: boolean; readonly writable: boolean } {
    return { ...this.#state, installed: this.#bootstrap !== null, loaded: this.#media !== null, writable: this.#media?.writable ?? false };
  }

  /** Observe CPU reads of ready bytes and write shifts, not unobserved rotation. */
  observeTransfers(observer: (transfer: DiskIITransfer) => void): () => void {
    this.#observers.add(observer);
    return () => { this.#observers.delete(observer); };
  }

  /** CPU reset does not power-cycle the controller or rewind the disk. */
  reset(): void {}

  /** One canonical disk byte passes every 32 CPU clocks, even without a CPU disk read. */
  advanceCpuClocks(clocks: number): void {
    checkUnsigned("Disk II elapsed clocks", clocks, Number.MAX_SAFE_INTEGER - (clocksPerByte - 1));
    const state = this.#state;
    if (!clocks || !state.motor || state.drive !== 1 || !this.#media) return;
    const elapsed = state.byteClocks + clocks;
    const bytes = Math.floor(elapsed / clocksPerByte);
    state.byteClocks = elapsed % clocksPerByte;
    const track = Math.floor(state.halfTrack / 2), length = this.#media.trackLength(track);
    if (this.#readDistance !== undefined) this.#readDistance = Math.min(length, this.#readDistance + bytes);
    state.position = (state.position + bytes % length) % length;
    if (!state.q7 && !state.q6) {
      if (bytes) state.latch = this.#media.read(track, (state.position + length - 1) % length);
      if (state.byteClocks >= readyClocks) state.latch = 0;
    }
  }

  install(bytes: Uint8Array | readonly number[]): void {
    if ((!Array.isArray(bytes) && !(bytes instanceof Uint8Array)) || bytes.length !== 256) throw new RangeError("Disk II bootstrap requires 256 bytes.");
    for (const byte of bytes) checkUnsigned("Disk II ROM byte", byte, 255);
    this.#bootstrap = Object.freeze(Array.from(bytes));
  }

  insert(media: Dos33Disk): void {
    if (!(media instanceof Dos33Disk)) throw new TypeError("Supply a DOS-order disk image.");
    this.#media = media;
    this.#shifted = [];
    this.#writeStart = undefined;
    this.#readDistance = undefined;
    this.#state.position = 0;
    this.#state.byteClocks = 0;
    this.#state.latch = 0;
  }

  eject(): void { this.#media = null; this.#shifted = []; this.#writeStart = undefined; this.#readDistance = undefined;
    this.#state.position = 0; this.#state.byteClocks = 0; this.#state.latch = 0; }

  read(address: number): number | "bus-error" {
    checkUnsigned("Disk II address", address, this.size - 1);
    if (address >= 0x100) return this.#bootstrap?.[address - 0x100] ?? "bus-error";
    if (address >= 16 || this.#bootstrap === null) return "bus-error";
    this.#switch(address);
    if (address & 1) return 0; // Odd addresses do not drive the data bus.
    if (this.#state.q7) return this.#state.latch;
    if (this.#state.q6) return this.#state.drive === 1 && this.#media?.writable ? 0 : 0x80;
    if (address === 0xc) return this.#readByte();
    return this.#state.latch;
  }

  write(address: number, value: number): void | "bus-error" {
    checkUnsigned("Disk II address", address, this.size - 1);
    checkUnsigned("Disk II byte", value, 255);
    if (address >= 16 || this.#bootstrap === null) return "bus-error";
    this.#switch(address);
    if (this.#state.q6 && this.#state.q7) this.#state.latch = value;
  }

  #switch(address: number): void {
    const state = this.#state;
    if (address < 8) {
      if ((address & 1) && state.motor && state.drive === 1) {
        const phase = address >> 1;
        if (phase !== state.phase) { this.#shifted = []; this.#writeStart = undefined; state.latch = 0; }
        state.halfTrack = Math.max(0, Math.min(68, state.halfTrack + phaseDelta[state.phase]![phase]!));
        state.phase = phase;
      }
      return;
    }
    switch (address) {
      case 8: state.motor = false; state.latch = 0; this.#shifted = []; this.#writeStart = undefined; break;
      case 9: state.motor = true; break;
      case 10: state.drive = 1; state.latch = 0; break;
      case 11: state.drive = 2; state.latch = 0; this.#shifted = []; this.#writeStart = undefined; break;
      case 12:
        if (state.q6 && state.q7) this.#shiftWriteLatch();
        state.q6 = false; break;
      case 13: state.q6 = true; break;
      case 14:
        if (this.#shifted.length) this.#finishWrite();
        if (state.q7) state.latch = 0;
        state.q7 = false; break;
      case 15: state.q7 = true; break;
    }
  }

  #shiftWriteLatch(): void {
    const state = this.#state;
    if (!state.motor || state.drive !== 1 || !this.#media?.writable) return;
    // The sector image accepts a complete field; write-bit timing is not modeled yet.
    if (!this.#shifted.length) this.#writeStart = state.position;
    if (this.#shifted.length < dos33SectorSpan) this.#shifted.push(state.latch);
    this.#transfer("write", state.position, state.latch);
  }

  #finishWrite(): void {
    if (this.#media && this.#shifted.length < dos33SectorSpan) {
      const track = Math.floor(this.#state.halfTrack / 2);
      this.#media.writeDataField(track, this.#writeStart!, this.#shifted);
    }
    this.#shifted = [];
    this.#writeStart = undefined;
  }

  #readByte(): number {
    const state = this.#state;
    if (!state.motor || state.drive !== 1 || !this.#media) return 0;
    const value = state.latch;
    if (value & 0x80) {
      const length = this.#media.trackLength(Math.floor(state.halfTrack / 2));
      const distance = this.#readDistance; this.#readDistance = 0;
      this.#transfer("read", (state.position + length - 1) % length, value, distance);
    }
    return value;
  }

  #transfer(kind: DiskIITransfer["kind"], position: number, value: number, distance?: number): void {
    const { halfTrack } = this.#state;
    const track = Math.floor(halfTrack / 2), length = this.#media!.trackLength(track);
    if (this.#observers.size) {
      const transfer = Object.freeze({ kind, halfTrack, track, position, length, value, ...(distance === undefined ? {} : { distance }) });
      for (const observer of this.#observers) observer(transfer);
    }
  }
}
