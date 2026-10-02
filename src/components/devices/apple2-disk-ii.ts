import type { MemoryConnection } from "../memory/connection.ts";
import { checkUnsigned } from "../validation.ts";
import { Dos33Disk } from "./dos33-disk.ts";

export interface DiskIIState {
  readonly halfTrack: number;
  readonly phase: number;
  readonly position: number;
  readonly motor: boolean;
  readonly drive: number;
  readonly q6: boolean;
  readonly q7: boolean;
  readonly latch: number;
}
export interface DiskIISnapshot extends DiskIIState {
  readonly bootstrap: readonly number[] | null;
  readonly media: readonly number[] | null;
}

// Adjacent energized phases move a half track; opposite phases use the reference's convention.
const phaseDelta = [[0, 1, 2, -1], [-1, 0, 1, 2], [-2, -1, 0, 1], [1, -2, -1, 0]] as const;
const powerOn = { halfTrack: 0, phase: 0, position: 0, motor: false, drive: 1, q6: false, q7: false, latch: 0 };

/** Read-only Disk II profile. The Apple II machine chapter owns wiring and accuracy limits. */
export class Apple2DiskII implements MemoryConnection {
  #state: { -readonly [K in keyof DiskIIState]: DiskIIState[K] };
  #bootstrap: readonly number[] | null = null;
  #media: Dos33Disk | null = null;

  constructor(initialState?: DiskIISnapshot) {
    this.#state = { ...powerOn };
    if (initialState === undefined) return;
    const { bootstrap, media, ...state } = initialState;
    if (Object.keys(state).length !== Object.keys(powerOn).length) throw new TypeError("Invalid Disk II snapshot fields.");
    for (const [field, maximum] of [["halfTrack", 68], ["phase", 3], ["position", Number.MAX_SAFE_INTEGER], ["drive", 2], ["latch", 255]] as const) {
      checkUnsigned(`Disk II ${field}`, state[field], maximum);
    }
    if (state.drive === 0) throw new RangeError("Disk II drive is 1 or 2.");
    for (const field of ["motor", "q6", "q7"] as const) if (typeof state[field] !== "boolean") throw new TypeError(`Disk II ${field} must be Boolean.`);
    if (bootstrap !== null) this.install(bootstrap);
    if (media !== null) this.insert(new Dos33Disk(media));
    const length = this.#media?.trackLength(Math.floor(state.halfTrack / 2)) ?? 1;
    if (state.position >= length) throw new RangeError("Invalid disk position.");
    this.#state = { ...state };
  }

  /** Local 00–0F: switches; 100–1FF: card ROM. The machine maps each window separately. */
  get size(): number { return 0x200; }
  snapshot(): DiskIISnapshot { return { ...this.#state, bootstrap: this.#bootstrap, media: this.#media?.snapshot() ?? null }; }
  inspect(): DiskIIState & { readonly installed: boolean; readonly loaded: boolean } {
    return { ...this.#state, installed: this.#bootstrap !== null, loaded: this.#media !== null };
  }

  /** CPU reset does not power-cycle the controller or rewind the disk. */
  reset(): void {}

  install(bytes: Uint8Array | readonly number[]): void {
    if ((!Array.isArray(bytes) && !(bytes instanceof Uint8Array)) || bytes.length !== 256) throw new RangeError("Disk II bootstrap requires 256 bytes.");
    for (const byte of bytes) checkUnsigned("Disk II ROM byte", byte, 255);
    this.#bootstrap = Object.freeze(Array.from(bytes));
  }

  insert(media: Dos33Disk): void {
    if (!(media instanceof Dos33Disk)) throw new TypeError("Supply a DOS-order disk image.");
    this.#media = media;
    this.#state.position = 0;
    this.#state.latch = 0;
  }

  eject(): void { this.#media = null; this.#state.position = 0; this.#state.latch = 0; }

  read(address: number): number | "bus-error" {
    checkUnsigned("Disk II address", address, this.size - 1);
    if (address >= 0x100) return this.#bootstrap?.[address - 0x100] ?? "bus-error";
    if (address >= 16 || this.#bootstrap === null) return "bus-error";
    this.#switch(address);
    if (address & 1) return 0; // Odd addresses do not drive the data bus.
    if (this.#state.q7) return this.#state.latch;
    if (this.#state.q6) return 0x80; // This profile always has write protection.
    if (address === 0xc) this.#readByte();
    return this.#state.latch;
  }

  write(address: number, value: number): void | "bus-error" {
    checkUnsigned("Disk II address", address, this.size - 1);
    checkUnsigned("Disk II byte", value, 255);
    if (address >= 16 || this.#bootstrap === null) return "bus-error";
    this.#switch(address);
    if (this.#state.q6 && this.#state.q7) this.#state.latch = value;
    // The protected medium never changes, including when guest code enters write mode.
  }

  #switch(address: number): void {
    const state = this.#state;
    if (address < 8) {
      if ((address & 1) && state.motor && state.drive === 1) {
        const phase = address >> 1;
        state.halfTrack = Math.max(0, Math.min(68, state.halfTrack + phaseDelta[state.phase]![phase]!));
        state.phase = phase;
      }
      return;
    }
    switch (address) {
      case 8: state.motor = false; state.latch = 0; break;
      case 9: state.motor = true; break;
      case 10: state.drive = 1; state.latch = 0; break;
      case 11: state.drive = 2; state.latch = 0; break;
      case 12: state.q6 = false; break;
      case 13: state.q6 = true; break;
      case 14: state.q7 = false; break;
      case 15: state.q7 = true; break;
    }
  }

  #readByte(): void {
    const state = this.#state;
    if (!state.motor || state.drive !== 1 || !this.#media) { state.latch = 0; return; }
    const track = Math.floor(state.halfTrack / 2);
    state.latch = this.#media.read(track, state.position);
    state.position = (state.position + 1) % this.#media.trackLength(track);
  }
}
