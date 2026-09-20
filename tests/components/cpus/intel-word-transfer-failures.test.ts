import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8080 } from "../../../src/components/cpus/generated/8080-cpu.js";
import { CpuZ80 } from "../../../src/components/cpus/z80.js";
import type { CpuZ80InterruptAccess } from "../../../src/components/cpus/z80.js";
import { ObservedRam } from "../../helpers/observed-ram.js";
import { wordChanges, wordForms, wordState } from "../../helpers/intel-words.js";
import { readAccess, writeAccess } from "./z80/helpers.js";

for (const name of ["8080", "z80"] as const) {
  test(`${name} word transfers retain each completed effect when ordinary or supplied fetching and data accesses fail`, () => {
    const z80 = name === "z80", failure = new Error("word transfer failure");
    for (const { bytes: opcode, fields, operation } of wordForms[name]) for (const external of [false, true]) {
      for (const address of [0xffff, 0, 1, 0x4000]) for (const original of [0, 0xffff, 0x1234]) for (const set of [false, true]) {
        const operand = operation === "immediate" ? 0xabcd : address;
        const bytes = [...opcode, ...(operation === "copy" ? [] : [operand % 256, Math.floor(operand / 256)])];
        const memory = operation === "load" || operation === "store", count = bytes.length + (memory ? 2 : 0);
        for (let failAt = -1; failAt < count; failAt++) {
          let attempts = 0, running = false;
          const completed: CpuZ80InterruptAccess[] = [];
          const attempt = () => { if (attempts++ === failAt) throw failure; };
          class FaultRam extends ObservedRam {
            override read(address: number): number {
              if (running) attempt(); const value = super.read(address);
              if (running) completed.push(readAccess(address, value)); return value;
            }
            override write(address: number, value: number): void {
              if (running) attempt(); super.write(address, value);
              if (running) completed.push(writeAccess(address, value));
            }
          }
          const state = { ...wordState(set), ...wordChanges(fields, original), pc: 0xfffe, r: 0xff, im: 0 as const,
            iff1: true, iff2: true, interruptDeferred: !external, nmiDeferred: true, halted: external };
          const ram = new FaultRam(), next = (address + 1) % 65536;
          ram.write(address, original % 256); ram.write(next, Math.floor(original / 256));
          if (!external) bytes.forEach((value, index) => ram.write((state.pc + index) % 65536, value));
          const lowBefore = ram.read(address), highBefore = ram.read(next), loaded = lowBefore + highBefore * 256;
          const cpu = z80 ? new CpuZ80(ram, state) : new Cpu8080(ram, state), before = cpu.snapshot();
          ram.accesses.length = 0; running = true;
          const data = operation === "load" ? [readAccess(address, lowBefore), readAccess(next, highBefore)]
            : operation === "store" ? [writeAccess(address, original % 256), writeAccess(next, Math.floor(original / 256))] : [];
          const accesses: CpuZ80InterruptAccess[] = [
            ...bytes.map((value, index) => external ? { kind: "acknowledge" as const, value } : readAccess((state.pc + index) % 65536, value)), ...data,
          ];
          const run = () => {
            let supplied = 0;
            const acknowledge = () => { attempt(); const value = bytes[supplied++]!; completed.push({ kind: "acknowledge", value }); return value; };
            return external ? cpu instanceof CpuZ80 ? cpu.interrupt("irq", acknowledge) : cpu.interrupt(acknowledge) : cpu.step();
          };
          const success = failAt < 0, decoded = success || failAt >= opcode.length;
          const fetched = success ? bytes.length : Math.min(failAt, bytes.length);
          const refresh = external ? (opcode.length === 2 && failAt !== 0 ? 2 : 1) : decoded ? opcode.length : 0;
          const result = operation === "copy" ? original : operation === "immediate" ? operand : loaded;
          const after = { ...before, pc: external || !decoded ? state.pc : (state.pc + fetched) % 65536,
            halted: false, interruptDeferred: !external && !success,
            ...(z80 ? { r: 0x80 + (127 + refresh) % 128, iff1: !external, iff2: !external, nmiDeferred: !success }
              : { interruptEnabled: !external }),
            ...(success && operation !== "store" ? wordChanges(operation === "copy" ? ["sp"] : fields, result) : {}),
          };
          const expected = { ...after, bc: after.b * 256 + after.c, de: after.d * 256 + after.e, hl: after.h * 256 + after.l };
          if (success) assert.deepEqual(run(), { before, after: expected, accesses, outcome: "executed",
            ...(external && z80 ? { source: "irq" } : {}),
            instruction: external ? { source: "interrupt", bytes } : { address: state.pc, bytes } });
          else assert.throws(run, error => error === failure);
          assert.deepEqual(cpu.snapshot(), expected, `${name} ${bytes.join(",")}, external=${external}, failure=${failAt}`);
          assert.deepEqual(completed, accesses.slice(0, success ? count : failAt));
          assert.deepEqual(ram.accesses, completed.filter(access => access.kind !== "acknowledge"));
          assert.equal(attempts, success ? count : failAt + 1);
          running = false;
          assert.equal(ram.read(address), operation === "store" && (success || failAt > bytes.length) ? original % 256 : lowBefore);
          assert.equal(ram.read(next), operation === "store" && success ? Math.floor(original / 256) : highBefore);
          if (!success) { cpu.reset(); assert.equal(cpu.snapshot().pc, 0); }
        }
      }
    }
  });
}
