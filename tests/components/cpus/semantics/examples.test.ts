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
  // Exclude string/block comparisons that advance pointers: CMPSB/W and Z80 CPI.
  // Motorola CMPS compares S; Intel CPI is an immediate comparison.
  for (const definition of instructionDefinitions.filter(example => /^(CMP[ABDXYUS]?|CPX|CPY|CP|CBA)(?: |$)/.test(example.name)
    || (example.cpu.name !== "z80" && /^CPI(?: |$)/.test(example.name)))) {
    assert.equal(definition.steps.some(step => step.kind === "write-register" || step.kind === "write-memory"), false, `${definition.cpu.name} ${definition.name}`);
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

test("Motorola word-transfer explanations expose byte order, captured stores, D writes, and NMI arming", () => {
  for (const cpu of ["6800", "6809"]) for (const register of cpu === "6800" ? ["S", "X"] : ["D", "X", "Y", "U", "S"]) {
    const stored = cpu === "6800" && register === "S" ? "SP" : register;
    for (const mode of ["#word", "memory"]) {
      const text = description(cpu, `LD${register} ${mode}`);
      const low = text.indexOf(mode === "memory" ? "low:u8 := read memory[addWrap(address, 0001:u16)]" : "low:u8 := fetch byte");
      const write = text.indexOf(`write ${register === "D" ? "A:u8" : `${stored}:u16`}`);
      assert.ok(low > 0 && low < write && write < text.indexOf("N := topBit(result)"));
      assert.match(text, /yield concatHighLow\(high, low\)|result := concatHighLow\(high, low\)/);
      assert.doesNotMatch(text, /write memory/);
      if (cpu === "6809" && register === "S") {
        const latch = text.indexOf("write nmiArmed:boolean := true");
        assert.ok(write < latch && latch < text.indexOf("N := topBit(result)"));
      }
      if (register === "D") {
        assert.match(text, /write A:u8 := highByte\(result\)/);
        assert.match(text, /write B:u8 := lowByte\(result\)/);
        assert.ok(write < text.indexOf("write B:u8") && text.indexOf("write B:u8") < text.indexOf("N := topBit(result)"));
      }
    }
    const text = description(cpu, `ST${register} memory`);
    const high = text.indexOf("write memory[address] := highByte(result)");
    const low = text.indexOf("write memory[addWrap(address, 0001:u16)] := lowByte(result)");
    assert.ok(high > 0 && high < low && low < text.indexOf("N := topBit(result)"));
    assert.match(text, /Only after both writes succeed/);
    assert.match(text, /completed writes, fetches, and addressing effects remain/);
    assert.doesNotMatch(text, /read memory|fetch byte|write nmiArmed/);
    assert.equal(text.match(/write memory/g)?.length, 2);
  }
});

test("Intel exchange explanations expose captured registers and addresses, read/write order, and preserved flags", () => {
  for (const [cpu, name, register] of [["8080", "XTHL", "H"], ["z80", "EX (SP),HL", "H"],
    ["z80", "EX (SP),IX", "IX"], ["z80", "EX (SP),IY", "IY"]] as const) {
    const text = description(cpu, name), body = text.split("```text\n")[1]!.split("\n```")[0]!;
    const ordered = [`read ${register}`, "read SP", "read memory[address]", "read memory[addWrap(address, 0001:u16)]",
      "write memory[addWrap(address, 0001:u16)]", "write memory[address]", `write ${register}`].map(part => body.indexOf(part));
    assert.ok(ordered.every((position, index) => position >= 0 && (index === 0 || position > ordered[index - 1]!)));
    assert.doesNotMatch(body, /fetch byte|write SP|:flag := read/);
    assert.match(text, /A failed access prevents register writeback and retains completed memory writes/);
    assert.match(text, cpu === "8080" ? /Flags preserved throughout: S, Z, AC, P, CY\./ : /Flags preserved throughout: S, Z, H, PV, N, C\./);
  }
  for (const [cpu, name] of [["8080", "XCHG"], ["z80", "EX DE,HL"]] as const) {
    assert.doesNotMatch(description(cpu, name), /fetch byte|read memory|write memory|simultaneously/);
  }
});

test("the review artifact is reproducible from the inert definitions and their accompanying prose", () => {
  const before = JSON.stringify(instructionDefinitions);
  const document = describeInstructions(instructionDefinitions);
  assert.equal(readFileSync("docs/cpus/semantic-examples.md", "utf8"), document);
  assert.equal(JSON.stringify(instructionDefinitions), before);
  assert.equal(describeInstructions(instructionDefinitions), document);
  assert.equal(instructionDefinitions.length, 6165);
});

test("8080 ALU explanations expose carry-before-A capture, parity, auxiliary carry, and flags before writeback", () => {
  for (const name of ["ADC M", "ACI byte", "SBB A", "SBI byte"]) {
    const text = description("8080", name);
    const carry = text.indexOf("carry:flag := read CY"), left = text.indexOf("left:u8 := read A");
    assert.ok(carry > text.indexOf("right:u8 := source") && left > carry);
    assert.ok(text.indexOf("write A:u8 := result") > text.indexOf("AC :="));
    assert.match(text, /P := evenParity8\(result\)/);
    assert.match(text, name.startsWith("A") ? /AC := halfCarry4\(left, right, carry\)/ : /AC := not\(halfBorrow4\(left, right, carry\)\)/);
  }
  for (const name of ["ADD H", "SUI byte", "ANA L", "XRI byte", "ORA M"]) assert.doesNotMatch(description("8080", name), /:= read CY/);
  assert.match(description("8080", "ANA M"), /AC := not\(isZero\(bitAnd\(bitOr\(left, right\), 08:u8\)\)\)/);
  for (const name of ["XRA A", "ORA A"]) {
    const text = description("8080", name);
    assert.match(text, /AC := 0:flag/); assert.match(text, /CY := 0:flag/);
  }
});

test("Z80 ALU explanations expose overflow versus parity, borrow half-carry, and resolved indexed inputs", () => {
  const adc = description("z80", "ADC A,(HL)");
  assert.ok(adc.indexOf("carry:flag := read C") > adc.indexOf("read memory["));
  assert.ok(adc.indexOf("left:u8 := read A") > adc.indexOf("carry:flag := read C"));
  assert.match(adc, /PV := addOverflow\(left, right, carry\)/);
  assert.match(adc, /H := halfCarry4\(left, right, carry\)/);
  const sbc = description("z80", "SBC A,n");
  assert.match(sbc, /PV := subtractOverflow\(left, right, carry\)/);
  assert.match(sbc, /H := halfBorrow4\(left, right, carry\)/);
  assert.match(sbc, /N := 1:flag/);
  const cp = description("z80", "CP memory");
  assert.match(cp, /address:u16/); assert.match(cp, /right:u8 := read memory\[address\]/);
  assert.doesNotMatch(cp, /fetch byte|:= read I[XY]|:= read C|write A/);
  for (const mnemonic of ["AND", "XOR", "OR"]) {
    const text = description("z80", `${mnemonic} B`);
    assert.match(text, /PV := evenParity8\(result\)/);
    assert.match(text, mnemonic === "AND" ? /H := 1:flag/ : /H := 0:flag/);
    assert.match(text, /N := 0:flag/); assert.match(text, /C := 0:flag/);
    assert.ok(text.indexOf("write A:u8 := result") > text.indexOf("C :="));
  }
});

test("Z80 shift explanations distinguish accumulator flags from CB flags and preserve read/flag/write order", () => {
  for (const name of ["RLCA", "RRCA", "RLA", "RRA"]) {
    const text = description("z80", name);
    assert.match(text, /Flags preserved throughout: S, Z, PV\./);
    const write = text.indexOf("write A:u8 := result"), carry = text.indexOf("C :=");
    assert.ok(write >= 0 && write < carry && carry < text.indexOf("N := 0:flag"));
    assert.ok(text.indexOf("N := 0:flag") < text.indexOf("H := 0:flag"));
    if (name === "RLA" || name === "RRA") assert.ok(text.indexOf("read A") < text.indexOf("carry:flag := read C"));
    else assert.doesNotMatch(text, /:= read C/);
  }
  for (const name of ["RLC", "RRC", "RL", "RR", "SLA", "SRA", "SRL"]) for (const target of ["B", "memory"]) {
    const text = description("z80", `${name} ${target}`), memory = target === "memory";
    const read = text.indexOf(memory ? "original:u8 := read memory[address]" : "original:u8 := read B");
    const flags = text.indexOf("S := topBit(result)"), write = text.indexOf(memory ? "write memory[address] := result" : "write B:u8 := result");
    assert.ok(read >= 0 && read < flags && flags < write);
    assert.match(text, /PV := evenParity8\(result\)/); assert.match(text, /Flags preserved throughout: none\./);
    if (name === "RL" || name === "RR") assert.ok(read < text.indexOf("carry:flag := read C") && text.indexOf("carry:flag := read C") < flags);
    else assert.doesNotMatch(text, /:= read C/);
    if (name === "SRA") assert.match(text, /shiftRight\(original, topBit\(original\)\)/);
    if (name === "SLA" || name === "SRL") assert.match(text, /shift(Left|Right)\(original, 0:flag\)/);
    if (memory) {
      assert.match(text, /address:u16 := input/);
      assert.equal(text.match(/:= read memory/g)?.length, 1); assert.equal(text.match(/write memory/g)?.length, 1);
      assert.doesNotMatch(text, /fetch byte|:= read (H|L|IX|IY)\b/);
    }
  }
});

test("Intel byte-transfer explanations expose source capture, HL timing, resolved indexing, and preserved flags", () => {
  for (const [cpu, move, immediate, memory] of [["8080", "MOV", "MVI", "M"], ["z80", "LD", "LD", "(HL)"]] as const) {
    for (const register of ["H", "L"]) {
      const loaded = description(cpu, `${move} ${register},${memory}`), stored = description(cpu, `${move} ${memory},${register}`);
      assert.ok(loaded.indexOf("read H") < loaded.indexOf("read L"));
      assert.ok(loaded.indexOf("read memory") < loaded.indexOf(`write ${register}:u8 := result`));
      assert.ok(stored.indexOf(`result:u8 := read ${register}`) < stored.indexOf("high:u8 := read H"));
      assert.ok(stored.indexOf("low:u8 := read L") < stored.indexOf("write memory"));
      assert.doesNotMatch(stored, /:= read memory/);
    }
    const text = description(cpu, `${immediate} ${memory},n`);
    assert.ok(text.indexOf("fetch byte") < text.indexOf("read H"));
    assert.ok(text.indexOf("read L") < text.indexOf("write memory"));
    assert.doesNotMatch(text, /apply flags|:= read memory/);
    assert.match(text, /Flags preserved throughout: /);
  }
  for (const operand of ["H", "L", "n"]) {
    const text = description("z80", `LD memory,${operand}`);
    assert.match(text, /address:u16 := input/);
    assert.match(text, /write memory\[address\] := result/);
    assert.doesNotMatch(text, /high:u8|low:u8|:= read I[XY]|:= read memory|apply flags/);
    if (operand === "n") assert.match(text, /result:u8 := fetch byte/);
    else { assert.match(text, new RegExp(`result:u8 := read ${operand}`)); assert.doesNotMatch(text, /fetch byte/); }
  }
});

test("Intel word-transfer explanations expose little-endian memory, complete captures, split registers, and preserved flags", () => {
  for (const [cpu, immediate, load, store, copy] of [
    ["8080", "LXI H,nn", "LHLD nn", "SHLD nn", "SPHL"],
    ["z80", "LD HL,nn", "LD HL,(nn)", "LD (nn),HL", "LD SP,HL"],
  ] as const) {
    const fetched = description(cpu, immediate), loaded = description(cpu, load), stored = description(cpu, store);
    for (const text of [fetched, loaded, stored]) {
      assert.match(text, /low byte first|low byte then high byte/);
      assert.match(text, /Flags preserved throughout:/);
      assert.doesNotMatch(text, /apply flags|address:u16 := input/);
    }
    assert.ok(fetched.indexOf("high:u8 := fetch byte") < fetched.indexOf("write H"));
    assert.ok(loaded.indexOf("high:u8 := read memory") < loaded.indexOf("write H"));
    assert.ok(loaded.indexOf("write H") < loaded.indexOf("write L"));
    assert.ok(stored.indexOf("high:u8 := fetch byte") < stored.indexOf("high:u8 := read H"));
    assert.ok(stored.indexOf("low:u8 := read L") < stored.indexOf("write memory"));
    assert.match(stored, /failed second write retains the first/);
    assert.doesNotMatch(stored, /:= read memory/);
    const copied = description(cpu, copy);
    assert.match(copied, /write SP:u16 := result/);
    assert.doesNotMatch(copied, /fetch byte|:= read memory|write memory/);
  }
  for (const name of ["LD IX,nn", "LD IY,(nn)", "LD (nn),SP"]) {
    const text = description("z80", name);
    assert.doesNotMatch(text, /:= read (H|L)\b|write (H|L):/);
  }
});

test("8008 transfer explanations retain native mnemonics and explicit 14-bit memory masking", () => {
  for (const register of ["H", "L"]) {
    const loaded = description("8008", `L${register}M`), stored = description("8008", `LM${register}`);
    assert.ok(loaded.indexOf("read memory") < loaded.indexOf(`write ${register}:u8 := result`));
    assert.ok(stored.indexOf(`result:u8 := read ${register}`) < stored.indexOf("high:u8 := read H"));
    for (const text of [loaded, stored, description("8008", "LMI n")]) {
      assert.match(text, /bitAnd\(concatHighLow\(high, low\), 3FFF:u16\)/);
      assert.match(text, /preserving the full H and L registers/);
      assert.match(text, /Flags preserved throughout: /);
      assert.doesNotMatch(text, /apply flags|address:u16 := input/);
    }
    assert.doesNotMatch(stored, /:= read memory/);
  }
  const immediate = description("8008", "LMI n");
  assert.ok(immediate.indexOf("fetch byte") < immediate.indexOf("read H"));
  assert.doesNotMatch(immediate, /:= read memory/);
  assert.doesNotMatch(description("8008", "LAA"), /:= read memory|write memory|fetch byte/);
});

test("Intel byte-adjustment explanations expose different half-carry rules, preserved carry, and flag-before-write order", () => {
  for (const [cpu, increment, decrement, carry] of [["8080", "INR", "DCR", "CY"], ["z80", "INC", "DEC", "C"]] as const) {
    for (const name of [increment, decrement]) for (const operand of ["H", "memory"]) {
      const text = description(cpu, `${name} ${operand}`);
      const read = text.indexOf(operand === "memory" ? "original:u8 := read memory[address]" : "original:u8 := read H");
      const flags = text.indexOf("S := topBit(result)"), write = text.indexOf(operand === "memory" ? "write memory[address] := result" : "write H:u8 := result");
      assert.ok(read >= 0 && read < flags && flags < write);
      assert.ok(text.includes(`Flags preserved throughout: ${carry}.`));
      assert.doesNotMatch(text, /:= read (CY|C|S|Z|P|AC|PV|N)\b|fetch byte/);
      if (operand === "memory") {
        assert.match(text, /address:u16 := input/);
        assert.equal(text.match(/:= read memory/g)?.length, 1); assert.equal(text.match(/write memory/g)?.length, 1);
        assert.doesNotMatch(text, /:= read (H|L|IX|IY)\b/);
      }
      if (cpu === "8080") {
        assert.match(text, /P := evenParity8\(result\)/);
        assert.match(text, name === decrement ? /AC := not\(halfBorrow4\(original, 01:u8\)\)/ : /AC := halfCarry4\(original, 01:u8\)/);
      } else {
        assert.match(text, name === decrement ? /H := halfBorrow4\(original, 01:u8\)/ : /H := halfCarry4\(original, 01:u8\)/);
        assert.match(text, name === decrement ? /PV := subtractOverflow\(original, 01:u8\)/ : /PV := addOverflow\(original, 01:u8\)/);
        assert.ok(text.includes(`N := ${name === decrement ? 1 : 0}:flag`));
      }
    }
  }
});

test("Z80 bit explanations expose fixed masks, BIT's preserved carry, and flag-free RES/SET writeback", () => {
  const masks = ["01", "02", "04", "08", "10", "20", "40", "80"];
  const complements = ["FE", "FD", "FB", "F7", "EF", "DF", "BF", "7F"];
  for (let bit = 0; bit < 8; bit++) for (const target of ["B", "memory"]) {
    const tested = description("z80", `BIT ${bit},${target}`);
    assert.ok(tested.includes(`result := bitAnd(original, ${masks[bit]}:u8)`));
    assert.match(tested, /S := topBit\(result\)/); assert.match(tested, /Z := isZero\(result\)/);
    assert.match(tested, /PV := isZero\(result\)/); assert.match(tested, /H := 1:flag/); assert.match(tested, /N := 0:flag/);
    assert.match(tested, /Flags preserved throughout: C\./);
    assert.doesNotMatch(tested, /write B|write memory|:= read C|C :=/);
    for (const mnemonic of ["RES", "SET"]) {
      const text = description("z80", `${mnemonic} ${bit},${target}`);
      assert.ok(text.includes(`result := ${mnemonic === "RES" ? "bitAnd" : "bitOr"}(original, ${mnemonic === "RES" ? complements[bit] : masks[bit]}:u8)`));
      assert.ok(text.indexOf("result :=") < text.indexOf(target === "memory" ? "write memory[address] := result" : "write B:u8 := result"));
      assert.match(text, /Flags preserved throughout: S, Z, H, PV, N, C\./);
      assert.doesNotMatch(text, /apply flags|:= read (S|Z|H|PV|N|C)\b/);
    }
    for (const mnemonic of ["BIT", "RES", "SET"]) {
      const text = description("z80", `${mnemonic} ${bit},${target}`);
      if (target === "memory") {
        assert.match(text, /address:u16 := input/); assert.equal(text.match(/:= read memory/g)?.length, 1);
        assert.doesNotMatch(text, /fetch byte|:= read (H|L|IX|IY)\b/);
      }
    }
  }
});

test("8008 ALU explanations retain native mnemonics, 14-bit memory, parity, and carry-before-A ordering", () => {
  const memory = description("8008", "ACM");
  assert.match(memory, /read memory\[bitAnd\(concatHighLow\(high, low\), 3FFF:u16\)\]/);
  assert.ok(memory.indexOf("read H") < memory.indexOf("read L"));
  assert.ok(memory.indexOf("carry:flag := read C") > memory.indexOf("read memory["));
  assert.ok(memory.indexOf("left:u8 := read A") > memory.indexOf("carry:flag := read C"));
  assert.match(memory, /P := evenParity8\(result\)/); assert.match(memory, /C := carry\(left, right, carry\)/);
  const subtract = description("8008", "SBI byte");
  assert.match(subtract, /C := borrow\(left, right, carry\)/);
  assert.doesNotMatch(description("8008", "CPA"), /write A|:= read C/);
  for (const mnemonic of ["NDI byte", "XRI byte", "ORI byte"]) {
    const text = description("8008", mnemonic);
    assert.match(text, /C := 0:flag/); assert.doesNotMatch(text, /:= read C/);
    assert.ok(text.indexOf("write A:u8 := result") > text.indexOf("C :="));
  }
});

test("8008 unary explanations distinguish preserved carry from rotation carry and retain writeback order", () => {
  for (const [name, register, operation] of [["INH", "H", "addWrap"], ["DCL", "L", "subtract"]]) {
    const text = description("8008", name!);
    assert.match(text, new RegExp(`result := ${operation}\\(original, 01:u8\\)`));
    const read = text.indexOf(`original:u8 := read ${register}`), flags = text.indexOf("P := evenParity8(result)");
    assert.ok(read >= 0 && read < flags && flags < text.indexOf(`write ${register}:u8 := result`));
    assert.match(text, /Flags preserved throughout: C\./);
    assert.doesNotMatch(text, /:= read C|C :=|read memory|write memory/);
  }
  for (const name of ["RLC", "RRC", "RAL", "RAR"]) {
    const text = description("8008", name);
    assert.match(text, /Flags preserved throughout: S, Z, P\./);
    assert.ok(text.indexOf("write A:u8 := result") < text.indexOf("C :="));
    if (name === "RAL" || name === "RAR") {
      assert.ok(text.indexOf("original:u8 := read A") < text.indexOf("carry:flag := read C"));
      assert.match(text, /shift(Left|Right)\(original, carry\)/);
    } else assert.doesNotMatch(text, /:= read C/);
    assert.doesNotMatch(text, /read memory|write memory/);
  }
});
