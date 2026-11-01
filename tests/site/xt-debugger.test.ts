import assert from "node:assert/strict";
import { test } from "node:test";
import { create8088PcXt } from "../../src/machines/generated/8088/pc-xt.js";
import { stepTimedXtCpu } from "../../src/machines/8088/pc-xt/interrupts.js";
import { Cpu8088 } from "../../src/components/cpus/generated/8088-cpu.js";
import type { Cpu8088State } from "../../src/components/cpus/generated/8088-cpu.js";
import { createXtDebugger, decodeXtBreakpoints, formatXtDebugAddress, parseXtDebugAddress, xtDebugLocation } from "../../site/interactive/xt-debugger.js";
import { createExecutionController } from "../../site/interactive/execution-controller.js";
import { debuggerStatus } from "../../site/interactive/debugger-status.js";
import { decodeWorkspaceState, encodeWorkspaceState } from "../../site/interactive/workspace/state.js";
import { groups } from "../../site/interactive/workspace/layout.js";
import { migrateXtWorkspace, xtWorkspaceKey } from "../../site/interactive/xt-workspace.js";

const bindings = { bios: null, basic: null, font: null };
const point = (text: string, enabled = true) => ({ ...parseXtDebugAddress(text), enabled });
function fixture(bytes: readonly number[], state: Partial<Cpu8088State> = {}, budget = 100) {
  let machine = create8088PcXt(bindings);
  machine.cpu = new Cpu8088(machine.memory, { ...machine.cpu.snapshot(), cs: 0, ip: 0x2000, ss: 0x1000, sp: 0x8000,
    ax: 0x1234, ...state }, { ports: machine.ports });
  bytes.forEach((byte, i) => machine.ram.write(0x2000 + i, byte));
  const debug = createXtDebugger(() => machine, budget), jobs: (() => void)[] = [];
  const step = () => debug.capture(() => stepTimedXtCpu(machine).record);
  const execution = createExecutionController({ step, canStep: () => true, pauseBeforeStep: debug.beforeStep,
    onChange() {}, batchSize: 10000, schedule(callback) { jobs.push(callback); return () => {}; } });
  return { get machine() { return machine; }, debug, execution, jobs, step,
    replace() { machine = create8088PcXt(bindings, machine.snapshot()); execution.reset(); debug.reset(); },
    run() { debug.run(); execution.run(); jobs.shift()!(); },
    runTo(text: string) { debug.runTo(parseXtDebugAddress(text)); execution.run(); jobs.shift()!(); },
    single() { debug.step(); execution.step(); },
  };
}

test("XT breakpoint notation retains logical identity while physical addresses match all aliases", () => {
  assert.deepEqual(parseXtDebugAddress("ffff0"), { address: 0xffff0 });
  assert.deepEqual(parseXtDebugAddress(" 0xffff : $0 "), { address: 0xffff0, space: "CS:IP FFFF:0000" });
  assert.deepEqual(parseXtDebugAddress("FFFF:0010"), { address: 0, space: "CS:IP FFFF:0010" });
  assert.notDeepEqual(parseXtDebugAddress("FFFF:0000"), parseXtDebugAddress("F000:FFF0"));
  for (const text of ["100000", "10000:0", "0:10000", ":0", "0:", "1:2:3", "nope"]) assert.throws(() => parseXtDebugAddress(text));
  const p = fixture([0x90]);
  assert.equal(formatXtDebugAddress(xtDebugLocation(p.machine.cpu.snapshot())), "CS:IP 0000:2000 · physical $02000");
});

test("XT breakpoints stop before the boundary, Continue crosses once, and Step crosses a newly added stop", () => {
  const p = fixture([0x40, 0xeb, 0xfd]); // INC AX; JMP 2000
  p.debug.setBreakpoints([point("2000")]);
  const before = p.machine.snapshot(); p.run();
  assert.equal(p.execution.steps, 0); assert.equal(p.debug.stop?.kind, "breakpoint");
  assert.deepEqual(p.machine.snapshot(), before);
  p.run(); assert.equal(p.execution.steps, 2); assert.equal(p.machine.cpu.snapshot().ax, 0x1235);
  assert.equal(p.execution.running, false); assert.equal(p.debug.stop?.kind, "breakpoint");
  p.single(); assert.equal(p.execution.steps, 3); assert.equal(p.machine.cpu.snapshot().ip, 0x2001);
  assert.equal(p.debug.stop?.kind, "step");
  p.debug.setBreakpoints([point("0000:2001")]); p.single();
  assert.equal(p.machine.cpu.snapshot().ip, 0x2000); assert.equal(p.execution.steps, 4);
});

test("a far jump to the same physical byte reaches only its exact logical breakpoint", () => {
  for (const breakpoint of ["0100:1000", "2000"]) {
    const p = fixture([0xea, 0, 0x10, 0, 1]); // JMP 0100:1000, still physical 02000
    p.debug.setBreakpoints([point(breakpoint)]); p.run();
    if (breakpoint === "2000") { assert.equal(p.execution.steps, 0); p.run(); }
    assert.equal(p.execution.steps, 1); assert.equal(p.debug.stop?.kind, "breakpoint");
    assert.deepEqual(p.debug.stop?.location, { address: 0x2000, space: "CS:IP 0100:1000" });
  }
  const p = fixture([0xea, 0, 0x10, 0, 1]);
  p.runTo("0100:1000"); assert.equal(p.execution.steps, 1); assert.equal(p.debug.stop?.kind, "target");
  p.runTo("2000"); assert.equal(p.execution.steps, 1, "physical target is immediate through an alias");
  p.runTo("0000:2000"); assert.equal(p.execution.steps, 101); assert.equal(p.debug.stop?.kind, "limit");
});

test("breakpoint checks leave a pending XT keyboard interrupt and board time untouched", t => {
  const p = fixture([0x90]);
  for (const [port, value] of [[0x20, 0x13], [0x21, 8], [0x21, 9], [0x21, 0xfd], [0x63, 0x99], [0x61, 0x4c]]) p.machine.ports.writePort(port!, value!);
  assert.ok(p.machine.io.offerScanCode(0x1e)); assert.equal(p.machine.io.irq, true);
  const before = p.machine.snapshot();
  t.mock.method(p.machine.memory, "read", () => assert.fail("Debugger read the guest bus"));
  t.mock.method(p.machine.ports, "readPort", () => assert.fail("Debugger read a port"));
  p.debug.setBreakpoints([point("0000:2000")]); p.debug.setWatchpoints([point("400")]);
  p.run(); p.debug.pause(); p.runTo("2000");
  assert.equal(p.execution.steps, 0); assert.deepEqual(p.machine.snapshot(), before);
});

test("XT RAM watches capture the first watched store and stop after both bytes across an offset wrap", () => {
  const p = fixture([0xa3, 0xff, 0xff, 0xa3, 0xff, 0xff, 0x90], { ds: 0x1000 });
  p.debug.setWatchpoints([point("10000"), point("1FFFF")]); p.runTo("2006");
  assert.equal(p.execution.steps, 1); assert.equal(p.debug.request, undefined);
  assert.equal(p.debug.stop?.kind, "watchpoint"); assert.equal(p.debug.hit?.address, 0x1ffff);
  assert.equal(p.debug.hit?.before, 0); assert.equal(p.debug.hit?.after, 0x34);
  assert.equal(p.machine.ram.read(0x10000), 0x12); assert.equal(p.machine.cpu.snapshot().ip, 0x2003);
  assert.match(p.debug.stop!.detail!, /CS:IP 0000:2000.*physical \$02000.*RAM \$1FFFF: \$00 → \$34/);
  p.run(); assert.equal(p.execution.steps, 2);
  assert.equal(p.debug.hit?.before, 0x34); assert.equal(p.debug.hit?.after, 0x34);
  assert.equal(p.machine.cpu.snapshot().ip, 0x2006);
});

test("RAM watches exclude reads, ROM/video/port writes, host edits, and disabled watches", () => {
  for (const ds of [0xa000, 0xb800, 0xf000]) {
    const p = fixture([0xa2, 0, 0, 0xe6, 0x80, 0x90], { ds });
    p.debug.setWatchpoints([point("400")]);
    p.machine.ram.write(0x400, 0x77); assert.equal(p.debug.hit, undefined);
    p.runTo("2005"); assert.equal(p.execution.steps, 2); assert.equal(p.debug.hit, undefined);
  }
  const q = fixture([0xa0, 0, 4, 0xa2, 0, 4, 0x90]);
  q.debug.setWatchpoints([point("400")]); q.runTo("2003");
  assert.equal(q.debug.stop?.kind, "target"); assert.equal(q.debug.hit, undefined);
  q.debug.setWatchpoints([point("400", false)]); q.runTo("2006");
  assert.equal(q.debug.stop?.kind, "target"); assert.equal(q.debug.hit, undefined);
  for (const address of ["A0000", "B8000", "FFFF0"]) assert.throws(() => q.debug.setWatchpoints([point(address)]), /9FFFF/);
});

test("an XT interrupt watch reports its caller after the complete six-byte frame", () => {
  const p = fixture([0x90]);
  for (const [port, value] of [[0x20, 0x13], [0x21, 8], [0x21, 9], [0x21, 0xfd], [0x63, 0x99], [0x61, 0x4c]]) p.machine.ports.writePort(port!, value!);
  [0, 0x30, 0, 0].forEach((byte, i) => p.machine.ram.write(0x24 + i, byte));
  const state = p.machine.cpu.snapshot();
  p.machine.cpu = new Cpu8088(p.machine.memory, { ...state, flags: { ...state.flags, if: true } }, { ports: p.machine.ports });
  assert.ok(p.machine.io.offerScanCode(0x1e)); p.debug.setWatchpoints([point("17FFE")]); p.runTo("3000");
  assert.equal(p.execution.steps, 1); assert.equal(p.debug.stop?.kind, "watchpoint");
  assert.equal(p.debug.hit?.record.instruction, null); assert.match(p.debug.stop!.detail!, /INTR entry.*CS:IP 0000:2000/);
  assert.equal(p.machine.cpu.snapshot().sp, 0x7ffa); assert.equal(p.machine.cpu.snapshot().ip, 0x3000);
  assert.equal(p.debug.hit?.record.accesses.filter(access => access.kind === "write").length, 6);
});

test("REP watchpoints and breakpoint continuation stop between native iterations", () => {
  const p = fixture([0xf3, 0xa4, 0x90], { cx: 3, si: 0x3000, di: 0x4000, es: 0x1000 });
  [0x41, 0x42, 0x43].forEach((byte, i) => p.machine.ram.write(0x3000 + i, byte));
  p.debug.setWatchpoints([point("14001")]); p.runTo("2002");
  assert.equal(p.execution.steps, 2); assert.equal(p.machine.cpu.snapshot().ip, 0x2000);
  assert.equal(p.machine.cpu.snapshot().cx, 1); assert.equal(p.debug.hit?.after, 0x42);
  assert.equal(p.machine.ram.read(0x14002), 0);
  p.runTo("2002"); assert.equal(p.execution.steps, 3); assert.equal(p.debug.stop?.kind, "target");
  assert.equal(p.machine.ram.read(0x14002), 0x43);
  const q = fixture([0xf3, 0xa4], { cx: 3 });
  q.debug.setBreakpoints([point("2000")]); q.run(); q.run();
  assert.equal(q.execution.steps, 1); assert.equal(q.machine.cpu.snapshot().cx, 2);
  assert.equal(q.debug.stop?.kind, "breakpoint");
});

test("XT restore preserves stops, detaches old RAM, and failed boundaries retain effects without a false write hit", () => {
  const p = fixture([0xa2, 0, 4, 0x90]);
  p.debug.setWatchpoints([point("400")]); p.run();
  p.debug.setBreakpoints([point("2000")]); const old = p.machine; p.replace();
  assert.equal(p.debug.hit, undefined); assert.equal(Boolean(p.debug.stop), false);
  assert.equal(p.debug.breakpoints.length, 1); assert.equal(p.debug.watchpoints.length, 1);
  p.debug.capture(() => { old.ram.write(0x400, 0x88); return stepTimedXtCpu(p.machine).record; });
  assert.equal(p.debug.hit, undefined);
  assert.throws(() => p.debug.capture(() => { p.machine.ram.write(0x400, 0x99); throw new Error("Failed after write"); }), /Failed after write/);
  assert.equal(p.machine.ram.read(0x400), 0x99); assert.equal(p.debug.hit, undefined); assert.equal(p.debug.stop?.kind, "error");
  p.machine.ram.write(0x400, 0); assert.equal(p.debug.stop?.kind, "error");
  p.debug.dispose();
});

test("XT run-to requests stop at their budget, cancel on pause and reset, and reject stale scheduled work", () => {
  const p = fixture([0xeb, 0xfe], {}, 3); p.runTo("2002");
  assert.equal(p.execution.steps, 3); assert.equal(p.debug.stop?.kind, "limit");
  p.debug.runTo(parseXtDebugAddress("2002")); p.execution.run(); p.debug.pause(); p.execution.stop();
  p.jobs.shift()!(); assert.equal(p.execution.steps, 3); assert.equal(p.debug.request, undefined);
  p.debug.runTo(parseXtDebugAddress("2002")); p.execution.run(); p.replace(); p.jobs.shift()!();
  assert.equal(p.execution.steps, 0); assert.equal(p.debug.stop, undefined);
  const q = fixture([0xf4], {}, 3); q.runTo("2002");
  assert.equal(q.execution.steps, 3); assert.equal(q.debug.stop?.kind, "limit");
});

test("XT preferences validate exact aliases, physical ranges, and distinct stops before replacing them", () => {
  const points = [point("FFFF0"), point("FFFF:0000"), point("F000:FFF0", false)];
  assert.deepEqual(decodeXtBreakpoints(JSON.stringify(points)), points);
  assert.deepEqual(decodeXtBreakpoints(JSON.stringify([...points, points[0], { ...points[1], address: 0 }, { address: 1, enabled: true, space: "ram" }])), points);
  for (const text of ["{", "null", "{}", JSON.stringify(Array(65).fill(points[0])), '[{"address":1,"enabled":true,"space":{}}]']) assert.deepEqual(decodeXtBreakpoints(text), []);
  const p = fixture([0x90]); p.debug.setBreakpoints(points);
  for (const invalid of [[points[0]!, points[0]!], [{ ...points[1]!, address: 0 }], [{ address: 0x100000, enabled: true }],
    [{ address: -1, enabled: true }], [{ address: 1.5, enabled: true }]]) {
    assert.throws(() => p.debug.setBreakpoints(invalid), RangeError); assert.deepEqual(p.debug.breakpoints, points);
  }
  p.debug.runTo(parseXtDebugAddress("2001"));
  assert.throws(() => p.debug.runTo({ address: 0xffff0, space: "CS:IP 0000:2000" }));
  assert.equal(p.debug.request, "target");
  assert.match(debuggerStatus({ kind: "breakpoint", location: { address: 0, space: "CS:IP FFFF:0010" } }, undefined, false, formatXtDebugAddress),
    /Breakpoint at CS:IP FFFF:0010 · physical \$00000/);
});

test("XT version-3 layouts gain Debugger once, preserving hidden panels and existing tabs", () => {
  const old = { root: { kind: "tabs", id: "my-tools", active: "snapshot", panels: ["rom", "snapshot"], collapsed: false } } as const;
  const saved = new Map([["dromaios:workspace:xt:3", encodeWorkspaceState(old)]]);
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, text: string) => saved.set(key, text) };
  migrateXtWorkspace(storage);
  const next = decodeWorkspaceState(saved.get(xtWorkspaceKey)!, ["rom", "snapshot", "debugger"]);
  assert.deepEqual(groups(next).map(group => group.panels), [["rom", "snapshot"], ["debugger"]]);
  assert.deepEqual(groups(next)[0], old.root);
  saved.set(xtWorkspaceKey, encodeWorkspaceState(old)); migrateXtWorkspace(storage);
  assert.equal(saved.get(xtWorkspaceKey), encodeWorkspaceState(old));
});
