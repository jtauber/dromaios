import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../../src/components/cpus/generated/z80-cpu.js";
import type { CpuZ80Flags, CpuZ80MemoryAccess } from "../../../../src/components/cpus/generated/z80-cpu.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, bankSnapshot, snapshot, flagPattern, checkBaseStep } from "./helpers.js";

// Truth sets use Z:C as a two-bit value, independent of the CPU's condition selectors.
const relativeJumps: readonly { mnemonic: string; opcode: number; takenConditions: readonly number[] }[] = [
  { mnemonic: "JR", opcode: 0x18, takenConditions: [0, 1, 2, 3] },
  { mnemonic: "JR NZ", opcode: 0x20, takenConditions: [0, 1] },
  { mnemonic: "JR Z", opcode: 0x28, takenConditions: [2, 3] },
  { mnemonic: "JR NC", opcode: 0x30, takenConditions: [0, 2] },
  { mnemonic: "JR C", opcode: 0x38, takenConditions: [1, 3] },
];

for (const { mnemonic, opcode, takenConditions } of relativeJumps) {
  test(`Z80 ${mnemonic} checks the correct flags and wraps signed targets while fetching both bytes on every path`, () => {
    const ram = new ObservedRam();
    for (const [pc, operandAddress, displacement, fallthrough, target] of [
      [0x1234, 0x1235, 0x00, 0x1236, 0x1236],
      [0x1234, 0x1235, 0x7f, 0x1236, 0x12b5],
      [0x1234, 0x1235, 0x80, 0x1236, 0x11b6],
      [0x1234, 0x1235, 0xfe, 0x1236, 0x1234],
      [0x1234, 0x1235, 0xff, 0x1236, 0x1235],
      [0x12fd, 0x12fe, 0x01, 0x12ff, 0x1300],
      [0x0000, 0x0001, 0x80, 0x0002, 0xff82],
      [0xfffd, 0xfffe, 0x01, 0xffff, 0x0000],
      [0xfffe, 0xffff, 0xff, 0x0000, 0xffff],
      [0xffff, 0x0000, 0xfe, 0x0001, 0xffff],
    ] as const) {
      ram.write(pc, opcode);
      ram.write(operandAddress, displacement);
      for (let bits = 0; bits < 64; bits++) {
        const flags = flagPattern(bits);
        const before = initialState({ pc, flags, r: 0x7f });
        const take = takenConditions.includes(Number(flags.z) * 2 + Number(flags.c));
        const cpu = new CpuZ80(ram, before);
        ram.accesses.length = 0;
        const record = cpu.step();
        assert.deepEqual(record, {
          before: snapshot(before), after: snapshot({ ...before, pc: take ? target : fallthrough, r: 0 }),
          instruction: { address: pc, bytes: [opcode, displacement] }, outcome: "executed",
          accesses: [
            { kind: "read", address: pc, value: opcode },
            { kind: "read", address: operandAddress, value: displacement },
          ],
        });
        assert.deepEqual(cpu.snapshot(), record.after);
        assert.deepEqual(ram.accesses, record.accesses);
      }
    }
  });
}

test("Z80 DJNZ decrements every B value, ignores and preserves all flags, and updates the BC view", () => {
  const ram = new ObservedRam();
  ram.write(0xffff, 0x10);
  ram.write(0, 0xfe);
  for (let b = 0; b < 256; b++) {
    for (let bits = 0; bits < 64; bits++) {
      const before = initialState({ b, pc: 0xffff, r: 0x7f, flags: flagPattern(bits) });
      const cpu = new CpuZ80(ram, before);
      ram.accesses.length = 0;
      const record = cpu.step();
      assert.deepEqual(record, {
        before: snapshot(before),
        after: snapshot({ ...before, b: (b + 255) % 256, pc: b === 1 ? 1 : 0xffff, r: 0 }),
        instruction: { address: 0xffff, bytes: [0x10, 0xfe] }, outcome: "executed",
        accesses: [{ kind: "read", address: 0xffff, value: 0x10 }, { kind: "read", address: 0, value: 0xfe }],
      });
      assert.deepEqual(cpu.snapshot(), record.after);
      assert.deepEqual(ram.accesses, record.accesses);
    }
  }
});

test("Z80 JR and DJNZ decode every displacement from PC after the operand, on each available path", () => {
  const ram = new ObservedRam();
  const operand = new DataView(new ArrayBuffer(1));
  // Opcode, B, flagPattern input, taken. DJNZ includes wrap from B=00 to FF.
  for (const [opcode, b, bits, take] of [
    [0x18, 0x22, 0, true],
    [0x20, 0x22, 0, true], [0x20, 0x22, 2, false],
    [0x28, 0x22, 2, true], [0x28, 0x22, 0, false],
    [0x30, 0x22, 0, true], [0x30, 0x22, 32, false],
    [0x38, 0x22, 32, true], [0x38, 0x22, 0, false],
    [0x10, 0, 63, true], [0x10, 1, 0, false],
  ] as const) {
    for (const pc of [0, 0x2000, 0xffff]) {
      ram.write(pc, opcode);
      for (let displacement = 0; displacement < 256; displacement++) {
        ram.write((pc + 1) % 65536, displacement);
        operand.setUint8(0, displacement);
        const before = initialState({ b, pc, r: 0xff, flags: flagPattern(bits) });
        const target = (pc + 2 + (take ? operand.getInt8(0) : 0) + 65536) % 65536;
        const cpu = new CpuZ80(ram, before);
        ram.accesses.length = 0;
        const record = cpu.step();
        assert.deepEqual(record, {
          before: snapshot(before),
          after: snapshot({ ...before, b: opcode === 0x10 ? (b + 255) % 256 : b, pc: target, r: 0x80 }),
          instruction: { address: pc, bytes: [opcode, displacement] }, outcome: "executed",
          accesses: [
            { kind: "read", address: pc, value: opcode },
            { kind: "read", address: (pc + 1) % 65536, value: displacement },
          ],
        });
        assert.deepEqual(ram.accesses, record.accesses);
      }
    }
  }
});

test("Z80 jumps use live flags after ADD replaces them, DJNZ preserves them, and INC changes them", () => {
  const ram = new ObservedRam();
  for (const [offset, byte] of [
    0xc6, 1, 0x10, 2, 0x28, 2, 0, 0, 0x0c, 0x30, 2, 0x20, 2, 0, 0,
  ].entries()) ram.write(0x2000 + offset, byte);
  const before = initialState({ a: 0xff, b: 1 });
  const cpu = new CpuZ80(ram, before);
  const afterAdd = { ...before, a: 0, pc: 0x2002, r: 0xff,
    flags: { s: false, z: true, h: true, pv: false, n: false, c: true } };
  assert.deepEqual(cpu.step().after, snapshot(afterAdd));
  const afterDjnz = { ...afterAdd, b: 0, pc: 0x2004, r: 0x80 };
  assert.deepEqual(cpu.step().after, snapshot(afterDjnz));
  assert.deepEqual(cpu.step().after, snapshot({ ...afterDjnz, pc: 0x2008, r: 0x81 }));
  const afterIncrement = { ...afterDjnz, c: 0x34, pc: 0x2009, r: 0x82,
    flags: { s: false, z: false, h: false, pv: false, n: false, c: true } };
  assert.deepEqual(cpu.step().after, snapshot(afterIncrement));
  assert.deepEqual(cpu.step().after, snapshot({ ...afterIncrement, pc: 0x200b, r: 0x83 })); // JR NC untaken
  assert.deepEqual(cpu.step().after, snapshot({ ...afterIncrement, pc: 0x200f, r: 0x84 })); // JR NZ taken
});

test("Z80 relative jumps and loads fetch current operands and retain independent records across reset and caller edits", () => {
  const ram = new ObservedRam();
  ram.write(0x2000, 0x10);
  ram.write(0x2001, 0xfe);
  ram.write(0x2002, 0x2e); // LD L,n
  ram.write(0x2003, 0);
  const cpu = new CpuZ80(ram, initialState({ b: 3 }));
  const first = cpu.step();
  const savedFirst = structuredClone(first);
  assert.equal(first.after.b, 2);
  assert.equal(first.after.pc, 0x2000);
  ram.write(0x2001, 0);
  const second = cpu.step();
  assert.equal(second.after.b, 1);
  assert.equal(second.after.pc, 0x2002);
  assert.deepEqual(second.instruction?.bytes, [0x10, 0]);
  ram.write(0x2003, 0x80);
  const loaded = cpu.step();
  assert.equal(loaded.after.l, 0x80);
  assert.equal(loaded.after.hl, 0x6680);
  assert.deepEqual(loaded.after.alternate, bankSnapshot(initialState().alternate));
  assert.deepEqual(first, savedFirst);
  const savedSecond = structuredClone(second);
  Reflect.set(first.after.flags, "z", true);
  Reflect.set(first.after.alternate, "l", 0);
  Reflect.set(first.after, "bc", 0);
  assert.ok(first.instruction);
  Reflect.set(first.instruction.bytes, 1, 0xff);
  assert.deepEqual(cpu.snapshot(), loaded.after);
  cpu.reset();
  ram.write(0x2001, 0xff);
  assert.deepEqual(second, savedSecond);
});

const stackForms = [
  { high: "b", low: "c", push: 0xc5, pop: 0xc1 }, { high: "d", low: "e", push: 0xd5, pop: 0xd1 },
  { high: "h", low: "l", push: 0xe5, pop: 0xe1 }, { high: "a", low: "flags", push: 0xf5, pop: 0xf1 },
] as const;

const callReturnForms = [
  { call: 0xcd, ret: 0xc9, take: (_flags: CpuZ80Flags) => true },
  { call: 0xc4, ret: 0xc0, take: (flags: CpuZ80Flags) => !flags.z },
  { call: 0xcc, ret: 0xc8, take: (flags: CpuZ80Flags) => flags.z },
  { call: 0xd4, ret: 0xd0, take: (flags: CpuZ80Flags) => !flags.c },
  { call: 0xdc, ret: 0xd8, take: (flags: CpuZ80Flags) => flags.c },
  { call: 0xe4, ret: 0xe0, take: (flags: CpuZ80Flags) => !flags.pv },
  { call: 0xec, ret: 0xe8, take: (flags: CpuZ80Flags) => flags.pv },
  { call: 0xf4, ret: 0xf0, take: (flags: CpuZ80Flags) => !flags.s },
  { call: 0xfc, ret: 0xf8, take: (flags: CpuZ80Flags) => flags.s },
];

for (const { high, low, push, pop } of stackForms) {
  test(`Z80 PUSH/POP ${high.toUpperCase()}${low === "flags" ? "F" : low.toUpperCase()} covers word boundaries, flags, and SP wrap`, () => {
    for (const sp of [0, 1, 0xff, 0x100, 0xfffe, 0xffff]) {
      for (const word of [0, 1, 0x7f80, 0x80ff, 0xff00, 0xffff]) {
        for (let bits = 0; bits < 64; bits++) {
          const ram = new ObservedRam();
          const before = initialState({ sp, flags: flagPattern(bits) });
          before[high] = Math.floor(word / 256);
          const flags = before.flags;
          const lowByte = low === "flags" ? Number(flags.s) * 128 + Number(flags.z) * 64 + Number(flags.h) * 16
            + Number(flags.pv) * 4 + Number(flags.n) * 2 + Number(flags.c) : word % 256;
          if (low !== "flags") before[low] = lowByte;
          ram.write(0x2000, push);
          ram.write(0x2001, pop);
          // A same-value push must still issue both writes.
          ram.write((sp + 65535) % 65536, before[high]);
          ram.write((sp + 65534) % 65536, lowByte);
          ram.accesses.length = 0;
          const cpu = new CpuZ80(ram, before);
          const pushed = cpu.step();
          assert.deepEqual(pushed, { before: snapshot(before), after: snapshot({ ...before, pc: 0x2001,
            sp: (sp + 65534) % 65536, r: 0xff }), outcome: "executed", instruction: { address: 0x2000, bytes: [push] },
            accesses: [{ kind: "read", address: 0x2000, value: push },
              { kind: "write", address: (sp + 65535) % 65536, value: before[high] },
              { kind: "write", address: (sp + 65534) % 65536, value: lowByte }] });
          assert.deepEqual(ram.accesses, pushed.accesses);
          ram.accesses.length = 0;
          const popped = cpu.step();
          assert.deepEqual(popped, { before: pushed.after, after: snapshot({ ...before, pc: 0x2002, r: 0x80 }),
            outcome: "executed", instruction: { address: 0x2001, bytes: [pop] },
            accesses: [{ kind: "read", address: 0x2001, value: pop },
              { kind: "read", address: (sp + 65534) % 65536, value: lowByte },
              { kind: "read", address: (sp + 65535) % 65536, value: before[high] }] });
          assert.deepEqual(ram.accesses, popped.accesses);
        }
      }
    }
  });
}

for (const { call, ret, take } of callReturnForms) {
  test(`Z80 CALL ${call.toString(16)} and RET ${ret.toString(16)} cover every flag pattern and wrapped/overlapping stack accesses`, () => {
    for (let bits = 0; bits < 64; bits++) {
      for (const pc of [0x2000, 0xfffd, 0xfffe, 0xffff]) {
        for (const sp of [0, 1, 0xffff, pc, (pc + 1) % 65536, (pc + 3) % 65536]) {
          const ram = new ObservedRam();
          const before = initialState({ pc, sp, r: bits * 4, flags: flagPattern(bits) });
          const taken = take(before.flags);
          const next = (pc + 3) % 65536;
          const bytes = [call, 0x34, 0x12];
          bytes.forEach((byte, offset) => ram.write((pc + offset) % 65536, byte));
          ram.accesses.length = 0;
          const cpu = new CpuZ80(ram, before);
          const record = cpu.step();
          const accesses: CpuZ80MemoryAccess[] = bytes.map((value, offset) => ({ kind: "read", address: (pc + offset) % 65536, value }));
          if (taken) accesses.push({ kind: "write", address: (sp + 65535) % 65536, value: Math.floor(next / 256) },
            { kind: "write", address: (sp + 65534) % 65536, value: next % 256 });
          assert.deepEqual(record, { before: snapshot(before), after: snapshot({ ...before,
            pc: taken ? 0x1234 : next, sp: taken ? (sp + 65534) % 65536 : sp,
            r: Math.floor(before.r / 128) * 128 + (before.r + 1) % 128 }), outcome: "executed",
            instruction: { address: pc, bytes }, accesses });
          assert.deepEqual(ram.accesses, accesses);
          // Test RET independently, so untaken calls do not hide a broken return condition.
          ram.write(sp, 0x78);
          ram.write((sp + 1) % 65536, 0x56);
          ram.write(pc, ret);
          const low = ram.read(sp), high = ram.read((sp + 1) % 65536);
          ram.accesses.length = 0;
          const returned = new CpuZ80(ram, before).step();
          const returnAccesses: CpuZ80MemoryAccess[] = [{ kind: "read", address: pc, value: ret }];
          if (taken) returnAccesses.push({ kind: "read", address: sp, value: low },
            { kind: "read", address: (sp + 1) % 65536, value: high });
          assert.deepEqual(returned, { before: snapshot(before), after: snapshot({ ...before,
            pc: taken ? high * 256 + low : (pc + 1) % 65536, sp: taken ? (sp + 2) % 65536 : sp,
            r: Math.floor(before.r / 128) * 128 + (before.r + 1) % 128 }), outcome: "executed",
            instruction: { address: pc, bytes: [ret] }, accesses: returnAccesses });
          assert.deepEqual(ram.accesses, returnAccesses);
        }
      }
    }
  });
}

test("Z80 stack and call/return forms increment R once for every initial R value", () => {
  const ram = new Ram(65536);
  const opcodes = [...stackForms.flatMap(form => [form.push, form.pop]), ...callReturnForms.flatMap(form => [form.call, form.ret])];
  for (const opcode of opcodes) {
    for (let r = 0; r < 256; r++) {
      ram.write(0x2000, opcode);
      const record = new CpuZ80(ram, initialState({ r })).step();
      assert.equal(record.outcome, "executed");
      assert.equal(record.after.r, Math.floor(r / 128) * 128 + (r + 1) % 128);
    }
  }
});

test("Z80 EX (SP),HL covers every stack address with low/high reads, high/low writes, and unchanged SP", () => {
  const ram = new ObservedRam();
  for (let sp = 0; sp < 65536; sp++) {
    const highAddress = (sp + 1) % 65536;
    const before = initialState({ sp, h: sp % 256, l: Math.floor(sp / 256), flags: flagPattern(sp % 64), pc: 0xffff });
    const low = sp === before.pc ? 0xe3 : 0xa5;
    const high = highAddress === before.pc ? 0xe3 : 0x5a;
    ram.write(sp, low); ram.write(highAddress, high);
    checkBaseStep(ram, before, [0xe3], { h: high, l: low }, [
      { kind: "read", address: sp, value: low }, { kind: "read", address: highAddress, value: high },
      { kind: "write", address: highAddress, value: before.h }, { kind: "write", address: sp, value: before.l },
    ]);
  }
});

// Truth sets encode Z,C,PV,S as bits 0,1,2,3, independently of the decoder's condition callbacks.
const absoluteJumps = [
  [0xc2, [0, 2, 4, 6, 8, 10, 12, 14]], [0xca, [1, 3, 5, 7, 9, 11, 13, 15]],
  [0xd2, [0, 1, 4, 5, 8, 9, 12, 13]], [0xda, [2, 3, 6, 7, 10, 11, 14, 15]],
  [0xe2, [0, 1, 2, 3, 8, 9, 10, 11]], [0xea, [4, 5, 6, 7, 12, 13, 14, 15]],
  [0xf2, [0, 1, 2, 3, 4, 5, 6, 7]], [0xfa, [8, 9, 10, 11, 12, 13, 14, 15]],
  [0xc3, Array.from({ length: 16 }, (_, i) => i)],
] as const;

test("Z80 absolute jumps test all conditions and flags, fetch both address bytes on each path, and do not read targets", () => {
  const ram = new ObservedRam();
  for (const [opcode, truthSet] of absoluteJumps) for (let bits = 0; bits < 64; bits++) {
    for (const pc of [0x2000, 0xfffe, 0xffff]) for (const target of [0, 1, 0x2000, 0x2001, 0x7fff, 0x8000, 0xffff]) {
      const flags = flagPattern(bits);
      const code = Number(flags.z) + 2 * Number(flags.c) + 4 * Number(flags.pv) + 8 * Number(flags.s);
      const take = (truthSet as readonly number[]).includes(code);
      checkBaseStep(ram, initialState({ pc, flags }), [opcode, target % 256, Math.floor(target / 256)], { pc: take ? target : (pc + 3) % 65536 });
    }
  }
});

test("Z80 RST uses every fixed vector as an ordinary call with wrapped return addresses and overlapping stack writes", () => {
  const ram = new ObservedRam();
  for (const [opcode, target] of [[0xc7, 0], [0xcf, 8], [0xd7, 0x10], [0xdf, 0x18], [0xe7, 0x20], [0xef, 0x28], [0xf7, 0x30], [0xff, 0x38]]) {
    for (let bits = 0; bits < 64; bits++) for (const pc of [0x2000, 0xffff, target!]) {
      for (const sp of [0, 1, 0xffff, pc, (pc + 1) % 65536, (pc + 2) % 65536]) {
        const before = initialState({ pc, sp, flags: flagPattern(bits), interruptDeferred: false, nmiDeferred: false, iff1: false, iff2: true });
        const next = (pc + 1) % 65536;
        checkBaseStep(ram, before, [opcode!], { pc: target!, sp: (sp + 65534) % 65536 }, [
          { kind: "write", address: (sp + 65535) % 65536, value: Math.floor(next / 256) },
          { kind: "write", address: (sp + 65534) % 65536, value: next % 256 },
        ]);
      }
    }
  }
});
