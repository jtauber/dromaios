import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/8088.js";
import type { Cpu8088Flags, Cpu8088State } from "../../../../src/components/cpus/8088.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { runCpu } from "../../../../src/runtime/run-cpu.js";
import { initialState, flags, snapshot, checkStep, words, address, put, wordBytes, dataReads, reject, interruptFrame, interruptTarget, entered } from "./helpers.js";

test("8088 INT n selects all 256 vectors and stacks the post-fetch logical address across both address wraps", () => {
  const ram = new ObservedRam(0x100000);
  for (let vector = 0; vector < 256; vector++) for (const [cs, ip] of [[0xffff, 0xfffe], [0xffff, 0xf]]) {
    const before = initialState({ cs, ip, ss: 0xffff, sp: vector % 2, flags: flags(vector * 2) });
    const bytes = [0xcd, vector];
    put(ram, 0, vector * 4, interruptTarget);
    put(ram, cs!, ip!, bytes);
    // At FFFF:000F the immediate byte aliases vector 0; use the actual vector bytes fetched from RAM.
    const target = Array.from({ length: 4 }, (_, i) => ram.read(vector * 4 + i));
    const cpu = new Cpu8088(ram, before);
    ram.accesses.length = 0;
    const after = { ...entered(before), ip: target[0]! + target[1]! * 256, cs: target[2]! + target[3]! * 256, trapPending: before.flags.tf };
    const accesses = [...dataReads(cs!, ip!, bytes), ...dataReads(0, vector * 4, target), ...interruptFrame(before, (ip! + 2) % 65536)];
    assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(after), outcome: "executed",
      instruction: { address: snapshot(before).pc, bytes }, interrupt: { source: "software", vector }, accesses });
    assert.deepEqual(ram.accesses, accesses);
  }
});

test("8088 INT3 and INTO obey every flag combination; untaken INTO only fetches its opcode", () => {
  const ram = new ObservedRam(0x100000);
  for (let bits = 0; bits < 512; bits++) for (const opcode of [0xcc, 0xce]) {
    const before = initialState({ flags: flags(bits), interruptDeferred: true, recognitionDeferred: true });
    const vector = opcode === 0xcc ? 3 : 4, taken = opcode === 0xcc || before.flags.of;
    put(ram, 0, vector * 4, interruptTarget); put(ram, before.cs, before.ip, [opcode]);
    ram.accesses.length = 0;
    const record = new Cpu8088(ram, before).step();
    const after = taken ? entered(before) : { ...before, ip: before.ip + 1, interruptDeferred: false, recognitionDeferred: false };
    assert.deepEqual(record.after, snapshot({ ...after, trapPending: before.flags.tf }));
    assert.equal(record.outcome, "executed");
    assert.deepEqual(record.interrupt, taken ? { source: "software", vector } : undefined);
    assert.deepEqual(record.accesses, [...dataReads(before.cs, before.ip, [opcode]),
      ...(taken ? [...dataReads(0, vector * 4, interruptTarget), ...interruptFrame(before, before.ip + 1)] : [])]);
    assert.deepEqual(ram.accesses, record.accesses);
  }
});

test("8088 external delivery reads vectors before an overlapping stack and acknowledges only INTR", () => {
  const ram = new ObservedRam(0x100000);
  for (const source of ["intr", "nmi"] as const) for (const sp of [10, 12, 14]) {
    const before = initialState({ ss: 0, sp, halted: true, trapPending: true });
    put(ram, 0, 8, interruptTarget); ram.accesses.length = 0;
    const cpu = new Cpu8088(ram, before);
    let calls = 0;
    const record = source === "nmi" ? cpu.interrupt("nmi") : cpu.interrupt("intr", () => {
      calls++; assert.equal(cpu.snapshot().halted, false); assert.equal(cpu.snapshot().flags.if, true);
      assert.deepEqual(ram.accesses, []); return 2;
    });
    assert.equal(calls, source === "intr" ? 1 : 0);
    const memory = [...dataReads(0, 8, interruptTarget), ...interruptFrame(before)];
    assert.deepEqual(record, { before: snapshot(before), after: snapshot(entered(before)), source, instruction: null,
      outcome: "accepted", vector: 2, accesses: [...(source === "intr" ? [{ kind: "acknowledge", value: 2 }] : []), ...memory] });
    assert.deepEqual(ram.accesses, memory);
  }
});

test("8088 masks INTR with IF, defers both sources after segment loads, and never queues ignored offers", () => {
  const ram = new ObservedRam(0x100000);
  for (const source of ["intr", "nmi"] as const) for (const enabled of [false, true]) {
    for (const interruptDeferred of [false, true]) for (const recognitionDeferred of [false, true]) {
      const before = initialState({ halted: true, interruptDeferred, recognitionDeferred, flags: { ...flags(0), if: enabled } });
      put(ram, 0, 8, interruptTarget); ram.accesses.length = 0;
      const cpu = new Cpu8088(ram, before);
      let calls = 0;
      const record = source === "nmi" ? cpu.interrupt("nmi") : cpu.interrupt("intr", () => { calls++; return 2; });
      const deferred = recognitionDeferred || source === "intr" && interruptDeferred;
      const ignored = deferred || source === "intr" && !enabled;
      assert.equal(record.outcome, ignored ? "ignored" : "accepted");
      assert.equal(calls, !ignored && source === "intr" ? 1 : 0);
      if (ignored) {
        assert.deepEqual(record, { before: snapshot(before), after: snapshot(before), source, instruction: null,
          outcome: "ignored", reason: deferred ? "deferred" : "masked", accesses: [] });
        assert.deepEqual(ram.accesses, []);
      }
    }
  }
});

test("8088 CLI/STI preserve other flags, delay only IF transitions, and another STI consumes an existing delay", () => {
  const ram = new ObservedRam(0x100000);
  for (let bits = 0; bits < 512; bits++) for (const enabled of [false, true]) {
    const before = initialState({ flags: flags(bits), interruptDeferred: true });
    checkStep(ram, before, [enabled ? 0xfb : 0xfa], { ...before, ip: before.ip + 1,
      interruptDeferred: enabled && !before.flags.if, flags: { ...before.flags, if: enabled } });
  }
  for (const second of [0x90, 0xfb, 0xfa, 0xf4]) {
    const before = initialState({ flags: flags(0) });
    put(ram, before.cs, before.ip, [0xfb, second]); put(ram, 0, 8, interruptTarget);
    const cpu = new Cpu8088(ram, before);
    cpu.step();
    assert.equal(cpu.interrupt("intr", () => { throw new Error("deferred INTR acknowledged"); }).outcome, "ignored");
    cpu.step();
    assert.equal(cpu.snapshot().interruptDeferred, false);
    assert.equal(cpu.interrupt("intr", () => 2).outcome, second === 0xfa ? "ignored" : "accepted");
  }
});

test("8088 MOV/POP into ES, SS, or DS delays NMI and traps through the following instruction; LES/LDS do not", () => {
  const ram = new ObservedRam(0x100000);
  for (const bytes of [[0x8e, 0xc0], [0x8e, 0xd0], [0x8e, 0xd8], [0x07], [0x17], [0x1f]]) {
    const before = initialState({ flags: { ...flags(0), tf: true } });
    put(ram, before.ss, before.sp, [0x00, 0x50]);
    put(ram, before.cs, before.ip, [...bytes, 0x90]); put(ram, 0, 4, interruptTarget);
    const cpu = new Cpu8088(ram, before);
    cpu.step();
    const delayed = cpu.snapshot();
    assert.equal(delayed.recognitionDeferred, true); assert.equal(delayed.trapPending, true);
    assert.equal(cpu.interrupt("nmi").outcome, "ignored");
    const restored = new Cpu8088(ram, delayed);
    assert.deepEqual(restored.step().instruction?.bytes, [0x90]);
    assert.equal(restored.snapshot().recognitionDeferred, false);
    assert.equal(restored.step().instruction, null);
  }
  for (const opcode of [0xc4, 0xc5]) {
    const before = initialState(); put(ram, before.cs, before.ip, [opcode, 0x06, 0, 0]);
    put(ram, before.ds, 0, interruptTarget);
    assert.equal(new Cpu8088(ram, before).step().after.recognitionDeferred, false);
  }
});

test("8088 POPF and IRET sample old TF, restore IF with its delay, and IRET reads IP, CS, then FLAGS across wrapping stacks", () => {
  const ram = new ObservedRam(0x100000);
  const positions = { cf: 0, pf: 2, af: 4, zf: 6, sf: 7, tf: 8, if: 9, df: 10, of: 11 } as const;
  for (const oldTF of [false, true]) for (const oldIF of [false, true]) for (let bits = 0; bits < 512; bits++) {
    for (const opcode of [0x9d, 0xcf]) {
      const before = initialState({ ss: 0xffff, sp: 0xffff, flags: { ...flags(0), tf: oldTF, if: oldIF } });
      const nextFlags = flags(bits), packed = Object.entries(positions).reduce((sum, [name, bit]) => sum + (nextFlags[name as keyof Cpu8088Flags] ? 2 ** bit : 0), 0);
      const frame = [...(opcode === 0xcf ? interruptTarget : []), ...wordBytes(packed)];
      put(ram, before.ss, before.sp, frame);
      checkStep(ram, before, [opcode], { ...before, ip: opcode === 0xcf ? 0x5678 : before.ip + 1,
        cs: opcode === 0xcf ? 0x4321 : before.cs, sp: (before.sp + frame.length) % 65536, flags: nextFlags,
        interruptDeferred: !oldIF && nextFlags.if }, undefined, dataReads(before.ss, before.sp, frame));
    }
  }
});

test("8088 single-step traps run before the next fetch, including after POPF clears TF and after a trapped HLT", () => {
  const ram = new ObservedRam(0x100000);
  for (const opcode of [0x90, 0x9d, 0xf4]) {
    const before = initialState({ flags: { ...flags(0), tf: true } });
    put(ram, before.cs, before.ip, [opcode]); put(ram, before.ss, before.sp, [2, 0xf0]); put(ram, 0, 4, interruptTarget);
    const cpu = new Cpu8088(ram, before);
    const result = runCpu(cpu, { maxSteps: 2 });
    assert.equal(result.stopReason, "step-limit");
    const pending = result.records[0]!.after;
    assert.equal(pending.trapPending, true);
    assert.deepEqual(result.records[1], { before: pending, after: snapshot({ ...entered(pending), trapPending: false }),
      instruction: null, outcome: "executed", interrupt: { source: "trap", vector: 1 },
      accesses: [...dataReads(0, 4, interruptTarget), ...interruptFrame(pending)] });
  }
  const before = initialState({ flags: flags(0) });
  put(ram, before.cs, before.ip, [0x9d, 0x90]); put(ram, before.ss, before.sp, [2, 0xf1]);
  const cpu = new Cpu8088(ram, before);
  assert.equal(cpu.step().after.trapPending, false, "POPF setting TF does not trap itself");
  assert.deepEqual(cpu.step().instruction?.bytes, [0x90]);
  assert.equal(cpu.snapshot().trapPending, true);
});

test("8088 higher-priority software, divide, INTR and NMI entry retain an owed trap before the handler's first instruction", () => {
  const ram = new ObservedRam(0x100000);
  for (const source of ["software", "divide-error", "intr", "nmi"] as const) {
    const before = initialState({ ax: 1, bx: 0, flags: { ...flags(0), tf: true, if: true } });
    for (const vector of [0, 2, 3]) put(ram, 0, vector * 4, interruptTarget);
    put(ram, 0, 4, [0xbc, 0x9a, 0x65, 0x87]);
    const bytes = source === "software" ? [0xcc] : source === "divide-error" ? [0xf6, 0xf3] : [0x90];
    put(ram, before.cs, before.ip, bytes);
    const cpu = new Cpu8088(ram, before); cpu.step();
    if (source === "intr") cpu.interrupt("intr", () => 2);
    if (source === "nmi") cpu.interrupt("nmi");
    const handler = cpu.snapshot();
    assert.equal(handler.trapPending, true); assert.equal(handler.flags.tf, false);
    const record = cpu.step();
    assert.equal(record.instruction, null); assert.equal(record.interrupt?.source, "trap");
    assert.equal(record.after.pc, 0x87650 + 0x9abc);
    assert.deepEqual(record.accesses, [...dataReads(0, 4, [0xbc, 0x9a, 0x65, 0x87]), ...interruptFrame(handler)]);
  }
});

test("8088 interrupt and IRET resume REP at the first prefix without repeating a completed element", () => {
  const ram = new ObservedRam(0x100000);
  const before = initialState({ cx: 3, flags: { ...flags(0), if: true } });
  put(ram, before.cs, before.ip, [0x26, 0xf3, 0xa4]);
  put(ram, before.es, before.si, [0x11, 0x22, 0x33]);
  put(ram, 0, 8, interruptTarget); put(ram, 0x4321, 0x5678, [0xcf]);
  const cpu = new Cpu8088(ram, before); cpu.step();
  const interrupted = cpu.snapshot(); assert.equal(interrupted.ip, before.ip); assert.equal(interrupted.cx, 2);
  cpu.interrupt("nmi"); cpu.step();
  assert.deepEqual(cpu.snapshot(), { ...interrupted, interruptDeferred: true });
  cpu.step(); cpu.step();
  assert.equal(cpu.snapshot().cx, 0); assert.equal(cpu.snapshot().ip, before.ip + 3);
  assert.deepEqual([0, 1, 2].map(i => ram.read(before.es * 16 + before.di + i)), [0x11, 0x22, 0x33]);
});

test("8088 snapshots validate and retain every interrupt latch; reset clears them without memory access", () => {
  const ram = new ObservedRam(0x100000);
  for (const latch of ["waiting", "interruptDeferred", "recognitionDeferred", "trapPending"] as const) {
    for (const value of [0, 1, undefined, "false"]) {
      assert.throws(() => new Cpu8088(ram, { ...initialState(), [latch]: value } as Cpu8088State), TypeError);
    }
  }
  const before = initialState({ halted: true, interruptDeferred: true, recognitionDeferred: true, trapPending: true });
  const cpu = new Cpu8088(ram, before), saved = cpu.snapshot();
  const restored = new Cpu8088(ram, saved);
  Reflect.set(saved, "trapPending", false);
  assert.equal(cpu.snapshot().trapPending, true); assert.equal(restored.snapshot().trapPending, true);
  const record = restored.reset();
  assert.deepEqual(record.after, snapshot({ ...before, cs: 0xffff, ip: 0, ds: 0, es: 0, ss: 0,
    halted: false, waiting: false, interruptDeferred: false, recognitionDeferred: false, trapPending: false, flags: flags(0) }));
  assert.deepEqual(ram.accesses, []);
});

test("8088 rejected and failed instructions preserve outstanding inhibition instead of consuming it", () => {
  const ram = new ObservedRam(0x100000);
  const before = initialState({ interruptDeferred: true, recognitionDeferred: true, trapPending: true });
  put(ram, before.cs, before.ip, [0xd6]);
  const cpu = new Cpu8088(ram, before);
  assert.equal(cpu.step().outcome, "unsupported"); assert.deepEqual(cpu.snapshot(), snapshot(before));
  put(ram, before.cs, before.ip, [0xec]);
  assert.throws(() => cpu.step(), /connected device/);
  assert.deepEqual(cpu.snapshot(), snapshot({ ...before, ip: before.ip + 1 }));
});

test("8088 entry failures expose completed vector reads and frame writes without inventing rollback", () => {
  const marker = new Error("memory failure");
  for (const source of ["software", "intr", "nmi", "trap"] as const) for (let failure = 0; failure < 10; failure++) {
    let armed = false, count = 0;
    class FailingRam extends ObservedRam {
      override read(address: number): number {
        if (armed && count++ === failure) throw marker;
        return super.read(address);
      }
      override write(address: number, value: number): void {
        if (armed && count++ === failure) throw marker;
        super.write(address, value);
      }
    }
    const ram = new FailingRam(0x100000);
    const before = initialState({ flags: { ...flags(0), if: true }, halted: source === "intr" || source === "nmi",
      trapPending: source === "trap" });
    const vector = source === "software" ? 3 : source === "trap" ? 1 : 2;
    put(ram, 0, vector * 4, interruptTarget); put(ram, before.cs, before.ip, [0xcc]);
    const cpu = new Cpu8088(ram, before);
    ram.accesses.length = 0;
    // Software entry includes one successful opcode fetch before the ten vector/frame transfers.
    count = source === "software" ? -1 : 0; armed = true;
    assert.throws(() => source === "intr" ? cpu.interrupt("intr", () => 2)
      : source === "nmi" ? cpu.interrupt("nmi") : cpu.step(), error => error === marker);
    const ip = before.ip + (source === "software" ? 1 : 0);
    const completed = [...dataReads(0, vector * 4, interruptTarget), ...interruptFrame(before, ip)].slice(0, failure);
    assert.deepEqual(ram.accesses, [...(source === "software" ? dataReads(before.cs, before.ip, [0xcc]) : []), ...completed]);
    assert.deepEqual(cpu.snapshot(), snapshot({ ...before, ip,
      sp: failure < 4 ? before.sp : (before.sp + 65534 - Math.floor((failure - 4) / 2) * 2) % 65536,
      halted: false, trapPending: false, flags: { ...before.flags, if: failure < 4 } }));
    armed = false;
    assert.doesNotThrow(() => cpu.reset(), "boundary guard is released after failure");
  }
});

test("8088 IRET failures retain completed pops and commit CS:IP only after both return words", () => {
  const marker = new Error("stack failure");
  for (let failure = 0; failure < 6; failure++) {
    let armed = false, count = -1;
    class FailingRam extends ObservedRam {
      override read(address: number): number {
        if (armed && count++ === failure) throw marker;
        return super.read(address);
      }
    }
    const ram = new FailingRam(0x100000), before = initialState({ flags: flags(0) });
    const frame = [...interruptTarget, 0x02, 0xf3];
    put(ram, before.ss, before.sp, frame); put(ram, before.cs, before.ip, [0xcf]);
    ram.accesses.length = 0;
    const cpu = new Cpu8088(ram, before); armed = true;
    assert.throws(() => cpu.step(), error => error === marker);
    assert.deepEqual(ram.accesses, [...dataReads(before.cs, before.ip, [0xcf]), ...dataReads(before.ss, before.sp, frame).slice(0, failure)]);
    assert.deepEqual(cpu.snapshot(), snapshot({ ...before, sp: before.sp + Math.floor(failure / 2) * 2,
      ip: failure >= 4 ? 0x5678 : before.ip + 1, cs: failure >= 4 ? 0x4321 : before.cs }));
    armed = false; assert.doesNotThrow(() => cpu.reset());
  }
});

test("8088 INTR validates a single acknowledged byte; missing, invalid, or throwing callbacks never read the vector", () => {
  const ram = new ObservedRam(0x100000);
  const before = initialState({ halted: true });
  for (const value of [-1, 256, 0.5, NaN, Infinity, "02", undefined]) {
    const cpu = new Cpu8088(ram, before); let calls = 0;
    assert.throws(() => cpu.interrupt("intr", () => { calls++; return value as number; }), RangeError);
    assert.equal(calls, 1); assert.deepEqual(cpu.snapshot(), snapshot({ ...before, halted: false }));
    assert.deepEqual(ram.accesses, []);
  }
  const cpu = new Cpu8088(ram, before);
  assert.throws(() => Reflect.apply(cpu.interrupt, cpu, ["intr"]), /acknowledge callback/);
  assert.deepEqual(cpu.snapshot(), snapshot(before));
  assert.throws(() => Reflect.apply(cpu.interrupt, cpu, ["irq"]), /source must be/);
  const marker = new Error("acknowledge failure");
  assert.throws(() => cpu.interrupt("intr", () => { throw marker; }), error => error === marker);
  assert.deepEqual(cpu.snapshot(), snapshot({ ...before, halted: false }));
  assert.deepEqual(ram.accesses, []);
});

test("8088 all entry callbacks permit inspection but reject reentrant step, reset, INTR, and NMI", () => {
  const ram = new ObservedRam(0x100000);
  put(ram, 0, 8, interruptTarget);
  const cpu = new Cpu8088(ram, initialState());
  cpu.interrupt("intr", () => {
    const saved = cpu.snapshot();
    for (const operation of [() => cpu.step(), () => cpu.reset(), () => cpu.interrupt("nmi"), () => cpu.interrupt("intr", () => 2)]) {
      assert.throws(operation, /8088 step, reset, and interrupt calls must not be reentrant/);
      assert.deepEqual(cpu.snapshot(), saved);
    }
    return 2;
  });
  assert.equal(cpu.snapshot().pc, 0x43210 + 0x5678);
});

test("8088 a halted program resumes through an INTR handler, port output, IRET, and restored inhibition", () => {
  const ram = new ObservedRam(0x100000);
  const before = initialState({ flags: flags(0) });
  put(ram, before.cs, before.ip, [0xfb, 0xf4, 0x90, 0xf4]);
  put(ram, 0, 0x80, interruptTarget);
  put(ram, 0x4321, 0x5678, [0x50, 0xb0, 0x41, 0xe6, 0x80, 0x58, 0xcf]);
  const outputs: number[][] = [];
  const ports = { readPort: (): number => { throw new Error("unexpected input"); }, writePort: (port: number, value: number): void => { outputs.push([port, value]); } };
  const cpu = new Cpu8088(ram, before, { ports });
  assert.equal(runCpu(cpu, { maxSteps: 2 }).stopReason, "halted");
  const halted = cpu.snapshot();
  assert.equal(cpu.interrupt("intr", () => 0x20).outcome, "accepted");
  const handler = runCpu(cpu, { maxSteps: 5 });
  assert.equal(handler.stopReason, "step-limit");
  assert.deepEqual(outputs, [[0x80, 0x41]]);
  assert.deepEqual(cpu.snapshot(), { ...halted, halted: false, waiting: false, interruptDeferred: true });
  const restored = new Cpu8088(ram, cpu.snapshot(), { ports });
  assert.equal(restored.interrupt("intr", () => { throw new Error("IRET deferral"); }).outcome, "ignored");
  assert.equal(runCpu(restored, { maxSteps: 2 }).stopReason, "halted");
  assert.deepEqual(restored.snapshot(), snapshot({ ...before, ip: before.ip + 4, halted: true, flags: { ...before.flags, if: true } }));
});
