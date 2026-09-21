import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions as mos } from "../../../../src/components/cpus/generated/6502.js";
import { instructions as m6800 } from "../../../../src/components/cpus/generated/6800.js";
import { bodies6809 as m6809 } from "../../../helpers/6809-bodies.js";
import { instructions as intel } from "../../../../src/components/cpus/generated/8080.js";
import { bodiesZ80 as zilog } from "../../../helpers/z80-bodies.js";
import type { ByteInstructionContext } from "../../../../src/components/cpus/instruction-context.js";
import { wordState } from "../../../helpers/intel-words.js";

function initialState(set: boolean) {
  return { ...wordState(set), pc: 0xffff, x: 0, y: 0, s: 0, u: 0, dp: 0, waiting: false, waitMode: "none" as const, nmiArmed: true,
    flags: { ...wordState(set).flags, n: set, v: set, z: set, c: set, i: set, d: set, e: set, f: set } };
}
type State = ReturnType<typeof initialState>;
interface Probe {
  readonly name: string;
  readonly execute: (state: State, instruction: ByteInstructionContext) => void;
  readonly bytes: readonly number[];
  readonly flags: readonly (keyof State["flags"])[];
  readonly taken: (set: boolean) => boolean;
  readonly relative?: boolean;
}
const names = ["bra", "brn", "bhi", "bls", "bcc", "bcs", "bne", "beq", "bvc", "bvs", "bpl", "bmi", "bge", "blt", "bgt", "ble"] as const;
const flagReads: readonly Probe["flags"][] = [[], [], ["c", "z"], ["c", "z"], ["c"], ["c"], ["z"], ["z"], ["v"], ["v"], ["n"], ["n"], ["n", "v"], ["n", "v"], ["n", "v", "z"], ["n", "v", "z"]];
const tests: readonly ((set: boolean) => boolean)[] = [() => true, () => false, s => !s, s => s, s => !s, s => s, s => !s, s => s, s => !s, s => s, s => !s, s => s, () => true, () => false, s => !s, s => s];
const branches6800 = [m6800[0x20], undefined, m6800[0x22], m6800[0x23], m6800[0x24], m6800[0x25], m6800[0x26], m6800[0x27], m6800[0x28], m6800[0x29], m6800[0x2a], m6800[0x2b], m6800[0x2c], m6800[0x2d], m6800[0x2e], m6800[0x2f]] as const;
const probes: Probe[] = [
  ...([0x10, 0x30, 0x50, 0x70, 0x90, 0xb0, 0xd0, 0xf0] as const).map((opcode, i): Probe => ({ name: `6502 ${opcode}`, execute: mos[opcode], bytes: [0xfe],
    flags: [(["n", "v", "c", "z"] as const)[Math.floor(i / 2)]!], taken: set => set === Boolean(i % 2), relative: true })),
  ...names.flatMap((name, i): Probe[] => [
    ...(name === "brn" ? [] : [{ name: `6800 ${name}`, execute: branches6800[i]!, bytes: [0xfe], flags: flagReads[i]!, taken: tests[i]!, relative: true }]),
    { name: `6809 ${name}`, execute: m6809[name], bytes: [0xfe], flags: flagReads[i]!, taken: tests[i]!, relative: true },
    { name: `6809 l${name}`, execute: m6809[`l${name}`], bytes: [0xff, 0xfe], flags: flagReads[i]!, taken: tests[i]!, relative: true },
  ]),
  ...([0xc2, 0xca, 0xd2, 0xda, 0xe2, 0xea, 0xf2, 0xfa] as const).flatMap((opcode, i): Probe[] => [
    { name: `8080 ${opcode}`, execute: intel[opcode], bytes: [0x34, 0x12], flags: [(["z", "cy", "p", "s"] as const)[Math.floor(i / 2)]!], taken: set => set === Boolean(i % 2) },
    { name: `Z80 ${opcode}`, execute: zilog[opcode], bytes: [0x34, 0x12], flags: [(["z", "c", "pv", "s"] as const)[Math.floor(i / 2)]!], taken: set => set === Boolean(i % 2) },
  ]),
  ...(["jrNZ", "jrZ", "jrNC", "jrC"] as const).map((name, i): Probe => ({ name, execute: zilog[name], bytes: [0xfe],
    flags: [i < 2 ? "z" : "c"], taken: set => set === Boolean(i % 2), relative: true })),
];

test("generated branches fetch before live condition reads and touch PC only on the taken path", () => {
  const failure = new Error("operand fetch failed");
  for (const probe of probes) for (const set of [false, true]) for (let failAt = -1; failAt < probe.bytes.length; failAt++) {
    const state = initialState(!set), events: string[] = [];
    const observed = new Proxy(state, {
      get(target, key, receiver) {
        assert.ok(key === "pc" || key === "flags", `unexpected state access ${String(key)}`);
        if (key === "pc") events.push("read PC"); return Reflect.get(target, key, receiver);
      },
      set(target, key, byte) { assert.equal(key, "pc"); events.push("write PC"); return Reflect.set(target, key, byte); },
    });
    let fetched = 0;
    const run = () => probe.execute(observed, {
      fetchByte() {
        events.push(`fetch ${fetched}`); if (fetched === failAt) throw failure;
        const byte = probe.bytes[fetched++]!;
        state.pc = 1; // Prove the body uses post-fetch PC, not the entry value.
        state.flags = new Proxy(initialState(set).flags, {
          get(target, key, receiver) { events.push(`flag ${String(key)}`); return Reflect.get(target, key, receiver); },
          set() { assert.fail("branches must preserve flags"); },
        });
        return byte;
      },
      readByte() { assert.fail("no destination read"); }, writeByte() { assert.fail("no write"); },
    });
    if (failAt < 0) run(); else assert.throws(run, error => error === failure);
    const taken = failAt < 0 && probe.taken(set);
    assert.equal(state.pc, taken ? probe.relative ? 0xffff : 0x1234 : fetched ? 1 : 0xffff, probe.name);
    assert.deepEqual(events, [
      ...probe.bytes.slice(0, failAt < 0 ? probe.bytes.length : failAt + 1).map((_, i) => `fetch ${i}`),
      ...(failAt < 0 ? probe.flags.map(flag => `flag ${flag}`) : []),
      ...(taken ? [...(probe.relative ? ["read PC"] : []), "write PC"] : []),
    ], probe.name);
  }
});

test("DJNZ fetches before decrementing, reads the resulting B, and never accesses flags", () => {
  for (const b of [0, 1, 2, 0xff]) for (const fail of [false, true]) {
    const state = { ...initialState(false), b }, before = structuredClone(state), events: string[] = [], failure = new Error("fetch failed");
    const observed = new Proxy(state, {
      get(target, key, receiver) { assert.ok(key === "b" || key === "pc"); events.push(`read ${String(key)}`); return Reflect.get(target, key, receiver); },
      set(target, key, byte) { assert.ok(key === "b" || key === "pc"); events.push(`write ${String(key)}`); return Reflect.set(target, key, byte); },
    });
    const run = () => zilog.djnz(observed, { fetchByte() { events.push("fetch"); if (fail) throw failure; return 0x80; } });
    if (fail) assert.throws(run, error => error === failure); else run();
    assert.deepEqual(events, fail ? ["fetch"] : ["fetch", "read b", "write b", "read b", ...(b !== 1 ? ["read pc", "write pc"] : [])]);
    assert.deepEqual(state, fail ? before : { ...before, b: (b + 255) % 256, pc: b === 1 ? before.pc : 0xff7f });
  }
});
