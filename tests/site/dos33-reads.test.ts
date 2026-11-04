import assert from "node:assert/strict";
import { test } from "node:test";
import { createApple2ChangeLog } from "../../site/interactive/apple2-change-log.js";
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
      if (record.after.pc === 0x03d9) {
        const request = { call: { source: 4, target: 0x03d9 }, requestAt: 0x0380, read: expect };
        assert.equal(trace.matches(request), machine.ram.read(0x38c) === 1);
        assert.ok(!trace.matches({ ...request, call: { source: 8, target: 0x03d9 } }));
        assert.ok(!trace.matches({ ...request, read: { ...expect, buffer: 0x9500 } }));
      }
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

test("the loader request is visible on JSR and only a successful return records a read", () => {
  const { machine } = createApple2Session(), trace = createDos33ReadTrace();
  machine.disk.insert(new Dos33Disk(new Uint8Array(Dos33Disk.size)));
  const put = (at: number, bytes: number[]) => bytes.forEach((b, i) => machine.ram.write(at + i, b));
  put(0, [0xa9, 0x37, 0xa0, 0xe8, 0x4c, 0x99, 0x37]); // A/Y point at the I/O block.
  put(0x3799, [0x20, 0xb5, 0x37, 0x4c, 0, 0]); // JSR RWTS, then repeat.
  put(0x37b5, [0x08, 0x78, 0x20, 0x00, 0x3d, 0xb0, 0x03, 0x28, 0x18, 0x60, 0x28, 0x38, 0x60]);
  put(0x37e8, [1, 0x60, 1, 0, 2, 4, 0, 0, 0, 0x35, 0, 0, 1]);
  const read = { track: 2, sector: 4, buffer: 0x3500 }, request = { requestAt: 0x37e8, read };
  function runTo(pc: number): void {
    for (let i = 0; i < 32; i++) {
      const r = machine.cpu.step();
      trace.observe(machine, r);
      if (r.after.pc === pc) return;
    }
    assert.fail("RWTS did not reach the expected instruction");
  }
  put(0x3d00, [0x38, 0x60]); // SEC, RTS
  runTo(0x37b5);
  assert.ok(trace.matches(request));
  assert.ok(!trace.matches({ ...request, requestAt: 0x37e9 }));
  assert.ok(!trace.matches(read));
  runTo(0x379c);
  assert.ok(!trace.matches(request)); assert.ok(!trace.matches(read)); assert.equal(trace.reads.length, 0);
  put(0x3d00, [0x18, 0x60]); // CLC, RTS
  runTo(0x37b5); runTo(0x379c);
  assert.ok(trace.matches(read)); assert.equal(trace.reads.length, 1);
});

test("a handoff distinguishes direct and indirect jumps to the same destination", () => {
  const { machine } = createApple2Session(), trace = createDos33ReadTrace();
  [0x6c, 0x72, 0xaa].forEach((v, i) => machine.ram.write(i, v));
  machine.ram.write(0xaa73, 0x60); machine.ram.write(0x6000, 0xea);
  const jump = { jumpFrom: 0, indirect: 0xaa72, target: 0x6000 };
  const absolute = { jumpFrom: 0, target: 0x6000 };
  trace.observe(machine, machine.cpu.step());
  assert.ok(trace.matches(jump));
  assert.ok(!trace.matches(absolute));
  const slotRead = { sectorId: 12, buffer: 0x3f00 };
  machine.ram.write(0x3d, 12); machine.ram.write(0x27, 0x3f);
  assert.ok(trace.matches({ ...jump, slotRead }));
  assert.ok(!trace.matches({ ...jump, slotRead: { ...slotRead, sectorId: 14 } }));
  assert.ok(!trace.matches({ ...jump, slotRead: { ...slotRead, buffer: 0x3e00 } }));
  for (const other of [{ jumpFrom: 1 }, { indirect: 0xaa74 }, { target: 0x6001 }]) {
    assert.ok(!trace.matches({ ...jump, ...other }));
  }
  trace.observe(machine, machine.cpu.step());
  assert.ok(!trace.matches(jump));

  const direct = createApple2Session().machine;
  [0x4c, 0, 0x60].forEach((v, i) => direct.ram.write(i, v));
  trace.observe(direct, direct.cpu.step());
  assert.ok(trace.matches(absolute));
  assert.ok(!trace.matches(jump), "Arrival via JMP $6000 is a different instruction");
});

test("a boot stop compares every byte of the requested sectors at the instruction boundary", () => {
  const { machine } = createApple2Session(), trace = createDos33ReadTrace();
  const image = new Uint8Array(Dos33Disk.size);
  for (let i = 0; i < 2560; i++) {
    image[2560 + i] = (i + (i >>> 8)) & 0xff;
    machine.ram.write(0x3600 + i, image[2560 + i]!);
  }
  const sector = { firstSector: 10, bootSectors: 10, ramAt: 0x3600, afterInstruction: 0 };
  machine.ram.write(0, 0xea);
  trace.observe(machine, machine.cpu.step());
  assert.ok(!trace.matches(sector));
  machine.disk.insert(new Dos33Disk(image));
  const controller = machine.disk.inspect();
  assert.ok(trace.matches(sector));
  assert.ok(!trace.matches({ ...sector, firstSector: 0 }));
  assert.ok(!trace.matches({ ...sector, afterInstruction: 1 }));
  machine.ram.write(0x3fff, 0);
  assert.ok(!trace.matches(sector));
  assert.ok(trace.matches({ ...sector, bootSectors: 1 }));
  machine.ram.write(0x3fff, image[5119]!);
  trace.interrupt();
  assert.ok(!trace.matches(sector));
  assert.deepEqual(machine.disk.inspect(), controller);
  assert.equal(trace.reads.length, 0);
});

test("a DOS command includes its terminator and a bank stop requires a physical store even with recording off", () => {
  const { machine } = createApple2Session(), trace = createDos33ReadTrace(), log = createApple2ChangeLog(machine);
  log.recording = false;
  const command = "BLOAD INTBASIC,A$D000";
  [...("\x04" + command + "\r")].forEach((c, i) => machine.ram.write(0x200 + i, c.charCodeAt(0) | 0x80));
  // Load A, then store the same byte at the same address with different card settings.
  [0xa9, 0xa9, 0x8d, 0, 0xd0, 0x8d, 0, 0xd0, 0x8d, 0, 0xd0].forEach((b, i) => machine.ram.write(i, b));
  const store = { bank: "bank2", address: 0xd000, value: 0xa9 } as const;
  const step = () => {
    const record = log.capture(() => machine.cpu.step());
    trace.observe(machine, record, log.memoryWrites(record));
  };
  step();
  assert.ok(trace.matches({ dosCommand: command }));
  assert.ok(!trace.matches({ dosCommand: "BLOAD INTBASIC" }));
  step(); assert.ok(trace.matches(store));
  machine.language.read(2); // Protect RAM. The bus still sees the next STA.
  step(); assert.ok(!trace.matches(store));
  machine.language.read(9); machine.language.read(9); // Enable bank 1 writes behind ROM.
  step(); assert.ok(!trace.matches(store)); assert.ok(trace.matches({ ...store, bank: "bank1" }));
  trace.interrupt(); assert.ok(!trace.matches({ dosCommand: command })); assert.ok(!trace.matches({ ...store, bank: "bank1" }));
  log.dispose();
});

test("a catalogue stop distinguishes padded names and a screen stop requires a store to the visible cell", () => {
  const { machine } = createApple2Session(), trace = createDos33ReadTrace(), log = createApple2ChangeLog(machine);
  log.recording = false;
  const step = () => {
    const record = log.capture(() => machine.cpu.step());
    trace.observe(machine, record, log.memoryWrites(record));
  };
  function entry(name: string): void {
    machine.ram.write(0xb50e, 0x81);
    [...name.padEnd(30)].forEach((c, i) => machine.ram.write(0xb50f + i, c.charCodeAt(0) | 0x80));
  }
  const file = { catalogueName: "COLOR DEMO", address: 0xb50e, value: 0x81 };
  const cell = { page: 1, textCell: [0, 0], before: 0xc4, after: 0xa0 } as const;
  // Two type reads, then repeatedly store a space at $0400.
  [0xad, 0x0e, 0xb5, 0xad, 0x0e, 0xb5, 0xa9, 0xa0, 0x8d, 0, 4, 0x4c, 8, 0].forEach((b, i) => machine.ram.write(i, b));
  entry("COLOR DEMOSOFT"); step(); assert.ok(!trace.matches(file));
  entry("COLOR DEMO"); step(); assert.ok(trace.matches(file));
  step(); assert.ok(!trace.matches(file));
  function store(previous: number) {
    machine.ram.write(0x400, previous); step();
    const matched = trace.matches(cell);
    step(); assert.ok(!trace.matches(cell)); // The observation expires on JMP.
    return matched;
  }
  assert.ok(!store(0xa0)); // Already blank.
  machine.video.read(5); assert.ok(!store(0xc4)); // Page two selected.
  machine.video.read(4); machine.video.read(0); assert.ok(!store(0xc4)); // Graphics selected.
  machine.video.read(1); assert.ok(store(0xc4));
  log.dispose();
});
