import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { cpu8008StateDescription } from "../../../../src/components/cpus/state/8008.js";
import type { Cpu8008StoredState } from "../../../../src/components/cpus/state/8008.js";
import { addWrap, capture, cpuSymbols, extend, flagLiteral, highByte, literal, readElement, readRegister, readSource, shiftLeft, shiftRight, signExtend, truncate, value, when, writeElement, writeRegister } from "../../../../src/components/cpus/semantics/model.js";
import type { InstructionDefinition, NumberExpression, Statement, Width } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";

const cpu = cpuSymbols("8008", cpu8008StateDescription), slots = cpu.array("addressStack"), selector = cpu.register("stackIndex");
const define = (steps: readonly Statement[]) => defineInstruction({ cpu: cpu.declaration, name: "array probe", explanation: "Narrow stored values and indexed registers.", steps });
const state = (): Cpu8008StoredState => ({ a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0,
  flags: { s: false, z: false, p: false, c: false }, addressStack: [0, 1, 2, 3, 4, 5, 6, 7], stackIndex: 7, halted: false });
async function compile(definitions: Readonly<Record<string, InstructionDefinition>>) {
  const source = generateInstructions("8008", definitions);
  assert.doesNotMatch(source, /ByteInstructionContext/);
  const javascript = stripTypeScriptTypes(source);
  const compiled: { instructions: Record<string, (state: Cpu8008StoredState, word?: number) => void> } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  return compiled.instructions;
}

test("register arrays are schema-owned and every index must provably fit before generation", () => {
  define([readRegister("slot", selector), readElement("pc", slots, value("slot")), writeElement(slots, value("slot"), value("pc"))]);
  // Wide constants may still name known valid slots; dynamic wide values require explicit narrowing.
  define([writeElement(slots, literal(16, 7), literal(14, 0x3fff))]);
  for (const ref of [{ ...slots, cpu: "8080" }, { ...slots, field: "a" }, { ...slots, field: "missing" },
    { ...slots, width: 16 as const }, { ...slots, length: 16 }]) {
    assert.throws(() => define([readElement("pc", ref, literal(3, 0))]), /does not match the CPU schema/);
    assert.throws(() => define([writeElement(ref, literal(3, 0), literal(14, 0))]), /does not match the CPU schema/);
  }
  for (const index of [literal(8, 8), literal(16, 65535), value("wide"), extend(literal(3, 0), 8)]) {
    for (const effect of [readElement("pc", slots, index), writeElement(slots, index, literal(14, 0))]) {
      assert.throws(() => define([capture("wide", literal(8, 0)), effect]), /index may exceed/);
    }
  }
  assert.throws(() => define([readElement("pc", slots, value("missing"))]), /not been captured/);
  assert.throws(() => define([readElement("pc", slots, flagLiteral(false) as unknown as NumberExpression)]), /numeric expression/);
  assert.throws(() => define([writeElement(slots, literal(3, 0), literal(16, 0))]), /expected 14-bit/);
  assert.throws(() => define([writeRegister(selector, literal(8, 0))]), /expected 3-bit/);
  assert.throws(() => cpu.array("a" as "addressStack"), /expected a stored register array/);
  assert.throws(() => cpu.register("addressStack" as "stackIndex"), /expected a stored register/);
  const owned = define([readElement("pc", slots, literal(3, 7))]);
  assert.equal(Object.isFrozen(owned.steps[0]), true);
  assert.equal(Object.isFrozen(slots), false);
});

test("narrow captures retain lexical scope and require explicit conversions for arithmetic and writes", () => {
  const source = { name: "selected PC", width: 14 as const,
    steps: [readRegister("slot", selector), readElement("pc", slots, value("slot"))], result: value("pc") };
  define([readSource("pc", source), writeElement(slots, literal(3, 0), value("pc"))]);
  assert.throws(() => define([readSource("pc", source), readElement("again", slots, value("slot"))]), /not been captured/);
  assert.throws(() => define([when(flagLiteral(true), [readElement("pc", slots, literal(3, 0))]), capture("escaped", value("pc"))]), /not been captured/);
  for (const bits of [3, 14] as const) {
    for (const bad of [-1, 2 ** bits, 0.5, NaN]) assert.throws(() => define([capture("bad", literal(bits, bad))]), /literal does not fit/);
    assert.throws(() => define([capture("bad", addWrap(literal(bits, 0), literal(bits, 1)))]), /arithmetic requires/);
    for (const shift of [shiftLeft, shiftRight]) {
      assert.throws(() => define([capture("bad", shift(literal(bits, 0), flagLiteral(false)))]), /arithmetic requires/);
    }
    assert.throws(() => define([capture("bad", truncate(literal(bits, 0), bits))]), /must narrow/);
    assert.throws(() => define([capture("bad", truncate(literal(bits, 0), 16))]), /must narrow/);
  }
  assert.throws(() => define([capture("bad", truncate(literal(16, 0), 12 as Width))]), /expected width/);
  assert.throws(() => define([capture("bad", truncate(flagLiteral(false) as unknown as NumberExpression, 3))]), /numeric expression/);
});

test("generated narrowing and widening retain every 3-bit selector and 14-bit address without RAM capabilities", async () => {
  const definitions = {
    narrow: defineInstruction({ cpu: cpu.declaration, name: "narrow", explanation: "Conversion probe.", inputs: { word: 16 }, steps: [
      writeRegister(selector, truncate(value("word"), 3)),
      writeElement(slots, literal(3, 0), truncate(value("word"), 14)),
      writeRegister(cpu.register("a"), truncate(value("word"), 8)),
    ] }),
    widen: define([readRegister("slot", selector), writeRegister(cpu.register("a"), extend(value("slot"), 8)),
      writeRegister(cpu.register("b"), signExtend(value("slot"), 8)),
      readElement("address", slots, literal(3, 0)),
      writeElement(slots, literal(3, 1), truncate(signExtend(value("address"), 16), 14)),
      writeRegister(cpu.register("c"), truncate(signExtend(value("address"), 16), 8)),
      writeRegister(cpu.register("d"), highByte(signExtend(value("address"), 16))),
      writeRegister(cpu.register("e"), highByte(extend(value("address"), 16))),
    ]),
  };
  const compiled = await compile(definitions), actual = state();
  for (let word = 0; word < 65536; word++) {
    compiled.narrow!(actual, word);
    assert.equal(actual.stackIndex, word % 8);
    assert.equal(actual.addressStack[0], word % 16384);
    assert.equal(actual.a, word % 256);
    compiled.widen!(actual);
    assert.equal(actual.a, word % 8);
    assert.equal(actual.b, word % 8 < 4 ? word % 8 : word % 8 + 248);
    assert.equal(actual.addressStack[1], word % 16384);
    assert.equal(actual.c, word % 256);
    assert.equal(actual.d, Math.floor((word % 16384 + (word % 16384 < 8192 ? 0 : 49152)) / 256));
    assert.equal(actual.e, Math.floor(word % 16384 / 256));
  }
});

test("indexed effects use captured selectors and stop after a failed element read", async () => {
  const probe = define([readRegister("slot", selector), readElement("address", slots, value("slot")),
    writeRegister(selector, literal(3, 0)), writeElement(slots, value("slot"), value("address"))]);
  const compiled = await compile({ probe });
  for (const fail of [false, true]) {
    const actual = state(), raw = actual.addressStack, events: string[] = [], failure = new Error("element read failure");
    actual.addressStack = new Proxy(raw, {
      get(target, key, receiver) {
        events.push(`read ${String(key)}`); assert.equal(key, "7"); actual.stackIndex = 3;
        if (fail) throw failure;
        return Reflect.get(target, key, receiver);
      },
      set(target, key, value) { assert.equal(actual.stackIndex, 0); events.push(`write ${String(key)}=${value}`); return Reflect.set(target, key, value); },
    });
    if (fail) assert.throws(() => compiled.probe!(actual), error => error === failure); else compiled.probe!(actual);
    assert.deepEqual(events, fail ? ["read 7"] : ["read 7", "write 7=7"]);
    assert.equal(actual.stackIndex, fail ? 3 : 0);
  }
  const description = describeInstruction(probe);
  assert.match(description, /slot:u3 := read STACKINDEX\naddress:u14 := read ADDRESSSTACK\[slot\]/);
  assert.match(description, /write STACKINDEX:u3 := 0:u3\nwrite ADDRESSSTACK\[slot\]:u14 := address/);
});
