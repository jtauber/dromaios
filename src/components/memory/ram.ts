/** A completed store, in this RAM's local address space. */
export interface RamWrite {
  readonly address: number;
  readonly before: number;
  readonly after: number;
}

/** Zero-filled byte-addressable RAM. Invalid host arguments throw RangeError. */
export class Ram {
  readonly #bytes: Uint8Array;
  readonly #observers = new Set<(write: RamWrite) => void>();

  constructor(size: number) {
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new RangeError("RAM size must be a positive safe integer.");
    }
    this.#bytes = new Uint8Array(size);
  }

  get size(): number {
    return this.#bytes.length;
  }

  read(address: number): number {
    this.#checkAddress(address);
    // The bounds check guarantees this byte exists.
    return this.#bytes[address]!;
  }

  write(address: number, value: number): void {
    this.#checkAddress(address);
    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      throw new RangeError("RAM byte value must be an integer from 0 to 255.");
    }
    const before = this.#bytes[address]!;
    this.#bytes[address] = value;
    if (this.#observers.size) {
      const write = { address, before, after: value };
      for (const observer of this.#observers) observer(write);
    }
  }

  /** Observe stores without another bus read. Host observers must not throw or modify RAM. */
  observeWrites(observer: (write: RamWrite) => void): () => void {
    this.#observers.add(observer);
    return () => { this.#observers.delete(observer); };
  }

  #checkAddress(address: number): void {
    if (!Number.isInteger(address) || address < 0 || address >= this.size) {
      throw new RangeError(`RAM address must be an integer from 0 to ${this.size - 1}.`);
    }
  }
}
