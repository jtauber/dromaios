import { CocoDiskCircuit } from "../../../components/devices/generated/coco-disk.ts";
import type { CocoDiskCircuitSnapshot } from "../../../components/devices/generated/coco-disk.ts";
import type { ByteMemoryConnection } from "../../../components/memory/connection.ts";
import { checkUnsigned } from "../../../components/validation.ts";
import { checkMachineSnapshot } from "../../snapshot.ts";

export const cocoDiskSize = 35 * 18 * 256;
const ownedImages = new WeakSet<readonly number[]>();
// CPU E = 3,579,545 / 4 Hz. Retain fractional microseconds without cumulative rounding.
const microsecondDenominator = 3_579_545;

function ownImage(bytes: Uint8Array | readonly number[]): readonly number[] {
  if (Array.isArray(bytes) && ownedImages.has(bytes)) return bytes;
  if ((!Array.isArray(bytes) && !(bytes instanceof Uint8Array)) || bytes.length !== cocoDiskSize) {
    throw new RangeError("CoCo disk requires a headerless 35-track, single-sided 161,280-byte image.");
  }
  const image = Object.freeze(Array.from({ length: bytes.length }, (_, i) => {
    const byte = bytes[i]!; checkUnsigned("CoCo disk byte", byte, 255); return byte;
  }));
  ownedImages.add(image);
  return image;
}

export interface CocoDiskSnapshot {
  readonly circuit: CocoDiskCircuitSnapshot;
  readonly image: readonly number[] | null;
  readonly microsecondPhase: number;
  readonly haltDeferred: boolean;
}

/** FD-502 bus wiring and owned media; register/command behavior belongs to the chapter. */
export class CocoDiskController implements ByteMemoryConnection {
  readonly #circuit: CocoDiskCircuit;
  #image: readonly number[] | null;
  #edited?: number[];
  #microsecondPhase: number;
  #haltDeferred: boolean;

  constructor(state?: CocoDiskSnapshot) {
    if (state !== undefined) checkMachineSnapshot(state, ["circuit", "image", "microsecondPhase", "haltDeferred"]);
    this.#circuit = new CocoDiskCircuit(state?.circuit);
    this.#image = state?.image == null ? null : ownImage(state.image);
    this.#microsecondPhase = state === undefined ? 0 : state.microsecondPhase;
    this.#haltDeferred = state === undefined ? false : state.haltDeferred;
    if (typeof this.#haltDeferred !== "boolean") throw new TypeError("Invalid CoCo disk HALT sample.");
    checkUnsigned("CoCo disk clock fraction", this.#microsecondPhase, microsecondDenominator - 1);
    if (this.#circuit.snapshot().media !== (this.#image !== null)) throw new RangeError("CoCo disk state requires its mounted image.");
  }

  get size(): number { return 0x20; }
  get halted(): boolean { return this.#circuit.halted() && !this.#haltDeferred; }
  inspect(): CocoDiskCircuitSnapshot { return this.#circuit.snapshot(); }
  snapshot(): CocoDiskSnapshot {
    if (this.#edited) {
      this.#image = Object.freeze(this.#edited); ownedImages.add(this.#image); this.#edited = undefined;
    }
    return { circuit: this.#circuit.snapshot(), image: this.#image, microsecondPhase: this.#microsecondPhase, haltDeferred: this.#haltDeferred };
  }
  reset(): void { this.#circuit.reset(); this.#haltDeferred = false; }

  /** A last-cycle bus access asserts HALT too late to stop before the following instruction. */
  cpuBoundary<T>(execute: () => T): T {
    const before = this.#circuit.halted();
    this.#haltDeferred = false;
    try { return execute(); }
    finally { this.#haltDeferred = !before && this.#circuit.halted(); }
  }

  mount(bytes: Uint8Array | readonly number[] | null, { writable = false } = {}): void {
    if (this.#circuit.status() & 1) throw new Error("Finish or abort the disk command before changing media.");
    if (typeof writable !== "boolean" || bytes === null && writable) throw new TypeError("Write permission requires a mounted disk and a Boolean value.");
    const image = bytes === null ? null : ownImage(bytes);
    this.#image = image; this.#edited = undefined; this.#circuit.setMedia(image !== null, writable);
  }

  writableCopy(): void {
    if (this.#circuit.status() & 1) throw new Error("Finish or abort the disk command before changing write permission.");
    if (this.#image === null) throw new Error("Mount a disk before making a writable copy.");
    this.#circuit.setMedia(true, true);
  }

  /** Detached raw sectors, including bytes already written by an unfinished command. */
  exportImage(): Uint8Array<ArrayBuffer> {
    if (this.#image === null) throw new Error("Drive 0 is empty.");
    return Uint8Array.from(this.#edited ?? this.#image);
  }

  read(address: number): number {
    checkUnsigned("CoCo disk address", address, this.size - 1);
    if (address < 8 || address > 11) return 0xff;
    return this.#circuit.read(address - 8);
  }

  write(address: number, value: number): void {
    checkUnsigned("CoCo disk address", address, this.size - 1);
    checkUnsigned("CoCo disk byte", value, 255);
    if (address < 8) {
      if ((this.#circuit.status() & 1) && ((this.#circuit.snapshot().control ^ value) & 0x7f)) {
        throw new RangeError("Changing CoCo drive wiring during an active command is outside this profile.");
      }
      this.#circuit.setControl(value);
    } else if (address <= 11) this.#circuit.write(address - 8, value);
  }

  /** Consume one assertion edge, rather than repeatedly offering the NMI level. */
  takeNmi(): boolean {
    const pending = this.#circuit.nmiPending();
    if (pending) this.#circuit.consumeNmi();
    return pending;
  }

  clocksUntilEvent(): number {
    const remaining = this.#circuit.remainingMicroseconds();
    return remaining ? Math.ceil((remaining * microsecondDenominator - this.#microsecondPhase) / 4_000_000) : Infinity;
  }

  /** Retire every crossed byte/seek deadline, including unread bytes, independently of CPU polling. */
  advanceCpuClocks(clocks: number): void {
    checkUnsigned("CoCo disk elapsed CPU clocks", clocks, 0xffffff);
    const numerator = clocks * 4_000_000 + this.#microsecondPhase;
    let remaining = Math.floor(numerator / microsecondDenominator);
    this.#microsecondPhase = numerator % microsecondDenominator;
    while (remaining > 0) {
      const deadline = this.#circuit.remainingMicroseconds();
      if (!deadline) break;
      const elapsed = Math.min(remaining, deadline);
      this.#circuit.elapse(elapsed); remaining -= elapsed;
      if (elapsed === deadline) {
        const byte = this.#circuit.needsByte() ? (this.#edited ?? this.#image)![this.#circuit.mediaOffset()]! : 0;
        if (this.#circuit.writesByte()) {
          // Preserve held snapshots; only the first later write copies the shared image.
          const image = this.#edited ??= this.#image!.slice();
          image[this.#circuit.mediaOffset()] = this.#circuit.writeByte();
        }
        this.#circuit.event(byte);
      }
    }
  }
}
