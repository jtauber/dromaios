import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { defineState, unsigned } from "../../../../src/components/cpus/state.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { fetchByte, readRegister, value, writeRegister } from "../../../../src/components/cpus/semantics/model.js";
import type { InstructionDefinition, Register, Statement } from "../../../../src/components/cpus/semantics/model.js";

const cpu = { name: "probe", state: defineState({ a: unsigned(8), b: unsigned(8) }) };
const register = (field: "a" | "b"): Register => ({ kind: "register", cpu: "probe", field, width: 8 });
const definition = (steps: readonly Statement[]): InstructionDefinition => ({ cpu, name: "probe", explanation: "Binding contract.", steps });
const definitions = { 1: definition([fetchByte("byte"), writeRegister(register("a"), value("byte"))]),
  2: definition([readRegister("byte", register("a")), writeRegister(register("b"), value("byte"))]) };
const executable = (code: string) => import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(code)
  .replace('"../opcodes.ts"', JSON.stringify(new URL("../../../../src/components/cpus/opcodes.js", import.meta.url).href)))}`);

type State = { a: number; b: number };
type Handler = (context: { fetchByte(): number }) => void;
interface Bindings {
  opcodeEntries(state: State): readonly (readonly [number, Handler])[];
  opcodeDecoder(state: State): (opcode: number, nextByte: (opcodeFetch: boolean) => number) => { handler: Handler | undefined; opcodeFetches: number };
}

test("ordinary opcode bindings preserve all, selected, and empty inventories without reading state or fetching during decoding", async () => {
  for (const bindOpcodes of [true, [2, 1], [2], []] as const) {
    const module: Bindings = await executable(generateInstructions("probe", definitions, { bindOpcodes }));
    const state = { a: 1, b: 0 }, other = { a: 9, b: 0 }, effects: string[] = [];
    const observed = new Proxy(state, {
      get(target, key, receiver) { effects.push(`read ${String(key)}`); return Reflect.get(target, key, receiver); },
      set(target, key, value) { effects.push(`write ${String(key)}`); return Reflect.set(target, key, value); },
    });
    const expected = bindOpcodes === true ? [1, 2] : [...bindOpcodes];
    const entries = module.opcodeEntries(observed), decode = module.opcodeDecoder(observed), otherDecode = module.opcodeDecoder(other);
    assert.deepEqual(entries.map(([opcode]) => opcode), expected);
    const nextByte = () => assert.fail("Single-byte decoding must not fetch another byte");
    for (const opcode of [0, 1, 2, 255]) {
      const result = decode(opcode, nextByte);
      assert.equal(result.opcodeFetches, 1);
      assert.equal(typeof result.handler, expected.includes(opcode) ? "function" : "undefined");
    }
    assert.deepEqual(effects, []);
    state.a = 0x42;
    if (expected.includes(2)) {
      decode(2, nextByte).handler!({ fetchByte: nextByte });
      otherDecode(2, nextByte).handler!({ fetchByte: nextByte });
      assert.deepEqual(effects, ["read a", "write b"]);
      assert.equal(state.b, 0x42); assert.equal(other.b, 9);
    }
    if (expected.includes(1)) {
      const load = decode(1, nextByte).handler!, failure = Error("operand fetch failed"), before = { ...state };
      assert.throws(() => load({ fetchByte() { throw failure; } }), error => error === failure);
      assert.deepEqual(state, before);
      load({ fetchByte: () => 0x77 }); assert.equal(state.a, 0x77); assert.equal(other.a, 9);
    }
  }
});

test("unbound instruction modules expose their helpers without opcode bindings or decoder exports", async () => {
  const helper = { ...definition([writeRegister(register("b"), value("byte"))]), inputs: { byte: 8 as const } };
  for (const options of [{}, { bindOpcodes: false }]) {
    const module: { instructions: { helper(state: State, byte: number): void } } =
      await executable(generateInstructions("probe", { ...definitions, helper }, options));
    assert.deepEqual(Object.keys(module), ["instructions"]);
    const state = { a: 1, b: 0 };
    module.instructions.helper(state, 0x55); assert.deepEqual(state, { a: 1, b: 0x55 });
  }
});
