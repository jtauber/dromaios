import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../../src/components/cpus/z80.js";
import type { CpuZ80InterruptAccess } from "../../../../src/components/cpus/z80.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, snapshot, flagPattern, transferColumns, cbRows, expectedCb, indexes, readAccess, writeAccess } from "./helpers.js";

test("Z80 accumulator rotates and all CB operations retain exact completed effects at every ordinary or IM 0 failure", () => {
  const forms = [
    ...([[0x07, "RLC"], [0x0f, "RRC"], [0x17, "RL"], [0x1f, "RR"]] as const).map(([opcode, name]) =>
      ({ bytes: [opcode], name, bit: 0, target: "a" as const, accumulator: true })),
    ...cbRows.flatMap(({ name, bit, base }) => [
      ...transferColumns.map((target, code) => ({ bytes: [0xcb, base + code], name, bit, target, accumulator: false })),
      ...indexes.map(({ prefix, index }) => ({ bytes: [prefix, 0xcb, 0xff, base + 6], name, bit, target: index, accumulator: false })),
    ]),
  ];
  assert.equal(forms.length, 314);
  const failure = new Error("CB access failure");
  for (const { bytes, name, bit, target, accumulator } of forms) for (const external of [false, true]) for (const bits of [0, 63]) {
    const memory = target === "(hl)" || target === "ix" || target === "iy", writes = name !== "BIT";
    const count = bytes.length + (memory ? 1 + Number(writes) : 0);
    for (const address of memory ? [0xffff, 0, 1, 2, 0x4000] : [0xffff]) for (let failAt = -1; failAt < count; failAt++) {
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
      const state = initialState({ pc: 0xffff, r: 0xff, h: Math.floor(address / 256), l: address % 256,
        ix: (address + 1) % 65536, iy: (address + 1) % 65536, flags: flagPattern(bits), im: 0,
        interruptDeferred: !external, nmiDeferred: true, halted: external, iff1: true, iff2: true });
      const ram = new FaultRam(), original = bits === 0 ? 0 : 0x81;
      ram.write(address, original);
      if (!external) bytes.forEach((value, index) => ram.write((state.pc + index) % 65536, value));
      ram.accesses.length = 0; running = true;
      const cpu = new CpuZ80(ram, state);
      const overlap = external ? -1 : bytes.findIndex((_, index) => (state.pc + index) % 65536 === address);
      const operand = memory ? (overlap < 0 ? original : bytes[overlap]!) : state[target];
      const result = expectedCb(name, bit, operand, state.flags);
      const flags = accumulator ? { ...state.flags, c: result.flags.c, h: false, n: false } : result.flags;
      const accesses: CpuZ80InterruptAccess[] = [
        ...bytes.map((value, index) => external ? { kind: "acknowledge" as const, value } : readAccess((state.pc + index) % 65536, value)),
        ...(memory ? [readAccess(address, operand), ...(writes ? [writeAccess(address, result.value)] : [])] : []),
      ];
      const run = () => {
        let next = 0;
        return external ? cpu.interrupt("irq", () => {
          attempt(); const value = bytes[next++]!; completed.push({ kind: "acknowledge", value }); return value;
        }) : cpu.step();
      };
      if (failAt >= 0) assert.throws(run, error => error === failure);
      else {
        const record = run(); assert.equal(record.outcome, "executed");
        assert.deepEqual(record.before, snapshot(state)); assert.deepEqual(record.accesses, accesses);
        assert.deepEqual(record.instruction, external ? { source: "interrupt", bytes } : { address: state.pc, bytes });
      }
      // All four indexed-CB bytes must decode before ordinary PC/R commit; only the first two are M1 fetches.
      const decoded = failAt < 0 || failAt >= bytes.length, success = failAt < 0;
      const refresh = external ? (accumulator || failAt === 0 ? 1 : 2) : decoded ? (accumulator ? 1 : 2) : 0;
      assert.deepEqual(cpu.snapshot(), snapshot({ ...state,
        pc: external || !decoded ? state.pc : (state.pc + bytes.length) % 65536,
        r: 0x80 + (127 + refresh) % 128, halted: false, iff1: !external, iff2: !external,
        interruptDeferred: !external && !success, nmiDeferred: !success,
        ...(success || memory && writes && failAt === count - 1 ? { flags } : {}),
        ...(success && writes && !memory ? { [target]: result.value } : {}),
      }), `${name} ${bit} ${target}, external=${external}, address=${address}, fail=${failAt}`);
      assert.deepEqual(completed, accesses.slice(0, success ? count : failAt));
      assert.deepEqual(ram.accesses, completed.filter(access => access.kind === "read" || access.kind === "write"));
      assert.equal(attempts, success ? count : failAt + 1);
      running = false;
      if (memory) assert.equal(ram.read(address), success && writes ? result.value : operand);
      if (!success) { cpu.reset(); assert.equal(cpu.snapshot().pc, 0); }
    }
  }
});
