import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cocoHash, cocoSoftware, cocoSoftwareRoms } from "../helpers/coco-software.js";
import { readCocoTapeCas } from "../../src/components/devices/coco-tape-cas.js";
import { tapeBlocks } from "../helpers/coco-tape.js";

test("Bedlam loads the original cassette, accepts LOOK and OPEN DOOR, and restores a play checkpoint", {
  skip: !(cocoSoftwareRoms && process.env.COCO_BEDLAM_CAS) && "Set the three COCO ROM paths and COCO_BEDLAM_CAS for Bedlam.",
}, async () => {
  const h = await cocoSoftware(), { session } = h, cas = readFileSync(process.env.COCO_BEDLAM_CAS!);
  assert.equal(cas.length, 15_297);
  assert.equal(cocoHash(cas), "7103d1ea81ea4920a147778ad394574d618d58b33eaab6b47a01b700bcc5ea1d");
  const samples = readCocoTapeCas(cas), blocks = tapeBlocks(samples), header = blocks[0]!.data;
  assert.equal(Buffer.from(header.slice(0, 8)).toString(), "BEDLAM  "); assert.equal(header[8], 2);
  const load = header[13]! * 256 + header[14]!, payload = Uint8Array.from(blocks.filter(block => block.type === 1).flatMap(block => block.data));
  h.run(720_000); session.machine.pias.cassette.insert("bedlam.cas", samples); session.machine.pias.cassette.play(); h.key("CLOADM\n");
  h.until(() => /F BEDLAM\nOK/.test(h.screen()), 20_000_000); h.run(40_000);
  assert.deepEqual(h.bytes(load, payload.length), payload, "every cassette data byte passed through CLOADM");
  h.key("EXEC\n"); h.run(400_000); assert.match(h.screen(), /JUST AWAKENED/);
  h.key(" "); h.run(1_800_000); assert.match(h.screen(), /THICK PADDING/);
  h.key("LOOK\n"); h.run(1_800_000); assert.match(h.screen(), /LOOK\n(?:THIS IS A SMALL SQUARE ROOM|YOU ARE IN A SMALL SQUARE\nROOM)/);
  h.checkpoint.save(session.snapshot());
  function openDoor() { h.key("OPEN DOOR\n"); h.run(1_800_000); assert.match(h.screen(), /THE GREEN DOOR IS NOW OPEN/); return session.snapshot(); }
  const expected = openDoor(); session.powerOn(); session.machine.pias.cassette.eject(); session.restore(h.checkpoint.read()!.state);
  assert.deepEqual(openDoor(), expected);
  assert.equal(cocoHash(session.machine.pias.cassette.samples()!), cocoHash(samples));
});
