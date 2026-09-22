import assert from "node:assert/strict";
import { test } from "node:test";
import { initialState } from "../../../helpers/68000-state.js";
import { instructions, opcodeInstructions } from "../../../../src/components/cpus/generated/68000-bits.js";
import { bits68000 } from "../../../../src/components/cpus/semantics/definitions/68000.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import type { Cpu68000AddressContext, OperandAlignmentFault } from "../../../../src/components/cpus/68000-context.js";
import type { WordInstructionContext } from "../../../../src/components/cpus/instruction-context.js";
import type { Cpu68000State } from "../../../../src/components/cpus/state/68000.js";

type Context = Cpu68000AddressContext & Pick<WordInstructionContext, "fetchWord" | "readByte" | "writeByte">;
type Body = (state: Cpu68000State, mode: number, code: number, upperCode: number, context: Context) => OperandAlignmentFault | "unsupported" | void;
const bodies: Readonly<Record<number, Body>> = opcodeInstructions;
const data = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"] as const;
const address = ["a0", "a1", "a2", "a3", "a4", "a5", "a6"] as const;
type Operation = "BTST" | "BCHG" | "BCLR" | "BSET" | "ASL" | "ASR" | "LSL" | "LSR" | "ROL" | "ROR" | "ROXL" | "ROXR" | "TAS";
interface Form { opcode: number; operation: Operation; size: 8 | 16 | 32; source: string; sm: number; sc: number; dm: number; dc: number; key: string }
const bitOperation = (f: Form) => f.operation.startsWith("B");
const immediate = (f: Form) => f.dm === 7 && f.dc === 4;
const memory = (f: Form) => f.dm >= 2 && !immediate(f);
const program = (f: Form) => f.dm === 7 && (f.dc === 2 || f.dc === 3);
const wrap = (n: number) => ((n % 4294967296) + 4294967296) % 4294967296;

// Scan all words independently of the production selectors, patterns, and EA classification.
const forms: Form[] = [];
for (let opcode = 0; opcode < 65536; opcode++) {
  const high = Math.floor(opcode / 256), major = Math.floor(high / 16), ss = Math.floor(opcode / 64) % 4;
  const m = Math.floor(opcode / 8) % 8, r = opcode % 8, c = Math.floor(opcode / 512) % 8;
  let operation: Operation, size: 8 | 16 | 32, source: string, sm = 0, sc = 0, dm = m, dc = r;
  if (major === 0 && (high % 2 || high === 8)) {
    const dynamic = high % 2 !== 0;
    if (m === 1 || m === 7 && r > (ss === 0 ? dynamic ? 4 : 3 : 1)) continue;
    operation = (["BTST", "BCHG", "BCLR", "BSET"] as const)[ss]!; size = m === 0 ? 32 : 8;
    source = dynamic ? `d${c}` : "immediate"; sm = dynamic ? 0 : 7; sc = dynamic ? c : 4;
  } else if (major === 14) {
    const left = high % 2 !== 0;
    if (ss === 3) {
      if (high >= 0xe8 || m < 2 || m === 7 && r > 1) continue;
      operation = (["ASR", "ASL", "LSR", "LSL", "ROXR", "ROXL", "ROR", "ROL"] as const)[high % 8]!;
      size = 16; source = "one";
    } else {
      operation = (["AS", "LS", "ROX", "RO"] as const)[Math.floor(opcode / 8) % 4]! + (left ? "L" : "R") as Operation;
      size = ([8, 16, 32] as const)[ss]!; source = Math.floor(opcode / 32) % 2 ? `d${c}` : "quick"; sc = c; dm = 0;
    }
  } else if (high === 0x4a && ss === 3) {
    if (m === 1 || m === 7 && r > 1) continue;
    operation = "TAS"; size = 8; source = "none";
  } else continue;
  const target = dm === 0 ? `d${dc}` : dm === 7 && dc === 4 ? "immediate" : dm === 7 && dc >= 2 ? "program" : "memory";
  forms.push({ opcode, operation, size, source, sm, sc, dm, dc, key: `${operation}_${size}_${source}_${target}` });
}
const representatives = [...new Map(forms.map(f => [f.key, f])).values()].map(f => memory(f) && !program(f) ? { ...f, dm: 3, dc: 7 } : f);

// A bit-array oracle moves actual bits, independently of the generated numeric shifts and masks.
function shifted(f: Form, original: number, count: number, initialX: boolean) {
  const bits = Array.from({ length: f.size }, (_, i) => Math.floor(original / 2 ** i) % 2 !== 0);
  const left = f.operation.endsWith("L"), rox = f.operation.startsWith("ROX"), rotate = f.operation.startsWith("RO");
  let x = initialX, c = rox && x, v = false;
  for (let i = 0; i < count; i++) {
    const sign = bits.at(-1)!, outgoing = left ? bits.pop()! : bits.shift()!;
    const incoming = rox ? x : rotate ? outgoing : f.operation === "ASR" && sign;
    if (left) bits.unshift(incoming); else bits.push(incoming);
    if (f.operation === "ASL" && sign !== bits.at(-1)) v = true;
    c = outgoing; if (!rotate || rox) x = c;
  }
  const result = bits.reduce((n, bit, i) => n + (bit ? 2 ** i : 0), 0);
  return { result, n: bits.at(-1)!, z: result === 0, v, c, x };
}
function tested(f: Form, original: number, bit: number) {
  const mask = 2 ** (bit % f.size), set = Math.floor(original / mask) % 2 !== 0;
  return { z: !set, result: f.operation === "BCHG" ? original + (set ? -mask : mask)
    : f.operation === "BCLR" ? original - (set ? mask : 0) : original + (set ? 0 : mask) };
}

function reference(s: Cpu68000State, f: Form, context: Context): OperandAlignmentFault | void {
  const source = f.source.startsWith("d") ? s[data[f.sc]!] : f.source === "immediate" ? context.fetchWord() : f.source === "quick" ? f.sc || 8 : 1;
  let a = 0;
  if (memory(f)) {
    a = context.resolveAddress(f.size, f.dm, f.dc);
    if (f.size > 8 && a % 2) return { operation: "read", address: a, programSpace: program(f) };
    context.commitAddressUpdates();
  }
  let original = 0;
  if (f.dm === 0) original = s[data[f.dc]!] % 2 ** f.size;
  else if (immediate(f)) original = context.fetchWord() % 256;
  else for (let i = 0; i < f.size / 8; i++) original = original * 256 + (program(f) ? context.readProgramByte(wrap(a + i)) : context.readByte(wrap(a + i)));
  let result: number;
  if (bitOperation(f)) {
    const facts = tested(f, original, source); s.flags.z = facts.z; result = facts.result;
    if (f.operation === "BTST") return;
  } else if (f.operation === "TAS") {
    s.flags.n = original >= 128; s.flags.z = original === 0; s.flags.v = false; s.flags.c = false;
    result = original >= 128 ? original : original + 128;
  } else {
    const facts = shifted(f, original, f.source.startsWith("d") ? source % 64 : source, s.flags.x);
    s.flags.n = facts.n; s.flags.z = facts.z; s.flags.v = facts.v; s.flags.c = facts.c; s.flags.x = facts.x;
    result = facts.result;
  }
  if (f.dm === 0) s[data[f.dc]!] = f.size === 32 ? result : Math.floor(s[data[f.dc]!] / 2 ** f.size) * 2 ** f.size + result;
  else for (let i = 0; i < f.size / 8; i++) context.writeByte(wrap(a + i), Math.floor(result / 2 ** (f.size - 8 - i * 8)) % 256);
}

interface Scenario { bits: number; address: number; original: number; source: number; mutate?: boolean }
function observe(f: Form, scenario: Scenario, failAt: number, generated: boolean) {
  const state = initialState(scenario.bits), events: unknown[][] = [], writes: number[][] = [], pending = new Map<string, number>();
  const failure = Error("injected bit operation failure");
  let failed = false, outcome: OperandAlignmentFault | "unsupported" | void;
  if (f.dm === 0) state[data[f.dc]!] = scenario.original;
  if (f.source.startsWith("d")) state[data[f.sc]!] = scenario.source;
  const effect = (...event: unknown[]) => { events.push(event); if (events.length - 1 === failAt) throw failure; };
  const mutate = () => {
    if (!scenario.mutate) return;
    state.d0 = 0x87654321; state.d7 = 0x89abcdef; state.flags.x = !state.flags.x; state.flags.s = !state.flags.s;
  };
  const observed = new Proxy(state, {
    get(target, key, receiver) {
      if (key === "flags") return new Proxy(target.flags, {
        get(target, key, receiver) { const v = Reflect.get(target, key, receiver); effect("flag read", key, v); return v; },
        set(target, key, v) { effect("flag write", key, v); mutate(); return Reflect.set(target, key, v); },
      });
      const v = Reflect.get(target, key, receiver); effect("register read", key, v); return v;
    },
    set(target, key, v) { effect("register write", key, v); return Reflect.set(target, key, v); },
  });
  const read = (space: string, a: number) => {
    effect("memory read", space, a); mutate();
    return Math.floor(scenario.original / 2 ** (f.size - 8 - wrap(a - scenario.address) * 8)) % 256;
  };
  const context: Context = {
    resolveAddress(size, mode, code) {
      effect("resolve", size, mode, code);
      if (mode === 3 || mode === 4) pending.set(code === 7 ? state.flags.s ? "ssp" : "usp" : address[code]!,
        wrap(scenario.address + (mode === 3 ? code === 7 && size === 8 ? 2 : size / 8 : 0)));
      mutate(); return scenario.address;
    },
    commitAddressUpdates() { effect("commit"); for (const [field, v] of pending) Reflect.set(observed, field, v); mutate(); },
    fetchWord() { effect("fetch word"); mutate(); return immediate(f) ? scenario.original % 65536 : scenario.source % 65536; },
    readByte: a => read("data", a), readProgramByte: a => read("program", a),
    writeByte(a, byte) { effect("memory write", a, byte); mutate(); writes.push([a, byte]); },
  };
  try { outcome = generated ? bodies[f.opcode]!(observed, f.dm, f.dc, f.sc, context) : reference(observed, f, context); }
  catch (error) { if (error !== failure) throw error; failed = true; }
  return { state, events, writes, failed, outcome: outcome! };
}
const scenario: Scenario = { bits: 127, address: 0xfffffffe, original: 0x87654321, source: 0xfedcba98 };

test("68000 bit operations, shifts, and TAS cover 3,940 forms, 5,284 words, and 2,086 shared bodies", () => {
  assert.equal(forms.length, 5284); assert.equal(representatives.length, 2086);
  assert.equal(new Set(forms.map(f => f.source === "quick" ? f.opcode - f.sc * 512 : f.opcode)).size, 3940);
  assert.deepEqual(Object.keys(bodies).map(Number), forms.map(f => f.opcode));
  assert.equal(new Set(Object.values(bodies)).size, 2086);
  assert.equal(Object.keys(bits68000).length, 2086);
  assert.deepEqual(Object.keys(instructions).sort(), Object.keys(bits68000).sort());
});

test("every bit/shift binding preserves selectors, register aliases, operand space, and incoming flags", () => {
  for (const f of forms) for (const bits of [0, 127]) assert.deepEqual(observe(f, { ...scenario, bits }, -1, true), observe(f, { ...scenario, bits }, -1, false), f.key);
});

test("bit/shift bodies preserve access order and completed state at every effect failure", () => {
  for (const f of representatives) for (const bits of [0, 127]) {
    const changed = { ...scenario, bits, mutate: true }, expected = observe(f, changed, -1, false);
    assert.deepEqual(observe(f, changed, -1, true), expected, f.key);
    for (let i = 0; i < expected.events.length; i++) assert.deepEqual(observe(f, changed, i, true), observe(f, changed, i, false), `${f.key} at ${i}`);
  }
});

test("memory shifts reject odd addresses before commits, reads, flags, or writes; byte operands permit them", () => {
  for (const f of representatives.filter(memory)) {
    const odd = { ...scenario, address: 0xffffffff }, actual = observe(f, odd, -1, true);
    assert.deepEqual(actual, observe(f, odd, -1, false), f.key);
    if (f.size === 16) assert.deepEqual(actual.events, [["resolve", 16, f.dm, f.dc]]);
    else assert.equal(actual.outcome, undefined);
  }
});

test("shifts cover every count, width, sign boundary, incoming flag combination, and cumulative ASL overflow", () => {
  const cases = forms.filter(f => f.source === "d1" && f.dm === 0 && f.dc === 0 && !bitOperation(f));
  for (const f of cases) {
    const values = [...new Set([0, 2 ** f.size - 1, ...Array.from({ length: f.size }, (_, bit) => [2 ** bit, 2 ** bit - 1]).flat()])];
    for (let count = 0; count < 64; count++) for (const x of [false, true]) for (const original of values) {
      const state = initialState(); state.d0 = 0xabcdef00 - 0xabcdef00 % 2 ** f.size + original; state.d1 = 0x12340000 + count; state.flags.x = x;
      const before = structuredClone(state), facts = shifted(f, original, count, x);
      bodies[f.opcode]!(state, 0, 0, 1, {} as Context);
      assert.deepEqual(state, { ...before, d0: before.d0 - original + facts.result, flags: { ...before.flags,
        n: facts.n, z: facts.z, v: facts.v, c: facts.c, x: facts.x } }, `${f.key} count ${count} input ${original}`);
    }
    for (let bits = 0; bits < 128; bits++) for (const count of [0, 1, 63]) {
      const edge = { ...scenario, bits, original: 2 ** (f.size - 1), source: count };
      assert.deepEqual(observe(f, edge, -1, true), observe(f, edge, -1, false), f.key);
    }
  }
});

test("bit operations reduce full register and immediate bit numbers modulo operand width and change only the tested bit", () => {
  const cases = representatives.filter(f => bitOperation(f) && (f.source === "d1" || f.source === "immediate") && (f.dm === 0 && f.dc === 0 || memory(f)));
  for (const f of cases) for (let bit = 0; bit < 256; bit++) for (const original of [0, 2 ** (bit % f.size), 2 ** f.size - 1]) {
    const edge = { ...scenario, original, source: (f.source === "immediate" ? 0xab00 : 0xabcdef00) + bit };
    assert.deepEqual(observe(f, edge, -1, true), observe(f, edge, -1, false), f.key);
  }
  const tas = representatives.find(f => f.operation === "TAS" && f.dm === 0 && f.dc === 0)!;
  for (let original = 0; original < 256; original++) for (let bits = 0; bits < 128; bits++) {
    const edge = { ...scenario, bits, original: 0x12345600 + original };
    assert.deepEqual(observe(tas, edge, -1, true), observe(tas, edge, -1, false));
  }
});

test("bit/shift explanations show captured counts, local flag iteration, tested bytes, and flags before writes", () => {
  const shift = describeInstruction(bits68000["ASL.W MEMORY"]!);
  assert.ok(shift.indexOf("commit staged") < shift.indexOf("byte0:u8 := read memory"));
  assert.ok(shift.indexOf("byte1:u8 := read memory") < shift.indexOf("initialExtend:flag := read X"));
  assert.match(shift, /next overflowBit := or/);
  assert.ok(shift.indexOf("Update all values together") < shift.indexOf('flags "68000 shift result"'));
  assert.ok(shift.indexOf('flags "68000 shift result"') < shift.indexOf("write memory"));
  assert.match(describeInstruction(bits68000["BTST.B D0,PROGRAM"]!), /read program memory/);
  assert.doesNotMatch(describeInstruction(bits68000["BTST.B D0,IMMEDIATE"]!), /write memory|read memory/);
});
