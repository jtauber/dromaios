import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceReaders } from "../../../../src/components/cpus/generated/68000-state.js";
import { registerUpdates } from "../../../../src/components/cpus/register-updates.js";
import type { Cpu68000State } from "../../../../src/components/cpus/semantics/generated/state/68000.js";
import { initialState } from "../../../helpers/68000-state.js";

const addressRegisters = ["a0", "a1", "a2", "a3", "a4", "a5", "a6"] as const;
const dataRegisters = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"] as const;
type AddressRegister = typeof addressRegisters[number] | "usp" | "ssp";
type Request = readonly [size: 8 | 16 | 32, mode: number, code: number];
const wrap = (value: number): number => (value % 4294967296 + 4294967296) % 4294967296;
const signed = (value: number, width: number): number => value < 2 ** (width - 1) ? value : value - 2 ** width;

// Independent imperative oracle: arithmetic field extraction and named-register pending values.
function reference(state: Cpu68000State, fetchWord: () => number, nextAddress: () => number) {
  const pending = new Map<AddressRegister, number>();
  const bank = (code: number): AddressRegister => code === 7 ? state.flags.s ? "ssp" : "usp" : addressRegisters[code]!;
  const read = (name: AddressRegister) => pending.has(name) ? pending.get(name)! : state[name];
  const index = (extension: number): number => {
    const code = Math.floor(extension / 4096) % 8, name = bank(code);
    const value = extension >= 32768 ? read(name) : state[dataRegisters[code]!];
    return (Math.floor(extension / 2048) % 2 ? value : signed(value % 65536, 16)) + signed(extension % 256, 8);
  };
  return {
    resolve(size: number, mode: number, code: number): number | "unsupported" {
      const name = bank(code), base = read(name), step = size === 8 && code === 7 ? 2 : size / 8;
      if (mode === 2) return base;
      if (mode === 3) { pending.set(name, wrap(base + step)); return base; }
      if (mode === 4) { const address = wrap(base - step); pending.set(name, address); return address; }
      if (mode === 5) return wrap(base + signed(fetchWord(), 16));
      if (mode === 6) return wrap(base + index(fetchWord()));
      if (mode !== 7) return "unsupported";
      if (code === 0) return wrap(signed(fetchWord(), 16));
      if (code === 1) { const high = fetchWord(); return high * 65536 + fetchWord(); }
      if (code === 2) { const base = nextAddress(); return wrap(base + signed(fetchWord(), 16)); }
      if (code === 3) { const base = nextAddress(); return wrap(base + index(fetchWord())); }
      return "unsupported";
    },
    commit() { for (const [name, value] of pending) state[name] = value; },
  };
}

function observe(requests: readonly Request[], generated: boolean, supervisor: boolean, failAt = -1, mutate = false) {
  const raw = initialState(supervisor ? 64 : 0), events: unknown[][] = [], results: unknown[] = [], failure = Error("failed effect");
  raw.flags.s = supervisor; raw.a0 = 0xfffffffe; raw.a1 = 0x2000; raw.usp = 0x1000; raw.ssp = 0x8000;
  let cursor = 0xfffffffe, count = 0, word = 0;
  const record = (...event: unknown[]) => { events.push(event); if (count++ === failAt) throw failure; };
  const flags = new Proxy(raw.flags, { get(target, name: keyof Cpu68000State["flags"]) {
    const value = target[name]; record("flag", name, value); return value;
  } });
  const state = new Proxy(raw, {
    get(target, name: keyof Cpu68000State) {
      if (name === "flags") return flags;
      const value = target[name]; record("read", name, value); return value;
    },
    set(target, name: AddressRegister, value: number) { record("write", name, value); target[name] = value; return true; },
  });
  const context = {
    fetchWord() {
      record("fetch", cursor); cursor = wrap(cursor + 2);
      if (mutate) { raw.flags.s = !raw.flags.s; raw.a0 = 0x9000; raw.d0 = 0xffff8000; raw.usp = 0x6000; raw.ssp = 0x7000; }
      return [0x87ff, 0xffff, 0x8000, 0x7001][word++ % 4]!;
    },
    nextAddress() { record("cursor", cursor); return cursor; },
  };
  const updates = registerUpdates(), decode = sourceReaders(state).sources.effectiveAddress, oracle = reference(state, context.fetchWord, context.nextAddress);
  let threw = false;
  try {
    for (const [size, mode, code] of requests) results.push(generated ? decode(size, mode, code, { ...context, ...updates }) : oracle.resolve(size, mode, code));
    results.push(structuredClone(raw));
    if (generated) updates.commit(); else oracle.commit();
    // The established boundary retains pending values after commit; later reads still see them.
    raw.a0 = 0x1234;
    results.push(generated ? decode(32, 2, 0, { ...context, ...updates }) : oracle.resolve(32, 2, 0));
    if (generated) updates.commit(); else oracle.commit();
  } catch (error) { assert.equal(error, failure); threw = true; }
  return { events, results, state: raw, threw };
}

test("every 68000 address mode preserves ordered reads, live callbacks, deferred updates, and every failed effect", () => {
  const sequences: Request[][] = [
    [[8, 3, 7], [32, 4, 7], [16, 3, 0], [16, 4, 0]],
    [[16, 3, 0], [32, 6, 0]], [[32, 3, 7], [8, 5, 7], [8, 3, 7]],
  ];
  for (const size of [8, 16, 32] as const) for (let mode = 0; mode < 8; mode++) for (let code = 0; code < 8; code++) {
    sequences.push([[size, mode, code]]);
  }
  for (const requests of sequences) for (const supervisor of [false, true]) for (const mutate of [false, true]) {
    const expected = observe(requests, false, supervisor, -1, mutate);
    assert.deepEqual(observe(requests, true, supervisor, -1, mutate), expected, JSON.stringify({ requests, supervisor, mutate }));
    for (let failAt = 0; failAt < expected.events.length; failAt++) {
      assert.deepEqual(observe(requests, true, supervisor, failAt, mutate), observe(requests, false, supervisor, failAt, mutate),
        JSON.stringify({ requests, supervisor, mutate, failAt }));
    }
  }
});

test("all 65,536 brief extensions preserve ignored bits, signed word/byte offsets, live long indices, and pending A7", () => {
  for (const supervisor of [false, true]) {
    const state = initialState(0); state.flags.s = supervisor; state.usp = 0xfffffff0; state.ssp = 0x7ffffffe;
    for (let code = 0; code < 8; code++) state[dataRegisters[code]!] = wrap(0x12348000 + code * 0x11111111);
    for (let code = 0; code < 7; code++) state[addressRegisters[code]!] = wrap(0x87658000 + code * 0x11111111);
    const active: AddressRegister = supervisor ? "ssp" : "usp", base = wrap(state[active] + 2), updates = registerUpdates();
    let extension = 0, fetches = 0;
    const context = { ...updates, fetchWord: () => { fetches++; return extension; }, nextAddress: () => 0xfffffffe };
    const resolve = sourceReaders(state).sources.effectiveAddress;
    assert.equal(resolve(8, 3, 7, context), state[active]);
    for (extension = 0; extension < 65536; extension++) {
      const code = Math.floor(extension / 4096) % 8;
      const original = extension >= 32768 ? code === 7 ? base : state[addressRegisters[code]!] : state[dataRegisters[code]!];
      const index = Math.floor(extension / 2048) % 2 ? original : signed(original % 65536, 16);
      const offset = index + signed(extension % 256, 8);
      assert.equal(resolve(32, 6, 7, context), wrap(base + offset), `An ${extension}`);
      assert.equal(resolve(32, 7, 3, context), wrap(0xfffffffe + offset), `PC ${extension}`);
    }
    assert.equal(fetches, 131072);
    assert.equal(state[active], supervisor ? 0x7ffffffe : 0xfffffff0);
  }
});
