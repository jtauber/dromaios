import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/generated/8088-cpu.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { address, checkStep, flags, initialState, put, snapshot } from "./helpers.js";

const forms = [
  [0x88, "store", 1], [0x89, "store", 2], [0x8a, "load", 1], [0x8b, "load", 2],
  [0x86, "exchange", 1], [0x87, "exchange", 2], [0xc6, "immediate", 1], [0xc7, "immediate", 2],
  [0xa0, "load", 1], [0xa1, "load", 2], [0xa2, "store", 1], [0xa3, "store", 2],
] as const;

test("all twelve segmented transfer forms preserve completed accesses and inhibit retirement at every failed byte", () => {
  const failure = Error("byte access failed");
  for (const [opcode, operation, width] of forms) for (const prefixes of [[], [0x26, 0x3e, 0xf0]]) for (const offset of [0xf, 0xffff]) {
    const before = initialState({ cs: 0xabcd, ip: 0xffff, ds: 0xffff, flags: flags(511), interruptDeferred: true, recognitionDeferred: true });
    const absolute = opcode >= 0xa0 && opcode <= 0xa3;
    const bytes = [...prefixes, opcode, ...(absolute ? [] : [operation === "immediate" ? 0x06 : 0x3e]), offset % 256, Math.floor(offset / 256),
      ...(operation === "immediate" ? [0x5a, 0xa5].slice(0, width) : [])];
    const dataAddresses = Array.from({ length: width }, (_, i) => address(before.ds, offset + i));
    const data = [0x34, 0x12].slice(0, width), source = operation === "immediate" ? [0x5a, 0xa5]
      : absolute ? [0x22, 0x11] : width === 1 ? [0x33] : [0x20, 0]; // AL/AX, BH, or DI.
    const sequence = [
      ...bytes.map((value, i) => ({ kind: "read" as const, address: address(before.cs, before.ip + i), value })),
      ...(operation === "load" || operation === "exchange" ? dataAddresses.map((a, i) => ({ kind: "read" as const, address: a, value: data[i]! })) : []),
      ...(operation === "load" ? [] : dataAddresses.map((a, i) => ({ kind: "write" as const, address: a, value: source[i]! }))),
    ];
    for (let failAt = 0; failAt < sequence.length; failAt++) {
      let armed = false, attempts = 0;
      const attempt = () => { if (armed && attempts++ === failAt) throw failure; };
      class FaultRam extends ObservedRam {
        override read(a: number) { attempt(); return super.read(a); }
        override write(a: number, byte: number) { attempt(); super.write(a, byte); }
      }
      const ram = new FaultRam(0x100000);
      put(ram, before.cs, before.ip, bytes); put(ram, before.ds, offset, data); ram.accesses.length = 0;
      const cpu = new Cpu8088(ram, before); armed = true;
      assert.throws(() => cpu.step(), error => error === failure);
      assert.equal(attempts, failAt + 1);
      assert.deepEqual(cpu.snapshot(), snapshot({ ...before, ip: (before.ip + Math.min(failAt, bytes.length)) % 65536 }));
      assert.deepEqual(ram.accesses, sequence.slice(0, failAt));
      armed = false;
      const expected = new Map(dataAddresses.map((a, i) => [a, data[i]!]));
      sequence.slice(0, failAt).forEach(access => { if (access.kind === "write") expected.set(access.address, access.value); });
      expected.forEach((byte, a) => assert.equal(ram.read(a), byte));
      cpu.reset(); assert.equal(cpu.snapshot().ip, 0); // The failed step released the boundary guard.
    }
  }
});

test("C6/C7 reject every nonzero extension before displacement or immediate fetching, and REP rejects every migrated transfer", () => {
  const ram = new ObservedRam(0x100000);
  const before = initialState({ ip: 0xffff, flags: flags(511), interruptDeferred: true, recognitionDeferred: true, trapPending: true });
  const rejected = [
    ...[0xc6, 0xc7].flatMap(opcode => Array.from({ length: 256 }, (_, modRM) => modRM).filter(modRM => Math.floor(modRM / 8) % 8 !== 0)
      .map(modRM => [opcode, modRM])),
    ...forms.flatMap(([opcode]) => [[0xf2, opcode], [0xf3, opcode]]),
  ];
  for (const bytes of rejected) {
    put(ram, before.cs, before.ip, [...bytes, 0x99, 0x88, 0x77]); ram.accesses.length = 0;
    const cpu = new Cpu8088(ram, before);
    const accesses = bytes.map((value, i) => ({ kind: "read" as const, address: address(before.cs, before.ip + i), value }));
    assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(before), instruction: { address: address(before.cs, before.ip), bytes },
      accesses, outcome: "unsupported", reason: "opcode" });
    assert.deepEqual(ram.accesses, accesses);
  }
});

test("immediate word MOV captures overlapping code before writing, then retires inhibition and samples TF", () => {
  const ram = new ObservedRam(0x100000), before = initialState({ cs: 0x2000, ds: 0x2000, ip: 0x10,
    flags: flags(511), interruptDeferred: true, recognitionDeferred: true });
  // Destination begins on the second immediate byte; an early low-byte write would corrupt the high-byte fetch.
  checkStep(ram, before, [0xc7, 0x06, 0x15, 0, 0x34, 0x12], { ...before, ip: 0x16, interruptDeferred: false, recognitionDeferred: false }, undefined,
    [{ kind: "write", address: 0x20015, value: 0x34 }, { kind: "write", address: 0x20016, value: 0x12 }]);
  assert.equal(ram.read(0x20015), 0x34); assert.equal(ram.read(0x20016), 0x12);
});
