import assert from "node:assert/strict";
import { test } from "node:test";
import { initialState } from "../../../helpers/68000-state.js";
import { instructions } from "../../../../src/components/cpus/generated/68000-arithmetic.js";
import { arithmeticForms68000 } from "../../../../src/components/cpus/68000-arithmetic.js";
import { arithmetic68000 } from "../../../../src/components/cpus/semantics/definitions.js";
import type { Cpu68000AddressContext, OperandAlignmentFault } from "../../../../src/components/cpus/68000-context.js";
import type { WordInstructionContext } from "../../../../src/components/cpus/instruction-context.js";
import type { Cpu68000State } from "../../../../src/components/cpus/state/68000.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";

type Context = Cpu68000AddressContext & Pick<WordInstructionContext, "fetchWord" | "readByte" | "writeByte">;
type Body = (state: Cpu68000State, sm: number, sc: number, dm: number, dc: number, context: Context) => OperandAlignmentFault | void;
const bodies: Readonly<Record<string, Body>> = instructions;
const data = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"] as const;
const address = ["a0", "a1", "a2", "a3", "a4", "a5", "a6"] as const;
type Stored = typeof data[number] | typeof address[number] | "usp" | "ssp";
type Operation = "ADD" | "SUB" | "CMP" | "ADDX" | "SUBX" | "NEG" | "NEGX";
interface Form { opcode: number; op: Operation; size: 8 | 16 | 32; sm: number; sc: number; dm: number; dc: number; quick: boolean; key: string }
const unary = (f: Form) => f.op === "NEG" || f.op === "NEGX";
const extended = (f: Form) => f.op === "ADDX" || f.op === "SUBX" || f.op === "NEGX";
const sourceMemory = (f: Form) => !unary(f) && !f.quick && f.sm >= 2 && !(f.sm === 7 && f.sc === 4);
const wrap = (n: number) => ((n % 4294967296) + 4294967296) % 4294967296;
const stored = (s: Cpu68000State, mode: number, code: number): Stored => mode === 0 ? data[code]! : code === 7 ? s.flags.s ? "ssp" : "usp" : address[code]!;

// An independent scan of all operation words; literal qqq values collapse only in the coverage count.
const forms: Form[] = [];
for (let opcode = 0; opcode < 65536; opcode++) {
  const major = Math.floor(opcode / 4096), high = Math.floor(opcode / 256), om = Math.floor(opcode / 64) % 8;
  const m = Math.floor(opcode / 8) % 8, r = opcode % 8, d = Math.floor(opcode / 512) % 8;
  let op: Operation, size: 8 | 16 | 32, sm: number, sc: number, dm: number, dc: number;
  const quick = major === 5;
  if (major === 9 || major === 11 || major === 13) {
    op = major === 9 ? "SUB" : major === 11 ? "CMP" : "ADD";
    if (om === 3 || om === 7) {
      if (m === 7 && r > 4) continue;
      size = om === 3 ? 16 : 32; sm = m; sc = r; dm = 1; dc = d;
    } else {
      size = ([8, 16, 32] as const)[om % 4]!;
      if (om < 3) {
        if ((m === 1 && size === 8) || (m === 7 && r > 4)) continue;
        sm = m; sc = r; dm = 0; dc = d;
      } else if (major === 11) {
        if (m !== 1) continue; // EOR owns all other d=1 data forms.
        sm = dm = 3; sc = r; dc = d;
      } else if (m < 2) {
        op = major === 9 ? "SUBX" : "ADDX"; sm = dm = m === 0 ? 0 : 4; sc = r; dc = d;
      } else {
        if (m === 7 && r > 1) continue;
        sm = 0; sc = d; dm = m; dc = r;
      }
    }
  } else if (quick || [4, 6, 12, 0x40, 0x44].includes(high)) {
    if (om % 4 === 3 || (m === 7 && r > 1)) continue;
    size = ([8, 16, 32] as const)[om % 4]!;
    if (m === 1 && (!quick || size === 8)) continue;
    if (quick) { op = high % 2 ? "SUB" : "ADD"; sm = 0; sc = d; }
    else {
      op = high === 4 ? "SUB" : high === 6 ? "ADD" : high === 12 ? "CMP" : high === 0x40 ? "NEGX" : "NEG";
      sm = high < 16 ? 7 : 0; sc = high < 16 ? 4 : 0;
    }
    dm = m; dc = r;
  } else continue;
  const source = op === "NEG" || op === "NEGX" ? "none" : quick ? "quick" : sm === 0 ? `d${sc}` : sm === 1 ? `a${sc}`
    : sm === 7 && sc === 4 ? "immediate" : sm === 7 && sc >= 2 ? "program" : "memory";
  const destination = dm === 0 ? `d${dc}` : dm === 1 ? `a${dc}` : "memory";
  forms.push({ opcode, op, size, sm, sc, dm, dc, quick, key: `${op}_${size}_${source}_${destination}` });
}
const representatives = [...new Map(forms.map(f => [f.key, f])).values()].map(f => ({ ...f,
  sm: sourceMemory(f) && f.sm !== 7 ? f.sm === 4 ? 4 : 3 : f.sm, sc: sourceMemory(f) && f.sm !== 7 ? 7 : f.sc,
  dm: f.dm >= 2 ? f.dm === 4 ? 4 : 3 : f.dm, dc: f.dm >= 2 ? 7 : f.dc,
}));

// Signed and unsigned mathematical totals independently determine result, overflow, and carry/borrow.
function calculate(f: Form, left: number, right: number, x: boolean) {
  const width = f.dm === 1 ? 32 : f.size, limit = 2n ** BigInt(width), half = limit / 2n;
  const a = BigInt(unary(f) ? 0 : left), b = BigInt(unary(f) ? left : right), incoming = extended(f) && x ? 1n : 0n;
  const sign = f.op === "ADD" || f.op === "ADDX" ? 1n : -1n;
  const total = a + sign * (b + incoming), signedTotal = (a >= half ? a - limit : a) + sign * ((b >= half ? b - limit : b) + incoming);
  const result = Number((total % limit + limit) % limit);
  return { result, n: result >= Number(half), z: result === 0, v: signedTotal < -half || signedTotal >= half, c: total < 0n || total >= limit };
}

function reference(s: Cpu68000State, f: Form, c: Context): OperandAlignmentFault | void {
  const read = (a: number, program: boolean) => {
    let value = 0;
    for (let i = 0; i < f.size / 8; i++) value = value * 256 + (program ? c.readProgramByte(wrap(a + i)) : c.readByte(wrap(a + i)));
    return value;
  };
  let right = 0;
  if (f.quick) right = f.sc || 8;
  else if (!unary(f)) {
    if (f.sm < 2) right = s[stored(s, f.sm, f.sc)] % 2 ** f.size;
    else if (f.sm === 7 && f.sc === 4) { right = c.fetchWord(); right = f.size === 32 ? right * 65536 + c.fetchWord() : right % 2 ** f.size; }
    else {
      const a = c.resolveAddress(f.size, f.sm, f.sc), program = f.sm === 7 && (f.sc === 2 || f.sc === 3);
      if (f.size > 8 && a % 2) return { operation: "read", address: a, programSpace: program };
      right = read(a, program);
    }
    if (f.dm === 1 && f.size === 16 && right >= 32768) right += 4294901760;
  }
  const destination = f.dm < 2 ? stored(s, f.dm, f.dc) : c.resolveAddress(f.size, f.dm, f.dc);
  if (typeof destination === "number" && f.size > 8 && destination % 2) return { operation: "read", address: destination, programSpace: false };
  if (sourceMemory(f) || f.dm >= 2) c.commitAddressUpdates();
  const width = f.dm === 1 ? 32 : f.size;
  const left = typeof destination === "number" ? read(destination, false) : s[destination] % 2 ** width;
  const oldZero = extended(f) ? s.flags.z : false, x = extended(f) ? s.flags.x : false;
  const facts = calculate(f, left, right, x);
  if (f.dm !== 1 || f.op === "CMP") {
    s.flags.n = facts.n; s.flags.z = facts.z; s.flags.v = facts.v; s.flags.c = facts.c;
    if (f.op !== "CMP") s.flags.x = facts.c;
    if (extended(f)) s.flags.z = oldZero && facts.z;
  }
  if (f.op === "CMP") return;
  if (typeof destination === "number") for (let i = 0; i < f.size / 8; i++) c.writeByte(wrap(destination + i), Math.floor(facts.result / 2 ** (f.size - 8 - i * 8)) % 256);
  else s[destination] = width === 32 ? facts.result : Math.floor(s[destination] / 2 ** width) * 2 ** width + facts.result;
}

interface Scenario { bits: number; source: number; destination: number; left: number; right: number; mutate?: boolean }
function observe(f: Form, scenario: Scenario, failAt: number, generated: boolean) {
  const state = initialState(scenario.bits), events: unknown[][] = [], memory = new Map<number, number>(), pending = new Map<Stored, number>();
  const failure = Error("injected arithmetic effect failure");
  let failed = false, outcome: OperandAlignmentFault | void, fetches = 0, resolutions = 0;
  if (f.dm < 2) state[stored(state, f.dm, f.dc)] = scenario.left;
  if (!unary(f) && !f.quick && f.sm < 2) state[stored(state, f.sm, f.sc)] = scenario.right;
  const load = (a: number, value: number) => {
    for (let i = 0; i < f.size / 8; i++) memory.set(wrap(a + i), Math.floor(value / 2 ** (f.size - 8 - i * 8)) % 256);
  };
  load(scenario.source, scenario.right); load(scenario.destination, scenario.left);
  const effect = (...event: unknown[]) => { events.push(event); if (events.length - 1 === failAt) throw failure; };
  const mutate = () => {
    if (!scenario.mutate) return;
    state.d0 = 0x87654321; state.d7 = 0x89abcdef; state.usp = 0xabc00000; state.ssp = 0xdef00000;
    state.flags.s = !state.flags.s; state.flags.x = !state.flags.x; state.flags.z = !state.flags.z;
  };
  const observed = new Proxy(state, {
    get(target, key, receiver) {
      if (key === "flags") return new Proxy(target.flags, {
        get(target, key, receiver) { const v = Reflect.get(target, key, receiver); effect("flag read", key, v); return v; },
        set(target, key, v) { effect("flag write", key, v); return Reflect.set(target, key, v); },
      });
      const v = Reflect.get(target, key, receiver); effect("read", key, v); return v;
    },
    set(target, key, v) { effect("write", key, v); return Reflect.set(target, key, v); },
  });
  const read = (space: string, a: number) => { effect("memory read", space, a); mutate(); return memory.get(a) ?? 0x81; };
  const context: Context = {
    resolveAddress(size, mode, code) {
      effect("resolve", size, mode, code);
      const a = resolutions++ === 0 && sourceMemory(f) ? scenario.source : scenario.destination;
      if (mode === 3 || mode === 4) pending.set(stored(state, 1, code), wrap(a + (mode === 3 ? code === 7 && size === 8 ? 2 : size / 8 : 0)));
      mutate(); return a;
    },
    commitAddressUpdates() { effect("commit"); for (const [field, v] of pending) observed[field] = v; mutate(); },
    fetchWord() { effect("fetch word"); mutate(); return f.size === 8 ? 0xa500 + scenario.right % 256
      : f.size === 16 ? scenario.right % 65536 : fetches++ === 0 ? Math.floor(scenario.right / 65536) : scenario.right % 65536; },
    readByte: a => read("data", a), readProgramByte: a => read("program", a),
    writeByte(a, byte) { effect("memory write", a, byte); mutate(); memory.set(a, byte); },
  };
  try { outcome = generated ? bodies[f.key]!(observed, f.sm, f.sc, f.dm, f.dc, context) : reference(observed, f, context); }
  catch (error) { if (error !== failure) throw error; failed = true; }
  return { state, events, memory: [...memory], failed, outcome: outcome! };
}
const scenario: Scenario = { bits: 127, source: 0xfffffffe, destination: 0x12345678, left: 0x7fffffff, right: 0xffffffff };

test("68000 arithmetic covers 11,186 forms, 13,510 operation words, and 2,678 shared bodies", () => {
  assert.equal(forms.length, 13510); assert.equal(representatives.length, 2678);
  assert.equal(new Set(forms.map(f => f.quick ? f.opcode - f.sc * 512 : f.opcode)).size, 11186);
  assert.equal(arithmeticForms68000.length, forms.length);
  assert.equal(new Set(arithmeticForms68000.map(f => f.opcode)).size, forms.length);
  const expected = new Map(forms.map(f => [f.opcode, f]));
  for (const f of arithmeticForms68000) assert.deepEqual({ opcode: f.opcode, op: f.operation, size: f.size, sm: f.sourceMode, sc: f.sourceCode,
    dm: f.destinationMode, dc: f.destinationCode, quick: f.source?.kind === "quick", key: f.body }, expected.get(f.opcode));
  const keys = representatives.map(f => f.key).sort();
  assert.deepEqual(Object.keys(arithmetic68000).sort(), keys); assert.deepEqual(Object.keys(bodies).sort(), keys);
});

test("every arithmetic binding retains operands, active stack bank, access space, and quick amount", () => {
  for (const f of forms) for (const bits of [0, 127]) assert.deepEqual(observe(f, { ...scenario, bits }, -1, true), observe(f, { ...scenario, bits }, -1, false), f.key);
});

test("arithmetic bodies preserve effect order and completed state at every failure, including live X/Z and A7 changes", () => {
  for (const f of representatives) for (const bits of [0, 127]) {
    const changed = { ...scenario, bits, mutate: true }, expected = observe(f, changed, -1, false);
    assert.deepEqual(observe(f, changed, -1, true), expected, f.key);
    for (let at = 0; at < expected.events.length; at++) assert.deepEqual(observe(f, changed, at, true), observe(f, changed, at, false), `${f.key} at ${at}`);
  }
});

test("arithmetic faults reject source or destination before committing pending registers", () => {
  for (const f of representatives) for (const source of [0xffffffff, 0xfffffffe]) for (const destination of [0x12345679, 0x12345678]) {
    const odd = { ...scenario, source, destination }, actual = observe(f, odd, -1, true);
    assert.deepEqual(actual, observe(f, odd, -1, false), f.key);
    if (actual.outcome) assert.ok(actual.events.every(e => !["commit", "memory write", "flag write"].includes(String(e[0]))));
  }
});

test("arithmetic signed overflow, carry/borrow, X and cumulative Z cover every result bit and incoming flags", () => {
  const cases = [...new Map(forms.filter(f => f.dm === 0 && f.dc === 0 && (unary(f) || f.sm === 0 && f.sc === 1)).map(f => [`${f.op}_${f.size}`, f])).values()];
  for (const f of cases) for (let bits = 0; bits < 128; bits++) for (let bit = 0; bit < f.size; bit++) {
    const limit = 2 ** f.size;
    for (const [left, right] of [[0, 0], [2 ** bit - 1, 1], [2 ** bit, 1], [limit - 1, 1], [limit / 2, limit / 2], [limit / 2 - 1, 1]]) {
      const edge = { ...scenario, bits, left: left!, right: right! };
      assert.deepEqual(observe(f, edge, -1, true), observe(f, edge, -1, false), `${f.key} bit ${bit}`);
    }
  }
});

test("address arithmetic sign-extends word sources, keeps quick constants positive, and reads an updated aliased destination", () => {
  const cases = representatives.filter(f => f.dm === 1);
  for (const f of cases) for (const right of [0, 1, 0x7fff, 0x8000, 0xffff, 0x80000000, 0xffffffff]) {
    const edge = { ...scenario, right, left: 0xffffffff, source: 0xfffffffe };
    assert.deepEqual(observe(f, edge, -1, true), observe(f, edge, -1, false), f.key);
  }
});

test("arithmetic explanations retain paired access order, flags before writeback, and comparison without writes", () => {
  const addx = describeInstruction(arithmetic68000.ADDX_32_memory_memory!);
  assert.ok(addx.indexOf("sourceByte3:u8 := read memory") < addx.indexOf("destinationAddress:u32 := resolve"));
  assert.ok(addx.indexOf("commit staged") < addx.indexOf("destinationByte0:u8 := read memory"));
  assert.ok(addx.indexOf("destinationByte3:u8 := read memory") < addx.indexOf("previousZero:flag := read Z"));
  assert.match(addx, /68000 cumulative zero/);
  assert.ok(addx.indexOf('flags "68000 cumulative zero"') < addx.indexOf("write memory"));
  const compare = describeInstruction(arithmetic68000.CMP_16_memory_memory!);
  assert.doesNotMatch(compare, /write memory|read X|read Z/);
});
