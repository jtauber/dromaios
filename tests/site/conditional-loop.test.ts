import assert from "node:assert/strict";
import { test } from "node:test";
import { registerProgram } from "../../site/interactive/register-programs.js";
import { createProgramHistory } from "../../site/interactive/program-history.js";

test("the conditional lesson describes both recorded decisions and counts the untaken jump as executed", () => {
  const definition = registerProgram("conditional-loop");
  const { cpu, ram, endAddress } = definition.createMachine();
  const history = createProgramHistory(cpu.snapshot().pc, definition.instructions.map(instruction => instruction.address));
  const descriptions: string[] = [];
  for (let step = 0; step < 7; step++) {
    const instruction = definition.instructions.find(instruction => instruction.address === cpu.snapshot().pc)!;
    const previousDestination = ram.read(4);
    const record = cpu.step();
    assert.equal(record.outcome, "executed");
    assert.equal(instruction.length, record.instruction.bytes.length);
    history.record(record.instruction, record.after.pc);
    if (instruction.action === "jump") {
      assert.equal(instruction.mnemonic(address => ram.read(address)), "JNC 0103H");
      assert.equal(instruction.explanation(address => ram.read(address)), "Jump to 0103 if CY = 0");
      descriptions.push(instruction.describe(record, previousDestination));
    }
  }
  assert.deepEqual(descriptions, [
    "CY was 0 (clear). Jump taken: returned from 0108 to 0103. A, flags, and memory are unchanged.",
    "CY was 1 (set). Jump not taken: continued from 0108 to 010B. A, flags, and memory are unchanged.",
  ]);
  assert.deepEqual(history.path, [0x100, 0x103, 0x105, 0x108, 0x103, 0x105, 0x108, 0x10b]);
  assert.deepEqual([...history.visits], [[0x100, 1], [0x103, 2], [0x105, 2], [0x108, 2]]);
  assert.deepEqual([...history.skipped], []);
  assert.equal(cpu.snapshot().pc, endAddress);
});
