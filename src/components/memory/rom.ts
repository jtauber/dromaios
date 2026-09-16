import { checkUnsigned } from "../validation.ts";
import type { MemoryConnection } from "./connection.ts";

/** An owned, immutable byte image. Valid writes report a bus error without changing it. */
export class Rom implements MemoryConnection {
  readonly #bytes: Uint8Array;

  constructor(bytes: readonly number[] | Uint8Array) {
    if (bytes.length === 0) throw new RangeError("ROM must contain at least one byte.");
    this.#bytes = Uint8Array.from(bytes, value => {
      checkUnsigned("ROM byte", value, 0xff);
      return value;
    });
  }

  get size(): number { return this.#bytes.length; }

  read(address: number): number {
    checkUnsigned("ROM address", address, this.size - 1);
    return this.#bytes[address]!;
  }

  write(address: number, value: number): "bus-error" {
    checkUnsigned("ROM address", address, this.size - 1);
    checkUnsigned("ROM byte", value, 0xff);
    return "bus-error";
  }
}
