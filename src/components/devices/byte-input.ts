import type { MemoryConnection } from "../memory/connection.ts";
import { checkUnsigned } from "../validation.ts";

export interface ByteInputSnapshot {
  /** Null when empty; zero is a pending byte, not an empty latch. */
  readonly pendingByte: number | null;
}

/** A one-byte input latch: register 0 reports readiness; register 1 consumes data. */
export class ByteInput implements MemoryConnection {
  #pendingByte: number | null;

  constructor(initialState: ByteInputSnapshot = { pendingByte: null }) {
    const { pendingByte } = initialState;
    if (pendingByte !== null) checkUnsigned("Input byte", pendingByte, 0xff);
    this.#pendingByte = pendingByte;
  }

  get size(): number { return 2; }

  snapshot(): ByteInputSnapshot { return { pendingByte: this.#pendingByte }; }

  reset(): void { this.#pendingByte = null; }

  /** Accept one host byte if empty. The host retains responsibility for a rejected byte. */
  offer(value: number): boolean {
    checkUnsigned("Input byte", value, 0xff);
    if (this.#pendingByte !== null) return false;
    this.#pendingByte = value;
    return true;
  }

  read(address: number): number {
    checkUnsigned("Input address", address, 1);
    if (address === 0) return this.#pendingByte === null ? 0 : 1;
    // Empty data reads return zero; readiness distinguishes them from a pending zero byte.
    const value = this.#pendingByte ?? 0;
    this.#pendingByte = null;
    return value;
  }

  write(address: number, value: number): "bus-error" {
    checkUnsigned("Input address", address, 1);
    checkUnsigned("Input byte", value, 0xff);
    return "bus-error";
  }
}
