import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { instructionDefinitions } from "../../../../src/components/cpus/semantics/definitions.js";
import { describeInstruction, describeInstructions } from "../../../../src/components/cpus/semantics/describe.js";

function description(cpu: string, name: string): string {
  const example = instructionDefinitions.find(example => example.cpu.name === cpu && example.name === name);
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
  for (const definition of instructionDefinitions.filter(example => /^(CMP|CPX|CPY|CPI)/.test(example.name))) {
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
  const example = instructionDefinitions.find(example => example.name === "ASL zero page")!;
  const text = describeInstruction(example);
  const originalWrite = text.indexOf("write memory[address] := original");
  const carry = text.indexOf("C := topBit(original)");
  const resultWrite = text.indexOf("write memory[address] := result");
  const nz = text.indexOf("N := topBit(result)");
  assert.ok(originalWrite > 0 && originalWrite < carry && carry < resultWrite && resultWrite < nz);
  assert.match(text, /yield zeroExtend16\(offset\)/);
  assert.match(text, /Flags preserved throughout: V, D, I\./);
});

test("transfers distinguish flag-changing TAX from flag-preserving TXS and MOV", () => {
  const mos = description("6502", "TAX"), stack = description("6502", "TXS"), intel = description("8080", "MOV B,A");
  const write = mos.indexOf("write X:u8 := result"), flags = mos.indexOf("N := topBit(result)");
  assert.ok(write > mos.indexOf("read A") && flags > write);
  assert.match(mos, /Flags preserved throughout: V, D, I, C\./);
  assert.match(stack, /read X/);
  assert.match(stack, /write SP:u8 := result/);
  assert.match(stack, /Flags preserved throughout: N, V, D, I, Z, C\./);
  assert.doesNotMatch(stack, /simultaneously|read memory|write memory/);
  assert.match(intel, /Flags preserved throughout: S, Z, AC, P, CY\./);
  assert.doesNotMatch(intel, /simultaneously/);
});

test("the indexed load explanation distinguishes the index from the destination and shows the commit order", () => {
  const text = description("6502", "LDX zero page,Y");
  const fetch = text.indexOf("fetch byte"), index = text.indexOf("read Y"), read = text.indexOf("read memory[address]");
  const write = text.indexOf("write X:u8 := result"), flags = text.indexOf("N := topBit(result)");
  assert.ok(fetch >= 0 && fetch < index && index < read && read < write && write < flags);
  assert.match(text, /yield zeroExtend16\(addWrap\(offset, index\)\)/);
  assert.match(text, /Flags preserved throughout: V, D, I, C\./);
});

test("the review artifact is reproducible from the inert definitions and their accompanying prose", () => {
  const before = JSON.stringify(instructionDefinitions);
  const document = describeInstructions(instructionDefinitions);
  assert.equal(readFileSync("docs/cpus/semantic-examples.md", "utf8"), document);
  assert.equal(JSON.stringify(instructionDefinitions), before);
  assert.equal(describeInstructions(instructionDefinitions), document);
  assert.equal(instructionDefinitions.length, 55);
});
