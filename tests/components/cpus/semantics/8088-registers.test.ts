import type { BytePorts } from "../../../../src/components/cpus/port-access.js";
import { noPorts } from "../../../helpers/no-ports.js";
import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { instructions, opcodeEntries } from "../../../../src/components/cpus/generated/8088.js";
import { instructions8088 } from "../../../../src/components/cpus/semantics/definitions.js";
import { byteRegisterView } from "../../../../src/components/cpus/semantics/builders.js";
import { cpuSymbols, extend, literal, readSource, value, writeRegister } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { cpu8088StateDescription } from "../../../../src/components/cpus/state/8088.js";
import type { Cpu8088State } from "../../../../src/components/cpus/state/8088.js";
import { aluForms, aluResult, byteMoves, flags, initialState, unaryResult, wordMoves, words } from "../8088/helpers.js";

type Word = typeof words[number];
type Body = (state: Cpu8088State, instruction: BytePorts & {
  fetchByte(): number; readByte(address: number): number; writeByte(address: number, byte: number): void; deferInterrupt(scope: "intr" | "all"): void;
}) => void;
const noEffects = { ...noPorts, readByte: (): never => assert.fail("Unexpected data read"), writeByte: (): never => assert.fail("Unexpected data write"),
  deferInterrupt: (): never => assert.fail("Unexpected deferral") };
const bodies: Readonly<Partial<Record<number, Body>>> = instructions;
const names: Readonly<Record<number, string>> = {
  ...Object.fromEntries(aluForms.flatMap(([name, , , , , byte, word]) => [[byte, `${name} AL,n`], [word, `${name} AX,n`]])),
  ...Object.fromEntries(byteMoves.map(([opcode, word, half]) => [opcode, `MOV ${word[0]!.toUpperCase()}${half === "low" ? "L" : "H"},n`])),
  ...Object.fromEntries(wordMoves.map(([opcode, word]) => [opcode, `MOV ${word.toUpperCase()},n`])),
  ...Object.fromEntries(words.flatMap((word, index) => [[0x40 + index, `INC ${word.toUpperCase()}`], [0x48 + index, `DEC ${word.toUpperCase()}`],
    [0x90 + index, index === 0 ? "NOP" : `XCHG AX,${word.toUpperCase()}`]])),
  0xa8: "TEST AL,n", 0xa9: "TEST AX,n",
};

test("8088 register definitions and bindings retain their 58 complete forms without observing state at binding time", () => {
  assert.equal(Object.keys(names).length, 58);
  assert.deepEqual(Object.fromEntries(Object.entries(instructions8088).filter(([opcode]) => Number(opcode) in names).map(([opcode, definition]) => [opcode, definition.name])), names);
  const forbidden = new Proxy(initialState(), { get() { assert.fail("Binding must not read state"); } });
  assert.deepEqual(opcodeEntries(forbidden).map(([opcode]) => opcode).filter(opcode => opcode in names), Object.keys(names).map(Number));
  const first = initialState(), second = initialState({ ax: 0x9876 });
  const one = new Map(opcodeEntries(first)), two = new Map(opcodeEntries(second));
  const context = { ...noEffects, fetchByte: () => 0x55, readByte: () => { throw Error("Unexpected data read"); }, writeByte: () => { throw Error("Unexpected data write"); } };
  one.get(0xb0)!(context); two.get(0xb4)!(context);
  assert.equal(first.ax, 0x1155); assert.equal(second.ax, 0x5576);
});

test("byte views read every stored word and preserve the live other half when writing", async () => {
  const cpu = cpuSymbols("8088", cpu8088StateDescription);
  for (const half of ["low", "high"] as const) {
    const view = byteRegisterView(cpu.register("ax"), half);
    const definitions = {
      read: defineInstruction({ cpu: cpu.declaration, name: "read view", explanation: "Read the selected byte.",
        steps: [readSource("byte", view.source), writeRegister(cpu.register("dx"), extend(value("byte"), 16))] }),
      write: defineInstruction({ cpu: cpu.declaration, name: "write view", explanation: "Replace the selected byte.", inputs: { byte: 8 }, steps: view.write(value("byte")) }),
    };
    const source = generateInstructions("8088", definitions);
    const compiled: { instructions: { read(state: Cpu8088State): void; write(state: Cpu8088State, byte: number): void } } =
      await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source))}`);
    const state = initialState();
    for (let word = 0; word < 65536; word++) {
      state.ax = word; compiled.instructions.read(state);
      assert.equal(state.dx, half === "low" ? word % 256 : Math.floor(word / 256));
      for (const byte of [0, 1, 0x7f, 0x80, 0xff]) {
        state.ax = word; compiled.instructions.write(state, byte);
        assert.equal(state.ax, half === "low" ? Math.floor(word / 256) * 256 + byte : byte * 256 + word % 256);
      }
    }
    assert.throws(() => defineInstruction({ ...definitions.write, steps: view.write(literal(16, 1)) }), /widths/);
  }
  assert.throws(() => byteRegisterView({ ...cpu.register("ax"), width: 8 }, "low"), /stored word/);
});

interface Effect { readonly name: string; readonly apply?: (state: Cpu8088State) => void }
const read = (name: string): Effect => ({ name: `read ${name}` });
const write = (field: Word, contents: number): Effect => ({ name: `write ${field}`, apply: state => { state[field] = contents; } });
const writeFlag = (field: keyof Cpu8088State["flags"], contents: boolean): Effect => ({ name: `write flag ${field}`, apply: state => { state.flags[field] = contents; } });
const fetches = (count: number): Effect[] => Array.from({ length: count }, () => ({ name: "fetch" }));

// Independent effect schedules and arithmetic oracle; no definition or generated statement inspection.
function expectedEffects(opcode: number, state: Cpu8088State): Effect[] {
  if (opcode >= 0xb0) {
    if (opcode >= 0xb8) return [...fetches(2), write(words[opcode - 0xb8]!, 0x8027)];
    const [, word, half] = byteMoves[opcode - 0xb0]!;
    return [...fetches(1), read(word), write(word, half === "low" ? Math.floor(state[word] / 256) * 256 + 0x27 : 0x2700 + state[word] % 256)];
  }
  if (opcode >= 0x90 && opcode <= 0x97) {
    const word = words[opcode - 0x90]!;
    return [read(word), read("ax"), write("ax", state[word]), write(word, state.ax)];
  }
  if (opcode >= 0x40 && opcode <= 0x4f) {
    const word = words[opcode % 8]!, decrement = opcode >= 0x48;
    const arithmetic = aluResult(decrement ? "SUB" : "ADD", 16, state[word], 1, state.flags);
    return [read(word), read("flag cf"), ...(["cf", "af", "of", "zf", "sf", "pf"] as const).map(flag => writeFlag(flag, arithmetic.flags[flag])),
      writeFlag("cf", state.flags.cf), write(word, arithmetic.result)];
  }
  const operation = opcode >= 0xa8 ? "TEST" : aluForms[Math.floor(opcode / 8)]![0], width = opcode % 2 ? 16 : 8;
  const { result, flags } = aluResult(operation, width, state.ax % 2 ** width, width === 8 ? 0x27 : 0x8027, state.flags);
  const logical = ["OR", "AND", "XOR", "TEST"].includes(operation);
  return [...fetches(width / 8), read("ax"), ...(["ADC", "SBB"].includes(operation) ? [read("flag cf")] : []),
    ...(logical ? ["of", "cf", "af", "zf", "sf", "pf"] as const : ["cf", "af", "of", "zf", "sf", "pf"] as const).map(flag => writeFlag(flag, flags[flag])),
    ...(["CMP", "TEST"].includes(operation) ? [] : [...(width === 8 ? [read("ax")] : []), write("ax", width === 8 ? Math.floor(state.ax / 256) * 256 + result : result)])];
}

function observed(state: Cpu8088State, effect: (name: string) => void): Cpu8088State {
  return new Proxy(state, {
    get(target, key, receiver) {
      if (key === "flags") return new Proxy(target.flags, {
        get(target, key, receiver) { effect(`read flag ${String(key)}`); return Reflect.get(target, key, receiver); },
        set(target, key, value) { effect(`write flag ${String(key)}`); return Reflect.set(target, key, value); },
      });
      effect(`read ${String(key)}`); return Reflect.get(target, key, receiver);
    },
    set(target, key, value) { effect(`write ${String(key)}`); return Reflect.set(target, key, value); },
  });
}

test("all 58 8088 bodies retain their native effect order and exactly completed changes at every failure", () => {
  for (const key of Object.keys(names)) for (const bits of [0, 511]) {
    const opcode = Number(key), before = initialState({ ax: 0x7fff, flags: flags(bits) }), expected = expectedEffects(opcode, before);
    for (let failAt = -1; failAt < expected.length; failAt++) {
      const state = structuredClone(before), events: string[] = [], failure = new Error("effect failed");
      const flagsObject = state.flags;
      const effect = (name: string) => { events.push(name); if (events.length - 1 === failAt) throw failure; };
      let fetched = 0;
      const run = () => bodies[opcode]!(observed(state, effect), { ...noEffects, fetchByte: () => { effect("fetch"); return [0x27, 0x80][fetched++]!; } });
      if (failAt < 0) run(); else assert.throws(run, error => error === failure);
      assert.deepEqual(events, expected.slice(0, failAt < 0 ? undefined : failAt + 1).map(effect => effect.name), `${names[opcode]} at ${failAt}`);
      const after = structuredClone(before);
      expected.slice(0, failAt < 0 ? undefined : failAt).forEach(effect => effect.apply?.(after));
      assert.deepEqual(state, after, `${names[opcode]} at ${failAt}`); assert.equal(state.flags, flagsObject);
    }
  }
});

test("8088 byte writeback captures the retained half after fetching and after flags, while CMP/TEST never reread AX", () => {
  for (const opcode of [0xb0, 0xb4, 0x04, 0x14, 0x1c, 0x0c, 0x3c, 0xa8]) {
    const state = initialState({ ax: 0x1234, flags: flags(0) });
    bodies[opcode]!(observed(state, name => {
      if (name === "write flag pf") state.ax = 0xaa55;
    }), { ...noEffects, fetchByte: () => { state.ax = 0xbb7f; state.flags.cf = true; return 1; } });
    const expected = opcode === 0xb0 ? 0xbb01 : opcode === 0xb4 ? 0x017f : opcode === 0x3c || opcode === 0xa8 ? 0xaa55
      : 0xaa00 + aluResult(opcode === 0x04 ? "ADD" : opcode === 0x14 ? "ADC" : opcode === 0x1c ? "SBB" : "OR", 8, 0x7f, 1, flags(1)).result;
    assert.equal(state.ax, expected);
  }
});

test("8088 generated register adjustments preserve both incoming carries over the complete word range", () => {
  const state = initialState();
  for (const decrement of [false, true]) for (const cf of [false, true]) for (let word = 0; word < 65536; word++) {
    state.ax = word; state.flags = { ...flags(0x1fe), cf };
    const expected = unaryResult(decrement ? "DEC" : "INC", 16, word, state.flags);
    bodies[decrement ? 0x48 : 0x40]!(state, { ...noEffects, fetchByte: () => { throw Error("Unexpected fetch"); } });
    assert.equal(state.ax, expected.result); assert.deepEqual(state.flags, expected.flags);
  }
});

test("8088 descriptions expose byte preservation, low-byte parity, and carry after operand capture", () => {
  const text = describeInstruction(instructions8088[0x15]!);
  assert.ok(text.indexOf("source immediate word") < text.indexOf("read AX"));
  assert.ok(text.indexOf("read AX") < text.indexOf("read CF"));
  assert.match(text, /PF := evenParity8\(lowByte\(result\)\)/);
  assert.match(text, /Flags preserved throughout: TF, IF, DF\./);
  const move = describeInstruction(instructions8088[0xb4]!);
  assert.match(move, /concatHighLow\(result, lowByte\(preservedWord\)\)/);
});
