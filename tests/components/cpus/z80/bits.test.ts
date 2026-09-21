import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../../src/components/cpus/generated/z80-cpu.js";
import type { CpuZ80Flags, CpuZ80MemoryAccess } from "../../../../src/components/cpus/generated/z80-cpu.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, snapshot, flagPattern, transferColumns, cbRows, expectedCb, unpackFlags, readAccess, writeAccess, checkPrefixedStep } from "./helpers.js";

for (const { name, bit, base } of cbRows) {
  test(`Z80 CB ${name} ${bit} covers every operand, byte, and carry input`, () => {
    const ram = new ObservedRam();
    for (const [column, operand] of transferColumns.entries()) {
      const opcode = base + column;
      for (let value = 0; value < 256; value++) {
        for (const carry of [false, true]) {
          const flags = { ...flagPattern(value % 32), c: carry };
          const before = initialState({ flags, r: value });
          if (operand !== "(hl)") before[operand] = value;
          ram.write(0x6677, value);
          ram.write(0x2000, 0xcb);
          ram.write(0x2001, opcode);
          ram.accesses.length = 0;
          const expected = expectedCb(name, bit, value, flags);
          const after = { ...before, flags: expected.flags, pc: 0x2002, r: Math.floor(value / 128) * 128 + (value + 2) % 128 };
          if (operand !== "(hl)") after[operand] = expected.value;
          const accesses: CpuZ80MemoryAccess[] = [{ kind: "read", address: 0x2000, value: 0xcb },
            { kind: "read", address: 0x2001, value: opcode }];
          if (operand === "(hl)") {
            accesses.push({ kind: "read", address: 0x6677, value });
            if (name !== "BIT") accesses.push({ kind: "write", address: 0x6677, value: expected.value });
          }
          const record = new CpuZ80(ram, before).step();
          assert.deepEqual(record, { before: snapshot(before), after: snapshot(after), accesses,
            instruction: { address: 0x2000, bytes: [0xcb, opcode] }, outcome: "executed" });
          assert.deepEqual(ram.accesses, accesses);
          if (operand === "(hl)") assert.equal(ram.read(0x6677), expected.value);
        }
      }
    }
  });
}

test("Z80 CB operations exhaust byte/flag combinations through POP AF, including ignored F bits", () => {
  const ram = new Ram(0x10000);
  for (const { name, bit, base } of cbRows) {
    for (let f = 0; f < 256; f++) {
      // POP AF supplies each independent input, including bits omitted from stored state.
      const flags = unpackFlags(f);
      for (let value = 0; value < 256; value++) {
        [0xf1, 0xcb, base + 7].forEach((byte, offset) => ram.write(0x2000 + value * 3 + offset, byte));
        ram.write(0x8000 + value * 2, f);
        ram.write(0x8001 + value * 2, value);
      }
      const cpu = new CpuZ80(ram, initialState({ sp: 0x8000 }));
      for (let value = 0; value < 256; value++) {
        const loaded = cpu.step();
        assert.equal(loaded.after.a, value);
        assert.deepEqual(loaded.after.flags, flags);
        const expected = expectedCb(name, bit, value, flags);
        const record = cpu.step();
        assert.equal(record.outcome, "executed");
        assert.deepEqual(record.after, { ...loaded.after, a: expected.value, flags: expected.flags,
          pc: loaded.after.pc + 2, r: 0x80 + (loaded.after.r + 2) % 128 });
      }
    }
  }
});

test("Z80 CB memory operations wrap instruction fetches and retain overlapping reads and writes", () => {
  for (const { name, bit, base } of cbRows) {
    const opcode = base + 6;
    for (const pc of [0, 0xfffe, 0xffff]) {
      for (const address of [0, 0xffff, pc, (pc + 1) % 65536, 0x1234]) {
        const ram = new ObservedRam();
        ram.write(address, 0xa5);
        ram.write(pc, 0xcb);
        ram.write((pc + 1) % 65536, opcode);
        const value = ram.read(address);
        const before = initialState({ pc, r: 0xff, h: Math.floor(address / 256), l: address % 256 });
        const expected = expectedCb(name, bit, value, before.flags);
        const accesses: CpuZ80MemoryAccess[] = [
          { kind: "read", address: pc, value: 0xcb }, { kind: "read", address: (pc + 1) % 65536, value: opcode },
          { kind: "read", address, value },
        ];
        if (name !== "BIT") accesses.push({ kind: "write", address, value: expected.value });
        ram.accesses.length = 0;
        const cpu = new CpuZ80(ram, before);
        const record = cpu.step();
        assert.deepEqual(record, { before: snapshot(before), after: snapshot({ ...before, flags: expected.flags,
          pc: (pc + 2) % 65536, r: 0x81 }), accesses,
          instruction: { address: pc, bytes: [0xcb, opcode] }, outcome: "executed" });
        assert.deepEqual(ram.accesses, accesses);
        assert.equal(ram.read(address), expected.value);
        const saved = structuredClone(record);
        ram.write(address, 0);
        cpu.reset();
        assert.deepEqual(record, saved);
      }
    }
  }
});

test("Z80 CB SLL encodings reject both fetched bytes atomically and read current RAM on retry", () => {
  for (let opcode = 0x30; opcode <= 0x37; opcode++) {
    for (const pc of [0x2000, 0xffff]) {
      const ram = new ObservedRam();
      const before = initialState({ pc, r: 0x7f });
      ram.write(pc, 0xcb);
      ram.write((pc + 1) % 65536, opcode);
      const cpu = new CpuZ80(ram, before);
      for (let attempt = 0; attempt < 2; attempt++) {
        ram.accesses.length = 0;
        const record = cpu.step();
        assert.deepEqual(record, { before: snapshot(before), after: snapshot(before), outcome: "unsupported", reason: "opcode",
          instruction: { address: pc, bytes: [0xcb, opcode] }, accesses: [
            { kind: "read", address: pc, value: 0xcb }, { kind: "read", address: (pc + 1) % 65536, value: opcode },
          ] });
        assert.deepEqual(ram.accesses, record.accesses);
      }
      ram.write((pc + 1) % 65536, 0xff); // SET 7,A
      const executed = cpu.step();
      assert.equal(executed.outcome, "executed");
      assert.deepEqual(executed.after, snapshot({ ...before, a: 0x91, pc: (pc + 2) % 65536, r: 1 }));
    }
  }
});

test("Z80 CB memory forms follow live HL and RAM; POP reads caller edits to the current stack", () => {
  const ram = new ObservedRam();
  [0x21, 0, 0x10, 0xcb, 0x86, 0xcb, 0x3e, 0x21, 0xff, 0xff, 0xcb, 0xfe, 0xe5, 0xe1]
    .forEach((byte, offset) => ram.write(0x2000 + offset, byte));
  ram.write(0x1000, 0xff);
  ram.write(0xffff, 0);
  const cpu = new CpuZ80(ram, initialState());
  cpu.step(); // LD HL,1000
  const resetBit = cpu.step(); // RES 0,(HL)
  assert.equal(ram.read(0x1000), 0xfe);
  const saved = structuredClone(resetBit);
  ram.write(0x1000, 0x81);
  const shifted = cpu.step(); // SRL (HL)
  assert.deepEqual(shifted.accesses.slice(2), [{ kind: "read", address: 0x1000, value: 0x81 },
    { kind: "write", address: 0x1000, value: 0x40 }]);
  assert.equal(shifted.after.flags.c, true);
  cpu.step(); // LD HL,FFFF
  const setBit = cpu.step(); // SET 7,(HL)
  assert.deepEqual(setBit.accesses.slice(2), [{ kind: "read", address: 0xffff, value: 0 },
    { kind: "write", address: 0xffff, value: 0x80 }]);
  assert.deepEqual(setBit.after.flags, shifted.after.flags);
  const pushed = cpu.step(); // PUSH HL
  ram.write(pushed.after.sp, 0x34);
  ram.write(pushed.after.sp + 1, 0x12);
  const popped = cpu.step(); // POP HL
  assert.equal(popped.after.hl, 0x1234);
  assert.equal(popped.after.sp, 0xabcd);
  assert.deepEqual(popped.accesses.slice(1), [{ kind: "read", address: 0xabcb, value: 0x34 },
    { kind: "read", address: 0xabcc, value: 0x12 }]);
  assert.deepEqual(resetBit, saved);
});

for (const [opcode, left] of [[0x67, false], [0x6f, true]] as const) {
  test(`Z80 ${left ? "RLD" : "RRD"} covers every A/memory pair and preserves carry`, () => {
    const ram = new ObservedRam();
    const check = (a: number, value: number, flags: CpuZ80Flags, address = 0xffff) => {
      const before = initialState({ a, flags, h: Math.floor(address / 256), l: address % 256 });
      // Rotate the three hexadecimal digits as characters, independently of core nibble masks.
      const digits = (a % 16).toString(16) + value.toString(16).padStart(2, "0");
      const rotated = left ? digits.slice(1) + digits[0] : digits[2] + digits.slice(0, 2);
      const nextA = Math.floor(a / 16) * 16 + Number.parseInt(rotated[0]!, 16);
      const nextMemory = Number.parseInt(rotated.slice(1), 16);
      ram.write(address, value);
      checkPrefixedStep(ram, before, [0xed, opcode], { a: nextA, flags: {
        s: nextA >= 128, z: nextA === 0, h: false,
        pv: nextA.toString(2).replaceAll("0", "").length % 2 === 0, n: false, c: flags.c,
      } }, [readAccess(address, value), writeAccess(address, nextMemory)]);
    };
    for (let a = 0; a < 256; a++) for (let value = 0; value < 256; value++) check(a, value, flagPattern((a + value) % 64));
    for (let bits = 0; bits < 64; bits++) for (const a of [0, 0x11, 0x7f, 0x80, 0xff]) for (const value of [0, 0x11, 0x7f, 0x80, 0xff]) check(a, value, flagPattern(bits));
    check(0xed, 0xed, flagPattern(63), 0x2000);
    check(0x11, opcode, flagPattern(0), 0x2001);
  });
}
