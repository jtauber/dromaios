import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTypeScriptTypes } from "node:module";
import { cpu68000StateDescription } from "../../../../src/components/cpus/semantics/generated/state/68000.js";
import { cpu6502StateDescription } from "../../../../src/components/cpus/semantics/generated/state/6502.js";
import { alignmentFault, cpuSymbols, fetchWord, flagLiteral, literal, lowBit, readNextAddress, readSource, selectTarget, value, when, writeRegister } from "../../../../src/components/cpus/semantics/model.js";
import type { Statement } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { initialState } from "../../../helpers/68000-state.js";
import * as controlModule from "../../../../src/components/cpus/generated/68000-mode-code-displacement.js";
import { selectFamily } from "../../../helpers/68000-families.js";
const controlFamily = selectFamily(controlModule, "operandControl");
const { opcodeInstructions: instructions } = controlFamily;
import { control68000, controlOpcodes68000 } from "../../../helpers/68000-families.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import type { Cpu68000State } from "../../../../src/components/cpus/semantics/generated/state/68000.js";
import type { WordAddressContext, WordControlContext, OperandAlignmentFault, TargetAlignmentFault } from "../../../../src/components/cpus/word-execution.js";
import type { WordInstructionContext } from "../../../../src/components/cpus/instruction-context.js";

type Context = WordAddressContext & WordControlContext & Pick<WordInstructionContext, "fetchWord" | "readByte" | "writeByte">;
type Outcome = OperandAlignmentFault | TargetAlignmentFault | "unsupported" | void;
type Body = (state: Cpu68000State, mode: number, code: number, displacement: number, context: Context) => Outcome;
const bodies: Readonly<Record<number, Body>> = instructions;
const definitionNames = new Map(controlOpcodes68000);
const definition = (opcode: number) => control68000[definitionNames.get(opcode)!]!;
const names = ["T", "F", "HI", "LS", "CC", "CS", "NE", "EQ", "VC", "VS", "PL", "MI", "GE", "LT", "GT", "LE"];
const branchName = (code: number) => code === 0 ? "BRA" : code === 1 ? "BSR" : `B${names[code]}`;
const data = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"] as const;
const address = ["a0", "a1", "a2", "a3", "a4", "a5", "a6"] as const;
type Stored = typeof data[number] | typeof address[number] | "usp" | "ssp";
type Operation = "Scc" | "DBcc" | "Bcc" | "BSR" | "LEA" | "PEA" | "JMP" | "JSR" | "LINK" | "UNLK" | "RTS";
interface Form { opcode: number; operation: Operation; condition: number; register: number; mode: number; code: number; displacement: number; key: string }
const wrap = (n: number) => ((n % 4294967296) + 4294967296) % 4294967296;
const signed = (n: number, width: number) => n < 2 ** (width - 1) ? n : n - 2 ** width;

// Scan operation words independently, collapsing only embedded displacement literals for coverage.
const forms: Form[] = [];
for (let opcode = 0; opcode < 65536; opcode++) {
  const major = Math.floor(opcode / 4096), m = Math.floor(opcode / 8) % 8, r = opcode % 8;
  const condition = Math.floor(opcode / 256) % 16, controlEA = [2, 5, 6].includes(m) || m === 7 && r < 4;
  let operation: Operation, key: string, register = 0, displacement = 0, mode = 0, code = 0;
  if (major === 5 && Math.floor(opcode / 64) % 4 === 3) {
    if (m === 7 && r > 1) continue;
    operation = m === 1 ? "DBcc" : "Scc"; register = r; mode = m; code = r;
    key = m === 1 ? `DB${names[condition]}_d${r}` : `S${names[condition]}_${m === 0 ? `d${r}` : "memory"}`;
  } else if (major === 6) {
    operation = condition === 1 ? "BSR" : "Bcc"; displacement = opcode % 256;
    key = `${branchName(condition)}_${displacement ? "byte" : "word"}`;
  } else if (major === 4 && Math.floor(opcode / 64) % 8 === 7 && controlEA) {
    operation = "LEA"; register = Math.floor(opcode / 512) % 8; mode = m; code = r; key = `LEA_a${register}`;
  } else if ([0x121, 0x13a, 0x13b].includes(Math.floor(opcode / 64)) && controlEA) {
    operation = Math.floor(opcode / 64) === 0x121 ? "PEA" : Math.floor(opcode / 64) === 0x13a ? "JSR" : "JMP";
    mode = m; code = r; key = operation;
  } else if (Math.floor(opcode / 16) === 0x4e5) {
    operation = Math.floor(opcode / 8) % 2 ? "UNLK" : "LINK"; register = r; key = `${operation}_a${r}`;
  } else if (opcode === 0x4e75) { operation = "RTS"; key = "RTS"; }
  else continue;
  forms.push({ opcode, operation, condition, register, mode, code, displacement, key });
}
const representatives = [...new Map(forms.map(f => [f.key, f])).values()].map(f => ({ ...f,
  mode: f.operation === "Scc" && f.mode !== 0 ? 3 : f.mode, code: f.operation === "Scc" && f.mode !== 0 ? 7 : f.code,
}));

// Explicit captures match the native condition's read schedule; truth is checked separately below.
function condition(s: Cpu68000State, code: number): boolean {
  let result: boolean;
  switch (Math.floor(code / 2)) {
    case 0: result = true; break;
    case 1: { const { c, z } = s.flags; result = !(c || z); break; }
    case 2: result = !s.flags.c; break;
    case 3: result = !s.flags.z; break;
    case 4: result = !s.flags.v; break;
    case 5: result = !s.flags.n; break;
    case 6: { const { n, v } = s.flags; result = n === v; break; }
    default: { const { n, v, z } = s.flags; result = !z && n === v; }
  }
  return code % 2 ? !result : result;
}
const active = (s: Cpu68000State, code = 7): Stored => code === 7 ? s.flags.s ? "ssp" : "usp" : address[code]!;
function reference(s: Cpu68000State, f: Form, c: Context): Outcome {
  const fault = (operation: "read" | "write" | "fetch", address: number): Outcome =>
    address % 2 ? operation === "read" ? { operation, address, programSpace: false } : { operation, address } : undefined;
  const jump = (target: number) => { const error = fault("fetch", target); if (error) return error; c.jump(target); };
  const read = (address: number) => { let n = 0; for (let i = 0; i < 4; i++) n = n * 256 + c.readByte(wrap(address + i)); return n; };
  const write = (address: number, n: number) => { for (let i = 0; i < 4; i++) c.writeByte(wrap(address + i), Math.floor(n / 2 ** (24 - i * 8)) % 256); };
  const branchTarget = () => { const base = c.nextAddress(); return wrap(base + (f.displacement ? signed(f.displacement, 8) : signed(c.fetchWord(), 16))); };
  const call = (target: number): Outcome => {
    const returnAddress = c.nextAddress(), stack = active(s), address = wrap(s[stack] - 4), error = fault("write", address) || jump(target);
    if (error) return error;
    write(address, returnAddress); s[stack] = address;
  };
  switch (f.operation) {
    case "Scc": {
      const register = data[f.register]!, target = f.mode === 0 ? 0 : c.resolveAddress(8, f.mode, f.code);
      if (f.mode !== 0) c.commitAddressUpdates();
      if (f.mode === 0) void s[register]; else c.readByte(target);
      const result = condition(s, f.condition) ? 255 : 0;
      if (f.mode === 0) s[register] = Math.floor(s[register] / 256) * 256 + result; else c.writeByte(target, result);
      return;
    }
    case "DBcc": {
      const take = condition(s, f.condition), target = branchTarget();
      if (take) return;
      const register = data[f.register]!, result = (s[register] + 65535) % 65536;
      if (result !== 65535) { const error = jump(target); if (error) return error; }
      s[register] = Math.floor(s[register] / 65536) * 65536 + result; return;
    }
    case "Bcc": { const take = condition(s, f.condition), target = branchTarget(); if (take) return jump(target); return; }
    case "BSR": return call(branchTarget());
    case "LEA": { const register = active(s, f.register); s[register] = c.resolveAddress(32, f.mode, f.code); return; }
    case "PEA": {
      const target = c.resolveAddress(32, f.mode, f.code), stack = active(s), address = wrap(s[stack] - 4), error = fault("write", address);
      if (error) return error; write(address, target); s[stack] = address; return;
    }
    case "JMP": return jump(c.resolveAddress(32, f.mode, f.code));
    case "JSR": return call(c.resolveAddress(32, f.mode, f.code));
    case "LINK": {
      const displacement = signed(c.fetchWord(), 16), register = active(s, f.register), stack = active(s), address = wrap(s[stack] - 4), error = fault("write", address);
      if (error) return error;
      write(address, f.register === 7 ? address : s[register]); s[register] = address; s[stack] = wrap(address + displacement); return;
    }
    case "UNLK": {
      const register = active(s, f.register), stack = active(s), address = s[register], error = fault("read", address);
      if (error) return error;
      const contents = read(address); s[stack] = wrap(address + 4); s[register] = contents; return;
    }
    case "RTS": {
      const stack = active(s), address = s[stack], error = fault("read", address);
      if (error) return error;
      const target = read(address), targetError = jump(target);
      if (targetError) return targetError; s[stack] = wrap(address + 4);
    }
  }
}

interface Scenario { bits: number; cursor: number; extension: number; stack: number; frame: number; target: number; counter: number; mutate?: boolean }
const scenario: Scenario = { bits: 0, cursor: 0xfffffffe, extension: 0xfffe, stack: 2, frame: 0xfffffffe, target: 0xabcdef02, counter: 2 };
function observe(f: Form, scenario: Scenario, failAt: number, generated: boolean) {
  const state = initialState(scenario.bits), events: unknown[][] = [], writes: number[][] = [], pending = new Map<Stored, number>();
  for (const [i, name] of data.entries()) state[name] = 0x88000000 + i * 65536 + scenario.counter;
  for (const [i, name] of address.entries()) state[name] = wrap(scenario.frame + i * 32);
  state.usp = scenario.stack; state.ssp = wrap(scenario.stack + 256);
  let cursor = scenario.cursor, target: number | undefined, reads = 0, failed = false, outcome: Outcome;
  const failure = Error("injected control effect failure");
  const effect = (...event: unknown[]) => { events.push(event); if (events.length - 1 === failAt) throw failure; };
  const mutate = () => {
    if (!scenario.mutate) return;
    state.flags.s = !state.flags.s; state.flags.c = !state.flags.c; state.flags.z = !state.flags.z;
    state.d0 = 0x43210000; state.d7 = 0x9876ffff; state.usp = 0x12345678; state.ssp = 0x2345678a; state.a0 = 0x3456789c;
  };
  const observed = new Proxy(state, {
    get(object, key, receiver) {
      if (key === "flags") return new Proxy(object.flags, {
        get(object, key, receiver) { const contents = Reflect.get(object, key, receiver); effect("flag read", key, contents); return contents; },
        set(object, key, contents) { effect("flag write", key, contents); return Reflect.set(object, key, contents); },
      });
      const contents = Reflect.get(object, key, receiver); effect("register read", key, contents); return contents;
    },
    set(object, key, contents) { effect("register write", key, contents); return Reflect.set(object, key, contents); },
  });
  const context: Context = {
    nextAddress() { effect("cursor", cursor); mutate(); return cursor; },
    fetchWord() { effect("fetch word", cursor); cursor = wrap(cursor + 2); mutate(); return scenario.extension; },
    jump(address) { effect("target", address); target = address; mutate(); },
    resolveAddress(size, mode, code) {
      effect("resolve", size, mode, code);
      if (mode === 3 || mode === 4) pending.set(code === 7 ? state.flags.s ? "ssp" : "usp" : address[code]!, wrap(scenario.target + (mode === 3 ? code === 7 ? 2 : 1 : 0)));
      mutate(); return scenario.target;
    },
    commitAddressUpdates() { effect("commit"); for (const [register, value] of pending) observed[register] = value; mutate(); },
    readByte(address) { effect("read byte", address); mutate(); return f.operation === "Scc" ? 0xa5 : Math.floor(scenario.target / 2 ** (24 - reads++ * 8)) % 256; },
    readProgramByte() { throw Error("control addresses do not read target data"); },
    writeByte(address, value) { effect("write byte", address, value); writes.push([address, value]); mutate(); },
  };
  try { outcome = generated ? bodies[f.opcode]!(observed, f.mode, f.code, f.displacement, context) : reference(observed, f, context); }
  catch (error) { if (error !== failure) throw error; failed = true; }
  return { state, events, writes, cursor, target, failed, outcome: outcome! };
}

test("68000 control inventory covers exactly 5,349 operation words and 1,285 forms with 332 shared bodies", () => {
  assert.equal(forms.length, 5349); assert.equal(representatives.length, 332);
  assert.equal(forms.filter(f => f.operation !== "Bcc" && f.operation !== "BSR").length + 32, 1285);
  assert.deepEqual(Object.keys(bodies).map(Number), forms.map(f => f.opcode));
  assert.equal(Object.keys(control68000).length, representatives.length);
});

test("every control binding preserves native condition captures, displacement aliases, and both stack banks", () => {
  for (const f of forms) for (const bits of [0, 127]) assert.deepEqual(observe(f, { ...scenario, bits }, -1, true), observe(f, { ...scenario, bits }, -1, false), f.key);
});

test("control bodies preserve live values and exact partial effects on every failure and alignment path", () => {
  const variants = [scenario, { ...scenario, bits: 127 }, { ...scenario, target: 1 }, { ...scenario, stack: 1, target: 1 },
    { ...scenario, frame: 1 }, { ...scenario, counter: 0, extension: 1 }, { ...scenario, counter: 1, extension: 1 }];
  for (const f of representatives) for (const base of variants) for (const mutate of [false, true]) {
    const changed = { ...base, mutate }, expected = observe(f, changed, -1, false);
    assert.deepEqual(observe(f, changed, -1, true), expected, f.key);
    for (let i = 0; i < expected.events.length; i++) assert.deepEqual(observe(f, changed, i, true), observe(f, changed, i, false), `${f.key} at ${i}`);
  }
});

test("all sixteen condition truths preserve flags and select branch, decrement, and condition-byte behavior", () => {
  for (let bits = 0; bits < 128; bits++) {
    const state = initialState(bits), { n, z, v, c } = state.flags;
    const truths = [true, false, !c && !z, c || z, !c, c, !z, z, !v, v, !n, n, n === v, n !== v, !z && n === v, z || n !== v];
    for (let code = 0; code < 16; code++) {
      const byte = representatives.find(f => f.key === `S${names[code]}_d0`)!, decremented = representatives.find(f => f.key === `DB${names[code]}_d0`)!;
      const scc = observe(byte, { ...scenario, bits }, -1, true), db = observe(decremented, { ...scenario, bits }, -1, true);
      assert.equal(scc.state.d0 % 256, truths[code] ? 255 : 0); assert.deepEqual(scc.state.flags, state.flags);
      assert.equal(db.state.d0 % 65536, truths[code] ? 2 : 1); assert.equal(db.target, truths[code] ? undefined : 0xfffffffc); assert.deepEqual(db.state.flags, state.flags);
      if (code === 1) continue;
      const branch = representatives.find(f => f.key === `${branchName(code)}_word`)!, bcc = observe(branch, { ...scenario, bits }, -1, true);
      assert.equal(bcc.target, truths[code] ? 0xfffffffc : undefined); assert.deepEqual(bcc.state.flags, state.flags);
    }
  }
});

test("control displacements, target alignment, and DBcc counters retain unsigned long boundaries", () => {
  const selected = representatives.filter(f => ["Bcc", "BSR", "DBcc", "LINK"].includes(f.operation));
  for (const f of selected) for (const extension of [0, 1, 2, 0x7fff, 0x8000, 0xfffe, 0xffff]) for (const cursor of [0, 0x7ffffffe, 0x80000000, 0xfffffffe]) {
    const changed = { ...scenario, cursor, extension };
    assert.deepEqual(observe(f, changed, -1, true), observe(f, changed, -1, false), f.key);
  }
  for (const counter of [0, 1, 2, 0x7fff, 0x8000, 0xfffe, 0xffff]) for (const extension of [0, 1, 0xfffe, 0xffff]) {
    const f = representatives.find(f => f.key === "DBF_d0")!, changed = { ...scenario, counter, extension };
    assert.deepEqual(observe(f, changed, -1, true), observe(f, changed, -1, false));
  }
});

test("control explanations expose target selection separately from cursor, writes, and pointer commits", () => {
  const branch = describeInstruction(definition(0x6600)), call = describeInstruction(definition(0x4e90)), lea = describeInstruction(definition(0x4fd0));
  assert.ok(branch.indexOf("read Z") < branch.indexOf("read sequential fetch cursor"));
  assert.ok(branch.indexOf("read sequential fetch cursor") < branch.indexOf("fetch complete native-order word"));
  assert.ok(call.indexOf("write alignment fault") < call.indexOf("fetch alignment fault"));
  assert.ok(call.indexOf("select instruction target") < call.indexOf("write memory"));
  assert.ok(lea.indexOf("read S") < lea.indexOf("resolve 32-bit memory EA"));
  assert.doesNotMatch(lea, /read memory|alignment fault/);
});


test("cursor and target statements validate widths, scope, CPU context, and fetch-fault space", () => {
  const cpu = cpuSymbols("68000", cpu68000StateDescription), other = cpuSymbols("6502", cpu6502StateDescription);
  const base = { cpu: { ...cpu.declaration, wordBoundary: true as const }, name: "cursor probe", explanation: "Explicit control boundary.", steps: [] as readonly Statement[] };
  for (const steps of [[readNextAddress("cursor")], [selectTarget(literal(32, 0))], [alignmentFault("fetch", literal(32, 1))]]) {
    defineInstruction({ ...base, steps });
    assert.throws(() => defineInstruction({ ...base, cpu: other.declaration, steps }), /word/);
  }
  assert.throws(() => defineInstruction({ ...base, steps: [selectTarget(literal(16, 0))] }), /32-bit/);
  assert.throws(() => defineInstruction({ ...base, steps: [readNextAddress("cursor"), readNextAddress("cursor")] }), /duplicate/);
  assert.throws(() => defineInstruction({ ...base, steps: [when(flagLiteral(false), [readNextAddress("inner")]), selectTarget(value("inner"))] }), /inner/);
  assert.throws(() => defineInstruction({ ...base, steps: [alignmentFault("fetch", literal(32, 1), "data")] }), /access space/);
  assert.throws(() => defineInstruction({ ...base, steps: [alignmentFault("fetch", literal(16, 1))] }), /32-bit/);
  assert.throws(() => defineInstruction({ ...base, steps: [readSource("source", { name: "faulting source", type: 32,
    steps: [alignmentFault("fetch", literal(32, 1))], result: literal(32, 0) })] }), /sources and composed actions cannot reject/);
});

test("nested cursor and target effects infer narrow capabilities and propagate faults before retirement", async () => {
  const cpu = cpuSymbols("68000", cpu68000StateDescription);
  const definition = defineInstruction({ cpu: { ...cpu.declaration, wordBoundary: true as const }, name: "target probe", explanation: "Independent cursor and target.", inputs: { target: 32 },
    steps: [readNextAddress("before"), when(flagLiteral(true), [fetchWord("word"), readNextAddress("after"),
      when(lowBit(value("target")), [alignmentFault("fetch", value("target"))]), selectTarget(value("target")),
      writeRegister(cpu.register("d0"), value("before")), writeRegister(cpu.register("d1"), value("after"))]), writeRegister(cpu.register("d2"), literal(32, 123))] });
  const source = generateInstructions("68000", { probe: definition });
  assert.match(source, /"nextAddress" \| "fetchWord" \| "jump"/);
  assert.match(source, /void \| TargetAlignmentFault/); assert.doesNotMatch(source, /OperandAlignmentFault/);
  const compiled: { instructions: { probe(state: Cpu68000State, target: number, context: WordControlContext & Pick<WordInstructionContext, "fetchWord">): TargetAlignmentFault | void } } =
    await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source))}`);
  for (const address of [0, 1, 2, 0x7ffffffe, 0x80000000, 0xfffffffe, 0xffffffff]) for (const failAt of [-1, 0, 1, 2, 3]) {
    const state = initialState(), before = structuredClone(state), events: unknown[][] = [], failure = Error("failed control capability");
    let cursor = 0xfffffffe, selected: number | undefined, threw = false, outcome: TargetAlignmentFault | "unsupported" | void;
    const effect = (...event: unknown[]) => { events.push(event); if (events.length - 1 === failAt) throw failure; };
    try { outcome = compiled.instructions.probe(state, address, {
      nextAddress() { effect("cursor", cursor); return cursor; },
      fetchWord() { effect("word"); cursor = 0; return 0x4e71; },
      jump(target) { effect("target", target); selected = target; },
    }); } catch (error) { if (error !== failure) throw error; threw = true; }
    assert.equal(threw, failAt >= 0 && (failAt < 3 || address % 2 === 0));
    assert.equal(cursor, failAt === 0 || failAt === 1 ? 0xfffffffe : 0);
    if (threw || address % 2) {
      assert.deepEqual(state, before); assert.equal(selected, undefined);
      assert.deepEqual(outcome!, threw ? undefined : { operation: "fetch", address });
    } else {
      assert.equal(outcome!, undefined); assert.equal(selected, address);
      assert.deepEqual(state, { ...before, d0: 0xfffffffe, d1: 0, d2: 123 });
    }
  }
});
