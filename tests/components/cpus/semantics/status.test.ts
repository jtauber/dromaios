import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTypeScriptTypes } from "node:module";
import { instructions as mos } from "../../../../src/components/cpus/generated/6502.js";
import { instructions as m6800 } from "../../../../src/components/cpus/generated/6800.js";
import { instructions as m6809 } from "../../../../src/components/cpus/generated/6809.js";
import { instructions as intel } from "../../../../src/components/cpus/generated/8080.js";
import { instructions as zilog } from "../../../../src/components/cpus/generated/z80.js";
import { stackState } from "../../../helpers/stack-forms.js";
import { flagRegister } from "../../../../src/components/cpus/flags.js";
import { cpuSymbols, capture, flagLiteral, flagValue, literal, or, readFlag, replaceFlags, select, value, writeRegister } from "../../../../src/components/cpus/semantics/model.js";
import type { Expression, FlagExpression, FlagPolicy, NumberExpression } from "../../../../src/components/cpus/semantics/model.js";
import { cpu6502StateDescription } from "../../../../src/components/cpus/semantics/generated/state/6502.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";

// Independently listed hardware bits; reserved bits are not stored flags.
const positions = { "6502": { n: 7, v: 6, d: 3, i: 2, z: 1, c: 0 }, "8080": { s: 7, z: 6, ac: 4, p: 2, cy: 0 },
  z80: { s: 7, z: 6, h: 4, pv: 2, n: 1, c: 0 } };
const decoded = (cpu: keyof typeof positions, byte: number) => Object.fromEntries(Object.entries(positions[cpu]).map(([flag, bit]) => [flag, Boolean(byte & 2 ** bit)]));

test("packed-status stacks capture pushes before callbacks and replace pop destinations only after all reads", () => {
  for (const cpu of ["6502", "8080", "z80"] as const) for (const push of [false, true]) {
    const mosCpu = cpu === "6502", count = mosCpu ? 1 : 2, size = mosCpu ? 256 : 65536;
    const execute = mosCpu ? push ? mos[0x08] : mos[0x28] : (cpu === "8080" ? intel : zilog)[push ? 0xf5 : 0xf1];
    for (let failAt = -1; failAt < count; failAt++) {
      const state = stackState(cpu, 0, 0x1234, 0), flags = state.flags;
      Object.assign(flags, decoded(cpu, 0xa5)); state.a = 0x5a;
      const events: number[][] = [], failure = new Error("status stack failure"); let accesses = 0;
      const access = (address: number, byte?: number) => {
        assert.equal(state.flags, flags); // Neither POP nor PLP replaces flags before the entire value is read.
        const index = accesses++;
        assert.equal(state.a, index === 0 ? 0x5a : 0x11);
        const expectedAddress = mosCpu ? push ? 0x100 : 0x101 : index === 0 ? push ? 0xffff : 0 : push ? 0x1ff : 0x201;
        assert.equal(address, expectedAddress);
        if (push) assert.equal(byte, mosCpu ? 0xb5 : index === 0 ? 0x5a : cpu === "8080" ? 0x87 : 0x85);
        if (index === failAt) throw failure;
        events.push([address, byte ?? [0x96, 0x34][index]!]);
        state.sp = mosCpu ? 0x40 : 0x200; state.a = 0x11;
        if (push) Object.assign(flags, decoded(cpu, 0xff));
        return [0x96, 0x34][index]!;
      };
      const run = () => execute(state, { readByte: address => access(address), writeByte: (address, byte) => { access(address, byte); } });
      if (failAt < 0) run(); else assert.throws(run, error => error === failure);
      assert.equal(events.length, failAt < 0 ? count : failAt);
      assert.equal(state.sp, mosCpu ? failAt === 0 ? push ? 0 : 1 : push ? 0x3f : 0x40
        : failAt === 0 ? push ? size - 1 : 0 : failAt === 1 ? push ? 0x1ff : 0x201 : push ? 0x200 : 0x201);
      if (!push && failAt < 0) { assert.notEqual(state.flags, flags); assert.deepEqual(state.flags, decoded(cpu, 0x96)); }
      else assert.equal(state.flags, flags);
      assert.equal(state.a, !push && !mosCpu && failAt < 0 ? 0x34 : failAt === 0 ? 0x5a : 0x11);
      assert.equal(state.pc, 0x1234);
    }
  }
});

test("NMOS arithmetic observes fetched state and retains its distinct binary and decimal write stages", () => {
  for (const [opcode, decimal, a, operand, carry, result, order] of [
    [0x69, false, 0x7f, 1, false, 0x80, ["a", "n", "z", "c", "v"]],
    [0x69, true, 0x99, 1, false, 0, ["z", "n", "v", "c", "a"]],
    [0xe9, false, 0x80, 1, true, 0x7f, ["a", "n", "z", "c", "v"]],
    [0xe9, true, 0, 1, true, 0x99, ["a", "n", "z", "c", "v", "a"]],
  ] as const) {
    const state = stackState("6502", 15, 0, 0), writes: string[] = [];
    const observed = new Proxy(state, { set(target, key, value) { writes.push(String(key)); return Reflect.set(target, key, value); } });
    mos[opcode](observed, { fetchByte() {
      state.a = a; state.flags = new Proxy({ ...state.flags, d: decimal, c: carry }, {
        set(target, key, value) { writes.push(String(key)); return Reflect.set(target, key, value); },
      });
      return operand;
    } });
    assert.equal(state.a, result); assert.deepEqual(writes, order);
    assert.equal(state.flags.d, decimal); assert.equal(state.flags.i, true);
  }
});

test("decimal adjustment replaces Intel flags before A and retains the Motorola flag object", () => {
  for (const cpu of ["8080", "z80", "6800", "6809"] as const) {
    const state = stackState(cpu, 0, 0, 0), oldFlags = state.flags, writes: string[] = [];
    Object.assign(state.flags, { h: false, ac: false, c: false, cy: false, n: true }); state.a = 0x9a;
    const observed = new Proxy(state, { set(target, key, value) {
      writes.push(String(key));
      if (key === "flags") { assert.equal(state.a, 0x9a); assert.equal(Object.values(value).every(item => typeof item === "boolean"), true); }
      return Reflect.set(target, key, value);
    } });
    if (cpu === "8080") intel[0x27](observed); else if (cpu === "z80") zilog[0x27](observed);
    else (cpu === "6800" ? m6800[0x19] : m6809.daa)(observed);
    assert.equal(state.a, cpu === "z80" ? 0x34 : 0);
    assert.deepEqual(writes, cpu === "8080" || cpu === "z80" ? ["flags", "a"] : ["a"]);
    if (cpu === "6800" || cpu === "6809") assert.equal(state.flags, oldFlags); else assert.notEqual(state.flags, oldFlags);
    if (cpu === "z80") { assert.equal(state.flags.n, true); assert.equal(oldFlags.n, true); }
  }
});

test("6809 status masks capture CC before fetching and commit a complete replacement only on success", () => {
  for (const operation of ["orcc", "andcc"] as const) for (const fail of [false, true]) {
    const state = stackState("6809", 15, 0, 0), before = { ...state.flags }, original = state.flags;
    const failure = new Error("mask fetch failed");
    const run = () => m6809[operation](state, { fetchByte() { if (fail) throw failure; for (const flag of Object.keys(state.flags)) Reflect.set(state.flags, flag, false); return 0; } });
    if (fail) { assert.throws(run, error => error === failure); assert.equal(state.flags, original); assert.deepEqual(state.flags, before); }
    else { run(); assert.notEqual(state.flags, original); for (const flag of ["e", "f", "h", "i", "n", "z", "v", "c"] as const) assert.equal(state.flags[flag], operation === "orcc" && before[flag]); }
  }
});

test("numeric selection validates both arms and complete flag replacement validates its whole schema", async () => {
  const cpu = cpuSymbols("6502", cpu6502StateDescription);
  const definition = (choice: NumberExpression) => defineInstruction({ cpu: cpu.declaration, name: "select flags", explanation: "Selection and replacement probe.",
    steps: [readFlag("old", cpu.flag("c")), capture("chosen", choice), writeRegister(cpu.register("a"), value("chosen"))] });
  for (const choice of [select(flagLiteral(true), literal(8, 1), literal(16, 2)),
    select(flagLiteral(true), literal(8, 1), value("missing")),
    select(literal(8, 0) as Expression as FlagExpression, literal(8, 1), literal(8, 2))]) assert.throws(() => definition(choice));
  const policy: FlagPolicy = { name: "replace all", parameters: { old: "flag" }, unlisted: "preserve",
    updates: (["n", "v", "d", "i", "z", "c"] as const).map(field => ({ flag: cpu.flag(field), value: flagValue("old") })) };
  const base = definition(select(or(flagValue("old"), flagLiteral(false)), literal(8, 0x55), literal(8, 0xaa)));
  assert.throws(() => defineInstruction({ ...base, steps: [...base.steps, replaceFlags({ ...policy, updates: policy.updates.slice(1) }, { old: flagValue("old") })] }), /every stored flag/);
  const complete = defineInstruction({ ...base, steps: [...base.steps, replaceFlags(policy, { old: flagValue("old") })] });
  const compiled = await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(generateInstructions("6502", { probe: complete })))}`);
  for (const carry of [false, true]) {
    const state = stackState("6502", 0, 0, 0); state.flags.c = carry; const before = state.flags;
    compiled.instructions.probe(state); assert.equal(state.a, carry ? 0x55 : 0xaa); assert.notEqual(state.flags, before);
    assert.deepEqual(state.flags, { n: carry, v: carry, d: carry, i: carry, z: carry, c: carry });
  }
  assert.match(describeInstruction(complete), /select\(or\(old, 0:flag\), 55:u8, AA:u8\)/);
  assert.match(describeInstruction(complete), /replace flags "replace all"/);
  assert.match(describeInstruction(complete), /Flags preserved throughout: none/);
});

test("packed flag layouts expose an owned immutable declaration matching runtime encoding", () => {
  const bits = { z: 6, c: 0 }, packed = flagRegister(bits, 2); bits.z = 7;
  assert.deepEqual(packed.bits, { z: 6, c: 0 }); assert.equal(packed.fixed, 2); assert.ok(Object.isFrozen(packed.bits)); assert.ok(Object.isFrozen(packed));
  assert.equal(packed.encode({ z: true, c: false }), 0x42); assert.deepEqual(packed.decode(0x41), { z: true, c: true });
});
