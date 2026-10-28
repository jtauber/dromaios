import { checkUnsigned } from "../../../components/validation.ts";

// Rows are PA0–PA6; columns are PB0–PB7. These are CoCo keys, not host key codes.
const rows = [
  ["@", "A", "B", "C", "D", "E", "F", "G"],
  ["H", "I", "J", "K", "L", "M", "N", "O"],
  ["P", "Q", "R", "S", "T", "U", "V", "W"],
  ["X", "Y", "Z", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"],
  ["0", "1", "2", "3", "4", "5", "6", "7"],
  ["8", "9", ":", ";", ",", "-", ".", "/"],
  ["Enter", "Clear", "Break", null, null, null, null, "Shift"],
] as const;

export type CocoKey = NonNullable<typeof rows[number][number]>;
export interface CocoKeyboardSnapshot { readonly rows: readonly number[]; }
const positions = new Map<string, readonly [number, number]>();
rows.forEach((keys, row) => keys.forEach((key, column) => {
  if (key !== null) positions.set(key, [row, column]);
}));

/** Switch closures in the CoCo matrix; character translation belongs to the host. */
export class CocoKeyboard {
  readonly #rows: number[];

  constructor(state: CocoKeyboardSnapshot = { rows: [0, 0, 0, 0, 0, 0, 0] }) {
    if (!Array.isArray(state.rows) || state.rows.length !== 7) throw new RangeError("Expected seven keyboard rows.");
    this.#rows = Array.from(state.rows, value => {
      checkUnsigned("Keyboard row", value, 0xff); return value;
    });
    if (this.#rows[6]! & 0x78) throw new RangeError("Unpopulated keyboard switches cannot be pressed.");
  }

  snapshot(): CocoKeyboardSnapshot { return { rows: [...this.#rows] }; }

  setKey(key: CocoKey, pressed: boolean): void {
    const position = positions.get(key);
    if (!position) throw new RangeError(`Unknown CoCo key: ${key}`);
    if (typeof pressed !== "boolean") throw new TypeError("Key state must be Boolean.");
    const [row, column] = position, bit = 1 << column;
    this.#rows[row] = pressed ? this.#rows[row]! | bit : this.#rows[row]! & ~bit;
  }

  releaseAll(): void { this.#rows.fill(0); }

  /** Resolve the switch network, including low propagation through multiple held keys. */
  resolve(driveA: number, driveB: number): { readonly a: number; readonly b: number } {
    checkUnsigned("Port A drive", driveA, 0xff);
    checkUnsigned("Port B drive", driveB, 0xff);
    let lowRows = ~driveA & 0x7f, lowColumns = ~driveB & 0xff;
    for (;;) {
      const beforeRows = lowRows, beforeColumns = lowColumns;
      for (let row = 0; row < 7; row++) {
        const switches = this.#rows[row]!;
        if (switches & lowColumns) lowRows |= 1 << row;
        if (lowRows & (1 << row)) lowColumns |= switches;
      }
      if (beforeRows === lowRows && beforeColumns === lowColumns) break;
    }
    // PA7 is not a matrix row: the first profile holds the joystick comparator high.
    return { a: ~lowRows & 0xff, b: ~lowColumns & 0xff };
  }
}
