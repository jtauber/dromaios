import { instructions as intel } from "../../src/components/cpus/generated/8080.js";
import { instructions as zilog } from "../../src/components/cpus/generated/z80.js";
import type { ByteInstructionContext } from "../../src/components/cpus/instruction-context.js";
import { initialState, flagPattern } from "../components/cpus/z80/helpers.js";

export function wordState(set = false) {
  return { ...initialState(), interruptEnabled: true, flags: { ...flagPattern(set ? 63 : 0), cy: set, ac: set, p: set } };
}
export type WordState = ReturnType<typeof wordState>;
type Execute = (state: WordState, context: ByteInstructionContext) => void;
type WordField = "b" | "c" | "d" | "e" | "h" | "l" | "sp" | "ix" | "iy";
export type WordFields = readonly [WordField] | readonly [WordField, WordField];
export interface WordForm {
  readonly bytes: readonly number[];
  readonly fields: WordFields;
  readonly operation: "immediate" | "load" | "store" | "copy";
  readonly execute: Execute;
}

// Literal native encodings, independent of the production transfer inventories.
function base(instructions: Readonly<Record<number, Execute>>): WordForm[] {
  return [
    ...([[0x01, ["b", "c"]], [0x11, ["d", "e"]], [0x21, ["h", "l"]], [0x31, ["sp"]]] as const)
      .map(([opcode, fields]) => ({ bytes: [opcode], fields, operation: "immediate" as const, execute: instructions[opcode]! })),
    { bytes: [0x22], fields: ["h", "l"], operation: "store", execute: instructions[0x22]! },
    { bytes: [0x2a], fields: ["h", "l"], operation: "load", execute: instructions[0x2a]! },
    { bytes: [0xf9], fields: ["h", "l"], operation: "copy", execute: instructions[0xf9]! },
  ];
}
const z80: WordForm[] = [
  ...base(zilog),
  ...([
    [0x43, 0x4b, ["b", "c"], zilog.storeBCMemory, zilog.loadBCMemory],
    [0x53, 0x5b, ["d", "e"], zilog.storeDEMemory, zilog.loadDEMemory],
    [0x63, 0x6b, ["h", "l"], zilog[0x22], zilog[0x2a]],
    [0x73, 0x7b, ["sp"], zilog.storeSPMemory, zilog.loadSPMemory],
  ] as const).flatMap(([store, load, fields, write, read]): WordForm[] => [
    { bytes: [0xed, store], fields, operation: "store", execute: write },
    { bytes: [0xed, load], fields, operation: "load", execute: read },
  ]),
  ...([
    [0xdd, "ix", zilog.immediateIXWord, zilog.storeIXWord, zilog.loadIXWord, zilog.copyIXWord],
    [0xfd, "iy", zilog.immediateIYWord, zilog.storeIYWord, zilog.loadIYWord, zilog.copyIYWord],
  ] as const).flatMap(([prefix, index, immediate, store, load, copy]): WordForm[] => [
    { bytes: [prefix, 0x21], fields: [index], operation: "immediate", execute: immediate },
    { bytes: [prefix, 0x22], fields: [index], operation: "store", execute: store },
    { bytes: [prefix, 0x2a], fields: [index], operation: "load", execute: load },
    { bytes: [prefix, 0xf9], fields: [index], operation: "copy", execute: copy },
  ]),
];
export const wordForms = { "8080": base(intel), z80 };

export function wordChanges(fields: WordFields, value: number) {
  return fields.length === 1 ? { [fields[0]]: value } : { [fields[0]]: Math.floor(value / 256), [fields[1]]: value % 256 };
}
