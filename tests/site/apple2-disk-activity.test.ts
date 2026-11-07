import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6502 } from "../../src/components/cpus/generated/6502-cpu.js";
import { Apple2DiskII } from "../../src/components/devices/apple2-disk-ii.js";
import { Dos33Disk } from "../../src/components/devices/dos33-disk.js";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import { apple2DebugLocation } from "../../site/interactive/apple2-debugger.js";
import { createApple2DiskActivity } from "../../site/interactive/apple2-disk-activity.js";

function reader(capacity?: number) {
  const { machine } = createApple2Session(), activity = createApple2DiskActivity(capacity);
  const medium = new Dos33Disk(new Uint8Array(Dos33Disk.size), { writable: true });
  machine.disk.install(new Uint8Array(256)); machine.disk.insert(medium);
  [0xad, 0xec, 0xc0, 0x4c, 0, 2].forEach((byte, i) => machine.ram.write(0x200 + i, byte));
  machine.cpu = new Cpu6502(machine.memory, { ...machine.cpu.snapshot(), pc: 0x200 });
  activity.connect(machine.disk); machine.disk.read(9);
  const step = () => activity.capture(apple2DebugLocation(machine), () => machine.cpu.step());
  return { machine, medium, activity, step, read(count = 1) { for (let i = 0; i < count; i++) { machine.disk.advanceCpuClocks(32); step(); step(); } } };
}

test("byte history captures the real instruction, preserves old bytes, and bounds retention independently of sector totals", () => {
  const { machine, activity, read } = reader(20);
  read(6162);
  assert.equal(activity.count, 6162); assert.equal(activity.entries().length, 20);
  const event = activity.entries()[0]!;
  assert.deepEqual([event.number, event.position, event.caller, event.instruction, event.outcome],
    [6143, 6142, { address: 0x200, space: "ram" }, [0xad, 0xec, 0xc0], "executed"]);
  assert.ok(activity.sectors(0).every(sector => sector.addresses === 1 && sector.data === 1));
  assert.deepEqual(activity.latestData!.field!.bytes, new Array(256).fill(0));
  machine.ram.write(0x200, 0xea);
  const before = machine.snapshot();
  assert.deepEqual(event.instruction, [0xad, 0xec, 0xc0]);
  activity.entries(); activity.sectors(0); activity.latestData;
  assert.deepEqual(machine.snapshot(), before);
  assert.throws(() => { (event.instruction as number[])[0] = 0; });
  activity.clear(); assert.equal(activity.count, 0); assert.deepEqual(activity.entries(), []);
  assert.equal(activity.latestData, undefined); assert.ok(activity.sectors(0).every(sector => !sector.addresses && !sector.data));
});

test("recording gaps, unobserved host accesses and new media cannot join partial fields", () => {
  for (const interrupt of ["record", "host", "rewrite", "mount", "restore"] as const) {
    const { machine, medium, activity, read } = reader();
    read(61); // A verified address; its data field has not yet been consumed.
    assert.equal(activity.sectors(0)[0]!.addresses, 1);
    if (interrupt === "record") { activity.record(false); read(); activity.record(true); }
    if (interrupt === "host") machine.disk.read(12);
    if (interrupt === "rewrite") medium.writeDataField(0, 61, [0xd5, 0xaa, 0xad, ...new Array<number>(343).fill(0x96), 0xde, 0xaa, 0xeb]);
    if (interrupt === "mount") machine.disk.insert(new Dos33Disk(new Uint8Array(Dos33Disk.size)));
    if (interrupt === "restore") machine.disk = new Apple2DiskII(machine.disk.snapshot());
    activity.connect(machine.disk);
    if (interrupt === "mount" || interrupt === "restore") assert.equal(activity.count, 0);
    else read(356); // Consume the entire data field; its old address must no longer apply.
    assert.equal(activity.latestData, undefined);
    assert.ok(activity.sectors(0).every(sector => sector.data === 0));
    if (interrupt === "restore") assert.equal(activity.count, 0);
  }
});

test("inactive reads and latch loading are absent; actual write shifts survive even an abandoned field", () => {
  const { machine, activity, read, step } = reader();
  machine.disk.read(8); read(); assert.equal(activity.count, 0);
  machine.disk.read(9); machine.disk.read(11); read(); assert.equal(activity.count, 0);
  machine.disk.read(10); machine.disk.read(13); machine.disk.read(15);
  machine.disk.write(13, 0xa5); assert.equal(activity.count, 0);
  step(); // LDA C0EC lowers Q6 in write mode and shifts the latch.
  assert.deepEqual(activity.entries().map(event => [event.kind, event.value, event.position]), [["write", 0xa5, 0]]);
  machine.disk.read(14); // This incomplete field cannot commit a sector.
  assert.deepEqual(machine.disk.exportImage(), new Uint8Array(Dos33Disk.size));
  assert.equal(activity.latestData, undefined);
});

test("an unsupported fetched disk byte and a throwing step retain their actual transfers and caller", () => {
  const { machine, activity } = reader();
  machine.disk.advanceCpuClocks(32);
  machine.cpu = new Cpu6502(machine.memory, { ...machine.cpu.snapshot(), pc: 0xc0ec });
  const record = activity.capture(apple2DebugLocation(machine), () => machine.cpu.step());
  assert.equal(record.outcome, "unsupported");
  assert.deepEqual(activity.entries()[0]!.caller, { address: 0xc0ec, space: "device" });
  assert.equal(activity.entries()[0]!.outcome, "unsupported");
  assert.throws(() => activity.capture({ address: 0x300, space: "ram" }, () => { machine.disk.read(12); throw new Error("host failure"); }));
  assert.equal(activity.entries().at(-1)!.outcome, "error");
  assert.equal(activity.count, 2);
});
