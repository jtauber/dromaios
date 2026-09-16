import { checkUnsigned } from "../validation.ts";
import type { MemoryConnection } from "./connection.ts";

export interface MemoryRegion {
  readonly start: number;
  /** The whole connection is mapped, starting at its local address zero. */
  readonly memory: MemoryConnection;
}

/** Fixed, non-overlapping byte regions. Holes report bus errors; host arguments never wrap. */
export class MemoryMap implements MemoryConnection {
  readonly #size: number;
  readonly #regions: readonly (MemoryRegion & { readonly end: number })[];

  constructor(size: number, regions: readonly MemoryRegion[]) {
    checkUnsigned("Memory map size", size, Number.MAX_SAFE_INTEGER);
    if (size === 0) throw new RangeError("Memory map size must be positive.");
    this.#size = size;
    this.#regions = Array.from(regions, ({ start, memory }) => {
      checkUnsigned("Region start", start, size - 1);
      const length = memory.size;
      checkUnsigned("Region size", length, size - start);
      if (length === 0) throw new RangeError("Memory regions must contain at least one byte.");
      return { start, end: start + length, memory };
    }).sort((left, right) => left.start - right.start);
    for (let index = 1; index < this.#regions.length; index++) {
      if (this.#regions[index]!.start < this.#regions[index - 1]!.end) {
        throw new RangeError("Memory regions must not overlap.");
      }
    }
  }

  get size(): number { return this.#size; }

  read(address: number): number | "bus-error" {
    const region = this.#region(address);
    return region ? region.memory.read(address - region.start) : "bus-error";
  }

  write(address: number, value: number): void | "bus-error" {
    const region = this.#region(address);
    checkUnsigned("Memory byte", value, 0xff);
    return region ? region.memory.write(address - region.start, value) : "bus-error";
  }

  #region(address: number): MemoryRegion | undefined {
    checkUnsigned("Memory address", address, this.size - 1);
    return this.#regions.find(region => address >= region.start && address < region.end);
  }
}
