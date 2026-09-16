import { checkUnsigned } from "../validation.ts";

export type OpcodeEntry<Handler> = readonly [opcode: number, handler: Handler];
type Selectors = Readonly<Record<string, readonly unknown[]>>;
type Selected<Choices extends Selectors> = {
  readonly [Field in keyof Choices]: Choices[Field][number];
};

interface CompiledPattern {
  /** Number of selector values required by each named field. */
  readonly fields: ReadonlyMap<string, number>;
  readonly encodings: readonly {
    readonly opcode: number;
    readonly codes: readonly (readonly [name: string, code: number])[];
  }[];
}

// Only encoding data is shared. Selector values, bindings, and handlers belong to each caller.
const compiledPatterns = new Map<string, CompiledPattern>();

/** Construct an opcode table, rejecting duplicate entries even if their handlers agree. */
export function opcodeTable<Handler>(
  entries: readonly OpcodeEntry<Handler>[],
  width: 8 | 16 = 8,
): Readonly<Partial<Record<number, Handler>>> {
  if (width !== 8 && width !== 16) throw new RangeError("Opcode width must be 8 or 16 bits.");
  const table: Partial<Record<number, Handler>> = {};
  for (const [opcode, handler] of entries) {
    checkUnsigned("opcode", opcode, 2 ** width - 1);
    if (Object.hasOwn(table, opcode)) {
      throw new Error(`Duplicate opcode 0x${opcode.toString(16).padStart(width / 4, "0")}.`);
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
 * Expand an eight- or sixteen-bit pattern into handlers. Lowercase letters name selector fields;
 * x marks ignored bits. Each selector supplies every encoded value, in numeric order.
 * bind runs during construction; the returned handler performs instruction execution.
 */
export function opcodeFamily<const Choices extends Selectors, Handler>(
  pattern: string,
  selectors: Choices,
  bind: (selected: Selected<Choices>) => Handler,
): readonly OpcodeEntry<Handler>[] {
  const { fields, encodings } = compilePattern(pattern);
  for (const name of Object.keys(selectors)) {
    if (!fields.has(name)) throw new Error(`Selector ${name} is absent from opcode pattern "${pattern}".`);
  }
  for (const [name, count] of fields) {
    const values = Object.hasOwn(selectors, name) ? selectors[name] : undefined;
    if (!Array.isArray(values) || values.length !== count) {
      throw new Error(`Selector ${name} in opcode pattern "${pattern}" requires ${count} values.`);
    }
    for (let index = 0; index < values.length; index++) {
      if (!Object.hasOwn(values, index)) {
        throw new Error(`Selector ${name} in opcode pattern "${pattern}" is missing value ${index}.`);
      }
    }
  }

  return encodings.map(({ opcode, codes }) => {
    const selected: Record<string, unknown> = {};
    for (const [name, code] of codes) selected[name] = selectors[name]![code];
    // Each binding owns its field map, even when multiple opcodes select the same values.
    return [opcode, bind(selected as Selected<Choices>)];
  });
}

function compilePattern(pattern: string): CompiledPattern {
  const cached = compiledPatterns.get(pattern);
  if (cached) return cached;
  const { fixed, variables, fields } = parsePattern(pattern);
  const encodings = [];
  // Enumerate only the variable bits; fixed bits never enter the selector space.
  for (let combination = 0; combination < 2 ** variables.length; combination++) {
    let opcode = fixed;
    for (const [index, position] of variables.entries()) {
      const bit = (combination >>> (variables.length - 1 - index)) & 1;
      opcode |= bit << position;
    }
    const codes: [string, number][] = [];
    for (const [name, positions] of fields) {
      let code = 0;
      // Field bits are read most significant first, including separated occurrences.
      for (const position of positions) code = (code << 1) | ((opcode >>> position) & 1);
      codes.push([name, code]);
    }
    encodings.push({ opcode, codes });
  }
  const compiled = { fields: new Map([...fields].map(([name, positions]) => [name, 2 ** positions.length])), encodings };
  compiledPatterns.set(pattern, compiled);
  return compiled;
}

function parsePattern(pattern: string) {
  const bits = pattern.replace(/[\s_]/g, "");
  if (!/^(?:[01a-z]{8}|[01a-z]{16})$/.test(bits)) {
    throw new Error(`Opcode pattern "${pattern}" must contain eight bits or sixteen bits: 0, 1, or lowercase field letters.`);
  }
  let fixed = 0;
  const variables: number[] = [];
  const fields = new Map<string, number[]>();
  for (const [index, bit] of [...bits].entries()) {
    const position = bits.length - 1 - index;
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
