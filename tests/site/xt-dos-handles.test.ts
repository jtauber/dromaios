import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../src/components/cpus/generated/8088-cpu.js";
import { Ram } from "../../src/components/memory/ram.js";
import { initialState } from "../components/cpus/8088/helpers.js";
import { createXtDosCalls, dosFileRange } from "../../site/interactive/xt-dos-services.js";
import { dosCallLines } from "../../site/interactive/xt-dos-explanation.js";
import { dosHandleTable } from "../../site/interactive/xt-dos-handle-table.js";
import { matchesXtDosEvent, validateXtEventStops, xtEventStopKey } from "../../site/interactive/xt-event-stops.js";
import { xtRomGuide } from "./xt-inspection-fixture.js";

const catalogue = xtRomGuide.dos;
function fixture(withTable = false, withPositions = false) {
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
  const sft = 0x9000, record = (index: number) => sft + 6 + index * 0x35;
  const word = (address: number, value: number) => put(address, [value & 255, value >>> 8 & 255]);
  const position = (index: number, value: number) => {
    word(record(index) + 0x15, value); word(record(index) + 0x17, Math.floor(value / 0x10000));
  };
  if (withPositions) {
    put(0x402a, [0, 0, 0, 9]); put(sft, [0xff, 0xff, 0, 0, 8, 0]);
    for (let index = 0; index < 8; index++) word(record(index), 1);
    for (const index of [0, 1, 2]) word(record(index) + 5, 0x80); // Standard handles start as devices.
    put(jft + 5, [3, 3, 4]); // Two aliases plus an independently opened file.
  }
  put(0x1000, [0xcd, 0x21]);
  const calls = createXtDosCalls(catalogue, a => ram.read(a));
  function enter(ah: number, bx = 5, cx = 1, options: { al?: number; dx?: number } = {}) {
    const cpu = new Cpu8088(ram, initialState({ cs: 0x100, ip: 0, ss: 0x200, sp: 0x100, ax: ah << 8 | (options.al ?? 0), bx, cx, ds: 0x300, dx: options.dx ?? 0 }));
    const record = cpu.stepTimed(), call = calls.observe(record)!;
    return { call, record, finish(ax = 0, carry = false, dx = 0) {
      put(0x7000, [0xb8, ax & 255, ax >>> 8, 0x36, 0xc6, 0x06, 0xfe, 0, +carry, 0xcf]);
      const handler = new Cpu8088(ram, { ...cpu.snapshot(), cs: 0x700, ip: 0, dx });
      let returned;
      for (let n = 0; n < 3; n++) returned = calls.observe(handler.stepTimed());
      return returned;
    } };
  }
  function call(ah: number, ax = 0, bx = 5, cx = 1, carry = false) { return enter(ah, bx, cx).finish(ax, carry)!; }
  return { ram, calls, put, string, enter, call, jft, sft, record, word, position };
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

test("DOS file positions follow SFT aliases, not equal filenames or accumulated samples", () => {
  const f = fixture(true, true); f.string("README.TXT"); f.call(0x3d, 5); f.call(0x45, 6);
  f.position(3, 10); const first = f.enter(0x3f, 5, 8); f.position(3, 13); const read = first.finish(3)!;
  assert.deepEqual(dosFileRange(read, read.result!), { offset: 10, length: 3 });
  assert.equal(read.file!.offset, 10); assert.equal(read.result!.file!.offset, 13);
  assert.equal(f.call(0x3f, 0, 6).file!.offset, 13);
  assert.equal(f.call(0x3f, 0, 7).file!.offset, 0, "An independent open has its own SFT position");
  f.ram.write(f.jft + 1, 3); const write = f.enter(0x40, 1, 2); f.position(3, 15); write.finish(2);
  assert.equal(f.call(0x3f, 0, 6).file!.offset, 15, "Direct JFT redirection shares the same position");
  assert.equal(first.call.file!.offset, 10); assert.equal(read.result!.file!.offset, 13, "Captured positions are immutable");
  const preview = f.calls.preview(first.record)!;
  assert.equal(preview.file!.offset, 15); assert.equal(f.call(0x3f, 0, 5).file!.offset, 15, "Previewing does not advance a file");
});

test("DOS ranges require consistent successful counts; EOF and zero-length writes have no byte span", () => {
  const f = fixture(true, true);
  for (const [count, end, carry] of [[2, 22, false], [0, 20, false], [6, 20, true], [9, 29, false], [3, 25, false]] as const) {
    f.position(3, 20); const entry = f.enter(0x3f, 5, 8); f.position(3, end); const call = entry.finish(count, carry)!;
    assert.deepEqual(dosFileRange(call, call.result!), !carry && count <= 8 && end === 20 + count ? { offset: 20, length: count } : undefined);
  }
  f.position(3, 58); const zero = f.enter(0x40, 5, 0).finish(0)!;
  assert.deepEqual(dosFileRange(zero, zero.result!), { offset: 58, length: 0 });
  const lines = dosCallLines(zero, catalogue, zero).join("\n");
  assert.match(lines, /No file bytes transferred/); assert.match(lines, /sets the file length/); assert.doesNotMatch(lines, /File bytes .*–/);
  f.position(3, 0xffffffff); const wrapped = f.enter(0x3f); f.position(3, 0); const result = wrapped.finish(1)!;
  assert.equal(dosFileRange(result, result.result!), undefined, "32-bit wrapping cannot produce a linear byte range");
  f.position(3, 0); const changed = f.enter(0x3f); f.ram.write(f.jft + 5, 4); f.position(4, 1);
  const redirected = changed.finish(1)!; assert.equal(dosFileRange(redirected, redirected.result!), undefined, "A different file is not a continuation");
});

test("seek interpretation uses unsigned absolute offsets, signed relative offsets, and the complete returned DX:AX", () => {
  const f = fixture(true, true);
  for (const [origin, distance, expected] of [[0, 0xffffffff, 4294967295], [1, 0xffffffff, -1], [2, 0xfffffffe, -2]] as const) {
    const entry = f.enter(0x42, 5, distance >>> 16, { al: origin, dx: distance & 65535 });
    f.position(3, 0x12345678); const call = entry.finish(0x5678, false, 0x1234)!;
    const lines = dosCallLines(call, catalogue, call).join("\n");
    assert.match(lines, new RegExp(`by ${expected} bytes`)); assert.match(lines, /DX:AX=1234:5678/);
    assert.equal(call.result!.file!.offset, 0x12345678); assert.equal(dosFileRange(call, call.result!), undefined);
    assert.equal(matchesXtDosEvent({ kind: "dos", phase: "return", function: 0x42 }, call), true);
  }
  const invalid = f.enter(0x42, 5, 0, { al: 3 }).finish(1, true, 0xbeef)!;
  assert.match(dosCallLines(invalid, catalogue, invalid).join("\n"), /Invalid seek origin 3/);
  assert.doesNotMatch(dosCallLines(invalid, catalogue, invalid).join("\n"), /Returned position/);
  assert.equal(matchesXtDosEvent({ kind: "dos", phase: "error", function: 0x42 }, invalid), true);
});

test("file position lookup walks bounded SFT chains and rejects devices, remote/FCB/free records and unavailable bytes", () => {
  const f = fixture(true, true), get = (read = (a: number) => f.ram.read(a) as number | undefined) => dosHandleTable(catalogue.handleTable, read)!;
  assert.equal(get().positions.get(1), undefined, "Console device counters are not file positions");
  for (const [field, value] of [[0, 0], [0, 0xffff], [2, 0x8000], [5, 0x8080], [5, 0x8000], [5, 0x80]] as const) {
    const g = fixture(true, true); g.word(g.record(3) + field, value);
    assert.equal(dosHandleTable(catalogue.handleTable, a => g.ram.read(a))!.positions.get(3), undefined);
  }
  assert.equal(get(a => a === f.record(3) + 0x18 ? undefined : f.ram.read(a)).positions.get(3), undefined);
  // First table holds only device entries; the second holds the disk file at SFT index 3.
  f.put(f.sft, [0, 0, 0, 10, 3, 0]); f.put(0xa000, [0xff, 0xff, 0, 0, 5, 0]); f.word(0xa006, 2); f.word(0xa01b, 0xbeef);
  assert.equal(get().positions.get(3)!.offset, 0xbeef);
  f.put(0xa000, [0, 0, 0, 10, 1, 0]); // A cycle before resolving handle 7's index 4.
  assert.equal(get().positions.size, 0);
  for (const bytes of [[0, 0], [1, 1]]) {
    f.put(f.sft + 4, bytes); assert.equal(get().positions.size, 0);
  }
});

test("restoration clears captured names and calls; the next call reads its restored file position independently", () => {
  const f = fixture(true, true); f.string("README.TXT"); f.call(0x3d, 5);
  f.position(3, 32); const entry = f.enter(0x3f, 5, 4);
  f.calls.reset(); f.position(3, 36); assert.equal(entry.finish(4), undefined);
  const next = f.enter(0x3f, 6, 2); f.position(3, 38); const returned = next.finish(2)!;
  assert.equal(returned.filename, undefined); assert.equal(returned.file!.offset, 36);
  assert.deepEqual(dosFileRange(returned, returned.result!), { offset: 36, length: 2 });
  const unsupported = fixture(); unsupported.string("README.TXT"); unsupported.call(0x3d, 5);
  assert.equal(unsupported.call(0x3f).file, undefined, "No position is guessed for an unrecognized DOS kernel");
});
