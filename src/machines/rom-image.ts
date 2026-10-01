import { Rom } from "../components/memory/rom.ts";

const verified = Symbol("verified ROM image");

export interface RomIdentity {
  readonly size: number;
  readonly sha256: string;
}

/** Host hashing completes before synchronous machine construction; verified bytes stay private. */
export class RomImage {
  readonly #bytes: Uint8Array;
  readonly #sha256: string;

  private constructor(bytes: Uint8Array, sha256: string, proof: typeof verified) {
    // Preserve the factory-only contract for JavaScript callers as well as TypeScript.
    if (proof !== verified) throw new TypeError("Use RomImage.verify to construct a verified image.");
    this.#bytes = bytes;
    this.#sha256 = sha256;
  }

  static async verify(bytes: Uint8Array, expected: RomIdentity,
    digest: (bytes: Uint8Array) => Promise<string>): Promise<RomImage> {
    const { size, sha256 } = expected;
    if (!Number.isSafeInteger(size) || size <= 0 || !/^[\da-f]{64}$/.test(sha256)) {
      throw new TypeError("ROM identity requires a positive size and lowercase SHA-256 digest.");
    }
    if (!(bytes instanceof Uint8Array) || bytes.length !== size) throw new RangeError(`ROM requires ${size} bytes.`);
    // Copy before yielding: changing the supplied file must not change the verified image.
    const owned = new Uint8Array(bytes);
    if (await digest(new Uint8Array(owned)) !== sha256) throw new Error("ROM image does not match the declared SHA-256 digest.");
    return new RomImage(owned, sha256, verified);
  }

  createRom(expected: RomIdentity): Rom {
    if (this.#bytes.length !== expected.size || this.#sha256 !== expected.sha256) {
      throw new Error("Verified ROM does not match this machine's declared image.");
    }
    return new Rom(this.#bytes);
  }
}

/** Restore wiring only when the supplied firmware and saved firmware identity agree. */
export function romFromImage(image: RomImage, expected: RomIdentity, restoredHash?: string): Rom {
  if (!(image instanceof RomImage)) throw new TypeError("Supply a verified ROM image.");
  if (restoredHash !== undefined && restoredHash !== expected.sha256) throw new Error("Snapshot ROM identity does not match this machine.");
  return image.createRom(expected);
}
