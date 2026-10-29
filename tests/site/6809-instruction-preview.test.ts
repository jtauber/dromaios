import assert from "node:assert/strict";
import { test } from "node:test";
import { preview6809 } from "../../site/interactive/6809-instruction-preview.js";
import { previewCocoInstruction } from "../../site/interactive/coco-instruction-preview.js";
import { create6809Coco } from "../../src/machines/generated/6809/coco.js";
import { Cpu6809 } from "../../src/components/cpus/generated/6809-cpu.js";
import { decode6809 } from "../../site/interactive/6809-disassembly.js";
import { explain6809Address } from "../../site/interactive/6809-address-explanation.js";
import { catalogue6809 as catalogue, state6809 as state } from "./6809-inspection-fixture.js";

test("preview explains direct and indexed addressing with changed registers and flags, leaving state untouched", () => {
  const ram = new Uint8Array(65536); ram.set([0x96, 0x20], 0x2000); ram[0x3020] = 0x80;
  const before = state(), saved = structuredClone(before), image = ram.slice();
  const preview = preview6809(before, address => ram[address], catalogue, () => "ram");
  assert.equal(preview.assembly, "LDA <$20"); assert.equal(preview.record?.after.a, 0x80);
  assert.deepEqual(preview.addressing, ["DP($30):$20 → $3020."]);
  assert.ok(preview.effects.includes("A  $19 → $80")); assert.ok(preview.effects.some(line => line.includes("N 0 → 1")));
  assert.deepEqual(before, saved); assert.deepEqual(ram, image);
  ram.set([0xa6, 0x91], 0x2000); ram[0x4000] = 0x50; ram[0x4001] = 0; ram[0x5000] = 0x41;
  const indexed = preview6809(before, address => ram[address], catalogue, () => "ram");
  assert.equal(indexed.record?.after.a, 0x41); assert.equal(indexed.record?.after.x, 0x4002);
  assert.ok(indexed.addressing.includes("Pointer $4000/$4001 → $5000 (high byte first)."));
  assert.deepEqual(indexed.accesses.slice(-3).map(access => access.address), [0x4000, 0x4001, 0x5000]);
});

test("all indexed effective-address explanations agree with actual CPU reads, including wrap and signed registers", () => {
  for (const base of [0, 1, 0xffff]) for (let postbyte = 0; postbyte < 256; postbyte++) {
    const ram = new Uint8Array(65536); ram.set([0xa6, postbyte, 0xfe, 0xdc], 0x2000);
    const before = state({ x: base, y: base, s: base, u: base, a: 0xff, b: 0xfe, d: 0xfffe });
    const decoded = decode6809(address => ram[address], before.pc, catalogue); if (!decoded.complete) continue;
    const preview = preview6809(before, address => ram[address], catalogue, () => "ram");
    const address = Number.parseInt(preview.addressing[0]!.match(/→ \$([0-9A-F]{4})/)![1]!, 16);
    assert.equal(preview.accesses[decoded.bytes.length]?.address, address, `postbyte ${postbyte.toString(16)}, base ${base}`);
    assert.deepEqual(preview.addressing, explain6809Address(before, decoded, address => ram[address]));
  }
});

test("branch explanations distinguish taken zero-offset branches from not-taken branches", () => {
  for (const z of [false, true]) for (const pc of [0x2000, 0xffff]) {
    const ram = new Uint8Array(65536); ram[pc] = 0x27; ram[(pc + 1) & 0xffff] = 0;
    const before = state({ pc, flags: { ...state().flags, z } });
    const preview = preview6809(before, address => ram[address], catalogue, () => "ram");
    assert.equal(preview.record?.after.pc, (pc + 2) & 0xffff);
    assert.equal(preview.effects[0], "Branch if Z = 1.");
    assert.match(preview.effects[1]!, z ? /branch taken\./ : /branch not taken\./);
  }
});

test("stores stay private and ignored ROM writes are identified; previews stop at device reads and writes", () => {
  const machine = create6809Coco({ firmware: null });
  const cpu = new Cpu6809(machine.memory, state());
  const viewed = { ...machine, cpu };
  machine.memory.read = machine.memory.write = () => { throw new Error("Inspector accessed the guest bus"); };
  for (const target of [0x400, 0xa000, 0xff00, 0xff20, 0xffc0]) for (const opcode of [0xb6, 0xb7]) {
    [opcode, target >> 8, target & 255].forEach((byte, index) => machine.ram.write(0x2000 + index, byte));
    machine.pias.write(1, 5); machine.pias.setHorizontalSync(false); machine.pias.setKey("A", true);
    const before = machine.snapshot(), processor = cpu.snapshot();
    const preview = previewCocoInstruction(viewed, catalogue);
    if (target >= 0xff00 || opcode === 0xb6 && target === 0xa000) {
      assert.equal(preview.blocked?.address, target); assert.equal(preview.record, undefined);
      assert.ok(preview.effects.every(line => !line.startsWith("PC")));
    } else {
      assert.equal(preview.record?.outcome, "executed");
      if (opcode === 0xb7 && target === 0xa000) assert.ok(preview.effects.some(line => line.includes("ignored by this map")));
    }
    assert.deepEqual(machine.snapshot(), before); assert.deepEqual(cpu.snapshot(), processor);
  }
});

test("native interrupt arbitration and waiting are shown instead of pretending the next opcode executes", () => {
  const machine = create6809Coco({ firmware: null }); machine.ram.write(0x2000, 0x12);
  machine.pias.write(1, 5); machine.pias.setHorizontalSync(false);
  const cpu = new Cpu6809(machine.memory, state({ flags: { ...state().flags, i: false } }));
  const before = machine.snapshot(), processor = cpu.snapshot();
  const irq = previewCocoInstruction({ ...machine, cpu }, catalogue);
  assert.equal(irq.blocked?.address, 0xfff8); assert.match(irq.assembly, /IRQ.*entry/);
  assert.deepEqual(irq.addressing, []); assert.deepEqual(machine.snapshot(), before); assert.deepEqual(cpu.snapshot(), processor);
  const sync = new Cpu6809(machine.memory, state({ waitMode: "sync" }));
  const resumed = previewCocoInstruction({ ...machine, cpu: sync }, catalogue);
  assert.match(resumed.assembly, /IRQ · resumed/); assert.equal(resumed.record?.after.pc, 0x2000); assert.equal(resumed.accesses.length, 0);
  machine.pias.write(1, 0);
  const waiting = previewCocoInstruction({ ...machine, cpu: sync }, catalogue);
  assert.equal(waiting.assembly, "Waiting · SYNC"); assert.equal(waiting.accesses.length, 0);
});

test("unsupported opcodes and postbytes are explicit, and unavailable fetches do not predict effects", () => {
  for (const bytes of [[0x01], [0x10, 0x10], [0xa6, 0x90], [0x1f, 0x60]]) {
    const preview = preview6809(state(), address => bytes[address - 0x2000], catalogue, () => "ram");
    assert.equal(preview.record?.outcome, "unsupported"); assert.deepEqual(preview.effects, ["Unsupported instruction or postbyte."]);
  }
  const missing = preview6809(state(), address => address === 0x2000 ? 0xa6 : undefined, catalogue, () => "ram");
  assert.equal(missing.blocked?.address, 0x2001); assert.equal(missing.record, undefined);
});
