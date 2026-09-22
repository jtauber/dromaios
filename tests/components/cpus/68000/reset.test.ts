import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu68000 } from "../../../../src/components/cpus/68000.js";
import type { Cpu68000Snapshot } from "../../../../src/components/cpus/68000.js";
import { initialState } from "../../../helpers/68000-state.js";

const vectorBytes = [0xfe, 0xdc, 0xba, 0x99, 0x89, 0xab, 0xcd, 0xee];
const snapshot = (state: ReturnType<typeof initialState>): Cpu68000Snapshot => ({
  ...structuredClone(state), a7: state.flags.s ? state.ssp : state.usp, physicalPc: state.pc % 0x1000000,
});

test("68000 reset preserves every unspecified field, complete vectors, and callback-visible state at every failure point", () => {
  const hostError = Error("host read failed");
  for (let flags = 0; flags < 128; flags++) for (const odd of [false, true]) {
    const bytes = [...vectorBytes]; bytes[7]! += Number(odd);
    for (let stop = -1; stop < 8; stop++) for (const bus of stop < 0 ? [false] : [false, true]) {
      const initial = initialState(flags);
      initial.halted = Boolean(flags & 1); initial.tracePending = Boolean(flags & 2); initial.faulted = Boolean(flags & 4);
      initial.entry = { kind: "trap", vector: 47 };
      const observed: number[] = [];
      const cpu = new Cpu68000({ size: 0x1000000, read(address) {
        // The new SSP becomes visible only to the second vector's callbacks.
        const visible = { ...initial, ssp: address < 4 ? initial.ssp : 0xfedcba99 };
        assert.deepEqual(cpu.snapshot(), snapshot(visible));
        observed.push(address);
        if (address === stop) { if (bus) return "bus-error"; throw hostError; }
        return bytes[address]!;
      }, write() { assert.fail("Reset must not write memory"); } }, initial, { resetDevices() { assert.fail("External reset must not signal RESET devices"); } });
      const before = cpu.snapshot(), expected = structuredClone(initial);
      if (stop < 0 || stop >= 4) expected.ssp = 0xfedcba99;
      if (stop < 0) expected.pc = 0x89abcdee + Number(odd);
      if (stop >= 0 && !bus) {
        assert.throws(() => cpu.reset(), error => error === hostError);
      } else {
        expected.flags.s = true; expected.flags.t = false; expected.interruptMask = 7;
        expected.halted = false; expected.tracePending = false; expected.faulted = stop >= 0 || odd;
        expected.entry = { kind: "reset", vector: 0 };
        const record = cpu.reset();
        const fault = stop >= 0 ? { source: "bus-error", operation: "read", address: stop }
          : odd ? { operation: "fetch", address: expected.pc } : undefined;
        assert.deepEqual(record, { before, after: snapshot(expected),
          accesses: bytes.slice(0, stop < 0 ? 8 : stop).map((value, address) => ({ kind: "read", address, value })),
          ...(fault ? { fault } : {}),
        });
      }
      assert.deepEqual(observed, Array.from({ length: stop < 0 ? 8 : stop + 1 }, (_, address) => address));
      assert.deepEqual(cpu.snapshot(), snapshot(expected));
      assert.deepEqual(before, snapshot(initial));
    }
  }
});

test("68000 reset propagates host-thrown values and invalid bytes, then releases its shared guard", () => {
  for (const thrown of [undefined, null, "bus-error", { source: "bus-error", operation: "read", address: 5 }, Error("host")]) {
    let fail = true, caught = false;
    const cpu = new Cpu68000({ size: 0x1000000, read(address) {
      if (fail && address === 5) throw thrown;
      return vectorBytes[address]!;
    }, write() { assert.fail(); } }, initialState());
    try { cpu.reset(); } catch (error) { caught = true; assert.equal(error, thrown); }
    assert.equal(caught, true); assert.equal(cpu.snapshot().ssp, 0xfedcba99);
    assert.equal(cpu.snapshot().pc, initialState().pc); assert.equal(cpu.snapshot().flags.t, true);
    fail = false; assert.equal(cpu.reset().after.pc, 0x89abcdee);
  }
  for (const invalid of [-1, 256, 0.5, NaN, undefined, "bad"]) {
    const cpu = new Cpu68000({ size: 0x1000000, read: () => invalid as number, write() { assert.fail(); } }, initialState());
    assert.throws(() => cpu.reset(), RangeError);
    assert.deepEqual(cpu.snapshot(), snapshot(initialState()));
  }
});

test("68000 reset shares the instruction and interrupt guard while allowing inspection", () => {
  const cpu = new Cpu68000({ size: 0x1000000, read(address) {
    assert.doesNotThrow(() => cpu.snapshot());
    for (const reenter of [() => cpu.reset(), () => cpu.step(), () => cpu.interrupt(7, () => "autovector")]) {
      assert.throws(reenter, /must not be reentrant/);
    }
    return vectorBytes[address]!;
  }, write() { assert.fail(); } }, initialState());
  assert.equal(cpu.reset().after.pc, 0x89abcdee);
  assert.equal(cpu.reset().after.pc, 0x89abcdee);
});
