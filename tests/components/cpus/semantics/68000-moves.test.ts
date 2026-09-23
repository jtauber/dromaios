import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { initialState } from "../../../helpers/68000-state.js";
import * as movesModule from "../../../../src/components/cpus/generated/68000-source-mode-source-code-destination-mode-destination-code.js";
import { selectFamily } from "../../../helpers/68000-families.js";
const movesFamily = selectFamily(movesModule, "operandMove");
const { instructions, opcodeInstructions } = movesFamily;
import type { WordAddressContext, OperandAlignmentFault } from "../../../../src/components/cpus/word-execution.js";
import type { WordInstructionContext } from "../../../../src/components/cpus/instruction-context.js";
import type { Cpu68000State } from "../../../../src/components/cpus/semantics/generated/state/68000.js";
import { cpu68000StateDescription } from "../../../../src/components/cpus/semantics/generated/state/68000.js";
import { cpu6502StateDescription } from "../../../../src/components/cpus/semantics/generated/state/6502.js";
import { moves68000 } from "../../../helpers/68000-families.js";
import { alignmentFault, commitAddressUpdates, cpuSymbols, fetchWord, flagLiteral, literal, lowBit, readMemory, readProgramMemory, readSource, resolveAddress, value, when } from "../../../../src/components/cpus/semantics/model.js";
import type { Statement } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";

type Context = WordAddressContext & Pick<WordInstructionContext, "fetchWord" | "readByte" | "writeByte">;
type Body = (state: Cpu68000State, sourceMode: number, sourceCode: number, destinationMode: number, destinationCode: number, context: Context) => OperandAlignmentFault | "unsupported" | void;
const bodies: Readonly<Record<number, Body>> = opcodeInstructions;
const data = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"] as const;
const address = ["a0", "a1", "a2", "a3", "a4", "a5", "a6"] as const;
type Stored = typeof data[number] | typeof address[number] | "usp" | "ssp";
interface Form { opcode: number; size: 8 | 16 | 32; sm: number; sc: number; dm: number; dc: number; key: string }
const wrap = (n: number) => (n + 4294967296) % 4294967296;
const sourceMemory = (mode: number, code: number) => mode >= 2 && !(mode === 7 && code === 4);
const register = (s: Cpu68000State, mode: number, code: number): Stored => mode === 0 ? data[code]! : code === 7 ? s.flags.s ? "ssp" : "usp" : address[code]!;

// Independent whole-operation-word scan; no production pattern expansion or operand selectors.
const forms: Form[] = [];
for (let opcode = 0x1000; opcode < 0x4000; opcode++) {
  const size = Math.floor(opcode / 4096) === 1 ? 8 : Math.floor(opcode / 4096) === 2 ? 32 : 16;
  const sm = Math.floor(opcode / 8) % 8, sc = opcode % 8, dm = Math.floor(opcode / 64) % 8, dc = Math.floor(opcode / 512) % 8;
  if ((sm === 7 && sc > 4) || (dm === 7 && dc > 1) || (size === 8 && (sm === 1 || dm === 1)) || (sm < 2 && dm < 2)) continue;
  const source = sm === 0 ? `d${sc}` : sm === 1 ? `a${sc}` : sm === 7 && sc === 4 ? "immediate" : sm === 7 && sc >= 2 ? "program" : "memory";
  const destination = dm === 0 ? `d${dc}` : dm === 1 ? `a${dc}` : "memory";
  forms.push({ opcode, size, sm, sc, dm, dc, key: `${size}_${source}_${destination}` });
}
const representatives = [...new Map(forms.map(form => [form.key, form])).values()].map(form => ({ ...form,
  sm: form.key.includes("_memory_") ? 3 : form.sm, sc: form.key.includes("_memory_") ? 7 : form.sc,
  dm: form.dm >= 2 ? 3 : form.dm, dc: form.dm >= 2 ? 7 : form.dc,
}));

function reference(s: Cpu68000State, f: Form, c: Context): OperandAlignmentFault | void {
  let result: number;
  if (f.sm < 2) result = s[register(s, f.sm, f.sc)] % 2 ** f.size;
  else if (!sourceMemory(f.sm, f.sc)) {
    result = c.fetchWord();
    result = f.size === 32 ? result * 65536 + c.fetchWord() : result % 2 ** f.size;
  } else {
    const source = c.resolveAddress(f.size, f.sm, f.sc), program = f.sm === 7 && (f.sc === 2 || f.sc === 3);
    if (f.size > 8 && source % 2) return { operation: "read", address: source, programSpace: program };
    result = 0;
    for (let offset = 0; offset < f.size / 8; offset++) result = result * 256 + (program ? c.readProgramByte(wrap(source + offset)) : c.readByte(wrap(source + offset)));
  }
  const destination = f.dm < 2 ? register(s, f.dm, f.dc) : c.resolveAddress(f.size, f.dm, f.dc);
  if (typeof destination === "number" && f.size > 8 && destination % 2) return { operation: "write", address: destination };
  if (sourceMemory(f.sm, f.sc) || f.dm >= 2) c.commitAddressUpdates();
  if (typeof destination === "number") {
    for (let offset = 0; offset < f.size / 8; offset++) c.writeByte(wrap(destination + offset), Math.floor(result / 2 ** (f.size - 8 - offset * 8)) % 256);
  } else if (f.dm === 1) s[destination] = f.size === 16 && result >= 32768 ? result + 4294901760 : result;
  else s[destination] = f.size === 32 ? result : Math.floor(s[destination] / 2 ** f.size) * 2 ** f.size + result;
  if (f.dm !== 1) { s.flags.n = result >= 2 ** (f.size - 1); s.flags.z = result === 0; s.flags.v = false; s.flags.c = false; }
}

interface Scenario { bits: number; source: number; destination: number; seed: number; mutate?: boolean }
function observe(form: Form, scenario: Scenario, failAt: number, generated: boolean) {
  const state = initialState(scenario.bits), events: unknown[][] = [], memory = new Map<number, number>(), pending = new Map<Stored, number>();
  const flags = state.flags, failure = Error("injected MOVE effect failure");
  let failed = false, outcome: OperandAlignmentFault | "unsupported" | void, resolutions = 0, fetches = 0;
  const effect = (...event: unknown[]) => { events.push(event); if (events.length - 1 === failAt) throw failure; };
  const observed = new Proxy(state, {
    get(target, key, receiver) {
      if (key === "flags") return new Proxy(target.flags, {
        get(target, key, receiver) { const contents = Reflect.get(target, key, receiver); effect("flag read", key, contents); return contents; },
        set(target, key, contents) { effect("flag write", key, contents); return Reflect.set(target, key, contents); },
      });
      const contents = Reflect.get(target, key, receiver); effect("read", key, contents); return contents;
    },
    set(target, key, contents) { effect("write", key, contents); return Reflect.set(target, key, contents); },
  });
  const mutate = () => {
    if (!scenario.mutate) return;
    state.d0 = 0x112280ff; state.d7 = 0x99887766; state.usp = 0x12345678; state.ssp = 0x87654321;
    state.flags.s = !state.flags.s;
  };
  const read = (space: string, address: number) => { effect("memory read", space, address); mutate(); return (address % 256 + scenario.seed) % 256; };
  const context: Context = {
    resolveAddress(size, mode, code) {
      effect("resolve", size, mode, code);
      const address = resolutions++ === 0 && sourceMemory(form.sm, form.sc) ? scenario.source : scenario.destination;
      if (mode === 3 || mode === 4) pending.set(register(state, 1, code), wrap(address + (mode === 3 ? code === 7 && size === 8 ? 2 : size / 8 : 0)));
      mutate(); return address;
    },
    commitAddressUpdates() { effect("commit"); for (const [field, address] of pending) observed[field] = address; mutate(); },
    fetchWord() { effect("fetch word"); mutate(); return fetches++ === 0 ? scenario.seed * 257 : 0x8123; },
    readByte: address => read("data", address), readProgramByte: address => read("program", address),
    writeByte(address, byte) { effect("memory write", address, byte); mutate(); memory.set(address, byte); },
  };
  try { outcome = generated ? bodies[form.opcode]!(observed, form.sm, form.sc, form.dm, form.dc, context) : reference(observed, form, context); }
  catch (error) { if (error !== failure) throw error; failed = true; }
  assert.equal(state.flags, flags);
  return { state, events, memory: [...memory], failed, outcome: outcome! };
}

test("68000 remaining MOVE bindings cover exactly 9,150 legal forms with 169 shared bodies", () => {
  assert.equal(forms.length, 9150); assert.equal(representatives.length, 169);
  assert.deepEqual(Object.keys(bodies).map(Number), forms.map(form => form.opcode));
  const names = representatives.map(form => {
    const [size, from, to] = form.key.split("_");
    return `${to!.startsWith("a") ? "MOVEA" : "MOVE"}.${size === "8" ? "B" : size === "16" ? "W" : "L"} ${from!.toUpperCase()},${to!.toUpperCase()}`;
  }).sort();
  assert.deepEqual(Object.keys(moves68000).sort(), names);
  assert.deepEqual(Object.keys(instructions).sort(), names);
  assert.equal(new Set(Object.values(bodies)).size, 169);

});

test("every MOVE binding preserves its source, destination, space, width, and both active stack banks", () => {
  for (const form of forms) for (const bits of [0, 127]) {
    const scenario = { bits, source: 0xfffffffe, destination: 0xabfffffe, seed: 0x80 };
    assert.deepEqual(observe(form, scenario, -1, true), observe(form, scenario, -1, false), form.key);
  }
});

test("all memory MOVE bodies preserve effect order and completed state at every possible failure", () => {
  for (const form of representatives) for (const bits of [0, 127]) {
    const scenario = { bits, source: 0xfffffffe, destination: 0x12345678, seed: 0xff, mutate: true };
    const expected = observe(form, scenario, -1, false);
    assert.deepEqual(observe(form, scenario, -1, true), expected, form.key);
    for (let failure = 0; failure < expected.events.length; failure++) {
      assert.deepEqual(observe(form, scenario, failure, true), observe(form, scenario, failure, false), `${form.key} at ${failure}`);
    }
  }
});

test("MOVE faults return the rejected logical access before committing updates or making that access", () => {
  for (const form of representatives) for (const source of [0xffffffff, 0xfffffffe]) for (const destination of [0x89abcdef, 0x89abcdee]) {
    const scenario = { bits: 127, source, destination, seed: 0x80 }, actual = observe(form, scenario, -1, true);
    assert.deepEqual(actual, observe(form, scenario, -1, false), form.key);
    if (actual.outcome && actual.outcome !== "unsupported") {
      assert.ok(!actual.events.some(event => event[0] === "commit" || event[0] === "memory write"));
      if (actual.outcome.operation === "read") assert.ok(!actual.events.some(event => event[0] === "memory read"));
    }
  }
});

test("MOVE result flags and sign extension cover all incoming flags and operand byte boundaries", () => {
  for (const form of representatives) for (let bits = 0; bits < 128; bits++) for (const seed of [0, 0x7f, 0x80, 0xff]) {
    const scenario = { bits, source: 0, destination: 0x12340000, seed };
    assert.deepEqual(observe(form, scenario, -1, true), observe(form, scenario, -1, false), form.key);
  }
});

test("staged address effects validate CPU, selectors, logical width, access space, and rejection scope", () => {
  const cpu = cpuSymbols("68000", cpu68000StateDescription), other = cpuSymbols("6502", cpu6502StateDescription);
  const base = { cpu: { ...cpu.declaration, wordBoundary: true as const }, name: "probe", explanation: "Contract probe.", steps: [] as readonly Statement[] };
  const valid = [resolveAddress("source", 16, literal(3, 7), literal(3, 2)),
    when(lowBit(value("source")), [alignmentFault("read", value("source"), "program")]), readProgramMemory("byte", value("source")), commitAddressUpdates(), fetchWord("word")];
  defineInstruction({ ...base, steps: valid });
  for (const steps of [valid, [commitAddressUpdates()], [readProgramMemory("byte", literal(32, 0))], [alignmentFault("read", literal(32, 1))]]) {
    assert.throws(() => defineInstruction({ ...base, cpu: other.declaration, steps }), /word/);
  }
  assert.throws(() => defineInstruction({ ...base, steps: [resolveAddress("address", 16, literal(8, 7), literal(3, 2))] }), /3-bit/);
  assert.throws(() => defineInstruction({ ...base, steps: [readMemory("byte", literal(16, 0))] }), /32-bit/);
  assert.throws(() => defineInstruction({ ...base, steps: [readProgramMemory("byte", literal(16, 0))] }), /32-bit/);
  assert.throws(() => defineInstruction({ ...base, steps: [alignmentFault("write", literal(32, 1), "program")] }), /access space/);
  assert.throws(() => defineInstruction({ ...base, steps: [readSource("word", { name: "cannot reject", width: 16,
    steps: [alignmentFault("read", literal(32, 1))], result: literal(16, 0) })] }), /sources and composed actions cannot reject/);
  assert.throws(() => defineInstruction({ ...base, steps: [resolveAddress("address", 16, value("missing"), literal(3, 2))] }), /missing/);
  const text = describeInstruction(moves68000["MOVE.L PROGRAM,MEMORY"]!);
  assert.ok(text.indexOf("read program memory") < text.indexOf("destinationAddress:u32 := resolve"));
  assert.ok(text.indexOf("commit staged") < text.indexOf("write memory"));
  assert.match(text, /program-space read alignment fault/); assert.match(text, /data-space write alignment fault/);
});

test("native-word and address capabilities are inferred inside conditions; returned faults escape the whole body", async () => {
  const cpu = cpuSymbols("68000", cpu68000StateDescription);
  const definition = { cpu: { ...cpu.declaration, wordBoundary: true as const }, name: "nested fault", explanation: "Compiler contract.", steps: [when(flagLiteral(true), [
    fetchWord("word"), resolveAddress("address", 32, literal(3, 7), literal(3, 2)), alignmentFault("read", value("address"), "program"),
  ]), commitAddressUpdates()] };
  const source = generateInstructions("68000", { probe: definition });
  const compiled: { instructions: { probe(state: Cpu68000State, context: Pick<Context, "fetchWord" | "resolveAddress" | "commitAddressUpdates">): OperandAlignmentFault | void } } =
    await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source))}`);
  const events: string[] = [];
  assert.deepEqual(compiled.instructions.probe(initialState(), { fetchWord() { events.push("word"); return 0; },
    resolveAddress() { events.push("address"); return 0x89abcdef; }, commitAddressUpdates() { assert.fail("Fault must stop the outer body"); } }),
  { operation: "read", address: 0x89abcdef, programSpace: true });
  assert.deepEqual(events, ["word", "address"]);
});
