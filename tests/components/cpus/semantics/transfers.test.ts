import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions as m6800 } from "../../../../src/components/cpus/generated/6800.js";
import { instructions as m6809 } from "../../../../src/components/cpus/generated/6809.js";
import type { Cpu6800State } from "../../../../src/components/cpus/state/6800.js";
import type { Cpu6809State } from "../../../../src/components/cpus/state/6809.js";

type ByteTransfers<State> = Record<`ld${"a" | "b"}Immediate`, (state: State, instruction: { fetchByte(): number }) => void>
  & Record<`ld${"a" | "b"}Memory`, (state: State, address: number, instruction: { readByte(address: number): number }) => void>
  & Record<`st${"a" | "b"}Memory`, (state: State, address: number, instruction: { writeByte(address: number, value: number): void }) => void>;

const state6800 = (): Cpu6800State => ({ a: 0x55, b: 0xaa, x: 0, sp: 0, pc: 0, waiting: false,
  flags: { h: true, i: true, n: true, z: true, v: true, c: true } });
const state6809 = (): Cpu6809State => ({ a: 0x55, b: 0xaa, x: 0, y: 0, s: 0, u: 0, dp: 0, pc: 0, waitMode: "none", nmiArmed: false,
  flags: { e: true, f: true, h: true, i: true, n: true, z: true, v: true, c: true } });

// Fail if a body reads incoming flags; log every update, including updates to a replacement flag object.
function observeFlags<Flags extends object>(flags: Flags, events: string[]): Flags {
  return new Proxy(flags, {
    get() { assert.fail("Transfers must not read incoming flags"); },
    set(target, key, value) { events.push(`flag ${String(key)}`); return Reflect.set(target, key, value); },
  });
}

test("Motorola byte transfers capture once, perform the access before flags, and update the current flag object", () => {
  function check<State extends Cpu6800State | Cpu6809State>(create: () => State, bodies: ByteTransfers<State>): void {
    for (const register of ["a", "b"] as const) for (const mode of ["immediate", "memory", "store"] as const) {
      for (const byte of [0, 1, 0x7f, 0x80, 0xff]) for (const incoming of [false, true]) for (const fail of [false, true]) {
        const state = create(), events: string[] = [], failure = new Error("transfer access failed");
        state[register] = byte;
        for (const key of Object.keys(state.flags)) Reflect.set(state.flags, key, incoming);
        const before = structuredClone(state), oldFlags = state.flags, flags = { ...state.flags };
        const observed = new Proxy(state, {
          get(target, key, receiver) {
            if (key === "a" || key === "b") events.push(`read ${String(key)}`);
            return Reflect.get(target, key, receiver);
          },
          set(target, key, value) {
            assert.equal(key, register); events.push(`write ${register}`);
            return Reflect.set(target, key, value);
          },
        });
        const access = (): number => {
          events.push(mode === "store" ? "memory write" : "operand read");
          if (fail) throw failure;
          state[register] = 255 - byte; // Stores must set flags from their captured byte, not re-read the register.
          state.flags = observeFlags(flags, events);
          return byte;
        };
        const run = () => {
          if (mode === "immediate") bodies[`ld${register}Immediate`](observed, { fetchByte: access });
          else if (mode === "memory") bodies[`ld${register}Memory`](observed, 0xffff, {
            readByte(address) { assert.equal(address, 0xffff); return access(); },
          });
          else bodies[`st${register}Memory`](observed, 0xffff, {
            writeByte(address, value) { assert.equal(address, 0xffff); assert.equal(value, byte); access(); },
          });
        };
        if (fail) {
          assert.throws(run, error => error === failure);
          assert.deepEqual(state, before);
        } else {
          run();
          assert.deepEqual({ ...state, flags }, { ...before, [register]: mode === "store" ? 255 - byte : byte,
            flags: { ...before.flags, n: byte >= 128, z: byte === 0, v: false } });
        }
        assert.deepEqual(oldFlags, before.flags);
        assert.deepEqual(events, [
          ...(mode === "store" ? [`read ${register}`, "memory write"] : ["operand read"]),
          ...(fail ? [] : [...(mode === "store" ? [] : [`write ${register}`]), "flag n", "flag z", "flag v"]),
        ]);
      }
    }
  }
  check(state6800, m6800);
  check(state6809, m6809);
});

test("6800 TAB/TBA capture the source once, write the destination, then set flags without memory", () => {
  for (const [body, source, destination] of [[m6800.tab, "a", "b"], [m6800.tba, "b", "a"]] as const) {
    const state = state6800(), before = structuredClone(state), events: string[] = [], flags = { ...state.flags };
    const observed = new Proxy(state, {
      get(target, key, receiver) {
        if (key === "a" || key === "b") events.push(`read ${String(key)}`);
        return Reflect.get(target, key, receiver);
      },
      set(target, key, value) {
        assert.equal(key, destination); events.push(`write ${destination}`);
        state.flags = observeFlags(flags, events);
        return Reflect.set(target, key, value);
      },
    });
    body(observed);
    assert.deepEqual({ ...state, flags }, { ...before, [destination]: before[source],
      flags: { ...before.flags, n: before[source] >= 128, z: false, v: false } });
    assert.deepEqual(events, [`read ${source}`, `write ${destination}`, "flag n", "flag z", "flag v"]);
  }
});

interface WordTransfer<State> {
  readonly name: string;
  readonly fields: readonly (keyof State & string)[];
  readonly arm?: boolean;
  immediate(state: State, instruction: { fetchByte(): number }): void;
  memory(state: State, address: number, instruction: { readByte(address: number): number }): void;
  store(state: State, address: number, instruction: { writeByte(address: number, value: number): void }): void;
}

test("Motorola word transfers capture once, wrap high-first accesses, and delay registers, latches, and flags until complete", () => {
  function check<State extends Cpu6800State | Cpu6809State>(create: () => State, registers: readonly WordTransfer<State>[]): void {
    for (const { name, fields, arm = false, ...body } of registers) for (const mode of ["immediate", "memory", "store"] as const) {
      for (const word of [0, 1, 0xff, 0x100, 0x7fff, 0x8000, 0xffff]) for (const incoming of [false, true]) for (const failAt of [-1, 0, 1]) {
        const state = create(), events: string[] = [], failure = new Error("word transfer failed");
        const bytes = [Math.floor(word / 256), word % 256], parts = fields.length === 2 ? bytes : [word];
        fields.forEach((field, i) => Reflect.set(state, field, mode === "store" ? parts[i]! : 0x55));
        for (const key of Object.keys(state.flags)) Reflect.set(state.flags, key, incoming);
        const before = structuredClone(state), oldFlags = state.flags, flags = { ...state.flags };
        const observed = new Proxy(state, {
          get(target, key, receiver) {
            if (["a", "b", "x", "y", "u", "s", "sp", "nmiArmed"].includes(String(key))) events.push(`read ${String(key)}`);
            return Reflect.get(target, key, receiver);
          },
          set(target, key, value) { events.push(`write ${String(key)}=${value}`); return Reflect.set(target, key, value); },
        });
        let attempts = 0;
        const access = (address?: number, byte?: number): number => {
          const i = attempts++;
          if (mode !== "immediate") assert.equal(address, i === 0 ? 0xffff : 0);
          if (mode === "store") assert.equal(byte, bytes[i], "Both writes must use the captured word");
          events.push(`access ${i}`);
          if (i === failAt) throw failure;
          state.flags = observeFlags(flags, events);
          if (mode === "store") fields.forEach(field => Reflect.set(state, field, 0x33));
          return bytes[i]!;
        };
        const run = () => {
          if (mode === "immediate") body.immediate(observed, { fetchByte: () => access() });
          else if (mode === "memory") body.memory(observed, 0xffff, { readByte: access });
          else body.store(observed, 0xffff, { writeByte: access });
        };
        if (failAt >= 0) assert.throws(run, error => error === failure);
        else run();
        const expected = structuredClone(before);
        if (mode === "store" && failAt !== 0) fields.forEach(field => Reflect.set(expected, field, 0x33));
        if (failAt < 0) {
          if (mode !== "store") {
            fields.forEach((field, i) => Reflect.set(expected, field, parts[i]!));
            if (arm) Reflect.set(expected, "nmiArmed", true);
          }
          Object.assign(expected.flags, { n: word >= 32768, z: word === 0, v: false });
        }
        assert.deepEqual({ ...state, flags: failAt === 0 ? oldFlags : flags }, expected, `${name}, ${mode}, ${word}, fail=${failAt}`);
        assert.deepEqual(oldFlags, before.flags);
        assert.deepEqual(events, [
          ...(mode === "store" ? fields.map(field => `read ${field}`) : []),
          "access 0", ...(failAt === 0 ? [] : ["access 1"]),
          ...(failAt >= 0 ? [] : [
            ...(mode === "store" ? [] : [...fields.map((field, i) => `write ${field}=${parts[i]}`), ...(arm ? ["write nmiArmed=true"] : [])]),
            "flag n", "flag z", "flag v",
          ]),
        ]);
      }
    }
  }
  check(state6800, ([{ name: "s", fields: ["sp"] }, { name: "x", fields: ["x"] }] as const).map(form => ({ ...form,
    immediate: m6800[`ld${form.name}Immediate`], memory: m6800[`ld${form.name}Memory`], store: m6800[`st${form.name}Memory`],
  })));
  check(state6809, ([{ name: "d", fields: ["a", "b"] }, { name: "x", fields: ["x"] },
    { name: "y", fields: ["y"] }, { name: "u", fields: ["u"] }, { name: "s", fields: ["s"], arm: true }] as const).map(form => ({ ...form,
    immediate: m6809[`ld${form.name}Immediate`], memory: m6809[`ld${form.name}Memory`], store: m6809[`st${form.name}Memory`],
  })));
});
