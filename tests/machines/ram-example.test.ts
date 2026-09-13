import assert from "node:assert/strict";
import { test } from "node:test";
import type { Ram } from "../../src/components/memory/ram.js";
import { defineRamExample } from "../../src/machines/ram-example.js";

test("RAM example definitions defer construction and give each CPU its own loaded RAM", () => {
  let constructions = 0;
  class ProbeCpu {
    readonly value: number;
    constructor(readonly ram: Ram, state: { readonly value: number }) {
      constructions++;
      this.value = state.value;
      // The complete image must exist before the CPU is connected.
      assert.equal(ram.read(0x0200), 0x76);
      assert.equal(ram.read(0xffff), 0x02);
    }
  }
  const definition = {
    memory: [
      { address: 0x0200, bytes: [0x76] },
      { address: 0xfffe, bytes: [0x00, 0x02] },
    ],
    initialState: { value: 7 },
  } as const;
  const example = defineRamExample(ProbeCpu, definition);
  const memory = example.createMemory();
  assert.equal(constructions, 0);
  assert.equal(memory.read(0x0200), 0x76);
  memory.write(0x0200, 0);

  const first = example.create();
  const second = example.create();
  assert.equal(constructions, 2);
  assert.equal(first.cpu.value, 7);
  assert.equal(first.cpu.ram, first.ram);
  assert.equal(second.cpu.ram, second.ram);
  assert.notEqual(first.cpu, second.cpu);
  assert.notEqual(first.ram, second.ram);
  assert.deepEqual(Object.keys(first).sort(), ["cpu", "ram"]);
  first.ram.write(0x0200, 0xff);
  assert.equal(second.ram.read(0x0200), 0x76);
  assert.equal(memory.read(0x0200), 0);

  // Zero is a supplied completion address, not an omitted value.
  const withEnd = defineRamExample(ProbeCpu, { ...definition, endAddress: 0 }).create();
  assert.equal(withEnd.endAddress, 0);
});

test("RAM example definitions honor explicit sizes in both factories and reject overflowing images", () => {
  class ProbeCpu {
    constructor(readonly ram: Ram, readonly state: { value: number }) {}
  }
  const definition = { ramSize: 0x4000, memory: [{ address: 0x3fff, bytes: [0xa5] }], initialState: { value: 1 } };
  const factories = defineRamExample(ProbeCpu, definition);
  const ram = factories.createMemory();
  const machine = factories.create();
  for (const memory of [ram, machine.ram]) {
    assert.equal(memory.size, 0x4000);
    assert.equal(memory.read(0), 0);
    assert.equal(memory.read(0x3fff), 0xa5);
    assert.throws(() => memory.read(0x4000), RangeError);
  }
  ram.write(0x3fff, 0);
  assert.equal(machine.ram.read(0x3fff), 0xa5);
  for (const ramSize of [0, -1, 0.5, NaN]) {
    const invalid = defineRamExample(ProbeCpu, { ...definition, ramSize });
    assert.throws(() => invalid.createMemory(), RangeError);
    assert.throws(() => invalid.create(), RangeError);
  }
  const invalid = defineRamExample(ProbeCpu, { ...definition, memory: [{ address: 0x3fff, bytes: [0xaa, 0xbb] }] });
  assert.throws(() => invalid.createMemory(), RangeError);
  assert.throws(() => invalid.create(), RangeError);
});
