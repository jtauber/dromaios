import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/8088.js";
import type { Cpu8088Escape } from "../../../../src/components/cpus/8088.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, flags, snapshot, segments, address, put, wordBytes, dataReads, reject, interruptFrame, interruptTarget } from "./helpers.js";

// ESC's ooo:ppp fields select the external instruction; only mm/rrr affects CPU addressing.
test("8088 ESC covers all 64 external opcodes and every ModR/M source with a dummy word read", () => {
  const ram = new ObservedRam(0x100000);
  // Literal bases for initialState(), in Intel table 2-26 r/m order; BP-based forms select SS.
  const bases = [[0x2000, 0x3354], [0x2000, 0x3364], [0x3000, 0x9010], [0x3000, 0x9020],
    [0x2000, 0x10], [0x2000, 0x20], [0x3000, 0x9000], [0x2000, 0x3344]] as const;
  for (let external = 0; external < 64; external++) for (let mode = 0; mode < 4; mode++) for (let rm = 0; rm < 8; rm++) {
    const before = initialState({ flags: flags(external * 8 + rm), interruptDeferred: true, recognitionDeferred: true });
    const direct = mode === 0 && rm === 6;
    const displacement = direct ? [0xff, 0xff] : mode === 1 ? [0xe0] : mode === 2 ? [0xfe, 0xff] : [];
    const modRM = mode * 64 + external % 8 * 8 + rm;
    const bytes = [0xd8 + Math.floor(external / 8), modRM, ...displacement];
    const [segment, base] = bases[rm]!;
    const offset = direct ? 0xffff : (base + (mode === 1 ? -32 : mode === 2 ? -2 : 0) + 65536) % 65536;
    const memory = mode === 3 ? null : { segment: direct ? before.ds : segment, offset,
      address: address(direct ? before.ds : segment, offset), value: 0xa55a };
    if (memory) put(ram, memory.segment, offset, [0x5a, 0xa5]);
    put(ram, before.cs, before.ip, bytes); ram.accesses.length = 0;
    const request = { opcode: external, modRM, memory };
    const transfers = [...dataReads(before.cs, before.ip, bytes), ...(memory ? dataReads(memory.segment, offset, [0x5a, 0xa5]) : [])];
    let calls = 0;
    const cpu = new Cpu8088(ram, before, { escape: value => {
      calls++; assert.deepEqual(value, request); assert.deepEqual(ram.accesses, transfers);
      assert.deepEqual(cpu.snapshot(), snapshot({ ...before, ip: before.ip + bytes.length }));
    } });
    assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot({ ...before,
      ip: before.ip + bytes.length, interruptDeferred: false, recognitionDeferred: false, trapPending: before.flags.tf }),
      instruction: { address: snapshot(before).pc, bytes }, outcome: "executed",
      accesses: [...transfers, { kind: "escape", ...request }] });
    assert.equal(calls, 1); assert.deepEqual(ram.accesses, transfers);
  }
});

test("8088 ESC preserves overrides, wraps code and operand offsets, and executes without an attached processor", () => {
  const ram = new ObservedRam(0x100000);
  for (const [prefix, selected] of segments) for (const offset of [0xf, 0xffff]) {
    const before = initialState({ cs: 0xffff, ip: selected === "cs" && offset === 0xffff ? 0xfff8 : 0xfffd, ds: 0x1000, ss: 0x2000, es: 0x3000 });
    const bytes = [0x3e, prefix, 0xf0, 0xdf, 0x3e, ...wordBytes(offset)];
    put(ram, before[selected], offset, [0x34, 0x12]); put(ram, before.cs, before.ip, bytes); ram.accesses.length = 0;
    const record = new Cpu8088(ram, before).step();
    assert.equal(record.outcome, "executed"); assert.equal(record.after.ip, (before.ip + bytes.length) % 65536);
    assert.deepEqual(record.after.flags, before.flags);
    assert.deepEqual(record.accesses, [...dataReads(before.cs, before.ip, bytes), ...dataReads(before[selected], offset, [0x34, 0x12]),
      { kind: "escape", opcode: 63, modRM: 0x3e, memory: { segment: before[selected], offset,
        address: address(before[selected], offset), value: 0x1234 } }]);
  }
  put(ram, 0x1234, 0x100, [0xd8, 0xc0]); ram.accesses.length = 0;
  assert.deepEqual(new Cpu8088(ram, initialState()).step().accesses,
    [...dataReads(0x1234, 0x100, [0xd8, 0xc0]), { kind: "escape", opcode: 0, modRM: 0xc0, memory: null }]);
});

test("8088 ESC request ownership survives device mutation, later steps, and changes to memory", () => {
  const ram = new Ram(0x100000), before = initialState();
  put(ram, before.cs, before.ip, [0xd9, 0x06, 0, 0x80, 0xd8, 0xc0]); put(ram, before.ds, 0x8000, [0x78, 0x56]);
  const requests: Cpu8088Escape[] = [];
  const connection = { escape(request: Cpu8088Escape): void {
    assert.equal(this, connection); requests.push(request);
    Reflect.set(request, "opcode", 0);
    if (request.memory) Reflect.set(request.memory, "value", 0);
  } };
  const cpu = new Cpu8088(ram, before, connection), first = cpu.step(), retained = structuredClone(first);
  assert.deepEqual(first.accesses.at(-1), { kind: "escape", opcode: 8, modRM: 6,
    memory: { segment: before.ds, offset: 0x8000, address: 0x28000, value: 0x5678 } });
  put(ram, before.ds, 0x8000, [0, 0]); cpu.step();
  assert.deepEqual(first, retained); assert.equal(requests.length, 2);
  Reflect.set(first.after.flags, "cf", false); assert.equal(cpu.snapshot().flags.cf, true);
});

test("8088 WAIT samples TEST once per step, pauses without refetch, and restores at either address wrap", () => {
  for (const [cs, ip] of [[0xffff, 0xffff], [0xffff, 0xf]]) {
    const ram = new ObservedRam(0x100000), before = initialState({ cs: cs!, ip: ip!, interruptDeferred: true, recognitionDeferred: true });
    put(ram, before.cs, before.ip, [0x9b, 0x90]); ram.accesses.length = 0;
    let high = true, calls = 0;
    const connection = { test(): boolean { assert.equal(this, connection); calls++; return high; } };
    let cpu = new Cpu8088(ram, before, connection);
    const first = cpu.step(), waiting = snapshot({ ...before, waiting: true, interruptDeferred: false, recognitionDeferred: false });
    assert.deepEqual(first, { before: snapshot(before), after: waiting, instruction: { address: snapshot(before).pc, bytes: [0x9b] },
      outcome: "waiting", accesses: [...dataReads(before.cs, before.ip, [0x9b]), { kind: "test", high: true }] });
    cpu = new Cpu8088(ram, cpu.snapshot(), connection);
    put(ram, before.cs, before.ip, [0xd6]); ram.accesses.length = 0; // A paused WAIT does not refetch edited code.
    assert.deepEqual(cpu.step(), { before: waiting, after: waiting, instruction: null, outcome: "waiting", accesses: [{ kind: "test", high: true }] });
    high = false;
    const released = snapshot({ ...before, ip: (before.ip + 1) % 65536, interruptDeferred: false, recognitionDeferred: true });
    assert.deepEqual(cpu.step(), { before: waiting, after: released, instruction: null, outcome: "executed", continuation: "wait",
      accesses: [{ kind: "test", high: false }] });
    assert.deepEqual(ram.accesses, []); assert.equal(calls, 3);
    assert.equal(cpu.interrupt("nmi").outcome, "ignored");
    cpu.step(); assert.equal(cpu.snapshot().recognitionDeferred, false); assert.equal(calls, 3);
  }
});

test("8088 WAIT preserves every flag pattern and defers all recognition on immediate TEST release", () => {
  const ram = new Ram(0x100000);
  for (let bits = 0; bits < 512; bits++) {
    const before = initialState({ flags: flags(bits), interruptDeferred: true, recognitionDeferred: true });
    put(ram, before.cs, before.ip, [0x9b, 0xd8, 0xc0]);
    const cpu = new Cpu8088(ram, before, { test: () => false });
    const first = cpu.step();
    assert.deepEqual(first.after, snapshot({ ...before, ip: before.ip + 1, interruptDeferred: false, recognitionDeferred: true,
      trapPending: before.flags.tf }));
    assert.equal(first.outcome, "executed");
    for (const source of ["intr", "nmi"] as const) {
      const record = source === "nmi" ? cpu.interrupt(source) : cpu.interrupt(source, () => assert.fail("WAIT inhibition"));
      assert.equal(record.outcome, "ignored"); if (record.outcome === "ignored") assert.equal(record.reason, "deferred");
    }
    assert.deepEqual(cpu.step().instruction?.bytes, [0xd8, 0xc0], "ESC precedes any owed trap");
    assert.equal(cpu.snapshot().recognitionDeferred, false);
    assert.equal(cpu.snapshot().trapPending, before.flags.tf);
  }
});

test("8088 WAIT busy boundaries admit INTR, NMI, and traps and save the WAIT opcode after prefixes", () => {
  for (const source of ["intr", "nmi", "trap"] as const) {
    const ram = new ObservedRam(0x100000);
    const before = initialState({ ip: 0xfffe, flags: { ...flags(0), if: source === "intr", tf: source === "trap" },
      interruptDeferred: true, recognitionDeferred: true });
    const bytes = [0x26, 0xf0, 0x9b]; put(ram, before.cs, before.ip, bytes);
    const vector = source === "intr" ? 0x20 : source === "nmi" ? 2 : 1;
    put(ram, 0, vector * 4, interruptTarget); put(ram, 0x4321, 0x5678, [0xcf]);
    let calls = 0; const connection = { test: () => { calls++; return true; } };
    const cpu = new Cpu8088(ram, before, connection), first = cpu.step(), waiting = cpu.snapshot();
    assert.equal(first.outcome, source === "trap" ? "executed" : "waiting");
    assert.equal(waiting.ip, 0); assert.equal(waiting.waiting, true); ram.accesses.length = 0;
    const record = source === "trap" ? cpu.step() : source === "nmi" ? cpu.interrupt("nmi") : cpu.interrupt("intr", () => vector);
    const expected = [...dataReads(0, vector * 4, interruptTarget), ...interruptFrame(waiting, 0)];
    assert.deepEqual(record.accesses, [...(source === "intr" ? [{ kind: "acknowledge", value: vector }] : []), ...expected]);
    assert.equal(record.after.waiting, false); assert.equal(calls, 1);
    cpu.step(); assert.equal(cpu.snapshot().ip, 0); assert.equal(cpu.snapshot().waiting, false);
    assert.deepEqual(cpu.step().instruction?.bytes, [0x9b]); assert.equal(calls, 2);
    assert.equal(cpu.snapshot().waiting, true);
  }
});

test("8088 WAIT masked requests retain detached snapshots; reset clears waiting without calling TEST", () => {
  const ram = new ObservedRam(0x100000), before = initialState({ waiting: true, flags: flags(0) });
  let calls = 0; const cpu = new Cpu8088(ram, before, { test: () => { calls++; return true; } });
  const ignored = cpu.interrupt("intr", () => assert.fail("masked WAIT"));
  assert.deepEqual(ignored.before, ignored.after); assert.equal(ignored.outcome, "ignored"); assert.equal(ignored.after.waiting, true);
  Reflect.set(ignored.before, "waiting", false); assert.equal(ignored.after.waiting, true); assert.equal(cpu.snapshot().waiting, true);
  assert.equal(cpu.step().outcome, "waiting");
  const reset = cpu.reset(); assert.equal(reset.after.waiting, false); assert.equal(calls, 1); assert.deepEqual(ram.accesses, []);
  const restored = new Cpu8088(ram, reset.after, { test: () => false });
  put(ram, 0xffff, 0, [0x9b]); assert.equal(restored.step().outcome, "executed");
});

test("8088 ESC and WAIT reject repeated prefixes before accessing a device", () => {
  const ram = new ObservedRam(0x100000);
  for (const prefix of [0xf2, 0xf3]) for (const opcode of [0x9b, 0xd8, 0xdf]) {
    const before = initialState({ recognitionDeferred: true, trapPending: true });
    const bytes = [0x26, prefix, opcode]; put(ram, before.cs, before.ip, bytes); ram.accesses.length = 0;
    const cpu = new Cpu8088(ram, before, { test: () => assert.fail("rejected WAIT"), escape: () => assert.fail("rejected ESC") });
    assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(before), instruction: { address: snapshot(before).pc, bytes },
      outcome: "unsupported", reason: "opcode", accesses: dataReads(before.cs, before.ip, bytes) });
  }
});

test("8088 external callback failures preserve completed effects and inhibition and release the execution guard", () => {
  const marker = new Error("external device failure");
  for (const operation of ["escape", "test"] as const) for (const resuming of [false, true]) {
    if (operation === "escape" && resuming) continue;
    const ram = new ObservedRam(0x100000);
    const before = initialState({ waiting: resuming, recognitionDeferred: true, interruptDeferred: true });
    const bytes = operation === "test" ? [0x9b] : [0xd8, 0x06, 0, 0x80];
    put(ram, before.cs, before.ip, bytes); put(ram, before.ds, 0x8000, [0x34, 0x12]); ram.accesses.length = 0;
    let calls = 0;
    const fail = (): never => { calls++; throw marker; };
    const cpu = new Cpu8088(ram, before, { escape: fail, test: fail });
    assert.throws(() => cpu.step(), error => error === marker);
    assert.deepEqual(cpu.snapshot(), snapshot({ ...before, ip: before.ip + (resuming ? 0 : bytes.length) }));
    assert.equal(calls, 1);
    assert.deepEqual(ram.accesses, [...(resuming ? [] : dataReads(before.cs, before.ip, bytes)),
      ...(operation === "escape" ? dataReads(before.ds, 0x8000, [0x34, 0x12]) : [])]);
    assert.equal(cpu.reset().after.waiting, false); assert.equal(calls, 1);
  }
  for (const value of [undefined, null, 0, 1, "false", NaN]) {
    const ram = new Ram(0x100000), before = initialState(); put(ram, before.cs, before.ip, [0x9b]);
    const cpu = new Cpu8088(ram, before, { test: () => value as unknown as boolean });
    assert.throws(() => cpu.step(), /Boolean pin level/);
    assert.deepEqual(cpu.snapshot(), snapshot({ ...before, ip: before.ip + 1 }));
  }
  const ram = new Ram(0x100000), before = initialState(); put(ram, before.cs, before.ip, [0x9b]);
  const cpu = new Cpu8088(ram, before); assert.throws(() => cpu.step(), /TEST input connection/);
  assert.deepEqual(cpu.snapshot(), snapshot({ ...before, ip: before.ip + 1 }));
});

test("8088 ESC and TEST callbacks can inspect state but cannot reenter any CPU operation", () => {
  for (const bytes of [[0xd8, 0xc0], [0x9b]]) {
    const ram = new Ram(0x100000), before = initialState(); put(ram, before.cs, before.ip, bytes);
    const inspect = (): false => {
      const saved = cpu.snapshot();
      for (const operation of [() => cpu.step(), () => cpu.reset(), () => cpu.interrupt("nmi"), () => cpu.interrupt("intr", () => 2)]) {
        assert.throws(operation, /must not be reentrant/); assert.deepEqual(cpu.snapshot(), saved);
      }
      return false;
    };
    const cpu = new Cpu8088(ram, before, { escape: inspect, test: inspect });
    assert.equal(cpu.step().outcome, "executed");
  }
});

test("8088 ESC does not issue its external request if either dummy word byte fails", () => {
  const marker = new Error("operand read failure");
  for (const failedAddress of [0x2ffff, 0x20000]) {
    class FailingRam extends ObservedRam {
      override read(location: number): number {
        if (location === failedAddress) throw marker;
        return super.read(location);
      }
    }
    const ram = new FailingRam(0x100000), before = initialState({ interruptDeferred: true });
    const bytes = [0xdb, 0x06, 0xff, 0xff]; put(ram, before.cs, before.ip, bytes); put(ram, before.ds, 0xffff, [0x34, 0x12]);
    ram.accesses.length = 0;
    const cpu = new Cpu8088(ram, before, { escape: () => assert.fail("incomplete operand") });
    assert.throws(() => cpu.step(), error => error === marker);
    assert.deepEqual(cpu.snapshot(), snapshot({ ...before, ip: before.ip + 4 }));
    assert.deepEqual(ram.accesses, [...dataReads(before.cs, before.ip, bytes),
      ...(failedAddress === 0x20000 ? dataReads(before.ds, 0xffff, [0x34]) : [])]);
    cpu.reset();
  }
});
