import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions } from "../../../../src/components/cpus/generated/6809.js";
import type { ByteInstructionContext } from "../../../../src/components/cpus/instruction-context.js";
import type { Cpu6809State } from "../../../../src/components/cpus/state/6809.js";
import { cpu6809StateDescription } from "../../../../src/components/cpus/state/6809.js";
import { cpuSymbols, literal } from "../../../../src/components/cpus/semantics/model.js";
import { registerView } from "../../../../src/components/cpus/semantics/builders.js";
import { byteStack, maskedStack } from "../../../../src/components/cpus/semantics/stack.js";

const flagNames = ["e", "f", "h", "i", "n", "z", "v", "c"] as const;
const flags = (byte: number) => Object.fromEntries(flagNames.map((name, bit) => [name, Boolean(byte & (128 >> bit))])) as Cpu6809State["flags"];
function state(): Cpu6809State {
  return { a: 0x12, b: 0x34, dp: 0x56, x: 0x789a, y: 0xbcde, s: 0, u: 0xffff, pc: 0x2468,
    flags: flags(0xaa), waitMode: "none", nmiArmed: false };
}
interface Probe {
  readonly name: string;
  readonly pointer: "s" | "u";
  readonly pull: boolean;
  readonly frame?: boolean;
  readonly execute: (state: Cpu6809State, mask: number, context: ByteInstructionContext) => void;
}
const probes: readonly Probe[] = [
  { name: "PSHS", pointer: "s", pull: false, execute: (s, _m, c) => instructions.pshs(s, c) },
  { name: "PULS", pointer: "s", pull: true, execute: (s, _m, c) => instructions.puls(s, c) },
  { name: "PSHU", pointer: "u", pull: false, execute: (s, _m, c) => instructions.pshu(s, c) },
  { name: "PULU", pointer: "u", pull: true, execute: (s, _m, c) => instructions.pulu(s, c) },
  { name: "frame push", pointer: "s", pull: false, frame: true, execute: (s, m, c) => instructions.pushFrame(s, m, c) },
];

test("masked stacks preserve byte ordering, completed register transfers, and arming at every access failure for every mask", () => {
  for (const probe of probes) for (let mask = 0; mask < 256; mask++) {
    // Independently specified low-address-first bytes, with distinct incoming values for each register.
    const registers = [
      { field: "flags", pushed: [0xaa], pulled: [0x55] }, { field: "a", pushed: [0x12], pulled: [0x91] },
      { field: "b", pushed: [0x34], pulled: [0x92] }, { field: "dp", pushed: [0x56], pulled: [0x93] },
      { field: "x", pushed: [0x78, 0x9a], pulled: [0x94, 0x95] }, { field: "y", pushed: [0xbc, 0xde], pulled: [0x96, 0x97] },
      { field: probe.pointer === "s" ? "u" : "s", pushed: probe.pointer === "s" ? [0xff, 0xff] : [0, 0], pulled: [0x98, 0x99] },
      { field: "pc", pushed: [0x24, 0x68], pulled: [0x9a, 0x9b] },
    ] as const;
    const selected = registers.filter((_, bit) => Boolean(mask & (1 << bit)));
    const fetches = probe.frame ? 0 : 1;
    const total = fetches + selected.reduce((count, register) => count + register.pushed.length, 0);
    for (let failAt = -1; failAt < total; failAt++) {
      const actual = state(), expected = state(), events: unknown[][] = [], expectedEvents: unknown[][] = [];
      const originalFlags = actual.flags, failure = new Error("masked stack access failure");
      let attempt = 0;
      if (!probe.frame) expectedEvents.push(["fetch"]);
      if (failAt !== 0 || probe.frame) {
        let index = fetches;
        outer: for (const register of probe.pull ? selected : [...selected].reverse()) {
          const bytes = probe.pull ? register.pulled : [...register.pushed].reverse();
          for (const byte of bytes) {
            if (!probe.pull) expected[probe.pointer] = (expected[probe.pointer] + 65535) % 65536;
            expectedEvents.push([probe.pull ? "read" : "write", expected[probe.pointer], byte]);
            if (index++ === failAt) break outer;
            if (probe.pull) expected[probe.pointer] = (expected[probe.pointer] + 1) % 65536;
          }
          if (probe.pull) {
            if (register.field === "flags") expected.flags = flags(register.pulled[0]);
            else expected[register.field] = register.pulled.reduce<number>((word, byte) => word * 256 + byte, 0);
            if (register.field === "s") expected.nmiArmed = true;
          }
        }
        if (failAt < 0 && !probe.frame && probe.pointer === "s" && mask) expected.nmiArmed = true;
      }
      const access = (event: unknown[]) => { events.push(event); if (attempt++ === failAt) throw failure; };
      const execute = () => probe.execute(actual, mask, {
        fetchByte() { access(["fetch"]); return mask; },
        readByte(address) {
          const byte = expectedEvents[attempt]![2] as number;
          access(["read", address, byte]); return byte;
        },
        writeByte(address, byte) { access(["write", address, byte]); },
      });
      if (failAt < 0) execute(); else assert.throws(execute, error => error === failure);
      const label = `${probe.name} mask=${mask} failure=${failAt}`;
      assert.deepEqual(events, expectedEvents, label); assert.deepEqual(actual, expected, label);
      assert.equal(actual.flags === originalFlags, !probe.pull || !(mask & 1) || (failAt >= 0 && failAt <= fetches), label);
    }
  }
});

test("mask pushes capture each register at its own turn and retain a whole word across callbacks", () => {
  const actual = state(), writes: number[][] = [];
  instructions.pshs(actual, { fetchByte: () => 0x91, writeByte(address, byte) {
    writes.push([address, byte]);
    if (writes.length === 1) { actual.pc = 0x9999; actual.x = 0xabcd; actual.s = 0x1000; }
    if (writes.length === 3) { actual.x = 0x1111; actual.flags = flags(0x55); }
  } });
  assert.deepEqual(writes, [[0xffff, 0x68], [0x0fff, 0x24], [0x0ffe, 0xcd], [0x0ffd, 0xab], [0x0ffc, 0x55]]);
  assert.equal(actual.s, 0x0ffc); assert.equal(actual.nmiArmed, true);
});

test("mask pulls reread the live pointer after callbacks and commit a word only after both reads", () => {
  const actual = state(), addresses: number[] = [];
  instructions.pulu(actual, { fetchByte: () => 0xc0, readByte(address) {
    addresses.push(address);
    if (addresses.length <= 2) { assert.equal(actual.s, 0); actual.u = addresses.length === 1 ? 0xffff : 0x1000; }
    else { assert.equal(actual.s, 0x1234); assert.equal(actual.nmiArmed, true); assert.equal(actual.pc, 0x2468); }
    return [0x12, 0x34, 0x56, 0x78][addresses.length - 1]!;
  } });
  assert.deepEqual(addresses, [0xffff, 0, 0x1001, 0x1002]);
  assert.equal(actual.u, 0x1003); assert.equal(actual.pc, 0x5678);
});

test("empty masks do not inspect state, and mask construction rejects unsupported register layouts", () => {
  for (const probe of probes) {
    const observed = new Proxy(state(), { get() { assert.fail("empty mask must not read state"); }, set() { assert.fail("empty mask must not write state"); } });
    let fetched = 0;
    probe.execute(observed, 0, { fetchByte() { fetched++; return 0; }, readByte() { assert.fail(); }, writeByte() { assert.fail(); } });
    assert.equal(fetched, probe.frame ? 0 : 1);
  }
  const cpu = cpuSymbols("6809", cpu6809StateDescription), byte = registerView(cpu.register("a")), stack = byteStack(cpu.register("s"), "occupied");
  assert.throws(() => maskedStack(Array.from({ length: 9 }, () => byte), stack, "big-endian", literal(8, 0), false), /at most eight/);
  assert.throws(() => maskedStack([{ ...byte, source: { ...byte.source, width: 14 } }], stack, "big-endian", literal(8, 0), false), /byte or word/);
});
