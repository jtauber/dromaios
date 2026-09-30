import assert from "node:assert/strict";
import { test } from "node:test";
import { SerialSession } from "../../src/runtime/serial-session.js";
import { create8080AltairSerial } from "../../src/machines/generated/8080/altair-serial.js";

test("a session paces an owned tape before keyboard input through the real serial receive latch", () => {
  const tape = [0, 255], keyboard = [42, 42];
  const session = new SerialSession(output => create8080AltairSerial({ serial: output }), tape);
  session.send(keyboard);
  tape[0] = 99; keyboard[0] = 99;
  const before = session.machine.cpu.snapshot();
  assert.deepEqual(session.run(10), { records: [], stopReason: "paused" });
  assert.deepEqual(session.machine.cpu.snapshot(), before);
  assert.equal(session.tapePosition, 0);
  assert.equal(session.pendingInput, 2);
  session.start();
  assert.deepEqual(session.run(0), { records: [], stopReason: "step-limit" });
  assert.equal(session.run(4).records.length, 4); // ACIA reset and configuration.
  assert.equal(session.tapePosition, 0); // All offers while held in reset were rejected.
  session.run(1);
  assert.equal(session.tapePosition, 1);
  assert.equal(session.machine.serial.snapshot().full, true);
  session.run(1);
  assert.equal(session.tapePosition, 1); // The unread zero cannot be overwritten.
  const received: number[] = [];
  for (let count = 0; count < 100 && received.length < 4; count++) {
    session.run(1);
    received.push(...session.drainOutput());
  }
  assert.deepEqual(received, [0, 255, 42, 42]);
  assert.equal(session.tapePosition, session.tapeLength);
  assert.equal(session.pendingInput, 0);
  assert.deepEqual(session.drainOutput(), []);
});

test("STOP preserves CPU, RAM, receive latch, and queues; stepping and resumption stay explicit", () => {
  const session = new SerialSession(output => create8080AltairSerial({ serial: output }), [42, 43]);
  session.start(); session.run(5); session.stop();
  const cpu = session.machine.cpu.snapshot(), serial = session.machine.serial.snapshot();
  const ram = Array.from({ length: session.machine.ram.size }, (_, address) => session.machine.ram.read(address));
  assert.deepEqual(session.run(100), { records: [], stopReason: "paused" });
  assert.deepEqual(session.machine.cpu.snapshot(), cpu);
  assert.deepEqual(session.machine.serial.snapshot(), serial);
  assert.deepEqual(Array.from({ length: session.machine.ram.size }, (_, address) => session.machine.ram.read(address)), ram);
  assert.equal(session.tapePosition, 1);
  const record = session.step();
  assert.equal(record.before.pc, cpu.pc);
  assert.equal(session.running, false);
  session.start();
  assert.throws(() => session.step(), /Stop the serial session/);
  session.run(30);
  assert.deepEqual(session.drainOutput(), [42, 43]);
});

test("new keyboard input follows an unread suffix without repeating an already offered byte", () => {
  const session = new SerialSession(output => create8080AltairSerial({ serial: output }));
  session.start(); session.run(4);
  session.send([1, 2]); session.run(1);
  assert.equal(session.pendingInput, 1);
  session.send([3, 4]);
  assert.equal(session.pendingInput, 3);
  session.run(50);
  assert.deepEqual(session.drainOutput(), [1, 2, 3, 4]);
  assert.equal(session.pendingInput, 0);
});

test("reset preserves the machine and captured output; reload owns a fresh machine and transport", () => {
  const tape = Uint8Array.of(1, 2);
  const session = new SerialSession(output => create8080AltairSerial({ serial: output }), tape);
  session.start(); session.run(30);
  const old = session.machine;
  old.ram.write(0x2000, 0x55);
  session.send([3]);
  const reset = session.reset();
  assert.equal(reset.after.pc, 0);
  assert.equal(session.running, false);
  assert.strictEqual(session.machine, old);
  assert.equal(old.ram.read(0x2000), 0x55);
  assert.equal(old.serial.read(0), 0);
  assert.equal(session.pendingInput, 0);
  assert.equal(session.tapeLength, 0);
  assert.deepEqual(session.drainOutput(), [1, 2]);
  session.reload(tape);
  tape[0] = 99;
  assert.notStrictEqual(session.machine, old);
  assert.equal(session.machine.cpu.snapshot().pc, 0x100);
  assert.equal(session.machine.ram.read(0x2000), 0);
  assert.equal(session.running, false);
  assert.equal(session.tapePosition, 0);
  old.serial.write(0, 0x15); old.serial.write(1, 0xff);
  assert.deepEqual(session.drainOutput(), [], "Retired machine output cannot leak into the reload");
  session.start(); session.run(30);
  assert.deepEqual(session.drainOutput(), [1, 2]);
  session.reload();
  assert.equal(session.tapeLength, 0);
});

test("host validation is atomic and invalid budgets cannot deliver queued bytes", () => {
  const session = new SerialSession(output => create8080AltairSerial({ serial: output }), [42]);
  session.send([43]);
  session.start(); session.run(4);
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => session.run(value), RangeError);
  }
  assert.equal(session.tapePosition, 0);
  const original = session.machine;
  for (const bytes of [[5, -1], [5, 256], [NaN], [0.5], new Array<number>(2)]) {
    assert.throws(() => session.send(bytes), RangeError);
    assert.throws(() => session.reload(bytes), RangeError);
    assert.strictEqual(session.machine, original);
    assert.equal(session.running, true);
    assert.equal(session.pendingInput, 1);
    assert.equal(session.tapePosition, 0);
  }
  session.run(30);
  assert.deepEqual(session.drainOutput(), [42, 43]);
});

test("terminal CPU outcomes stop a batch and retain the final original record", () => {
  for (const outcome of ["halted", "waiting", "unsupported"] as const) {
    const record = { outcome, marker: 42 }, offers: number[] = [];
    const session = new SerialSession(() => ({
      cpu: { step: () => record }, serial: { offer: (byte: number) => { offers.push(byte); return true; } }, reset: () => {},
    }), [1, 2]);
    session.start();
    const batch = session.run(10);
    assert.equal(batch.stopReason, outcome);
    assert.equal(batch.records.length, 1);
    assert.strictEqual(batch.records[0], record);
    assert.equal(session.running, false);
    assert.deepEqual(offers, [1]);
    assert.deepEqual(session.run(1), { records: [], stopReason: "paused" });
  }
});

test("a throwing step stops execution without replaying accepted input or losing completed output", () => {
  const failure = new Error("Guest callback failed"), offers: number[] = [];
  let fail = true;
  const session = new SerialSession(output => ({
    cpu: { step: () => { output(42); if (fail) throw failure; return { outcome: "executed" as const }; } },
    serial: { offer: (byte: number) => { offers.push(byte); return true; } }, reset: () => {},
  }), [1, 2]);
  session.start();
  assert.throws(() => session.run(10), error => error === failure);
  assert.equal(session.running, false);
  assert.equal(session.tapePosition, 1);
  assert.deepEqual(session.drainOutput(), [42]);
  fail = false;
  session.start(); session.run(1);
  assert.deepEqual(offers, [1, 2]);
  assert.deepEqual(session.drainOutput(), [42]);
});

test("failed construction or reset retains queued input and a usable session boundary", () => {
  const failure = new Error("Failed lifecycle"), offers: number[] = [];
  let failCreate = false, failReset = true;
  const session = new SerialSession(output => {
    output(42);
    if (failCreate) throw failure;
    return {
      cpu: { step: () => ({ outcome: "executed" as const }) },
      serial: { offer: (byte: number) => { offers.push(byte); return true; } },
      reset: () => { if (failReset) throw failure; },
    };
  }, [1]);
  const original = session.machine;
  session.send([2]); session.start(); failCreate = true;
  assert.throws(() => session.reload([3]), error => error === failure);
  assert.strictEqual(session.machine, original);
  assert.equal(session.running, true);
  assert.equal(session.pendingInput, 1);
  assert.deepEqual(session.drainOutput(), [42]);
  assert.throws(() => session.reset(), error => error === failure);
  assert.equal(session.running, false);
  session.start(); session.run(2);
  assert.deepEqual(offers, [1, 2]);
  failReset = false;
  session.reset();
});

test("guest callbacks cannot reenter session mutations, but inspection remains available", () => {
  let callback = () => {};
  const session = new SerialSession(() => ({
    cpu: { step: () => { callback(); return { outcome: "executed" as const }; } },
    serial: { offer: () => true }, reset: () => {},
  }));
  for (const mutate of [() => session.start(), () => session.stop(), () => session.run(0), () => session.step(),
    () => session.send([1]), () => session.reset(), () => session.reload(), () => session.drainOutput()]) {
    callback = () => { assert.equal(session.running, true); mutate(); };
    session.start();
    assert.throws(() => session.run(1), /must not be reentrant/);
    assert.equal(session.running, false);
  }
  callback = () => {};
  session.start();
  assert.equal(session.run(1).records.length, 1);
});
