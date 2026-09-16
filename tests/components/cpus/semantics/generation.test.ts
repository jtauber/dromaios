import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { instructions as mos, opcodeEntries } from "../../../../src/components/cpus/generated/6502.js";
import { instructions as intel } from "../../../../src/components/cpus/generated/8080.js";
import { instructions as motorola } from "../../../../src/components/cpus/generated/6809.js";
import { instructions6502, sources6502, instructions8080, instructions6809 } from "../../../../src/components/cpus/semantics/definitions.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { instructionSet } from "../../../../src/components/cpus/semantics/builders.js";
import { cpuSymbols, addWrap, literal, value, zero } from "../../../../src/components/cpus/semantics/model.js";
import { cpu6502StateDescription } from "../../../../src/components/cpus/state/6502.js";
import type { Cpu6502State } from "../../../../src/components/cpus/state/6502.js";
import type { Cpu8080State } from "../../../../src/components/cpus/state/8080.js";
import type { Cpu6809State } from "../../../../src/components/cpus/state/6809.js";

function mosState(): Cpu6502State {
  return { a: 0, x: 0, y: 0, sp: 0xff, pc: 0x1000, flags: { n: false, z: false, c: true, v: true, d: true, i: true } };
}
function intelState(): Cpu8080State {
  return { a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0x1000, sp: 0xffff,
    flags: { s: false, z: false, p: false, cy: true, ac: true },
    interruptEnabled: true, interruptDeferred: true, halted: false };
}
function motorolaState(): Cpu6809State {
  return { a: 0, b: 0, dp: 0, x: 0, y: 0, s: 0xffff, u: 0, pc: 0x1000, waitMode: "none", nmiArmed: true,
    flags: { e: true, f: true, h: true, i: true, n: false, z: false, v: true, c: true } };
}

test("all generated modules reproduce from definitions without changing them", () => {
  for (const [cpu, definitions] of [["6502", instructions6502], ["8080", instructions8080], ["6809", instructions6809]] as const) {
    const before = JSON.stringify(definitions);
    const source = generateInstructions(cpu, definitions, { bindOpcodes: cpu === "6502", sources: cpu === "6502" ? sources6502 : undefined });
    assert.equal(source, readFileSync(`src/components/cpus/generated/${cpu}.ts`, "utf8"));
    assert.equal(generateInstructions(cpu, definitions, { bindOpcodes: cpu === "6502", sources: cpu === "6502" ? sources6502 : undefined }), source);
    assert.equal(JSON.stringify(definitions), before);
  }
  assert.throws(() => generateInstructions("8080", instructions6502), /expected a 8080 definition/);
});

test("6502 families generate exactly the migrated encodings, including the opposite-index loads", () => {
  // Explicit opcode expectations are independent of the authored bit-pattern expansion.
  const expected = {
    0x8a: "TXA", 0x98: "TYA", 0x9a: "TXS", 0xa8: "TAY", 0xaa: "TAX", 0xba: "TSX",
    0x0a: "ASL A", 0x06: "ASL zero page", 0x0e: "ASL absolute", 0x16: "ASL zero page,X", 0x1e: "ASL absolute,X",
    0x2a: "ROL A", 0x26: "ROL zero page", 0x2e: "ROL absolute", 0x36: "ROL zero page,X", 0x3e: "ROL absolute,X",
    0x4a: "LSR A", 0x46: "LSR zero page", 0x4e: "LSR absolute", 0x56: "LSR zero page,X", 0x5e: "LSR absolute,X",
    0x6a: "ROR A", 0x66: "ROR zero page", 0x6e: "ROR absolute", 0x76: "ROR zero page,X", 0x7e: "ROR absolute,X",
    0xc6: "DEC zero page", 0xce: "DEC absolute", 0xd6: "DEC zero page,X", 0xde: "DEC absolute,X",
    0xe6: "INC zero page", 0xee: "INC absolute", 0xf6: "INC zero page,X", 0xfe: "INC absolute,X",
    0x88: "DEY", 0xc8: "INY", 0xca: "DEX", 0xe8: "INX",
    0xa1: "LDA (zero page,X)", 0xa5: "LDA zero page", 0xa9: "LDA #byte", 0xad: "LDA absolute",
    0xb1: "LDA (zero page),Y", 0xb5: "LDA zero page,X", 0xb9: "LDA absolute,Y", 0xbd: "LDA absolute,X",
    0xa2: "LDX #byte", 0xa6: "LDX zero page", 0xae: "LDX absolute", 0xb6: "LDX zero page,Y", 0xbe: "LDX absolute,Y",
    0xa0: "LDY #byte", 0xa4: "LDY zero page", 0xac: "LDY absolute", 0xb4: "LDY zero page,X", 0xbc: "LDY absolute,X",
    0xc1: "CMP (zero page,X)", 0xc5: "CMP zero page", 0xc9: "CMP #byte", 0xcd: "CMP absolute",
    0xd1: "CMP (zero page),Y", 0xd5: "CMP zero page,X", 0xd9: "CMP absolute,Y", 0xdd: "CMP absolute,X",
    0xe0: "CPX #byte", 0xe4: "CPX zero page", 0xec: "CPX absolute",
    0xc0: "CPY #byte", 0xc4: "CPY zero page", 0xcc: "CPY absolute",
  };
  assert.deepEqual(Object.fromEntries(Object.entries(instructions6502).map(([opcode, definition]) => [opcode, definition.name])), expected);
  assert.deepEqual(opcodeEntries(mosState()).map(([opcode]) => opcode), Object.keys(expected).map(Number));
});

test("opcode inventories reject collisions and invalid encodings before generation", () => {
  const definition = instructions6502[0xaa]!;
  assert.throws(() => instructionSet([[0xaa, definition], [0xaa, definition]]), /Duplicate opcode/);
  for (const opcode of [-1, 256, 1.5, NaN]) {
    assert.throws(() => instructionSet([[opcode, definition]]), /opcode/);
    assert.throws(() => generateInstructions("6502", { [opcode]: definition }, { bindOpcodes: true }), /opcode/);
  }
  assert.throws(() => generateInstructions("6502", { tax: definition }, { bindOpcodes: true }), /opcode/);
  assert.throws(() => generateInstructions("6502", { "170": definition, "0xAA": definition }, { bindOpcodes: true }), /Duplicate opcode/);
  assert.throws(() => generateInstructions("6502", { "170": { ...definition, inputs: { address: 16 } } }, { bindOpcodes: true }), /cannot supply instruction inputs/);
});

test("generated numeric inputs preserve declaration order, widths, and names independently of host identifiers", async () => {
  const cpu = cpuSymbols("6502", cpu6502StateDescription);
  const definition = { cpu: cpu.declaration, name: "inputs", explanation: "Captured numeric inputs.",
    inputs: { instruction: 16, state: 8, class: 8 }, steps: [
      { kind: "write-register", register: cpu.register("pc"), value: value("instruction") },
      { kind: "read-source", name: "local", source: { name: "shadow", width: 8,
        steps: [{ kind: "capture", name: "state", value: literal(8, 0) }], result: value("state") } },
      { kind: "write-register", register: cpu.register("a"), value: value("state") },
      { kind: "write-memory", address: addWrap(value("instruction"), literal(16, 1)), value: value("class") },
      { kind: "write-register", register: cpu.register("x"), value: value("local") },
    ],
  } as const;
  const source = generateInstructions("6502", { probe: definition });
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
  const compiled: { instructions: { probe(state: Cpu6502State, address: number, a: number, byte: number,
    instruction: { writeByte(address: number, byte: number): void }): void } } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  const state = mosState(), writes: number[][] = [];
  compiled.instructions.probe(state, 0xffff, 0x80, 0x42, { writeByte: (address, byte) => { writes.push([address, byte]); } });
  assert.deepEqual(writes, [[0, 0x42]]);
  assert.equal(state.pc, 0xffff); assert.equal(state.a, 0x80); assert.equal(state.x, 0);
});

test("generated opcode bindings capture their own CPU instance and read live state only on execution", () => {
  const first = mosState(), second = mosState();
  let a = 0x12, reads = 0;
  Object.defineProperty(first, "a", { get() { reads++; return a; } });
  const firstHandlers = Object.fromEntries(opcodeEntries(first)), secondHandlers = Object.fromEntries(opcodeEntries(second));
  assert.equal(reads, 0);
  a = 0x80;
  const unusedContext = { fetchByte: () => assert.fail("unexpected fetch"), readByte: () => assert.fail("unexpected read"), writeByte: () => assert.fail("unexpected write") };
  firstHandlers[0xaa]!(unusedContext);
  assert.equal(reads, 1);
  assert.equal(first.x, 0x80); assert.equal(first.flags.n, true);
  assert.equal(second.x, 0); assert.equal(second.flags.n, false);
  second.a = 0x44;
  secondHandlers[0xaa]!(unusedContext);
  assert.equal(second.x, 0x44); assert.equal(first.x, 0x80);
});

test("generated byte comparisons match independent arithmetic for every operand pair", () => {
  const m = mosState(), i = intelState(), b = motorolaState();
  const signed = (value: number): number => value < 128 ? value : value - 256;
  for (let left = 0; left < 256; left++) for (let right = 0; right < 256; right++) {
    m.a = i.a = b.a = left;
    const context = { fetchByte: () => right };
    mos[0xc9](m, context); intel.cpi(i, context); motorola.cmpaImmediate(b, context);
    const result = (left - right + 256) % 256;
    const signedResult = signed(left) - signed(right);
    assert.deepEqual(m.flags, { n: result >= 128, z: result === 0, c: left >= right, v: true, d: true, i: true });
    assert.deepEqual(i.flags, { s: result >= 128, z: result === 0, cy: left < right,
      ac: left % 16 >= right % 16, p: [...result.toString(2)].filter(bit => bit === "1").length % 2 === 0 });
    assert.deepEqual(b.flags, { e: true, f: true, h: true, i: true, n: result >= 128, z: result === 0,
      v: signedResult < -128 || signedResult > 127, c: left < right });
    assert.equal(m.a, left); assert.equal(i.a, left); assert.equal(b.a, left);
  }
});

test("generated word comparison uses bit 15 for sign and word overflow while preserving the destination", () => {
  const state = motorolaState();
  const signed = (value: number): number => value < 32768 ? value : value - 65536;
  for (const left of [0, 1, 0x7fff, 0x8000, 0xffff]) for (const right of [0, 1, 0x7fff, 0x8000, 0xffff]) {
    state.x = left;
    const bytes = [Math.floor(right / 256), right % 256];
    motorola.cmpxImmediate(state, { fetchByte: () => bytes.shift()! });
    const result = (left - right + 65536) % 65536, difference = signed(left) - signed(right);
    assert.deepEqual(state.flags, { e: true, f: true, h: true, i: true, n: result >= 32768, z: result === 0,
      v: difference < -32768 || difference > 32767, c: left < right });
    assert.equal(state.x, left);
    assert.deepEqual(bytes, []);
  }
});

test("generated comparison never writes its destination, and captures it after source effects", () => {
  const state = intelState();
  Object.defineProperty(state, "a", { get: () => 0x20, set: () => assert.fail("CMP must not write A") });
  intel.cpi(state, { fetchByte: () => 0x20 });
  assert.equal(state.flags.z, true);
  const changed = mosState();
  mos[0xcd](changed, { fetchByte: () => 0, readByte: () => { changed.a = 0x44; return 0x44; } });
  assert.equal(changed.flags.z, true);
});

test("generated transfers capture their source and differ only in the declared flag effects", () => {
  const m = mosState(), i = intelState();
  m.a = i.a = 0x80;
  mos[0xaa](m); intel.movBA(i);
  assert.equal(m.x, 0x80); assert.equal(i.b, 0x80);
  assert.deepEqual(m.flags, { n: true, z: false, c: true, v: true, d: true, i: true });
  assert.deepEqual(i.flags, intelState().flags);
});

test("generated indexed comparison wraps each address and stops at either failed source read", () => {
  for (const failAt of [-1, 0, 1]) {
    const state = motorolaState(), before = { ...state.flags };
    state.x = 0xffff;
    const reads: number[] = [], failure = new Error("read failed");
    const execute = () => motorola.cmpxPostincrement(state, { readByte(address) {
      assert.equal(state.x, 1); // The update precedes even the first source read.
      if (reads.length === failAt) throw failure;
      reads.push(address);
      return address === 0xffff ? 0 : 1;
    } });
    if (failAt >= 0) assert.throws(execute, error => error === failure);
    else execute();
    assert.equal(state.x, 1);
    assert.deepEqual(reads, [0xffff, 0].slice(0, failAt < 0 ? 2 : failAt));
    assert.deepEqual(state.flags, failAt >= 0 ? before : { ...before, n: false, z: true, v: false, c: false });
  }
});

test("generated source scopes and policy parameters are hygienic, even for host names and keywords", async () => {
  const cpu = cpuSymbols("6502", cpu6502StateDescription);
  const definition = { cpu: cpu.declaration, name: "scope probe", explanation: "Compiler contract, not an opcode.", steps: [
    { kind: "capture", name: "state", value: literal(8, 7) },
    { kind: "read-source", name: "instruction", source: { name: "outer", width: 8, steps: [
      { kind: "capture", name: "state", value: literal(8, 9) },
      { kind: "read-source", name: "class", source: { name: "inner", width: 8,
        steps: [{ kind: "capture", name: "state", value: literal(8, 255) }], result: addWrap(value("state"), literal(8, 1)) } },
    ], result: addWrap(value("class"), value("state")) } },
    { kind: "write-register", register: cpu.register("a"), value: value("state") },
    { kind: "write-register", register: cpu.register("x"), value: value("instruction") },
    { kind: "update-flags", policy: { name: "swapped arguments", parameters: { state: 8, instruction: 8 }, unlisted: "preserve",
      updates: [{ flag: cpu.flag("z"), value: zero(value("state")) }, { flag: cpu.flag("c"), value: zero(value("instruction")) }] },
      arguments: { state: addWrap(value("instruction"), literal(8, 247)), instruction: value("state") } },
  ] } as const;
  const source = generateInstructions("6502", { probe: definition });
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  // Exercise a fresh generated body through Node's normal TypeScript stripping and module execution.
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
  const compiled: { instructions: { probe(state: Cpu6502State): void } } = await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  const state = mosState();
  compiled.instructions.probe(state);
  assert.equal(state.a, 7); assert.equal(state.x, 9);
  assert.equal(state.flags.z, true); assert.equal(state.flags.c, false);
});
