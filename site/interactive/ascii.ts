const controls = [
  ["NUL", "Null"], ["SOH", "Start of heading"], ["STX", "Start of text"], ["ETX", "End of text"],
  ["EOT", "End of transmission"], ["ENQ", "Enquiry"], ["ACK", "Acknowledge"], ["BEL", "Bell"],
  ["BS", "Backspace"], ["HT", "Horizontal tabulation"], ["LF", "Line feed"], ["VT", "Vertical tabulation"],
  ["FF", "Form feed"], ["CR", "Carriage return"], ["SO", "Shift out"], ["SI", "Shift in"],
  ["DLE", "Data link escape"], ["DC1", "Device control 1"], ["DC2", "Device control 2"], ["DC3", "Device control 3"],
  ["DC4", "Device control 4"], ["NAK", "Negative acknowledge"], ["SYN", "Synchronous idle"], ["ETB", "End of transmission block"],
  ["CAN", "Cancel"], ["EM", "End of medium"], ["SUB", "Substitute"], ["ESC", "Escape"],
  ["FS", "File separator"], ["GS", "Group separator"], ["RS", "Record separator"], ["US", "Unit separator"],
] as const;

export type AsciiByte =
  | { readonly kind: "graphic"; readonly character: string }
  | { readonly kind: "space" }
  | { readonly kind: "control"; readonly abbreviation: string; readonly name: string }
  | { readonly kind: "delete" }
  | { readonly kind: "outside" };

/** Interpret a byte using seven-bit ASCII, without executing controls or guessing an extension. */
export function interpretAscii(value: number): AsciiByte {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError("A byte must be an integer from 0 to 255.");
  if (value > 127) return { kind: "outside" };
  if (value === 127) return { kind: "delete" };
  if (value === 32) return { kind: "space" };
  if (value > 32) return { kind: "graphic", character: String.fromCharCode(value) };
  const [abbreviation, name] = controls[value]!;
  return { kind: "control", abbreviation, name };
}

/** A compact visible label, without interpreting control bytes as display actions. */
export function asciiByteLabel(value: number): string {
  const ascii = interpretAscii(value);
  return ascii.kind === "graphic" ? `“${ascii.character}”`
    : ascii.kind === "space" ? "Space"
    : ascii.kind === "control" ? ascii.abbreviation
    : ascii.kind === "delete" ? "DEL" : "Outside ASCII";
}

/** Accept exactly one printable ASCII character, including space, without trimming or truncating. */
export function asciiCharacterByte(text: string): number | undefined {
  if (text.length !== 1) return undefined;
  const value = text.charCodeAt(0);
  return value >= 32 && value <= 126 ? value : undefined;
}
