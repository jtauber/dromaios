import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTypeScriptTypes } from "node:module";
import { instructions } from "../../../../src/components/cpus/generated/68000-system.js";
import { systemForms68000 } from "../../../../src/components/cpus/68000-system.js";
import { system68000 } from "../../../../src/components/cpus/semantics/definitions.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { cpuSymbols, flagLiteral, literal, resetDevices, when, writeRegister } from "../../../../src/components/cpus/semantics/model.js";
import { cpu68000StateDescription } from "../../../../src/components/cpus/state/68000.js";
import { cpu6502StateDescription } from "../../../../src/components/cpus/state/6502.js";
import { initialState } from "../../../helpers/68000-state.js";
import type { Cpu68000State, Cpu68000Exception } from "../../../../src/components/cpus/68000.js";
import type { Cpu68000AddressContext, Cpu68000ControlContext, Cpu68000ResetContext, OperandAlignmentFault, TargetAlignmentFault } from "../../../../src/components/cpus/68000-context.js";
import type { WordInstructionContext } from "../../../../src/components/cpus/instruction-context.js";

type Context = Cpu68000AddressContext & Cpu68000ControlContext & Cpu68000ResetContext & Pick<WordInstructionContext, "fetchWord" | "readByte" | "writeByte">;
type Outcome = Cpu68000Exception | OperandAlignmentFault | TargetAlignmentFault | void;
type Body = (state: Cpu68000State, mode: number, code: number, context: Context) => Outcome;
const bodies: Readonly<Record<string, Body>> = instructions;
const data = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"] as const;
const address = ["a0", "a1", "a2", "a3", "a4", "a5", "a6"] as const;
type Stored = typeof data[number] | typeof address[number] | "usp" | "ssp";
type Operation = "ORI" | "ANDI" | "EORI" | "from-status" | "to-status" | "from-USP" | "to-USP" | "RESET" | "NOP" | "STOP" | "RTE" | "RTR" | "TRAPV" | "exception";
interface Form { opcode: number; operation: Operation; full: boolean; register: number; mode: number; code: number; key: string; reason?: Cpu68000Exception }
const wrap = (n: number) => ((n % 4294967296) + 4294967296) % 4294967296;
const active = (s: Cpu68000State, code: number): Stored => code === 7 ? s.flags.s ? "ssp" : "usp" : address[code]!;
const fixed: Readonly<Record<number, Operation>> = { 0x4e70: "RESET", 0x4e71: "NOP", 0x4e72: "STOP", 0x4e73: "RTE", 0x4e76: "TRAPV", 0x4e77: "RTR" };

// Independent word scan: immediate data and trap literals do not multiply documented forms.
const forms: Form[] = [];
for (let opcode = 0; opcode < 65536; opcode++) {
  const m = Math.floor(opcode / 8) % 8, r = opcode % 8, group = Math.floor(opcode / 64);
  let operation: Operation, full = false, register = 0, mode = 0, code = 0, key: string, reason: Cpu68000Exception | undefined;
  if ([0x003c, 0x007c, 0x023c, 0x027c, 0x0a3c, 0x0a7c].includes(opcode)) {
    operation = opcode < 0x100 ? "ORI" : opcode < 0x300 ? "ANDI" : "EORI"; full = opcode % 128 >= 64;
    key = `${operation}_${full ? "SR" : "CCR"}`;
  } else if ([0x103, 0x113, 0x11b].includes(group)) {
    if (m === 1 || m === 7 && r > (group === 0x103 ? 1 : 4)) continue;
    operation = group === 0x103 ? "from-status" : "to-status"; full = group === 0x11b; mode = m; code = r; register = r;
    const operand = m === 0 ? `d${r}` : m === 7 && r === 4 ? "immediate" : m === 7 && r >= 2 ? "program" : "memory";
    key = operation === "from-status" ? `MOVE_SR_${operand}` : `MOVE_${operand}_${full ? "SR" : "CCR"}`;
  } else if (Math.floor(opcode / 16) === 0x4e6) {
    operation = Math.floor(opcode / 8) % 2 ? "from-USP" : "to-USP"; register = r;
    key = operation === "from-USP" ? `MOVE_USP_a${r}` : `MOVE_a${r}_USP`;
  } else if (fixed[opcode]) { operation = fixed[opcode]!; key = operation; }
  else {
    if (opcode === 0x4afc) { reason = "illegal-instruction"; key = "ILLEGAL"; }
    else if (Math.floor(opcode / 16) === 0x4e4) { reason = "trap"; key = "TRAP"; }
    else if (Math.floor(opcode / 4096) === 10) { reason = "line-a"; key = "LINE_A"; }
    else if (Math.floor(opcode / 4096) === 15) { reason = "line-f"; key = "LINE_F"; }
    else continue;
    operation = "exception";
  }
  forms.push({ opcode, operation, full, register, mode, code, key, reason });
}
const representatives = [...new Map(forms.map(f => [f.key, f])).values()];

// Pack/restore independently, in the model's field-access order; reserved bits are discarded.
function status(s: Cpu68000State): number {
  const system = (s.flags.t ? 32768 : 0) + (s.flags.s ? 8192 : 0), mask = s.interruptMask * 256;
  return system + mask + (s.flags.x ? 16 : 0) + (s.flags.n ? 8 : 0) + (s.flags.z ? 4 : 0) + (s.flags.v ? 2 : 0) + (s.flags.c ? 1 : 0);
}
function restore(s: Cpu68000State, word: number, full: boolean): void {
  for (const [name, bit] of [["x", 4], ["n", 3], ["z", 2], ["v", 1], ["c", 0]] as const) s.flags[name] = Math.floor(word / 2 ** bit) % 2 !== 0;
  if (full) { s.flags.t = word >= 32768; s.flags.s = Math.floor(word / 8192) % 2 !== 0; s.interruptMask = Math.floor(word / 256) % 8; }
}
function reference(s: Cpu68000State, f: Form, c: Context): Outcome {
  const read = (address: number, bytes: number, program = false) => {
    let result = 0; for (let i = 0; i < bytes; i++) result = result * 256 + (program ? c.readProgramByte : c.readByte)(wrap(address + i)); return result;
  };
  const fault = (address: number, programSpace = false): OperandAlignmentFault | undefined => address % 2 ? { operation: "read", address, programSpace } : undefined;
  const jump = (address: number): TargetAlignmentFault | void => { if (address % 2) return { operation: "fetch", address }; c.jump(address); };
  switch (f.operation) {
    case "ORI": case "ANDI": case "EORI": {
      if (f.full && !s.flags.s) return "privilege-violation";
      const old = status(s), immediate = c.fetchWord();
      restore(s, f.operation === "ORI" ? old | immediate : f.operation === "ANDI" ? old & immediate : old ^ immediate, f.full); return;
    }
    case "from-status": {
      const register = data[f.register]!, memory = f.mode !== 0;
      const address = memory ? c.resolveAddress(16, f.mode, f.code) : 0, error = fault(address);
      if (error) return error;
      if (memory) { c.commitAddressUpdates(); read(address, 2); } else void s[register];
      const word = status(s);
      if (memory) { c.writeByte(address, Math.floor(word / 256)); c.writeByte(wrap(address + 1), word % 256); }
      else s[register] = Math.floor(s[register] / 65536) * 65536 + word;
      return;
    }
    case "to-status": {
      if (f.full && !s.flags.s) return "privilege-violation";
      const immediate = f.mode === 7 && f.code === 4, memory = f.mode !== 0 && !immediate;
      let word: number;
      if (memory) {
        const address = c.resolveAddress(16, f.mode, f.code), program = f.mode === 7 && f.code >= 2, error = fault(address, program);
        if (error) return error;
        word = read(address, 2, program);
      } else word = immediate ? c.fetchWord() : s[data[f.register]!] % 65536;
      restore(s, word, f.full); if (memory) c.commitAddressUpdates(); return;
    }
    case "from-USP": case "to-USP": {
      if (!s.flags.s) return "privilege-violation";
      const register = active(s, f.register);
      if (f.operation === "from-USP") s[register] = s.usp; else s.usp = s[register]; return;
    }
    case "RESET": if (!s.flags.s) return "privilege-violation"; c.resetDevices(); return;
    case "NOP": return;
    case "STOP": if (!s.flags.s) return "privilege-violation"; restore(s, c.fetchWord(), true); s.halted = true; return;
    case "TRAPV": if (s.flags.v) return "overflow-trap"; return;
    case "exception": return f.reason;
    case "RTE": case "RTR": {
      const full = f.operation === "RTE";
      if (full && !s.flags.s) return "privilege-violation";
      const bank = full ? "ssp" : active(s, 7), address = s[bank], error = fault(address);
      if (error) return error;
      let word: number, target: number;
      if (full) { const high = read(wrap(address + 2), 2); word = read(address, 2); target = high * 65536 + read(wrap(address + 4), 2); }
      else { word = read(address, 2); target = read(wrap(address + 2), 4); }
      const targetError = jump(target); if (targetError) return targetError;
      s[bank] = wrap(address + 6); restore(s, word, full);
    }
  }
}

interface Scenario { bits: number; mask: number; operand: number; address: number; stack: number; target: number; mutate?: boolean }
const scenario: Scenario = { bits: 127, mask: 5, operand: 0x8105, address: 0xfffffffe, stack: 0xfffffffc, target: 0xabcd1234 };
function observe(f: Form, scenario: Scenario, failAt: number, generated: boolean) {
  const state = initialState(scenario.bits), events: unknown[][] = [], writes: number[][] = [], pending = new Map<Stored, number>();
  for (const name of data) state[name] = 0x43210000 + scenario.operand;
  state.interruptMask = scenario.mask; state.usp = scenario.stack; state.ssp = scenario.stack;
  let failed = false, outcome: Outcome, target: number | undefined;
  const failure = Error("injected system effect failure");
  const effect = (...event: unknown[]) => { events.push(event); if (events.length - 1 === failAt) throw failure; };
  const mutate = () => {
    if (!scenario.mutate) return;
    for (const name of ["x", "n", "z", "v", "c", "t", "s"] as const) state.flags[name] = !state.flags[name];
    state.interruptMask = (state.interruptMask + 1) % 8;
    state.d0 = 0xabcd7654; state.d7 = 0x98765432; state.usp = 0x12345678; state.ssp = 0x2345678a;
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
  const bytes = [Math.floor(scenario.operand / 256), scenario.operand % 256,
    ...Array.from({ length: 4 }, (_, i) => Math.floor(scenario.target / 2 ** (24 - i * 8)) % 256)];
  const read = (space: string, address: number) => {
    effect(space, address); mutate();
    return f.operation === "RTE" || f.operation === "RTR" ? bytes[wrap(address - scenario.stack)]!
      : address === scenario.address ? Math.floor(scenario.operand / 256) : scenario.operand % 256;
  };
  const context: Context = {
    fetchWord() { effect("fetch word"); mutate(); return scenario.operand; },
    resolveAddress(size, mode, code) {
      effect("resolve", size, mode, code);
      if (mode === 3 || mode === 4) pending.set(active(state, code), wrap(scenario.address + (mode === 3 ? 2 : 0)));
      mutate(); return scenario.address;
    },
    commitAddressUpdates() { effect("commit"); for (const [register, contents] of pending) observed[register] = contents; mutate(); },
    readByte: address => read("read data", address), readProgramByte: address => read("read program", address),
    writeByte(address, contents) { effect("write byte", address, contents); writes.push([address, contents]); mutate(); },
    resetDevices() { effect("reset devices"); mutate(); },
    nextAddress() { throw Error("status/system instructions do not read the fetch cursor"); },
    jump(address) { effect("target", address); target = address; mutate(); },
  };
  try { outcome = generated ? bodies[f.key]!(observed, f.mode, f.code, context) : reference(observed, f, context); }
  catch (error) { if (error !== failure) throw error; failed = true; }
  return { state, events, writes, failed, target, outcome: outcome! };
}

test("68000 system inventory covers 186 documented forms, all aliases, and both software emulator lines in 63 bodies", () => {
  assert.equal(forms.length, 8393); assert.equal(representatives.length, 63);
  assert.equal(forms.filter(f => f.opcode < 0xa000 && f.key !== "TRAP").length + 1, 186);
  assert.deepEqual(systemForms68000.map(f => [f.opcode, f.body, f.mode, f.code]).sort((a, b) => Number(a[0]) - Number(b[0])),
    forms.map(f => [f.opcode, f.key, f.mode, f.code]));
  assert.deepEqual(Object.keys(bodies).sort(), representatives.map(f => f.key).sort());
});

test("every status/system binding preserves user/supervisor behavior, flags, and alias selection", () => {
  for (const f of forms) for (const bits of [0, 127]) {
    const changed = { ...scenario, bits };
    assert.deepEqual(observe(f, changed, -1, true), observe(f, changed, -1, false), f.key);
  }
});

test("system bodies preserve exact capture order and partial effects on every failed operation", () => {
  const memory = representatives.filter(f => f.key.endsWith("memory")).map(f => ({ ...f, mode: 3, code: 7 }));
  const sources = representatives.filter(f => f.key.startsWith("MOVE_memory_")).flatMap(f => [3, 4].map(mode => ({ ...f, mode, code: 7 })));
  for (const f of [...representatives, ...memory, ...sources]) for (const changed of [scenario, { ...scenario, bits: 0 }, { ...scenario, mutate: true },
    { ...scenario, bits: 0, mutate: true }, { ...scenario, address: 1, stack: 1 }, { ...scenario, target: 1 }]) {
    const expected = observe(f, changed, -1, false);
    assert.deepEqual(observe(f, changed, -1, true), expected, f.key);
    for (let i = 0; i < expected.events.length; i++) assert.deepEqual(observe(f, changed, i, true), observe(f, changed, i, false), `${f.key} at ${i}`);
  }
});

test("status writes ignore all reserved bits and preserve CCR system fields for every input word", () => {
  const selected = [
    { execute: instructions.STOP, full: true, halt: true },
    { execute: instructions.MOVE_immediate_CCR, full: false, halt: false },
    { execute: instructions.MOVE_immediate_SR, full: true, halt: false },
  ];
  for (let word = 0; word < 65536; word++) for (const { execute, full, halt } of selected) {
    const state = initialState(), before = structuredClone(state.flags); state.interruptMask = word % 8;
    execute(state, 7, 4, { fetchWord: () => word });
    assert.deepEqual(state.flags, { x: !!(word & 16), n: !!(word & 8), z: !!(word & 4), v: !!(word & 2), c: !!(word & 1),
      t: full ? !!(word & 32768) : before.t, s: full ? !!(word & 8192) : before.s });
    assert.equal(state.interruptMask, full ? Math.floor(word / 256) % 8 : word % 8);
    assert.equal(state.halted, halt);
  }
});

test("packed SR combines every flag and interrupt-mask value with zero reserved bits", () => {
  for (let bits = 0; bits < 128; bits++) for (let mask = 0; mask < 8; mask++) {
    const state = initialState(bits); state.interruptMask = mask;
    instructions.MOVE_SR_d0(state, 0, 0);
    const expected = ((bits & 32) * 1024) + ((bits & 64) * 128) + mask * 256
      + (bits & 1) * 16 + (bits & 2) * 4 + (bits & 4) + (bits & 8) / 4 + (bits & 16) / 16;
    assert.equal(state.d0, 0x11220000 + expected);
  }
});

test("status explanations expose privilege before fetch, status before pointer commits, and RTE frame read order", () => {
  const immediate = describeInstruction(system68000.ORI_SR!), move = describeInstruction(system68000.MOVE_memory_SR!), rte = describeInstruction(system68000.RTE!);
  assert.ok(immediate.indexOf('reject instruction: "privilege-violation"') < immediate.indexOf("fetch complete native-order word"));
  assert.ok(move.lastIndexOf("restore packed status") < move.indexOf("commit staged address-register updates"));
  assert.ok(rte.indexOf("highByte0:u8") < rte.indexOf("statusByte0:u8"));
  assert.ok(rte.indexOf("statusByte0:u8") < rte.indexOf("lowByte0:u8"));
  assert.ok(rte.indexOf("select instruction target") < rte.indexOf("write SSP"));
});

test("device reset validates its owning CPU and propagates nested callback failures without later effects", async () => {
  const cpu = cpuSymbols("68000", cpu68000StateDescription), other = cpuSymbols("6502", cpu6502StateDescription);
  const definition = defineInstruction({ cpu: cpu.declaration, name: "reset probe", explanation: "Device signal before a later effect.",
    steps: [when(flagLiteral(true), [resetDevices()]), writeRegister(cpu.register("d0"), literal(32, 42))] });
  assert.throws(() => defineInstruction({ ...definition, cpu: other.declaration, steps: [resetDevices()] }), /68000 connection/);
  const source = generateInstructions("68000", { probe: definition });
  assert.match(source, /Cpu68000ResetContext/); assert.match(source, /"resetDevices"/); assert.doesNotMatch(source, /"readByte"|"writeByte"/);
  const compiled: { instructions: { probe(state: Cpu68000State, context: Cpu68000ResetContext): void } } =
    await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source))}`);
  const state = initialState(), before = structuredClone(state), failure = Error("device failure");
  assert.throws(() => compiled.instructions.probe(state, { resetDevices() { throw failure; } }), error => error === failure);
  assert.deepEqual(state, before);
  let resets = 0; compiled.instructions.probe(state, { resetDevices() { resets++; } });
  assert.equal(resets, 1); assert.deepEqual(state, { ...before, d0: 42 });
});
