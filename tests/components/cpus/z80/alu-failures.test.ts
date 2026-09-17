import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../../src/components/cpus/z80.js";
import type { CpuZ80InterruptAccess } from "../../../../src/components/cpus/z80.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, snapshot, flagPattern, transferColumns, aluForms, expectedAlu, indexes, readAccess, checkPrefixedStep } from "./helpers.js";

test("Z80 ALU forms retain exact completed effects on every failed read or IM 0 acknowledgement", () => {
  const failure = new Error("ALU access failure");
  for (const { name, opcodes, immediate } of aluForms) {
    const forms = [
      ...opcodes.map((opcode, index) => ({ bytes: [opcode], source: transferColumns[index]!, encoding: 1 })),
      { bytes: [immediate, 0x81], source: "immediate" as const, encoding: 1 },
      ...indexes.map(({ prefix, index }) => ({ bytes: [prefix, opcodes[6]!, 0xff], source: index, encoding: 2 })),
    ] as const;
    for (const { bytes, source, encoding } of forms) for (const external of [false, true]) {
      for (const bits of [0, 63]) for (const address of [0, 0xffff]) {
        const memory = source === "(hl)" || source === "ix" || source === "iy", count = bytes.length + Number(memory);
        for (let failAt = -1; failAt < count; failAt++) {
          let attempts = 0;
          const completed: CpuZ80InterruptAccess[] = [];
          const attempt = () => { if (attempts++ === failAt) throw failure; };
          class FaultRam extends ObservedRam {
            override read(address: number): number {
              attempt(); const value = super.read(address); completed.push({ kind: "read", address, value }); return value;
            }
          }
          const state = initialState({ pc: 0xffff, r: 0xff, h: Math.floor(address / 256), l: address % 256,
            ix: (address + 1) % 65536, iy: (address + 1) % 65536, flags: flagPattern(bits), im: 0,
            interruptDeferred: !external, nmiDeferred: true, halted: external, iff1: true, iff2: true });
          const ram = new FaultRam(); ram.write(address, 0x81);
          if (!external) bytes.forEach((value, index) => ram.write((state.pc + index) % 65536, value));
          ram.accesses.length = 0;
          const cpu = new CpuZ80(ram, state), before = cpu.snapshot();
          const overlap = external ? -1 : bytes.findIndex((_, index) => (state.pc + index) % 65536 === address);
          const operand = source === "immediate" ? 0x81 : memory ? (overlap < 0 ? 0x81 : bytes[overlap]!)
            : state[source];
          const result = expectedAlu(name, state.a, operand, state.flags.c);
          const accesses: CpuZ80InterruptAccess[] = [
            ...bytes.map((value, index) => external ? { kind: "acknowledge" as const, value }
              : { kind: "read" as const, address: (state.pc + index) % 65536, value }),
            ...(memory ? [readAccess(address, operand)] : []),
          ];
          const run = () => {
            let next = 0;
            return external ? cpu.interrupt("irq", () => {
              attempt(); const value = bytes[next++]!; completed.push({ kind: "acknowledge", value }); return value;
            }) : cpu.step();
          };
          if (failAt >= 0) assert.throws(run, error => error === failure);
          else {
            const record = run();
            assert.equal(record.outcome, "executed"); assert.deepEqual(record.accesses, accesses);
            assert.deepEqual(record.instruction?.bytes, bytes);
          }
          const decoded = failAt < 0 || failAt >= encoding;
          const fetched = failAt < 0 ? bytes.length : failAt;
          // Ordinary decoding commits PC/R together. IM 0 increments R before each opcode acknowledgement, even a failed one.
          const refresh = external ? (encoding === 2 && failAt !== 0 ? 2 : 1) : decoded ? encoding : 0;
          assert.deepEqual(cpu.snapshot(), snapshot({ ...state,
            pc: external || !decoded ? state.pc : (state.pc + fetched) % 65536,
            r: 0x80 + (127 + refresh) % 128, halted: false,
            iff1: !external, iff2: !external, interruptDeferred: !external && failAt >= 0, nmiDeferred: failAt >= 0,
            ...(failAt < 0 ? result : {}),
          }), `${name} ${source}, external=${external}, address=${address}, fail=${failAt}`);
          assert.deepEqual(completed, accesses.slice(0, failAt < 0 ? count : failAt));
          assert.equal(attempts, failAt < 0 ? count : failAt + 1);
          assert.deepEqual(ram.accesses, completed.filter(access => access.kind === "read"));
          assert.deepEqual(before, snapshot(state));
          if (failAt >= 0) { cpu.reset(); assert.equal(cpu.snapshot().pc, 0); }
        }
      }
    }
  }
});

test("Z80 indexed ALU bodies cover every signed displacement at wrapping boundaries", () => {
  const ram = new ObservedRam();
  for (const { prefix, index } of indexes) for (let displacement = 0; displacement < 256; displacement++) {
    for (const pointer of [0, 0xffff]) for (const carry of [false, true]) {
      const target = (pointer + (displacement < 128 ? displacement : displacement - 256) + 65536) % 65536;
      const value = (displacement * 37 + 11) % 256;
      const state = initialState({ [index]: pointer, flags: { ...flagPattern(displacement % 32), c: carry } });
      ram.write(target, value);
      for (const { name, opcodes } of aluForms) {
        checkPrefixedStep(ram, state, [prefix, opcodes[6]!, displacement], expectedAlu(name, state.a, value, carry), [readAccess(target, value)]);
      }
    }
  }
});
