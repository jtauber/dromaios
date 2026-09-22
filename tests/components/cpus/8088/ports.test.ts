import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/generated/8088-cpu.js";
import type { Cpu8088Access } from "../../../../src/components/cpus/generated/8088-cpu.js";
import { Ram } from "../../../../src/components/memory/ram.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, flags, snapshot, address, put, dataReads, reject } from "./helpers.js";

// Intel table 4-13: immediate and DX port forms, byte and word accumulators.
const portForms = [
  { opcode: 0xe4, name: "IN AL,n", output: false, word: false, useDx: false },
  { opcode: 0xe5, name: "IN AX,n", output: false, word: true, useDx: false },
  { opcode: 0xe6, name: "OUT n,AL", output: true, word: false, useDx: false },
  { opcode: 0xe7, name: "OUT n,AX", output: true, word: true, useDx: false },
  { opcode: 0xec, name: "IN AL,DX", output: false, word: false, useDx: true },
  { opcode: 0xed, name: "IN AX,DX", output: false, word: true, useDx: true },
  { opcode: 0xee, name: "OUT DX,AL", output: true, word: false, useDx: true },
  { opcode: 0xef, name: "OUT DX,AX", output: true, word: true, useDx: true },
] as const;

for (const form of portForms) {
  test(`8088 port ${form.name} preserves every flag pattern and records byte order, full addresses, and accumulator halves`, () => {
    const ram = new ObservedRam(0x100000);
    for (let bits = 0; bits < 512; bits++) {
      const ports = form.useDx ? [0, 1, 0xff, 0x100, 0x1234, 0x8000, 0xfffe, 0xffff] : [bits % 256];
      for (const port of ports) {
        const input = [bits % 256, 255 - bits % 256];
        const before = initialState({ flags: flags(bits), ax: (bits * 131) % 65536, dx: form.useDx ? port : 0xabcd });
        const bytes = form.useDx ? [form.opcode] : [form.opcode, port];
        const reads = dataReads(before.cs, before.ip, bytes);
        const transfers: Cpu8088Access[] = [];
        put(ram, before.cs, before.ip, bytes);
        ram.accesses.length = 0;
        const cpu = new Cpu8088(ram, before, { ports: {
          readPort: address => {
            assert.equal(form.output, false);
            assert.deepEqual(ram.accesses, reads, "instruction fetched before port input");
            assert.equal(cpu.snapshot().ax, before.ax, "AX commits only after complete input");
            const value = input[transfers.length]!;
            transfers.push({ kind: "input", port: address, value });
            return value;
          },
          writePort: (address, value) => {
            assert.equal(form.output, true);
            assert.deepEqual(ram.accesses, reads, "instruction fetched before port output");
            transfers.push({ kind: "output", port: address, value });
          },
        } });
        const values = form.output ? [before.ax % 256, Math.floor(before.ax / 256)] : input;
        const expected = values.slice(0, form.word ? 2 : 1).map((value, i) => ({ kind: form.output ? "output" : "input", port: (port + i) % 65536, value }));
        const ax = form.output ? before.ax : input[0]! + (form.word ? input[1]! : Math.floor(before.ax / 256)) * 256;
        assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot({ ...before, ax, trapPending: before.flags.tf, ip: before.ip + bytes.length }),
          outcome: "executed", instruction: { address: before.cs * 16 + before.ip, bytes }, accesses: [...reads, ...expected] });
        assert.deepEqual(transfers, expected);
        assert.deepEqual(ram.accesses, reads);
      }
    }
  });
}

test("8088 port instruction fetches wrap IP and the physical bus; segment overrides and LOCK do not select ports", () => {
  const ram = new ObservedRam(0x100000);
  for (const form of portForms) for (const prefix of [[], [0x26], [0x2e, 0x36, 0x3e], [0xf0]]) {
    for (const [cs, ip] of [[0x1234, 0xffff], [0xffff, 0xf], [0xffff, 0xffff]]) {
      const before = initialState({ cs, ip, dx: 0xffff });
      const bytes = [...prefix, form.opcode, ...(form.useDx ? [] : [0xff])];
      put(ram, cs!, ip!, bytes);
      ram.accesses.length = 0;
      const port = form.useDx ? 65535 : 255;
      const accesses = dataReads(cs!, ip!, bytes);
      const values = form.output ? [0x22, 0x11] : [0x34, 0x12];
      let calls = 0;
      const cpu = new Cpu8088(ram, before, { ports: {
        readPort: actual => { assert.equal(actual, (port + calls) % 65536); return values[calls++]!; },
        writePort: (actual, value) => { assert.equal(actual, (port + calls) % 65536); assert.equal(value, values[calls++]!); },
      } });
      const record = cpu.step();
      assert.deepEqual(record, { before: snapshot(before), after: snapshot({ ...before, ip: (ip! + bytes.length) % 65536,
        ax: form.output ? before.ax : form.word ? 0x1234 : 0x1134 }), instruction: { address: snapshot(before).pc, bytes }, outcome: "executed",
        accesses: [...accesses, ...values.slice(0, form.word ? 2 : 1).map((value, i) => ({ kind: form.output ? "output" : "input", port: (port + i) % 65536, value }))] });
      assert.equal(calls, form.word ? 2 : 1);
      assert.deepEqual(ram.accesses, accesses);
    }
  }
});

test("8088 port instructions reject REP before an immediate or device access and halted steps remain silent", () => {
  const ram = new ObservedRam(0x100000);
  const unavailable = { readPort: (): number => assert.fail("unexpected input"), writePort: () => assert.fail("unexpected output") };
  for (const form of portForms) for (const repeat of [0xf2, 0xf3]) {
    const before = initialState({ ip: 0xffff });
    const bytes = [0x26, repeat, form.opcode];
    put(ram, before.cs, before.ip, [...bytes, 0xaa]);
    ram.accesses.length = 0;
    const cpu = new Cpu8088(ram, before, { ports: unavailable });
    assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(before), instruction: { address: snapshot(before).pc, bytes },
      outcome: "unsupported", reason: "opcode", accesses: dataReads(before.cs, before.ip, bytes) });
    const halted = new Cpu8088(ram, { ...before, halted: true }, { ports: unavailable });
    ram.accesses.length = 0;
    assert.deepEqual(halted.step(), { before: halted.snapshot(), after: halted.snapshot(), outcome: "halted", instruction: null, accesses: [] });
    halted.snapshot(); halted.reset();
    assert.deepEqual(ram.accesses, []);
  }
});

test("8088 port failures preserve fetched IP and completed device effects without partially loading AX", () => {
  const ram = new ObservedRam(0x100000);
  const failure = new Error("device failure");
  for (const form of portForms) for (let failAt = 0; failAt < (form.word ? 2 : 1); failAt++) {
    const before = initialState({ ip: 0xffff, dx: 0xffff });
    const bytes = form.useDx ? [form.opcode] : [form.opcode, 0xff];
    const nextIp = (before.ip + bytes.length) % 65536;
    put(ram, before.cs, before.ip, [...bytes, 0x90]);
    const effects: Cpu8088Access[] = [];
    let calls = 0;
    const cpu = new Cpu8088(ram, before, { ports: {
      readPort: port => { if (calls++ === failAt) throw failure; effects.push({ kind: "input", port, value: 0x34 }); return 0x34; },
      writePort: (port, value) => { if (calls++ === failAt) throw failure; effects.push({ kind: "output", port, value }); },
    } });
    ram.accesses.length = 0;
    assert.throws(() => cpu.step(), error => error === failure);
    assert.deepEqual(cpu.snapshot(), snapshot({ ...before, ip: nextIp }));
    assert.equal(calls, failAt + 1);
    assert.deepEqual(effects, failAt === 0 ? [] : [{ kind: form.output ? "output" : "input", port: form.useDx ? 65535 : 255, value: form.output ? 0x22 : 0x34 }]);
    assert.deepEqual(ram.accesses, dataReads(before.cs, before.ip, bytes));
    assert.equal(cpu.step().outcome, "executed", "the execution guard clears after failure");
    cpu.reset();
    const disconnected = new Cpu8088(ram, before);
    assert.throws(() => disconnected.step(), /requires a connected device/);
    assert.deepEqual(disconnected.snapshot(), snapshot({ ...before, ip: nextIp }));
  }
});

test("8088 port inputs validate every byte before assembly and never coerce device values", () => {
  const ram = new Ram(0x100000);
  for (const form of portForms.filter(form => !form.output)) {
    for (const value of [-1, 256, 0.5, NaN, Infinity, undefined, null, "0", true]) {
      for (let failAt = 0; failAt < (form.word ? 2 : 1); failAt++) {
        const before = initialState();
        const bytes = form.useDx ? [form.opcode] : [form.opcode, 0x20];
        put(ram, before.cs, before.ip, bytes);
        let calls = 0;
        // @ts-expect-error Malformed JavaScript devices must fail without coercion.
        const cpu = new Cpu8088(ram, before, { ports: { readPort: () => calls++ === failAt ? value : 0x34, writePort: () => {} } });
        assert.throws(() => cpu.step(), RangeError);
        assert.equal(calls, failAt + 1);
        assert.deepEqual(cpu.snapshot(), snapshot({ ...before, ip: before.ip + bytes.length }));
      }
    }
  }
});

test("8088 port and RAM callbacks can inspect snapshots but cannot reenter step or reset", t => {
  const ram = new Ram(0x100000);
  for (const callback of ["readPort", "writePort", "read", "write"] as const) for (const mutation of ["step", "reset"] as const) {
    const before = initialState();
    const bytes = callback === "readPort" ? [0xed] : callback === "writePort" ? [0xef] : callback === "read" ? [0x90] : [0xa3, 0, 0];
    put(ram, before.cs, before.ip, bytes);
    let calls = 0;
    const inspect = (): void => {
      calls++;
      const snapshot = cpu.snapshot();
      assert.throws(() => cpu[mutation](), /8088 step, reset, and interrupt calls must not be reentrant/);
      assert.deepEqual(cpu.snapshot(), snapshot);
    };
    const cpu = new Cpu8088(ram, before, { ports: {
      readPort: () => { if (callback === "readPort") inspect(); return 0x34; },
      writePort: () => { if (callback === "writePort") inspect(); },
    } });
    if (callback === "read") {
      const read = ram.read.bind(ram);
      t.mock.method(ram, "read", (address: number) => { inspect(); return read(address); });
    } else if (callback === "write") {
      const write = ram.write.bind(ram);
      t.mock.method(ram, "write", (address: number, value: number) => { inspect(); write(address, value); });
    }
    assert.equal(cpu.step().outcome, "executed");
    assert.ok(calls > 0);
    t.mock.restoreAll();
    cpu.reset();
  }
});

test("8088 port callbacks can change later code without changing captured instruction bytes or retained records", () => {
  const ram = new ObservedRam(0x100000);
  const before = initialState();
  put(ram, before.cs, before.ip, [0xe7, 0xff, 0x90]);
  let calls = 0;
  const cpu = new Cpu8088(ram, before, { ports: { readPort: () => assert.fail("output only"), writePort: () => {
    if (calls++ === 0) put(ram, before.cs, before.ip, [0x90, 0x90, 0xf4]);
  } } });
  const first = cpu.step(), retained = structuredClone(first);
  assert.deepEqual(first.instruction?.bytes, [0xe7, 0xff]);
  assert.deepEqual(first.accesses, [...dataReads(before.cs, before.ip, [0xe7, 0xff]),
    { kind: "output", port: 255, value: 0x22 }, { kind: "output", port: 256, value: 0x11 }]);
  assert.equal(cpu.step().outcome, "halted");
  cpu.reset();
  assert.deepEqual(first, retained);
  assert.equal(calls, 2);
});
