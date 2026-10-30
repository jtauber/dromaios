import assert from "node:assert/strict";
import { test } from "node:test";
import { I8259a } from "../../../src/components/devices/generated/i8259a.js";

function initialized(base = 8) {
  const pic = new I8259a();
  pic.write(0, 0x13); pic.write(1, base); pic.write(1, 9);
  return pic;
}

test("the XT's ICW sequence omits ICW3 and the next data byte becomes IMR", () => {
  let pic = new I8259a();
  assert.equal(pic.ready(), false); assert.equal(pic.irq(), false);
  assert.throws(() => pic.write(1, 0), /Unsupported/);
  pic.write(0, 0x13);
  assert.equal(pic.read(1), 0); assert.equal(pic.snapshot().phase, 1);
  pic = new I8259a(pic.snapshot());
  pic.write(1, 0x0f); // Low vector bits are supplied by the priority resolver.
  assert.equal(pic.snapshot().base, 8); assert.equal(pic.ready(), false);
  pic = new I8259a(pic.snapshot());
  pic.write(1, 9); pic.write(1, 0xff);
  assert.equal(pic.ready(), true); assert.equal(pic.read(1), 0xff);
  pic.setLine(1, true);
  assert.equal(pic.irq(), false); assert.equal(pic.read(0), 2);
  pic.write(1, 0xfd);
  assert.equal(pic.irq(), true); assert.equal(pic.vector(), 9);
  assert.equal(pic.read(0), 2); // Vector inspection does not acknowledge.
  pic.acknowledge();
  assert.equal(pic.read(0), 0); assert.equal(pic.irq(), false);
  pic.write(0, 0x0b); assert.equal(pic.read(0), 2);
  pic.write(0, 0x08); assert.equal(pic.read(0), 2); // RR=0 preserves read selection.
  pic.write(0, 0x20); assert.equal(pic.read(0), 0);
  pic.setLine(1, true); assert.equal(pic.irq(), false);
  pic.setLine(1, false); pic.setLine(1, true); assert.equal(pic.irq(), true);
});

test("fixed priority admits higher nesting and retains masked and in-service requests", () => {
  const pic = initialized();
  pic.setLine(3, true); pic.acknowledge();
  pic.setLine(5, true); pic.setLine(1, true);
  assert.equal(pic.vector(), 9); pic.acknowledge();
  pic.setLine(1, false); pic.setLine(1, true);
  assert.equal(pic.irq(), false);
  assert.deepEqual([pic.snapshot().irr, pic.snapshot().isr], [0x22, 0x0a]);
  pic.write(1, 2); // Masking IR1 does not make its active handler disappear.
  assert.equal(pic.irq(), false);
  pic.setLine(0, true); assert.equal(pic.vector(), 8); pic.acknowledge();
  pic.write(0, 0x63); // Specific EOI can end IR3 while IR0 and IR1 remain active.
  assert.equal(pic.snapshot().isr, 3);
  pic.write(0, 0x20); assert.equal(pic.snapshot().isr, 2);
  pic.write(0, 0x20); assert.equal(pic.snapshot().isr, 0);
  assert.equal(pic.vector(), 13); // IR1 remains masked, so IR5 wins.
  pic.write(1, 0); assert.equal(pic.vector(), 9);
});

test("every request bitmap resolves against masks and nested service state", () => {
  const base = initialized(0xa8).snapshot();
  for (let requests = 0; requests < 256; requests++) for (const mask of [0, 0x55, 0xaa, 0xff]) {
    for (const service of [0, 1, 2, 8, 0x80, 0x84]) {
      const pic = new I8259a({ ...base, irr: requests, imr: mask, isr: service, levels: requests });
      let selected = -1;
      for (let line = 0; line < 8; line++) {
        if (service & (1 << line)) break;
        if ((requests & (1 << line)) && !(mask & (1 << line))) { selected = line; break; }
      }
      assert.equal(pic.irq(), selected !== -1);
      assert.equal(pic.vector(), 0xa8 + (selected === -1 ? 7 : selected));
      pic.acknowledge();
      const accepted = selected === -1 ? 0 : 1 << selected;
      assert.equal(pic.snapshot().irr, requests & ~accepted);
      assert.equal(pic.snapshot().isr, service | accepted);
    }
  }
});

test("reinitialization clears controller state without inventing an edge on a held input", () => {
  const pic = initialized(); pic.setLine(1, true); pic.acknowledge();
  pic.setLine(2, true); pic.write(0, 0x0b);
  pic.write(0, 0x17); // ADI has no meaning in 8086 mode.
  assert.equal(pic.read(0), 0); assert.equal(pic.read(1), 0);
  pic.write(1, 0x20); pic.write(1, 1);
  pic.setLine(1, true); pic.setLine(2, true);
  assert.equal(pic.irq(), false);
  pic.setLine(1, false); pic.setLine(1, true); assert.equal(pic.vector(), 0x21);
  const restored = new I8259a(pic.snapshot());
  restored.acknowledge(); assert.equal(pic.read(0), 2);
  pic.reset(); assert.equal(pic.ready(), false); assert.equal(pic.snapshot().levels, 6);
});

test("unsupported modes and malformed host state fail before changing the PIC", () => {
  const pic = initialized(); pic.setLine(1, true);
  for (const command of [0x11, 0x12, 0x1b, 0x80, 0xa0, 0xc0, 0xe0, 0x0c, 0x68]) {
    const before = pic.snapshot(); assert.throws(() => pic.write(0, command), /Unsupported/);
    assert.deepEqual(pic.snapshot(), before);
  }
  pic.write(0, 0x13); pic.write(1, 8);
  for (const mode of [0, 3, 0x11, 0x21]) {
    const before = pic.snapshot(); assert.throws(() => pic.write(1, mode), /Unsupported/);
    assert.deepEqual(pic.snapshot(), before);
  }
  const before = pic.snapshot();
  for (const value of [-1, 8, 0.5, NaN]) assert.throws(() => pic.setLine(value, true), RangeError);
  assert.throws(() => pic.setLine(1, 1 as never), TypeError);
  assert.throws(() => pic.write(1, 256), RangeError);
  assert.deepEqual(pic.snapshot(), before);
  assert.throws(() => new I8259a({ ...before, phase: 4 }), /Invalid/);
  assert.throws(() => new I8259a({ ...before, base: 9 }), /Invalid/);
  assert.throws(() => new I8259a({ ...before, irr: 1 }), /Invalid/);
});
