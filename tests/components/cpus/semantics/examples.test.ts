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
  for (const definition of instructionDefinitions.filter(example => /^(CMP|CPX|CPY|CPI|CBA)/.test(example.name))) {
    assert.equal(definition.steps.some(step => step.kind === "write-register" || step.kind === "write-memory"), false);
  }
});

test("6800 CPX explains high-byte N/V, whole-word Z, and preserved carry in both bodies", () => {
  for (const mode of ["#word", "memory"]) {
    const text = description("6800", `CPX ${mode}`);
    assert.match(text, /N := topBit\(subtract\(highByte\(left\), highByte\(right\)\)\)/);
    assert.match(text, /Z := isZero\(result\)/);
    assert.match(text, /V := subtractOverflow\(highByte\(left\), highByte\(right\)\)/);
    assert.match(text, /Flags preserved throughout: H, I, C\./);
    assert.doesNotMatch(text, /C :=|write X/);
  }
  assert.match(description("6800", "CMPA #byte"), /C := borrow\(left, right\)/);
  assert.doesNotMatch(description("6800", "CBA"), /fetch byte|read memory|write [AB]/);
});

test("6809 memory comparisons show data reads before the register or D view, without repeating address resolution", () => {
  for (const name of ["CMPA", "CMPB", "CMPD", "CMPX", "CMPY", "CMPU", "CMPS"]) {
    const text = description("6809", `${name} memory`), register = name.slice(3);
    const first = text.indexOf("read memory[address]"), last = text.indexOf("read memory[addWrap(address, 0001:u16)]");
    const left = text.indexOf(register === "D" ? 'left:u16 := source "D from A:B"' : `:= read ${register}`);
    assert.ok(first >= 0 && left > first);
    if (register !== "A" && register !== "B") assert.ok(last > first && left > last);
    assert.ok(text.indexOf("result := subtract(left, right)") > left);
    const body = text.split("```text\n")[1]!.split("\n```")[0]!;
    assert.doesNotMatch(body, /fetch byte|write |read [XYUS]\n.*read memory/s);
    if (register === "D") {
      assert.ok(text.indexOf("read A", left) < text.indexOf("read B", left));
      assert.match(text.slice(left), /yield concatHighLow\(high, low\)/);
    }
  }
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

test("6502 store explanations resolve pointers before reading the source and preserve every flag", () => {
  const text = description("6502", "STA (zero page),Y");
  const low = text.indexOf("low:u8 := read memory"), high = text.indexOf("high:u8 := read memory");
  const index = text.indexOf("index:u8 := read Y"), source = text.indexOf("byte:u8 := read A"), write = text.indexOf("write memory[address] := byte");
  assert.ok(low >= 0 && low < high && high < index && index < source && source < write);
  assert.equal(text.match(/write memory/g)?.length, 1);
  assert.doesNotMatch(text, /read memory\[address\]|simultaneously/);
  assert.match(text, /Flags preserved throughout: N, V, D, I, Z, C\./);
});

test("rotate and adjustment explanations expose carry capture, writeback, and preserved flags", () => {
  const text = description("6502", "ROR absolute,X");
  const originalWrite = text.indexOf("write memory[address] := original"), readCarry = text.indexOf("carry:flag := read C");
  const shift = text.indexOf("result := shiftRight(original, carry)"), carry = text.indexOf("C := lowBit(original)");
  const resultWrite = text.indexOf("write memory[address] := result"), nz = text.indexOf("N := topBit(result)");
  assert.ok(originalWrite > 0 && originalWrite < readCarry && readCarry < shift && shift < carry && carry < resultWrite && resultWrite < nz);
  assert.match(text, /Flags preserved throughout: V, D, I\./);
  const accumulator = description("6502", "LSR A");
  assert.match(accumulator, /shiftRight\(original, 0:flag\)/);
  assert.doesNotMatch(accumulator, /read C|read memory|write memory/);
  for (const name of ["INC zero page", "DEX"]) {
    const adjustment = description("6502", name);
    assert.match(adjustment, /Flags preserved throughout: V, D, I, C\./);
    assert.doesNotMatch(adjustment, /read C|C :=/);
  }
});

test("8080 and 6809 shift explanations expose their distinct input bits, flag rules, and writeback order", () => {
  const intel = description("8080", "RAL");
  assert.match(intel, /carry:flag := read CY/);
  assert.match(intel, /shiftLeft\(original, carry\)/);
  assert.ok(intel.indexOf("write A:u8 := result") < intel.indexOf("CY := topBit(original)"));
  assert.match(intel, /Flags preserved throughout: S, Z, AC, P\./);
  const circular = description("8080", "RRC");
  assert.match(circular, /shiftRight\(original, lowBit\(original\)\)/);
  assert.doesNotMatch(circular, /read CY/);
  const motorola = description("6809", "ROLA");
  assert.match(motorola, /V := xor\(topBit\(result\), topBit\(original\)\)/);
  assert.ok(motorola.indexOf("V := xor") < motorola.indexOf("write A:u8 := result"));
  assert.match(motorola, /Flags preserved throughout: E, F, H, I\./);
  const arithmetic = description("6809", "ASRB");
  assert.match(arithmetic, /shiftRight\(original, topBit\(original\)\)/);
  assert.match(arithmetic, /Flags preserved throughout: E, F, H, I, V\./);
  assert.doesNotMatch(arithmetic, /read C|read memory|write memory/);
});

test("6809 memory shift explanations declare the resolved input and flag updates before their single write", () => {
  const text = description("6809", "ROL memory");
  const input = text.indexOf("address:u16 := input"), read = text.indexOf("original:u8 := read memory[address]");
  const carry = text.indexOf("carry:flag := read C"), flags = text.indexOf("N := topBit(result)");
  const overflow = text.indexOf("V := xor"), write = text.indexOf("write memory[address] := result");
  assert.ok(input >= 0 && input < read && read < carry && carry < flags && flags < overflow && overflow < write);
  assert.equal(text.match(/write memory/g)?.length, 1);
  assert.doesNotMatch(text, /fetch byte|read [ABXYUS]\b/);
  assert.match(text, /failed write retains their updates/);
});

test("6809 unary explanations distinguish real CLR reads, read-only TST, and carry-preserving adjustments", () => {
  const clear = description("6809", "CLR memory");
  const read = clear.indexOf("original:u8 := read memory[address]"), flags = clear.indexOf("N := topBit(result)");
  assert.ok(read >= 0 && read < clear.indexOf("result := 00:u8") && read < flags);
  assert.ok(flags < clear.indexOf("write memory[address] := result"));
  assert.match(clear, /C := 0:flag/); assert.match(clear, /V := 0:flag/);
  for (const name of ["TSTA", "TSTB", "TST memory"]) {
    const text = description("6809", name);
    assert.doesNotMatch(text, /write [AB]:|write memory/);
    assert.match(text, /Flags preserved throughout: E, F, H, I, C\./);
  }
  for (const name of ["INCA", "DEC memory"]) {
    const text = description("6809", name);
    assert.doesNotMatch(text, /read C|C :=/);
    assert.match(text, /Flags preserved throughout: E, F, H, I, C\./);
  }
  assert.match(description("6809", "NEG memory"), /C := borrow\(00:u8, original\)/);
  assert.match(description("6809", "COMA"), /result := subtract\(FF:u8, original\)/);
});

test("6800 unary explanations expose the three differences from the 6809", () => {
  const clear = description("6800", "CLR memory");
  assert.doesNotMatch(clear, /read memory|read [AB]:|original:u8/);
  assert.ok(clear.indexOf("N := topBit(result)") < clear.indexOf("write memory[address] := result"));
  assert.match(description("6800", "TST memory"), /C := 0:flag/);
  for (const name of ["LSRA", "ROR memory", "ASRB"]) {
    assert.match(description("6800", name), /V := xor\(topBit\(result\), lowBit\(original\)\)/);
    assert.match(description("6809", name), /Flags preserved throughout: E, F, H, I, V\./);
  }
});

test("the indexed load explanation distinguishes the index from the destination and shows the commit order", () => {
  const text = description("6502", "LDX zero page,Y");
  const fetch = text.indexOf("fetch byte"), index = text.indexOf("read Y"), read = text.indexOf("read memory[address]");
  const write = text.indexOf("write X:u8 := result"), flags = text.indexOf("N := topBit(result)");
  assert.ok(fetch >= 0 && fetch < index && index < read && read < write && write < flags);
  assert.match(text, /yield zeroExtend16\(addWrap\(offset, index\)\)/);
  assert.match(text, /Flags preserved throughout: V, D, I, C\./);
});

test("6502 logic explanations separate result flags from BIT's memory bits and omit BIT writeback", () => {
  for (const [name, operation] of [["ORA", "bitOr"], ["AND", "bitAnd"], ["EOR", "bitXor"]]) {
    const text = description("6502", `${name} #byte`);
    const read = text.indexOf("read A"), result = text.indexOf(`result := ${operation}(accumulator, operand)`);
    const write = text.indexOf("write A:u8 := result"), flags = text.indexOf("N := topBit(result)");
    assert.ok(text.indexOf("fetch byte") < read && read < result && result < write && write < flags);
    assert.match(text, /Flags preserved throughout: V, D, I, C\./);
  }
  const bit = description("6502", "BIT zero page");
  assert.ok(bit.indexOf("read memory[address]") < bit.indexOf("read A"));
  assert.match(bit, /N := topBit\(operand\)/);
  assert.match(bit, /V := not\(isZero\(bitAnd\(operand, 40:u8\)\)\)/);
  assert.match(bit, /Z := isZero\(bitAnd\(accumulator, operand\)\)/);
  assert.match(bit, /Flags preserved throughout: D, I, C\./);
  assert.doesNotMatch(bit, /write A|write memory/);
});

test("Motorola logical explanations share result flags and distinguish BIT from 6502 memory-bit flags", () => {
  for (const cpu of ["6800", "6809"]) {
    for (const [name, operation] of [["ANDA", "bitAnd"], ["EORB", "bitXor"], [cpu === "6800" ? "ORAA" : "ORA", "bitOr"]]) {
      const text = description(cpu, `${name} #byte`), register = name!.slice(-1);
      const operand = text.indexOf("fetch byte"), read = text.indexOf(`:= read ${register}`);
      const result = text.indexOf(`result := ${operation}(accumulator, operand)`);
      const write = text.indexOf(`write ${register}:u8 := result`), flags = text.indexOf("N := topBit(result)");
      assert.ok(operand >= 0 && operand < read && read < result && result < write && write < flags);
      assert.match(text, /V := 0:flag/);
    }
    for (const mode of ["#byte", "memory"]) {
      const text = description(cpu, `BITB ${mode}`);
      assert.match(text, /N := topBit\(result\)/);
      assert.match(text, /Z := isZero\(result\)/);
      assert.match(text, /V := 0:flag/);
      assert.doesNotMatch(text, /write B|write memory/);
      assert.match(text, cpu === "6800" ? /Flags preserved throughout: H, I, C\./ : /Flags preserved throughout: E, F, H, I, C\./);
    }
  }
});

test("Motorola byte transfers explain captured sources and flags only after successful writes", () => {
  for (const cpu of ["6800", "6809"]) for (const register of ["A", "B"]) {
    const load = cpu === "6800" ? "LDA" : "LD", store = cpu === "6800" ? "STA" : "ST";
    for (const mode of ["#byte", "memory"]) {
      const text = description(cpu, `${load}${register} ${mode}`);
      const read = text.indexOf(mode === "memory" ? "read memory[address]" : "fetch byte");
      const write = text.indexOf(`write ${register}:u8 := result`), flags = text.indexOf("N := topBit(result)");
      assert.ok(read >= 0 && read < write && write < flags);
      assert.match(text, /V := 0:flag/);
      assert.doesNotMatch(text, /:= read [AB]|write memory/);
    }
    const text = description(cpu, `${store}${register} memory`);
    const read = text.indexOf(`:= read ${register}`), write = text.indexOf("write memory[address] := result");
    assert.ok(read >= 0 && read < write && write < text.indexOf("N := topBit(result)"));
    assert.equal(text.match(/write memory/g)?.length, 1);
    assert.match(text, /failed write leaves flags unchanged/);
    assert.doesNotMatch(text, /read memory|fetch byte/);
    assert.match(text, cpu === "6800" ? /Flags preserved throughout: H, I, C\./ : /Flags preserved throughout: E, F, H, I, C\./);
  }
  for (const name of ["TAB", "TBA"]) {
    const text = description("6800", name), source = name[1], destination = name[2];
    const read = text.indexOf(`:= read ${source}`), write = text.indexOf(`write ${destination}:u8 := result`);
    assert.ok(read >= 0 && read < write && write < text.indexOf("N := topBit(result)"));
    assert.match(text, /V := 0:flag/);
    assert.doesNotMatch(text, /fetch byte|read memory|write memory/);
  }
});

test("the review artifact is reproducible from the inert definitions and their accompanying prose", () => {
  const before = JSON.stringify(instructionDefinitions);
  const document = describeInstructions(instructionDefinitions);
  assert.equal(readFileSync("docs/cpus/semantic-examples.md", "utf8"), document);
  assert.equal(JSON.stringify(instructionDefinitions), before);
  assert.equal(describeInstructions(instructionDefinitions), document);
  assert.equal(instructionDefinitions.length, 256);
});
