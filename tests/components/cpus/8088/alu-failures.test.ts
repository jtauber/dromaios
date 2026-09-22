import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/generated/8088-cpu.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { address, aluForms, aluResult, flags, initialState, put, registerValue, replaceRegister, snapshot } from "./helpers.js";
import type { AluName } from "./helpers.js";

interface Form { opcode: number; operation: AluName; width: 8 | 16; direction: "toMemory" | "fromMemory" | "immediate"; selector: number }
const forms: Form[] = [];
for (const [operation, byteTo, wordTo, byteFrom, wordFrom, , , selector] of aluForms) {
  forms.push(
    { opcode: byteTo, operation, width: 8, direction: "toMemory", selector: 7 },
    { opcode: wordTo, operation, width: 16, direction: "toMemory", selector: 7 },
    { opcode: byteFrom, operation, width: 8, direction: "fromMemory", selector: 7 },
    { opcode: wordFrom, operation, width: 16, direction: "fromMemory", selector: 7 },
  );
  for (const opcode of [0x80, 0x81, ...(["OR", "AND", "XOR"].includes(operation) ? [] : [0x82, 0x83])]) {
    forms.push({ opcode, operation, width: opcode % 2 ? 16 : 8, direction: "immediate", selector });
  }
}
for (const [opcode, width, direction] of [[0x84, 8, "toMemory"], [0x85, 16, "toMemory"], [0xf6, 8, "immediate"], [0xf7, 16, "immediate"]] as const) {
  forms.push({ opcode, width, direction, operation: "TEST", selector: direction === "immediate" ? 0 : 7 });
}

test("all 62 migrated 8088 ALU forms retain completed accesses, flags, and byte writes at every failure boundary", () => {
  assert.equal(forms.length, 62);
  const failure = Error("byte access failed");
  for (const { opcode, operation, width, direction, selector } of forms) for (const prefixes of [[], [0x26, 0x3e, 0xf0]]) for (const offset of [0xf, 0xffff]) {
    const before = initialState({ cs: 0xabcd, ip: 0xffff, ds: 0xffff, flags: flags(511), interruptDeferred: true, recognitionDeferred: true });
    const immediate = direction !== "immediate" ? [] : width === 16 && opcode !== 0x83 ? [0x80, 0x80] : [0x80];
    const bytes = [...prefixes, opcode, selector * 8 + 6, offset % 256, Math.floor(offset / 256), ...immediate];
    const dataAddresses = Array.from({ length: width / 8 }, (_, i) => address(before.ds, offset + i));
    const data = [0x34, 0x12].slice(0, width / 8), contents = width === 8 ? 0x34 : 0x1234;
    const left = direction === "fromMemory" ? registerValue(before, width, 7) : contents;
    const right = direction === "fromMemory" ? contents : direction === "toMemory" ? registerValue(before, width, 7)
      : opcode === 0x83 ? 0xff80 : width === 16 ? 0x8080 : 0x80;
    const result = aluResult(operation, width, left, right, before.flags), writeBack = operation !== "CMP" && operation !== "TEST";
    const reads = bytes.length + data.length;
    const sequence = [
      ...bytes.map((value, i) => ({ kind: "read" as const, address: address(before.cs, before.ip + i), value })),
      ...dataAddresses.map((a, i) => ({ kind: "read" as const, address: a, value: data[i]! })),
      ...(direction === "fromMemory" || !writeBack ? [] : dataAddresses.map((a, i) => ({
        kind: "write" as const, address: a, value: Math.floor(result.result / 256 ** i) % 256,
      }))),
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
      assert.equal(attempts, failAt < 0 ? sequence.length : failAt + 1);
      const completed = failAt < 0 ? sequence.length : failAt;
      let after = { ...before, ip: (before.ip + Math.min(completed, bytes.length)) % 65536,
        flags: completed >= reads ? result.flags : before.flags };
      if (failAt < 0) {
        if (direction === "fromMemory" && writeBack) after = replaceRegister(after, width, 7, result.result);
        after = { ...after, interruptDeferred: false, recognitionDeferred: false, trapPending: true };
      }
      assert.deepEqual(cpu.snapshot(), snapshot(after), [opcode, offset, failAt].join(":"));
      assert.deepEqual(ram.accesses, sequence.slice(0, completed));
      armed = false;
      const expected = new Map(dataAddresses.map((a, i) => [a, data[i]!]));
      sequence.slice(0, completed).forEach(access => { if (access.kind === "write") expected.set(access.address, access.value); });
      expected.forEach((byte, a) => assert.equal(ram.read(a), byte));
      cpu.reset(); assert.equal(cpu.snapshot().ip, 0); // The failed step released the boundary guard.
    }
  }
});

test("8088 rejects unused immediate selectors before displacement/fetch effects and rejects REP for every migrated ALU form", () => {
  const ram = new ObservedRam(0x100000);
  const before = initialState({ ip: 0xffff, flags: flags(511), interruptDeferred: true, recognitionDeferred: true, trapPending: true });
  const rejected = [
    ...[0x82, 0x83, 0xf6, 0xf7].flatMap(opcode => Array.from({ length: 256 }, (_, modRM) => modRM)
      .filter(modRM => (opcode < 0xf6 ? [1, 4, 6] : [1]).includes(Math.floor(modRM / 8) % 8)).map(modRM => [opcode, modRM])),
    ...[...new Set(forms.map(form => form.opcode))].flatMap(opcode => [[0xf2, opcode], [0xf3, opcode]]),
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
