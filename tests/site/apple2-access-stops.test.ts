import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { instructionCatalogue6502 } from "../../site/6502-instruction-catalogue.js";
import { apple2DebugLocation, createApple2AccessStops } from "../../site/interactive/apple2-debugger.js";
import { accessStopHistoryActions } from "../../site/interactive/mapped-access-stops.js";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import { createApple2WatchHistory } from "../../site/interactive/apple2-watch-history.js";
import { readRomFile } from "../../site/interactive/rom-file.js";
import { families } from "../../src/components/cpus/semantics/generated/6502.js";
import { romImages } from "../../src/machines/generated/6502/apple2.js";

const instructions = instructionCatalogue6502(Object.values(families).flat());
const caller = { address: 0xfd21, space: "rom" };
const keyRead = { caller, address: 0xc000, kind: "read" as const, enabled: true };

test("access stops match the mapped caller, direction and exact byte, independently of the value", () => {
  const read = { kind: "read" as const, address: 0xc000, value: 0x42 }, write = { ...read, kind: "write" as const };
  const stops = createApple2AccessStops();
  const points = stops.decode(JSON.stringify([{ ...keyRead, value: 0xc1, bytes: [0x2c, 0, 0xc0] }]));
  assert.deepEqual(points, [keyRead]);
  stops.set(points);
  assert.equal(stops.match(caller, [write, read]), read);
  assert.equal(stops.match({ ...caller, address: 0xfd26 }, [read]), undefined);
  assert.equal(stops.match({ ...caller, space: "lc-upper" }, [read]), undefined);
  assert.equal(stops.match(caller, [{ ...read, address: 0xc001 }, write]), undefined);
  stops.set([{ ...keyRead, kind: "write" }]);
  assert.equal(stops.match(caller, [read, write]), write);
  stops.set([{ ...keyRead, enabled: false }]);
  assert.equal(stops.match(caller, [read]), undefined);
  for (const invalid of [null, [keyRead, keyRead], [{ ...keyRead, caller: { address: 0xfd21 } }],
    [{ ...keyRead, kind: "fetch" }], [{ ...keyRead, address: -1 }]]) {
    assert.deepEqual(stops.decode(JSON.stringify(invalid)), []);
  }
});

test("any-byte and exact-byte stops coexist and survive saving, including reads or writes of zero", () => {
  const stops = createApple2AccessStops();
  const actions = accessStopHistoryActions(point => stops.set([...stops.values(), { ...point, enabled: true }]));
  const zero = { ...keyRead, value: 0 }, other = { ...zero, value: 0x42 };
  actions.stopOnAccess(zero); actions.stopOnValue(zero); actions.stopOnValue(other);
  const saved = stops.decode(JSON.stringify(stops.values()));
  assert.deepEqual(saved.map(point => point.expectedValue), [undefined, 0, 0x42]);
  assert.equal(new Set(saved.map(stops.key)).size, 3);
  assert.equal(stops.describe(saved[1]!), "$FD21 (rom) · READ $C000 = $00");
  assert.throws(() => actions.stopOnValue(zero), /distinct/);
  for (const kind of ["read", "write"] as const) {
    stops.set(saved.map(point => ({ ...point, kind, enabled: point.expectedValue === 0 })));
    const first = { ...other, kind }, second = { ...zero, kind };
    assert.equal(stops.match(caller, [first]), undefined);
    assert.equal(stops.match(caller, [first, second]), second);
  }
  for (const expectedValue of [-1, 256, 1.5, null, "C1"]) {
    assert.deepEqual(stops.decode(JSON.stringify([{ ...keyRead, expectedValue }])), []);
  }
});

const romPath = process.env.APPLE2_ROM;
test("restoring KEYIN2 with A queued repeats the ROM read; identical Language Card code reads the key without a hit", {
  skip: romPath === undefined ? "Set APPLE2_ROM to the selected local firmware" : false,
}, async () => {
  const buffer = new Uint8Array(readFileSync(romPath!)).buffer;
  const container = JSON.parse(readFileSync("src/machines/6502/apple2.md", "utf8").match(/```json\n([\s\S]*?)```/)![1]!);
  const rom = await readRomFile({ name: "Apple II Plus ROM", size: buffer.byteLength, async arrayBuffer() { return buffer; } }, romImages.firmware, container);
  const session = createApple2Session(rom.image), history = createApple2WatchHistory(instructions);
  for (let remaining = 1_000_000; session.machine.cpu.snapshot().pc !== 0xfd21; remaining--) {
    assert.ok(remaining > 0, "Boot must reach KEYIN2"); session.step();
  }
  const idle = session.snapshot();
  session.send([65]);
  const saved = session.snapshot(), keyboard = { address: 0xc000, label: "KBD" };
  const origin = apple2DebugLocation(session.machine);
  history.observe(session.step(), origin, [keyboard], []);
  const [entry] = history.entries(keyboard);
  assert.ok(entry); assert.deepEqual(entry.bytes, [0x2c, 0, 0xc0]);
  const stops = createApple2AccessStops();
  assert.equal(entry.value, 0xc1); assert.equal(stops.describe(entry), "$FD21 (rom) · READ $C000");
  accessStopHistoryActions(point => stops.set([{ ...point, enabled: true }])).stopOnValue(entry);

  session.restore(idle); history.reset();
  let idleReads = 0;
  for (let i = 0; idleReads < 3; i++) {
    assert.ok(i < 20_000, "KEYIN2 must keep polling");
    const before = apple2DebugLocation(session.machine), record = session.step();
    const transfers = history.observe(record, before, [], []);
    assert.equal(stops.match(before, transfers), undefined);
    if (before.address === 0xfd21) {
      assert.equal(transfers[0]!.address, 0xc000); assert.ok(transfers[0]!.value < 0x80); idleReads++;
    }
  }
  session.send([65]);
  for (let i = 0; ; i++) {
    assert.ok(i < 20_000, "A should reach the armed ROM read");
    const before = apple2DebugLocation(session.machine), record = session.step();
    const match = stops.match(before, history.observe(record, before, [], []));
    if (match) {
      assert.deepEqual(before, caller); assert.equal(record.after.pc, 0xfd24);
      assert.equal(match.value, 0xc1); break;
    }
  }

  for (const mapping of ["rom", "lc-upper"]) {
    session.restore(saved); history.reset();
    const machine = session.machine;
    if (mapping === "lc-upper") {
      entry.bytes.forEach((byte, i) => machine.upper.write(0xfd21 - 0xe000 + i, byte));
      machine.language.read(0); // Map the Language Card into the CPU's read path.
    }
    const before = apple2DebugLocation(machine);
    assert.deepEqual(before, { address: 0xfd21, space: mapping });
    assert.equal(session.pendingInput, 1);
    const record = session.step(), transfers = history.observe(record, before, [], []);
    assert.deepEqual(record.instruction.bytes, entry.bytes);
    assert.deepEqual(transfers, [{ kind: "read", address: 0xc000, value: 0xc1 }]);
    assert.equal(record.after.pc, 0xfd24); assert.equal(session.pendingInput, 0);
    assert.equal(machine.keyboard.snapshot().strobe, true);
    assert.deepEqual(stops.match(before, transfers), mapping === "rom" ? transfers[0] : undefined);
    assert.equal(history.entries(keyboard).length, 0, "The originating watch is no longer installed");
  }
});
