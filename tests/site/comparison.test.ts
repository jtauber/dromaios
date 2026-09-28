import assert from "node:assert/strict";
import { test } from "node:test";
import { registerProgram } from "../../site/interactive/register-programs.js";
import { createProgramHistory } from "../../site/interactive/program-history.js";

test("the comparison lesson explains equality from CPU records and retains counts across its bounded path", () => {
  const definition = registerProgram("comparison");
  assert.equal(definition.flag, "z");
  assert.equal(definition.operandAddress, 0x109);
  assert.equal(definition.showHistory, true);
  const { cpu, ram, endAddress } = definition.createMachine();
  const history = createProgramHistory(cpu.snapshot().pc, definition.instructions.map(instruction => instruction.address));
  const comparisons: string[] = [];
  const decisions: string[] = [];
  for (let step = 0; step < 13; step++) {
    const instruction = definition.instructions.find(instruction => instruction.address === cpu.snapshot().pc)!;
    const previousDestination = ram.read(4);
    const record = cpu.step();
    assert.equal(record.outcome, "executed");
    assert.equal(instruction.length, record.instruction.bytes.length);
    history.record(record.instruction, record.after.pc);
    if (instruction.action === "compare") {
      assert.equal(instruction.mnemonic(address => ram.read(address)), "CPI 44");
      assert.equal(instruction.explanation(address => ram.read(address)), "Compare A with 44");
      comparisons.push(instruction.describe(record, previousDestination));
    } else if (instruction.action === "add") {
      assert.equal(instruction.describe(record, previousDestination), `Added one to ${record.before.a}. A now holds ${record.after.a}; zero flag Z is 0. Memory is unchanged.`);
    } else if (instruction.action === "jump") {
      assert.equal(instruction.mnemonic(address => ram.read(address)), "JNZ 0103H");
      assert.equal(instruction.explanation(address => ram.read(address)), "Jump to 0103 if Z = 0");
      decisions.push(instruction.describe(record, previousDestination));
    }
  }
  assert.deepEqual(comparisons, [
    "Compared A (42) with 44. Zero flag Z is 0: the values differ. A still holds 42; memory is unchanged.",
    "Compared A (43) with 44. Zero flag Z is 0: the values differ. A still holds 43; memory is unchanged.",
    "Compared A (44) with 44. Zero flag Z is 1: the values match. A still holds 44; memory is unchanged.",
  ]);
  assert.deepEqual(decisions, [
    "Z was 0 (clear). Jump taken: returned from 010A to 0103. A, flags, and memory are unchanged.",
    "Z was 0 (clear). Jump taken: returned from 010A to 0103. A, flags, and memory are unchanged.",
    "Z was 1 (set). Jump not taken: continued from 010A to 010D. A, flags, and memory are unchanged.",
  ]);
  assert.deepEqual([...history.visits], [[0x100, 1], [0x103, 3], [0x105, 3], [0x108, 3], [0x10a, 3]]);
  assert.deepEqual([...history.skipped], []);
  assert.equal(history.truncated, true);
  assert.deepEqual(history.path, [0x103, 0x105, 0x108, 0x10a, 0x103, 0x105, 0x108, 0x10a, 0x103, 0x105, 0x108, 0x10a, endAddress]);
  assert.equal(cpu.snapshot().pc, endAddress);
});

test("comparison labels follow the target byte while past explanations retain the fetched operand", () => {
  const definition = registerProgram("comparison");
  const { cpu, ram } = definition.createMachine();
  const compare = definition.instructions.find(instruction => instruction.action === "compare")!;
  ram.write(definition.operandAddress!, 42);
  const read = (address: number) => ram.read(address);
  assert.equal(compare.mnemonic(read), "CPI 42");
  assert.equal(compare.explanation(read), "Compare A with 42");
  Array.from({ length: 3 }, () => cpu.step());
  const record = cpu.step();
  assert.equal(record.outcome, "executed");
  const description = compare.describe(record, ram.read(4));
  assert.equal(description, "Compared A (42) with 42. Zero flag Z is 1: the values match. A still holds 42; memory is unchanged.");
  ram.write(definition.operandAddress!, 99);
  assert.equal(compare.mnemonic(read), "CPI 99");
  assert.equal(compare.describe(record, ram.read(4)), description);
});
