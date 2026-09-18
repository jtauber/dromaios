import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/8088.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { address, flags, initialState, put, snapshot, unaryForms, unaryResult } from "./helpers.js";

const controls = [
  ...Array.from({ length: 16 }, (_, i) => [0x70 + i, 0x80]),
  ...[0xe0, 0xe1, 0xe2, 0xe3, 0xeb].map(opcode => [opcode, 0x80]), [0xe9, 0x80, 0xff],
  ...[0x98, 0x99, 0x9e, 0x9f, 0xf4, 0xf5, 0xf8, 0xf9, 0xfc, 0xfd].map(opcode => [opcode]),
];

test("all 32 migrated 8088 control/status forms retain fetch effects and inhibit retirement on failure", () => {
  assert.equal(controls.length, 32);
  const failure = Error("fetch failed");
  for (const form of controls) for (const prefixes of [[], [0x26, 0x2e, 0xf0]]) {
    const bytes = [...prefixes, ...form];
    for (let failAt = 0; failAt < bytes.length; failAt++) {
      let armed = false, attempts = 0;
      class FaultRam extends ObservedRam {
        override read(a: number) { if (armed && attempts++ === failAt) throw failure; return super.read(a); }
      }
      const ram = new FaultRam(0x100000), before = initialState({ cs: 0xffff, ip: 0xffff, interruptDeferred: true, recognitionDeferred: true });
      put(ram, before.cs, before.ip, bytes); ram.accesses.length = 0;
      const cpu = new Cpu8088(ram, before); armed = true;
      assert.throws(() => cpu.step(), error => error === failure);
      assert.deepEqual(cpu.snapshot(), snapshot({ ...before, ip: (before.ip + failAt) % 65536 }));
      assert.deepEqual(ram.accesses, bytes.slice(0, failAt).map((value, i) => ({ kind: "read", address: address(before.cs, before.ip + i), value })));
      assert.equal(attempts, failAt + 1);
      armed = false; cpu.reset(); assert.equal(cpu.snapshot().ip, 0);
    }
  }
});

test("all eight migrated 8088 unary forms retain flags and partial word writes at every access failure", () => {
  const failure = Error("byte access failed");
  for (const [operation, byteOpcode, wordOpcode, selector] of unaryForms) for (const width of [8, 16] as const) {
    for (const prefixes of [[], [0x26, 0x3e, 0xf0]]) for (const offset of [0xf, 0xffff]) for (const bits of [0, 511]) {
      const before = initialState({ cs: 0xabcd, ip: 0xffff, ds: 0xffff, flags: flags(bits), interruptDeferred: true, recognitionDeferred: true });
      const bytes = [...prefixes, width === 8 ? byteOpcode : wordOpcode, selector * 8 + 6, offset % 256, Math.floor(offset / 256)];
      const data = [0xff, 0x7f].slice(0, width / 8), result = unaryResult(operation, width, width === 8 ? 0xff : 0x7fff, before.flags);
      const addresses = data.map((_, i) => address(before.ds, offset + i)), reads = bytes.length + data.length;
      const sequence = [
        ...bytes.map((value, i) => ({ kind: "read" as const, address: address(before.cs, before.ip + i), value })),
        ...addresses.map((a, i) => ({ kind: "read" as const, address: a, value: data[i]! })),
        ...addresses.map((a, i) => ({ kind: "write" as const, address: a, value: Math.floor(result.result / 256 ** i) % 256 })),
      ];
      for (let failAt = -1; failAt < sequence.length; failAt++) {
        let armed = false, attempts = 0;
        const attempt = () => { if (armed && attempts++ === failAt) throw failure; };
        class FaultRam extends ObservedRam {
          override read(a: number) { attempt(); return super.read(a); }
          override write(a: number, byte: number) { attempt(); super.write(a, byte); }
        }
        const ram = new FaultRam(0x100000);
        put(ram, before.cs, before.ip, bytes); put(ram, before.ds, offset, data); ram.accesses.length = 0;
        const cpu = new Cpu8088(ram, before); armed = true;
        if (failAt < 0) assert.equal(cpu.step().outcome, "executed"); else assert.throws(() => cpu.step(), error => error === failure);
        const completed = failAt < 0 ? sequence.length : failAt;
        assert.equal(attempts, failAt < 0 ? completed : completed + 1);
        assert.deepEqual(cpu.snapshot(), snapshot({ ...before, ip: (before.ip + Math.min(completed, bytes.length)) % 65536,
          flags: completed >= reads ? result.flags : before.flags,
          ...(failAt < 0 ? { interruptDeferred: false, recognitionDeferred: false, trapPending: before.flags.tf } : {}) }));
        assert.deepEqual(ram.accesses, sequence.slice(0, completed));
        armed = false;
        const expected = new Map(addresses.map((a, i) => [a, data[i]!]));
        sequence.slice(0, completed).forEach(access => { if (access.kind === "write") expected.set(access.address, access.value); });
        expected.forEach((byte, a) => assert.equal(ram.read(a), byte));
        cpu.reset(); assert.equal(cpu.snapshot().ip, 0);
      }
    }
  }
});

test("8088 unary selectors and REP retain rejection before operand resolution or any generated body effect", () => {
  const ram = new ObservedRam(0x100000);
  const before = initialState({ ip: 0xffff, flags: flags(511), interruptDeferred: true, recognitionDeferred: true, trapPending: true });
  const rejected = [
    ...[...controls.map(form => form[0]!), 0xfe, 0xff, 0xf6, 0xf7].flatMap(opcode => [[0xf2, opcode], [0xf3, opcode]]),
    ...[0xfe, 0xff, 0xf6, 0xf7].flatMap(opcode => Array.from({ length: 256 }, (_, modRM) => modRM).filter(modRM => {
      const selector = Math.floor(modRM / 8) % 8;
      return opcode === 0xfe ? selector > 1 : opcode === 0xff ? selector === 7 || (modRM >= 0xc0 && [3, 5].includes(selector)) : selector === 1;
    }).map(modRM => [opcode, modRM])),
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
