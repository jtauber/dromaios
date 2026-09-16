import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { instructionExamples } from "../../../../src/components/cpus/semantics/examples.js";
import { describeInstruction, describeInstructions } from "../../../../src/components/cpus/semantics/describe.js";

function description(cpu: string, name: string): string {
  const example = instructionExamples.find(example => example.cpu.name === cpu && example.name === name);
  assert.ok(example);
  return describeInstruction(example);
}

test("comparison expansions read the source before the register and expose CPU-specific formulas without writeback", () => {
  const mos = description("6502", "CMP #byte");
  assert.ok(mos.indexOf("fetch byte") < mos.indexOf("read A"));
  assert.match(mos, /C := not\(borrow\(left, right\)\)/);
  assert.match(mos, /Flags preserved throughout: V, D, I\./);
  const intel = description("8080", "CMP M");
  assert.ok(intel.indexOf("read H") < intel.indexOf("read L"));
  assert.ok(intel.indexOf("read memory[concatHighLow(high, low)]") < intel.indexOf("read A"));
  assert.match(intel, /P := evenParity8\(result\)/);
  assert.match(intel, /CY := borrow\(left, right\)/);
  assert.match(intel, /AC := not\(halfBorrow4\(left, right\)\)/);
  assert.match(intel, /Flags preserved throughout: none\./);
  const motorola = description("6809", "CMPA #byte");
  assert.match(motorola, /V := subtractOverflow\(left, right\)/);
  assert.match(motorola, /C := borrow\(left, right\)/);
  for (const definition of instructionExamples.filter(example => /^(CMP|CPX|CPY|CPI)/.test(example.name))) {
    assert.equal(definition.steps.some(step => step.kind === "write-register" || step.kind === "write-memory"), false);
  }
});

test("indexed word comparison expands the address update and both byte reads before recapturing X", () => {
  const text = description("6809", "CMPX ,X++");
  const start = text.indexOf("```text\n"), end = text.indexOf("\n```", start);
  assert.equal(text.slice(start + 8, end), `right:u16 := source "word at old X, advance X by two" {
  address:u16 := read X
  write X:u16 := addWrap(address, 0002:u16)
  high:u8 := read memory[address]
  low:u8 := read memory[addWrap(address, 0001:u16)]
  yield concatHighLow(high, low)
}
left:u16 := read X
result := subtract(left, right)
flags "6809 comparison" simultaneously {
  N := topBit(result)
  Z := isZero(result)
  V := subtractOverflow(left, right)
  C := borrow(left, right)
} // Preserve unlisted flags.`);
});

test("memory ASL exposes two actual writes and separate carry and N/Z stages", () => {
  const example = instructionExamples.find(example => example.name === "ASL zero page")!;
  assert.deepEqual(example.steps.map(step => step.kind), [
    "fetch-byte", "capture", "read-memory", "write-memory", "capture", "update-flags", "write-memory", "update-flags",
  ]);
  const text = describeInstruction(example);
  const originalWrite = text.indexOf("write memory[address] := original");
  const carry = text.indexOf("C := topBit(original)");
  const resultWrite = text.indexOf("write memory[address] := result");
  const nz = text.indexOf("N := topBit(result)");
  assert.ok(originalWrite > 0 && originalWrite < carry && carry < resultWrite && resultWrite < nz);
  assert.match(text, /address := zeroExtend16\(offset\)/);
  assert.match(text, /Flags preserved throughout: V, D, I\./);
});

test("transfers distinguish flag-changing TAX from flag-preserving MOV", () => {
  const mos = description("6502", "TAX"), intel = description("8080", "MOV B,A");
  assert.ok(mos.indexOf("write X:u8 := byte") < mos.indexOf("N := topBit(byte)"));
  assert.match(mos, /Flags preserved throughout: V, D, I, C\./);
  assert.match(intel, /Flags preserved throughout: S, Z, AC, P, CY\./);
  assert.doesNotMatch(intel, /simultaneously/);
});

test("the review artifact is reproducible from the inert definitions and their accompanying prose", () => {
  const before = JSON.stringify(instructionExamples);
  const document = describeInstructions(instructionExamples);
  assert.equal(readFileSync("docs/cpus/semantic-examples.md", "utf8"), document);
  assert.equal(JSON.stringify(instructionExamples), before);
  assert.equal(describeInstructions(instructionExamples), document);
  assert.equal(instructionExamples.length, 15);
});
