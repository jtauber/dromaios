import assert from "node:assert/strict";
import { test } from "node:test";
import { initialState } from "../../../helpers/68000-state.js";
import { instructions as words } from "../../../../src/components/cpus/generated/68000-word-arithmetic.js";
import { instructions as decimals } from "../../../../src/components/cpus/generated/68000-decimal.js";
import { wordArithmeticForms68000, decimalForms68000 } from "../../../../src/components/cpus/68000-arithmetic.js";
import { wordArithmetic68000, decimal68000 } from "../../../../src/components/cpus/semantics/definitions.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import type { Cpu68000AddressContext, OperandAlignmentFault } from "../../../../src/components/cpus/68000-context.js";
import type { WordInstructionContext } from "../../../../src/components/cpus/instruction-context.js";
import type { Cpu68000State } from "../../../../src/components/cpus/state/68000.js";

type Context = Cpu68000AddressContext & Pick<WordInstructionContext, "fetchWord" | "readByte" | "writeByte">;
type Outcome = OperandAlignmentFault | "divide-by-zero" | "bounds-check" | void;
type Body = (state: Cpu68000State, sm: number, sc: number, dm: number, dc: number, context: Context) => Outcome;
const bodies: Readonly<Record<string, Body>> = { ...words, ...decimals };
const data = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"] as const;
const address = ["a0", "a1", "a2", "a3", "a4", "a5", "a6"] as const;
type Operation = "MULU" | "MULS" | "DIVU" | "DIVS" | "CHK" | "ABCD" | "SBCD" | "NBCD";
interface Form { opcode: number; operation: Operation; size: 8 | 16; sm: number; sc: number; dm: number; dc: number; key: string }
const sourceMemory = (f: Form) => f.operation !== "NBCD" && f.sm >= 2 && !(f.sm === 7 && f.sc === 4);
const wrap = (n: number) => ((n % 4294967296) + 4294967296) % 4294967296;
const signedWord = (n: number) => n % 65536 < 32768 ? n % 65536 : n % 65536 - 65536;

// Independently classify all operation words, keeping word-source and decimal addressing distinct.
const forms: Form[] = [];
for (let opcode = 0; opcode < 65536; opcode++) {
  const major = Math.floor(opcode / 4096), om = Math.floor(opcode / 64) % 8, m = Math.floor(opcode / 8) % 8, r = opcode % 8, d = Math.floor(opcode / 512) % 8;
  let operation: Operation, size: 8 | 16, sm: number, sc: number, dm: number, dc: number;
  if ((major === 8 || major === 12) && (om === 3 || om === 7) || major === 4 && om === 6) {
    if (m === 1 || m === 7 && r > 4) continue;
    operation = major === 4 ? "CHK" : major === 8 ? om === 3 ? "DIVU" : "DIVS" : om === 3 ? "MULU" : "MULS";
    size = 16; sm = m; sc = r; dm = 0; dc = d;
  } else if ((major === 8 || major === 12) && Math.floor(opcode / 16) % 32 === 16) {
    operation = major === 8 ? "SBCD" : "ABCD"; size = 8; sm = dm = m === 0 ? 0 : 4; sc = r; dc = d;
  } else if (Math.floor(opcode / 64) === 0x120) {
    if (m === 1 || m === 7 && r > 1) continue;
    operation = "NBCD"; size = 8; sm = sc = 0; dm = m; dc = r;
  } else continue;
  const source = operation === "NBCD" ? "none" : sm === 0 ? `d${sc}` : sm === 7 && sc === 4 ? "immediate" : sm === 7 && sc >= 2 ? "program" : "memory";
  forms.push({ opcode, operation, size, sm, sc, dm, dc, key: `${operation}_${source}_${dm === 0 ? `d${dc}` : "memory"}` });
}
const representatives = [...new Map(forms.map(f => [f.key, f])).values()].map(f => ({ ...f,
  sm: sourceMemory(f) && f.sm !== 7 ? f.size === 8 ? 4 : 3 : f.sm, sc: sourceMemory(f) && f.sm !== 7 ? 7 : f.sc,
  dm: f.dm >= 2 ? 4 : 0, dc: f.dm >= 2 ? 7 : f.dc,
}));

// A signed decimal digit uses one correction even for invalid packed inputs.
function decimal(operation: Operation, destination: number, source: number, x: boolean) {
  const a = operation === "NBCD" ? 0 : destination, b = operation === "NBCD" ? destination : source, direction = operation === "ABCD" ? 1 : -1;
  const digit = (a: number, b: number, incoming: boolean) => {
    const total = a + direction * (b + Number(incoming)), carry = direction === 1 ? total >= 10 : total < 0;
    return { result: ((total + (carry ? direction * 6 : 0)) % 16 + 16) % 16, carry };
  };
  const low = digit(a % 16, b % 16, x), high = digit(Math.floor(a / 16), Math.floor(b / 16), low.carry);
  return { result: high.result * 16 + low.result, carry: high.carry };
}

function reference(s: Cpu68000State, f: Form, c: Context): Outcome {
  const read = (a: number, program: boolean) => f.size === 8 ? c.readByte(a)
    : (program ? c.readProgramByte(a) : c.readByte(a)) * 256 + (program ? c.readProgramByte(wrap(a + 1)) : c.readByte(wrap(a + 1)));
  const commit = () => { if (sourceMemory(f) || f.dm !== 0) c.commitAddressUpdates(); };
  let right = 0;
  if (f.operation !== "NBCD") {
    if (f.sm === 0) right = s[data[f.sc]!] % 2 ** f.size;
    else if (f.sm === 7 && f.sc === 4) right = c.fetchWord();
    else {
      const a = c.resolveAddress(f.size, f.sm, f.sc), program = f.sm === 7 && f.sc >= 2;
      if (f.size === 16 && a % 2) return { operation: "read", address: a, programSpace: program };
      right = read(a, program);
    }
  }
  if (f.size === 8) {
    const destination = f.dm === 0 ? 0 : c.resolveAddress(8, f.dm, f.dc);
    commit();
    const left = f.dm === 0 ? s[data[f.dc]!] % 256 : read(destination, false), facts = decimal(f.operation, left, right, s.flags.x);
    s.flags.c = facts.carry; s.flags.x = facts.carry; s.flags.z = s.flags.z && facts.result === 0;
    if (f.dm === 0) s[data[f.dc]!] = Math.floor(s[data[f.dc]!] / 256) * 256 + facts.result;
    else c.writeByte(destination, facts.result);
    return;
  }
  const flags = (result: number, width: number) => { s.flags.n = result >= 2 ** (width - 1); s.flags.z = result === 0; s.flags.v = false; s.flags.c = false; };
  if (f.operation === "CHK") {
    const tested = signedWord(s[data[f.dc]!] % 65536);
    if (tested < 0 || tested > signedWord(right)) { s.flags.n = tested < 0; commit(); return "bounds-check"; }
  } else if (f.operation.startsWith("MUL")) {
    const a = s[data[f.dc]!] % 65536, signed = f.operation === "MULS";
    const result = Number(BigInt.asUintN(32, BigInt(signed ? signedWord(a) : a) * BigInt(signed ? signedWord(right) : right)));
    s[data[f.dc]!] = result; flags(result, 32);
  } else {
    s.flags.c = false;
    if (!right) { commit(); return "divide-by-zero"; }
    const unsigned = s[data[f.dc]!], signed = f.operation === "DIVS";
    const a = signed ? BigInt.asIntN(32, BigInt(unsigned)) : BigInt(unsigned), b = BigInt(signed ? signedWord(right) : right), q = a / b, r = a % b;
    if (q < BigInt(signed ? -32768 : 0) || q > BigInt(signed ? 32767 : 65535)) s.flags.v = true;
    else {
      const quotient = Number(BigInt.asUintN(16, q));
      s[data[f.dc]!] = Number(BigInt.asUintN(16, r)) * 65536 + quotient; flags(quotient, 16);
    }
  }
  commit();
}

interface Scenario { bits: number; sourceAddress: number; destinationAddress: number; left: number; right: number; mutate?: boolean }
function observe(f: Form, scenario: Scenario, failAt: number, generated: boolean) {
  const state = initialState(scenario.bits), events: unknown[][] = [], writes: number[][] = [], pending = new Map<string, number>();
  const failure = Error("injected arithmetic stage failure"); let outcome: Outcome, failed = false, resolutions = 0;
  if (f.dm === 0) state[data[f.dc]!] = scenario.left;
  if (f.operation !== "NBCD" && f.sm === 0) state[data[f.sc]!] = scenario.right;
  const effect = (...event: unknown[]) => { events.push(event); if (events.length - 1 === failAt) throw failure; };
  const mutate = () => {
    if (!scenario.mutate) return;
    state.d0 = 0x98765432; state.d7 = 0xabcdef01; state.flags.x = !state.flags.x; state.flags.z = !state.flags.z; state.flags.s = !state.flags.s;
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
    const source = a === scenario.sourceAddress || f.size === 16 && a === wrap(scenario.sourceAddress + 1);
    const v = source ? scenario.right : scenario.left;
    return f.size === 8 ? v % 256 : a === scenario.sourceAddress ? Math.floor(v / 256) % 256 : v % 256;
  };
  const context: Context = {
    resolveAddress(size, mode, code) {
      effect("resolve", size, mode, code);
      const a = resolutions++ === 0 && sourceMemory(f) ? scenario.sourceAddress : scenario.destinationAddress;
      if (mode === 3 || mode === 4) pending.set(code === 7 ? state.flags.s ? "ssp" : "usp" : address[code]!, wrap(a + (mode === 3 ? size / 8 : 0)));
      mutate(); return a;
    },
    commitAddressUpdates() { effect("commit"); for (const [name, v] of pending) Reflect.set(observed, name, v); mutate(); },
    fetchWord() { effect("fetch word"); mutate(); return scenario.right % 65536; },
    readByte: a => read("data", a), readProgramByte: a => read("program", a),
    writeByte(a, v) { effect("memory write", a, v); writes.push([a, v]); mutate(); },
  };
  try { outcome = generated ? bodies[f.key]!(observed, f.sm, f.sc, f.dm, f.dc, context) : reference(observed, f, context); }
  catch (error) { if (error !== failure) throw error; failed = true; }
  return { state, events, writes, failed, outcome: outcome! };
}
const scenario: Scenario = { bits: 127, sourceAddress: 0xfffffffe, destinationAddress: 0x12345678, left: 0x89abcdef, right: 0x1234 };

test("68000 word arithmetic and decimal cover exactly 2,426 operation words with 579 shared bodies", () => {
  assert.equal(forms.length, 2426); assert.equal(representatives.length, 579);
  const inventory = [...wordArithmeticForms68000.map(f => ({ ...f, size: 16 })), ...decimalForms68000.map(f => ({ ...f, size: 8 }))];
  assert.equal(inventory.length, forms.length); assert.equal(new Set(inventory.map(f => f.opcode)).size, forms.length);
  const expected = new Map(forms.map(f => [f.opcode, f]));
  for (const f of inventory) assert.deepEqual({ opcode: f.opcode, operation: f.operation, size: f.size, sm: f.sourceMode, sc: f.sourceCode,
    dm: f.destinationMode, dc: f.destinationCode, key: f.body }, expected.get(f.opcode));
  assert.deepEqual(Object.keys(bodies).sort(), representatives.map(f => f.key).sort());
});

test("every word/decimal binding retains operand roles, aliases, source space, and both stack banks", () => {
  for (const f of forms) for (const bits of [0, 127]) assert.deepEqual(observe(f, { ...scenario, bits }, -1, true), observe(f, { ...scenario, bits }, -1, false), f.key);
});

test("word/decimal effects retain live state and precise commits at every failed effect, including exception paths", () => {
  for (const f of representatives) for (const mutate of [false, true]) for (const right of [0, 1, 3, 0x8000, 0xffff]) {
    const changed = { ...scenario, right, mutate }, expected = observe(f, changed, -1, false);
    assert.deepEqual(observe(f, changed, -1, true), expected, f.key);
    for (let i = 0; i < expected.events.length; i++) assert.deepEqual(observe(f, changed, i, true), observe(f, changed, i, false), `${f.key} at ${i}`);
  }
});

test("word sources reject odd addresses before data, flags, result writes, or address updates", () => {
  for (const f of representatives.filter(f => f.size === 16 && sourceMemory(f))) {
    const odd = { ...scenario, sourceAddress: 0xffffffff }, actual = observe(f, odd, -1, true);
    assert.deepEqual(actual, observe(f, odd, -1, false)); assert.deepEqual(actual.events, [["resolve", 16, f.sm, f.sc]]);
  }
});

test("word arithmetic covers signed/unsigned limits and quotient boundaries with independent BigInt results", () => {
  const cases = forms.filter(f => f.size === 16 && f.sm === 0 && f.sc === 1 && f.dc === 0);
  const values = [...new Set([0, 65535, ...Array.from({ length: 16 }, (_, i) => [2 ** i - 1, 2 ** i, Math.min(65535, 2 ** i + 1)]).flat()])];
  for (const f of cases) for (const right of values) for (const left of [...values, 0x7fffffff, 0x80000000, 0xffffffff,
    ...[-32769, -32768, -32767, 32767, 32768, 65535, 65536].map(q => wrap(q * signedWord(right)))]) {
    const edge = { ...scenario, left, right };
    assert.deepEqual(observe(f, edge, -1, true), observe(f, edge, -1, false), f.key);
  }
  for (const f of cases) for (let bits = 0; bits < 128; bits++) for (const [left, right] of [[0, 0], [0xffff8000, 0xffff], [0x8000, 0], [0xffffffff, 1], [0xffff, 0xffff], [0, 1]]) {
    const edge = { ...scenario, bits, left: left!, right: right! };
    assert.deepEqual(observe(f, edge, -1, true), observe(f, edge, -1, false));
  }
});

test("decimal arithmetic exhausts valid and invalid packed bytes, incoming X/Z, and preserved flags", () => {
  const state = initialState();
  for (const operation of ["ABCD", "SBCD", "NBCD"] as const) for (const x of [false, true]) for (const z of [false, true]) {
    const run = bodies[`${operation}_${operation === "NBCD" ? "none" : "d1"}_d0`]!;
    for (let a = 0; a < 256; a++) for (let b = 0; b < (operation === "NBCD" ? 1 : 256); b++) {
      state.d0 = 0x12340000 + a; state.d1 = b; state.flags = { x, z, n: true, v: true, c: true, s: true, t: true };
      const facts = decimal(operation, a, b, x);
      run(state, 0, 1, 0, 0, {} as Context);
      assert.equal(state.d0, 0x12340000 + facts.result);
      assert.deepEqual(state.flags, { x: facts.carry, z: z && facts.result === 0, c: facts.carry, n: true, v: true, s: true, t: true });
      if (a % 16 < 10 && a < 0xa0 && b % 16 < 10 && b < 0xa0) {
        const decimalA = Math.floor(a / 16) * 10 + a % 16, decimalB = Math.floor(b / 16) * 10 + b % 16;
        const total = operation === "ABCD" ? decimalA + decimalB + Number(x) : operation === "SBCD" ? decimalA - decimalB - Number(x) : -decimalA - Number(x);
        const decimalResult = ((total % 100) + 100) % 100;
        assert.equal(facts.result, Math.floor(decimalResult / 10) * 16 + decimalResult % 10);
      }
    }
  }
});

test("word/decimal explanations expose source commits, overflow decisions, and decimal flag order", () => {
  const division = describeInstruction(wordArithmetic68000.DIVS_memory_d0!);
  assert.ok(division.indexOf('flags "68000 division carry"') < division.indexOf("dividend:u32 := read D0"));
  assert.match(division, /quotientOverflow:flag := quotient does not fit/);
  assert.match(division, /68000 division overflow/);
  const zero = division.indexOf('return outcome "divide-by-zero"');
  assert.ok(division.indexOf("commit staged") < zero && zero < division.indexOf("dividend:u32 := read D0"));
  const packed = describeInstruction(decimal68000.ABCD_memory_memory!);
  assert.ok(packed.indexOf("sourceByte0:u8 := read memory") < packed.indexOf("destinationAddress:u32 := resolve"));
  assert.ok(packed.indexOf("commit staged") < packed.indexOf("destinationByte0:u8 := read memory"));
  assert.ok(packed.indexOf('flags "68000 decimal carry"') < packed.indexOf("previousZero:flag := read Z"));
  assert.ok(packed.indexOf('flags "68000 decimal zero"') < packed.indexOf("write memory"));
});
