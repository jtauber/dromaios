import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../../src/components/cpus/z80.js";
import type { CpuZ80InterruptAccess } from "../../../../src/components/cpus/z80.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, snapshot, readAccess, writeAccess } from "./helpers.js";

const forms = [
  { bytes: [0x08], memory: false, write: false }, { bytes: [0xd9], memory: false, write: false },
  ...[0x44, 0x47, 0x4f, 0x57, 0x5f].map(opcode => ({ bytes: [0xed, opcode], memory: false, write: false })),
  ...[0x67, 0x6f, 0xa0, 0xa8, 0xb0, 0xb8].map(opcode => ({ bytes: [0xed, opcode], memory: true, write: true })),
  ...[0xa1, 0xa9, 0xb1, 0xb9].map(opcode => ({ bytes: [0xed, opcode], memory: true, write: false })),
];

test("Z80 remaining ordinary forms retain exactly completed fetching/acceptance effects at every ordinary or IM 0 access failure", () => {
  assert.equal(forms.length, 17);
  for (const { bytes, memory, write } of forms) for (const external of [false, true]) {
    const count = bytes.length + Number(memory) + Number(write);
    for (let failAt = 0; failAt < count; failAt++) {
      let attempts = 0, running = false;
      const completed: CpuZ80InterruptAccess[] = [], failure = new Error("ordinary access failure");
      const attempt = () => { if (attempts++ === failAt) throw failure; };
      class FaultRam extends ObservedRam {
        override read(address: number) { if (running) attempt(); const value = super.read(address); if (running) completed.push(readAccess(address, value)); return value; }
        override write(address: number, value: number) { if (running) attempt(); super.write(address, value); if (running) completed.push(writeAccess(address, value)); }
      }
      const state = initialState({ pc: 0xffff, r: 0xff, im: 0, iff1: true, iff2: true,
        interruptDeferred: !external, nmiDeferred: true, halted: external });
      const ram = new FaultRam(); ram.write(0x6677, 0x81);
      if (!external) bytes.forEach((byte, i) => ram.write((0xffff + i) % 65536, byte));
      ram.accesses.length = 0; running = true;
      const cpu = new CpuZ80(ram, state);
      let supplied = 0;
      assert.throws(() => external ? cpu.interrupt("irq", () => {
        attempt(); const value = bytes[supplied++]!; completed.push({ kind: "acknowledge", value }); return value;
      }) : cpu.step(), error => error === failure);
      const decoded = failAt >= bytes.length, refresh = external ? failAt === 0 || bytes.length === 1 ? 1 : 2 : decoded ? bytes.length : 0;
      assert.deepEqual(cpu.snapshot(), snapshot({ ...state, halted: false, iff1: !external, iff2: !external,
        pc: !external && decoded ? (state.pc + bytes.length) % 65536 : state.pc, r: 0x80 + (127 + refresh) % 128 }));
      const accesses: CpuZ80InterruptAccess[] = [
        ...bytes.map((value, index) => external ? { kind: "acknowledge" as const, value } : readAccess((state.pc + index) % 65536, value)),
        ...(memory ? [readAccess(0x6677, 0x81)] : []),
      ];
      // Every data write is the final access and fails before changing memory or registers.
      assert.deepEqual(completed, accesses.slice(0, failAt)); assert.equal(attempts, failAt + 1);
      running = false; cpu.reset(); assert.equal(cpu.snapshot().pc, 0);
    }
  }
});
