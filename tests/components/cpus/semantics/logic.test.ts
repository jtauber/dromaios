import { extended6800 } from "../../../helpers/6800-operands.js";
import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { instructions } from "../../../../src/components/cpus/generated/6502.js";
import { instructions as m6800 } from "../../../../src/components/cpus/generated/6800.js";
import { bodies6809 as m6809 } from "../../../helpers/6809-bodies.js";
import type { Cpu6800State } from "../../../../src/components/cpus/semantics/generated/state/6800.js";
import { cpu6809StateDescription } from "../../../../src/components/cpus/semantics/generated/state/6809.js";
import type { Cpu6809State } from "../../../../src/components/cpus/semantics/generated/state/6809.js";
import type { Cpu6502Flags, Cpu6502State } from "../../../../src/components/cpus/semantics/generated/state/6502.js";
import { bitAnd, bitOr, bitXor, cpuSymbols, literal, value, writeRegister } from "../../../../src/components/cpus/semantics/model.js";
import type { InstructionDefinition } from "../../../../src/components/cpus/semantics/model.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";

type MotorolaLogicalName = `${"and" | "bit" | "eor" | "or"}${"a" | "b"}`;
type MotorolaLogicalBodies<State> = Record<`${MotorolaLogicalName}Immediate`, (state: State, instruction: { fetchByte(): number }) => void>
  & Record<`${MotorolaLogicalName}Memory`, (state: State, address: number, instruction: { readByte(address: number): number }) => void>;

// Independent bit truth tables, rather than the JavaScript operators emitted by the generator.
function expectedBits(operation: "and" | "or" | "xor", left: number, right: number, width: number): number {
  const a = left.toString(2).padStart(width, "0"), b = right.toString(2).padStart(width, "0");
  return Number.parseInt([...a].map((bit, index) => {
    const l = bit === "1", r = b[index] === "1";
    return (operation === "and" ? l && r : operation === "or" ? l || r : l !== r) ? "1" : "0";
  }).join(""), 2);
}

test("generated numeric bitwise expressions preserve byte/word widths and nested expression grouping", async () => {
  const cpu = cpuSymbols("6809", cpu6809StateDescription), definitions: Record<string, InstructionDefinition> = {};
  for (const width of [8, 16] as const) {
    const expressions = {
      and: bitAnd(value("left"), value("right")), or: bitOr(value("left"), value("right")),
      xor: bitXor(value("left"), value("right")),
      nested: bitAnd(bitOr(value("left"), value("right")), bitXor(value("left"), literal(width, width === 8 ? 0xaa : 0xaaaa))),
    };
    for (const [name, expression] of Object.entries(expressions)) definitions[`${name}${width}`] = {
      cpu: cpu.declaration, name, explanation: "Numeric bitwise probe.", inputs: { left: width, right: width },
      steps: [writeRegister(cpu.register(width === 8 ? "a" : "x"), expression)],
    };
  }
  const javascript = stripTypeScriptTypes(generateInstructions("6809", definitions));
  const compiled: { instructions: Record<string, (state: Cpu6809State, left: number, right: number) => void> } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  const state: Cpu6809State = { a: 0, b: 0, dp: 0, x: 0, y: 0, s: 0, u: 0, pc: 0, waitMode: "none", nmiArmed: false,
    flags: { e: false, f: true, h: false, i: true, n: false, z: true, v: false, c: true } };
  const flags = { ...state.flags };
  function check(width: 8 | 16, left: number, right: number): void {
    const expected = {
      and: expectedBits("and", left, right, width), or: expectedBits("or", left, right, width),
      xor: expectedBits("xor", left, right, width),
      nested: expectedBits("and", expectedBits("or", left, right, width),
        expectedBits("xor", left, width === 8 ? 0xaa : 0xaaaa, width), width),
    };
    for (const [name, result] of Object.entries(expected)) {
      compiled.instructions[`${name}${width}`]!(state, left, right);
      assert.equal(state[width === 8 ? "a" : "x"], result, `${name}${width}: ${left}, ${right}`);
    }
  }
  for (let left = 0; left < 256; left++) for (let right = 0; right < 256; right++) check(8, left, right);
  const words = [0, 0xffff, 0xaaaa, 0x5555, ...Array.from({ length: 16 }, (_, bit) => 2 ** bit)
    .flatMap(bit => [bit - 1, bit, bit + 1, 0xffff - bit])];
  for (const left of words) for (const right of words) check(16, left, right);
  assert.deepEqual(state.flags, flags);
});

test("all generated 6502 logical forms finish reads before A and flags, and stop at every failed read", () => {
  type Access = readonly [kind: "fetch", byte: number] | readonly [kind: "read", address: number, byte: number];
  const sources: readonly (readonly Access[])[] = [
    [["fetch", 0xfe], ["read", 0, 0xff], ["read", 1, 0xff], ["read", 0xffff, 0xc0]],
    [["fetch", 0xff], ["read", 0xff, 0xc0]],
    [["fetch", 0xc0]],
    [["fetch", 0xff], ["fetch", 0xff], ["read", 0xffff, 0xc0]],
    [["fetch", 0xff], ["read", 0xff, 0xff], ["read", 0, 0xff], ["read", 2, 0xc0]],
    [["fetch", 0xff], ["read", 1, 0xc0]],
    [["fetch", 0xff], ["fetch", 0xff], ["read", 2, 0xc0]],
    [["fetch", 0xff], ["fetch", 0xff], ["read", 1, 0xc0]],
  ];
  const families = [
    { opcodes: [0x01, 0x05, 0x09, 0x0d, 0x11, 0x15, 0x19, 0x1d], result: 0xc0 },
    { opcodes: [0x21, 0x25, 0x29, 0x2d, 0x31, 0x35, 0x39, 0x3d], result: 0x40 },
    { opcodes: [0x41, 0x45, 0x49, 0x4d, 0x51, 0x55, 0x59, 0x5d], result: 0x80 },
  ] as const;
  const forms = [
    ...families.flatMap(({ opcodes, result }) => opcodes.map((opcode, mode) => ({ opcode, result, accesses: sources[mode]! }))),
    { opcode: 0x24, result: null, accesses: sources[1]! }, { opcode: 0x2c, result: null, accesses: sources[3]! },
  ] as const;
  for (const { opcode, result, accesses } of forms) for (let failAt = -1; failAt < accesses.length; failAt++) {
    const events: string[] = [], failure = new Error("logical source read failed");
    const flags: Cpu6502Flags = { n: false, v: false, d: true, i: true, z: true, c: true }, before = { ...flags };
    const state: Cpu6502State = { a: 0xa5, x: 2, y: 3, sp: 0xff, pc: 0x1000, flags: new Proxy(flags, {
      get() { assert.fail("Logic must not read incoming flags"); },
      set(target, key, value) { events.push(`flag ${String(key)}`); return Reflect.set(target, key, value); },
    }) };
    const observed = new Proxy(state, {
      get(target, key, receiver) {
        if (key === "a") events.push("read A");
        return Reflect.get(target, key, receiver);
      },
      set(target, key, value) {
        assert.equal(key, "a"); assert.notEqual(result, null, "BIT must not write A");
        events.push("write A"); return Reflect.set(target, key, value);
      },
    });
    let reads = 0;
    const read = (kind: "fetch" | "read", address?: number): number => {
      const expected = accesses[reads];
      assert.ok(expected, "unexpected access"); assert.equal(kind, expected[0]);
      if (expected[0] === "read") assert.equal(address, expected[1]);
      events.push(kind);
      if (reads === failAt) throw failure;
      reads++;
      state.a = reads === accesses.length ? 0x40 : 0xff; // Detect capturing A before the last source read.
      return expected[0] === "fetch" ? expected[1] : expected[2];
    };
    const run = () => instructions[opcode](observed, { fetchByte: () => read("fetch"), readByte: address => read("read", address) });
    if (failAt < 0) run();
    else assert.throws(run, error => error === failure);
    assert.deepEqual(events, [
      ...accesses.slice(0, failAt < 0 ? accesses.length : failAt + 1).map(([kind]) => kind),
      ...(failAt < 0 ? ["read A", ...(result === null ? [] : ["write A"]), "flag n", ...(result === null ? ["flag v"] : []), "flag z"] : []),
    ]);
    assert.equal(state.a, failAt < 0 ? result ?? 0x40 : failAt === 0 ? 0xa5 : 0xff);
    assert.deepEqual(flags, failAt < 0
      ? { ...before, n: result === null || result >= 128, v: result === null, z: false } : before);
  }
});

test("Motorola logical bodies capture operands before A/B, use restored flags, and preserve all state on failed reads", () => {
  function check<State extends Cpu6800State | Cpu6809State>(create: () => State, bodies: MotorolaLogicalBodies<State>): void {
    for (const operation of ["and", "bit", "eor", "or"] as const) for (const register of ["a", "b"] as const) {
      for (const memory of [false, true]) for (const fail of [false, true]) for (const incoming of [false, true]) {
        const state = create(), events: string[] = [], failure = new Error("logical read failed");
        for (const key of Object.keys(state.flags)) Reflect.set(state.flags, key, incoming);
        const oldFlags = state.flags, before = structuredClone(state), flags = { ...state.flags };
        const observed = new Proxy(state, {
          get(target, key, receiver) {
            if (key === "a" || key === "b") events.push(`read ${String(key)}`);
            return Reflect.get(target, key, receiver);
          },
          set(target, key, value) {
            assert.equal(key, register); assert.notEqual(operation, "bit", "BIT must not write a register");
            events.push(`write ${register}`); return Reflect.set(target, key, value);
          },
        });
        const read = (): number => {
          events.push("operand");
          if (fail) throw failure;
          state[register] = 0x40; // The body must capture the register after reading its operand.
          state.flags = new Proxy(flags, {
            get() { assert.fail("Logical instructions must not read incoming flags"); },
            set(target, key, value) { events.push(`flag ${String(key)}`); return Reflect.set(target, key, value); },
          });
          return 0xc0;
        };
        const name = `${operation}${register}` as const;
        const run = () => memory ? bodies[`${name}Memory`](observed, 0xffff, { readByte(address) { assert.equal(address, 0xffff); return read(); } })
          : bodies[`${name}Immediate`](observed, { fetchByte: read });
        if (fail) {
          assert.throws(run, error => error === failure);
          assert.deepEqual(state, before);
        } else {
          run();
          const result = expectedBits(operation === "bit" ? "and" : operation === "eor" ? "xor" : operation, 0x40, 0xc0, 8);
          assert.equal(state[register], operation === "bit" ? 0x40 : result);
          assert.deepEqual({ ...state, flags }, { ...before, [register]: operation === "bit" ? 0x40 : result,
            flags: { ...before.flags, n: result >= 128, z: result === 0, v: false } });
        }
        assert.deepEqual(oldFlags, before.flags);
        assert.deepEqual(events, ["operand", ...(fail ? [] : [
          `read ${register}`, ...(operation === "bit" ? [] : [`write ${register}`]), "flag n", "flag z", "flag v",
        ])]);
      }
    }
  }
  check((): Cpu6800State => ({ a: 0x55, b: 0xaa, x: 0, sp: 0, pc: 0, waiting: false,
    flags: { h: true, i: true, n: true, z: true, v: true, c: true } }), {
    andaImmediate: m6800[0x84], andbImmediate: m6800[0xc4], andaMemory: extended6800(m6800[0xb4]), andbMemory: extended6800(m6800[0xf4]),
    bitaImmediate: m6800[0x85], bitbImmediate: m6800[0xc5], bitaMemory: extended6800(m6800[0xb5]), bitbMemory: extended6800(m6800[0xf5]),
    eoraImmediate: m6800[0x88], eorbImmediate: m6800[0xc8], eoraMemory: extended6800(m6800[0xb8]), eorbMemory: extended6800(m6800[0xf8]),
    oraImmediate: m6800[0x8a], orbImmediate: m6800[0xca], oraMemory: extended6800(m6800[0xba]), orbMemory: extended6800(m6800[0xfa]),
  });
  check((): Cpu6809State => ({ a: 0x55, b: 0xaa, x: 0, y: 0, s: 0, u: 0, dp: 0, pc: 0, waitMode: "none", nmiArmed: false,
    flags: { e: true, f: true, h: true, i: true, n: true, z: true, v: true, c: true } }), m6809);
});
