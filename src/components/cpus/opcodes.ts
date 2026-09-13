import { checkUnsigned } from "../validation.ts";

export type OpcodeEntry<Handler> = readonly [opcode: number, handler: Handler];
type Selectors = Readonly<Record<string, readonly unknown[]>>;
type Selected<Choices extends Selectors> = {
  readonly [Field in keyof Choices]: Choices[Field][number];
};

/** Construct a byte-opcode table, rejecting duplicate entries even if their handlers agree. */
export function opcodeTable<Handler>(
  entries: readonly OpcodeEntry<Handler>[],
): Readonly<Partial<Record<number, Handler>>> {
  const table: Partial<Record<number, Handler>> = {};
  for (const [opcode, handler] of entries) {
    checkUnsigned("opcode", opcode, 0xff);
    if (Object.hasOwn(table, opcode)) {
      throw new Error(`Duplicate opcode 0x${opcode.toString(16).padStart(2, "0")}.`);
    }
    table[opcode] = handler;
  }
  return table;
}

/** Bind a handler to a fixed encoding or aliases: 0/1 are fixed bits, x is ignored. */
export function opcodePattern<Handler>(pattern: string, handler: Handler): readonly OpcodeEntry<Handler>[] {
  return opcodeFamily(pattern, {}, () => handler);
}

/**
 * Expand an eight-bit pattern into handlers. Lowercase letters name selector fields;
 * x marks ignored bits. Each selector supplies every encoded value, in numeric order.
 * bind runs during construction; the returned handler performs instruction execution.
 */
export function opcodeFamily<const Choices extends Selectors, Handler>(
  pattern: string,
  selectors: Choices,
  bind: (selected: Selected<Choices>) => Handler,
): readonly OpcodeEntry<Handler>[] {
  const { fixed, variables, fields } = parsePattern(pattern);
  for (const name of Object.keys(selectors)) {
    if (!fields.has(name)) throw new Error(`Selector ${name} is absent from opcode pattern "${pattern}".`);
  }
  for (const [name, positions] of fields) {
    const values = Object.hasOwn(selectors, name) ? selectors[name] : undefined;
    if (!Array.isArray(values) || values.length !== 2 ** positions.length) {
      throw new Error(`Selector ${name} in opcode pattern "${pattern}" requires ${2 ** positions.length} values.`);
    }
    for (let index = 0; index < values.length; index++) {
      if (!Object.hasOwn(values, index)) {
        throw new Error(`Selector ${name} in opcode pattern "${pattern}" is missing value ${index}.`);
      }
    }
  }

  const entries: OpcodeEntry<Handler>[] = [];
  // Enumerate only the variable bits; fixed bits never enter the selector space.
  for (let combination = 0; combination < 2 ** variables.length; combination++) {
    let opcode = fixed;
    for (const [index, position] of variables.entries()) {
      const bit = (combination >>> (variables.length - 1 - index)) & 1;
      opcode |= bit << position;
    }
    const selected: Record<string, unknown> = {};
    for (const [name, positions] of fields) {
      let code = 0;
      // Field bits are read most significant first, including separated occurrences.
      for (const position of positions) code = (code << 1) | ((opcode >>> position) & 1);
      selected[name] = selectors[name]![code];
    }
    // The pattern and complete selector arrays were checked above. Each binding owns
    // its field map, so a handler can capture it without seeing a later combination.
    entries.push([opcode, bind(selected as Selected<Choices>)]);
  }
  return entries;
}

function parsePattern(pattern: string) {
  const bits = pattern.replace(/[\s_]/g, "");
  if (!/^[01a-z]{8}$/.test(bits)) {
    throw new Error(`Opcode pattern "${pattern}" must contain eight bits: 0, 1, or lowercase field letters.`);
  }
  let fixed = 0;
  const variables: number[] = [];
  const fields = new Map<string, number[]>();
  for (const [index, bit] of [...bits].entries()) {
    const position = 7 - index;
    if (bit === "1") fixed |= 1 << position;
    else if (bit !== "0") {
      variables.push(position);
      if (bit !== "x") {
        const positions = fields.get(bit) ?? [];
        positions.push(position);
        fields.set(bit, positions);
      }
    }
  }
  return { fixed, variables, fields };
}
