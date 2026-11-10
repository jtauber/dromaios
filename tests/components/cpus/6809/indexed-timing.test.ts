import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6809 } from "../../../../src/components/cpus/generated/6809-cpu.js";
import { InstructionTimingUnavailable } from "../../../../src/components/cpus/instruction-timing.js";
import { baseClocks, fixture, isIndexed, pageClocks } from "./timing-fixture.js";

// Motorola Table F-2: non-indirect and indirect columns, indexed by the low nibble.
// Undefined forms have no cost. Extended indirect is permitted only at $9F.
// https://www.maddes.net/m6809pm/appendix_f.htm
const ordinaryCosts = [2, 3, 2, 3, 0, 1, 1, null, 1, 4, null, 4, 1, 5, null, null];
const indirectCosts = [null, 6, null, 6, 3, 4, 4, null, 4, 7, null, 7, 4, 8, null, null];

test("all 56 indexed opcode forms account for all 217 valid postbytes and reject the other 39", () => {
  let forms = 0;
  for (const page of [0, 0x10, 0x11]) for (let opcode = 0; opcode < 256; opcode++) {
    const base = page === 0 ? baseClocks[opcode] : pageClocks[page]![opcode];
    if (!base || !isIndexed(opcode)) continue;
    forms++;
    let supported = 0;
    for (let postbyte = 0; postbyte < 256; postbyte++) {
      const extra = postbyte < 0x80 ? 1 : postbyte === 0x9f ? 5
        : (postbyte & 0x10 ? indirectCosts : ordinaryCosts)[postbyte & 0xf];
      const code = [...(page ? [page] : []), opcode, postbyte, 0, 0];
      const timed = fixture(code), ordinary = fixture(code);
      const label = `$${page.toString(16)} $${opcode.toString(16)} $${postbyte.toString(16)}`;
      if (extra === null || extra === undefined) {
        assert.throws(() => timed.cpu.stepTimed(), InstructionTimingUnavailable, label);
        assert.deepEqual(timed.cpu.snapshot(), ordinary.cpu.snapshot(), label);
        assert.equal(timed.ram.accesses.length, page ? 3 : 2);
      } else {
        supported++;
        const { clocks, ...record } = timed.cpu.stepTimed();
        assert.equal(clocks, base + extra, label);
        assert.deepEqual(record, ordinary.cpu.step(), label);
        assert.deepEqual(timed.ram.accesses, ordinary.ram.accesses, label);
      }
    }
    assert.equal(supported, 217);
  }
  assert.equal(forms, 56);
});

test("indexed costs use the fetched postbyte once, including a wrapped indirect pointer", () => {
  const { ram, cpu: initial } = fixture([0xa6, 0x99, 0xff, 0xff], { x: 0 }); // LDA [$FFFF,X].
  ram.write(0xffff, 0x30); ram.write(0, 0xff); ram.write(0x30ff, 0x42);
  const reads: number[] = [];
  const cpu = new Cpu6809({ size: ram.size, read: address => {
    reads.push(address); const value = ram.read(address);
    if (address === 0x201) ram.write(address, 0x84); // Change the postbyte after its fetch.
    if (address === 0) ram.write(0xffff, 0); // Change a previously captured pointer byte.
    return value;
  }, write: (address, value) => ram.write(address, value) }, initial.snapshot());
  const record = cpu.stepTimed();
  assert.equal(record.clocks, 11); assert.equal(record.after.a, 0x42);
  assert.deepEqual(record.instruction?.bytes, [0xa6, 0x99, 0xff, 0xff]);
  assert.deepEqual(reads, [0x200, 0x201, 0x202, 0x203, 0xffff, 0, 0x30ff]);
});
