import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8080 } from "../../../src/components/cpus/generated/8080-cpu.js";
import { CpuZ80 } from "../../../src/components/cpus/generated/z80-cpu.js";
import type { CpuZ80InterruptAccess } from "../../../src/components/cpus/generated/z80-cpu.js";
import { ObservedRam } from "../../helpers/observed-ram.js";
import { arithmeticChanges, arithmeticForms, wordChanges, wordState } from "../../helpers/intel-words.js";
import { readAccess } from "./z80/helpers.js";

for (const name of ["8080", "z80"] as const) {
  test(`${name} word arithmetic retains ordinary and supplied decoding, wraparound, retirement, and each failed fetch boundary`, () => {
    const z80 = name === "z80", failure = new Error("opcode fetch failure");
    for (const form of arithmeticForms[name]) for (const external of [false, true]) for (const set of [false, true]) {
      for (const left of [0, 0xfff, 0x7fff, 0x8000, 0xffff]) for (const right of [0, 1, 0x8000, 0xffff]) {
        for (let failAt = -1; failAt < form.bytes.length; failAt++) {
          let attempts = 0, running = false;
          const completed: CpuZ80InterruptAccess[] = [], attempt = () => { if (attempts++ === failAt) throw failure; };
          class FaultRam extends ObservedRam {
            override read(address: number): number {
              if (running) attempt(); const value = super.read(address);
              if (running) completed.push(readAccess(address, value)); return value;
            }
          }
          const state = { ...wordState(set), ...wordChanges(form.destination, left), ...(form.source ? wordChanges(form.source, right) : {}),
            pc: 0xffff, r: 0xff, im: 0 as const, iff1: true, iff2: true,
            interruptDeferred: !external, nmiDeferred: true, halted: external };
          const ram = new FaultRam();
          if (!external) form.bytes.forEach((value, index) => ram.write((state.pc + index) % 65536, value));
          const cpu = z80 ? new CpuZ80(ram, state) : new Cpu8080(ram, state), before = cpu.snapshot();
          const changes = arithmeticChanges(name, form, state);
          const flags = z80 ? { s: changes.flags.s, z: changes.flags.z, h: changes.flags.h, pv: changes.flags.pv, n: changes.flags.n, c: changes.flags.c }
            : { s: changes.flags.s, z: changes.flags.z, ac: changes.flags.ac, p: changes.flags.p, cy: changes.flags.cy };
          const success = failAt < 0, refresh = external ? (form.bytes.length === 2 && failAt !== 0 ? 2 : 1) : success ? form.bytes.length : 0;
          const after = { ...before, ...(success ? { ...changes, flags } : {}),
            pc: external || !success ? state.pc : (state.pc + form.bytes.length) % 65536,
            halted: false, interruptDeferred: !external && !success,
            ...(z80 ? { r: 0x80 + (127 + refresh) % 128, iff1: !external, iff2: !external, nmiDeferred: !success }
              : { interruptEnabled: !external }),
          };
          const expected = { ...after, bc: after.b * 256 + after.c, de: after.d * 256 + after.e, hl: after.h * 256 + after.l };
          const accesses: CpuZ80InterruptAccess[] = form.bytes.map((value, index) => external ? { kind: "acknowledge", value }
            : readAccess((state.pc + index) % 65536, value));
          ram.accesses.length = 0; running = true;
          const run = () => {
            let supplied = 0;
            const acknowledge = () => { attempt(); const value = form.bytes[supplied++]!; completed.push({ kind: "acknowledge", value }); return value; };
            return external ? cpu instanceof CpuZ80 ? cpu.interrupt("irq", acknowledge) : cpu.interrupt(acknowledge) : cpu.step();
          };
          if (success) assert.deepEqual(run(), { before, after: expected, accesses, outcome: "executed",
            ...(external && z80 ? { source: "irq" } : {}),
            instruction: external ? { source: "interrupt", bytes: form.bytes } : { address: state.pc, bytes: form.bytes } });
          else assert.throws(run, error => error === failure);
          assert.deepEqual(cpu.snapshot(), expected, `${name} ${form.bytes.join(",")}, external=${external}, failure=${failAt}`);
          assert.deepEqual(completed, accesses.slice(0, success ? form.bytes.length : failAt));
          assert.deepEqual(ram.accesses, completed.filter(access => access.kind !== "acknowledge"));
          assert.equal(attempts, success ? form.bytes.length : failAt + 1);
          if (!success) { running = false; cpu.reset(); assert.equal(cpu.snapshot().pc, 0); }
        }
      }
    }
  });
}
