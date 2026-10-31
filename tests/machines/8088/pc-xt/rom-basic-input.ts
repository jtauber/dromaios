import assert from "node:assert/strict";
import type { create8088PcXt } from "../../../../src/machines/generated/8088/pc-xt.js";
import { stepTimedXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";

type Machine = ReturnType<typeof create8088PcXt>;

export function screen(machine: Machine): string[] {
  // BASIC also prints character FF, the blank nonbreaking-space glyph in the CGA ROM.
  return Array.from({ length: 25 }, (_, row) => String.fromCharCode(...Array.from({ length: 80 }, (_, column) =>
    machine.video.read((row * 80 + column) * 2)).map(code => code === 0xff ? 0x20 : code)).trimEnd());
}

export function waitingForKey(machine: Machine): boolean {
  // Original INT 16h/AH=00 blocking loop, with its BIOS circular buffer empty.
  return machine.cpu.snapshot().pc === 0xfe842
    && machine.ram.read(0x41a) === machine.ram.read(0x41c)
    && machine.ram.read(0x41b) === machine.ram.read(0x41d);
}

// Only the keys in these acceptance programs, in physical order on IBM's 83-key keyboard.
const makeCode = new Map([[" ", 0x39], ["\n", 0x1c], ["\b", 0x0e]]);
for (const [first, row] of [[0x02, "1234567890-="], [0x10, "QWERTYUIOP"],
  [0x1e, "ASDFGHJKL"], [0x2c, "ZXCVBNM"]] as const) {
  [...row].forEach((key, index) => makeCode.set(key, first + index));
}

export function scanCodes(text: string): number[] {
  return [...text].flatMap(key => {
    const make = makeCode.get(key === "+" ? "=" : key);
    assert.notEqual(make, undefined, `No XT test key for ${JSON.stringify(key)}`);
    const press = [make!, make! | 0x80];
    return key === "+" || /[A-Z]/.test(key) ? [0x2a, ...press, 0xaa] : press;
  });
}

interface RunOptions {
  readonly batchSize?: number;
  readonly limit?: number;
  readonly until?: (boundaries: number) => boolean;
}

/** Offer only completed bytes; an inhibited or full receiver leaves the next byte with the host. */
export function runInput(machine: Machine, bytes: readonly number[], options: RunOptions = {}) {
  const { batchSize = 4096, limit = 200_000, until = () => waitingForKey(machine) } = options;
  let offset = 0, boundaries = 0, keyboardInterrupts = 0;
  while (boundaries < limit) {
    const end = Math.min(boundaries + batchSize, limit);
    while (boundaries < end) {
      if (offset < bytes.length && machine.io.offerScanCode(bytes[offset]!)) offset++;
      const { record } = stepTimedXtCpu(machine); boundaries++;
      if (record.outcome === "accepted" && record.vector === 9) keyboardInterrupts++;
      if (record.outcome !== "executed" && record.outcome !== "accepted") {
        assert.fail(`Firmware ${record.outcome} at ${record.before.pc.toString(16)}`);
      }
      if (offset === bytes.length && !machine.io.keyboardPending && until(boundaries)) return { boundaries, keyboardInterrupts };
    }
  }
  assert.fail(`ROM BASIC exceeded ${limit} boundaries at ${machine.cpu.snapshot().pc.toString(16)}: ${screen(machine).join("\n")}`);
}

export function enterLine(machine: Machine, text: string) {
  const keys = scanCodes(text + "\n");
  assert.equal(runInput(machine, keys).keyboardInterrupts, keys.length);
}

export function expectLastRows(machine: Machine, ...expected: string[]): void {
  const rows = screen(machine).slice(0, 24); // Row 25 contains BASIC's function-key legend.
  while (rows.at(-1) === "") rows.pop();
  assert.deepEqual(rows.slice(-expected.length), expected);
}
