import { checkUnsigned } from "../../../components/validation.ts";

export const xtDisketteSize = 40 * 2 * 9 * 512;
const ownedDiskettes = new WeakSet<readonly number[]>();

function freezeImage(bytes: number[]): readonly number[] {
  ownedDiskettes.add(bytes);
  return Object.freeze(bytes);
}

/** Share immutable media between checkpoints. Only a subsequent guest write needs a private copy. */
export class XtDisketteImage {
  #saved: readonly number[];
  #edited?: number[];

  constructor(bytes: Uint8Array | readonly number[]) {
    if (Array.isArray(bytes) && ownedDiskettes.has(bytes)) {
      this.#saved = bytes;
      return;
    }
    if ((!Array.isArray(bytes) && !(bytes instanceof Uint8Array)) || bytes.length !== xtDisketteSize) {
      throw new RangeError("XT diskette requires a raw 360 KiB image.");
    }
    this.#saved = freezeImage(Array.from({ length: bytes.length }, (_, index) => {
      const byte = bytes[index]!;
      checkUnsigned("XT diskette byte", byte, 255);
      return byte;
    }));
  }

  read(offset: number): number {
    checkUnsigned("XT diskette offset", offset, xtDisketteSize - 1);
    return (this.#edited ?? this.#saved)[offset]!;
  }

  write(offset: number, byte: number, terminal: boolean): void {
    checkUnsigned("XT diskette offset", offset, xtDisketteSize - 1);
    checkUnsigned("XT diskette byte", byte, 255);
    const bytes = this.#edited ??= this.#saved.slice();
    bytes[offset] = byte;
    // Early TC ends host DMA. The controller pads the rest of this sector on disk.
    if (terminal) bytes.fill(0, offset + 1, offset - offset % 512 + 512);
  }

  snapshot(): readonly number[] {
    if (this.#edited) {
      this.#saved = freezeImage(this.#edited);
      this.#edited = undefined;
    }
    return this.#saved;
  }
}
