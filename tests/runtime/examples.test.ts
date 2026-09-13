import type { Cpu8008 } from "../../src/components/cpus/8008.js";
import { create8008Example } from "../../src/machines/generated/8008/example.js";
import { create8008StackExample } from "../../src/machines/generated/8008/stack-example.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cpu8080 } from "../../src/components/cpus/8080.js";
import type { Cpu8088 } from "../../src/components/cpus/8088.js";
import { create8088Example } from "../../src/machines/generated/8088/example.js";
import type { Cpu6502 } from "../../src/components/cpus/6502.js";
import type { Cpu6800 } from "../../src/components/cpus/6800.js";
import { create6800Example } from "../../src/machines/generated/6800/example.js";
import { create6800CountedLoopExample } from "../../src/machines/generated/6800/counted-loop-example.js";
import type { Cpu6809 } from "../../src/components/cpus/6809.js";
import type { CpuZ80 } from "../../src/components/cpus/z80.js";
import { createZ80Example } from "../../src/machines/generated/z80/example.js";
import type { Ram } from "../../src/components/memory/ram.js";
import { runCpu } from "../../src/runtime/run-cpu.js";
import { create8080Example } from "../../src/machines/generated/8080/example.js";
import { create8080RegisterPairsExample } from "../../src/machines/generated/8080/register-pairs-example.js";
import { create8080StackExample } from "../../src/machines/generated/8080/stack-example.js";
import { create8080PswExample } from "../../src/machines/generated/8080/psw-example.js";
import { create8080AddressingExample } from "../../src/machines/generated/8080/addressing-example.js";
import { create8080ControlFlowExample } from "../../src/machines/generated/8080/control-flow-example.js";
import { create8080TransfersExample } from "../../src/machines/generated/8080/transfers-example.js";
import { create8080AluExample } from "../../src/machines/generated/8080/alu-example.js";
import { create8080DecimalExample } from "../../src/machines/generated/8080/decimal-example.js";
import { create8080CountedLoopExample } from "../../src/machines/generated/8080/counted-loop-example.js";
import { create8080RotatesExample } from "../../src/machines/generated/8080/rotates-example.js";
import { create6502Example } from "../../src/machines/generated/6502/example.js";
import { create6502StackExample } from "../../src/machines/generated/6502/stack-example.js";
import { create6502AddressingExample } from "../../src/machines/generated/6502/addressing-example.js";
import { create6809Example } from "../../src/machines/generated/6809/example.js";
import { create6809StackExample } from "../../src/machines/generated/6809/stack-example.js";
import { create6809AddressingExample } from "../../src/machines/generated/6809/addressing-example.js";

interface ExampleCase {
  readonly name: string;
  readonly create: () => { cpu: Cpu8008 | Cpu8080 | Cpu8088 | Cpu6502 | Cpu6800 | Cpu6809 | CpuZ80; ram: Ram; endAddress?: number };
  readonly steps: number;
  readonly pc: number;
  readonly stopReason: "completed" | "halted";
  readonly writes: readonly (readonly [number, number])[];
}

// Expectations come from the example specifications, independently of the factories.
const examples: readonly ExampleCase[] = [
  { name: "8088 arithmetic", create: create8088Example, steps: 3, pc: 0x12449, stopReason: "completed",
    writes: [[0x20081, 1], [0x20082, 0x13]] },
  { name: "8008 arithmetic", create: create8008Example, steps: 6, pc: 10, stopReason: "halted", writes: [[0x80, 5]] },
  { name: "8008 stack", create: create8008StackExample, steps: 11, pc: 0x020b, stopReason: "halted", writes: [[0x80, 0x0a]] },
  { name: "6800 arithmetic", create: create6800Example, steps: 3, pc: 0x0207, stopReason: "completed", writes: [[0x80, 5]] },
  { name: "6800 counted loop", create: create6800CountedLoopExample, steps: 12, pc: 0x020c, stopReason: "completed", writes: [[0x80, 0x0f]] },
  {
    name: "8080 rotates", create: create8080RotatesExample, steps: 21, pc: 0x021d, stopReason: "halted",
    writes: [[0x80, 0], [0x81, 3], [0x82, 0x80], [0x83, 0x81], [0x84, 0x7f]],
  },
  { name: "Z80 arithmetic", create: createZ80Example, steps: 4, pc: 8, stopReason: "halted", writes: [[0x80, 5]] },
  { name: "8080 arithmetic", create: create8080Example, steps: 4, pc: 0x0008, stopReason: "halted", writes: [[0x0080, 5]] },
  { name: "8080 register pairs", create: create8080RegisterPairsExample, steps: 3, pc: 0x0005, stopReason: "halted", writes: [] },
  { name: "8080 stack", create: create8080StackExample, steps: 6, pc: 0x000c, stopReason: "halted", writes: [[0x1fff, 0x12], [0x1ffe, 0x34]] },
  {
    name: "8080 PSW", create: create8080PswExample, steps: 9, pc: 0x0210, stopReason: "halted",
    writes: [[0, 0x81], [0xffff, 0x93], [0x80, 0x81], [0x81, 0x82]],
  },
  { name: "8080 addressing", create: create8080AddressingExample, steps: 5, pc: 0x0007, stopReason: "halted", writes: [[0x1300, 0xa5]] },
  {
    name: "8080 counted loop", create: create8080CountedLoopExample, steps: 18, pc: 0x0213, stopReason: "halted",
    writes: [[0xffff, 0], [0, 0x10], [1, 0x80], [0x80, 1], [0x81, 0]],
  },
  {
    name: "8080 ALU", create: create8080AluExample, steps: 23, pc: 0x0030, stopReason: "halted",
    writes: [[0x82, 0x10], [0x83, 2], [0x84, 0xf0], [0x85, 1], [0x86, 0x75]],
  },
  {
    name: "8080 decimal", create: create8080DecimalExample, steps: 9, pc: 0x0211, stopReason: "halted",
    writes: [[0x80, 0x98], [0x81, 0x11]],
  },
  {
    name: "8080 transfers", create: create8080TransfersExample, steps: 15, pc: 0x001b, stopReason: "halted",
    writes: [[0x80, 0xa5], [0x80, 0x5a], [0x81, 0xa5], [0x82, 0x55], [0x83, 0xa5], [0x2001, 0x20], [0x2000, 0]],
  },
  {
    name: "8080 control flow", create: create8080ControlFlowExample, steps: 11, pc: 0x000c, stopReason: "halted",
    writes: [[0x1fff, 0], [0x1ffe, 5], [0x1fff, 0], [0x1ffe, 5], [0x0080, 0]],
  },
  { name: "6502 arithmetic", create: create6502Example, steps: 4, pc: 0x0208, stopReason: "completed", writes: [[0x0080, 5]] },
  { name: "6502 stack", create: create6502StackExample, steps: 5, pc: 0x0209, stopReason: "completed", writes: [[0x01ff, 0x80], [0x0080, 0x80]] },
  { name: "6502 addressing", create: create6502AddressingExample, steps: 2, pc: 0x0204, stopReason: "completed", writes: [[0x0000, 0xa5]] },
  { name: "6809 arithmetic", create: create6809Example, steps: 3, pc: 0x0207, stopReason: "completed", writes: [[0x0080, 5]] },
  { name: "6809 stack", create: create6809StackExample, steps: 9, pc: 0x0214, stopReason: "completed", writes: [[0x7fff, 0x12], [0x3fff, 0x34], [0x0080, 0x12], [0x0081, 0x34]] },
  { name: "6809 addressing", create: create6809AddressingExample, steps: 2, pc: 0x0204, stopReason: "completed", writes: [[0x1281, 0xa5]] },
];

for (const example of examples) {
  test(`the runner completes the ${example.name} example at its exact step budget`, (t) => {
    const { cpu, ram, endAddress } = example.create();
    const step = t.mock.method(cpu, "step");
    const read = t.mock.method(ram, "read");
    const write = t.mock.method(ram, "write");
    const result = runCpu(cpu, { maxSteps: example.steps, endAddress });
    assert.equal(result.stopReason, example.stopReason);
    assert.equal(result.records.length, example.steps);
    assert.equal(step.mock.callCount(), example.steps);
    assert.equal(cpu.snapshot().pc, example.pc);
    for (const [index, record] of result.records.entries()) {
      assert.strictEqual(record, step.mock.calls[index]?.result);
    }
    const accesses = result.records.flatMap(record => record.accesses);
    assert.deepEqual(read.mock.calls.map(call => call.arguments),
      accesses.filter(access => access.kind === "read").map(access => [access.address]));
    assert.deepEqual(write.mock.calls.map(call => call.arguments), example.writes);
    // Repeated writes remain in the access log; the last value is left in RAM.
    for (const [address, value] of new Map(example.writes)) assert.equal(ram.read(address), value);
  });
}
