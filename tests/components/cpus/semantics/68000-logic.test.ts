import assert from "node:assert/strict";
import { test } from "node:test";
import { initialState } from "../../../helpers/68000-state.js";
import * as logicModule from "../../../../src/components/cpus/generated/68000-mode-code.js";
import { selectFamily } from "../../../helpers/68000-families.js";
const logicFamily = selectFamily(logicModule, "operandLogic");
const { instructions, opcodeInstructions } = logicFamily;
import { logic68000 } from "../../../helpers/68000-families.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import type { WordAddressContext, OperandAlignmentFault } from "../../../../src/components/cpus/word-execution.js";
import type { WordInstructionContext } from "../../../../src/components/cpus/instruction-context.js";
import type { Cpu68000State } from "../../../../src/components/cpus/semantics/generated/state/68000.js";

type Context = WordAddressContext & Pick<WordInstructionContext, "fetchWord" | "readByte" | "writeByte">;
type Body = (state: Cpu68000State, mode: number, code: number, context: Context) => OperandAlignmentFault | "unsupported" | void;
// The test inventory selects only this semantic family from the shared signature module.
const bodies = opcodeInstructions as unknown as Readonly<Record<number, Body>>;
const data = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"] as const;
const address = ["a0", "a1", "a2", "a3", "a4", "a5", "a6"] as const;
type Operation = "AND" | "OR" | "EOR" | "CLR" | "NOT" | "TST";
interface Form { opcode: number; operation: Operation; size: 8 | 16 | 32; sm: number; sc: number; dm: number; dc: number; key: string }
const unary = (f: Form) => f.operation === "CLR" || f.operation === "NOT" || f.operation === "TST";
const sourceMemory = (f: Form) => !unary(f) && f.sm >= 2 && !(f.sm === 7 && f.sc === 4);
const wrap = (n: number) => ((n % 4294967296) + 4294967296) % 4294967296;

// Scan the entire operation word independently of production patterns and EA classification.
const forms: Form[] = [];
for (let opcode = 0; opcode < 65536; opcode++) {
  const width = Math.floor(opcode / 64) % 4;
  if (width === 3) continue;
  const size = ([8, 16, 32] as const)[width]!, high = Math.floor(opcode / 256), major = Math.floor(high / 16);
  const mode = Math.floor(opcode / 8) % 8, code = opcode % 8, register = Math.floor(opcode / 512) % 8;
  let operation: Operation, sm: number, sc: number, dm: number, dc: number;
  if (major === 8 || major === 12 || (major === 11 && high % 2 === 1)) {
    operation = major === 8 ? "OR" : major === 12 ? "AND" : "EOR";
    if (mode === 1) continue;
    if (high % 2 === 0) {
      if (mode === 7 && code > 4) continue;
      sm = mode; sc = code; dm = 0; dc = register;
    } else {
      if ((mode === 0 && operation !== "EOR") || (mode === 7 && code > 1)) continue;
      sm = 0; sc = register; dm = mode; dc = code;
    }
  } else if ([0, 2, 10, 0x42, 0x46, 0x4a].includes(high)) {
    if (mode === 1 || (mode === 7 && code > 1)) continue;
    operation = high === 0 ? "OR" : high === 2 ? "AND" : high === 10 ? "EOR" : high === 0x42 ? "CLR" : high === 0x46 ? "NOT" : "TST";
    sm = high < 16 ? 7 : 0; sc = high < 16 ? 4 : 0; dm = mode; dc = code;
  } else continue;
  const source = high >= 0x42 && high <= 0x4a ? "none" : sm === 0 ? `d${sc}` : sm === 7 && sc === 4 ? "immediate" : sm === 7 && sc >= 2 ? "program" : "memory";
  forms.push({ opcode, operation, size, sm, sc, dm, dc, key: `${operation}_${size}_${source}_${dm === 0 ? `d${dc}` : "memory"}` });
}
const representatives = [...new Map(forms.map(f => [f.key, f])).values()].map(f => ({ ...f,
  sm: sourceMemory(f) && f.sm !== 7 ? 3 : f.sm, sc: sourceMemory(f) && f.sm !== 7 ? 7 : f.sc,
  dm: f.dm >= 2 ? 3 : f.dm, dc: f.dm >= 2 ? 7 : f.dc,
}));

// Calculate one truth-table bit at a time, without the production bitwise expressions.
function result(operation: Operation, width: number, left: number, right: number): number {
  let value = 0;
  for (let bit = 0; bit < width; bit++) {
    const a = Math.floor(left / 2 ** bit) % 2 !== 0, b = Math.floor(right / 2 ** bit) % 2 !== 0;
    if (operation === "AND" ? a && b : operation === "OR" ? a || b : operation === "EOR" ? a !== b
      : operation === "NOT" ? !a : operation === "TST" ? a : false) value += 2 ** bit;
  }
  return value;
}

function reference(s: Cpu68000State, f: Form, c: Context): OperandAlignmentFault | void {
  const read = (a: number, program: boolean) => {
    let value = 0;
    for (let offset = 0; offset < f.size / 8; offset++) value = value * 256 + (program ? c.readProgramByte(wrap(a + offset)) : c.readByte(wrap(a + offset)));
    return value;
  };
  let right = 0;
  if (!unary(f)) {
    if (f.sm === 0) right = s[data[f.sc]!] % 2 ** f.size;
    else if (f.sm === 7 && f.sc === 4) { right = c.fetchWord(); right = f.size === 32 ? right * 65536 + c.fetchWord() : right % 2 ** f.size; }
    else {
      const a = c.resolveAddress(f.size, f.sm, f.sc), program = f.sm === 7 && (f.sc === 2 || f.sc === 3);
      if (f.size > 8 && a % 2) return { operation: "read", address: a, programSpace: program };
      right = read(a, program);
    }
  }
  let destination = 0;
  if (f.dm !== 0) {
    destination = c.resolveAddress(f.size, f.dm, f.dc);
    if (f.size > 8 && destination % 2) return { operation: "read", address: destination, programSpace: false };
  }
  if (sourceMemory(f) || f.dm !== 0) c.commitAddressUpdates();
  const left = f.dm === 0 ? s[data[f.dc]!] % 2 ** f.size : read(destination, false);
  const value = result(f.operation, f.size, left, right);
  s.flags.n = value >= 2 ** (f.size - 1); s.flags.z = value === 0; s.flags.v = false; s.flags.c = false;
  if (f.operation === "TST") return;
  if (f.dm === 0) s[data[f.dc]!] = f.size === 32 ? value : Math.floor(s[data[f.dc]!] / 2 ** f.size) * 2 ** f.size + value;
  else for (let offset = 0; offset < f.size / 8; offset++) c.writeByte(wrap(destination + offset), Math.floor(value / 2 ** (f.size - 8 - offset * 8)) % 256);
}

interface Scenario { bits: number; address: number; left: number; right: number; mutate?: boolean }
function observe(f: Form, scenario: Scenario, failAt: number, generated: boolean) {
  const state = initialState(scenario.bits), events: unknown[][] = [], writes: number[][] = [], pending = new Map<string, number>();
  const failure = Error("injected logical effect failure");
  let failed = false, outcome: OperandAlignmentFault | "unsupported" | void, fetches = 0;
  if (f.dm === 0) state[data[f.dc]!] = scenario.left;
  if (!unary(f) && f.sm === 0) state[data[f.sc]!] = scenario.right;
  const effect = (...event: unknown[]) => { events.push(event); if (events.length - 1 === failAt) throw failure; };
  const mutate = () => {
    if (!scenario.mutate) return;
    state.d0 = 0x87654321; state.d7 = 0x89abcdef; state.usp = 0xabc00000; state.ssp = 0xdef00000; state.flags.s = !state.flags.s;
  };
  const observed = new Proxy(state, {
    get(target, key, receiver) {
      if (key === "flags") return new Proxy(target.flags, {
        get(target, key, receiver) { const value = Reflect.get(target, key, receiver); effect("flag read", key, value); return value; },
        set(target, key, value) { effect("flag write", key, value); mutate(); return Reflect.set(target, key, value); },
      });
      const value = Reflect.get(target, key, receiver); effect("read", key, value); return value;
    },
    set(target, key, value) { effect("write", key, value); return Reflect.set(target, key, value); },
  });
  const read = (space: string, a: number) => {
    effect("memory read", space, a); mutate();
    const offset = wrap(a - scenario.address), value = sourceMemory(f) ? scenario.right : scenario.left;
    return Math.floor(value / 2 ** (f.size - 8 - offset * 8)) % 256;
  };
  const context: Context = {
    resolveAddress(size, mode, code) {
      effect("resolve", size, mode, code);
      if (mode === 3 || mode === 4) pending.set(code === 7 ? state.flags.s ? "ssp" : "usp" : address[code]!,
        wrap(scenario.address + (mode === 3 ? code === 7 && size === 8 ? 2 : size / 8 : 0)));
      mutate(); return scenario.address;
    },
    commitAddressUpdates() { effect("commit"); for (const [field, value] of pending) Reflect.set(observed, field, value); mutate(); },
    fetchWord() { effect("fetch word"); mutate(); return f.size === 8 ? 0xa500 + scenario.right % 256
      : f.size === 16 ? scenario.right % 65536 : fetches++ === 0 ? Math.floor(scenario.right / 65536) : scenario.right % 65536; },
    readByte: a => read("data", a), readProgramByte: a => read("program", a),
    writeByte(a, byte) { effect("memory write", a, byte); mutate(); writes.push([a, byte]); },
  };
  try { outcome = generated ? bodies[f.opcode]!(observed, sourceMemory(f) ? f.sm : f.dm, sourceMemory(f) ? f.sc : f.dc, context) : reference(observed, f, context); }
  catch (error) { if (error !== failure) throw error; failed = true; }
  return { state, events, writes, failed, outcome: outcome! };
}

const scenario: Scenario = { bits: 127, address: 0xfffffffe, left: 0x89abcdef, right: 0xfedcba98 };

test("68000 logical bindings cover exactly 6,660 forms and share 906 bodies without status or illegal slots", () => {
  assert.equal(forms.length, 6660); assert.equal(representatives.length, 906);
  assert.deepEqual(Object.keys(bodies).map(Number), forms.map(f => f.opcode));
  const names = representatives.map(f => {
    const [, , from, to] = f.key.split("_");
    const mnemonic = from === "immediate" ? `${f.operation}I` : f.operation;
    return `${mnemonic}.${f.size === 8 ? "B" : f.size === 16 ? "W" : "L"} ${from === "none" ? "" : `${from!.toUpperCase()},`}${to!.toUpperCase()}`;
  }).sort();
  assert.deepEqual(Object.keys(logic68000).sort(), names);
  assert.deepEqual(Object.keys(instructions).sort(), names);
  assert.equal(new Set(Object.values(bodies)).size, 906);

});

test("every logical binding preserves operand identity, width, access space, and both stack banks", () => {
  for (const f of forms) for (const bits of [0, 127]) assert.deepEqual(observe(f, { ...scenario, bits }, -1, true), observe(f, { ...scenario, bits }, -1, false), f.key);
});

test("logical bodies preserve effect order, live upper Dn bits, and completed state at every failure", () => {
  for (const f of representatives) for (const bits of [0, 127]) {
    const changed = { ...scenario, bits, mutate: true }, expected = observe(f, changed, -1, false);
    assert.deepEqual(observe(f, changed, -1, true), expected, f.key);
    for (let at = 0; at < expected.events.length; at++) assert.deepEqual(observe(f, changed, at, true), observe(f, changed, at, false), `${f.key} at ${at}`);
  }
});

test("logical operand alignment rejects before commits, data accesses, flags, or writeback", () => {
  for (const f of representatives) {
    const odd = { ...scenario, address: 0xffffffff }, actual = observe(f, odd, -1, true);
    assert.deepEqual(actual, observe(f, odd, -1, false), f.key);
    if (actual.outcome) assert.ok(actual.events.every(e => !["commit", "memory read", "memory write", "flag write"].includes(String(e[0]))));
  }
});

test("logical truth tables cover every input bit and all incoming flags, retaining X/T/S", () => {
  // Every body above is checked separately. Here use one form per operation/size and vary arithmetic independently.
  const cases = [...new Map(forms.filter(f => f.sm === 7 && f.sc === 4 || unary(f)).map(f => [`${f.operation}_${f.size}`, f])).values()];
  for (const f of cases) for (let bits = 0; bits < 128; bits++) for (let bit = 0; bit < f.size; bit++) {
    for (const [left, right] of [[2 ** bit, 0], [0, 2 ** bit], [2 ** bit, 2 ** bit], [2 ** f.size - 1 - 2 ** bit, 2 ** bit]]) {
      const edge = { bits, address: 0xfffffffe, left: left!, right: right! };
      assert.deepEqual(observe(f, edge, -1, true), observe(f, edge, -1, false), `${f.key} bit ${bit}`);
    }
  }
});

test("logical explanations expose destination reads, commit timing, and flags before writes", () => {
  for (const operation of ["CLR", "NOT", "TST"] as const) {
    const text = describeInstruction(logic68000[`${operation}.L MEMORY`]!);
    assert.ok(text.indexOf("commit staged") < text.indexOf("read memory"));
    assert.match(text, /byte3:u8 := read memory/);
    assert.match(text, /flags "68000 result"/);
    if (operation === "TST") assert.doesNotMatch(text, /write memory/);
    else assert.ok(text.indexOf('flags "68000 result"') < text.indexOf("write memory"));
  }
});
