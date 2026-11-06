import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import type { Ram } from "../../src/components/memory/ram.js";
import type { ExternalRom } from "../../src/machines/rom-image.js";

type Memory = Pick<Ram, "read">;

interface ApplesoftPart { readonly text: string; readonly tokenAddress?: number }
export interface ApplesoftStatement {
  readonly address: number;
  readonly colonBefore: boolean;
  readonly parts: ApplesoftPart[];
}
interface ApplesoftLine {
  readonly number: number;
  readonly terminator: number;
  readonly statements: readonly ApplesoftStatement[];
}

export interface ApplesoftListing {
  readonly lines: readonly ApplesoftLine[];
  readonly message?: string;
}

export interface ApplesoftSourcePosition {
  readonly line: number;
  readonly index: number;
  statement: ApplesoftStatement;
}

/** Locate a saved text pointer, which can point inside a statement or at its ending colon. */
export function applesoftSourceAt(listing: ApplesoftListing, number: number, pointer: number): ApplesoftSourcePosition | undefined {
  const line = listing.lines.find(line => line.number === number);
  if (!line || pointer > line.terminator) return;
  let index = line.statements.length - 1;
  while (index >= 0 && line.statements[index]!.address > pointer) index--;
  const statement = line.statements[index];
  if (statement) return { line: number, index, statement };
}

export function applesoftStatementText(statement: ApplesoftStatement): string {
  return statement.parts.map(part => part.tokenAddress === undefined ? part.text : ` ${part.text} `).join("").trim();
}

/** Compare stored tokens and literal text, independently of where BASIC moved the line. */
export function sameApplesoftSource(a: ApplesoftStatement, b: ApplesoftStatement): boolean {
  return a === b || a.parts.length === b.parts.length && a.parts.every((part, i) => {
    const other = b.parts[i]!;
    return part.text === other.text && (part.tokenAddress === undefined) === (other.tokenAddress === undefined);
  });
}

export function resolveApplesoftSource(listing: ApplesoftListing, point: ApplesoftSourcePosition): ApplesoftStatement | undefined {
  const current = listing.lines.find(line => line.number === point.line)?.statements[point.index];
  return current && sameApplesoftSource(point.statement, current) ? current : undefined;
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
    const statements: ApplesoftStatement[] = [];
    function firstByte(at: number): number {
      while (bytes[at] === 0x20) at++; // CHRGET skips spaces before dispatch.
      return at;
    }
    function begin(at: number, colonBefore: boolean): ApplesoftPart[] {
      const parts: ApplesoftPart[] = [];
      statements.push({ address: start + firstByte(at), colonBefore, parts });
      return parts;
    }
    let parts = begin(line + 4, false);
    let literal = "", quoted = false, comment = false, data = false;
    function flush(): void {
      if (literal) parts.push({ text: literal });
      literal = "";
    }
    for (let i = line + 4; i < next - 1; i++) {
      const byte = bytes[i]!;
      if (byte === 0) return invalid;
      if (byte === 0x3a && !comment && !quoted) {
        flush(); parts = begin(i + 1, true); data = false;
        continue;
      }
      const keyword: string | undefined = !comment && !quoted && !data ? keywords[byte - 0x80] : undefined;
      if (keyword !== undefined) {
        flush();
        // IF X GOTO n dispatches GOTO just as IF X THEN GOTO n does.
        if (keyword === "GOTO" && parts.some(part => part.tokenAddress !== undefined && part.text === "IF")) parts = begin(i, false);
        parts.push({ text: keyword, tokenAddress: start + i });
        comment = keyword === "REM";
        data = keyword === "DATA";
        if (keyword === "THEN") {
          const nextByte = bytes[firstByte(i + 1)]!;
          // THEN n branches directly. THEN <statement> enters the dispatcher again.
          if (nextByte < 0x30 || nextByte > 0x39) parts = begin(i + 1, false);
        }
      } else {
        if (!comment && byte === 0x22) quoted = !quoted;
        literal += displayCharacter(byte);
      }
    }
    flush();
    lines.push({ number, terminator: start + next - 1, statements });
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

/** The debugger asks at every statement dispatch. Only program or bounds writes require another sample. */
export function observeApplesoftListing(ram: Ram, keywords: readonly string[]) {
  const decode = createApplesoftListing(keywords);
  let start = 0, end = 0, sample: ApplesoftListing | undefined;
  const detach = ram.observeWrites(({ address, before, after }) => {
    if (before !== after && ((address >= start && address < end) || (address >= 0x67 && address <= 0x6a))) sample = undefined;
  });
  return {
    detach,
    read(): ApplesoftListing {
      if (!sample) {
        start = word(ram, 0x67); end = word(ram, 0x69);
        sample = decode(ram);
      }
      return sample;
    },
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

type VariableRam = Pick<Ram, "read" | "size">;

interface ApplesoftMemoryRegion {
  readonly name: string;
  readonly start: number;
  readonly end: number; // Exclusive, including when it is the first address above main RAM.
}

/** Applesoft's allocation boundaries, sampled without running its collecting FRE function. */
export function applesoftMemoryLayout(ram: VariableRam): { regions: ApplesoftMemoryRegion[]; message?: string } {
  // TXTTAB, VARTAB, ARYTAB, STREND, FRETOP, MEMSIZE.
  const bounds = [0x67, 0x69, 0x6b, 0x6d, 0x6f, 0x73].map(at => word(ram, at));
  if (bounds.every(at => at === 0)) return { regions: [], message: "The Applesoft memory layout is uninitialized." };
  if (bounds[0] === 0 || bounds[1]! < bounds[0]! + 2 || bounds[5]! > ram.size
    || bounds.some((at, i) => i > 0 && at < bounds[i - 1]!)) {
    return { regions: [], message: "Incomplete or invalid Applesoft memory boundaries." };
  }
  const names = ["Program area", "Scalars", "Arrays", "Free space", "String heap"];
  return { regions: names.map((name, i) => ({ name, start: bounds[i]!, end: bounds[i + 1]! })) };
}

type VariableType = "Real" | "Integer" | "String";
const elementBytes = { Real: 5, Integer: 2, String: 3 } as const;

export interface ApplesoftVariable {
  readonly name: string;
  readonly address: number;
  readonly type: VariableType;
  readonly value: string;
  readonly contentsAddress?: number;
}

/** Packed Applesoft reals store an exponent and 31 fraction bits. The leading 1 is implicit. */
export function applesoftReal(ram: Memory, at: number, negative?: boolean): string {
  const exponent = ram.read(at);
  if (exponent === 0) return "0";
  const signAndFraction = ram.read(at + 1);
  const fraction = (signAndFraction & 0x7f) * 2 ** 24 + ram.read(at + 2) * 2 ** 16 + ram.read(at + 3) * 256 + ram.read(at + 4);
  const magnitude = (1 + fraction / 2 ** 31) * 2 ** (exponent - 129);
  const value = (negative ?? Boolean(signAndFraction & 0x80)) ? -magnitude : magnitude;
  // PRINT uses nine significant digits, and scientific notation outside this exponent range.
  const [digits, power] = value.toExponential(8).split("e");
  const e = Number(power);
  if (e < -2 || e > 8) return `${Number(digits)}E${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
  return String(Number(value.toPrecision(9))).replace(/^(-?)0\./, "$1.");
}

function variableName(first: number, second: number): { name: string; type: VariableType } | undefined {
  const name = String.fromCharCode(first & 0x7f) + ((second & 0x7f) ? String.fromCharCode(second & 0x7f) : "");
  if (!/^[A-Z][A-Z0-9]?$/.test(name)) return undefined;
  if (first & 0x80) return second & 0x80 ? { name: name + "%", type: "Integer" } : undefined;
  return second & 0x80 ? { name: name + "$", type: "String" } : { name, type: "Real" };
}

function valueAt(ram: VariableRam, type: VariableType, at: number): Pick<ApplesoftVariable, "value" | "contentsAddress"> {
  if (type === "Real") return { value: applesoftReal(ram, at) };
  if (type === "Integer") {
    const high = ram.read(at);
    return { value: String((high >= 128 ? high - 256 : high) * 256 + ram.read(at + 1)) };
  }
  const length = ram.read(at), pointer = word(ram, at + 1);
  if (length === 0) return { value: '""' };
  if (pointer + length > ram.size) return { value: "Outside main RAM" };
  let characters = "";
  for (let i = 0; i < length; i++) characters += displayCharacter(ram.read(pointer + i));
  return { value: `"${characters}"`, contentsAddress: pointer };
}

/** VARTAB points to seven-byte records. ARYTAB points just past the last one. */
export function applesoftVariables(ram: VariableRam): { variables: ApplesoftVariable[]; message?: string } {
  const start = word(ram, 0x69), end = word(ram, 0x6b);
  if (start === 0 && end === 0) return { variables: [], message: "The Applesoft variable table is uninitialized." };
  if (start === 0 || end < start || end > ram.size || (end - start) % 7 !== 0) {
    return { variables: [], message: "Incomplete or invalid Applesoft variable table." };
  }
  const variables: ApplesoftVariable[] = [];
  for (let address = start; address < end; address += 7) {
    const first = ram.read(address), second = ram.read(address + 1);
    if ((first & 0x80) && !(second & 0x80)) continue; // DEF FN uses the same table.
    const named = variableName(first, second);
    if (!named) return { variables: [], message: "Incomplete or invalid Applesoft variable name." };
    variables.push({ ...named, address, ...valueAt(ram, named.type, address + 2) });
  }
  return { variables };
}

export interface ApplesoftArray {
  readonly name: string;
  readonly type: VariableType;
  readonly address: number;
  readonly data: number;
  readonly dimensions: readonly number[]; // Element counts, in BASIC subscript order.
  readonly count: number;
}

/** ARYTAB through STREND holds consecutive arrays, each with a little-endian record length. */
export function applesoftArrays(ram: VariableRam): { arrays: ApplesoftArray[]; message?: string } {
  const start = word(ram, 0x6b), end = word(ram, 0x6d);
  const invalid = { arrays: [], message: "Incomplete or invalid Applesoft array table." };
  if (start === 0 && end === 0) return { arrays: [] };
  if (start === 0 || end < start || end > ram.size) return invalid;
  const arrays: ApplesoftArray[] = [];
  for (let address = start; address < end;) {
    if (address + 5 > end) return invalid;
    const named = variableName(ram.read(address), ram.read(address + 1));
    const next = address + word(ram, address + 2), rank = ram.read(address + 4);
    const data = address + 5 + rank * 2;
    if (!named || !rank || data >= next || next > end) return invalid;
    const dimensions: number[] = [];
    let count = 1;
    for (let at = address + 5; at < data; at += 2) {
      const size = ram.read(at) * 256 + ram.read(at + 1);
      count *= size;
      if (!size || count > next - data) return invalid;
      dimensions.push(size);
    }
    if (count * elementBytes[named.type] !== next - data) return invalid;
    arrays.push({ ...named, address, data, dimensions: dimensions.reverse(), count });
    address = next;
  }
  return { arrays };
}

/** The first BASIC subscript varies fastest as element addresses increase. */
export function applesoftArrayElement(ram: VariableRam, array: ApplesoftArray, index: number): ApplesoftVariable {
  if (!Number.isInteger(index) || index < 0 || index >= array.count) throw new RangeError("Array element outside its dimensions.");
  const address = array.data + index * elementBytes[array.type];
  const subscripts = array.dimensions.map(size => {
    const subscript = index % size;
    index = Math.floor(index / size);
    return subscript;
  });
  return { name: `${array.name}(${subscripts.join(",")})`, type: array.type, address, ...valueAt(ram, array.type, address) };
}
