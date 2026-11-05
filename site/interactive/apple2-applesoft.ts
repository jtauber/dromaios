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
        literal += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte)
          : `〈$${byte.toString(16).toUpperCase().padStart(2, "0")}〉`;
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
