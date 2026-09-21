import { instructions as intel } from "../../src/components/cpus/generated/8080.js";
import { bodiesZ80 as zilog } from "./z80-bodies.js";
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
function base(instructions: Readonly<Record<0x01 | 0x11 | 0x21 | 0x31 | 0x22 | 0x2a | 0xf9, Execute>>): WordForm[] {
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
    [0x63, 0x6b, ["h", "l"], zilog[0xed63], zilog[0xed6b]],
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

interface ExchangeForm {
  readonly bytes: readonly number[];
  readonly fields: WordFields;
  readonly stack: boolean;
  readonly execute: Execute;
}

function baseExchanges(instructions: Readonly<Record<0xe3 | 0xeb, Execute>>): ExchangeForm[] {
  return [
    { bytes: [0xe3], fields: ["h", "l"], stack: true, execute: instructions[0xe3] },
    { bytes: [0xeb], fields: ["h", "l"], stack: false, execute: instructions[0xeb] },
  ];
}
export const exchangeForms: Readonly<Record<"8080" | "z80", readonly ExchangeForm[]>> = {
  "8080": baseExchanges(intel),
  z80: [...baseExchanges(zilog),
    { bytes: [0xdd, 0xe3], fields: ["ix"], stack: true, execute: zilog.exchangeIXWord },
    { bytes: [0xfd, 0xe3], fields: ["iy"], stack: true, execute: zilog.exchangeIYWord }],
};

export interface WordArithmeticForm {
  readonly bytes: readonly number[];
  readonly destination: WordFields;
  readonly source?: WordFields;
  readonly operation: "inc" | "dec" | "add" | "adc" | "sbc";
  readonly execute: (state: WordState) => void;
}
const hl = ["h", "l"] as const;
const pairFields = [["b", "c"], ["d", "e"], hl, ["sp"]] as const;
const baseOpcodes = [0x03, 0x0b, 0x09, 0x13, 0x1b, 0x19, 0x23, 0x2b, 0x29, 0x33, 0x3b, 0x39] as const;
function arithmeticBase(instructions: Readonly<Record<typeof baseOpcodes[number], (state: WordState) => void>>): WordArithmeticForm[] {
  return baseOpcodes.map((opcode, index) => {
    const operation = (["inc", "dec", "add"] as const)[index % 3]!, pair = pairFields[Math.floor(index / 3)]!;
    return { bytes: [opcode], destination: operation === "add" ? hl : pair,
      ...(operation === "add" ? { source: pair } : {}), operation, execute: instructions[opcode] };
  });
}
export const arithmeticForms: Readonly<Record<"8080" | "z80", readonly WordArithmeticForm[]>> = {
  "8080": arithmeticBase(intel),
  z80: [
    ...arithmeticBase(zilog),
    ...([
      [0x42, 0x4a, zilog.sbcHLBC, zilog.adcHLBC], [0x52, 0x5a, zilog.sbcHLDE, zilog.adcHLDE],
      [0x62, 0x6a, zilog.sbcHLHL, zilog.adcHLHL], [0x72, 0x7a, zilog.sbcHLSP, zilog.adcHLSP],
    ] as const).flatMap(([sbc, adc, subtract, add], index): WordArithmeticForm[] => [
      { bytes: [0xed, sbc], destination: hl, source: pairFields[index]!, operation: "sbc", execute: subtract },
      { bytes: [0xed, adc], destination: hl, source: pairFields[index]!, operation: "adc", execute: add },
    ]),
    ...([
      [0xdd, "ix", zilog.incIXWord, zilog.decIXWord, [zilog.addIXBC, zilog.addIXDE, zilog.addIXIX, zilog.addIXSP]],
      [0xfd, "iy", zilog.incIYWord, zilog.decIYWord, [zilog.addIYBC, zilog.addIYDE, zilog.addIYIY, zilog.addIYSP]],
    ] as const).flatMap(([prefix, index, inc, dec, additions]): WordArithmeticForm[] => [
      { bytes: [prefix, 0x23], destination: [index], operation: "inc", execute: inc },
      { bytes: [prefix, 0x2b], destination: [index], operation: "dec", execute: dec },
      ...([0x09, 0x19, 0x29, 0x39] as const).map((opcode, pair): WordArithmeticForm => ({
        bytes: [prefix, opcode], destination: [index], source: pair === 2 ? [index] : pairFields[pair]!, operation: "add", execute: additions[pair]!,
      })),
    ]),
  ],
};

const wordValue = (state: WordState, fields: WordFields): number => fields.length === 1 ? state[fields[0]] : state[fields[0]] * 256 + state[fields[1]];
const signed = (word: number): number => word < 32768 ? word : word - 65536;

/** Independent integer arithmetic: no production ALU helpers, flag expressions, or opcode inventories. */
export function arithmeticChanges(cpu: "8080" | "z80", form: WordArithmeticForm, before: WordState) {
  const left = wordValue(before, form.destination), right = form.source ? wordValue(before, form.source) : 1;
  const subtracting = form.operation === "sbc" || form.operation === "dec", withCarry = form.operation === "adc" || form.operation === "sbc";
  const incoming = withCarry && before.flags.c ? 1 : 0, sign = subtracting ? -1 : 1;
  const total = left + sign * (right + incoming), result = (total + 65536) % 65536;
  const flags = { ...before.flags };
  if (form.source) {
    if (cpu === "8080") flags.cy = total >= 65536;
    else {
      const half = left % 4096 + sign * (right % 4096 + incoming), signedTotal = signed(left) + sign * (signed(right) + incoming);
      Object.assign(flags, { h: half < 0 || half >= 4096, n: subtracting, c: total < 0 || total >= 65536 });
      if (withCarry) Object.assign(flags, { s: result >= 32768, z: result === 0, pv: signedTotal < -32768 || signedTotal > 32767 });
    }
  }
  return { ...wordChanges(form.destination, result), flags };
}
