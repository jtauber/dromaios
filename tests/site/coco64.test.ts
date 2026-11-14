import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cocoHash, cocoSoftware, cocoSoftwareRoms } from "../helpers/coco-software.js";
import { cocoTextInput } from "../../site/interactive/coco-input.js";
import { readCocoStorage } from "../../site/interactive/coco-inspection.js";
import { observeCocoRoms } from "../../site/interactive/coco-rom-guide.js";

test("64 KiB Zork I boots through DOS, uses upper RAM, opens the mailbox, and replays loading and play", {
  skip: !(cocoSoftwareRoms && process.env.COCO_ZORK_DISK) && "Set the three COCO ROM paths and COCO_ZORK_DISK for the 64 KiB acceptance.",
}, async () => {
  const h = await cocoSoftware(64), { session } = h;
  const disk = readFileSync(process.env.COCO_ZORK_DISK!);
  assert.equal(cocoHash(disk), "d8c0a56ab6e268d1b73f3ebee2a7dcf028b9856f46605ec3c3e852f103a6dc2f");
  session.mountDisk("zork-i.dsk", disk); h.run(720_000);
  assert.match(h.screen(), /DISK EXTENDED COLOR BASIC/);
  session.send(cocoTextInput("DOS\n"));
  h.until(() => session.machine.disk.inspect().byte_index === 128 && session.machine.disk.inspect().phase === 3, 3_000_000, 1);
  h.checkpoint.save(session.snapshot());
  const remaining = h.until(() => h.screen().includes("[MORE]"));
  const opening = session.snapshot();
  assert.match(h.screen(), /WEST OF HOUSE/); assert.equal(session.machine.sam.allRam(), true);
  assert.ok(h.bytes(0x8000, 0x7f00).some(byte => byte !== 0), "guest disk loading populated RAM behind ROM");
  const mapping = observeCocoRoms(session.machine);
  assert.equal(mapping.mapped(0xa000), false); assert.equal(mapping.mapped(0xfffe), true);
  assert.equal(readCocoStorage(session.machine, 0xa000), session.machine.ram.read(0xa000));
  session.configureMemory(32); session.restore(h.checkpoint.read()!.state); h.run(remaining);
  assert.equal(session.memorySize, 64); assert.deepEqual(session.snapshot(), opening);
  h.key(" "); h.until(() => /\n>█?$/.test(h.screen()));
  h.checkpoint.save(session.snapshot());
  function openMailbox() {
    h.key("OPEN MAILBOX\n"); h.until(() => /\n>█?$/.test(h.screen()));
    assert.match(h.screen(), /OPENING THE MAILBOX REVEALS A\nLEAFLET/);
    return session.snapshot();
  }
  const opened = openMailbox(); session.powerOn(); session.restore(h.checkpoint.read()!.state);
  assert.deepEqual(openMailbox(), opened);
  h.key("READ LEAFLET\n"); h.until(() => h.screen().includes("[MORE]")); assert.match(h.screen(), /WELCOME TO ZORK/);
  assert.deepEqual(session.machine.disk.exportImage(), new Uint8Array(disk));
  const original = await cocoSoftware(32); original.session.mountDisk("zork-i.dsk", disk); original.run(720_000);
  original.key("DOS\n"); assert.throws(() => original.run(2_000_000), /Unsupported CoCo memory configuration for 32 KiB/);
});
