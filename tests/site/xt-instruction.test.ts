import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../src/components/cpus/generated/8088-cpu.js";
import type { Cpu8088State } from "../../src/components/cpus/generated/8088-cpu.js";
import { createXtSession, stepXtSessionCpu } from "../../site/interactive/xt-session.js";
import { previewXtInstruction, explain8088Address } from "../../site/interactive/xt-instruction-preview.js";
import { decode8088 } from "../../site/interactive/8088-disassembly.js";
import { testFlagCondition } from "../../site/interactive/instruction-shape.js";
import { flags, initialState } from "../components/cpus/8088/helpers.js";
import { xtCatalogue as catalogue } from "./xt-inspection-fixture.js";

function fixture(bytes: readonly number[], overrides: Partial<Cpu8088State> = {}) {
  const session = createXtSession(), machine = session.machine;
  const state = initialState({ cs: 0, ip: 0x2000, ds: 0, ss: 0x1000, flags: flags(0), ...overrides });
  machine.cpu = new Cpu8088(machine.memory, state, { ports: machine.ports });
  bytes.forEach((byte, index) => machine.ram.write(0x2000 + index, byte));
  return session;
}

test("8088 Jcc explanations derived from the chapter agree with all 32 flag combinations", () => {
  for (let bits = 0; bits < 32; bits++) {
    const [cf, pf, zf, sf, of] = [0, 1, 2, 3, 4].map(bit => Boolean(bits & 1 << bit));
    const expected = [of, !of, cf, !cf, zf, !zf, cf || zf, !cf && !zf,
      sf, !sf, pf, !pf, sf !== of, sf === of, zf || sf !== of, !zf && sf === of];
    for (let index = 0; index < 16; index++) {
      const stateFlags = { ...flags(0), cf: cf!, pf: pf!, zf: zf!, sf: sf!, of: of! };
      const condition = catalogue.cpu.instructions[0x70 + index]!.condition!;
      assert.equal(testFlagCondition(condition, stateFlags), expected[index]);
      const session = fixture([0x70 + index, 0x10], { flags: stateFlags });
      const preview = previewXtInstruction(session, catalogue);
      assert.equal(preview.record!.after.ip, expected[index] ? 0x2012 : 0x2002);
      assert.match(preview.effects.join("\n"), new RegExp(`branch ${expected[index] ? "taken" : "not taken"}`));
    }
  }
  // A zero displacement cannot be diagnosed from the resulting IP alone.
  assert.match(previewXtInstruction(fixture([0x74, 0], { flags: { ...flags(0), zf: true } }), catalogue).effects.join("\n"), /branch taken/);
});

test("8088 effective addresses agree with native reads across every memory ModR/M and segment override", () => {
  for (const prefix of [[], [0x26], [0x2e], [0x36], [0x3e, 0x26]]) {
    for (let mode = 0; mode < 3; mode++) for (let rm = 0; rm < 8; rm++) {
      const bytes = [...prefix, 0x8a, mode * 64 + rm, ...(mode === 0 ? rm === 6 ? [0x34, 0x12] : [] : mode === 1 ? [0xf0] : [0xf0, 0xff])];
      const session = fixture(bytes, { bx: 0xfff0, bp: 0x200, si: 0x40, di: 0x30, ds: 0x1000, ss: 0x2000, es: 0x3000 });
      const preview = previewXtInstruction(session, catalogue), data = preview.accesses.at(-1)!;
      assert.equal(preview.row.complete, true); assert.equal(preview.record?.outcome, "executed");
      assert.match(preview.addressing.join("\n"), new RegExp(`physical \\$${data.address.toString(16).toUpperCase().padStart(5, "0")}`));
      const bases = ["BX+SI", "BX+DI", "BP+SI", "BP+DI", "SI", "DI", mode === 0 ? "" : "BP", "BX"][rm]!;
      assert.equal(preview.row.operand?.segment, prefix.length ? prefix.at(-1) === 0x26 ? "ES" : prefix[0] === 0x2e ? "CS" : "SS" : bases.includes("BP") ? "SS" : "DS");
      assert.deepEqual(preview.record, stepXtSessionCpu(session.machine, session.keyboard));
    }
  }
  const direct = previewXtInstruction(fixture([0xa0, 0x34, 0x12]), catalogue);
  assert.match(direct.addressing.join("\n"), /DS:1234 = 0000:1234 → physical \$01234/);
  const lea = previewXtInstruction(fixture([0x8d, 0x46, 0xff], { bp: 0 }), catalogue);
  assert.match(lea.addressing.join("\n"), /→ FFFF.*\nLEA uses the offset alone/);
  assert.equal(lea.record?.after.ax, 0xffff);
  assert.deepEqual(lea.accesses.map(access => access.address), [0x2000, 0x2001, 0x2002]);
  const noMemory = decode8088(catalogue.cpu, 0, 0, i => [0x8b, 0xc4][i]);
  assert.deepEqual(explain8088Address(fixture([]).machine.cpu.snapshot(), noMemory), []);
});

test("XT previews preserve live RAM, video, keyboard, clocks and interrupt devices", t => {
  const session = fixture([0xf3, 0xa4], { cx: 2, si: 0x3000, di: 0x20, es: 0xb800 });
  session.machine.ram.write(0x3000, 0x41); session.keyboard.paste("A");
  const saved = session.snapshot();
  for (const method of ["read", "write"] as const) t.mock.method(session.machine.memory, method, () => assert.fail("Guest memory access"));
  for (const method of ["readPort", "writePort"] as const) t.mock.method(session.machine.ports, method, () => assert.fail("Guest port access"));
  t.mock.method(session.machine.io, "offerScanCode", () => assert.fail("Live keyboard delivery"));
  const preview = previewXtInstruction(session, catalogue);
  assert.equal(preview.record?.after.cx, 1); assert.equal(preview.record?.after.ip, 0x2000);
  assert.deepEqual(preview.accesses.at(-1), { kind: "write", address: 0xb8020, value: 0x41 });
  assert.deepEqual(session.snapshot(), saved);
  const ram = fixture([0xc6, 0x06, 0, 0x30, 0x77]);
  const expected = previewXtInstruction(ram, catalogue); assert.equal(ram.machine.ram.read(0x3000), 0);
  assert.deepEqual(expected.record, stepXtSessionCpu(ram.machine, ram.keyboard));
});

test("XT previews preserve native interrupt, trap, shadow, and halted boundary ordering", () => {
  for (const kind of ["intr", "nmi", "trap", "shadow", "halt"] as const) {
    const session = fixture([0x90], { flags: flags(64), trapPending: kind === "trap", recognitionDeferred: kind === "shadow", halted: kind === "halt" });
    const { io, ram } = session.machine;
    for (const vector of [1, 2, 9]) [0, 0x30, 0, 0].forEach((byte, i) => ram.write(4 * vector + i, byte));
    if (kind === "intr" || kind === "nmi" || kind === "shadow") {
      for (const [port, value] of [[0x63, 0x99], [0x61, 0x40], [0x20, 0x13], [0x21, 8], [0x21, 9], [0x21, 0xfd]]) io.write(port!, value!);
      session.keyboard.down("KeyA");
    }
    if (kind === "nmi") { io.write(0xa0, 0x80); io.setCheckErrors(true, false); }
    const saved = session.snapshot(), preview = previewXtInstruction(session, catalogue);
    assert.deepEqual(session.snapshot(), saved);
    const actual = stepXtSessionCpu(session.machine, session.keyboard);
    assert.deepEqual(preview.record, actual, kind);
    assert.equal(actual.instruction !== null, kind === "shadow", kind);
    if (kind === "intr" || kind === "nmi") { assert.ok("source" in actual); assert.equal(actual.source, kind); }
    if (kind === "trap") assert.match(preview.assembly, /TRAP/);
    if (kind !== "shadow") assert.deepEqual(preview.addressing, []);
  }
});

test("XT previews stop safely at ports, absent storage, WAIT, ESC and excessive prefixes", () => {
  for (const bytes of [[0xe4, 0x60], [0xe6, 0xa0], [0x9b], [0xd8, 0xc0], Array<number>(65).fill(0x26)]) {
    const session = fixture(bytes), saved = session.snapshot(), preview = previewXtInstruction(session, catalogue);
    assert.ok(preview.external || preview.timingUnavailable); assert.equal(preview.record, undefined); assert.deepEqual(session.snapshot(), saved);
    assert.match(preview.effects.join("\n"), /Step to observe|cannot step/);
  }
  const missing = previewXtInstruction(fixture([0xa0, 0, 0], { ds: 0xa000 }), catalogue);
  assert.deepEqual(missing.blocked, { kind: "read", address: 0xa0000 }); assert.equal(missing.record, undefined);
  const ignored = previewXtInstruction(fixture([0xa2, 0, 0], { ds: 0xf000 }), catalogue);
  assert.match(ignored.effects.join("\n"), /ignored by this map/); assert.equal(ignored.record?.outcome, "executed");
  const empty = previewXtInstruction(createXtSession(), catalogue);
  assert.deepEqual(empty.blocked, { kind: "read", address: 0xffff0 });
});

test("a pending XT diskette grant writes the preview overlay before the copied CPU reads it", () => {
  const session = fixture([0xa0, 0, 0x30]); // MOV AL,[3000h]
  const { io, ports, ram } = session.machine;
  const disk = new Uint8Array(368640); disk[0] = 0xa7; io.setDiskette(disk);
  ports.writePort(0x3f2, 0x1c); io.advanceOscillatorTicks(29324);
  ports.writePort(0x3f5, 8); ports.readPort(0x3f5); ports.readPort(0x3f5);
  for (const [port, byte] of [[4, 0], [4, 0x30], [5, 0xff], [5, 1], [11, 0x46], [10, 2]] as const) {
    ports.writePort(port, byte);
  }
  for (const byte of [0xe6, 0, 0, 0, 1, 2, 9, 0x2a, 0xff]) ports.writePort(0x3f5, byte);
  io.advanceOscillatorTicks(470);
  const saved = io.snapshot(), preview = previewXtInstruction(session, catalogue);
  assert.equal(preview.record?.after.al, 0xa7); assert.equal(ram.read(0x3000), 0);
  assert.deepEqual(io.snapshot(), saved);
  assert.deepEqual(stepXtSessionCpu(session.machine, session.keyboard), preview.record);
  assert.equal(ram.read(0x3000), 0xa7);
});
