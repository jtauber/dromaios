import type { MemoryConnection } from "../../../components/memory/connection.ts";
import { checkUnsigned } from "../../../components/validation.ts";
import { checkMachineSnapshot } from "../../snapshot.ts";

export interface CocoCartridgeSnapshot {
  readonly name: string | null;
  readonly image: readonly number[] | null;
}

const ownedImages = new WeakSet<readonly number[]>();

/** A plain ROM Program Pak. The machine chapter owns socket selection and CART wiring. */
export class CocoCartridge implements MemoryConnection {
  readonly #state: CocoCartridgeSnapshot;

  constructor(state: CocoCartridgeSnapshot = { name: null, image: null }) {
    checkMachineSnapshot(state, ["name", "image"]);
    if (state.image === null) {
      if (state.name !== null) throw new Error("An empty cartridge slot cannot have a name.");
      this.#state = { name: null, image: null };
      return;
    }
    if (typeof state.name !== "string" || !state.name.trim() || state.name.length > 255) throw new Error("Invalid cartridge name.");
    const bytes = state.image;
    if (!Array.isArray(bytes) || ![0x800, 0x1000, 0x2000, 0x4000].includes(bytes.length)) {
      throw new RangeError("Choose a raw 2, 4, 8, or 16 KiB ROM cartridge (.ccc or .rom).");
    }
    const image = ownedImages.has(bytes) ? bytes : Object.freeze(Array.from({ length: bytes.length }, (_, i) => {
      const byte = bytes[i]!; checkUnsigned("Cartridge byte", byte, 255); return byte;
    }));
    ownedImages.add(image);
    this.#state = { name: state.name, image };
  }

  get size(): number { return 0x4000; }
  inserted(): boolean { return this.#state.image !== null; }
  empty(): boolean { return !this.inserted(); }
  snapshot(): CocoCartridgeSnapshot { return { ...this.#state }; }
  read(address: number): number | "bus-error" {
    checkUnsigned("Cartridge address", address, this.size - 1);
    const image = this.#state.image;
    return image === null ? "bus-error" : image[address & (image.length - 1)]!;
  }
  write(address: number, value: number): void {
    checkUnsigned("Cartridge address", address, this.size - 1);
    checkUnsigned("Cartridge byte", value, 255);
  }
}
