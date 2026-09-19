import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions } from "../../../../src/components/cpus/generated/68000-transfers.js";
import { transferForms68000 } from "../../../../src/components/cpus/68000-transfers.js";
import { transfers68000 } from "../../../../src/components/cpus/semantics/definitions.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { initialState } from "../../../helpers/68000-state.js";
import type { Cpu68000State } from "../../../../src/components/cpus/state/68000.js";
import type { Cpu68000AddressContext, OperandAlignmentFault } from "../../../../src/components/cpus/68000-context.js";
import type { WordInstructionContext } from "../../../../src/components/cpus/instruction-context.js";

type Context = Cpu68000AddressContext & Pick<WordInstructionContext, "fetchWord" | "readByte" | "writeByte">;
type Outcome = OperandAlignmentFault | void;
type Body = (state: Cpu68000State, mode: number, code: number, context: Context) => Outcome;
const bodies: Readonly<Record<string, Body>> = instructions;
const data = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"] as const;
const address = ["a0", "a1", "a2", "a3", "a4", "a5", "a6"] as const;
type Stored = typeof data[number] | typeof address[number] | "usp" | "ssp";
interface Form { opcode: number; peripheral: boolean; size: 16 | 32; load: boolean; register: number; mode: number; code: number; key: string }
const wrap = (n: number) => ((n % 4294967296) + 4294967296) % 4294967296;
const signedWord = (n: number) => n < 32768 ? n : n - 65536;
const active = (s: Cpu68000State, code: number): Stored => code === 7 ? s.flags.s ? "ssp" : "usp" : address[code]!;

// Scan all operation words using numeric fields, independently of the production patterns.
const forms: Form[] = [];
for (let opcode = 0; opcode < 65536; opcode++) {
  const mode = Math.floor(opcode / 8) % 8, code = opcode % 8, size = Math.floor(opcode / 64) % 2 ? 32 : 16;
  if (opcode < 4096 && Math.floor(opcode / 256) % 2 === 1 && mode === 1) {
    const load = Math.floor(opcode / 128) % 2 === 0, register = Math.floor(opcode / 512) % 8;
    forms.push({ opcode, peripheral: true, size, load, register, mode: 0, code: 0,
      key: `MOVEP_${size}_${load ? "load" : "store"}_d${register}_a${code}` });
  } else if ([0x91, 0x99].includes(Math.floor(opcode / 128))) {
    const load = Math.floor(opcode / 1024) % 2 === 1;
    if (![2, 5, 6, load ? 3 : 4].includes(mode) && !(mode === 7 && code < (load ? 4 : 2))) continue;
    const location = mode === 3 || mode === 4 ? `a${code}` : mode === 7 && code >= 2 ? "program" : "memory";
    forms.push({ opcode, peripheral: false, size, load, register: 0, mode, code, key: `MOVEM_${size}_${load ? "load" : "store"}_${location}` });
  }
}
const representatives = [...new Map(forms.map(f => [f.key, f])).values()];

// An imperative reference keeps the running address and visits only selected registers.
function reference(s: Cpu68000State, f: Form, c: Context): Outcome {
  const read = (address: number, stride: number, program = false) => {
    let result = 0;
    for (let i = 0; i < f.size / 8; i++) result = result * 256 + (program ? c.readProgramByte : c.readByte)(wrap(address + i * stride));
    return result;
  };
  const write = (address: number, contents: number, stride: number) => {
    for (let i = 0; i < f.size / 8; i++) c.writeByte(wrap(address + i * stride), Math.floor(contents / 2 ** (f.size - 8 - i * 8)) % 256);
  };
  if (f.peripheral) {
    const base = s[active(s, f.opcode % 8)], target = wrap(base + signedWord(c.fetchWord())), register = data[f.register]!;
    if (f.load) {
      const result = read(target, 2);
      s[register] = f.size === 32 ? result : Math.floor(s[register] / 65536) * 65536 + result;
    } else write(target, s[register], 2);
    return;
  }
  const mask = c.fetchWord(), decrement = f.mode === 4, update = decrement || f.mode === 3;
  const base = update ? active(s, f.code) : undefined;
  let target = base ? s[base] : c.resolveAddress(32, f.mode, f.code);
  if (mask === 0) return;
  const first = decrement ? wrap(target - f.size / 8) : target, programSpace = f.mode === 7 && f.code >= 2;
  if (first % 2) return f.load ? { operation: "read", address: first, programSpace } : { operation: "write", address: first };
  for (let bit = 0; bit < 16; bit++) {
    if (Math.floor(mask / 2 ** bit) % 2 === 0) continue;
    const index = decrement ? 15 - bit : bit, register = index < 8 ? data[index]! : active(s, index - 8);
    if (decrement) target = wrap(target - f.size / 8);
    if (f.load) { const result = read(target, 1, programSpace); s[register] = f.size === 16 ? wrap(signedWord(result)) : result; }
    else write(target, s[register], 1);
    if (!decrement) target = wrap(target + f.size / 8);
  }
  if (base) s[base] = target;
}

interface Scenario { supervisor: boolean; mask: number; displacement: number; base: number; contents: number; mutate?: boolean }
const scenario: Scenario = { supervisor: false, mask: 0xffff, displacement: 0xfffe, base: 0xfffffffe, contents: 0x89abcdef };
function observe(f: Form, scenario: Scenario, failAt: number, generated: boolean) {
  const state = initialState(), events: unknown[][] = [], writes: number[][] = [];
  state.flags.s = scenario.supervisor;
  for (const [i, name] of data.entries()) state[name] = wrap(scenario.contents + i * 65536);
  for (const name of address) state[name] = scenario.base;
  state.usp = scenario.base; state.ssp = wrap(scenario.base + 256);
  let reads = 0, failed = false, outcome: Outcome;
  const failure = Error("injected transfer failure");
  const effect = (...event: unknown[]) => { events.push(event); if (events.length - 1 === failAt) throw failure; };
  const mutate = () => {
    if (!scenario.mutate) return;
    state.flags.s = !state.flags.s;
    state.d0 = 0x43211234; state.d7 = 0x9876fedc; state.usp = 0x12345678; state.ssp = 0x2345678a; state.a0 = 0x3456789c;
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
  const read = (space: string, address: number) => {
    effect(space, address); mutate(); return Math.floor(scenario.contents / 2 ** (24 - (reads++ % 4) * 8)) % 256;
  };
  const context: Context = {
    fetchWord() { effect("fetch word"); mutate(); return f.peripheral ? scenario.displacement : scenario.mask; },
    resolveAddress(size, mode, code) { effect("resolve", size, mode, code); mutate(); return scenario.base; },
    commitAddressUpdates() { throw Error("list transfers must own their base update"); },
    readByte: address => read("read data", address), readProgramByte: address => read("read program", address),
    writeByte(address, contents) { effect("write byte", address, contents); writes.push([address, contents]); mutate(); },
  };
  try { outcome = generated ? bodies[f.key]!(observed, f.mode, f.code, context) : reference(observed, f, context); }
  catch (error) { if (error !== failure) throw error; failed = true; }
  return { state, events, writes, failed, outcome: outcome! };
}

test("68000 transfer inventory covers exactly 256 MOVEP and 140 MOVEM forms with 294 bodies", () => {
  assert.equal(forms.filter(f => f.peripheral).length, 256); assert.equal(forms.filter(f => !f.peripheral).length, 140);
  assert.equal(representatives.length, 294);
  assert.deepEqual(transferForms68000.map(f => [f.opcode, f.body, f.mode, f.code]).sort((a, b) => Number(a[0]) - Number(b[0])),
    forms.map(f => [f.opcode, f.key, f.mode, f.code]));
  assert.deepEqual(Object.keys(bodies).sort(), representatives.map(f => f.key).sort());
});

test("every transfer binding preserves both stack banks, empty and sparse masks, and alignment", () => {
  for (const f of forms) for (const supervisor of [false, true]) for (const mask of f.peripheral ? [0] : [0, 1, 0x8000, 0x8001, 0x5555, 0xaaaa, 0xffff]) for (const base of [0, 1, 0xfffffffe, 0xffffffff]) {
    const changed = { ...scenario, supervisor, mask, base };
    assert.deepEqual(observe(f, changed, -1, true), observe(f, changed, -1, false), f.key);
  }
});

test("transfer failures retain precisely the completed bytes and registers, with live source values and captured base banks", () => {
  for (const f of representatives) for (const supervisor of [false, true]) for (const mutate of [false, true]) {
    const changed = { ...scenario, supervisor, mutate }, expected = observe(f, changed, -1, false);
    assert.deepEqual(observe(f, changed, -1, true), expected, f.key);
    for (let i = 0; i < expected.events.length; i++) assert.deepEqual(observe(f, changed, i, true), observe(f, changed, i, false), `${f.key} at ${i}`);
  }
});

test("MOVEP displacement boundaries and MOVEM sign extension retain full unsigned long values", () => {
  for (const f of representatives) for (const displacement of f.peripheral ? [0, 1, 0x7fff, 0x8000, 0xfffe, 0xffff] : [0]) for (const contents of [0, 0x7fffffff, 0x80000000, 0xffffffff]) {
    const changed = { ...scenario, displacement, contents };
    assert.deepEqual(observe(f, changed, -1, true), observe(f, changed, -1, false), f.key);
  }
});

test("transfer explanations expose displacement capture, alternate bytes, mask order, and final pointer commit", () => {
  const peripheral = describeInstruction(transfers68000.MOVEP_16_load_d0_a7!);
  const multiple = describeInstruction(transfers68000.MOVEM_32_store_a7!);
  assert.ok(peripheral.indexOf("read S") < peripheral.indexOf("fetch complete native-order word"));
  assert.match(peripheral, /alternate addresses/); assert.doesNotMatch(peripheral, /alignment fault/);
  assert.ok(multiple.indexOf("fetch complete native-order word") < multiple.indexOf("read S"));
  assert.match(multiple, /empty list/); assert.match(multiple, /reversed/); assert.match(multiple, /after the whole list succeeds/);
});
