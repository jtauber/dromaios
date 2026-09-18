import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions } from "../../../../src/components/cpus/generated/8008.js";
import { instructions8008 } from "../../../../src/components/cpus/semantics/definitions.js";
import type { Cpu8008StoredState } from "../../../../src/components/cpus/state/8008.js";
import type { ByteInstructionContext } from "../../../../src/components/cpus/instruction-context.js";

// Independent native load matrix: rows and columns are A/B/C/D/E/H/L/M; FF is HLT.
const operands = ["a", "b", "c", "d", "e", "h", "l", "m"] as const;
const rows = [
  [0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7],
  [0xc8, 0xc9, 0xca, 0xcb, 0xcc, 0xcd, 0xce, 0xcf],
  [0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7],
  [0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf],
  [0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7],
  [0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xee, 0xef],
  [0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7],
  [0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff],
];
const forms = [
  ...rows.flatMap((row, destination) => row.flatMap((opcode, source) => opcode === 0xff ? []
    : [{ opcode, destination: operands[destination]!, source: operands[source]! }])),
  ...[0x06, 0x0e, 0x16, 0x1e, 0x26, 0x2e, 0x36, 0x3e].map((opcode, destination) =>
    ({ opcode, destination: operands[destination]!, source: "immediate" as const })),
];
const transfers: Readonly<Record<number, (state: Cpu8008StoredState, context: ByteInstructionContext) => void>> = instructions;

test("8008 generated transfers cover the native 71 slots, excluding every HLT encoding", () => {
  const expected = forms.map(({ opcode }) => opcode).sort((a, b) => a - b);
  assert.equal(new Set(expected).size, 71);
  assert.deepEqual(Object.entries(instructions8008).filter(([, definition]) => definition.name.startsWith("L")).map(([key]) => Number(key)).sort((a, b) => a - b), expected);
});

test("8008 generated transfers capture full-byte sources, mask addresses at the access point, and never access flags or control state", () => {
  for (const { opcode, destination, source } of forms) for (const set of [false, true]) {
    for (const high of [0x3f, 0x7f, 0xbf, 0xff]) for (const value of [0, 0x42, 0xff]) {
      const accesses = Number(source === "immediate" || source === "m") + Number(destination === "m");
      for (let failAt = -1; failAt < accesses; failAt++) {
        const state: Cpu8008StoredState = { a: 0x81, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: high, l: 0xff,
          flags: { s: set, z: set, p: set, c: set }, addressStack: [0, 1, 2, 3, 4, 5, 6, 0x3fff], stackIndex: 7, halted: true };
        if (source !== "m" && source !== "immediate") state[source] = value;
        const before = structuredClone(state), events: string[] = [], expectedEvents: string[] = [];
        const failure = new Error("transfer failure"), sourceAddress = (state.h * 256 + state.l) % 16384;
        let attempts = 0, wrote = false, changed = false, sourceReads = 0;
        const change = () => { changed = true; state.h = Math.floor(high / 64) * 64 + 0x2b; state.l = 0xcd;
          state.flags = { s: !set, z: !set, p: !set, c: !set }; };
        const attempt = () => { if (attempts++ === failAt) throw failure; };
        const observed = new Proxy(state, {
          get(target, key, receiver) {
            assert.ok(["a", "b", "c", "d", "e", "h", "l"].includes(String(key)), "No flags, address-stack, selector, or STOPPED reads");
            events.push(`read ${String(key)}`); const contents = Reflect.get(target, key, receiver);
            if (destination === "m" && key === source && sourceReads++ === 0) change();
            return contents;
          },
          set(target, key, contents) {
            assert.equal(key, destination); assert.equal(contents, value); events.push(`write ${String(key)}`); wrote = true;
            return Reflect.set(target, key, contents);
          },
        });
        const run = () => transfers[opcode]!(observed, {
          fetchByte() { assert.equal(source, "immediate"); events.push("fetch"); attempt(); change(); return value; },
          readByte(address) { assert.equal(source, "m"); assert.equal(address, sourceAddress); events.push("read memory"); attempt(); change(); return value; },
          writeByte(address, contents) {
            assert.equal(destination, "m"); assert.equal(address, 0x2bcd); assert.equal(contents, value);
            events.push("write memory"); attempt(); wrote = true;
          },
        });
        if (failAt < 0) run(); else assert.throws(run, error => error === failure);
        if (source === "immediate") expectedEvents.push("fetch");
        else if (source === "m") expectedEvents.push("read h", "read l", "read memory");
        else expectedEvents.push(`read ${source}`);
        const failedSource = failAt === 0 && (source === "immediate" || source === "m");
        if (!failedSource) expectedEvents.push(...(destination === "m" ? ["read h", "read l", "write memory"] : [`write ${destination}`]));
        assert.deepEqual(events, expectedEvents, `opcode=${opcode}, failure=${failAt}`);
        assert.deepEqual(state, { ...before, ...(changed ? { h: Math.floor(high / 64) * 64 + 0x2b, l: 0xcd,
          flags: { s: !set, z: !set, p: !set, c: !set } } : {}), ...(wrote && destination !== "m" ? { [destination]: value } : {}) });
        assert.equal(attempts, failAt < 0 ? accesses : failAt + 1);
        assert.equal(wrote, failAt < 0);
      }
    }
  }
});
