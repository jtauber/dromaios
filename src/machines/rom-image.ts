import { Rom } from "../components/memory/rom.ts";
import type { MemoryConnection } from "../components/memory/connection.ts";
import { checkUnsigned } from "../components/validation.ts";

const verified = Symbol("verified ROM image");

export interface RomIdentity {
  readonly size: number;
  readonly sha256: string;
}

function checkIdentity({ size, sha256 }: RomIdentity): void {
  if (!Number.isSafeInteger(size) || size <= 0 || !/^[\da-f]{64}$/.test(sha256)) {
    throw new TypeError("ROM identity requires a positive size and lowercase SHA-256 digest.");
  }
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
    checkIdentity(expected);
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

/** A fixed ROM connection, initially empty or supplied with the declared verified image. */
export class ExternalRom implements MemoryConnection {
  readonly #identity: RomIdentity;
  #rom: Rom | undefined;

  constructor(expected: RomIdentity, image: RomImage | null, restoredHash?: string | null) {
    checkIdentity(expected);
    this.#identity = { ...expected };
    if (image !== null) this.install(image);
    if (restoredHash !== undefined && restoredHash !== this.snapshot()) {
      throw new Error("Snapshot ROM identity does not match the supplied image.");
    }
  }

  get size(): number { return this.#identity.size; }
  get loaded(): boolean { return this.#rom !== undefined; }
  snapshot(): string | null { return this.loaded ? this.#identity.sha256 : null; }

  /** Validate before replacement; installation leaves the rest of the machine untouched. */
  install(image: RomImage): void { this.#rom = romFromImage(image, this.#identity); }

  read(address: number): number | "bus-error" {
    checkUnsigned("ROM address", address, this.size - 1);
    return this.#rom?.read(address) ?? "bus-error";
  }

  write(address: number, value: number): "bus-error" {
    checkUnsigned("ROM address", address, this.size - 1);
    checkUnsigned("ROM byte", value, 0xff);
    return "bus-error";
  }
}
