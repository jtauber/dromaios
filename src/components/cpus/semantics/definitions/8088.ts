import { cpu8088StateDescription } from "../../state/8088.ts";
import { byteRegisters8088, wordRegisters8088 } from "../../8088-registers.ts";
import { opcodeFamily } from "../../opcodes.ts";
import { addOverflow, addWrap, bitAnd, bitOr, bitXor, borrow, capture, carry, concat, cpuSymbols, evenParity, flagLiteral, flagValue, halfBorrow, halfCarry,
  highByte, literal, lowByte, negative, overflow, projectAddress, readFlag, readMemory, readRegister, readSource, updateFlags, value, writeMemory, writeRegister, zero } from "../model.ts";
import type { InstructionDefinition, NumberExpression, Statement } from "../model.ts";
import { arithmetic, byteRegisterView, immediateByte, instructionSet, registerView, transfer } from "../builders.ts";
import { immediateWord } from "../intel.ts";
import { flagPolicy } from "../status.ts";
import { defineInstruction } from "../validate.ts";

const cpu = cpuSymbols("8088", cpu8088StateDescription);
const registers = [
  byteRegisters8088.map(({ word, shift }) => ({ name: `${word[0]}${shift === 0 ? "l" : "h"}`.toUpperCase(), immediate: immediateByte, view: byteRegisterView(cpu.register(word), shift === 0 ? "low" : "high") })),
  wordRegisters8088.map(word => ({ name: word.toUpperCase(), immediate: immediateWord, view: registerView(cpu.register(word)) })),
] as const;
const widths = [8, 16] as const;
const immediates = { 8: immediateByte, 16: immediateWord };
const operations = ["ADD", "OR", "ADC", "SBB", "AND", "SUB", "XOR", "CMP"] as const;
type Operation = typeof operations[number] | "TEST";

function resultFlags(width: 8 | 16) {
  return { zf: zero(value("result")), sf: negative(value("result")), pf: evenParity(width === 8 ? value("result") : lowByte(value("result"))) };
}

function arithmeticBody(operation: "add" | "subtract", width: 8 | 16, withCarry = false): readonly Statement[] {
  const adding = operation === "add", left = value("left"), right = value("right"), incoming = withCarry ? flagValue("carry") : undefined;
  return arithmetic(operation, flagPolicy(cpu, `8088 ${operation}`, { left: width, right: width, result: width, ...(withCarry ? { carry: "flag" as const } : {}) }, {
    cf: (adding ? carry : borrow)(left, right, incoming), af: (adding ? halfCarry : halfBorrow)(left, right, incoming),
    of: (adding ? addOverflow : overflow)(left, right, incoming), ...resultFlags(width),
  }), incoming);
}

function accumulator(operation: Operation, width: 8 | 16) {
  const destination = registers[width === 8 ? 0 : 1][0]!, withCarry = operation === "ADC" || operation === "SBB";
  const logical = operation === "OR" || operation === "AND" || operation === "XOR" || operation === "TEST";
  const writeBack = operation !== "CMP" && operation !== "TEST";
  const logic = { OR: bitOr, AND: bitAnd, XOR: bitXor, TEST: bitAnd };
  return defineInstruction({ cpu: cpu.declaration, name: `${operation} ${destination.name},n`,
    explanation: "Fetch the complete immediate low byte first, then read the accumulator. "
      + (withCarry ? "Capture CF after both operands. " : "Do not read incoming flags. ")
      + (logical ? "Clear OF, CF, and AF in that order; AF is deterministically cleared although undefined on hardware. "
        : "Update CF, AF, and OF in that order from unsigned carry/borrow, nibble carry/borrow, and signed overflow. ")
      + "Then set ZF/SF from the full result and PF from its low byte. Preserve TF/IF/DF. "
      + (writeBack ? "Write the accumulator after flags; a byte write retains the current upper half of AX. " : "Do not write the accumulator. ")
      + "A failed fetch prevents all body effects; completed fetches and IP changes remain.",
    steps: [readSource("right", immediates[width]), readSource("left", destination.view.source),
      ...(withCarry ? [readFlag("carry", cpu.flag("cf"))] : []),
      ...(logical ? [capture("result", logic[operation](value("left"), value("right"))),
        updateFlags(flagPolicy(cpu, `8088 ${operation}`, { result: width }, {
          of: flagLiteral(false), cf: flagLiteral(false), af: flagLiteral(false), ...resultFlags(width),
        }), { result: value("result") })] : arithmeticBody(operation === "ADD" || operation === "ADC" ? "add" : "subtract", width, withCarry)),
      ...(writeBack ? destination.view.write(value("result")) : [])],
  });
}

// Numeric keys are the encoding authority for both generated bodies and runtime bindings.
export const instructions8088 = instructionSet([
  // 00 ooo 10 w: ooo selects ADD/OR/ADC/SBB/AND/SUB/XOR/CMP; w=0 AL, w=1 AX.
  ...opcodeFamily("00 ooo 10 w", { o: operations, w: widths }, ({ o, w }) => accumulator(o, w)),
  // 0100 d rrr: d=0 INC, d=1 DEC; rrr selects AX/CX/DX/BX/SP/BP/SI/DI.
  ...opcodeFamily("0100 d rrr", { d: [false, true], r: wordRegisters8088 }, ({ d: decrement, r: register }) => defineInstruction({
    cpu: cpu.declaration, name: `${decrement ? "DEC" : "INC"} ${register.toUpperCase()}`,
    explanation: "Capture the word and CF. Add/subtract one with word wrapping; update arithmetic flags, then restore captured CF before writing the register. Preserve TF/IF/DF.",
    steps: [readRegister("left", cpu.register(register)), readFlag("preservedCarry", cpu.flag("cf")), capture("right", literal(16, 1)),
      ...arithmeticBody(decrement ? "subtract" : "add", 16),
      updateFlags(flagPolicy(cpu, "preserved carry", { carry: "flag" }, { cf: flagValue("carry") }), { carry: flagValue("preservedCarry") }),
      writeRegister(cpu.register(register), value("result"))],
  })),
  // 1001 0 rrr: exchange AX with the selected word; rrr=000 is the documented NOP.
  ...opcodeFamily("1001 0 rrr", { r: wordRegisters8088 }, ({ r: register }) => defineInstruction({
    cpu: cpu.declaration, name: register === "ax" ? "NOP" : `XCHG AX,${register.toUpperCase()}`,
    explanation: "Capture the selected register before AX, then write AX before the selected register. NOP retains the same self-exchange schedule. Do not access flags or memory.",
    steps: [readRegister("selected", cpu.register(register)), readRegister("accumulator", cpu.register("ax")),
      writeRegister(cpu.register("ax"), value("selected")), writeRegister(cpu.register(register), value("accumulator"))],
  })),
  // 1010 100 w: TEST AL/AX,n sets logical flags without accumulator writeback.
  ...opcodeFamily("1010 100 w", { w: widths }, ({ w }) => accumulator("TEST", w)),
  // 1011 w rrr: w=0 AL/CL/DL/BL/AH/CH/DH/BH; w=1 AX/CX/DX/BX/SP/BP/SI/DI.
  ...opcodeFamily("1011 w rrr", { w: registers, r: [0, 1, 2, 3, 4, 5, 6, 7] }, ({ w, r }) => {
    const { name, view, immediate } = w[r]!;
    return defineInstruction({ cpu: cpu.declaration, name: `MOV ${name},n`,
      explanation: "Fetch the complete immediate low byte first, then write the destination. A byte write retains the current other half of its stored word. Do not access flags. A failed fetch leaves the destination untouched.",
      steps: transfer(view.write(value("result")), immediate),
    });
  }),
]);

// Resolved operands retain only the decoder's captured segment/offset; no live address callback enters a body.
interface TransferOperand {
  readonly name: string;
  readonly memory?: true;
  readonly read: (name: string) => readonly Statement[];
  readonly write: (contents: NumberExpression, captureName: string) => readonly Statement[];
}

function memoryOperand(width: 8 | 16): TransferOperand {
  const address = (next: boolean) => projectAddress(value("segment"), next ? addWrap(value("offset"), literal(16, 1)) : value("offset"), 4, 20);
  return { name: `${width === 8 ? "byte" : "word"} [segment:offset]`, memory: true,
    read: name => width === 8 ? [readMemory(name, address(false))] : [
      readMemory(`${name}Low`, address(false)), readMemory(`${name}High`, address(true)), capture(name, concat(value(`${name}High`), value(`${name}Low`)))],
    write: contents => width === 8 ? [writeMemory(address(false), contents)] : [
      writeMemory(address(false), lowByte(contents)), writeMemory(address(true), highByte(contents))],
  };
}

function transferDefinition(destination: TransferOperand, source: Pick<TransferOperand, "name" | "memory">, steps: readonly Statement[], exchange = false): InstructionDefinition {
  const memory = destination.memory || source.memory;
  return defineInstruction({ cpu: cpu.declaration, name: `${exchange ? "XCHG" : "MOV"} ${destination.name},${source.name} (resolved)`,
    ...(memory ? { inputs: { segment: 16, offset: 16 } as const } : {}),
    explanation: "Enter after successful operand resolution. "
      + (exchange ? "Read the r/m operand before the register, then write r/m before the register. Capture both values before either write. "
        : "Read the complete source before writing the destination; never read a memory destination. ")
      + (memory ? "Use the captured segment and offset for every access. Transfer low byte first; wrap each byte's offset to 16 bits before computing (segment * 16 + offset) modulo 2^20. " : "No memory access occurs. ")
      + "Byte-register writes preserve the current other half at each writeback, including overlapping views. Preserve all flags and control state. Failed effects retain completed reads/writes and prevent later effects.",
    steps,
  });
}

function moveBody(destination: TransferOperand, source: Pick<TransferOperand, "name" | "read" | "memory">) {
  return transferDefinition(destination, source, [...source.read("right"), ...destination.write(value("right"), "destinationWord")]);
}

function exchangeBody(left: TransferOperand, right: TransferOperand) {
  return transferDefinition(left, right, [...left.read("left"), ...right.read("right"),
    ...left.write(value("right"), "destinationWord"), ...right.write(value("left"), "sourceWord")], true);
}

/** Specialized register choices; memory bodies share every decoder-resolved addressing mode. */
export const transfers8088: Readonly<Record<string, InstructionDefinition>> = Object.fromEntries(widths.flatMap((width, index) => {
  const operands: TransferOperand[] = registers[index]!.map(({ name, view }) => ({ name,
    read: name => [readSource(name, view.source)], write: view.write }));
  const memory = memoryOperand(width);
  return [
    ...operands.flatMap((destination, d) => operands.flatMap((source, s) => [
      [`move_${width}_${d}_${s}`, moveBody(destination, source)], [`exchange_${width}_${d}_${s}`, exchangeBody(destination, source)],
    ])),
    ...operands.flatMap((register, r) => [
      [`load_${width}_${r}`, moveBody(register, memory)], [`store_${width}_${r}`, moveBody(memory, register)],
      [`exchangeMemory_${width}_${r}`, exchangeBody(memory, register)],
    ]),
    [`immediate_${width}`, moveBody(memory, { name: "n", read: name => [readSource(name, immediates[width])] })],
  ];
}));
