import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8088 } from "../../../../src/components/cpus/8088.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { address, aluForms, byteMoves, initialState, put, snapshot, wordMoves } from "./helpers.js";

// Independent documented bytes; every migrated form includes all of its immediate bytes.
const forms = [
  ...aluForms.flatMap(([, , , , , byte, word]) => [[byte, 0x27], [word, 0x27, 0x80]]),
  ...byteMoves.map(([opcode]) => [opcode, 0x27]), ...wordMoves.map(([opcode]) => [opcode, 0x27, 0x80]),
  ...Array.from({ length: 16 }, (_, i) => [0x40 + i]), ...Array.from({ length: 8 }, (_, i) => [0x90 + i]),
  [0xa8, 0x27], [0xa9, 0x27, 0x80],
];

test("8088 migrated register forms preserve completed fetches, inhibit retirement on failure, and release the execution guard", () => {
  assert.equal(forms.length, 58);
  const failure = new Error("fetch failed");
  for (const form of forms) for (const prefixes of [[], [0x26, 0x2e, 0xf0]]) {
    const bytes = [...prefixes, ...form];
    for (let failAt = 0; failAt < bytes.length; failAt++) {
      let armed = false, attempts = 0;
      class FaultRam extends ObservedRam {
        override read(address: number): number { if (armed && attempts++ === failAt) throw failure; return super.read(address); }
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

test("8088 generated register bindings retain rejection of REP/REPNE before any operand fetch or body effect", () => {
  const ram = new ObservedRam(0x100000);
  for (const form of forms) for (const prefix of [0xf2, 0xf3]) {
    const before = initialState({ cs: 0xffff, ip: 0xffff, interruptDeferred: true, recognitionDeferred: true, trapPending: true });
    put(ram, before.cs, before.ip, [prefix, ...form]); ram.accesses.length = 0;
    const cpu = new Cpu8088(ram, before), bytes = [prefix, form[0]!];
    const accesses = bytes.map((value, i) => ({ kind: "read" as const, address: address(before.cs, before.ip + i), value }));
    assert.deepEqual(cpu.step(), { before: snapshot(before), after: snapshot(before), instruction: { address: address(before.cs, before.ip), bytes },
      accesses, outcome: "unsupported", reason: "opcode" });
    assert.deepEqual(ram.accesses, accesses);
  }
});
