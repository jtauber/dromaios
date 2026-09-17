import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuZ80 } from "../../../../src/components/cpus/z80.js";
import type { CpuZ80InterruptAccess } from "../../../../src/components/cpus/z80.js";
import { ObservedRam } from "../../../helpers/observed-ram.js";
import { initialState, snapshot, flagPattern, transferColumns, indexes, readAccess, writeAccess, checkPrefixedStep } from "./helpers.js";

// Independently transcribed register columns and memory forms; expectations use integer ranges.
const adjustments = [
  { name: "INC", delta: 1, opcodes: [0x04, 0x0c, 0x14, 0x1c, 0x24, 0x2c, 0x34, 0x3c] },
  { name: "DEC", delta: -1, opcodes: [0x05, 0x0d, 0x15, 0x1d, 0x25, 0x2d, 0x35, 0x3d] },
] as const;
function expected(original: number, delta: number, carry: boolean) {
  const value = (original + delta + 256) % 256, low = original % 16 + delta;
  const signed = (original < 128 ? original : original - 256) + delta;
  return { value, flags: { s: value >= 128, z: value === 0, h: low < 0 || low > 15,
    pv: signed < -128 || signed > 127, n: delta < 0, c: carry } };
}

test("Z80 byte adjustments retain exact completed effects at every ordinary and IM 0 failure", () => {
  const forms = adjustments.flatMap(({ name, delta, opcodes }) => [
    ...opcodes.map((opcode, column) => ({ name, delta, bytes: [opcode], target: transferColumns[column]!, encoding: 1 })),
    ...indexes.map(({ prefix, index }) => ({ name, delta, bytes: [prefix, opcodes[6], 0xff], target: index, encoding: 2 })),
  ]);
  assert.equal(forms.length, 20);
  const failure = new Error("adjustment access failure");
  for (const { name, delta, bytes, target, encoding } of forms) for (const external of [false, true]) for (const bits of [0, 63]) {
    const memory = target === "(hl)" || target === "ix" || target === "iy", count = bytes.length + (memory ? 2 : 0);
    for (const address of [0xffff, 0, 1, 0x4000]) for (let failAt = -1; failAt < count; failAt++) {
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
      const ram = new FaultRam(), original = bits === 0 ? 0x80 : 0x7f;
      ram.write(address, original);
      if (!external) bytes.forEach((value, index) => ram.write((state.pc + index) % 65536, value));
      ram.accesses.length = 0; running = true;
      const cpu = new CpuZ80(ram, state);
      const overlap = external ? -1 : bytes.findIndex((_, index) => (state.pc + index) % 65536 === address);
      const operand = memory ? (overlap < 0 ? original : bytes[overlap]!) : state[target];
      const result = expected(operand, delta, state.flags.c);
      const accesses: CpuZ80InterruptAccess[] = [
        ...bytes.map((value, index) => external ? { kind: "acknowledge" as const, value } : readAccess((state.pc + index) % 65536, value)),
        ...(memory ? [readAccess(address, operand), writeAccess(address, result.value)] : []),
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
      // Indexed displacement fetch follows committed prefix decoding; it does not increment R.
      const decoded = failAt < 0 || failAt >= encoding, success = failAt < 0;
      const fetched = success ? bytes.length : Math.min(failAt, bytes.length);
      const refresh = external ? (encoding === 2 && failAt !== 0 ? 2 : 1) : decoded ? encoding : 0;
      assert.deepEqual(cpu.snapshot(), snapshot({ ...state,
        pc: external || !decoded ? state.pc : (state.pc + fetched) % 65536,
        r: 0x80 + (127 + refresh) % 128, halted: false, iff1: !external, iff2: !external,
        interruptDeferred: !external && !success, nmiDeferred: !success,
        ...(success || memory && failAt === count - 1 ? { flags: result.flags } : {}),
        ...(success && !memory ? { [target]: result.value } : {}),
      }), `${name} ${target}, external=${external}, address=${address}, fail=${failAt}`);
      assert.deepEqual(completed, accesses.slice(0, success ? count : failAt));
      assert.deepEqual(ram.accesses, completed.filter(access => access.kind !== "acknowledge"));
      assert.equal(attempts, success ? count : failAt + 1);
      running = false;
      if (memory) assert.equal(ram.read(address), success ? result.value : operand);
      if (!success) { cpu.reset(); assert.equal(cpu.snapshot().pc, 0); }
    }
  }
});

test("Z80 generated indexed adjustments cover every signed displacement at wrapping boundaries", () => {
  const ram = new ObservedRam();
  for (const { prefix, index } of indexes) for (let displacement = 0; displacement < 256; displacement++) {
    for (const pointer of [0, 0xffff]) for (const carry of [false, true]) for (const { delta, opcodes } of adjustments) {
      const address = (pointer + (displacement < 128 ? displacement : displacement - 256) + 65536) % 65536;
      const original = (displacement * 37 + 11) % 256, result = expected(original, delta, carry);
      const state = initialState({ [index]: pointer, flags: { ...flagPattern(displacement % 32), c: carry } });
      ram.write(address, original);
      checkPrefixedStep(ram, state, [prefix, opcodes[6], displacement], { flags: result.flags }, [readAccess(address, original), writeAccess(address, result.value)]);
    }
  }
});
