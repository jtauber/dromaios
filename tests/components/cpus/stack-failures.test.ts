import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6502 } from "../../../src/components/cpus/generated/6502-cpu.js";
import { Cpu6800 } from "../../../src/components/cpus/generated/6800-cpu.js";
import { Cpu6809 } from "../../../src/components/cpus/generated/6809-cpu.js";
import { Cpu8080 } from "../../../src/components/cpus/generated/8080-cpu.js";
import { CpuZ80 } from "../../../src/components/cpus/z80.js";
import type { CpuZ80InterruptAccess } from "../../../src/components/cpus/z80.js";
import { stackForms, stackState } from "../../helpers/stack-forms.js";
import type { StackCpu } from "../../helpers/stack-forms.js";
import { ObservedRam } from "../../helpers/observed-ram.js";

const constructors = { "6502": Cpu6502, "6800": Cpu6800, "6809": Cpu6809, "8080": Cpu8080, z80: CpuZ80 };
const wrap = (value: number, size = 65536) => (value + size) % size;

test("the independent stack inventory covers all 86 migrated native forms", () => {
  assert.deepEqual(Object.values(stackForms).map(forms => forms.length), [4, 8, 6, 32, 36]);
});

for (const name of Object.keys(stackForms) as StackCpu[]) {
  test(`${name} stack and subroutine records retain precise partial effects at every failed access`, () => {
    const mos = name === "6502", intel = name === "8080" || name === "z80", z80 = name === "z80";
    const free = mos || name === "6800", little = mos || intel, pointer = name === "6809" ? "s" : "sp", size = mos ? 256 : 65536;
    const failure = new Error("stack access failure");
    for (const form of stackForms[name]) for (const pc of [0, 0xfffe, 0x01fc]) for (const sp of [0, 1, size - 1, mos ? 0xfe : pc]) {
      for (const mask of form.condition === undefined ? [0, 15] : Array.from({ length: 16 }, (_, i) => i)) for (const external of intel ? [false, true] : [false]) {
        const taken = form.condition === undefined || Boolean(mask & 2 ** Math.floor(form.condition / 2)) === Boolean(form.condition % 2);
        const width = form.fields?.length === 1 && !["ix", "iy"].includes(form.fields[0]!) ? 1 : 2;
        const count = form.bytes.length + (taken ? width : 0), prefixLength = form.bytes[0] === 0xdd || form.bytes[0] === 0xfd ? 2 : 1;
        for (let failAt = -1; failAt < count; failAt++) {
          const state = stackState(name, mask, pc, sp, external), ram = new ObservedRam(), memory = new Map<number, number>();
          // Different adjacent bytes expose endian mistakes; code is loaded last to exercise overlap.
          for (let delta = -2; delta <= 2; delta++) memory.set((mos ? 0x100 : 0) + wrap(sp + delta, size), wrap(delta + 0x80, 256));
          if (!external) form.bytes.forEach((byte, i) => memory.set(wrap(pc + i), byte));
          for (const [address, byte] of memory) ram.write(address, byte);
          const cpu = new constructors[name](ram, state), before = cpu.snapshot(), expectedAccesses: CpuZ80InterruptAccess[] = [], fetched: number[] = [];
          let expectedPC = pc, expectedSP = sp, expectedR = 0xff, attempts = 0;
          const changes: Record<string, unknown> = {}, attempt = () => { if (attempts++ === failAt) throw failure; };
          const read = (address: number) => { attempt(); const value = memory.get(address) ?? 0; expectedAccesses.push({ kind: "read", address, value }); return value; };
          const write = (address: number, value: number) => { attempt(); memory.set(address, value); expectedAccesses.push({ kind: "write", address, value }); };
          const acknowledge = () => { attempt(); const value = form.bytes[fetched.length]!; expectedAccesses.push({ kind: "acknowledge", value }); return value; };
          const fetch = () => { const byte = external ? acknowledge() : read(expectedPC); fetched.push(byte); if (!external) expectedPC = wrap(expectedPC + 1); return byte; };
          const refresh = () => { expectedR = 0x80 + (expectedR + 1) % 128; };
          const push = (byte: number) => {
            if (!free) expectedSP = wrap(expectedSP - 1, size);
            write((mos ? 0x100 : 0) + expectedSP, byte);
            if (free) expectedSP = wrap(expectedSP - 1, size);
          };
          const pop = () => {
            if (free) expectedSP = wrap(expectedSP + 1, size);
            const byte = read((mos ? 0x100 : 0) + expectedSP);
            if (!free) expectedSP = wrap(expectedSP + 1, size);
            return byte;
          };
          const oracle = () => {
            if (z80) {
              // Normal decoding commits PC/R only after the whole opcode; IM0 refreshes before acknowledgements.
              for (let i = 0; i < prefixLength; i++) {
                if (external) refresh();
                const byte = external ? acknowledge() : read(wrap(pc + i)); fetched.push(byte);
              }
              if (!external) { expectedPC = wrap(pc + prefixLength); for (let i = 0; i < prefixLength; i++) refresh(); }
            } else fetch();
            if (mos && form.operation === "call") {
              const low = fetch(); push(Math.floor(expectedPC / 256)); push(expectedPC % 256);
              expectedPC = fetch() * 256 + low; return;
            }
            const operands: number[] = [];
            while (fetched.length < form.bytes.length) operands.push(fetch());
            if (!taken) return;
            if (form.operation === "push" || form.operation === "call") {
              let target = form.target;
              if (form.operation === "call" && target === undefined) {
                if (form.relative) {
                  const encoded = operands.length === 1 ? operands[0]! : operands[0]! * 256 + operands[1]!;
                  const offset = encoded >= 2 ** (form.relative - 1) ? encoded - 2 ** form.relative : encoded;
                  target = wrap(expectedPC + offset);
                } else target = little ? operands[0]! + operands[1]! * 256 : operands[0]! * 256 + operands[1]!;
              }
              const original = form.operation === "call" ? expectedPC : form.fields!.length === 1 ? state[form.fields![0]!]!
                : state[form.fields![0]!]! * 256 + state[form.fields![1]!]!;
              if (width === 1) push(original);
              else { push(little ? Math.floor(original / 256) : original % 256); push(little ? original % 256 : Math.floor(original / 256)); }
              if (form.operation === "call") expectedPC = target!;
            } else {
              const first = pop(), second = width === 2 ? pop() : 0;
              const result = width === 1 ? first : little ? first + second * 256 : first * 256 + second;
              if (form.operation === "return") expectedPC = wrap(result + Number(mos));
              else if (form.fields!.length === 2) {
                changes[form.fields![0]!] = Math.floor(result / 256); changes[form.fields![1]!] = result % 256;
                changes[form.fields!.join("")] = result;
              } else {
                changes[form.fields![0]!] = result;
                if (mos) changes.flags = { ...before.flags, n: result >= 128, z: result === 0 };
              }
            }
          };
          if (failAt < 0) oracle(); else assert.throws(oracle, error => error === failure);
          const success = failAt < 0, after = { ...before, ...changes, pc: expectedPC, [pointer]: expectedSP,
            ...(intel ? { halted: false, interruptDeferred: !external && !success } : {}),
            ...(z80 ? { r: expectedR, iff1: !external, iff2: !external, nmiDeferred: !success }
              : name === "8080" ? { interruptEnabled: !external } : {}),
          };
          let actualAttempts = 0, supplied = 0;
          const completed: CpuZ80InterruptAccess[] = [], actualAttempt = () => { if (actualAttempts++ === failAt) throw failure; };
          const originalRead = ram.read.bind(ram), originalWrite = ram.write.bind(ram);
          ram.read = address => { actualAttempt(); const value = originalRead(address); completed.push({ kind: "read", address, value }); return value; };
          ram.write = (address, value) => { actualAttempt(); originalWrite(address, value); completed.push({ kind: "write", address, value }); };
          const supply = () => { actualAttempt(); const value = form.bytes[supplied++]!; completed.push({ kind: "acknowledge", value }); return value; };
          ram.accesses.length = 0;
          const run = () => external ? cpu instanceof CpuZ80 ? cpu.interrupt("irq", supply)
            : cpu instanceof Cpu8080 ? cpu.interrupt(supply) : assert.fail("not Intel") : cpu.step();
          if (success) assert.deepEqual(run(), { before, after, accesses: expectedAccesses, outcome: "executed",
            ...(external && z80 ? { source: "irq" } : {}), instruction: external ? { source: "interrupt", bytes: fetched } : { address: pc, bytes: fetched } });
          else assert.throws(run, error => error === failure);
          assert.deepEqual(cpu.snapshot(), after, `${name} ${form.bytes.join(",")}, PC=${pc}, SP=${sp}, flags=${mask}, external=${external}, failure=${failAt}`);
          assert.deepEqual(completed, expectedAccesses); assert.equal(actualAttempts, attempts);
          assert.deepEqual(ram.accesses, completed.filter(access => access.kind !== "acknowledge"));
          for (const access of completed) if (access.kind === "write") assert.equal(originalRead(access.address), memory.get(access.address));
        }
      }
    }
  });
}

test("6809 indexed JSR retains S updates and NMI arming before pointer and stack failures", () => {
  const failure = new Error("indexed call failure");
  for (const [postbyte, original, adjusted, indirect] of [[0xe1, 0xffff, 1, false], [0xe3, 1, 0xffff, false],
    [0xf1, 0xffff, 1, true], [0xf3, 1, 0xffff, true]] as const) {
    const stackStart = indirect ? 4 : 2, count = stackStart + 2;
    for (const armed of [false, true]) for (let failAt = -1; failAt < count; failAt++) {
      const ram = new ObservedRam(); ram.write(0x12fc, 0xad); ram.write(0x12fd, postbyte); ram.write(0xffff, 0x45); ram.write(0, 0x67);
      const cpu = new Cpu6809(ram, { ...stackState("6809", 15, 0x12fc, 0), s: original, nmiArmed: armed }), before = cpu.snapshot();
      const accesses = [{ kind: "read", address: 0x12fc, value: 0xad }, { kind: "read", address: 0x12fd, value: postbyte },
        ...(indirect ? [{ kind: "read", address: 0xffff, value: 0x45 }, { kind: "read", address: 0, value: 0x67 }] : []),
        { kind: "write", address: wrap(adjusted - 1), value: 0xfe }, { kind: "write", address: wrap(adjusted - 2), value: 0x12 }];
      let attempts = 0;
      const read = ram.read.bind(ram), write = ram.write.bind(ram), attempt = () => { if (attempts++ === failAt) throw failure; };
      ram.read = address => { attempt(); return read(address); };
      ram.write = (address, byte) => { attempt(); write(address, byte); };
      ram.accesses.length = 0;
      if (failAt < 0) {
        const record = cpu.step(); assert.equal(record.outcome, "executed"); assert.deepEqual(record.accesses, accesses);
      } else assert.throws(() => cpu.step(), error => error === failure);
      const decoded = failAt < 0 || failAt >= 2, pushed = failAt < 0 ? 2 : Math.max(0, failAt - stackStart + 1);
      assert.deepEqual(cpu.snapshot(), { ...before,
        pc: failAt < 0 ? indirect ? 0x4567 : 0xffff : 0x12fc + Math.min(failAt, 2),
        s: decoded ? wrap(adjusted - pushed) : original, nmiArmed: armed || decoded });
      assert.deepEqual(ram.accesses, accesses.slice(0, failAt < 0 ? count : failAt));
    }
  }
  for (const postbyte of [0xf0, 0xf2, 0xe7, 0xea]) {
    const ram = new ObservedRam(); ram.write(0x12fc, 0xad); ram.write(0x12fd, postbyte);
    const cpu = new Cpu6809(ram, stackState("6809", 15, 0x12fc, 0)), before = cpu.snapshot(); ram.accesses.length = 0;
    assert.deepEqual(cpu.step(), { before, after: before, instruction: { address: 0x12fc, bytes: [0xad, postbyte] },
      accesses: [{ kind: "read", address: 0x12fc, value: 0xad }, { kind: "read", address: 0x12fd, value: postbyte }], outcome: "unsupported", reason: "opcode" });
  }
});
