import assert from "node:assert/strict";
import { test } from "node:test";
import { CocoKeyboard } from "../../../../src/machines/6809/coco/keyboard.js";
import { CocoPias } from "../../../../src/machines/6809/coco/pias.js";

// Independent column transcription: each position gives PA0 upward, selected by one PB bit.
const columns = [
  ["@", "H", "P", "X", "0", "8", "Enter"],
  ["A", "I", "Q", "Y", "1", "9", "Clear"],
  ["B", "J", "R", "Z", "2", ":", "Break"],
  ["C", "K", "S", "ArrowUp", "3", ";"],
  ["D", "L", "T", "ArrowDown", "4", ","],
  ["E", "M", "U", "ArrowLeft", "5", "-"],
  ["F", "N", "V", "ArrowRight", "6", "."],
  ["G", "O", "W", "Space", "7", "/", "Shift"],
] as const;

test("all 52 CoCo keys select the expected row through every column and PIA alias", () => {
  const io = new CocoPias();
  io.write(2, 0xff); io.write(1, 0x34); io.write(3, 0x34);
  let count = 0;
  columns.forEach((keys, column) => keys.forEach((key, row) => {
    count++; io.setKey(key, true);
    for (let scan = 0; scan < 8; scan++) {
      io.write(scan * 4 + 2, 0xff ^ (1 << scan));
      for (let alias = 0; alias < 8; alias++) {
        assert.equal(io.read(alias * 4), column === scan ? 0xff ^ (1 << row) : 0xff, key);
        assert.equal(io.read(alias * 4 + 1), 0x34);
        assert.equal(io.read(alias * 4 + 3), 0x34);
      }
    }
    io.setKey(key, false); assert.equal(io.read(0), 0xff);
  }));
  assert.equal(count, 52);
});

test("input-configured PB pins do not select every key; direction and latch changes both rescan", () => {
  const io = new CocoPias(); io.setKey("A", true); io.write(1, 4);
  assert.equal(io.read(0), 0xff);
  io.write(3, 4); io.write(2, 0xfd); // Retain selection while PB still input.
  assert.equal(io.read(0), 0xff);
  io.write(3, 0); io.write(2, 0xff);
  assert.equal(io.read(0), 0xfe);
  io.write(3, 4); io.write(2, 0xff); assert.equal(io.read(0), 0xff);
  io.write(2, 0xfd); assert.equal(io.read(0), 0xfe);
  io.setKey("A", true); assert.equal(io.read(0), 0xfe); // Host repeat is idempotent.
  io.releaseKeys(); assert.equal(io.read(0), 0xff);
});

test("Shift and editing keys are switches, including simultaneous keys and ghost paths", () => {
  const keyboard = new CocoKeyboard();
  keyboard.setKey("Shift", true); keyboard.setKey(";", true);
  assert.deepEqual(keyboard.resolve(0xff, 0x77), { a: 0x9f, b: 0x77 }); // Shift + ; is BASIC's +.
  keyboard.releaseAll(); keyboard.setKey("ArrowLeft", true);
  assert.deepEqual(keyboard.resolve(0xff, 0xdf), { a: 0xf7, b: 0xdf });
  keyboard.releaseAll(); keyboard.setKey("A", true); keyboard.setKey("@", true); keyboard.setKey("H", true);
  // PB1 -> A -> PA0 -> @ -> PB0 -> H -> PA1, although I is not pressed.
  assert.deepEqual(keyboard.resolve(0xff, 0xfd), { a: 0xfc, b: 0xfc });
  keyboard.releaseAll(); keyboard.setKey("A", true);
  assert.deepEqual(keyboard.resolve(0xfe, 0xff), { a: 0xfe, b: 0xfd }); // Reverse scan.
});

test("CoCo keyboard snapshots are detached and reject invalid or unpopulated switches", () => {
  const keyboard = new CocoKeyboard(); keyboard.setKey("Break", true);
  const saved = keyboard.snapshot(), restored = new CocoKeyboard(saved);
  keyboard.releaseAll(); assert.equal(restored.resolve(0xff, 0xfb).a, 0xbf);
  (saved.rows as number[])[6] = 0;
  assert.equal(restored.resolve(0xff, 0xfb).a, 0xbf);
  for (const rows of [[], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 8], [0, 0, 0, 0, 0, 0, 256]]) {
    assert.throws(() => new CocoKeyboard({ rows }), RangeError);
  }
  const before = restored.snapshot();
  assert.throws(() => restored.setKey("unknown" as never, true), RangeError);
  assert.throws(() => restored.setKey("A", 1 as never), TypeError);
  assert.throws(() => restored.resolve(256, 0), RangeError);
  assert.throws(() => restored.resolve(0, -1), RangeError);
  assert.deepEqual(restored.snapshot(), before);
});
