import type { Catalogue6809, Instruction6809 } from "./6809-catalogue.js";
import type { InstructionShape } from "./instruction-shape.js";
import type { DisassemblyRow } from "./disassembly.js";
import { disassemblyRows } from "./disassembly.js";
import { checkUnsigned } from "../../src/components/validation.js";

export const hex6809 = (value: number, width = 4): string => value.toString(16).toUpperCase().padStart(width, "0");
const signed = (value: number, bits: number) => value < 2 ** (bits - 1) ? value : value - 2 ** bits;
export interface Decoded6809 extends DisassemblyRow {
  readonly opcodeBytes: number;
  readonly info?: Instruction6809;
  readonly shape?: InstructionShape;
  readonly target?: number;
}

/** Motorola operand spelling. The chapter-derived shape decides validity and how many bytes exist. */
function indexedOperand(bytes: readonly (number | undefined)[], registers: readonly string[]): string {
  const postbyte = bytes[0]; if (postbyte === undefined) return "??";
  const base = registers[postbyte >> 5 & 3]!, high = bytes[1], low = bytes[2];
  const byteOffset = high === undefined ? "?" : String(signed(high, 8));
  const wordOffset = high === undefined || low === undefined ? "?" : String(signed(high * 256 + low, 16));
  if (postbyte < 128) return `${signed(postbyte & 31, 5)},${base}`;
  let operand: string;
  switch (postbyte & 15) {
    case 0: operand = `,${base}+`; break;
    case 1: operand = `,${base}++`; break;
    case 2: operand = `,-${base}`; break;
    case 3: operand = `,--${base}`; break;
    case 4: operand = `,${base}`; break;
    case 5: operand = `B,${base}`; break;
    case 6: operand = `A,${base}`; break;
    case 8: operand = `${byteOffset},${base}`; break;
    case 9: operand = `${wordOffset},${base}`; break;
    case 11: operand = `D,${base}`; break;
    case 12: operand = `${byteOffset},PCR`; break;
    case 13: operand = `${wordOffset},PCR`; break;
    case 15: operand = high === undefined || low === undefined ? "$????" : `$${hex6809(high * 256 + low)}`; break;
    default: throw new Error("A supported indexed shape needs an assembly spelling.");
  }
  return postbyte & 16 ? `[${operand}]` : operand;
}

/** Decode instruction storage only. No register reads, pointer chasing, or execution. */
export function decode6809(read: (address: number) => number | undefined, address: number, catalogue: Catalogue6809): Decoded6809 {
  checkUnsigned("Disassembly address", address, 0xffff);
  const bytes: (number | undefined)[] = [];
  function fetch(): number | undefined { const byte = read((address + bytes.length) & 0xffff); bytes.push(byte); return byte; }
  const first = fetch(); let opcode = first;
  if (first !== undefined && catalogue.prefixes.includes(first)) {
    const second = fetch(); opcode = second === undefined ? undefined : first * 256 + second;
  }
  const opcodeBytes = bytes.length, info = opcode === undefined ? undefined : catalogue.instructions[opcode];
  if (!info) return { address, opcodeBytes, bytes, complete: false,
    assembly: bytes.some(byte => byte === undefined) ? "Unavailable" : `.byte ${bytes.map(byte => `$${hex6809(byte!, 2)}`).join(", ")}` };
  let shape: InstructionShape | undefined;
  if (typeof info.shape === "number") shape = catalogue.shapes[info.shape];
  else { const postbyte = fetch(); if (postbyte !== undefined) shape = catalogue.shapes[info.shape[postbyte]!]; }
  while (shape && bytes.length < shape.length) fetch();
  const complete = shape?.supported === true && bytes.every(byte => byte !== undefined);
  if (shape?.supported === false) return { address, opcodeBytes, bytes, info, shape, complete,
    assembly: `${info.name.split(" ")[0]} $${hex6809(bytes[opcodeBytes]!, 2)} · unsupported postbyte` };
  const operand = bytes.slice(opcodeBytes), firstOperand = operand[0], secondOperand = operand[1];
  const byte = firstOperand === undefined ? "??" : hex6809(firstOperand, 2);
  const word = firstOperand === undefined || secondOperand === undefined ? undefined : firstOperand * 256 + secondOperand;
  const mnemonic = info.name.split(" ")[0]!;
  let text = "", target: number | undefined;
  switch (info.operand) {
    case "none": break;
    case "byte": text = `#$${byte}`; break;
    case "word": text = `#$${word === undefined ? "????" : hex6809(word)}`; break;
    case "direct": text = `<$${byte}`; break;
    case "extended": text = `$${word === undefined ? "????" : hex6809(word)}`;
      if (complete && shape?.controlFlow === "unconditional") target = word; break;
    case "relative": {
      const offset = operand.length === 1 ? firstOperand === undefined ? undefined : signed(firstOperand, 8) : word === undefined ? undefined : signed(word, 16);
      target = offset === undefined ? undefined : (address + bytes.length + offset) & 0xffff;
      text = target === undefined ? "$????" : `$${hex6809(target)}`; break;
    }
    case "indexed": text = indexedOperand(operand, catalogue.indexedRegisters); break;
    case "transfer": text = firstOperand === undefined ? "?,?" : `${catalogue.transferRegisters[firstOperand >> 4]},${catalogue.transferRegisters[firstOperand & 15]}`; break;
    case "mask": text = firstOperand === undefined ? "??" : ["CC", "A", "B", "DP", "X", "Y", mnemonic.endsWith("S") ? "U" : "S", "PC"]
      .filter((_, bit) => firstOperand & 2 ** bit).join(",") || "$00"; break;
  }
  return { address, opcodeBytes, bytes, info, shape, complete, ...(target !== undefined && { target }),
    assembly: mnemonic + (text ? " " + text : "") };
}

export const disassemble6809Rows = (read: (address: number) => number | undefined, start: number, catalogue: Catalogue6809, count = 16) =>
  disassemblyRows(start, count, address => decode6809(read, address, catalogue));

/** Encoded addresses only. Direct-page operands require the DP observed at this instruction. */
export function address6809Operand(row: Decoded6809, dp?: number): number | undefined {
  if (!row.complete) return undefined;
  const bytes = row.bytes.slice(row.opcodeBytes);
  switch (row.info?.operand) {
    case "relative": return row.target;
    case "extended": return bytes[0]! * 256 + bytes[1]!;
    case "direct": return dp === undefined ? undefined : dp * 256 + bytes[0]!;
    default: return undefined; // Immediate constants and indexed forms are not absolute addresses.
  }
}
