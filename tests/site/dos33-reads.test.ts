import assert from "node:assert/strict";
import { test } from "node:test";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import { createDos33ReadTrace } from "../../site/interactive/dos33-reads.js";
import { Dos33Disk } from "../../src/components/devices/dos33-disk.js";

test("DOS reads require an observed request and successful matching return, and retain the buffer at that boundary", () => {
  const { machine } = createApple2Session(), trace = createDos33ReadTrace();
  machine.disk.insert(new Dos33Disk(new Uint8Array(Dos33Disk.size)));
  const put = (at: number, bytes: number[]) => bytes.forEach((b, i) => machine.ram.write(at + i, b));
  // Give the real wrapper a short driver in RAM whose carry selects success or failure.
  put(0x0000, [0xa9, 3, 0xa0, 0x80, 0x20, 0xd9, 3, 0x4c, 0, 0]); // LDA, LDY, JSR RWTS, JMP $0000
  put(0x03d9, [0x4c, 0xb5, 0xb7]);
  put(0xb7b5, [0x08, 0x78, 0x20, 0x00, 0xbd, 0xb0, 0x03, 0x28, 0x18, 0x60, 0x28, 0x38, 0x60]);
  put(0x0380, [1, 0x60, 1, 0, 12, 5, 0, 0, 0, 0x96, 0, 0, 1]);
  const expect = { track: 12, sector: 5, buffer: 0x9600 };
  function call(interrupt = false): void {
    for (let i = 0; i < 32; i++) {
      const record = machine.cpu.step();
      assert.equal(record.outcome, "executed");
      trace.observe(machine, record);
      if (interrupt && record.before.pc === 0xb7b5) trace.interrupt();
      if (record.after.pc === 7) return;
    }
    assert.fail("RWTS did not return");
  }
  put(0xbd00, [0x38, 0x60]); // SEC, RTS
  call(); assert.equal(trace.reads.length, 0);
  put(0xbd00, [0x18, 0x60]); // CLC, RTS
  call(true); assert.equal(trace.reads.length, 0);
  machine.ram.write(0x38c, 2);
  call(); assert.equal(trace.reads.length, 0);
  machine.ram.write(0x38c, 1); machine.ram.write(0x9600, 12);
  call(); assert.ok(trace.matches(expect)); assert.equal(trace.reads[0]!.bytes[0], 12);
  machine.ram.write(0x9600, 99); trace.observe(machine, machine.cpu.step());
  assert.ok(!trace.matches(expect)); assert.equal(trace.reads[0]!.bytes[0], 12);
  trace.clear(); assert.equal(trace.reads.length, 0);
});

test("a handoff matches the executed indirect jump and expires on the next instruction", () => {
  const { machine } = createApple2Session(), trace = createDos33ReadTrace();
  [0x6c, 0x72, 0xaa].forEach((v, i) => machine.ram.write(i, v));
  machine.ram.write(0xaa73, 0x60); machine.ram.write(0x6000, 0xea);
  const jump = { jumpFrom: 0, indirect: 0xaa72, target: 0x6000 };
  trace.observe(machine, machine.cpu.step());
  assert.ok(trace.matches(jump));
  for (const other of [{ jumpFrom: 1 }, { indirect: 0xaa74 }, { target: 0x6001 }]) {
    assert.ok(!trace.matches({ ...jump, ...other }));
  }
  trace.observe(machine, machine.cpu.step());
  assert.ok(!trace.matches(jump));

  const direct = createApple2Session().machine;
  [0x4c, 0, 0x60].forEach((v, i) => direct.ram.write(i, v));
  trace.observe(direct, direct.cpu.step());
  assert.ok(!trace.matches(jump), "Arrival via JMP $6000 is a different instruction");
});
