import assert from "node:assert/strict";
import { test } from "node:test";
import { registerProgram } from "../../site/interactive/register-programs.js";
import { createProgramHistory } from "../../site/interactive/program-history.js";

test("the countdown presents the zero flag and explains both outcomes from recorded execution", () => {
  const definition = registerProgram("countdown");
  assert.equal(definition.flag, "z");
  const { cpu, ram, endAddress } = definition.createMachine();
  const history = createProgramHistory(cpu.snapshot().pc, definition.instructions.map(instruction => instruction.address));
  const decisions: string[] = [];
  const calculations: string[] = [];
  for (let step = 0; step < 10; step++) {
    const instruction = definition.instructions.find(instruction => instruction.address === cpu.snapshot().pc)!;
    const previousDestination = ram.read(4);
    const record = cpu.step();
    assert.equal(record.outcome, "executed");
    assert.equal(instruction.length, record.instruction.bytes.length);
    history.record(record.instruction, record.after.pc);
    if (instruction.action === "subtract") {
      assert.equal(instruction.mnemonic(address => ram.read(address)), "SUI 1");
      calculations.push(instruction.describe(record, previousDestination));
    } else if (instruction.action === "jump") {
      assert.equal(instruction.mnemonic(address => ram.read(address)), "JNZ 0103H");
      assert.equal(instruction.explanation(address => ram.read(address)), "Jump to 0103 if Z = 0");
      decisions.push(instruction.describe(record, previousDestination));
    }
  }
  assert.deepEqual(calculations, [
    "Subtracted one from 3. A now holds 2; zero flag Z is 0. Memory is unchanged.",
    "Subtracted one from 2. A now holds 1; zero flag Z is 0. Memory is unchanged.",
    "Subtracted one from 1. A now holds 0; zero flag Z is 1. Memory is unchanged.",
  ]);
  assert.deepEqual(decisions, [
    "Z was 0 (clear). Jump taken: returned from 0108 to 0103. A, flags, and memory are unchanged.",
    "Z was 0 (clear). Jump taken: returned from 0108 to 0103. A, flags, and memory are unchanged.",
    "Z was 1 (set). Jump not taken: continued from 0108 to 010B. A, flags, and memory are unchanged.",
  ]);
  assert.deepEqual([...history.visits], [[0x100, 1], [0x103, 3], [0x105, 3], [0x108, 3]]);
  assert.deepEqual([...history.skipped], []);
  assert.equal(cpu.snapshot().pc, endAddress);
  assert.equal(cpu.snapshot().flags.cy, false); // The final decision cannot be explained by carry.
});
