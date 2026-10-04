import assert from "node:assert/strict";
import { test } from "node:test";
import { families } from "../../src/components/cpus/semantics/generated/6502.js";
import type { Cpu6502Snapshot } from "../../src/components/cpus/generated/6502-cpu.js";
import { instructionCatalogue6502 } from "../../site/6502-instruction-catalogue.js";
import { preview6502 } from "../../site/interactive/apple2-instruction-preview.js";
import { apple2StorageReader } from "../../site/interactive/apple2-inspection.js";
import { createApple2Session } from "../../site/interactive/apple2-session.js";

const instructions = instructionCatalogue6502(Object.values(families).flat());
const state = (overrides: Partial<Cpu6502Snapshot> = {}): Cpu6502Snapshot => ({
  a: 0x19, x: 4, y: 3, sp: 0xff, pc: 0x200,
  flags: { n: false, v: false, d: false, i: true, z: false, c: false }, ...overrides,
});

test("instruction preview uses current addressing, decimal mode, and branch flags without changing state", () => {
  const ram = new Uint8Array(0x10000); ram.set([0xb5, 0xfe], 0x200); ram[2] = 0x80;
  const before = state(), copy = structuredClone(before), bytes = ram.slice();
  const load = preview6502(before, address => ram[address], instructions);
  assert.equal(load.assembly, "LDA $FE,X");
  assert.equal(load.record?.after.a, 0x80); assert.equal(load.record?.after.flags.n, true);
  assert.deepEqual(before, copy); assert.deepEqual(ram, bytes);
  ram.set([0x69, 0x01], 0x200);
  const decimal = preview6502(state({ flags: { ...before.flags, d: true } }), address => ram[address], instructions);
  assert.equal(decimal.record?.after.a, 0x20);
  ram.set([0xd0, 0xfc], 0x200);
  assert.equal(preview6502(before, address => ram[address], instructions).record?.after.pc, 0x1fe);
  assert.equal(preview6502(state({ flags: { ...before.flags, z: true } }), address => ram[address], instructions).record?.after.pc, 0x202);
});

test("every branch preview explains its flag test and outcome, including zero offsets and address wrapping", () => {
  const branches = [
    [0x10, "n", "Negative", false], [0x30, "n", "Negative", true],
    [0x50, "v", "Overflow", false], [0x70, "v", "Overflow", true],
    [0x90, "c", "Carry", false], [0xb0, "c", "Carry", true],
    [0xd0, "z", "Zero", false], [0xf0, "z", "Zero", true],
  ] as const;
  for (const [opcode, flag, name, set] of branches) for (const current of [false, true]) {
    for (const pc of [0x200, 0xffff]) for (const offset of [-128, -2, 0, 127]) {
      const ram = new Uint8Array(0x10000); ram[pc] = opcode; ram[(pc + 1) & 0xffff] = offset & 0xff;
      const before = state({ pc, flags: { n: !current, v: !current, d: true, i: true, z: !current, c: !current, [flag]: current } });
      const saved = structuredClone(before), memory = ram.slice();
      const preview = preview6502(before, address => ram[address], instructions);
      const taken = current === set, destination = (pc + 2 + (taken ? offset : 0)) & 0xffff;
      assert.deepEqual(preview.effects, [
        `Branch if ${name} flag (${flag.toUpperCase()}) is ${set ? "set" : "clear"} (${+set}).`,
        `${flag.toUpperCase()} is ${+current}: branch ${taken ? "taken" : "not taken"}.`,
        `PC → $${destination.toString(16).toUpperCase().padStart(4, "0")}`,
      ]);
      assert.equal(preview.record?.after.pc, destination);
      assert.deepEqual(preview.record?.after.flags, before.flags);
      assert.deepEqual(before, saved); assert.deepEqual(ram, memory);
    }
  }
});

test("previewed stores and stack writes stay private, including operands overwritten by JSR", () => {
  const ram = new Uint8Array(0x10000); ram.set([0x8d, 0x00, 0x04], 0x200);
  const store = preview6502(state(), address => ram[address], instructions);
  assert.equal(ram[0x400], 0); assert.ok(store.effects.includes("Write $0400 ← $19"));
  ram.set([0x20, 0x34, 0x12], 0x1fd);
  const before = ram.slice(), call = preview6502(state({ pc: 0x1fd }), address => ram[address], instructions);
  // JSR pushes the high return byte over its not-yet-fetched high operand.
  assert.equal(call.record?.after.pc, 0x134);
  assert.equal(call.assembly, "JSR $0134"); assert.deepEqual(ram, before);
});

test("instruction previews and mapped writes never operate the guest bus or devices", () => {
  const { machine } = createApple2Session();
  machine.memory.read = () => { throw new Error("Guest read"); };
  machine.memory.write = () => { throw new Error("Guest write"); };
  machine.language.read(1);
  machine.disk.read = machine.language.read = () => { throw new Error("Device read"); };
  for (const address of [0xc000, 0xc010, 0xc030, 0xc080, 0xc0e9, 0xd000]) {
    machine.ram.write(0x200, 0xad); machine.ram.write(0x201, address & 0xff); machine.ram.write(0x202, address >> 8);
    const before = machine.snapshot(), preview = preview6502(state(), apple2StorageReader(machine), instructions);
    assert.equal(preview.blocked, address); assert.equal(preview.record, undefined);
    assert.deepEqual(machine.snapshot(), before);
    machine.ram.write(0x200, 0x8d);
    const storeBefore = machine.snapshot(), store = preview6502(state(), apple2StorageReader(machine), instructions);
    assert.equal(store.record?.outcome, "executed"); assert.deepEqual(machine.snapshot(), storeBefore);
  }
});

test("preview distinguishes unsupported opcodes and unavailable instruction bytes", () => {
  assert.equal(preview6502(state(), () => undefined, instructions).blocked, 0x200);
  const unknown = preview6502(state(), () => 0x02, instructions);
  assert.equal(unknown.record?.outcome, "unsupported");
  assert.ok(unknown.effects.includes("Unsupported instruction."));
  const missingOffset = preview6502(state(), address => address === 0x200 ? 0xf0 : undefined, instructions);
  assert.equal(missingOffset.blocked, 0x201);
  assert.ok(missingOffset.effects.includes("Result cannot be previewed without executing."));
  assert.ok(missingOffset.effects.every(line => !line.includes("taken") && !line.startsWith("PC")));
});
