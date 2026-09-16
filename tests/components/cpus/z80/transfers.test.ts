import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../../src/components/cpus/z80.js";
import type { CpuZ80MemoryAccess } from "../../../../src/components/cpus/z80.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, snapshot, flagPattern, transferColumns, transferRows, checkBaseStep, wordPairForms, withPair } from "./helpers.js";

for (const { destination, opcodes } of transferRows) {
  test(`Z80 load-matrix destination ${destination.toUpperCase()} covers every source and byte, including self-transfers and HALT`, () => {
    const ram = new ObservedRam();
    for (const [column, source] of transferColumns.entries()) {
      const opcode = opcodes[column]!;
      for (let value = 0; value < 256; value++) {
        const before = initialState({ flags: flagPattern(value % 64) });
        if (source !== "(hl)") before[source] = value;
        const address = before.h * 256 + before.l;
        ram.write(address, value);
        ram.write(before.pc, opcode);
        ram.accesses.length = 0;
        const after = { ...before, pc: 0x2001, r: 0xff, halted: opcode === 0x76 };
        const accesses: CpuZ80MemoryAccess[] = [{ kind: "read", address: before.pc, value: opcode }];
        if (opcode !== 0x76) {
          if (source === "(hl)") accesses.push({ kind: "read", address, value });
          if (destination === "(hl)") accesses.push({ kind: "write", address, value });
          else after[destination] = value;
        }
        const record = new CpuZ80(ram, before).step();
        assert.deepEqual(record, {
          before: snapshot(before), after: snapshot(after), instruction: { address: before.pc, bytes: [opcode] },
          accesses, outcome: after.halted ? "halted" : "executed",
        });
        assert.deepEqual(ram.accesses, accesses);
        // A store still writes when the byte at its destination already matches.
        assert.equal(ram.read(address), value);
      }
    }
  });
}

test("Z80 indirect loads use the original HL and distinguish data reads from instruction bytes at address-space and code overlaps", () => {
  for (const { destination, opcodes } of transferRows) {
    for (const [column, source] of transferColumns.entries()) {
      const opcode = opcodes[column]!;
      if (opcode === 0x76 || (destination !== "(hl)" && source !== "(hl)")) continue;
      for (const pc of [0, 0x2000, 0xffff]) {
        for (const address of [0, 0xffff, 0x1234, pc, (pc + 1) % 0x10000]) {
          const ram = new ObservedRam();
          const before = initialState({ pc, h: Math.floor(address / 256), l: address % 256 });
          ram.write(address, 0xa5);
          ram.write(pc, opcode);
          const value = source === "(hl)" ? ram.read(address) : before[source];
          ram.accesses.length = 0;
          const after = { ...before, pc: (pc + 1) % 0x10000, r: 0xff };
          if (destination !== "(hl)") after[destination] = value;
          const accesses: CpuZ80MemoryAccess[] = [
            { kind: "read", address: pc, value: opcode },
            { kind: destination === "(hl)" ? "write" : "read", address, value },
          ];
          assert.deepEqual(new CpuZ80(ram, before).step(), {
            before: snapshot(before), after: snapshot(after), instruction: { address: pc, bytes: [opcode] },
            accesses, outcome: "executed",
          });
          assert.deepEqual(ram.accesses, accesses);
          assert.equal(ram.read(address), value);
        }
      }
    }
  }
});

test("Z80 LD (HL),n stores every byte with every incoming flag pattern, including wrapped fetches", () => {
  const ram = new ObservedRam();
  ram.write(0xffff, 0x36);
  for (let bits = 0; bits < 64; bits++) {
    for (let value = 0; value < 256; value++) {
      ram.write(0, value);
      ram.accesses.length = 0;
      const before = initialState({ pc: 0xffff, flags: flagPattern(bits) });
      const record = new CpuZ80(ram, before).step();
      assert.deepEqual(record, {
        before: snapshot(before), after: snapshot({ ...before, pc: 1, r: 0xff }),
        instruction: { address: 0xffff, bytes: [0x36, value] }, outcome: "executed",
        accesses: [{ kind: "read", address: 0xffff, value: 0x36 }, { kind: "read", address: 0, value },
          { kind: "write", address: 0x6677, value }],
      });
      assert.deepEqual(ram.accesses, record.accesses);
      assert.equal(ram.read(0x6677), value);
    }
  }
});

test("Z80 LD (HL),n fetches its operand before an overlapping write and retains captured bytes", () => {
  for (const pc of [0, 0x2000, 0xffff]) {
    for (const address of [0, 0xffff, pc, (pc + 1) % 0x10000]) {
      const ram = new ObservedRam();
      ram.write(pc, 0x36);
      ram.write((pc + 1) % 0x10000, 0x76);
      ram.accesses.length = 0;
      const before = initialState({ pc, h: Math.floor(address / 256), l: address % 256 });
      const cpu = new CpuZ80(ram, before);
      const record = cpu.step();
      const saved = structuredClone(record);
      assert.deepEqual(record, {
        before: snapshot(before), after: snapshot({ ...before, pc: (pc + 2) % 0x10000, r: 0xff }),
        instruction: { address: pc, bytes: [0x36, 0x76] }, outcome: "executed",
        accesses: [{ kind: "read", address: pc, value: 0x36 },
          { kind: "read", address: (pc + 1) % 0x10000, value: 0x76 }, { kind: "write", address, value: 0x76 }],
      });
      assert.deepEqual(ram.accesses, record.accesses);
      assert.equal(ram.read(address), 0x76);
      ram.write(address, 0);
      cpu.reset();
      assert.deepEqual(record, saved);
    }
  }
});

for (const { opcode, high, low } of [
  { opcode: 0x01, high: "b", low: "c" }, { opcode: 0x11, high: "d", low: "e" },
  { opcode: 0x21, high: "h", low: "l" }, { opcode: 0x31, high: null, low: null },
] as const) {
  test(`Z80 pair load ${opcode.toString(16)} reads low then high, updates only its stored registers, and preserves flags`, () => {
    const ram = new ObservedRam();
    for (const pc of [0x2000, 0xfffe, 0xffff]) {
      for (const value of [0, 1, 0x00ff, 0x0100, 0x1234, 0x7fff, 0x8000, 0xff00, 0xffff]) {
        for (let bits = 0; bits < 64; bits++) {
          const bytes = [opcode, value % 256, Math.floor(value / 256)];
          bytes.forEach((byte, offset) => ram.write((pc + offset) % 0x10000, byte));
          ram.accesses.length = 0;
          const before = initialState({ pc, flags: flagPattern(bits) });
          const after = { ...before, pc: (pc + 3) % 0x10000, r: 0xff };
          if (high !== null) {
            after[high] = Math.floor(value / 256);
            after[low] = value % 256;
          } else after.sp = value;
          const record = new CpuZ80(ram, before).step();
          assert.deepEqual(record, {
            before: snapshot(before), after: snapshot(after), instruction: { address: pc, bytes }, outcome: "executed",
            accesses: bytes.map((byte, offset) => ({ kind: "read", address: (pc + offset) % 0x10000, value: byte })),
          });
          assert.deepEqual(ram.accesses, record.accesses);
        }
      }
    }
  });
}

// Independent reference: decimal signed range for overflow and column addition for carries.
function addition(a: number, value: number) {
  let left = a;
  let right = value;
  let carry = 0;
  let half = false;
  let result = 0;
  for (let bit = 0; bit < 8; bit++) {
    const column = left % 2 + right % 2 + carry;
    result += (column % 2) * 2 ** bit;
    carry = Math.floor(column / 2);
    if (bit === 3) half = carry === 1;
    left = Math.floor(left / 2);
    right = Math.floor(right / 2);
  }
  const signed = (a < 128 ? a : a - 256) + (value < 128 ? value : value - 256);
  return { a: result, flags: { s: result >= 128, z: result === 0, h: half,
    pv: signed < -128 || signed > 127, n: false, c: carry === 1 } };
}

test("Z80 immediate instructions wrap PC and fetch current RAM", () => {
  for (const opcode of [0x3e, 0xc6]) {
    for (const pc of [0xfffe, 0xffff]) {
      const ram = new ObservedRam();
      ram.write(pc, opcode);
      ram.write((pc + 1) % 0x10000, 0x12);
      const before = initialState({ pc, a: 0 });
      const cpu = new CpuZ80(ram, before);
      ram.write((pc + 1) % 0x10000, 0x34);
      ram.accesses.length = 0;
      const record = cpu.step();
      assert.deepEqual(record.after, snapshot({ ...before, a: 0x34, pc: (pc + 2) % 0x10000, r: 0xff,
        flags: opcode === 0x3e ? before.flags : addition(0, 0x34).flags }));
      assert.deepEqual(record.instruction, { address: pc, bytes: [opcode, 0x34] });
      assert.deepEqual(record.accesses, [{ kind: "read", address: pc, value: opcode },
        { kind: "read", address: (pc + 1) % 0x10000, value: 0x34 }]);
      assert.deepEqual(ram.accesses, record.accesses);
    }
  }
});

test("Z80 LD (nn),A reads low then high, wraps PC, and records overlapping and unchanged stores", () => {
  for (const pc of [0x2000, 0xfffd, 0xfffe, 0xffff]) {
    for (const address of [0, 0xffff, 0x1234, pc, (pc + 1) % 0x10000, (pc + 2) % 0x10000]) {
      for (const bits of [0, 63, 21, 42]) {
        const ram = new ObservedRam();
        const bytes = [0x32, address % 256, Math.floor(address / 256)];
        ram.write(address, 0xa5);
        bytes.forEach((value, offset) => ram.write((pc + offset) % 0x10000, value));
        ram.accesses.length = 0;
        const before = initialState({ pc, a: 0xa5, flags: flagPattern(bits) });
        const record = new CpuZ80(ram, before).step();
        assert.deepEqual(record, {
          before: snapshot(before), after: snapshot({ ...before, pc: (pc + 3) % 0x10000, r: 0xff }),
          instruction: { address: pc, bytes }, outcome: "executed",
          accesses: [...bytes.map((value, offset) => ({ kind: "read", address: (pc + offset) % 0x10000, value })),
            { kind: "write", address, value: 0xa5 }],
        });
        assert.deepEqual(ram.accesses, record.accesses);
        assert.equal(ram.read(address), 0xa5);
      }
    }
  }
});

test("Z80 BC/DE and absolute A transfers cover bytes, flags, wrapping, code overlap, and unchanged writes", () => {
  const ram = new ObservedRam();
  for (const opcode of [0x02, 0x12, 0x0a, 0x1a, 0x3a]) for (const pc of [0x2000, 0xffff]) {
    for (const address of [0, 1, 0xffff, pc, (pc + 1) % 65536, (pc + 2) % 65536]) for (let value = 0; value < 256; value++) {
      const store = opcode === 0x02 || opcode === 0x12;
      let before = initialState({ a: value, pc, flags: flagPattern(value % 64) });
      if (opcode !== 0x3a) before = withPair(before, wordPairForms[opcode === 0x02 || opcode === 0x0a ? 0 : 1], address);
      const bytes = opcode === 0x3a ? [opcode, address % 256, Math.floor(address / 256)] : [opcode];
      const image = new Map([[address, value]]);
      bytes.forEach((byte, i) => image.set((pc + i) % 65536, byte));
      ram.write(address, value);
      checkBaseStep(ram, before, bytes, store ? {} : { a: image.get(address)! },
        [{ kind: store ? "write" : "read", address, value: store ? value : image.get(address)! }]);
    }
  }
});

for (const opcode of [0x22, 0x2a]) {
  test(`Z80 ${opcode === 0x22 ? "LD (nn),HL" : "LD HL,(nn)"} covers every word and wrapped or overlapping instruction/data bytes`, () => {
    const ram = new ObservedRam();
    for (let value = 0; value < 65536; value++) {
      const pc = value % 2 === 0 ? 0xffff : 0x2000;
      const address = [0, 1, 0xffff, pc, (pc + 1) % 65536, (pc + 2) % 65536][value % 6]!;
      const highAddress = (address + 1) % 65536;
      const before = initialState({ h: Math.floor(value / 256), l: value % 256, flags: flagPattern(value % 64), pc });
      const bytes = [opcode, address % 256, Math.floor(address / 256)];
      const image = new Map([[address, value % 256], [highAddress, Math.floor(value / 256)]]);
      bytes.forEach((byte, i) => image.set((pc + i) % 65536, byte));
      for (const [a, v] of image) ram.write(a, v);
      const store = opcode === 0x22;
      const low = store ? value % 256 : image.get(address)!;
      const high = store ? Math.floor(value / 256) : image.get(highAddress)!;
      checkBaseStep(ram, before, bytes, store ? {} : { h: high, l: low }, [
        { kind: store ? "write" : "read", address, value: low },
        { kind: store ? "write" : "read", address: highAddress, value: high },
      ]);
    }
  });
}

test("Z80 EX AF,AF' and EXX swap disjoint register sets, restore both banks, and preserve detached snapshots", () => {
  const ram = new ObservedRam();
  for (const opcode of [0x08, 0xd9]) for (let mainBits = 0; mainBits < 64; mainBits++) for (let alternateBits = 0; alternateBits < 64; alternateBits++) {
    const before = initialState({ flags: flagPattern(mainBits) });
    before.alternate.flags = flagPattern(alternateBits);
    const after = structuredClone(before);
    if (opcode === 0x08) {
      after.a = before.alternate.a; after.alternate.a = before.a;
      after.flags = before.alternate.flags; after.alternate.flags = before.flags;
    } else for (const register of ["b", "c", "d", "e", "h", "l"] as const) {
      after[register] = before.alternate[register]; after.alternate[register] = before[register];
    }
    checkBaseStep(ram, before, [opcode], { ...after, pc: before.pc + 1, r: 0xff });
    ram.write(before.pc + 1, opcode);
    const cpu = new CpuZ80(ram, before);
    const first = cpu.step();
    const saved = structuredClone(first);
    const restored = new CpuZ80(ram, cpu.snapshot());
    assert.deepEqual(restored.step().after, snapshot({ ...before, pc: before.pc + 2, r: 0x80 }));
    assert.deepEqual(first, saved);
  }
  // A later ALU flag replacement must affect only the currently selected AF bank.
  const before = initialState();
  [0x08, 0xc6, 1, 0x08].forEach((byte, i) => ram.write(before.pc + i, byte));
  const cpu = new CpuZ80(ram, before);
  const swapped = cpu.step();
  const saved = structuredClone(swapped);
  cpu.step();
  const restored = cpu.step();
  assert.equal(restored.after.a, before.a);
  assert.deepEqual(restored.after.flags, before.flags);
  assert.equal(restored.after.alternate.a, 0x89);
  assert.deepEqual(restored.after.alternate.flags, addition(0x88, 1).flags);
  cpu.reset();
  assert.deepEqual(swapped, saved);
});

test("Z80 EX DE,HL, JP (HL), and LD SP,HL handle all word values without data accesses or flag changes", () => {
  const ram = new ObservedRam();
  for (let hl = 0; hl < 65536; hl++) {
    const de = 65535 - hl;
    const before = initialState({ h: Math.floor(hl / 256), l: hl % 256, d: Math.floor(de / 256), e: de % 256,
      pc: 0xffff, flags: flagPattern(hl % 64) });
    checkBaseStep(ram, before, [0xeb], { d: before.h, e: before.l, h: before.d, l: before.e });
    checkBaseStep(ram, before, [0xe9], { pc: hl });
    checkBaseStep(ram, before, [0xf9], { sp: hl });
  }
});

test("Z80 word loads and stack exchanges observe edited RAM and leave earlier records detached through reset", () => {
  const ram = new ObservedRam();
  const before = initialState({ sp: 0x3000 });
  [0x2a, 0, 0x30, 0xe3, 0xe9].forEach((value, i) => ram.write(before.pc + i, value));
  ram.write(0x3000, 0x34); ram.write(0x3001, 0x12);
  const cpu = new CpuZ80(ram, before);
  const load = cpu.step(), saved = structuredClone(load);
  assert.equal(load.after.hl, 0x1234);
  ram.write(0x3000, 0x78); ram.write(0x3001, 0x56);
  const resumed = new CpuZ80(ram, cpu.snapshot());
  assert.equal(resumed.step().after.hl, 0x5678);
  assert.equal(ram.read(0x3000), 0x34); assert.equal(ram.read(0x3001), 0x12);
  assert.equal(resumed.step().after.pc, 0x5678);
  resumed.reset();
  assert.deepEqual(load, saved);
  assert.equal(cpu.snapshot().hl, 0x1234);
});
