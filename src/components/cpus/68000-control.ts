import { motorolaBranchNames } from "./motorola.ts";
import { opcodeFamily, opcodePattern } from "./opcodes.ts";
import { addressRegisters68000 as address, dataRegisters68000 as data, operand68000, selectors68000 as codes } from "./68000-operands.ts";

export const conditionNames68000 = ["T", "F", ...motorolaBranchNames.slice(2).map(name => name.slice(1).toUpperCase())];
const conditions = Array.from({ length: 16 }, (_, code) => code);
const displacements = Array.from({ length: 256 }, (_, byte) => byte);
/** Control EAs calculate addresses: (An), displacement/index, absolute, or PC-relative. */
export const isControlAddress68000 = (mode: number, code: number) => mode === 2 || mode === 5 || mode === 6 || mode === 7 && code <= 3;

export const controlForms68000 = [
  // 0101 cccc 11 mmm rrr: Scc uses data-alterable bytes; mmm=001 instead selects DBcc Dn.
  // cccc=tttp selects T/HI/CC/NE/VC/PL/GE/GT, with p=1 inverting that test.
  ...opcodeFamily("0101 cccc 11 mmm rrr", { c: conditions, m: codes, r: codes }, ({ c: condition, m: mode, r: code }) => {
    const destination = operand68000(8, mode, code, "destination");
    return mode === 1 ? { kind: "decrement", condition, register: data[code]!, mode, code, displacement: 0, body: `DB${conditionNames68000[condition]}_${data[code]}` } as const
      : destination ? { kind: "condition", condition, destination, mode, code, displacement: 0, body: `S${conditionNames68000[condition]}_${destination.name}` } as const : undefined;
  }),
  // 0110 cccc dddddddd: BRA=0000, BSR=0001; other cccc are conditional branches.
  // d=00 fetches a signed word; otherwise d is a signed byte (FF is -1, not a long prefix).
  ...opcodeFamily("0110 cccc dddddddd", { c: conditions, d: displacements }, ({ c: condition, d: displacement }) => ({
    kind: "branch", condition, word: displacement === 0, mode: 0, code: 0, displacement, body: `${condition === 1 ? "BSR" : motorolaBranchNames[condition]!.toUpperCase()}_${displacement === 0 ? "word" : "byte"}`,
  } as const)),
  // 0100 aaa 111 mmm rrr: LEA puts the address itself in Aaaa, without a data read.
  ...opcodeFamily("0100 aaa 111 mmm rrr", { a: address, m: codes, r: codes }, ({ a: register, m: mode, r: code }) =>
    isControlAddress68000(mode, code) ? { kind: "address", operation: "LEA", register, mode, code, displacement: 0, body: `LEA_${register}` } as const : undefined),
  // Control EAs are shared by PEA and jumps; JSR also stacks the complete return address.
  ...([
    { pattern: "0100 1000 01 mmm rrr", operation: "PEA" },
    { pattern: "0100 1110 10 mmm rrr", operation: "JSR" },
    { pattern: "0100 1110 11 mmm rrr", operation: "JMP" },
  ] as const).flatMap(({ pattern, operation }) => opcodeFamily(pattern, { m: codes, r: codes }, ({ m: mode, r: code }) =>
    isControlAddress68000(mode, code) ? { kind: "address", operation, register: undefined, mode, code, displacement: 0, body: operation } as const : undefined)),
  // 0100 1110 0101 u rrr: u=0 LINK with a signed allocation word, u=1 UNLK.
  ...opcodeFamily("0100 1110 0101 u rrr", { u: ["LINK", "UNLK"] as const, r: address }, ({ u: operation, r: register }) => ({
    kind: "frame", operation, register, mode: 0, code: 0, displacement: 0, body: `${operation}_${register}`,
  } as const)),
  ...opcodePattern("0100 1110 0111 0101", { kind: "return", mode: 0, code: 0, displacement: 0, body: "RTS" } as const),
].flatMap(([opcode, form]) => form ? [{ opcode, ...form }] : []);

export type ControlForm68000 = typeof controlForms68000[number];
