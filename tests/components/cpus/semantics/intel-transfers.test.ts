import assert from "node:assert/strict";
import { test } from "node:test";
import { instructions as intel } from "../../../../src/components/cpus/generated/8080.js";
import { instructions as zilog } from "../../../../src/components/cpus/generated/z80.js";
import { instructions8080, instructionsZ80 } from "../../../../src/components/cpus/semantics/definitions.js";
import type { ByteInstructionContext } from "../../../../src/components/cpus/instruction-context.js";
import { initialState, flagPattern, transferColumns, transferRows } from "../z80/helpers.js";

const immediateOpcodes = [0x06, 0x0e, 0x16, 0x1e, 0x26, 0x2e, 0x36, 0x3e];
const forms = [
  ...transferRows.flatMap(({ destination, opcodes }) => opcodes.flatMap((opcode, column) => opcode === 0x76 ? []
    : [{ opcode, destination, source: transferColumns[column]! }])),
  ...immediateOpcodes.map((opcode, column) => ({ opcode, destination: transferColumns[column]!, source: "immediate" as const })),
];
function stateWithFlags(set: boolean) {
  return { ...initialState(), interruptEnabled: true, flags: { ...flagPattern(set ? 63 : 0), cy: set, ac: set, p: set } };
}
type State = ReturnType<typeof stateWithFlags>;
const cpus: readonly { name: string; instructions: Readonly<Record<number, (state: State, context: ByteInstructionContext) => void>> }[] = [
  { name: "8080", instructions: intel }, { name: "Z80", instructions: zilog },
];

test("8080/Z80 numeric definitions cover 84 transfer, twelve word-arithmetic, two exchange, and ten jump slots, excluding HALT", () => {
  const expected = [...forms.map(({ opcode }) => opcode), 0x01, 0x11, 0x21, 0x31, 0x22, 0x2a, 0xf9,
    0xc2, 0xca, 0xd2, 0xda, 0xe2, 0xea, 0xf2, 0xfa, 0xc3, 0xe9,
    0x02, 0x0a, 0x12, 0x1a, 0x32, 0x3a, 0xe3, 0xeb,
    0x03, 0x0b, 0x09, 0x13, 0x1b, 0x19, 0x23, 0x2b, 0x29, 0x33, 0x3b, 0x39].sort((a, b) => a - b);
  assert.equal(new Set(expected).size, 108);
  for (const definitions of [instructions8080, instructionsZ80]) {
    assert.deepEqual(Object.keys(definitions).filter(key => /^\d+$/.test(key)).map(Number).sort((a, b) => a - b), expected);
  }
});

for (const { name, instructions } of cpus) {
  test(`${name} generated transfers capture sources, use HL at the access point, and never access flags or unrelated state`, () => {
    for (const { opcode, destination, source } of forms) for (const set of [false, true]) for (const value of [0, 0x42, 0xff]) {
      const accesses = Number(source === "immediate" || source === "(hl)") + Number(destination === "(hl)");
      for (let failAt = -1; failAt < accesses; failAt++) {
        const state = stateWithFlags(set); state.h = 0x12; state.l = 0x34;
        if (source !== "(hl)" && source !== "immediate") state[source] = value;
        const before = structuredClone(state), events: string[] = [], expectedEvents: string[] = [];
        const failure = new Error("transfer access failure"), sourceAddress = state.h * 256 + state.l;
        let attempts = 0, wrote = false, changed = false, sourceReads = 0;
        const change = () => { changed = true; state.h = 0xab; state.l = 0xcd; state.flags = stateWithFlags(!set).flags; };
        const attempt = () => { if (attempts++ === failAt) throw failure; };
        const observed = new Proxy(state, {
          get(target, key, receiver) {
            assert.ok(["a", "b", "c", "d", "e", "h", "l"].includes(String(key)), "No flag, alternate-bank, or control-state reads");
            events.push(`read ${String(key)}`); const contents = Reflect.get(target, key, receiver);
            // A store captures H/L as a source before reading H/L again for its address.
            if (destination === "(hl)" && key === source && sourceReads++ === 0) change();
            return contents;
          },
          set(target, key, contents) {
            assert.equal(key, destination); assert.equal(contents, value); events.push(`write ${String(key)}`); wrote = true;
            return Reflect.set(target, key, contents);
          },
        });
        const run = () => instructions[opcode]!(observed, {
          fetchByte() { assert.equal(source, "immediate"); events.push("fetch"); attempt(); change(); return value; },
          readByte(address) { assert.equal(source, "(hl)"); assert.equal(address, sourceAddress); events.push("read memory"); attempt(); change(); return value; },
          writeByte(address, contents) {
            assert.equal(destination, "(hl)"); assert.equal(address, 0xabcd); assert.equal(contents, value);
            events.push("write memory"); attempt(); wrote = true;
          },
        });
        if (failAt < 0) run(); else assert.throws(run, error => error === failure);
        if (source === "immediate") expectedEvents.push("fetch");
        else if (source === "(hl)") expectedEvents.push("read h", "read l", "read memory");
        else expectedEvents.push(`read ${source}`);
        const failedSource = failAt === 0 && (source === "immediate" || source === "(hl)");
        if (!failedSource) expectedEvents.push(...(destination === "(hl)" ? ["read h", "read l", "write memory"] : [`write ${destination}`]));
        assert.deepEqual(events, expectedEvents, `${name} opcode=${opcode}, failure=${failAt}`);
        assert.deepEqual(state, { ...before, ...(changed ? { h: 0xab, l: 0xcd, flags: stateWithFlags(!set).flags } : {}),
          ...(wrote && destination !== "(hl)" ? { [destination]: value } : {}) });
        assert.equal(attempts, failAt < 0 ? accesses : failAt + 1);
        assert.equal(wrote, failAt < 0);
      }
    }
  });
}

test("Z80 resolved indexed transfers preserve the supplied address, real H/L, and flags across reads and failed writes", () => {
  const registers = [["B", "b"], ["C", "c"], ["D", "d"], ["E", "e"], ["H", "h"], ["L", "l"], ["A", "a"]] as const;
  const forms = registers.flatMap(([suffix, register]) => [
    { register, operation: "load" as const, execute: zilog[`load${suffix}Memory`] },
    { register, operation: "store" as const, execute: zilog[`store${suffix}Memory`] },
  ]);
  for (const { register, operation, execute } of forms) for (const address of [0, 0xffff]) for (const fail of [false, true]) {
    const state = stateWithFlags(false); state[register] = 0x81;
    const before = structuredClone(state), events: string[] = [], failure = new Error("indexed transfer failure");
    const observed = new Proxy(state, {
      get(target, key, receiver) { assert.equal(operation, "store"); assert.equal(key, register); events.push(`read ${register}`); return Reflect.get(target, key, receiver); },
      set(target, key, value) { assert.equal(operation, "load"); assert.equal(key, register); events.push(`write ${register}`); return Reflect.set(target, key, value); },
    });
    const run = () => execute(observed, address, {
      readByte(actual) { assert.equal(actual, address); events.push("read memory"); if (fail) throw failure; state.ix = state.iy = 0x5555; return 0x42; },
      writeByte(actual, value) { assert.equal(actual, address); assert.equal(value, 0x81); events.push("write memory"); if (fail) throw failure; },
    });
    if (fail) assert.throws(run, error => error === failure); else run();
    assert.deepEqual(state, operation === "load" && !fail ? { ...before, ix: 0x5555, iy: 0x5555, [register]: 0x42 } : before);
    assert.deepEqual(events, operation === "store" ? [`read ${register}`, "write memory"] : ["read memory", ...(fail ? [] : [`write ${register}`])]);
  }
  for (const address of [0, 0xffff]) for (const failAt of [-1, 0, 1]) {
    const state = stateWithFlags(false), before = structuredClone(state), failure = new Error("indexed immediate failure");
    let attempts = 0;
    const observed = new Proxy(state, { get() { assert.fail("Indexed immediate stores do not access state"); }, set() { assert.fail("No state writes"); } });
    const run = () => zilog.storeImmediateMemory(observed, address, {
      fetchByte() { if (attempts++ === failAt) throw failure; state.ix = state.iy = 0x5555; return 0x42; },
      writeByte(actual, value) { assert.equal(actual, address); assert.equal(value, 0x42); if (attempts++ === failAt) throw failure; },
    });
    if (failAt < 0) run(); else assert.throws(run, error => error === failure);
    assert.equal(attempts, failAt < 0 ? 2 : failAt + 1);
    assert.deepEqual(state, failAt === 0 ? before : { ...before, ix: 0x5555, iy: 0x5555 });
  }
});
