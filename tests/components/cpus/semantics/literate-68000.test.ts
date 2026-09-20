import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { Cpu68000 } from "../../../../src/components/cpus/68000.js";
import type { Cpu68000AddressContext, OperandAlignmentFault } from "../../../../src/components/cpus/68000-context.js";
import type { ByteMemory } from "../../../../src/components/cpus/memory-access.js";
import { cpu68000StateDescription } from "../../../../src/components/cpus/state/68000.js";
import type { Cpu68000State } from "../../../../src/components/cpus/state/68000.js";
import { instructions as registerBodies } from "../../../../src/components/cpus/generated/68000.js";
import { instructions as memoryBodies } from "../../../../src/components/cpus/generated/68000-word-moves.js";
import { instructions68000, wordMoves68000 } from "../../../../src/components/cpus/semantics/definitions.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { initialState } from "../../../helpers/68000-state.js";

const file = "src/components/cpus/specifications/68000-word-transfers.md";
const markdown = readFileSync(file, "utf8");
const compile = (text = markdown) => compileCpuChapter(text, { name: "68000", state: cpu68000StateDescription }, file);
const data = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"] as const;
const addressRegisters = ["a0", "a1", "a2", "a3", "a4", "a5", "a6"] as const;
type Context = ByteMemory & Pick<Cpu68000AddressContext, "resolveAddress" | "commitAddressUpdates">;
type Body = (state: Cpu68000State, context: Context) => OperandAlignmentFault | void;
const bodies: Readonly<Record<number, Body>> = { ...registerBodies, ...memoryBodies };
interface Form { readonly opcode: number; readonly kind: "copy" | "load" | "store"; readonly d: number; readonly r: number; readonly name: string }

// Independent operation-word bases; no production pattern or operand catalogue is used.
const forms: Form[] = [];
for (const [kind, base] of [["copy", 0x3000], ["load", 0x3010], ["store", 0x3080]] as const) {
  for (let d = 0; d < 8; d++) for (let r = 0; r < 8; r++) forms.push({ kind, d, r, opcode: base + d * 512 + r,
    name: `MOVE.W ${kind === "load" ? `(A${r})` : `D${r}`},${kind === "store" ? `(A${d})` : `D${d}`}` });
}

test("the 68000 chapter owns exactly 192 word encodings and their production definitions", () => {
  const definitions = Object.fromEntries(Object.values(compile().families).flat());
  assert.deepEqual(Object.keys(definitions).map(Number), forms.map(form => form.opcode).sort((a, b) => a - b));
  assert.deepEqual(Object.keys(memoryBodies), Object.keys(wordMoves68000));
  assert.equal(Object.keys(memoryBodies).length, 128);
  for (const form of forms) {
    assert.equal(definitions[form.opcode]!.name, form.name);
    assert.deepEqual(definitions[form.opcode], (form.kind === "copy" ? instructions68000 : wordMoves68000)[form.opcode]);
  }
});

function reference(form: Form, state: Cpu68000State, context: Context): OperandAlignmentFault | void {
  let result: number;
  if (form.kind === "load") {
    const address = context.resolveAddress(16, 2, form.r);
    if (address % 2) return { operation: "read", address, programSpace: false };
    const high = context.readByte(address), low = context.readByte((address + 1) % 4294967296);
    result = high * 256 + low;
  } else result = state[data[form.r]!] % 65536;
  if (form.kind === "store") {
    const address = context.resolveAddress(16, 2, form.d);
    if (address % 2) return { operation: "write", address };
    context.commitAddressUpdates();
    context.writeByte(address, Math.floor(result / 256));
    context.writeByte((address + 1) % 4294967296, result % 256);
  } else {
    if (form.kind === "load") context.commitAddressUpdates();
    const register = data[form.d]!;
    state[register] = Math.floor(state[register] / 65536) * 65536 + result;
  }
  state.flags.n = result >= 32768; state.flags.z = result === 0;
  state.flags.v = false; state.flags.c = false;
}

function observe(form: Form, word: number, address: number, mutate: boolean, failAt: number, generated: boolean) {
  const state = initialState((form.opcode + word) % 128), events: unknown[][] = [], writes: number[][] = [];
  for (const register of data) state[register] = 0x89ab0000 + word;
  const failure = Error("injected word-transfer effect failure");
  const effect = (...event: unknown[]) => { events.push(event); if (events.length - 1 === failAt) throw failure; };
  const observed = new Proxy(state, {
    get(target, key, receiver) {
      if (key === "flags") return new Proxy(target.flags, {
        get(target, key, receiver) { const contents = Reflect.get(target, key, receiver); effect("read flag", key, contents); return contents; },
        set(target, key, contents) { effect("write flag", key, contents); return Reflect.set(target, key, contents); },
      });
      const contents = Reflect.get(target, key, receiver); effect("read", key, contents); return contents;
    },
    set(target, key, contents) { effect("write", key, contents); return Reflect.set(target, key, contents); },
  });
  const liveChange = () => { if (mutate) for (const register of data) state[register] = (state[register] ^ 0xfedcffff) >>> 0; };
  const context: Context = {
    resolveAddress(size, mode, code) { effect("resolve", size, mode, code); liveChange(); return address; },
    commitAddressUpdates() { effect("commit"); liveChange(); },
    readByte(location) { effect("read memory", location); liveChange(); return location === address ? Math.floor(word / 256) : word % 256; },
    writeByte(location, contents) { effect("write memory", location, contents); writes.push([location, contents]); liveChange(); },
  };
  let outcome: OperandAlignmentFault | void = undefined, failed = false;
  try { outcome = generated ? bodies[form.opcode]!(observed, context) : reference(form, observed, context); }
  catch (error) { assert.equal(error, failure); failed = true; }
  return { state, events, writes, outcome, failed };
}

test("literate words match independent effects, live upper bits, alignment faults, and every failure boundary", () => {
  for (const form of forms) for (const word of [0, 1, 0x7fff, 0x8000, 0xffff]) {
    for (const address of [0x01002000, 0xfffffffe, 0x101]) for (const mutate of [false, true]) {
      const expected = observe(form, word, address, mutate, -1, false);
      assert.deepEqual(observe(form, word, address, mutate, -1, true), expected, form.name);
      if (word === 0x8000) for (let failAt = 0; failAt < expected.events.length; failAt++) {
        assert.deepEqual(observe(form, word, address, mutate, failAt, true), observe(form, word, address, mutate, failAt, false),
          `${form.name}, failure ${failAt}`);
      }
    }
  }
});

test("all 192 literate encodings execute through the CPU, including both A7 banks and physical projection", () => {
  for (const form of forms) for (const supervisor of [false, true]) {
    const state = initialState(supervisor ? 95 : 31), bytes = new Map<number, number>([[0x1000, form.opcode >>> 8], [0x1001, form.opcode % 256], [0x2000, 0x80], [0x2001, 0x01]]);
    const code = form.kind === "store" ? form.d : form.r;
    const pointer = code === 7 ? supervisor ? "ssp" : "usp" : addressRegisters[code]!;
    state[pointer] = 0xab002000;
    const cpu = new Cpu68000({ size: 0x1000000, read: address => bytes.get(address) ?? 0,
      write(address, value) { bytes.set(address, value); } }, state);
    const record = cpu.step(), expected = { ...structuredClone(state), a7: supervisor ? state.ssp : state.usp, physicalPc: state.pc % 0x1000000 };
    const word = form.kind === "load" ? 0x8001 : state[data[form.r]!] % 65536;
    if (form.kind !== "store") expected[data[form.d]!] = Math.floor(expected[data[form.d]!] / 65536) * 65536 + word;
    Object.assign(expected.flags, { n: word >= 0x8000, z: word === 0, v: false, c: false });
    expected.pc += 2; expected.physicalPc += 2; expected.ir = form.opcode;
    assert.equal(record.exception, undefined); assert.equal(record.outcome, "executed");
    assert.deepEqual(record.after, expected, form.name);
    assert.deepEqual(record.accesses.slice(2), form.kind === "copy" ? [] : [
      { kind: form.kind === "store" ? "write" : "read", address: 0x2000, value: Math.floor(word / 256) },
      { kind: form.kind === "store" ? "write" : "read", address: 0x2001, value: word % 256 },
    ], form.name);
  }
});

const invalid: readonly [string, string, string, RegExp][] = [
  ["unknown captured value", "truncate(source, 16)", "truncate(missing, 16)", /not been captured/],
  ["non-narrowing truncation", "truncate(source, 16)", "truncate(source, 32)", /truncation must narrow/],
  ["mixed widths", "u32($FFFF0000)", "u16($FFFF)", /equal widths/],
  ["wide byte extraction", "highByte(result)", "highByte(source)", /requires a word/],
  ["wide mode selector", "u3(2)", "u8(2)", /3-bit/],
  ["unsupported operand width", "resolve(16,", "resolve(14,", /Operand size/],
  ["short logical address", "read(address) if", "read(truncate(address, 16)) if", /32-bit/],
  ["non-data alignment fault", "alignment read(address)", "alignment fetch(address)", /data read or write/],
  ["unknown predicate", "if lowBit(address)", "if odd(address)", /Unknown flag operation/],
  ["misspelled commit", "commit addresses", "commit registers", /Expected "addresses"/],
  ["spelled-out flag literal", "V = 0", "V = false", /flag literals as 0 or 1/],
  ["duplicate code", '001 "A1"', '000 "A1"', /consecutive binary/],
  ["missing code", '  111 "A7"\n', "", /every value/],
  ["write to encoded value", "code = operand d", "operand d <- result", /value-only/],
];
for (const [name, before, after, message] of invalid) test(`68000 chapter rejects ${name} at its document location`, () => {
  assert.ok(markdown.includes(before)); const changed = markdown.replace(before, after);
  const expectedLine = changed.split("\n").findIndex(line => line.includes(after)) + 1;
  assert.throws(() => compile(changed), (error: unknown) => {
    assert.ok(error instanceof ChapterError); assert.equal(error.file, file); assert.match(error.message, message);
    if (name !== "missing code") assert.equal(error.line, expectedLine);
    return true;
  });
});

test("formal edits to byte order and flag constants change the generated word store", async () => {
  const changed = markdown.replace("highByte(result)", "lowByte(result)").replace("lowByte(result)\n  apply", "highByte(result)\n  apply").replace("C = 0", "C = 1");
  const definition = compile(changed).families.store![0]![1];
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(generateInstructions("68000", { probe: definition })).replace('"../alu.ts"', JSON.stringify(alu));
  const compiled: { instructions: { probe: Body } } = await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  const state = initialState(0), writes: number[][] = [];
  compiled.instructions.probe(state, { resolveAddress: () => 0x1000, commitAddressUpdates() {},
    readByte() { throw new Error("A store cannot read destination memory."); }, writeByte(address, byte) { writes.push([address, byte]); } });
  assert.deepEqual(writes, [[0x1000, 0x44], [0x1001, 0x33]]);
  assert.equal(state.flags.c, true);
});
