import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../src/components/cpus/generated/8088-cpu.js";
import { Ram } from "../../src/components/memory/ram.js";
import { initialState } from "../components/cpus/8088/helpers.js";
import { createXtDosCalls } from "../../site/interactive/xt-dos-services.js";
import { dosHandleTable } from "../../site/interactive/xt-dos-handle-table.js";
import { matchesXtDosEvent, validateXtEventStops, xtEventStopKey } from "../../site/interactive/xt-event-stops.js";
import { xtRomGuide } from "./xt-inspection-fixture.js";

const catalogue = xtRomGuide.dos;
function fixture(withTable = false) {
  const ram = new Ram(0x100000);
  const put = (address: number, bytes: readonly number[]) => bytes.forEach((byte, i) => ram.write(address + i, byte));
  const string = (name: string) => put(0x3000, [...Buffer.from(name, "ascii"), 0]);
  const jft = 0x6018;
  put(0x84, withTable ? [0x60, 0x14, 0, 4] : [0, 0, 0, 4]);
  if (withTable) {
    for (const guard of catalogue.handleTable.guards) put(0x4000 + parseInt(guard.offset, 16), guard.bytes.split(" ").map(byte => parseInt(byte, 16)));
    put(0x42de, [0, 6]); put(0x6000, [0xcd, 0x20]);
    put(0x6032, [20, 0, 0x18, 0, 0, 6]);
    put(jft, [1, 1, 1, 0, 2, ...Array(15).fill(0xff)]);
  }
  put(0x1000, [0xcd, 0x21]);
  const calls = createXtDosCalls(catalogue, a => ram.read(a));
  function enter(ah: number, bx = 5, cx = 1) {
    const cpu = new Cpu8088(ram, initialState({ cs: 0x100, ip: 0, ss: 0x200, sp: 0x100, ax: ah << 8, bx, cx, ds: 0x300, dx: 0 }));
    const record = cpu.stepTimed(), call = calls.observe(record)!;
    return { call, record, finish(ax = 0, carry = false) {
      put(0x7000, [0xb8, ax & 255, ax >>> 8, 0x36, 0xc6, 0x06, 0xfe, 0, +carry, 0xcf]);
      const handler = new Cpu8088(ram, { ...cpu.snapshot(), cs: 0x700, ip: 0 });
      let returned;
      for (let n = 0; n < 3; n++) returned = calls.observe(handler.stepTimed());
      return returned;
    } };
  }
  function call(ah: number, ax = 0, bx = 5, cx = 1, carry = false) { return enter(ah, bx, cx).finish(ax, carry)!; }
  return { ram, calls, put, string, enter, call, jft };
}

test("observed DOS handles survive duplication and redirection, close independently, and reuse without rewriting history", () => {
  const f = fixture(); f.string("README.TXT");
  const open = f.call(0x3d, 5); assert.equal(open.filename, "README.TXT");
  const duplicate = f.call(0x45, 6); assert.equal(duplicate.filename, "README.TXT");
  f.call(0x3e); f.string("SAVE.TXT"); f.call(0x3c, 5);
  assert.equal(f.call(0x3f, 1, 6).filename, "README.TXT");
  assert.equal(f.call(0x40, 1, 5).filename, "SAVE.TXT");
  const redirect = f.call(0x46, 0, 5, 1);
  assert.equal(redirect.targetHandle, 1); assert.equal(redirect.filename, "SAVE.TXT");
  f.call(0x3e); assert.equal(f.call(0x40, 1, 1).filename, "SAVE.TXT");
  f.call(0x3e, 0, 1); assert.equal(f.call(0x40, 1, 1).filename, undefined);
  assert.equal(open.filename, "README.TXT"); assert.equal(duplicate.filename, "README.TXT");
  assert.deepEqual(f.calls.handles(), [{ handle: 6, filename: "README.TXT" }]);
});

test("failed calls leave names intact; unknown sources replace names only on successful duplication", () => {
  const f = fixture(); f.string("README.TXT"); f.call(0x3d, 5);
  for (const fn of [0x3c, 0x3d, 0x3e, 0x45, 0x46]) {
    f.string("SAVE.TXT"); f.call(fn, 6, 5, 6, true);
    assert.deepEqual(f.calls.handles(), [{ handle: 5, filename: "README.TXT" }]);
  }
  f.call(0x46, 0, 99, 5, true); assert.equal(f.call(0x3f).filename, "README.TXT");
  f.call(0x46, 0, 99, 5); assert.equal(f.call(0x3f).filename, undefined);
  for (const bytes of [[0], [0x80, 0], Array(256).fill(65)]) {
    f.string("README.TXT"); f.call(0x3d, 5); f.put(0x3000, bytes);
    assert.equal(f.call(0x3d, 5).filename, undefined); assert.deepEqual(f.calls.handles(), []);
  }
});

test("the guarded DOS table follows direct standard-output redirection and forgets closed or changed process identities", () => {
  const f = fixture(true); f.string("SAVE.TXT");
  const opened = f.enter(0x3c); f.ram.write(f.jft + 5, 3); opened.finish(5);
  // COMMAND.COM can edit its JFT without invoking AH=46: handles 1 and 5 now share SFT 3.
  f.ram.write(f.jft + 1, 3);
  const write = f.enter(0x40, 1); assert.equal(write.call.filename, "SAVE.TXT"); write.finish(1);
  const close = f.enter(0x3e, 5); f.ram.write(f.jft + 5, 0xff); close.finish();
  assert.equal(f.call(0x40, 1, 1).filename, "SAVE.TXT");
  f.ram.write(f.jft + 1, 1); assert.equal(f.call(0x40, 1, 1).filename, undefined);
  f.ram.write(f.jft + 6, 3); assert.equal(f.call(0x3f, 1, 6).filename, undefined, "An unobserved new owner cannot inherit the old SFT name");
  f.string("README.TXT"); const again = f.enter(0x3d); again.finish(6);
  assert.equal(f.call(0x3f, 1, 6).filename, "README.TXT");
  const pending = f.enter(0x3f, 6); f.ram.write(0x5460, 0x90);
  assert.equal(pending.finish(1), undefined, "Losing the kernel guard abandons the pending association");
  assert.equal(f.call(0x3f, 1, 6).filename, undefined);
  assert.equal(write.call.filename, "SAVE.TXT");
});

test("table inspection rejects stale vectors, bad PSPs, oversized tables, network entries and missing storage", () => {
  for (const [address, bytes] of [[0x84, [0, 0]], [0x5460, [0x90]], [0x540d, [0x90]],
    [0x6000, [0]], [0x6032, [1, 1]], [0x6032, [0, 0]], [0x6034, [0xff, 0xff]]] as const) {
    const f = fixture(true); f.put(address, bytes);
    assert.equal(dosHandleTable(catalogue.handleTable, a => f.ram.read(a)), undefined);
  }
  const f = fixture(true);
  assert.equal(dosHandleTable(catalogue.handleTable, a => a === f.jft + 19 ? undefined : f.ram.read(a)), undefined);
  f.string("REMOTE.TXT"); const entry = f.enter(0x3d); f.ram.write(f.jft + 5, 0x80); entry.finish(5);
  assert.equal(f.call(0x3f).filename, undefined);
  // A valid different PSP must not inherit the previous process's handle names.
  f.ram.write(f.jft + 5, 3); f.call(0x3d, 5);
  f.put(0x42de, [0, 8]); f.put(0x8000, [0xcd, 0x20]); f.put(0x8032, [20, 0, 0x18, 0, 0, 6]);
  assert.equal(f.call(0x3f).filename, undefined);
});

test("filename stops use immutable captured paths, ignore ASCII case, and do not guess unknown or basename matches", () => {
  const f = fixture(); f.string("A:\\README.TXT"); const call = f.call(0x3d, 5);
  const condition = { kind: "dos" as const, phase: "return" as const, filename: "a:\\readme.txt", enabled: true };
  assert.equal(matchesXtDosEvent(condition, call), true);
  assert.equal(matchesXtDosEvent({ ...condition, filename: "README.TXT" }, call), false);
  f.call(0x3e); assert.equal(matchesXtDosEvent(condition, f.call(0x3f)), false);
  assert.equal(xtEventStopKey(condition), xtEventStopKey({ ...condition, filename: "A:\\README.TXT" }));
  assert.throws(() => validateXtEventStops([condition, { ...condition, filename: "A:\\README.TXT" }]));
  for (const filename of ["", "X".repeat(256), "A\nB", "café", 5, null])
    assert.throws(() => validateXtEventStops([{ ...condition, filename } as typeof condition]));
  f.string("MISSING.TXT"); const failed = f.call(0x3d, 2, 5, 1, true);
  assert.equal(matchesXtDosEvent({ kind: "dos", phase: "error", filename: "missing.txt" }, failed), true);
});

test("preview and history cannot seed names; restoration and process/unsupported-handle boundaries discard them", () => {
  const f = fixture(); f.string("README.TXT"); const pending = f.enter(0x3d);
  assert.equal(f.calls.preview(pending.record)!.filename, "README.TXT"); assert.deepEqual(f.calls.handles(), []);
  pending.finish(5); const read = f.enter(0x3f); assert.equal(read.call.filename, "README.TXT");
  const revision = f.calls.revision; assert.equal(f.calls.preview(read.record)!.filename, "README.TXT");
  assert.equal(f.calls.revision, revision);
  f.calls.reset(); assert.equal(read.finish(2), undefined); assert.deepEqual(f.calls.handles(), []);
  assert.equal(f.call(0x3f).filename, undefined);
  for (const fn of catalogue.forgetHandles.functions) {
    f.string("SAVE.TXT"); f.call(0x3d, 5); f.enter(parseInt(fn, 16));
    assert.deepEqual(f.calls.handles(), [], fn);
  }
});
