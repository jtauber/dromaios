import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { instructions } from "../../../../src/components/cpus/generated/6502.js";
import { instructions as intel } from "../../../../src/components/cpus/generated/8080.js";
import { instructions as motorola } from "../../../../src/components/cpus/generated/6809.js";
import { instructions as motorola6800 } from "../../../../src/components/cpus/generated/6800.js";
import type { Cpu6800State } from "../../../../src/components/cpus/state/6800.js";
import { cpu6809StateDescription } from "../../../../src/components/cpus/state/6809.js";
import type { Cpu6809State } from "../../../../src/components/cpus/state/6809.js";
import type { Cpu6502State } from "../../../../src/components/cpus/semantics/generated/state/6502.js";
import type { Cpu8080State } from "../../../../src/components/cpus/semantics/generated/state/8080.js";
import { capture, cpuSymbols, flagLiteral, flagValue, literal, lowBit, negative, not, readFlag, readRegister,
  shiftLeft, shiftRight, updateFlags, value, writeRegister, xor } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";

test("generated word shifts preserve a captured incoming flag and handle every unsigned word in either direction", async () => {
  const cpu = cpuSymbols("6809", cpu6809StateDescription);
  // Compiler probes, not 6809 instructions: clear live C after capturing it, then use the capture.
  const definitions = Object.fromEntries(([
    ["left", shiftLeft, negative], ["right", shiftRight, lowBit],
  ] as const).map(([name, shift, outgoing]) => [name, defineInstruction({
    cpu: cpu.declaration, name, explanation: "Word shift and flag-capture probe.", steps: [
      readRegister("original", cpu.register("x")), readFlag("carry", cpu.flag("c")),
      updateFlags({ name: "clear live C", parameters: {}, unlisted: "preserve",
        updates: [{ flag: cpu.flag("c"), value: flagLiteral(false) }],
      }, {}),
      capture("result", shift(value("original"), flagValue("carry"))),
      writeRegister(cpu.register("x"), value("result")),
      updateFlags({ name: "outgoing bit", parameters: { original: 16 }, unlisted: "preserve",
        updates: [{ flag: cpu.flag("c"), value: outgoing(value("original")) }],
      }, { original: value("original") }),
    ],
  })]));
  const source = generateInstructions("6809", definitions);
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
  const compiled: { instructions: Record<"left" | "right", (state: Cpu6809State) => void> } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  const state: Cpu6809State = { a: 0, b: 0, dp: 0, x: 0, y: 0, s: 0, u: 0, pc: 0, waitMode: "none", nmiArmed: false,
    flags: { e: false, f: false, h: false, i: false, n: false, z: false, v: false, c: false } };
  for (const direction of ["left", "right"] as const) for (const incoming of [false, true]) for (let original = 0; original < 65536; original++) {
    state.x = original; state.flags.c = incoming;
    compiled.instructions[direction](state);
    assert.equal(state.x, direction === "left" ? (original * 2 + Number(incoming)) % 65536 : Math.floor(original / 2) + Number(incoming) * 32768);
    assert.equal(state.flags.c, direction === "left" ? original >= 32768 : original % 2 === 1);
  }
});

test("generated Boolean XOR preserves nested operands and negation for the complete truth table", async () => {
  const cpu = cpuSymbols("6809", cpu6809StateDescription);
  const source = generateInstructions("6809", { probe: defineInstruction({
    cpu: cpu.declaration, name: "probe", explanation: "Nested Boolean XOR probe.", steps: [
      readFlag("first", cpu.flag("n")), readFlag("second", cpu.flag("z")), readFlag("third", cpu.flag("c")),
      capture("result", shiftLeft(literal(16, 0), xor(not(flagValue("first")), xor(flagValue("second"), flagValue("third"))))),
      writeRegister(cpu.register("x"), value("result")),
    ],
  }) });
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
  const compiled: { instructions: { probe: (state: Cpu6809State) => void } } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  for (const n of [false, true]) for (const z of [false, true]) for (const c of [false, true]) {
    const state: Cpu6809State = { a: 0, b: 0, dp: 0, x: 0, y: 0, s: 0, u: 0, pc: 0, waitMode: "none", nmiArmed: false,
      flags: { e: false, f: false, h: false, i: false, n, z, v: false, c } };
    compiled.instructions.probe(state);
    assert.equal(state.x, (Number(!n) + Number(z) + Number(c)) % 2);
  }
});

// Expose generated-body statement order; ordinary CPU state remains plain owned data.
function observe<T extends object>(target: T, events: string[], prefix = ""): T {
  return new Proxy(target, {
    get(object, key, receiver) {
      const value: unknown = Reflect.get(object, key, receiver);
      if (typeof value === "number" || typeof value === "boolean") events.push(`read ${prefix}${String(key)}`);
      return value;
    },
    set(object, key, value: unknown) {
      events.push(`${prefix}${String(key)}=${Number(value)}`);
      return Reflect.set(object, key, value);
    },
  });
}

test("6809 unary bodies read once, apply only their declared flags in order, and omit TST writeback", () => {
  // Literal boundary cases; the CPU tests separately exhaust every byte and incoming CC value.
  for (const [name, original, result, updates] of [
    ["neg", 0x80, 0x80, [["n", true], ["z", false], ["v", true], ["c", true]]],
    ["neg", 0, 0, [["n", false], ["z", true], ["v", false], ["c", false]]],
    ["com", 0xaa, 0x55, [["n", false], ["z", false], ["v", false], ["c", true]]],
    ["inc", 0x7f, 0x80, [["n", true], ["z", false], ["v", true]]],
    ["inc", 0xff, 0, [["n", false], ["z", true], ["v", false]]],
    ["dec", 0x80, 0x7f, [["n", false], ["z", false], ["v", true]]],
    ["dec", 0, 0xff, [["n", true], ["z", false], ["v", false]]],
    ["tst", 0x80, 0x80, [["n", true], ["z", false], ["v", false]]],
    ["tst", 0, 0, [["n", false], ["z", true], ["v", false]]],
    ["clr", 0x80, 0, [["n", false], ["z", true], ["c", false], ["v", false]]],
    ["clr", 0, 0, [["n", false], ["z", true], ["c", false], ["v", false]]],
  ] as const) for (const target of ["A", "B", "Memory"] as const) for (const carry of [false, true]) {
    const events: string[] = [], beforeFlags = { e: true, f: true, h: true, i: true, n: true, z: true, v: true, c: carry };
    const state: Cpu6809State = { a: original, b: original, dp: 0, x: 0, y: 0, s: 0, u: 0, pc: 0, waitMode: "none", nmiArmed: false,
      flags: observe({ ...beforeFlags }, events, "flags.") };
    const observed = observe(state, events), register = target === "A" ? "a" : "b";
    let memory: number = original;
    if (target === "Memory") motorola[`${name}Memory`](observed, 0xffff, {
      readByte(address) { assert.equal(address, 0xffff); events.push("read memory"); return memory; },
      writeByte(address, byte) { assert.equal(address, 0xffff); events.push(`memory=${byte}`); memory = byte; },
    });
    else motorola[`${name}${target}`](observed);
    assert.deepEqual(events, [target === "Memory" ? "read memory" : `read ${register}`,
      ...updates.map(([flag, value]) => `flags.${flag}=${Number(value)}`),
      ...(name === "tst" ? [] : [`${target === "Memory" ? "memory" : register}=${result}`])]);
    assert.deepEqual(state.flags, { ...beforeFlags, ...Object.fromEntries(updates) });
    assert.equal(state.a, target === "A" ? result : original);
    assert.equal(state.b, target === "B" ? result : original);
    assert.equal(memory, target === "Memory" ? result : original);
  }
});

test("6800 unary bodies retain their flag order, clear TST carry, and never read a CLR destination", () => {
  const opcodes = {
    neg: [0x40, 0x50, 0x70], com: [0x43, 0x53, 0x73], lsr: [0x44, 0x54, 0x74],
    ror: [0x46, 0x56, 0x76], asr: [0x47, 0x57, 0x77], asl: [0x48, 0x58, 0x78],
    rol: [0x49, 0x59, 0x79], dec: [0x4a, 0x5a, 0x7a], inc: [0x4c, 0x5c, 0x7c],
    tst: [0x4d, 0x5d, 0x7d], clr: [0x4f, 0x5f, 0x7f],
  } as const;
  // Literal expectations include right-shift overflow and unchanged zero writes.
  for (const [name, original, result, updates] of [
    ["neg", 0x80, 0x80, [["n", true], ["z", false], ["v", true], ["c", true]]],
    ["com", 0xaa, 0x55, [["n", false], ["z", false], ["v", false], ["c", true]]],
    ["lsr", 1, 0, [["n", false], ["z", true], ["c", true], ["v", true]]],
    ["ror", 1, 0x80, [["n", true], ["z", false], ["c", true], ["v", false]]],
    ["asr", 0x80, 0xc0, [["n", true], ["z", false], ["c", false], ["v", true]]],
    ["asl", 0x40, 0x80, [["n", true], ["z", false], ["c", false], ["v", true]]],
    ["rol", 0x80, 1, [["n", false], ["z", false], ["c", true], ["v", true]]],
    ["inc", 0x7f, 0x80, [["n", true], ["z", false], ["v", true]]],
    ["dec", 0x80, 0x7f, [["n", false], ["z", false], ["v", true]]],
    ["tst", 0x80, 0x80, [["n", true], ["z", false], ["v", false], ["c", false]]],
    ["clr", 0, 0, [["n", false], ["z", true], ["c", false], ["v", false]]],
  ] as const) for (const target of ["A", "B", "Memory"] as const) {
    const events: string[] = [], beforeFlags = { h: true, i: true, n: false, z: true, v: false, c: true };
    const state: Cpu6800State = { a: original, b: original, x: 0, sp: 0, pc: 0, waiting: false,
      flags: observe({ ...beforeFlags }, events, "flags.") };
    const observed = observe(state, events), register = target === "A" ? "a" : "b";
    let memory: number = original;
    if (target === "Memory") motorola6800[opcodes[name][2]](observed, {
      fetchByte: () => 0xff,
      readByte(address) { assert.equal(address, 0xffff); events.push("read memory"); return memory; },
      writeByte(address, byte) { assert.equal(address, 0xffff); events.push(`memory=${byte}`); memory = byte; },
    });
    else motorola6800[opcodes[name][target === "A" ? 0 : 1]](observed);
    assert.deepEqual(events, [
      ...(name === "clr" ? [] : [target === "Memory" ? "read memory" : `read ${register}`]),
      ...(name === "ror" || name === "rol" ? ["read flags.c"] : []),
      ...updates.map(([flag, value]) => `flags.${flag}=${Number(value)}`),
      ...(name === "tst" ? [] : [`${target === "Memory" ? "memory" : register}=${result}`]),
    ]);
    assert.deepEqual(state.flags, { ...beforeFlags, ...Object.fromEntries(updates) });
    assert.equal(state.a, target === "A" ? result : original);
    assert.equal(state.b, target === "B" ? result : original);
    assert.equal(memory, target === "Memory" ? result : original);
  }
});

test("8080 rotates write A before CY and read incoming CY only for through-carry forms", () => {
  for (const [opcode, result, incoming] of [[0x07, 3, false], [0x0f, 0xc0, false], [0x17, 2, true], [0x1f, 0x40, true]] as const) {
    const events: string[] = [];
    const state: Cpu8080State = { a: 0x81, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, sp: 0, pc: 0,
      halted: false, interruptEnabled: false, interruptDeferred: false,
      flags: observe({ s: true, z: true, ac: true, p: true, cy: false }, events, "flags.") };
    intel[opcode](observe(state, events));
    assert.deepEqual(events, ["read a", ...(incoming ? ["read flags.cy"] : []), `a=${result}`, "flags.cy=1"]);
    assert.equal(state.a, result);
    assert.deepEqual(state.flags, { s: true, z: true, ac: true, p: true, cy: true });
  }
});

test("6809 register shifts apply only their declared flags before writing A or B", () => {
  for (const register of ["a", "b"] as const) for (const [a, b, result, incoming, left] of [
    [motorola.lsrA, motorola.lsrB, 0x40, false, false],
    [motorola.rorA, motorola.rorB, 0x40, true, false],
    [motorola.asrA, motorola.asrB, 0xc0, false, false],
    [motorola.aslA, motorola.aslB, 2, false, true],
    [motorola.rolA, motorola.rolB, 2, true, true],
  ] as const) {
    const events: string[] = [];
    const state: Cpu6809State = { a: 0x81, b: 0x81, dp: 0, x: 0, y: 0, s: 0, u: 0, pc: 0, waitMode: "none", nmiArmed: false,
      flags: observe({ e: true, f: true, h: true, i: true, n: true, z: true, v: true, c: false }, events, "flags.") };
    (register === "a" ? a : b)(observe(state, events));
    assert.deepEqual(events, [`read ${register}`, ...(incoming ? ["read flags.c"] : []),
      `flags.n=${Number(result >= 128)}`, "flags.z=0", "flags.c=1", ...(left ? ["flags.v=1"] : []), `${register}=${result}`]);
    assert.equal(state[register], result);
    assert.equal(state[register === "a" ? "b" : "a"], 0x81);
    assert.deepEqual(state.flags, { e: true, f: true, h: true, i: true, n: result >= 128, z: false, v: true, c: true });
  }
});

test("6809 memory shifts capture carry after the data read and keep the supplied address through flag updates and writeback", () => {
  for (const [execute, result, incoming, left, outgoing] of [
    [motorola.lsrMemory, 0x40, false, false, false], [motorola.rorMemory, 0xc0, true, false, false],
    [motorola.asrMemory, 0xc0, false, false, false], [motorola.aslMemory, 0, false, true, true],
    [motorola.rolMemory, 1, true, true, true],
  ] as const) {
    const events: string[] = [], flags = { e: true, f: true, h: true, i: true, n: true, z: false, v: false, c: false };
    const state: Cpu6809State = { a: 0, b: 0, dp: 0, x: 0xffff, y: 0, s: 0, u: 0, pc: 0, waitMode: "none", nmiArmed: false,
      flags: observe(flags, events, "flags.") };
    execute(state, state.x, {
      readByte(address) {
        assert.equal(address, 0xffff); events.push("read memory");
        flags.c = true; state.x = 0x1234; // Both change after the address is captured, before incoming carry is read.
        return 0x80;
      },
      writeByte(address, byte) { assert.equal(address, 0xffff); assert.equal(byte, result); events.push("write memory"); },
    });
    assert.deepEqual(events, ["read memory", ...(incoming ? ["read flags.c"] : []),
      `flags.n=${Number(result >= 128)}`, `flags.z=${Number(result === 0)}`, `flags.c=${Number(outgoing)}`,
      ...(left ? ["flags.v=1"] : []), "write memory"]);
    assert.deepEqual(flags, { e: true, f: true, h: true, i: true, n: result >= 128, z: result === 0, v: left, c: outgoing });
    assert.equal(state.x, 0x1234);
  }
});

test("6502 memory shifts read carry only for rotates, after the original write and before the result write", () => {
  for (const [opcode, original, result, outgoing, rotate] of [
    [0x06, 0x80, 0, true, false], [0x26, 0x80, 1, true, true],
    [0x46, 1, 0, true, false], [0x66, 1, 0x80, true, true],
  ] as const) {
    const state: Cpu6502State = { a: 0x22, x: 0, y: 0, pc: 0, sp: 0xff,
      flags: { n: false, z: false, v: true, d: true, i: true, c: false } };
    let carry = false, writes = 0;
    const events: string[] = [];
    Object.defineProperty(state.flags, "c", {
      get() { events.push("read C"); return carry; },
      set(next: boolean) { events.push(`C=${Number(next)}`); carry = next; },
    });
    instructions[opcode](state, {
      fetchByte() { events.push("fetch"); return 0x80; },
      readByte(address) { assert.equal(address, 0x80); events.push("read byte"); return original; },
      writeByte(address, byte) {
        assert.equal(address, 0x80);
        events.push(`write ${byte}`);
        assert.equal(state.flags.n, false); assert.equal(state.flags.z, false);
        if (++writes === 1) carry = true; // The incoming carry is observed AFTER this effect.
        else { assert.equal(carry, outgoing); assert.equal(byte, result); }
      },
    });
    assert.deepEqual(events, ["fetch", "read byte", `write ${original}`, ...(rotate ? ["read C"] : []), `C=${Number(outgoing)}`, `write ${result}`]);
    assert.equal(state.flags.n, result >= 128); assert.equal(state.flags.z, result === 0);
    assert.equal(state.a, 0x22);
  }
});
