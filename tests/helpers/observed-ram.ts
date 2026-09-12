import { Ram } from "../../src/components/memory/ram.js";

interface RamAccess {
  readonly kind: "read" | "write";
  readonly address: number;
  readonly value: number;
}

// Observe real RAM calls independently of the CPU's own records.
export class ObservedRam extends Ram {
  readonly accesses: RamAccess[] = [];

  constructor(size = 0x10000) {
    super(size);
  }

  override read(address: number): number {
    const value = super.read(address);
    this.accesses.push({ kind: "read", address, value });
    return value;
  }

  override write(address: number, value: number): void {
    super.write(address, value);
    this.accesses.push({ kind: "write", address, value });
  }
}
