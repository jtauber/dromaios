import type { MemoryConnection } from "../memory/connection.ts";
import { checkUnsigned } from "../validation.ts";

export interface ByteOutputSnapshot {
  /** Null before the first write or after device reset. */
  readonly lastByte: number | null;
}

/** A write-only byte register. The host owns the output stream; snapshots only retain the last byte. */
export class ByteOutput implements MemoryConnection {
  readonly #onWrite: (value: number) => void;
  #lastByte: number | null;

  constructor(onWrite: (value: number) => void, initialState: ByteOutputSnapshot = { lastByte: null }) {
    if (typeof onWrite !== "function") throw new TypeError("Byte output requires a write callback.");
    const { lastByte } = initialState;
    if (lastByte !== null) checkUnsigned("Output byte", lastByte, 0xff);
    this.#lastByte = lastByte;
    this.#onWrite = onWrite;
  }

  get size(): number { return 1; }

  snapshot(): ByteOutputSnapshot { return { lastByte: this.#lastByte }; }

  reset(): void { this.#lastByte = null; }

  read(address: number): "bus-error" {
    checkUnsigned("Output address", address, 0);
    return "bus-error";
  }

  write(address: number, value: number): void {
    checkUnsigned("Output address", address, 0);
    checkUnsigned("Output byte", value, 0xff);
    // Commit before notification so observers see the new value, even if a host callback throws.
    this.#lastByte = value;
    this.#onWrite(value);
  }
}
