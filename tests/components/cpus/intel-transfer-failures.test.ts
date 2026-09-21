import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu8080 } from "../../../src/components/cpus/generated/8080-cpu.js";
import { CpuZ80 } from "../../../src/components/cpus/generated/z80-cpu.js";
import type { CpuZ80InterruptAccess } from "../../../src/components/cpus/generated/z80-cpu.js";
import { ObservedRam } from "../../helpers/observed-ram.js";
import { initialState, flagPattern, transferColumns, transferRows, indexes, readAccess, writeAccess } from "./z80/helpers.js";

const ordinary = [
  ...transferRows.flatMap(({ destination, opcodes }) => opcodes.flatMap((opcode, column) => opcode === 0x76 ? []
    : [{ bytes: [opcode], destination, source: transferColumns[column]!, encoding: 1 }])),
  ...[0x06, 0x0e, 0x16, 0x1e, 0x26, 0x2e, 0x36, 0x3e].map((opcode, column) =>
    ({ bytes: [opcode, 0xa5], destination: transferColumns[column]!, source: "immediate" as const, encoding: 1 })),
];
const indexed = indexes.flatMap(({ prefix, index }) => [
  ...([
    ["b", 0x46, 0x70], ["c", 0x4e, 0x71], ["d", 0x56, 0x72], ["e", 0x5e, 0x73],
    ["h", 0x66, 0x74], ["l", 0x6e, 0x75], ["a", 0x7e, 0x77],
  ] as const).flatMap(([register, load, store]) => [
    { bytes: [prefix, load, 0xff], destination: register, source: index, encoding: 2 },
    { bytes: [prefix, store, 0xff], destination: index, source: register, encoding: 2 },
  ]),
  { bytes: [prefix, 0x36, 0xff, 0xa5], destination: index, source: "immediate" as const, encoding: 2 },
]);
const memory = (operand: string) => operand === "(hl)" || operand === "ix" || operand === "iy";

for (const z80 of [false, true]) {
  test(`${z80 ? "Z80" : "8080"} byte transfers retain every completed effect on ordinary and interrupt-supplied failures`, () => {
    const forms = z80 ? [...ordinary, ...indexed] : ordinary;
    assert.equal(forms.length, z80 ? 101 : 71);
    const failure = new Error("transfer access failure");
    for (const { bytes, destination, source, encoding } of forms) for (const external of [false, true]) for (const set of [false, true]) {
      const count = bytes.length + Number(memory(source) || memory(destination));
      for (const address of [0xffff, 0, 1, 2, 0x4000]) for (let failAt = -1; failAt < count; failAt++) {
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
        const state = { ...initialState({ pc: 0xffff, r: 0xff, h: Math.floor(address / 256), l: address % 256,
          ix: (address + 1) % 65536, iy: (address + 1) % 65536, im: 0, iff1: true, iff2: true,
          interruptDeferred: !external, nmiDeferred: true, halted: external }), interruptEnabled: true,
          flags: { ...flagPattern(set ? 63 : 0), cy: set, ac: set, p: set } };
        const ram = new FaultRam();
        // Stores normally write an already matching byte; code overlap can replace it before execution.
        const original = source === "immediate" ? 0xa5 : source === "(hl)" ? 0x81 : state[source];
        ram.write(address, memory(source) ? 0x81 : original);
        if (!external) bytes.forEach((value, index) => ram.write((state.pc + index) % 65536, value));
        const memoryBefore = ram.read(address);
        ram.accesses.length = 0; running = true;
        const cpu = z80 ? new CpuZ80(ram, state) : new Cpu8080(ram, state), before = cpu.snapshot();
        const value = memory(source) ? memoryBefore : original;
        const accesses: CpuZ80InterruptAccess[] = [
          ...bytes.map((value, index) => external ? { kind: "acknowledge" as const, value } : readAccess((state.pc + index) % 65536, value)),
          ...(memory(source) ? [readAccess(address, value)] : memory(destination) ? [writeAccess(address, value)] : []),
        ];
        const run = () => {
          let next = 0;
          const acknowledge = () => { attempt(); const value = bytes[next++]!; completed.push({ kind: "acknowledge", value }); return value; };
          return external ? cpu instanceof CpuZ80 ? cpu.interrupt("irq", acknowledge) : cpu.interrupt(acknowledge) : cpu.step();
        };
        if (failAt >= 0) assert.throws(run, error => error === failure);
        else {
          const record = run(); assert.equal(record.outcome, "executed");
          assert.deepEqual(record.before, before); assert.deepEqual(record.accesses, accesses);
          assert.deepEqual(record.instruction, external ? { source: "interrupt", bytes } : { address: state.pc, bytes });
        }
        const success = failAt < 0, decoded = success || failAt >= encoding;
        const fetched = success ? bytes.length : Math.min(failAt, bytes.length);
        const refresh = external ? (encoding === 2 && failAt !== 0 ? 2 : 1) : decoded ? encoding : 0;
        const after = { ...before, pc: external || !decoded ? state.pc : (state.pc + fetched) % 65536,
          halted: false, interruptDeferred: !external && !success,
          ...(z80 ? { r: 0x80 + (127 + refresh) % 128, iff1: !external, iff2: !external, nmiDeferred: !success }
            : { interruptEnabled: !external }),
          ...(success && !memory(destination) ? { [destination]: value } : {}),
        };
        assert.deepEqual(cpu.snapshot(), { ...after, bc: after.b * 256 + after.c, de: after.d * 256 + after.e, hl: after.h * 256 + after.l },
          `${bytes.join(",")} ${destination},${source}, external=${external}, address=${address}, failure=${failAt}`);
        assert.deepEqual(completed, accesses.slice(0, success ? count : failAt));
        assert.deepEqual(ram.accesses, completed.filter(access => access.kind !== "acknowledge"));
        assert.equal(attempts, success ? count : failAt + 1);
        running = false;
        assert.equal(ram.read(address), success && memory(destination) ? value : memoryBefore);
        if (!success) { cpu.reset(); assert.equal(cpu.snapshot().pc, 0); }
      }
    }
  });
}
