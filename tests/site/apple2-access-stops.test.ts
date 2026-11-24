import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { instructionCatalogue6502 } from "../../site/6502-instruction-catalogue.js";
import { apple2AccessHit, decodeApple2AccessStops, describeApple2Access, validateApple2AccessStops } from "../../site/interactive/apple2-access-stops.js";
import { apple2DebugLocation } from "../../site/interactive/apple2-debugger.js";
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
  const points = decodeApple2AccessStops(JSON.stringify([{ ...keyRead, value: 0xc1, bytes: [0x2c, 0, 0xc0] }]));
  assert.deepEqual(points, [keyRead]);
  assert.equal(apple2AccessHit(points, caller, [write, read]), read);
  assert.equal(apple2AccessHit([{ ...keyRead, kind: "write" }], caller, [read, write]), write);
  assert.equal(apple2AccessHit(points, { ...caller, address: 0xfd26 }, [read]), undefined);
  assert.equal(apple2AccessHit(points, { ...caller, space: "lc-upper" }, [read]), undefined);
  assert.equal(apple2AccessHit(points, caller, [{ ...read, address: 0xc001 }, write]), undefined);
  assert.equal(apple2AccessHit([{ ...keyRead, enabled: false }], caller, [read]), undefined);
  for (const invalid of [null, [keyRead, keyRead], [{ ...keyRead, caller: { address: 0xfd21 } }],
    [{ ...keyRead, kind: "fetch" }], [{ ...keyRead, address: -1 }]]) {
    assert.deepEqual(decodeApple2AccessStops(JSON.stringify(invalid)), []);
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
  session.send([65]);
  const saved = session.snapshot(), keyboard = { address: 0xc000, label: "KBD" };
  const origin = apple2DebugLocation(session.machine);
  history.observe(session.step(), origin, [keyboard], []);
  const [entry] = history.entries(keyboard);
  assert.ok(entry); assert.deepEqual(entry.bytes, [0x2c, 0, 0xc0]);
  assert.equal(entry.value, 0xc1); assert.equal(describeApple2Access(entry), "$FD21 (rom) · READ $C000");
  const stops = validateApple2AccessStops([{ ...entry, enabled: true }]);

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
    assert.deepEqual(apple2AccessHit(stops, before, transfers), mapping === "rom" ? transfers[0] : undefined);
    assert.equal(history.entries(keyboard).length, 0, "The originating watch is no longer installed");
  }
});
