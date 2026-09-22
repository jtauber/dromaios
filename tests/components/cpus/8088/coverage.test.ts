import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/generated/8088-cpu.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, snapshot, address, put, reject } from "./helpers.js";

test("8088 rejects every deferred or undocumented first byte with one fetch and no state change", () => {
  const ram = new ObservedRam(0x100000);
  const unsupported = [
    0x0f, 0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f,
    0xc0, 0xc1, 0xc8, 0xc9, 0xd6,
    0xf1,
  ];
  for (const [cs, ip, address] of [[0x1234, 0x100, 0x12440], [0xffff, 0xf, 0xfffff], [0xffff, 0x10, 0]] as const) {
    for (const opcode of unsupported) {
      ram.write(address, opcode);
      const before = snapshot(initialState({ cs, ip }));
      const cpu = new Cpu8088(ram, before);
      for (let repeat = 0; repeat < 2; repeat++) {
        ram.accesses.length = 0;
        const accesses = [{ kind: "read", address, value: opcode }];
        assert.deepEqual(cpu.step(), { before, after: before, instruction: { address, bytes: [opcode] },
          outcome: "unsupported", reason: "opcode", accesses });
        assert.deepEqual(cpu.snapshot(), before);
        assert.deepEqual(ram.accesses, accesses);
      }
    }
  }
});

test("8088 new groups reject every unsupported selector before displacement/data accesses and can retry", () => {
  const ram = new ObservedRam(0x100000);
  for (const [opcode, supported] of [
    [0xc6, [0]], [0xc7, [0]], [0xd0, [0, 1, 2, 3, 4, 5, 7]], [0xd1, [0, 1, 2, 3, 4, 5, 7]],
    [0xd2, [0, 1, 2, 3, 4, 5, 7]], [0xd3, [0, 1, 2, 3, 4, 5, 7]],
    [0xf6, [0, 2, 3, 4, 5, 6, 7]], [0xf7, [0, 2, 3, 4, 5, 6, 7]], [0xfe, [0, 1]], [0xff, [0, 1, 2, 3, 4, 5, 6]], [0x8f, [0]],
  ] as const) for (let group = 0; group < 8; group++) {
    if ((supported as readonly number[]).includes(group)) continue;
    for (let mode = 0; mode < 4; mode++) for (let rm = 0; rm < 8; rm++) {
      const before = initialState({ cs: 0xffff, ip: 0xffff });
      const modRM = mode * 64 + group * 8 + rm;
      ram.write(0xffef, opcode); ram.write(0xffff0, modRM); ram.write(0xffff1, 0xa5);
      const cpu = new Cpu8088(ram, before);
      for (let repeat = 0; repeat < 2; repeat++) {
        ram.accesses.length = 0;
        const accesses = [{ kind: "read", address: 0xffef, value: opcode }, { kind: "read", address: 0xffff0, value: modRM }];
        assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(before),
          instruction: { address: 0xffef, bytes: [opcode, modRM] }, accesses, outcome: "unsupported", reason: "opcode" });
        assert.deepEqual(ram.accesses, accesses);
      }
      ram.write(0xffff0, 0xc0);
      assert.equal(cpu.step().outcome, "executed");
    }
  }
});

test("8088 completion memory-only and segment selectors reject all invalid ModR/M forms atomically", () => {
  const ram = new ObservedRam(0x100000), before = initialState({ ip: 0xffff, cs: 0xffff });
  for (let modRM = 0; modRM < 256; modRM++) {
    const selector = Math.floor(modRM / 8) % 8;
    for (const opcode of [0x8c, 0x8e]) {
      if (selector > 3 || opcode === 0x8e && selector === 1) reject(ram, before, [0x26, opcode, modRM]);
    }
    if (modRM < 0xc0) continue;
    for (const opcode of [0x8d, 0xc4, 0xc5]) reject(ram, before, [0x26, opcode, modRM]);
    if (selector === 3 || selector === 5) reject(ram, before, [0x26, 0xff, modRM]);
  }
});

test("8088 completion accounts for all 291 documented forms: 291 implemented", () => {
  const ram = new Ram(0x100000);
  const unused = [0x0f, ...Array.from({ length: 16 }, (_, i) => 0x60 + i), 0xc0, 0xc1, 0xc8, 0xc9, 0xd6, 0xf1];
  const prefixes = [0x26, 0x2e, 0x36, 0x3e, 0xf0, 0xf2, 0xf3];
  // Table 4-13 expands these operation selectors; all other ModR/M fields are operands.
  const groups: Readonly<Record<number, readonly number[]>> = {
    0x80: [0, 1, 2, 3, 4, 5, 6, 7], 0x81: [0, 1, 2, 3, 4, 5, 6, 7],
    0x82: [0, 2, 3, 5, 7], 0x83: [0, 2, 3, 5, 7],
    0xd0: [0, 1, 2, 3, 4, 5, 7], 0xd1: [0, 1, 2, 3, 4, 5, 7],
    0xd2: [0, 1, 2, 3, 4, 5, 7], 0xd3: [0, 1, 2, 3, 4, 5, 7],
    0xf6: [0, 2, 3, 4, 5, 6, 7], 0xf7: [0, 2, 3, 4, 5, 6, 7], 0xfe: [0, 1], 0xff: [0, 1, 2, 3, 4, 5, 6],
  };
  let documented = 0, complete = 0;
  for (let opcode = 0; opcode < 256; opcode++) {
    if (unused.includes(opcode) || prefixes.includes(opcode)) continue;
    for (const group of groups[opcode] ?? [0]) {
      documented++;
      const before = initialState({ ax: 12, dx: 0, cx: 1 });
      put(ram, before.ds, 0, [3, 0, 0x34, 0x12]);
      const bytes = [opcode, opcode === 0xd4 || opcode === 0xd5 ? 10 : group * 8 + 6, 0, 0, 0, 0];
      put(ram, before.cs, before.ip, bytes);
      const record = new Cpu8088(ram, before, { ports: { readPort: () => 0, writePort: () => {} }, test: () => false }).step();
      const accepted = record.outcome !== "unsupported";
      assert.equal(accepted, true, `Opcode ${opcode.toString(16)} /${group}`);
      if (accepted) complete++;
    }
  }
  assert.equal(documented, 291); assert.equal(complete, 291);
});
