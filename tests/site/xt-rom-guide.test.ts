import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createXtRomAnnotations, xtCheckpointPosition } from "../../site/interactive/xt-rom-guide.js";
import { decode8088 } from "../../site/interactive/8088-disassembly.js";
import { createXtDebugger, parseXtDebugAddress, xtDebugLocation } from "../../site/interactive/xt-debugger.js";
import { createXtSession } from "../../site/interactive/xt-session.js";
import { previewXtInstruction } from "../../site/interactive/xt-instruction-preview.js";
import { readXtStorage } from "../../site/interactive/xt-inspection.js";
import { RomImage } from "../../src/machines/rom-image.js";
import { romImages } from "../../src/machines/generated/8088/pc-xt.js";
import { xtCatalogue as catalogue, xtRomGuide as guide } from "./xt-inspection-fixture.js";

const annotations = createXtRomAnnotations(guide);
const decode = (ip: number, bytes: readonly number[]) => decode8088(catalogue.cpu, 0xf000, ip, i => bytes[i]);

test("XT BIOS notes each describe one complete instruction and match captured bytes", () => {
  assert.equal(guide.sha256, romImages.bios.sha256);
  for (const note of guide.notes) {
    const bytes = note.bytes.split(" ").map(byte => parseInt(byte, 16));
    const row = decode(parseInt(note.address, 16) - 0xf0000, bytes);
    assert.equal(row.complete, true, note.address); assert.deepEqual(row.bytes, bytes);
    assert.equal(annotations.annotate(row, true).note, note.text);
    assert.equal(annotations.annotate(row, false).note, undefined);
    assert.equal(annotations.annotate({ ...row, complete: false }, true).note, undefined);
    assert.equal(annotations.annotate({ ...row, bytes: [0x90] }, true).note, undefined);
  }
  const jump = annotations.annotate(decode(0xfff0, [0xea, 0x5b, 0xe0, 0, 0xf0]), true);
  assert.equal(jump.entry?.name, "RESET_VECTOR"); assert.equal(jump.target?.name, "RESET");
  assert.equal(annotations.annotate(decode(0xe05f, [0x73, 0x4c]), true).target?.name, "ERR01");
  assert.equal(annotations.annotate(decode(0xe05f, [0x73, 0x4c]), false).target, undefined);
  const alias = decode8088(catalogue.cpu, 0xffff, 0, i => [0xea, 0x5b, 0xe0, 0, 0xf0][i]);
  assert.equal(annotations.annotate(alias, true).entry?.name, "RESET_VECTOR");
});

test("XT checkpoints distinguish exact CS:IP from a physical alias and report unavailable execution", () => {
  const checkpoint = guide.walkthroughs[0]!.steps[0]!;
  assert.match(xtCheckpointPosition(checkpoint, { address: 0xffff0, space: "CS:IP FFFF:0000" }, true, false), /^At checkpoint/);
  assert.match(xtCheckpointPosition(checkpoint, { address: 0xffff0, space: "CS:IP F000:FFF0" }, true, false), /^Paused at/);
  assert.match(xtCheckpointPosition(checkpoint, undefined, false, false), /Execution unavailable/);
  assert.match(xtCheckpointPosition(checkpoint, { address: 0xffff0, space: "CS:IP FFFF:0000" }, true, true), /^Running/);
});

test("the original XT BIOS reaches every walkthrough checkpoint and returns using the ROM stack word", {
  skip: !(process.env.XT_BIOS_ROM && process.env.XT_BASIC_ROM && process.env.XT_CGA_ROM) && "Set XT_BIOS_ROM, XT_BASIC_ROM and XT_CGA_ROM for the original-ROM walkthrough.",
}, async () => {
  const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const images = await Promise.all((["bios", "basic", "font"] as const).map((id, i) =>
    RomImage.verify(readFileSync([process.env.XT_BIOS_ROM!, process.env.XT_BASIC_ROM!, process.env.XT_CGA_ROM!][i]!), romImages[id], digest)));
  const session = createXtSession({ bios: images[0]!, basic: images[1]!, font: images[2]! });
  const debug = createXtDebugger(() => session.machine, 100_000), tour = guide.walkthroughs[0]!;
  const read = (address: number) => readXtStorage(session.machine, catalogue.storage, address);
  for (const note of guide.notes) assert.equal(note.bytes, note.bytes.split(" ").map((_, i) => read(parseInt(note.address, 16) + i)!.toString(16).toUpperCase().padStart(2, "0")).join(" "));
  let steps = 0;
  for (const [index, checkpoint] of tour.steps.entries()) {
    debug.runTo(parseXtDebugAddress(checkpoint.execution!));
    while (!debug.beforeStep()) { debug.capture(() => session.step()); steps++; }
    assert.equal(debug.stop?.kind, "target", checkpoint.title);
    const state = session.machine.cpu.snapshot(), saved = session.snapshot(), preview = previewXtInstruction(session, catalogue);
    assert.match(xtCheckpointPosition(checkpoint, xtDebugLocation(state), true, false), /^At checkpoint/);
    assert.deepEqual(session.snapshot(), saved);
    assert.ok(annotations.annotate(preview.row, true).note, checkpoint.title);
    switch (index) {
      case 0: assert.equal(preview.record?.after.pc, 0xfe05b); break;
      case 1:
        assert.equal(state.ax >>> 8, 0xd5);
        for (const flag of ["cf", "pf", "af", "zf", "sf"] as const) assert.equal(preview.record!.after.flags[flag], true);
        break;
      case 2: assert.equal(state.flags.cf, true); assert.match(preview.effects.join("\n"), /branch not taken/); break;
      case 3: assert.equal(preview.record?.after.ax, 0xffff); break;
      case 4: assert.equal(state.ax, 0); assert.match(preview.external!, /Output to port 00A0/); break;
      case 5: assert.deepEqual([state.ds, state.ss, state.sp, state.bx], [0xf000, 0xf000, 0xe016, 0xe000]); break;
      case 6:
        assert.equal(state.cx, 0x2000); assert.equal(state.ax & 255, 0);
        assert.match(preview.addressing.join("\n"), /physical \$FE000/); break;
      case 7:
        assert.equal(state.ax & 255, 0); assert.equal(state.flags.zf, true);
        assert.deepEqual(preview.accesses.slice(-2), [{ kind: "read", address: 0xfe016, value: 0xd7 }, { kind: "read", address: 0xfe017, value: 0xe0 }]);
        assert.equal(preview.record?.after.ip, 0xe0d7); break;
      case 8: assert.equal(state.sp, 0xe018); assert.match(preview.effects.join("\n"), /branch not taken/); break;
    }
    const actual = session.step();
    if (preview.record) assert.deepEqual(preview.record, actual, checkpoint.title);
  }
  assert.ok(steps > 24000 && steps < 25000); assert.equal(session.machine.cpu.snapshot().ip, 0xe0d9);
  debug.dispose();
});
