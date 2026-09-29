import assert from "node:assert/strict";
import { test } from "node:test";
import { interpretAscii, asciiCharacterByte } from "../../site/interactive/ascii.js";

test("ASCII graphic characters follow the standard code table, including punctuation and case", () => {
  // Explicit table rows, independent of the implementation's character conversion.
  const rows = [
    [0x21, '!"#$%&\'()*+,-./'],
    [0x30, "0123456789:;<=>?"],
    [0x40, "@ABCDEFGHIJKLMNO"],
    [0x50, "PQRSTUVWXYZ[\\]^_"],
    [0x60, "`abcdefghijklmno"],
    [0x70, "pqrstuvwxyz{|}~"],
  ] as const;
  for (const [start, characters] of rows) {
    for (const [offset, character] of [...characters].entries()) {
      assert.deepEqual(interpretAscii(start + offset), { kind: "graphic", character });
    }
  }
});

test("space, all control codes, and Delete remain identifiable without becoming printed text", () => {
  const abbreviations = "NUL SOH STX ETX EOT ENQ ACK BEL BS HT LF VT FF CR SO SI DLE DC1 DC2 DC3 DC4 NAK SYN ETB CAN EM SUB ESC FS GS RS US".split(" ");
  for (const [value, abbreviation] of abbreviations.entries()) {
    const result = interpretAscii(value);
    assert.equal(result.kind, "control");
    if (result.kind !== "control") throw new Error("Expected a control code");
    assert.equal(result.abbreviation, abbreviation);
    assert.ok(result.name.length > 0);
  }
  assert.deepEqual(interpretAscii(0), { kind: "control", abbreviation: "NUL", name: "Null" });
  assert.deepEqual(interpretAscii(10), { kind: "control", abbreviation: "LF", name: "Line feed" });
  assert.deepEqual(interpretAscii(32), { kind: "space" });
  assert.deepEqual(interpretAscii(48), { kind: "graphic", character: "0" });
  assert.deepEqual(interpretAscii(127), { kind: "delete" });
});

test("the upper half of the byte range has no ASCII mapping and is never truncated to seven bits", () => {
  for (let value = 128; value <= 255; value++) assert.deepEqual(interpretAscii(value), { kind: "outside" });
  for (const invalid of [-1, 256, 0.5, NaN, Infinity, -Infinity]) assert.throws(() => interpretAscii(invalid), RangeError);
});


test("character input accepts exactly one printable ASCII character without trimming or discarding pasted text", () => {
  for (let value = 0; value <= 255; value++) {
    assert.equal(asciiCharacterByte(String.fromCharCode(value)), value >= 32 && value <= 126 ? value : undefined);
  }
  for (const text of ["", "AB", " A", "A ", "  ", "é", "😀", "e\u0301"]) assert.equal(asciiCharacterByte(text), undefined);
  assert.equal(asciiCharacterByte("0"), 48);
  assert.equal(asciiCharacterByte(" "), 32);
});
