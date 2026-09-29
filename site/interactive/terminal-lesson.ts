import { createAltairProgram } from "./altair-program.js";
import { asciiByteLabel, interpretAscii } from "./ascii.js";
import { hex } from "./register-programs.js";

export const terminalOutputLimit = 256;

export interface TerminalOutputSnapshot {
  readonly text: string;
  readonly retained: number;
}

/** A readable label for a single byte, including values with no printed character. */
export function describeCharacterByte(value: number): string {
  return `${asciiByteLabel(value)} · ${value} decimal · ${hex(value, 2)} hex`;
}

function displayByte(value: number): string {
  const ascii = interpretAscii(value);
  if (ascii.kind === "graphic") return ascii.character;
  if (ascii.kind === "space") return " ";
  // This teaching display treats LF as a new line; it does not emulate a historical terminal.
  if (value === 10) return "\n";
  if (ascii.kind === "control") return `⟨${ascii.abbreviation}⟩`;
  if (ascii.kind === "delete") return "⟨DEL⟩";
  return `⟨${hex(value, 2)} hex⟩`;
}

/** Retain actual device writes, including equal consecutive bytes, separately from the CPU's history. */
export function createTerminalLesson(programName: "polling" | "reply" | "message" | "terminated-message" | "buffer" | "subroutine" | "nested-call" = "polling") {
  const bytes: number[] = [];
  const program = createAltairProgram(programName, value => {
    bytes.push(value);
    if (bytes.length > terminalOutputLimit) bytes.shift();
  });
  return {
    ...program,
    terminalSnapshot(): TerminalOutputSnapshot {
      return { text: bytes.map(displayByte).join(""), retained: bytes.length };
    },
  };
}
