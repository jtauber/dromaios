import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { create8088PcXtEga } from "../../../../src/machines/generated/8088/pc-xt-ega.js";
import { stepTimedXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";
import { inspectFat12, readFat12File } from "../../../../site/interactive/fat12.js";
import { matchesXtDosObservation } from "../../../../site/interactive/xt-dos-observation.js";
import { parseXtDebugAddress } from "../../../../site/interactive/xt-debugger.js";
import { ultimaSteps } from "../../../helpers/ultima-v-guide.js";
import { dosTransfer } from "./dos-transfer.js";
import { runInput } from "./rom-console.js";

const tileOffset = 0x95 * 128;
const tileAddress = 0x8ca30 + tileOffset;
const rowSix = tileOffset + 5 * 8;

/** Read the title's LSB-first LZW stream independently of the guest decoder. */
function unpackTiles(file: Uint8Array) {
  assert.equal(new DataView(file.buffer, file.byteOffset).getUint32(0, true), 65_536);
  const pixels = new Uint8Array(65_536);
  const literals = Array.from({ length: 256 }, (_, i) => [i]);
  let phrases: number[][] = [], previous: number[] | undefined;
  let bit = 32, width = 9, next = 0x102, written = 0;
  let firstBit = -1, endBit = -1;
  for (;;) {
    assert.ok(bit + width <= file.length * 8, "Truncated TILES.16 code");
    const start = bit;
    let code = 0;
    for (let i = 0; i < width; i++, bit++) code |= ((file[bit >> 3]! >> (bit & 7)) & 1) << i;
    if (code === 0x100) {
      phrases = literals.slice(); previous = undefined; next = 0x102; width = 9;
      continue;
    }
    if (code === 0x101) break;
    const phrase = code === next && previous ? [...previous, previous[0]!] : phrases[code];
    assert.ok(phrase, "Undefined TILES.16 phrase");
    pixels.set(phrase, written);
    if (written < rowSix + 4 && written + phrase.length > rowSix) {
      if (firstBit < 0) firstBit = start;
      endBit = bit;
    }
    written += phrase.length;
    if (previous && next < 4096) {
      phrases[next++] = [...previous, phrase[0]!];
      if (next === 1 << width && width < 12) width++;
    }
    previous = phrase;
  }
  assert.equal(written, pixels.length);
  const offset = Math.floor(firstBit / 8);
  return { packed: pixels.slice(tileOffset, tileOffset + 128), source: { offset, length: Math.ceil(endBit / 8) - offset } };
}

/** Four packed bytes become four plane bytes, with the leftmost dot at bit 7. */
function tilePlanes(packed: Uint8Array): Uint8Array {
  return Uint8Array.from(packed, (_, i) => {
    const group = i & ~3, plane = i & 3;
    let bits = 0;
    for (let dot = 0; dot < 8; dot++) {
      const pair = packed[group + (dot >> 1)]!;
      const colour = dot % 2 === 0 ? pair >> 4 : pair & 15;
      bits = (bits << 1) | ((colour >> plane) & 1);
    }
    return bits;
  });
}

/** Start at the game's open of TILES.16; leave it just after converting tile $95. */
export function traceTableTile(m: ReturnType<typeof create8088PcXtEga>): void {
  const step = ultimaSteps("ultima-v-ega-hut").find(step => step.title === "Prepare table tile")!;
  const { expect } = step;
  assert.ok("bytes" in expect);
  const disk = m.io.exportDiskette(), volume = inspectFat12(disk);
  const file = readFat12File(disk, volume, volume.entries.find(entry => entry.name === step.file)!);
  assert.equal(createHash("sha256").update(file).digest("hex"), "bc5d33bdb92a9f054cabf95fc34293d65b181e23eabf041a08edf88027ea4f83");
  const { packed, source } = unpackTiles(file);
  assert.deepEqual(step.fileRange, source);
  const operand = Number.parseInt(step.memory!, 16);
  let offset = 0;
  while (offset < file.length) {
    const { bytes } = dosTransfer(m, [], "read");
    assert.ok(bytes.length, "Premature end of TILES.16");
    assert.deepEqual(bytes, file.subarray(offset, offset + bytes.length));
    if (offset <= source.offset && source.offset < offset + bytes.length) {
      // The decoder emits the second packed byte with STOSB, using ES:DI = 914D:0009.
      runInput(m, [], { until: (_, { before, instruction, accesses }) => {
        if (before.cs !== 0x0c6f || before.ip !== 0x1528 || before.es !== 0x914d || before.di !== 9) return false;
        assert.deepEqual(instruction?.bytes, [0xaa]);
        assert.deepEqual(accesses.at(-1), { kind: "write", address: operand, value: 0x46 });
        return true;
      } });
    }
    offset += bytes.length;
  }
  const readTile = () => Uint8Array.from({ length: 128 }, (_, i) => m.ram.read(tileAddress + i));
  assert.deepEqual(readTile(), packed);
  const planes = tilePlanes(packed);
  assert.deepEqual([...planes.subarray(40, 44)], [0x04, 0xdf, 0xff, 0x00]);
  const pc = parseXtDebugAddress(step.execution).address;
  runInput(m, [], { limit: 2_000_000, until: (_, { after }) => after.pc === pc && matchesXtDosObservation(expect, m, after) });
  const store = stepTimedXtCpu(m).record;
  assert.deepEqual([store.before.cs, store.before.ip, store.instruction?.bytes], [0x9d27, 0x1852, [0x88, 0x14]]);
  assert.deepEqual(store.accesses.at(-1), { kind: "write", address: operand, value: 0xdf });
  runInput(m, [], { until: (_, { before }) => before.cs === 0x9d27 && before.ip === 0x18e2 && before.si === tileOffset + 127 });
  assert.deepEqual(readTile(), planes);
}
