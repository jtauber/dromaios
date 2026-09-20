import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8080 } from "../../../src/components/cpus/generated/8080-cpu.js";
import { CpuZ80 } from "../../../src/components/cpus/z80.js";
import type { CpuZ80InterruptAccess } from "../../../src/components/cpus/z80.js";
import { ObservedRam } from "../../helpers/observed-ram.js";
import { exchangeForms, wordChanges, wordState } from "../../helpers/intel-words.js";
import { readAccess, writeAccess } from "./z80/helpers.js";

for (const name of ["8080", "z80"] as const) {
  test(`${name} exchanges preserve wrapping, code overlap, supplied instructions, and every failed access boundary`, () => {
    const z80 = name === "z80", failure = new Error("exchange access failure");
    for (const { bytes, fields, stack } of exchangeForms[name]) for (const external of [false, true]) {
      for (const pc of [0xfffe, 0xffff]) for (const sp of [0, 0xffff, pc, pc - 1, 0x4000]) {
        for (const original of [0, 0xffff, 0x1234]) for (const set of [false, true]) {
          const count = bytes.length + (stack ? 4 : 0), next = (sp + 1) % 65536;
          for (let failAt = -1; failAt < count; failAt++) {
            let attempts = 0, running = false;
            const completed: CpuZ80InterruptAccess[] = [], attempt = () => { if (attempts++ === failAt) throw failure; };
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
            const state = { ...wordState(set), ...wordChanges(fields, original), pc, sp, r: 0xff, im: 0 as const,
              iff1: true, iff2: true, interruptDeferred: !external, nmiDeferred: true, halted: external };
            const ram = new FaultRam(); ram.write(sp, (original % 256) ^ 0xff); ram.write(next, Math.floor(original / 256) ^ 0xff);
            if (!external) bytes.forEach((value, index) => ram.write((pc + index) % 65536, value));
            const low = ram.read(sp), high = ram.read(next), cpu = z80 ? new CpuZ80(ram, state) : new Cpu8080(ram, state);
            const before = cpu.snapshot(), success = failAt < 0, decoded = success || failAt >= bytes.length;
            const refresh = external ? bytes.length === 2 && failAt !== 0 ? 2 : 1 : decoded ? bytes.length : 0;
            const after = { ...before, pc: external || !decoded ? pc : (pc + bytes.length) % 65536,
              halted: false, interruptDeferred: !external && !success,
              ...(z80 ? { r: 0x80 + (127 + refresh) % 128, iff1: !external, iff2: !external, nmiDeferred: !success }
                : { interruptEnabled: !external }),
              ...(success ? stack ? wordChanges(fields, high * 256 + low)
                : { d: before.h, e: before.l, h: before.d, l: before.e } : {}),
            };
            const expected = { ...after, bc: after.b * 256 + after.c, de: after.d * 256 + after.e, hl: after.h * 256 + after.l };
            const accesses: CpuZ80InterruptAccess[] = [
              ...bytes.map((value, index) => external ? { kind: "acknowledge" as const, value } : readAccess((pc + index) % 65536, value)),
              ...(stack ? [readAccess(sp, low), readAccess(next, high),
                writeAccess(next, Math.floor(original / 256)), writeAccess(sp, original % 256)] : []),
            ];
            ram.accesses.length = 0; running = true;
            const run = () => {
              let supplied = 0;
              const acknowledge = () => { attempt(); const value = bytes[supplied++]!; completed.push({ kind: "acknowledge", value }); return value; };
              return external ? cpu instanceof CpuZ80 ? cpu.interrupt("irq", acknowledge) : cpu.interrupt(acknowledge) : cpu.step();
            };
            if (success) assert.deepEqual(run(), { before, after: expected, accesses, outcome: "executed",
              ...(external && z80 ? { source: "irq" } : {}),
              instruction: external ? { source: "interrupt", bytes } : { address: pc, bytes } });
            else assert.throws(run, error => error === failure);
            assert.deepEqual(cpu.snapshot(), expected, `${name} ${bytes.join(",")}, external=${external}, failure=${failAt}`);
            assert.deepEqual(completed, accesses.slice(0, success ? count : failAt));
            assert.deepEqual(ram.accesses, completed.filter(access => access.kind !== "acknowledge"));
            assert.equal(attempts, success ? count : failAt + 1);
            running = false;
            assert.equal(ram.read(sp), stack && success ? original % 256 : low);
            assert.equal(ram.read(next), stack && (success || failAt === bytes.length + 3) ? Math.floor(original / 256) : high);
            if (!success) { cpu.reset(); assert.equal(cpu.snapshot().pc, 0); }
          }
        }
      }
    }
  });
}
