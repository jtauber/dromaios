import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../../src/components/cpus/generated/z80-cpu.js";
import type { CpuZ80Flags } from "../../../../src/components/cpus/generated/z80-cpu.js";
import { Cpu8080 } from "../../../../src/components/cpus/generated/8080-cpu.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, snapshot, flagPattern, transferColumns, aluForms, expectedAlu, checkBaseStep, checkPrefixedStep } from "./helpers.js";

// Literal register encodings from the manual; memory INC/DEC have separate access tests.
const byteRegisterCases = [
  { register: "a", load: 0x3e, increment: 0x3c, decrement: 0x3d },
  { register: "b", load: 0x06, increment: 0x04, decrement: 0x05 },
  { register: "c", load: 0x0e, increment: 0x0c, decrement: 0x0d },
  { register: "d", load: 0x16, increment: 0x14, decrement: 0x15 },
  { register: "e", load: 0x1e, increment: 0x1c, decrement: 0x1d },
  { register: "h", load: 0x26, increment: 0x24, decrement: 0x25 },
  { register: "l", load: 0x2e, increment: 0x2c, decrement: 0x2d },
] as const;

for (const { register, load, increment, decrement } of byteRegisterCases) {
  test(`Z80 LD ${register.toUpperCase()},n handles every byte and preserves every flag combination and alternate state`, () => {
    const ram = new ObservedRam();
    for (const [pc, operandAddress, nextPc] of [[0x2000, 0x2001, 0x2002], [0xffff, 0, 1]] as const) {
      ram.write(pc, load);
      for (let bits = 0; bits < 64; bits++) {
        for (let value = 0; value < 256; value++) {
          ram.write(operandAddress, value);
          ram.accesses.length = 0;
          const before = initialState({ pc, flags: flagPattern(bits) });
          const cpu = new CpuZ80(ram, before);
          const record = cpu.step();
          assert.deepEqual(record, {
            before: snapshot(before), after: snapshot({ ...before, [register]: value, pc: nextPc, r: 0xff }),
            instruction: { address: pc, bytes: [load, value] }, outcome: "executed",
            accesses: [{ kind: "read", address: pc, value: load }, { kind: "read", address: operandAddress, value }],
          });
          assert.deepEqual(cpu.snapshot(), record.after);
          assert.deepEqual(ram.accesses, record.accesses);
        }
      }
    }
  });

  for (const [mnemonic, opcode, delta] of [["INC", increment, 1], ["DEC", decrement, -1]] as const) {
    test(`Z80 ${mnemonic} ${register.toUpperCase()} handles every byte and flag pattern, preserving carry and the alternate bank`, () => {
      const ram = new ObservedRam();
      ram.write(0xffff, opcode);
      for (let value = 0; value < 256; value++) {
        const result = (value + delta + 256) % 256;
        const signedResult = (value < 128 ? value : value - 256) + delta;
        const lowDigitResult = value % 16 + delta;
        for (let bits = 0; bits < 64; bits++) {
          const flags = flagPattern(bits);
          const before = initialState({ [register]: value, flags, pc: 0xffff, r: 0xff });
          const cpu = new CpuZ80(ram, before);
          ram.accesses.length = 0;
          const record = cpu.step();
          assert.deepEqual(record, {
            before: snapshot(before),
            after: snapshot({ ...before, [register]: result, pc: 0, r: 0x80,
              flags: { s: result >= 128, z: result === 0, h: lowDigitResult < 0 || lowDigitResult > 15,
                pv: signedResult < -128 || signedResult > 127, n: delta === -1, c: flags.c } }),
            instruction: { address: 0xffff, bytes: [opcode] }, outcome: "executed",
            accesses: [{ kind: "read", address: 0xffff, value: opcode }],
          });
          assert.deepEqual(cpu.snapshot(), record.after);
          assert.deepEqual(ram.accesses, record.accesses);
        }
      }
    });
  }
}

for (const { name, opcodes, immediate } of aluForms) {
  test(`Z80 ${name} covers every operand form and incoming flag pattern with exact records`, () => {
    const ram = new ObservedRam();
    const forms = [...opcodes.map((opcode, index) => ({ opcode, source: transferColumns[index]! })),
      { opcode: immediate, source: "immediate" as const }];
    for (const { opcode, source } of forms) {
      for (const value of [0, 1, 0x0f, 0x10, 0x7f, 0x80, 0xfe, 0xff]) {
        for (const a of source === "a" ? [value] : [0, 0x11, 0x7f, 0x80, 0xff]) {
          for (let bits = 0; bits < 64; bits++) {
            const before = initialState({ a, flags: flagPattern(bits), pc: 0xffff });
            if (source !== "(hl)" && source !== "immediate") before[source] = value;
            const address = before.h * 256 + before.l;
            ram.write(address, value);
            ram.write(0xffff, opcode);
            ram.write(0, value);
            ram.accesses.length = 0;
            const bytes = source === "immediate" ? [opcode, value] : [opcode];
            const reads = [[0xffff, opcode], ...(source === "(hl)" ? [[address, value]]
              : source === "immediate" ? [[0, value]] : [])];
            const cpu = new CpuZ80(ram, before);
            const record = cpu.step();
            assert.deepEqual(record, { before: snapshot(before),
              after: snapshot({ ...before, ...expectedAlu(name, before.a, value, before.flags.c), pc: bytes.length - 1, r: 0xff }),
              instruction: { address: 0xffff, bytes }, outcome: "executed",
              accesses: reads.map(([address, value]) => ({ kind: "read", address, value })),
            }, `${name} ${source}: A=${before.a}, operand=${value}, flags=${bits}`);
            assert.deepEqual(ram.accesses, record.accesses);
            assert.deepEqual(cpu.snapshot(), record.after);
          }
        }
      }
    }
  });

  test(`Z80 ${name} exhausts every accumulator/operand pair and both carry inputs`, () => {
    const ram = new Ram(0x10000);
    for (const carry of [false, true]) {
      for (let a = 0; a < 256; a++) {
        // CP establishes C before each independent case; LD preserves it for ADC/SBC.
        // One CPU executes a full row, avoiding a fresh decoder for every pair.
        for (let value = 0; value < 256; value++) {
          [0x3e, 0, 0xfe, carry ? 1 : 0, 0x3e, a, immediate, value].forEach((byte, offset) =>
            ram.write(0x2000 + value * 8 + offset, byte));
        }
        const before = initialState({ r: 0xfe });
        const cpu = new CpuZ80(ram, before);
        for (let value = 0; value < 256; value++) {
          cpu.step(); // LD A,0
          const setup = cpu.step(); // CP 00/01: no borrow / borrow
          assert.equal(setup.after.flags.c, carry);
          cpu.step(); // LD A,a
          const record = cpu.step();
          assert.equal(record.outcome, "executed");
          assert.deepEqual(record.after, snapshot({ ...before, ...expectedAlu(name, a, value, carry),
            pc: 0x2008 + value * 8, r: 0x80 + (126 + (value + 1) * 4) % 128,
          }), `${name}: A=${a}, operand=${value}, C=${carry}`);
        }
      }
    }
  });

  test(`Z80 ${name} (HL) retains repeated reads when data overlaps the opcode`, () => {
    for (const pc of [0, 0x2000, 0xffff]) {
      const opcode = opcodes[6];
      const ram = new ObservedRam();
      ram.write(pc, opcode);
      ram.accesses.length = 0;
      const before = initialState({ pc, h: Math.floor(pc / 256), l: pc % 256, a: 0x7f });
      const record = new CpuZ80(ram, before).step();
      assert.deepEqual(record, { before: snapshot(before),
        after: snapshot({ ...before, ...expectedAlu(name, before.a, opcode, before.flags.c), pc: (pc + 1) % 65536, r: 0xff }),
        instruction: { address: pc, bytes: [opcode] }, outcome: "executed",
        accesses: [{ kind: "read", address: pc, value: opcode }, { kind: "read", address: pc, value: opcode }] });
      assert.deepEqual(ram.accesses, record.accesses);
    }
  });

  test(`Z80 ${name} uses live registers, pointers, operands, and carry while retaining earlier records`, () => {
    const ram = new ObservedRam();
    const program = [0x06, 0x80, opcodes[0], 0x21, 0xff, 0xff, opcodes[6], immediate, 0];
    program.forEach((byte, offset) => ram.write(0x2000 + offset, byte));
    ram.write(0xffff, 1);
    const cpu = new CpuZ80(ram, initialState({ a: 0x7f, flags: flagPattern(63) }));
    cpu.step(); // LD B,80 changes the source register after decoder construction.
    const first = cpu.step();
    assert.deepEqual(first.after, snapshot({ ...first.before, ...expectedAlu(name, 0x7f, 0x80, true), pc: 0x2003, r: 0x80 }));
    const savedFirst = structuredClone(first);
    cpu.step(); // LD HL,FFFF selects a new data address.
    ram.write(0xffff, 0xff);
    ram.write(0x2008, 9);
    for (const [opcode, operand, address, length] of [[opcodes[6], 0xff, 0xffff, 1], [immediate, 9, 0x2008, 2]] as const) {
      const before = cpu.snapshot();
      ram.accesses.length = 0;
      const record = cpu.step();
      assert.deepEqual(record, { before,
        after: snapshot({ ...before, ...expectedAlu(name, before.a, operand, before.flags.c), pc: before.pc + length, r: before.r + 1 }),
        instruction: { address: before.pc, bytes: length === 1 ? [opcode] : [opcode, operand] }, outcome: "executed",
        accesses: [{ kind: "read", address: before.pc, value: opcode }, { kind: "read", address, value: operand }] });
      assert.deepEqual(ram.accesses, record.accesses);
    }
    assert.deepEqual(first, savedFirst);
    const live = cpu.snapshot();
    Reflect.set(first.after.flags, "c", !live.flags.c);
    Reflect.set(first.after.alternate, "a", 0);
    assert.deepEqual(cpu.snapshot(), live);
    cpu.reset();
    ram.write(0xffff, 0);
    assert.deepEqual(first.before, savedFirst.before);
  });
}

test("Z80 SBC and ADC pass live borrow/carry into the next operation, including A as its own source", () => {
  const ram = new Ram(0x10000);
  [0xde, 0, 0xce, 0, 0x9f, 0xbf, 0xee, 0xff].forEach((byte, offset) => ram.write(0x2000 + offset, byte));
  const cpu = new CpuZ80(ram, initialState({ a: 0, flags: flagPattern(63) }));
  const expected = [
    { a: 0xff, flags: { s: true, z: false, h: true, pv: false, n: true, c: true } },
    { a: 0, flags: { s: false, z: true, h: true, pv: false, n: false, c: true } },
    { a: 0xff, flags: { s: true, z: false, h: true, pv: false, n: true, c: true } },
    { a: 0xff, flags: { s: false, z: true, h: false, pv: false, n: true, c: false } },
    { a: 0, flags: { s: false, z: true, h: false, pv: true, n: false, c: false } },
  ];
  for (const next of expected) {
    const record = cpu.step();
    assert.equal(record.outcome, "executed");
    assert.equal(record.after.a, next.a);
    assert.deepEqual(record.after.flags, next.flags);
  }
});

test("8080 and Z80 ALU encodings retain their distinct half-carry and parity/overflow rules", () => {
  for (const [opcode, a, operand, carry, result, h, ac, pv, p, n, c] of [
    [0xce, 0x7f, 0, true, 0x80, true, true, true, false, false, false],
    [0xde, 0x80, 0, true, 0x7f, true, false, true, false, true, false],
    [0xd6, 0x10, 1, true, 0x0f, true, false, false, true, true, false],
    [0xd6, 0, 1, false, 0xff, true, false, false, true, true, true],
    [0xe6, 0, 0, true, 0, true, false, true, true, false, false],
    [0xee, 0x80, 0x80, true, 0, false, false, true, true, false, false],
    [0xf6, 0x80, 1, true, 0x81, false, false, true, true, false, false],
  ] as const) {
    const ram = new Ram(0x10000);
    ram.write(0x2000, opcode);
    ram.write(0x2001, operand);
    const z80 = new CpuZ80(ram, initialState({ a, flags: { ...flagPattern(63), c: carry } })).step();
    const intel = new Cpu8080(ram, { a, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0x2000, sp: 0,
      flags: { s: true, z: true, ac: true, p: true, cy: carry }, interruptEnabled: false, interruptDeferred: false, halted: false }).step();
    assert.equal(z80.outcome, "executed");
    assert.equal(intel.outcome, "executed");
    assert.deepEqual(z80.instruction, intel.instruction);
    assert.deepEqual(z80.accesses, intel.accesses);
    assert.equal(z80.after.a, result);
    assert.equal(intel.after.a, result);
    assert.deepEqual(z80.after.flags, { s: result >= 128, z: result === 0, h, pv, n, c });
    assert.deepEqual(intel.after.flags, { s: result >= 128, z: result === 0, ac, p, cy: c });
  }
});

test("8080 and Z80 share these instruction bytes but arithmetic P and P/V mean different things", () => {
  for (const [a, value, result, p, pv, h, c] of [
    [2, 3, 5, true, false, false, false],
    [0x7f, 1, 0x80, false, true, true, false],
    [0x80, 0x80, 0, true, true, false, true],
    [0xff, 1, 0, true, false, true, true],
    [1, 1, 2, false, false, false, false],
  ] as const) {
    for (let bits = 0; bits < 64; bits++) {
      const intelRam = new ObservedRam();
      const zilogRam = new ObservedRam();
      const program = [0x3e, a, 0xc6, value, 0x32, 0x80, 0, 0x76];
      for (const ram of [intelRam, zilogRam]) {
        program.forEach((byte, address) => ram.write(address, byte));
        ram.accesses.length = 0;
      }
      const zilog = new CpuZ80(zilogRam, initialState({ pc: 0, r: 0, flags: flagPattern(bits) }));
      const intel = new Cpu8080(intelRam, {
        a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0, sp: 0,
        flags: { s: false, z: false, ac: false, p: false, cy: false }, interruptEnabled: false, interruptDeferred: false, halted: false,
      });
      for (let step = 0; step < 4; step++) {
        const i = intel.step();
        const z = zilog.step();
        assert.deepEqual(z.instruction, i.instruction);
        assert.deepEqual(z.accesses, i.accesses);
        assert.equal(z.after.a, step === 0 ? a : result);
        assert.equal(i.after.a, z.after.a);
        assert.equal(z.after.pc, i.after.pc);
        assert.equal(z.after.r, step + 1);
        if (step >= 1) {
          assert.deepEqual(z.after.flags, { s: result >= 128, z: result === 0, h, pv, n: false, c });
          assert.deepEqual(i.after.flags, { s: result >= 128, z: result === 0, ac: h, p, cy: c });
        }
      }
      assert.deepEqual(zilogRam.accesses, intelRam.accesses);
      assert.equal(zilogRam.read(0x80), result);
      assert.equal(intelRam.read(0x80), result);
      assert.equal(zilog.snapshot().halted, true);
      assert.equal(intel.snapshot().halted, true);
    }
  }
});

for (const [name, opcode] of [["RLCA", 0x07], ["RRCA", 0x0f], ["RLA", 0x17], ["RRA", 0x1f], ["CPL", 0x2f], ["SCF", 0x37], ["CCF", 0x3f]] as const) {
  test(`Z80 ${name} exhausts A and flag combinations, preserving exactly its documented flags`, () => {
    const ram = new ObservedRam();
    for (let a = 0; a < 256; a++) for (let bits = 0; bits < 64; bits++) {
      const before = initialState({ a, pc: 0xffff, r: 0xff, flags: flagPattern(bits) });
      let result = a;
      const flags = { ...before.flags, h: false, n: false };
      if (name === "CPL") { result = 255 - a; flags.h = flags.n = true; }
      else if (name === "SCF") flags.c = true;
      else if (name === "CCF") { flags.h = before.flags.c; flags.c = !before.flags.c; }
      else {
        const digits = a.toString(2).padStart(8, "0");
        const left = name === "RLCA" || name === "RLA";
        const outgoing = left ? digits[0]! : digits[7]!;
        const incoming = name === "RLCA" || name === "RRCA" ? outgoing : String(Number(before.flags.c));
        result = parseInt(left ? digits.slice(1) + incoming : incoming + digits.slice(0, -1), 2);
        flags.c = outgoing === "1";
      }
      checkBaseStep(ram, before, [opcode], { a: result, flags });
    }
  });
}

test("Z80 accumulator rotates preserve S/Z/PV while their CB counterparts derive them from the result", () => {
  const ram = new ObservedRam();
  for (const [unprefixed, cb] of [[0x07, 0x07], [0x0f, 0x0f], [0x17, 0x17], [0x1f, 0x1f]]) {
    const before = initialState({ a: 0, flags: { s: true, z: false, h: true, pv: false, n: true, c: false } });
    checkBaseStep(ram, before, [unprefixed!], { flags: { ...before.flags, h: false, n: false } });
    ram.write(before.pc, 0xcb); ram.write(before.pc + 1, cb!);
    const record = new CpuZ80(ram, before).step();
    assert.deepEqual(record.after.flags, { s: false, z: true, h: false, pv: true, n: false, c: false });
  }
});

function adjustedDecimal(a: number, old: CpuZ80Flags) {
  const units = a % 16, tens = Math.floor(a / 16);
  // Decimal columns select one of four adjustments; the table also defines arbitrary caller-supplied states.
  const lowCorrection = old.h || units >= 10;
  const carry = old.c || tens * 10 + units >= 100;
  const amount = [0, 6, 96, 102][Number(lowCorrection) + 2 * Number(carry)]!;
  const result = (a + (old.n ? -amount : amount) + 256) % 256;
  const lowTotal = units + (old.n ? -amount % 16 : amount % 16);
  return { a: result, flags: { s: result >= 128, z: result === 0, h: lowTotal < 0 || lowTotal >= 16,
    pv: result.toString(2).replaceAll("0", "").length % 2 === 0, n: old.n, c: carry } };
}

test("Z80 DAA covers every A and flag state, including subtraction states outside valid BCD arithmetic", () => {
  const ram = new ObservedRam();
  for (let a = 0; a < 256; a++) for (let bits = 0; bits < 64; bits++) {
    const before = initialState({ a, flags: flagPattern(bits), pc: 0xffff });
    checkBaseStep(ram, before, [0x27], adjustedDecimal(a, before.flags));
  }
});

test("Z80 ADC/SBC followed by DAA matches decimal arithmetic for every valid packed-BCD pair and carry/borrow", () => {
  const ram = new ObservedRam();
  const bcd = (value: number) => Math.floor(value / 10) * 16 + value % 10;
  for (const subtract of [false, true]) for (let left = 0; left < 100; left++) for (let right = 0; right < 100; right++) for (const carry of [false, true]) {
    const total = left + (subtract ? -right - Number(carry) : right + Number(carry));
    const result = bcd((total + 100) % 100);
    const before = initialState({ a: bcd(left), flags: { ...flagPattern(63), c: carry } });
    const bytes = [subtract ? 0xde : 0xce, bcd(right), 0x27];
    bytes.forEach((value, i) => ram.write(before.pc + i, value));
    const cpu = new CpuZ80(ram, before);
    cpu.step();
    const decimal = cpu.step();
    assert.equal(decimal.after.a, result);
    assert.equal(decimal.after.flags.c, total < 0 || total >= 100);
    assert.equal(decimal.after.flags.n, subtract);
    assert.equal(decimal.after.flags.s, result >= 128);
    assert.equal(decimal.after.flags.z, result === 0);
    assert.equal(decimal.after.flags.pv, result.toString(2).replaceAll("0", "").length % 2 === 0);
    assert.deepEqual(decimal.after.alternate, snapshot(before).alternate);
  }
});

for (const [opcode, delta] of [[0x34, 1], [0x35, -1]] as const) {
  test(`Z80 ${delta === 1 ? "INC" : "DEC"} (HL) exhausts byte/flag values and records an explicit read then write`, () => {
    const ram = new ObservedRam();
    for (let value = 0; value < 256; value++) for (let bits = 0; bits < 64; bits++) {
      const before = initialState({ h: 0xff, l: 0xff, flags: flagPattern(bits) });
      const result = (value + delta + 256) % 256;
      const signed = (value < 128 ? value : value - 256) + delta;
      ram.write(0xffff, value);
      checkBaseStep(ram, before, [opcode], { flags: { s: result >= 128, z: result === 0,
        h: value % 16 + delta < 0 || value % 16 + delta > 15,
        pv: signed < -128 || signed > 127, n: delta < 0, c: before.flags.c } },
      [{ kind: "read", address: 0xffff, value }, { kind: "write", address: 0xffff, value: result }]);
    }
    const before = initialState({ pc: 0xffff, h: 0xff, l: 0xff });
    const result = opcode + delta;
    checkBaseStep(ram, before, [opcode], { flags: { s: false, z: false, h: false, pv: false, n: delta < 0, c: false } },
      [{ kind: "read", address: 0xffff, value: opcode }, { kind: "write", address: 0xffff, value: result }]);
  });
}

test("Z80 NEG checks every A and flag pattern, including zero and signed overflow", () => {
  const ram = new ObservedRam();
  for (let a = 0; a < 256; a++) for (let bits = 0; bits < 64; bits++) {
    checkPrefixedStep(ram, initialState({ a, flags: flagPattern(bits) }), [0xed, 0x44], expectedAlu("SUB", 0, a, false));
  }
});
