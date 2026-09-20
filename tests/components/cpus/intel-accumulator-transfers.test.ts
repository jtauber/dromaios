import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8080 } from "../../../src/components/cpus/generated/8080-cpu.js";
import { CpuZ80 } from "../../../src/components/cpus/z80.js";
import type { CpuZ80InterruptAccess } from "../../../src/components/cpus/z80.js";
import { ObservedRam } from "../../helpers/observed-ram.js";
import { accumulatorState, accumulatorTransfers } from "../../helpers/intel-accumulator-transfers.js";
import { readAccess, writeAccess } from "./z80/helpers.js";

for (const name of ["8080", "z80"] as const) {
  test(`${name} accumulator transfers preserve ordinary and supplied fetching, overlap, wraparound, and every failed access`, () => {
    const z80 = name === "z80", failure = new Error("accumulator transfer failure");
    for (const { opcode, pair, operation } of accumulatorTransfers) for (const external of [false, true]) {
      for (const pc of [0xfffe, 0xffff]) for (const address of [0xfffe, 0xffff, 0, 1, 0x4000]) {
        for (const a of [0, 0x7f, 0x80, 0xff]) for (const bits of [0, 21, 42, 63]) {
          const bytes = [opcode, ...(pair === null ? [address % 256, Math.floor(address / 256)] : [])], count = bytes.length + 1;
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
            const state = { ...accumulatorState(bits), a, pc, r: 0xff, im: 0 as const,
              iff1: true, iff2: true, interruptDeferred: !external, nmiDeferred: true, halted: external,
              ...(pair === null ? {} : { [pair[0]]: Math.floor(address / 256), [pair[1]]: address % 256 }) };
            const ram = new FaultRam(); ram.write(address, a ^ 0xff);
            if (!external) bytes.forEach((value, index) => ram.write((pc + index) % 65536, value));
            const memoryBefore = ram.read(address), cpu = z80 ? new CpuZ80(ram, state) : new Cpu8080(ram, state), before = cpu.snapshot();
            const accesses: CpuZ80InterruptAccess[] = [
              ...bytes.map((value, index) => external ? { kind: "acknowledge" as const, value } : readAccess((pc + index) % 65536, value)),
              operation === "store" ? writeAccess(address, a) : readAccess(address, memoryBefore),
            ];
            const success = failAt < 0, fetched = success ? bytes.length : Math.min(failAt, bytes.length);
            const after = { ...before, pc: external ? pc : (pc + fetched) % 65536,
              ...(success && operation === "load" ? { a: memoryBefore } : {}),
              halted: false, interruptDeferred: !external && !success,
              ...(z80 ? { r: external || fetched > 0 ? 0x80 : 0xff, iff1: !external, iff2: !external, nmiDeferred: !success }
                : { interruptEnabled: !external }),
            };
            ram.accesses.length = 0; running = true;
            const run = () => {
              let supplied = 0;
              const acknowledge = () => { attempt(); const value = bytes[supplied++]!; completed.push({ kind: "acknowledge", value }); return value; };
              return external ? cpu instanceof CpuZ80 ? cpu.interrupt("irq", acknowledge) : cpu.interrupt(acknowledge) : cpu.step();
            };
            if (success) assert.deepEqual(run(), { before, after, accesses, outcome: "executed",
              ...(external && z80 ? { source: "irq" } : {}),
              instruction: external ? { source: "interrupt", bytes } : { address: pc, bytes } });
            else assert.throws(run, error => error === failure);
            assert.deepEqual(cpu.snapshot(), after, `${name} ${opcode.toString(16)}, external=${external}, failure=${failAt}`);
            assert.deepEqual(completed, accesses.slice(0, success ? count : failAt));
            assert.deepEqual(ram.accesses, completed.filter(access => access.kind !== "acknowledge"));
            assert.equal(attempts, success ? count : failAt + 1);
            running = false; assert.equal(ram.read(address), success && operation === "store" ? a : memoryBefore);
            if (!success) { cpu.reset(); assert.equal(cpu.snapshot().pc, 0); }
          }
        }
      }
    }
  });
}
