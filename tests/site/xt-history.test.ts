import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Cpu8088 } from "../../src/components/cpus/generated/8088-cpu.js";
import type { Cpu8088State } from "../../src/components/cpus/generated/8088-cpu.js";
import { RomImage } from "../../src/machines/rom-image.js";
import { romImages } from "../../src/machines/generated/8088/pc-xt.js";
import { createXtSession, stepXtSessionCpu } from "../../site/interactive/xt-session.js";
import { createXtChangeLog, createXtWatchHistory, xtHistoryAssembly } from "../../site/interactive/xt-history.js";
import { createXtDebugger, xtDebugLocation, xtLogicalLocation } from "../../site/interactive/xt-debugger.js";
import { decodeWorkspaceState, encodeWorkspaceState } from "../../site/interactive/workspace/state.js";
import { groups } from "../../site/interactive/workspace/layout.js";
import { migrateXtWorkspace, xtWorkspaceKey } from "../../site/interactive/xt-workspace.js";
import { xtCatalogue as catalogue, xtRomGuide as guide } from "./xt-inspection-fixture.js";
import { flags } from "../components/cpus/8088/helpers.js";

function fixture(bytes: readonly number[], state: Partial<Cpu8088State> = {}, capacity = 500) {
  const session = createXtSession(), machine = session.machine;
  machine.cpu = new Cpu8088(machine.memory, { ...machine.cpu.snapshot(), cs: 0, ip: 0x2000, ss: 0x1000, sp: 0x8000,
    ax: 0x1234, ...state }, { ports: machine.ports });
  bytes.forEach((byte, i) => machine.ram.write(0x2000 + i, byte));
  const log = createXtChangeLog(machine, catalogue.storage, capacity), history = createXtWatchHistory(2), debug = createXtDebugger(() => machine);
  const step = () => {
    const caller = xtDebugLocation(machine.cpu.snapshot()), record = log.capture(() => debug.capture(() => stepXtSessionCpu(machine, session.keyboard)));
    history.observe(record, caller, debug.watchpoints, log.memoryWrites(record)); return record;
  };
  return { session, machine, log, history, debug, step };
}

test("XT change logs retain register, flag and logical-PC changes and little-endian stores across segment wrap", () => {
  const p = fixture([0xb8, 0xff, 0xff, 0x40, 0xa3, 0xff, 0xff], { ds: 0x1000 });
  p.machine.ram.write(0x1ffff, 0x34); p.machine.ram.write(0x10000, 0x12);
  p.step(); p.step(); const stored = p.step(), entries = p.log.entries();
  assert.deepEqual(entries.map(entry => entry.caller), [0x2004, 0x2003, 0x2000].map(ip => ({ address: ip, space: `CS:IP 0000:${ip.toString(16).toUpperCase()}` })));
  assert.deepEqual(entries[1]!.changes.filter(change => change.kind === "register"), [{ kind: "register", target: "AX", before: 0xffff, after: 0, width: 4 }]);
  assert.ok(entries[1]!.changes.some(change => change.target === "ZF" && change.after === 1));
  assert.deepEqual(entries[0]!.changes.filter(change => change.kind === "pc"), [{ kind: "pc", target: "IP", before: 0x2004, after: 0x2007, width: 4 }]);
  assert.deepEqual(p.log.memoryWrites(stored), [
    { storage: "ram", address: 0x1ffff, before: 0x34, after: 0 }, { storage: "ram", address: 0x10000, before: 0x12, after: 0 },
  ]);
  assert.deepEqual(entries[0]!.changes.filter(change => change.kind === "memory").map(change => change.target), ["RAM $1FFFF", "RAM $10000"]);
  p.machine.ram.write(0x2004, 0x90); assert.deepEqual(entries[0]!.instruction!.bytes, [0xa3, 0xff, 0xff]);
});

test("retained 8088 code uses its captured CS:IP for relative targets and distinct physical aliases", () => {
  const a = { address: 0x2000, space: "CS:IP 0000:2000" }, b = { address: 0x2000, space: "CS:IP 0100:1000" };
  assert.equal(xtHistoryAssembly(catalogue.cpu, a, [0xeb, 0xfe]), "JMP 0000:2000");
  assert.equal(xtHistoryAssembly(catalogue.cpu, b, [0xeb, 0xfe]), "JMP 0100:1000");
  assert.deepEqual(xtLogicalLocation({ address: 0, space: "CS:IP FFFF:0010" }), { cs: 0xffff, ip: 0x10 });
  assert.equal(xtLogicalLocation({ address: 1, space: "CS:IP FFFF:0010" }), undefined);
  const p = fixture([0xea, 0, 0x10, 0, 1]); p.step();
  assert.deepEqual(p.log.entries()[0]!.changes.filter(change => change.kind === "pc").map(change => change.target), ["CS", "IP"]);
});

test("disabled XT watchpoints collect unchanged stores with recording paused and retain bounded history", () => {
  const p = fixture([0xa2, 0, 4, 0xa2, 0, 4, 0xa2, 0, 4, 0x90]);
  const watch = { address: 0x400, enabled: false }; p.debug.setWatchpoints([watch]); p.log.recording = false;
  p.step(); p.step(); p.step();
  assert.deepEqual(p.log.entries(), []); assert.equal(p.debug.hit, undefined);
  assert.deepEqual(p.history.entries(watch).map(entry => [entry.sequence, entry.caller.address, entry.storage!.before, entry.storage!.after]), [[2, 0x2003, 0x34, 0x34], [3, 0x2006, 0x34, 0x34]]);
  assert.deepEqual(p.history.counts(watch), { captured: 3, discarded: 1 });
  p.log.clear(); assert.equal(p.history.counts(watch).captured, 3);
  p.history.configure([]); p.history.configure([watch]); assert.equal(p.history.counts(watch).captured, 0);
  p.log.recording = true; p.step(); assert.equal(p.log.entries()[0]!.sequence, 1);
  p.history.reset(); assert.deepEqual(p.history.entries(watch), []);
});

test("REP records one native iteration at a time, including data writes that modify its instruction", () => {
  const p = fixture([0xf3, 0xa4], { cx: 2, si: 0x3000, di: 0x400, es: 0x1000 });
  p.machine.ram.write(0x3000, 0x41); p.machine.ram.write(0x3001, 0x42);
  const watch = { address: 0x10400, enabled: false }; p.debug.setWatchpoints([watch, { address: 0x10401, enabled: false }]);
  p.step(); p.step();
  assert.deepEqual(p.log.entries().map(entry => entry.caller!.address), [0x2000, 0x2000]);
  assert.equal(p.history.entries(watch)[0]!.storage!.after, 0x41);
  assert.equal(p.history.entries({ address: 0x10401 })[0]!.storage!.after, 0x42);
  const self = fixture([0xc6, 0x06, 0, 0x20, 0x90]); self.debug.setWatchpoints([{ address: 0x2000, enabled: false }]); self.step();
  assert.deepEqual(self.history.entries({ address: 0x2000 })[0]!.bytes, [0xc6, 0x06, 0, 0x20, 0x90]);
  assert.equal(self.machine.ram.read(0x2000), 0x90);
});

test("CGA aliases log one physical storage change; RAM watches exclude video, reads, ports and host writes", () => {
  const p = fixture([0xa2, 0x12, 0], { ds: 0xbc00 });
  p.machine.video.write(0x12, 0x11); const record = p.step();
  assert.deepEqual(p.log.memoryWrites(record), [{ storage: "video", address: 0xb8012, before: 0x11, after: 0x34 }]);
  assert.equal(p.log.entries()[0]!.changes.find(change => change.kind === "memory")!.target, "CGA RAM $B8012");
  assert.deepEqual(p.history.entries({ address: 0xb8012 }), []);
  const q = fixture([0xa0, 0, 4, 0xe6, 0x80, 0x90]);
  q.debug.setWatchpoints([{ address: 0x400, enabled: false }, { address: 0x2000, enabled: false }]);
  q.machine.ram.write(0x400, 0x34); q.step(); q.step();
  assert.equal(q.log.entries().flatMap(entry => entry.changes).filter(change => change.kind === "memory").length, 0);
  assert.deepEqual(q.history.entries({ address: 0x400 }), []); assert.deepEqual(q.history.entries({ address: 0x2000 }), []);
});

test("interrupts and traps retain stack writes and boundary identity without inventing an instruction", () => {
  for (const source of ["intr", "nmi", "trap"] as const) {
    const p = fixture([0x90], { flags: flags(64), trapPending: source === "trap" });
    for (const vector of [1, 2, 9]) [0, 0x30, 0, 0].forEach((byte, index) => p.machine.ram.write(4 * vector + index, byte));
    if (source === "intr") {
      for (const [port, value] of [[0x20, 0x13], [0x21, 8], [0x21, 9], [0x21, 0xfd], [0x63, 0x99], [0x61, 0x40]]) p.machine.io.write(port!, value!);
      p.session.keyboard.down("KeyA");
    } else if (source === "nmi") {
      p.machine.io.write(0x63, 0x99); p.machine.io.write(0x61, 0x40);
      p.machine.io.write(0xa0, 0x80); p.machine.io.setCheckErrors(true, false);
    }
    const watch = { address: 0x17ffe, enabled: true }; p.debug.setWatchpoints([watch]);
    const record = p.step(), entry = p.log.entries()[0]!;
    assert.equal(entry.instruction, undefined, source); assert.equal(entry.event, source.toUpperCase());
    assert.equal(entry.caller!.space, "CS:IP 0000:2000"); assert.equal(p.log.memoryWrites(record).length, 6);
    assert.match(p.history.entries(watch)[0]!.event!, new RegExp(source.toUpperCase()));
    assert.equal(p.debug.stop?.kind, "watchpoint");
  }
});

test("history inspection never reads devices; partial failures, resets and disposal retain or discard the right effects", t => {
  const p = fixture([0xe8, 0xfd, 0x0f], {}, 2);
  assert.throws(() => p.log.capture(() => { stepXtSessionCpu(p.machine, p.session.keyboard); throw new Error("After CALL"); }), /After CALL/);
  assert.equal(p.log.entries()[0]!.outcome, "interrupted");
  assert.equal(p.log.entries()[0]!.changes.filter(change => change.kind === "memory").length, 2);
  p.machine.ram.write(0x3000, 0x90); p.machine.ram.write(0x3001, 0x90); p.machine.ram.write(0x3002, 0x90);
  p.step(); p.step(); assert.equal(p.log.entries().length, 2); assert.equal(p.log.discarded, 1);
  t.mock.method(p.machine.memory, "read", () => assert.fail("History read the bus"));
  t.mock.method(p.machine.ports, "readPort", () => assert.fail("History read a device"));
  const saved = p.machine.snapshot();
  p.log.entries(); p.history.entries({ address: 0 }); assert.deepEqual(p.machine.snapshot(), saved);
  p.log.reset(); p.history.reset(); assert.deepEqual(p.log.entries(), []);
  p.log.dispose();
  p.log.capture(() => { p.machine.ram.write(0x400, 0x88); return { before: p.machine.cpu.snapshot(), after: p.machine.cpu.snapshot(), outcome: "halted", instruction: null, accesses: [], clocks: 0 }; });
  assert.deepEqual(p.log.entries(), []);
});

test("version-5 XT layouts gain Changes while preserving active tabs, collapse state and hidden panels", () => {
  const old = { root: { kind: "tabs", id: "mine", panels: ["code", "memory"], active: "memory", collapsed: true } } as const;
  const map = new Map([["dromaios:workspace:xt:5", encodeWorkspaceState(old)]]);
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, text: string) => map.set(key, text) };
  migrateXtWorkspace(storage);
  const saved = map.get(xtWorkspaceKey)!;
  assert.deepEqual(groups(decodeWorkspaceState(saved, ["code", "memory", "log"])), [{ ...old.root, panels: ["code", "memory", "log"] }]);
  migrateXtWorkspace(storage); assert.equal(map.get(xtWorkspaceKey), saved);
});

test("BIOS labels identify the original IRQ1 buffer and IRQ0 tick writes in captured history", {
  skip: !process.env.XT_BIOS_ROM && "Set XT_BIOS_ROM for original BIOS handler histories.",
}, async () => {
  const bios = await RomImage.verify(readFileSync(process.env.XT_BIOS_ROM!), romImages.bios, async bytes => createHash("sha256").update(bytes).digest("hex"));
  const p = fixture([0xeb, 0xfe], { flags: flags(64), ds: 0x1234 }); p.session.install("bios", bios);
  const { io, ram } = p.machine;
  for (const [address, bytes] of [[0x20, [0xa5, 0xfe, 0, 0xf0]], [0x24, [0x87, 0xe9, 0, 0xf0]], [0x70, [0x53, 0xff, 0, 0xf0]]] as const) bytes.forEach((byte, i) => ram.write(address + i, byte));
  ram.write(0x41a, 0x1e); ram.write(0x41c, 0x1e); ram.write(0x440, 10);
  for (const [port, value] of [[0x20, 0x13], [0x21, 8], [0x21, 9], [0x21, 0xfc], [0x63, 0x99], [0x61, 0x4c]]) io.write(port!, value!);
  const label = (name: string) => parseInt(guide.labels.find(label => label.name === name)!.address, 16);
  const names = ["KB_FLAG", "BUFFER_TAIL", "KB_BUFFER", "TIMER_LOW"];
  assert.deepEqual(names.map(label), [0x417, 0x41c, 0x41e, 0x46c]);
  p.debug.setWatchpoints(names.map(name => ({ address: label(name), enabled: false })));
  function handler() {
    assert.equal(p.step().outcome, "accepted");
    for (let count = 0; count < 1000; count++) {
      if (p.machine.cpu.snapshot().cs === 0 && p.machine.cpu.snapshot().ip === 0x2000) { p.step(); return; }
      assert.equal(p.step().outcome, "executed");
    }
    assert.fail("Original interrupt handler did not return");
  }
  for (const scan of [0x2a, 0x1e, 0xaa]) { assert.ok(io.offerScanCode(scan)); handler(); }
  assert.equal(p.history.entries({ address: label("KB_BUFFER") })[0]!.storage!.after, 0x41);
  assert.equal(p.history.entries({ address: label("BUFFER_TAIL") })[0]!.storage!.after, 0x20);
  assert.equal(p.history.entries({ address: label("KB_FLAG") }).at(-1)!.storage!.after, 0);
  io.write(0x43, 0x36); io.write(0x40, 0); io.write(0x40, 0); io.advanceOscillatorTicks(12 * 65537);
  handler();
  const tick = p.history.entries({ address: label("TIMER_LOW") })[0]!;
  assert.equal(tick.storage!.before, 0); assert.equal(tick.storage!.after, 1); assert.match(tick.caller.space!, /^CS:IP F000:/);
  assert.match(xtHistoryAssembly(catalogue.cpu, tick.caller, tick.bytes), /ADD|INC/);
});
