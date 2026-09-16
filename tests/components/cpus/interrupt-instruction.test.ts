import assert from "node:assert/strict";
import { test } from "node:test";
import { recordInterruptInstruction } from "../../../src/components/cpus/interrupt-instruction.ts";
import type { InterruptAcknowledge } from "../../../src/components/cpus/interrupt-instruction.ts";

test("supplied-instruction recording is lazy, reads current bytes once, and owns each record", () => {
  const accesses: InterruptAcknowledge[] = [];
  let value = 0, calls = 0;
  const source = () => { calls++; return value; };
  const first = recordInterruptInstruction(source, access => { accesses.push(access); });
  assert.equal(calls, 0);
  for (value = 0; value < 256; value++) assert.equal(first.fetchByte(), value);
  assert.equal(calls, 256);
  const bytes = Array.from({ length: 256 }, (_, index) => index);
  assert.deepEqual(first.instruction, { source: "interrupt", bytes });
  assert.deepEqual(accesses, bytes.map(value => ({ kind: "acknowledge", value })));
  value = 0xa5;
  const second = recordInterruptInstruction(source, () => {});
  second.fetchByte();
  assert.deepEqual(second.instruction, { source: "interrupt", bytes: [0xa5] });
  assert.deepEqual(first.instruction.bytes, bytes);
});

test("failed supplied-byte reads neither record nor notify, and later reads remain usable", () => {
  const accesses: InterruptAcknowledge[] = [];
  const error = new Error("device failed");
  let value = 0x46, fail = false, calls = 0;
  const record = recordInterruptInstruction(() => {
    calls++;
    if (fail) throw error;
    return value;
  }, access => { accesses.push(access); });
  record.fetchByte();
  fail = true;
  assert.throws(record.fetchByte, caught => caught === error);
  fail = false;
  for (value of [-1, 256, 0.5, NaN, Infinity]) assert.throws(record.fetchByte, /Interrupt instruction byte/);
  assert.equal(calls, 7);
  assert.deepEqual(record.instruction.bytes, [0x46]);
  assert.deepEqual(accesses, [{ kind: "acknowledge", value: 0x46 }]);
  value = 0x34;
  record.fetchByte();
  assert.deepEqual(record.instruction.bytes, [0x46, 0x34]);
});
