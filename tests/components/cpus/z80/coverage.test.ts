import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../../src/components/cpus/generated/z80-cpu.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, snapshot, cbRows, indexOpcodes, edOpcodes, indexes, readAccess, refreshTwice } from "./helpers.js";

// The 53 remaining non-I/O, non-interrupt unprefixed forms, listed independently of the decoder.
const baseAdditions = [
  0x00, 0x08, 0x09, 0x19, 0x29, 0x39, 0x02, 0x12, 0x0a, 0x1a, 0x22, 0x2a, 0x3a,
  0x03, 0x13, 0x23, 0x33, 0x0b, 0x1b, 0x2b, 0x3b, 0x34, 0x35, 0x07, 0x0f, 0x17, 0x1f,
  0x27, 0x2f, 0x37, 0x3f, 0xd9, 0xe9, 0xf9, 0xc2, 0xca, 0xd2, 0xda, 0xe2, 0xea, 0xf2, 0xfa,
  0xc3, 0xe3, 0xeb, 0xc7, 0xcf, 0xd7, 0xdf, 0xe7, 0xef, 0xf7, 0xff,
];

test("Z80 has 252 implemented unprefixed forms, and every new form increments only R bits 0–6 once", () => {
  const ram = new ObservedRam();
  assert.equal(new Set(baseAdditions).size, 53);
  let unprefixed = 0;
  for (let opcode = 0; opcode < 256; opcode++) {
    ram.write(0x2000, opcode); ram.write(0x2001, 0); ram.write(0x2002, 0);
    const record = new CpuZ80(ram, initialState(), { readPort: () => 0, writePort: () => {} }).step();
    if (![0xcb, 0xdd, 0xed, 0xfd].includes(opcode) && record.outcome !== "unsupported") unprefixed++;
  }
  assert.equal(unprefixed, 252);
  for (const opcode of baseAdditions) for (let r = 0; r < 256; r++) {
    const before = initialState({ pc: 0xffff, r });
    ram.write(0xffff, opcode); ram.write(0, 0x80); ram.write(1, 0);
    const record = new CpuZ80(ram, before).step();
    assert.equal(record.outcome, "executed");
    assert.equal(record.after.r, Math.floor(r / 128) * 128 + (r % 128 + 1) % 128);
    assert.equal(record.after.iff1, before.iff1); assert.equal(record.after.iff2, before.iff2);
    assert.equal(record.after.im, before.im);
  }
});

test("Z80 completes 698 documented forms; every other prefix encoding rejects atomically", () => {
  const ram = new ObservedRam();
  const pages = [
    { prefix: [0xed], codes: edOpcodes },
    ...indexes.flatMap(({ prefix }) => [{ prefix: [prefix], codes: indexOpcodes },
      { prefix: [prefix, 0xcb, 0x80], codes: cbRows.map(row => row.base + 6) }]),
  ];
  assert.equal(252 + 248 + pages.reduce((sum, page) => sum + new Set(page.codes).size, 0), 698);
  for (const { prefix, codes } of pages) for (let opcode = 0; opcode < 256; opcode++) {
    // CB on DD/FD is a further page selector, checked separately with all final bytes.
    if (prefix.length === 1 && prefix[0] !== 0xed && opcode === 0xcb) continue;
    const bytes = [...prefix, opcode];
    const before = initialState({ pc: 0xffff, r: 0xff });
    [...bytes, 0, 0].forEach((byte, i) => ram.write((before.pc + i) % 65536, byte));
    const cpu = new CpuZ80(ram, before, { readPort: () => 0, writePort: () => {} });
    ram.accesses.length = 0;
    if (codes.includes(opcode)) {
      const record = cpu.step();
      assert.equal(record.outcome, "executed", bytes.toString());
      assert.equal(record.after.r, prefix[0] === 0xed && opcode === 0x4f ? before.a : 0x81);
    } else for (let attempt = 0; attempt < 2; attempt++) {
      ram.accesses.length = 0;
      const accesses = bytes.map((value, i) => readAccess((before.pc + i) % 65536, value));
      assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(before), outcome: "unsupported", reason: "opcode",
        instruction: { address: before.pc, bytes }, accesses });
      assert.deepEqual(ram.accesses, accesses);
    }
  }
  // Every supported new form observes all 256 initial R values, including LD A,R and LD R,A.
  for (const { prefix, codes } of pages) for (const opcode of codes) for (let r = 0; r < 256; r++) {
    const before = initialState({ r });
    [...prefix, opcode, 0, 0].forEach((byte, i) => ram.write(before.pc + i, byte));
    const record = new CpuZ80(ram, before, { readPort: () => 0, writePort: () => {} }).step();
    assert.equal(record.outcome, "executed");
    assert.equal(record.after.r, prefix[0] === 0xed && opcode === 0x4f ? before.a : refreshTwice(r));
    const interruptReturn = prefix[0] === 0xed && [0x45, 0x4d].includes(opcode);
    assert.equal(record.after.iff1, interruptReturn ? before.iff2 : before.iff1);
    assert.equal(record.after.iff2, before.iff2);
    assert.equal(record.after.im, prefix[0] !== 0xed ? before.im : opcode === 0x46 ? 0 : opcode === 0x56 ? 1 : before.im);
  }
});
