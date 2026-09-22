import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/generated/8088-cpu.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { runCpu } from "../../../../src/runtime/run-cpu.js";
import { initialState, flags, snapshot, checkStep, aluResult, address, put, dataReads, dataWrites } from "./helpers.js";

const strings = [
  [0xa4, "move", 8], [0xa5, "move", 16], [0xa6, "compare", 8], [0xa7, "compare", 16],
  [0xaa, "store", 8], [0xab, "store", 16], [0xac, "load", 8], [0xad, "load", 16],
  [0xae, "scan", 8], [0xaf, "scan", 16],
] as const;

test("8088 completion all strings use fixed ES destinations, source overrides, and DF-controlled wrapping", () => {
  const ram = new ObservedRam(0x100000);
  for (const [opcode, operation, width] of strings) for (const df of [false, true]) {
    for (const offset of [0, 0xf, 0xffff]) for (const override of [false, true]) {
      const before = initialState({ ds: 0xffff, ss: 0x5555, es: 0x6789, si: offset, di: offset,
        flags: { ...flags(511), df }, ax: 0x0100 });
      const sourceSegment = override ? before.ss : before.ds, source = width === 8 ? [0xff] : [0xff, 0x7f];
      const destination = width === 8 ? [1] : [1, 0x80], accumulator = width === 8 ? [0] : [0, 1];
      put(ram, sourceSegment, offset, source); put(ram, before.es, offset, destination);
      const bytes = [...(override ? [0x36] : []), opcode];
      const readsSource = ["move", "compare", "load"].includes(operation), readsDestination = ["compare", "scan"].includes(operation);
      const writesDestination = ["move", "store"].includes(operation);
      const left = operation === "scan" ? width === 8 ? 0 : 0x100 : width === 8 ? 0xff : 0x7fff;
      const right = width === 8 ? 1 : 0x8001;
      const next = (offset + (df ? -1 : 1) * width / 8 + 65536) % 65536;
      checkStep(ram, before, bytes, { ...before, ip: before.ip + bytes.length,
        ax: operation === "load" ? width === 8 ? 0x01ff : 0x7fff : before.ax,
        si: readsSource ? next : offset, di: operation === "load" ? offset : next,
        flags: readsDestination ? aluResult("SUB", width, left, right, before.flags).flags : before.flags }, undefined,
      [...(readsSource ? dataReads(sourceSegment, offset, source) : []), ...(readsDestination ? dataReads(before.es, offset, destination) : []),
        ...(writesDestination ? dataWrites(before.es, offset, operation === "move" ? source : accumulator) : [])]);
    }
  }
});

test("8088 completion REP executes one element per step and restores solely from visible state", () => {
  const ram = new ObservedRam(0x100000), before = initialState({ cx: 3, si: 0xfffe, di: 0xffff,
    flags: { ...flags(511), tf: false, df: false }, ds: 0x2000, es: 0xffff });
  const bytes = [0x3e, 0xf3, 0xa5]; put(ram, before.cs, before.ip, bytes);
  put(ram, before.ds, before.si, [1, 2, 3, 4, 5, 6]);
  const cpu = new Cpu8088(ram, before);
  const first = runCpu(cpu, { maxSteps: 1 }), retained = structuredClone(first);
  assert.equal(first.stopReason, "step-limit");
  assert.deepEqual(first.records[0]?.after, snapshot({ ...before, cx: 2, si: 0, di: 1 }));
  const resumed = new Cpu8088(ram, cpu.snapshot());
  put(ram, before.ds, 0, [0x33, 0x44]); // Each element reads current RAM.
  const rest = runCpu(resumed, { maxSteps: 2, endAddress: address(before.cs, before.ip + 3) });
  assert.equal(rest.stopReason, "completed");
  assert.deepEqual(rest.records.map(record => [record.after.cx, record.after.si, record.after.di, record.after.ip]),
    [[1, 2, 3, before.ip], [0, 4, 5, before.ip + 3]]);
  assert.deepEqual([...first.records, ...rest.records].map(record => record.instruction?.bytes), [bytes, bytes, bytes]);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => ram.read(address(before.es, 0xffff + i))), [1, 2, 0x33, 0x44, 5, 6]);
  assert.deepEqual(first, retained);
  // Refetching is explicit: replace the pending REP with HLT and no hidden iteration continues.
  put(ram, before.cs, before.ip, [0xf4]);
  assert.equal(cpu.step().outcome, "halted"); assert.equal(cpu.snapshot().cx, 2);
});

test("8088 completion repeated strings handle empty counts, termination flags, and prefix precedence", () => {
  const ram = new ObservedRam(0x100000);
  for (const [opcode, operation, width] of strings) for (const rep of [0xf2, 0xf3]) {
    const compares = operation === "compare" || operation === "scan";
    if (rep === 0xf2 && !compares) continue;
    for (const cx of [0, 1, 2, 0xffff]) for (const equal of [false, true]) for (const incomingZF of [false, true]) {
      const before = initialState({ cx, ax: 7, flags: { ...flags(511), tf: false, zf: incomingZF, df: false } });
      const source = width === 8 ? [7] : [7, 0], destination = width === 8 ? [equal ? 7 : 6] : [equal ? 7 : 6, 0];
      put(ram, before.ds, before.si, source); put(ram, before.es, before.di, destination);
      // The final repeat prefix wins; repeat testing uses the new ZF, irrespective of incoming ZF.
      const bytes = [rep === 0xf2 ? 0xf3 : 0xf2, rep, opcode];
      put(ram, before.cs, before.ip, bytes); ram.accesses.length = 0;
      const record = new Cpu8088(ram, before).step(), actual = record.after;
      assert.equal(record.outcome, "executed");
      assert.equal(actual.cx, cx === 0 ? 0 : cx - 1);
      const again = cx > 1 && (!compares || equal === (rep === 0xf3));
      assert.equal(actual.ip, again ? before.ip : before.ip + bytes.length);
      if (cx === 0) {
        assert.deepEqual(actual, snapshot({ ...before, ip: before.ip + bytes.length }));
        assert.deepEqual(record.accesses, dataReads(before.cs, before.ip, bytes));
      } else {
        assert.equal(actual.flags.zf, compares ? equal : incomingZF);
        assert.equal(actual.si, before.si + (["move", "compare", "load"].includes(operation) ? width / 8 : 0));
        assert.equal(actual.di, before.di + (operation === "load" ? 0 : width / 8));
      }
    }
  }
});
