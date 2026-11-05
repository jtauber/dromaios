import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import type { Ram } from "../../src/components/memory/ram.js";
import type { ExternalRom } from "../../src/machines/rom-image.js";

type Memory = Pick<Ram, "read">;

interface ApplesoftLine {
  readonly number: number;
  readonly parts: readonly { text: string; tokenAddress?: number }[];
}

export interface ApplesoftListing {
  readonly lines: readonly ApplesoftLine[];
  readonly message?: string;
}

const word = (ram: Memory, at: number) => ram.read(at) | ram.read(at + 1) << 8;

function displayCharacter(byte: number): string {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : `〈$${byte.toString(16).toUpperCase().padStart(2, "0")}〉`;
}

/** The verified Apple II Plus ROM marks the last character of each keyword with bit 7. */
export function applesoftKeywords(firmware: Pick<ExternalRom, "read">): string[] {
  const words: string[] = [];
  let name = "";
  for (let offset = 0x00d0; offset < 0x025f; offset++) {
    const byte = firmware.read(offset);
    if (byte === "bus-error") throw new Error("Applesoft keywords require the installed ROM.");
    name += String.fromCharCode(byte & 0x7f);
    if (byte & 0x80) { words.push(name); name = ""; }
  }
  return words;
}

function decodeProgram(bytes: Uint8Array, start: number, keywords: readonly string[]): ApplesoftListing {
  const lines: ApplesoftLine[] = [];
  const invalid = { lines: [], message: "Incomplete or invalid Applesoft line links." };
  for (let line = 0; line + 1 < bytes.length;) {
    const link = bytes[line]! | bytes[line + 1]! << 8;
    if (link === 0) return lines.length ? { lines } : { lines, message: "The Applesoft program is empty." };
    const next = link - start;
    if (next < line + 5 || next + 2 > bytes.length || bytes[next - 1] !== 0) return invalid;
    const number = bytes[line + 2]! | bytes[line + 3]! << 8;
    const parts: { text: string; tokenAddress?: number }[] = [];
    let literal = "", quoted = false, comment = false, data = false;
    for (let i = line + 4; i < next - 1; i++) {
      const byte = bytes[i]!;
      if (byte === 0) return invalid;
      const keyword: string | undefined = !comment && !quoted && !data ? keywords[byte - 0x80] : undefined;
      if (keyword !== undefined) {
        if (literal) parts.push({ text: literal });
        literal = "";
        parts.push({ text: keyword, tokenAddress: start + i });
        comment = keyword === "REM";
        data = keyword === "DATA";
      } else {
        if (!comment && byte === 0x22) quoted = !quoted;
        if (!quoted && byte === 0x3a) data = false;
        literal += displayCharacter(byte);
      }
    }
    if (literal) parts.push({ text: literal });
    lines.push({ number, parts });
    line = next;
  }
  return invalid;
}

/** Follow TXTTAB's line chain only within main RAM below VARTAB.
 * Keep the same listing while its stored bytes are unchanged, including across CPU steps. */
export function createApplesoftListing(keywords: readonly string[]) {
  const uninitialized = { lines: [], message: "No Applesoft program area is initialized." };
  let previousStart = -1, bytes: Uint8Array = new Uint8Array(), listing: ApplesoftListing = uninitialized;
  return (ram: Memory): ApplesoftListing => {
    const start = word(ram, 0x67), end = word(ram, 0x69);
    if (start === 0 || start + 2 > end || end > 0xc000) return uninitialized;
    if (start !== previousStart || bytes.length !== end - start || !bytes.every((byte, i) => byte === ram.read(start + i))) {
      previousStart = start;
      bytes = Uint8Array.from({ length: end - start }, (_, i) => ram.read(start + i));
      listing = decodeProgram(bytes, start, keywords);
    }
    return listing;
  };
}

/** LIST scans with ($9B),Y; execution keeps its text pointer in CHRGET's operand. */
export function applesoftCursor(ram: Memory, latest?: Cpu6502StepRecord) {
  if (latest?.before.pc === 0xd713) {
    const access = latest.accesses.at(-1);
    if (access?.kind === "read") return { address: access.address, line: undefined, source: "LIST" };
  }
  const line = word(ram, 0x75);
  if (line < 0xff00) return { address: word(ram, 0xb8), line, source: "Text pointer" };
  return undefined;
}

interface ApplesoftVariable {
  readonly name: string;
  readonly address: number;
  readonly type: "Real" | "Integer" | "String";
  readonly value: string;
  readonly contentsAddress?: number;
}

/** Packed Applesoft reals store an exponent and 31 fraction bits. The leading 1 is implicit. */
function realValue(ram: Memory, at: number): string {
  const exponent = ram.read(at);
  if (exponent === 0) return "0";
  const signAndFraction = ram.read(at + 1);
  const fraction = (signAndFraction & 0x7f) * 2 ** 24 + ram.read(at + 2) * 2 ** 16 + ram.read(at + 3) * 256 + ram.read(at + 4);
  const magnitude = (1 + fraction / 2 ** 31) * 2 ** (exponent - 129);
  const value = signAndFraction & 0x80 ? -magnitude : magnitude;
  // PRINT uses nine significant digits, and scientific notation outside this exponent range.
  const [digits, power] = value.toExponential(8).split("e");
  const e = Number(power);
  if (e < -2 || e > 8) return `${Number(digits)}E${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
  return String(Number(value.toPrecision(9))).replace(/^(-?)0\./, "$1.");
}

/** VARTAB points to seven-byte records. ARYTAB points just past the last one. */
export function applesoftVariables(ram: Pick<Ram, "read" | "size">): { variables: ApplesoftVariable[]; message?: string } {
  const start = word(ram, 0x69), end = word(ram, 0x6b);
  if (start === 0 && end === 0) return { variables: [], message: "The Applesoft variable table is uninitialized." };
  if (start === 0 || end < start || end > ram.size || (end - start) % 7 !== 0) {
    return { variables: [], message: "Incomplete or invalid Applesoft variable table." };
  }
  const variables: ApplesoftVariable[] = [];
  for (let address = start; address < end; address += 7) {
    const first = ram.read(address), second = ram.read(address + 1);
    if ((first & 0x80) && !(second & 0x80)) continue; // DEF FN uses the same table.
    const name = String.fromCharCode(first & 0x7f) + ((second & 0x7f) ? String.fromCharCode(second & 0x7f) : "");
    if (!/^[A-Z][A-Z0-9]?$/.test(name)) return { variables: [], message: "Incomplete or invalid Applesoft variable name." };
    const data = address + 2;
    if (first & 0x80) {
      const high = ram.read(data);
      const integer = (high >= 128 ? high - 256 : high) * 256 + ram.read(data + 1);
      variables.push({ name: name + "%", address, type: "Integer", value: String(integer) });
    } else if (second & 0x80) {
      const length = ram.read(data), pointer = word(ram, data + 1);
      const entry = { name: name + "$", address, type: "String" } as const;
      if (length === 0) variables.push({ ...entry, value: '""' });
      else if (pointer + length > ram.size) variables.push({ ...entry, value: "Outside main RAM" });
      else {
        let characters = "";
        for (let i = 0; i < length; i++) characters += displayCharacter(ram.read(pointer + i));
        variables.push({ ...entry, value: `"${characters}"`, contentsAddress: pointer });
      }
    } else {
      variables.push({ name, address, type: "Real", value: realValue(ram, data) });
    }
  }
  return { variables };
}
