import { cpu68000StateDescription } from "../../state/68000.ts";
import { opcodeFamily } from "../../opcodes.ts";
import { bitAnd, bitOr, capture, cpuSymbols, extend, flagLiteral, flagValue, literal, negative, readFlag, readRegister,
  shiftBits, signExtend, truncate, updateFlags, value, writeRegister, zero } from "../model.ts";
import type { NumberExpression, Register, Statement } from "../model.ts";
import { instructionSet, transfer } from "../builders.ts";
import { choose } from "../control-flow.ts";
import { flagPolicy } from "../status.ts";
import { defineInstruction } from "../validate.ts";

const cpu = cpuSymbols("68000", cpu68000StateDescription);
const dataRegisters = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"] as const;
const addressRegisters = ["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7"] as const;
type RegisterName = typeof dataRegisters[number] | typeof addressRegisters[number];
type Size = 8 | 16 | 32;
const codes = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const sizes = { 8: "B", 16: "W", 32: "L" } as const;

/** Resolve A7 at this operand's turn, reading only the selected stored stack pointer. */
function withRegister(name: RegisterName, role: string, body: (register: Register) => readonly Statement[]): readonly Statement[] {
  return name === "a7" ? choose({ steps: [readFlag(role, cpu.flag("s"))], test: flagValue(role) },
    body(cpu.register("ssp")), body(cpu.register("usp"))) : body(cpu.register(name));
}

const narrow = (contents: NumberExpression, size: Size) => size === 32 ? contents : truncate(contents, size);

/** Byte/word writes preserve the live upper part; EXT can supply its already captured original. */
function writeData(register: Register, size: Size, contents: NumberExpression, original?: NumberExpression): readonly Statement[] {
  if (size === 32) return [writeRegister(register, contents)];
  return [...(original ? [] : [readRegister("preserved", register)]), writeRegister(register,
    bitOr(bitAnd(original ?? value("preserved"), literal(32, 2 ** 32 - 2 ** size)), extend(contents, 32)))];
}

function resultFlags(size: Size) {
  return flagPolicy(cpu, "68000 result", { result: size }, {
    n: negative(value("result")), z: zero(value("result")), v: flagLiteral(false), c: flagLiteral(false),
  });
}

function move(size: Size, source: RegisterName, destination: RegisterName) {
  const address = destination.startsWith("a");
  return defineInstruction({ cpu: cpu.declaration, name: `${address ? "MOVEA" : "MOVE"}.${sizes[size]} ${source.toUpperCase()},${destination.toUpperCase()}`,
    explanation: "Capture the source before resolving the destination. A7 selects SSP when S is set and USP otherwise. "
      + (address ? "Replace the complete address register, sign-extending a word. Preserve every flag."
        : "Preserve the current upper portion on byte/word writes. Write the destination before setting N/Z and clearing V/C; preserve X/T/S."),
    steps: withRegister(source, "sourceSupervisor", from => [readRegister("source", from), capture("result", narrow(value("source"), size)),
      ...withRegister(destination, "destinationSupervisor", to => address
        ? [writeRegister(to, size === 16 ? signExtend(value("result"), 32) : value("result"))]
        : [...writeData(to, size, value("result")), updateFlags(resultFlags(size), { result: value("result") })])]),
  });
}

function extendRegister(name: typeof dataRegisters[number], size: 16 | 32) {
  const register = cpu.register(name);
  return defineInstruction({ cpu: cpu.declaration, name: `EXT.${sizes[size]} ${name.toUpperCase()}`,
    explanation: "Read Dn once. Sign-extend its byte to a word or its word to a long. EXT.W preserves the captured upper word. "
      + "Write Dn before setting N/Z and clearing V/C; preserve X/T/S.",
    steps: [readRegister("original", register), capture("result", signExtend(truncate(value("original"), size === 16 ? 8 : 16), size)),
      ...writeData(register, size, value("result"), value("original")), updateFlags(resultFlags(size), { result: value("result") })],
  });
}

function swap(name: typeof dataRegisters[number]) {
  const register = cpu.register(name);
  return defineInstruction({ cpu: cpu.declaration, name: `SWAP ${name.toUpperCase()}`,
    explanation: "Read Dn once and exchange its high and low words. Set N/Z and clear V/C before writing Dn; preserve X/T/S.",
    steps: [readRegister("original", register), capture("result", bitOr(shiftBits(value("original"), "left", 16), shiftBits(value("original"), "right", 16))),
      updateFlags(resultFlags(32), { result: value("result") }), writeRegister(register, value("result"))],
  });
}

function exchange(left: RegisterName, right: RegisterName) {
  return defineInstruction({ cpu: cpu.declaration, name: `EXG ${left.toUpperCase()},${right.toUpperCase()}`,
    explanation: "Resolve both register identities, including A7's active stack bank, before reading either value. "
      + "Capture both originals before writing left then right. Preserve every flag, including when both operands name the same register.",
    steps: withRegister(left, "leftSupervisor", a => withRegister(right, "rightSupervisor", b => [
      readRegister("left", a), readRegister("right", b), writeRegister(a, value("right")), writeRegister(b, value("left")),
    ])),
  });
}

export const instructions68000 = instructionSet([
  // 00 zz ddd 00m 00s rrr: zz=01 byte, 10 long, 11 word; m/s=0 Dn, 1 An.
  // Register-only MOVE/MOVEA. Byte transfers exclude An on both sides.
  ...opcodeFamily("00 01 ddd 000 000 rrr", { d: dataRegisters, r: dataRegisters }, ({ d, r }) => move(8, r, d)),
  ...([
    { pattern: "00 10 ddd 00m 00s rrr", size: 32 }, // MOVE.L / MOVEA.L
    { pattern: "00 11 ddd 00m 00s rrr", size: 16 }, // MOVE.W / MOVEA.W
  ] as const).flatMap(({ pattern, size }) => opcodeFamily(pattern,
    { d: codes, m: [dataRegisters, addressRegisters], s: [dataRegisters, addressRegisters], r: codes },
    ({ d, m, s, r }) => move(size, s[r]!, m[d]!))),
  // Register-only slots beside PEA and MOVEM: SWAP, then EXT.W (s=0) / EXT.L (s=1).
  ...opcodeFamily("0100 1000 01 000 rrr", { r: dataRegisters }, ({ r }) => swap(r)),
  ...opcodeFamily("0100 1000 1 s 000 rrr", { s: [16, 32] as const, r: dataRegisters }, ({ s, r }) => extendRegister(r, s)),
  // 1100 ddd 1 ooooo rrr: ooooo=01000 Dn/Dn, 01001 An/An, 10001 Dn/An.
  ...opcodeFamily("1100 ddd 1 01000 rrr", { d: dataRegisters, r: dataRegisters }, ({ d, r }) => exchange(d, r)),
  ...opcodeFamily("1100 ddd 1 01001 rrr", { d: addressRegisters, r: addressRegisters }, ({ d, r }) => exchange(d, r)),
  ...opcodeFamily("1100 ddd 1 10001 rrr", { d: dataRegisters, r: addressRegisters }, ({ d, r }) => exchange(d, r)),
], 16);

// 0111 rrr 0 iiiiiiii: the decoder supplies i as an unsigned byte to one body per Dn.
export const quick68000 = Object.fromEntries(dataRegisters.map(name => [name, defineInstruction({
  cpu: cpu.declaration, name: `MOVEQ #n,${name.toUpperCase()}`, inputs: { immediate: 8 },
  explanation: "Sign-extend the operation word's immediate byte to a long. Replace Dn before setting N/Z and clearing V/C; preserve X/T/S.",
  steps: transfer(cpu.register(name), signExtend(value("immediate"), 32), resultFlags(32)),
})]));
