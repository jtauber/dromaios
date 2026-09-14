import assert from "node:assert/strict";
import { test } from "node:test";
import { signed8, readWordLE, readWordBE } from "../../../src/components/cpus/binary.js";

test("signed8 agrees with native signed-byte interpretation for all 256 inputs", () => {
  const view = new DataView(new ArrayBuffer(1));
  for (let byte = 0; byte < 256; byte++) {
    view.setUint8(0, byte);
    assert.equal(signed8(byte), view.getInt8(0));
  }
});

for (const [name, readWord, littleEndian] of [
  ["readWordLE", readWordLE, true],
  ["readWordBE", readWordBE, false],
] as const) {
  test(`${name} matches native unsigned-word decoding for every byte pair and consumes exactly two bytes`, () => {
    const view = new DataView(new ArrayBuffer(2));
    for (let first = 0; first < 256; first++) {
      for (let second = 0; second < 256; second++) {
        view.setUint8(0, first);
        view.setUint8(1, second);
        let position = 0;
        const actual = readWord(() => view.getUint8(position++));
        assert.equal(actual, view.getUint16(0, littleEndian));
        assert.equal(position, 2);
      }
    }
  });

  test(`${name} leaves cursor ownership and live byte reads with the callback`, () => {
    const bytes = [0x12, 0x34, 0, 0, 0xee];
    let position = 0;
    const nextByte = () => bytes[position++]!;
    assert.equal(readWord(nextByte), littleEndian ? 0x3412 : 0x1234);
    bytes[2] = 0xab;
    bytes[3] = 0xcd;
    assert.equal(readWord(nextByte), littleEndian ? 0xcdab : 0xabcd);
    assert.equal(position, 4);
    assert.equal(nextByte(), 0xee);
    assert.deepEqual(bytes, [0x12, 0x34, 0xab, 0xcd, 0xee]);
  });

  test(`${name} propagates either callback failure without retrying or reading ahead`, () => {
    for (const failOn of [1, 2]) {
      const failure = new Error("Byte unavailable");
      let calls = 0;
      assert.throws(() => readWord(() => {
        calls++;
        if (calls === failOn) throw failure;
        return 0x12;
      }), error => error === failure);
      assert.equal(calls, failOn);
    }
  });
}
