/** A bounded, seven-bit printing terminal. Serial bytes remain unchanged in the machine. */
export function createSerialTerminal() {
  const lines = [""];
  let column = 0, received = 0;
  function newline(): void {
    lines.push("");
    if (lines.length > 200) lines.shift();
  }
  return {
    get text(): string { return lines.join("\n"); },
    get received(): number { return received; },
    write(bytes: readonly number[]): void {
      for (const raw of bytes) {
        received++;
        const byte = raw & 0x7f;
        if (byte === 13) column = 0;
        else if (byte === 10) newline();
        else if (byte === 8) column = Math.max(0, column - 1);
        else if (byte === 9) column = Math.min(132, (Math.floor(column / 8) + 1) * 8);
        else if (byte >= 32 && byte < 127) {
          if (column >= 132) { newline(); column = 0; }
          const last = lines.length - 1, line = lines[last]!.padEnd(column, " ");
          lines[last] = line.slice(0, column) + String.fromCharCode(byte) + line.slice(column + 1);
          column++;
        }
      }
    },
    clear(): void { lines.splice(0, lines.length, ""); column = 0; received = 0; },
  };
}

/** Single-line paste only: BASIC can discard typeahead while storing a numbered line. */
export function terminalInput(text: string): number[] {
  if (!/^[\x20-\x7e]*(?:\r\n|\r|\n)?$/.test(text)) {
    throw new Error("Use ASCII characters and paste one line at a time.");
  }
  return Array.from(text.replace(/\r\n$|\n$/, "\r"), character => character.charCodeAt(0));
}

/** Keep operating-system shortcuts and composition out of the guest input stream. */
export function terminalControlKey(event: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly isComposing: boolean;
}): number | undefined {
  if (event.isComposing || event.metaKey || event.altKey) return undefined;
  if (event.ctrlKey) return event.key.toLowerCase() === "c" ? 3 : undefined;
  return event.key === "Enter" ? 13 : event.key === "Backspace" ? 95 : undefined;
}
