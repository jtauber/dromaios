import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { instructions as m6800 } from "../../../../src/components/cpus/generated/6800.js";
import { bodies6809 as m6809 } from "../../../helpers/6809-bodies.js";
import { cpu6809StateDescription } from "../../../../src/components/cpus/semantics/generated/state/6809.js";
import type { Cpu6809State } from "../../../../src/components/cpus/semantics/generated/state/6809.js";
import type { Cpu6800State } from "../../../../src/components/cpus/semantics/generated/state/6800.js";
import { addOverflow, addWrap, borrow, capture, carry, cpuSymbols, flagValue, halfBorrow, halfCarry,
  negative, overflow, readFlag, readRegister, subtract, updateFlags, value, writeRegister, zero } from "../../../../src/components/cpus/semantics/model.js";
import type { FlagPolicy } from "../../../../src/components/cpus/semantics/model.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";

import { extended6800 } from "../../../helpers/6800-operands.js";

const state6800 = (): Cpu6800State => ({ a: 0x55, b: 0xaa, x: 0, sp: 0, pc: 0, waiting: false,
  flags: { h: true, i: true, n: true, z: true, v: true, c: false } });
const state6809 = (): Cpu6809State => ({ a: 0x55, b: 0xaa, x: 0, y: 0, s: 0, u: 0, dp: 0, pc: 0, waitMode: "none", nmiArmed: false,
  flags: { e: true, f: true, h: true, i: true, n: true, z: true, v: true, c: false } });

function expected(width: 8 | 16, adding: boolean, left: number, right: number, incoming: boolean) {
  const modulus = 2 ** width, half = modulus / 2, bit = Number(incoming);
  const signed = (value: number) => value < half ? value : value - modulus;
  const total = adding ? left + right + bit : left - right - bit;
  const signedTotal = adding ? signed(left) + signed(right) + bit : signed(left) - signed(right) - bit;
  const result = (total + modulus) % modulus;
  return { result, n: result >= half, z: result === 0, v: signedTotal < -half || signedTotal >= half,
    c: adding ? total >= modulus : total < 0,
    h: adding ? left % 16 + right % 16 + bit >= 16 : left % 16 - right % 16 - bit < 0 };
}

test("generated arithmetic uses full-width operands plus a captured input bit, including in closed flag policies", async () => {
  const cpu = cpuSymbols("6809", cpu6809StateDescription);
  for (const width of [8, 16] as const) for (const adding of [false, true]) {
    const left = value("left"), right = value("right"), incoming = flagValue("incoming");
    const policy: FlagPolicy = { name: "arithmetic facts", parameters: { left: width, right: width, result: width, incoming: "flag" }, unlisted: "preserve",
      updates: [
        { flag: cpu.flag("c"), value: (adding ? carry : borrow)(left, right, incoming) },
        { flag: cpu.flag("h"), value: (adding ? halfCarry : halfBorrow)(left, right, incoming) },
        { flag: cpu.flag("v"), value: (adding ? addOverflow : overflow)(left, right, incoming) },
        { flag: cpu.flag("n"), value: negative(value("result")) }, { flag: cpu.flag("z"), value: zero(value("result")) },
      ] };
    const destination = cpu.register(width === 8 ? "a" : "x"), source = cpu.register(width === 8 ? "b" : "y");
    const definition = { cpu: cpu.declaration, name: "arithmetic probe", explanation: "Carry input is explicit.", steps: [
      readRegister("left", destination), readRegister("right", source), readFlag("carry", cpu.flag("c")),
      capture("result", (adding ? addWrap : subtract)(left, right, flagValue("carry"))),
      updateFlags(policy, { left, right, result: value("result"), incoming: flagValue("carry") }),
      writeRegister(destination, value("result")),
    ] };
    const code = generateInstructions("6809", { probe: definition });
    const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
    const javascript = stripTypeScriptTypes(code).replace('"../alu.ts"', JSON.stringify(alu));
    const compiled: { instructions: { probe(state: Cpu6809State): void } } = await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
    const description = describeInstruction(definition);
    assert.match(description, /carry:flag := read C/);
    assert.match(description, adding ? /H := halfCarry4\(left, right, carry\)/ : /H := halfBorrow4\(left, right, carry\)/);
    assert.doesNotMatch(description, /\(left, right, incoming\)/); // Substitute the policy argument exactly once.
    const state = state6809(), modulus = 2 ** width;
    const values = width === 8 ? Array.from({ length: 256 }, (_, n) => n)
      : [0, 1, 15, 16, 127, 128, 255, 256, 32767, 32768, 65534, 65535];
    for (const left of values) for (const right of values) for (const incoming of [false, true]) {
      state[width === 8 ? "a" : "x"] = left;
      state[width === 8 ? "b" : "y"] = right;
      state.flags = { e: true, f: false, i: true, h: false, n: false, z: false, v: false, c: incoming };
      compiled.instructions.probe(state);
      const { result, ...flags } = expected(width, adding, left, right, incoming);
      assert.equal(state[width === 8 ? "a" : "x"], result);
      assert.ok(result >= 0 && result < modulus);
      assert.deepEqual(state.flags, { ...flags, e: true, f: false, i: true });
    }
  }
});

interface ArithmeticBody<State> {
  readonly name: string;
  readonly register: "a" | "b" | "d";
  readonly adding: boolean;
  readonly withCarry: boolean;
  immediate(state: State, instruction: { fetchByte(): number }): void;
  memory(state: State, address: number, instruction: { readByte(address: number): number }): void;
}
type ByteBodies<State> = Record<`${"sub" | "sbc" | "adc" | "add"}${"a" | "b"}Immediate`, ArithmeticBody<State>["immediate"]>
  & Record<`${"sub" | "sbc" | "adc" | "add"}${"a" | "b"}Memory`, ArithmeticBody<State>["memory"]>;
function byteBodies<State>(bodies: ByteBodies<State>): ArithmeticBody<State>[] {
  return (["a", "b"] as const).flatMap(register => (["sub", "sbc", "adc", "add"] as const).map(operation => ({
    name: `${operation}${register}`, register, adding: operation === "adc" || operation === "add", withCarry: operation === "adc" || operation === "sbc",
    immediate: bodies[`${operation}${register}Immediate`], memory: bodies[`${operation}${register}Memory`],
  })));
}

test("Motorola arithmetic reads complete operands before registers and carry, then flags before writeback; failures stop the sequence", () => {
  function check<State extends Cpu6800State | Cpu6809State>(create: () => State, bodies: readonly ArithmeticBody<State>[]): void {
    for (const body of bodies) for (const mode of ["Immediate", "Memory"] as const) for (const incoming of [false, true]) {
      const word = body.register === "d", bytes = word ? [0xff, 0xff] : [0xff];
      for (let failAt = -1; failAt < bytes.length; failAt++) {
        const state = create(), events: string[] = [], failure = new Error("arithmetic operand failed");
        const oldFlags = state.flags, flags = { ...oldFlags, c: incoming };
        const observed = new Proxy(state, {
          get(target, key, receiver) {
            if (key === "a" || key === "b") events.push(`read ${String(key)}`);
            return Reflect.get(target, key, receiver);
          },
          set(target, key, value) { events.push(`write ${String(key)}`); return Reflect.set(target, key, value); },
        });
        let reads = 0;
        const access = (): number => {
          const index = reads++;
          events.push(`operand ${index}`);
          if (index === failAt) throw failure;
          state.a = 0x7f; state.b = 0xff; // The accumulator must be captured after all operand reads.
          state.flags = new Proxy(flags, {
            get(target, key, receiver) {
              assert.ok(body.withCarry && key === "c", "Only ADC/SBC may read C");
              events.push("read c"); return Reflect.get(target, key, receiver);
            },
            set(target, key, value) { events.push(`flag ${String(key)}`); return Reflect.set(target, key, value); },
          });
          return bytes[index]!;
        };
        const run = () => mode === "Immediate" ? body.immediate(observed, { fetchByte: access }) : body.memory(observed, 0xffff, {
          readByte(address) { assert.equal(address, reads === 0 ? 0xffff : 0); return access(); },
        });
        if (failAt >= 0) assert.throws(run, error => error === failure);
        else run();
        const operands = failAt === 0 ? { a: 0x55, b: 0xaa } : { a: 0x7f, b: 0xff };
        const after = { ...create(), ...operands, flags: failAt === 0 ? oldFlags : flags };
        if (failAt < 0) {
          const left = word ? 0x7fff : operands[body.register as "a" | "b"];
          const { result, h, ...changes } = expected(word ? 16 : 8, body.adding, left, word ? 0xffff : 0xff, body.withCarry && incoming);
          Object.assign(after, word ? { a: Math.floor(result / 256), b: result % 256 } : { [body.register]: result });
          assert.deepEqual(flags, { ...oldFlags, ...changes, h: body.adding && !word ? h : oldFlags.h });
        } else assert.deepEqual(flags, { ...oldFlags, c: incoming });
        assert.deepEqual({ ...state, flags: after.flags }, after, body.name);
        assert.deepEqual(oldFlags, create().flags);
        assert.deepEqual(events, [...bytes.slice(0, failAt < 0 ? bytes.length : failAt + 1).map((_, i) => `operand ${i}`),
          ...(failAt >= 0 ? [] : [
            ...(word ? ["read a", "read b"] : [`read ${body.register}`]), ...(body.withCarry ? ["read c"] : []),
            "flag n", "flag z", "flag v", "flag c", ...(body.adding && !word ? ["flag h"] : []),
            ...(word ? ["write a", "write b"] : [`write ${body.register}`]),
          ])]);
      }
    }
  }
  check(state6800, byteBodies({
    subaImmediate: m6800[0x80], subbImmediate: m6800[0xc0], subaMemory: extended6800(m6800[0xb0]), subbMemory: extended6800(m6800[0xf0]),
    sbcaImmediate: m6800[0x82], sbcbImmediate: m6800[0xc2], sbcaMemory: extended6800(m6800[0xb2]), sbcbMemory: extended6800(m6800[0xf2]),
    adcaImmediate: m6800[0x89], adcbImmediate: m6800[0xc9], adcaMemory: extended6800(m6800[0xb9]), adcbMemory: extended6800(m6800[0xf9]),
    addaImmediate: m6800[0x8b], addbImmediate: m6800[0xcb], addaMemory: extended6800(m6800[0xbb]), addbMemory: extended6800(m6800[0xfb]),
  }));
  check(state6809, [...byteBodies(m6809),
    ...(["sub", "add"] as const).map(operation => ({ name: `${operation}d`, register: "d" as const, adding: operation === "add", withCarry: false,
      immediate: m6809[`${operation}dImmediate`], memory: m6809[`${operation}dMemory`],
    })),
  ]);
});

test("6800 ABA and SBA capture A then B, ignore incoming C, and update flags before A", () => {
  for (const adding of [false, true]) {
    const state = state6800(), events: string[] = [], flags = { ...state.flags };
    state.flags = new Proxy(flags, {
      get() { assert.fail("ABA/SBA do not read flags"); },
      set(target, key, value) { events.push(`flag ${String(key)}`); return Reflect.set(target, key, value); },
    });
    const observed = new Proxy(state, {
      get(target, key, receiver) {
        if (key === "a" || key === "b") events.push(`read ${String(key)}`);
        return Reflect.get(target, key, receiver);
      },
      set(target, key, value) { events.push(`write ${String(key)}`); return Reflect.set(target, key, value); },
    });
    (adding ? m6800[0x1b] : m6800[0x10])(observed);
    const { result, h, ...changes } = expected(8, adding, 0x55, 0xaa, false);
    assert.equal(state.a, result); assert.equal(state.b, 0xaa);
    assert.deepEqual(flags, { ...state6800().flags, ...changes, h: adding ? h : true });
    assert.deepEqual(events, ["read a", "read b", "flag n", "flag z", "flag v", "flag c", ...(adding ? ["flag h"] : []), "write a"]);
  }
});
