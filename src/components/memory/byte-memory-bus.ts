import { checkUnsigned } from "../validation.ts";
import type { ByteMemoryConnection, MemoryConnection } from "./connection.ts";

/** Resolve unanswered transfers on a byte bus: fixed undriven data, discarded writes. */
export class ByteMemoryBus implements ByteMemoryConnection {
  readonly #connection: MemoryConnection;
  readonly #undriven: number;

  constructor(connection: MemoryConnection, undriven: number) {
    checkUnsigned("Undriven memory byte", undriven, 0xff);
    this.#connection = connection;
    this.#undriven = undriven;
  }

  get size(): number { return this.#connection.size; }

  read(address: number): number {
    const value = this.#connection.read(address);
    return value === "bus-error" ? this.#undriven : value;
  }

  write(address: number, value: number): void { this.#connection.write(address, value); }
}
