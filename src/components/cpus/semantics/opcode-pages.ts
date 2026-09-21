/** A prefix page can capture bytes before its final opcode, without executing a body. */
export type OpcodePage = number | {
  readonly prefix: number;
  readonly on?: string;
  readonly operands: readonly string[];
  readonly opcodeFetch: boolean;
};
export interface DecodedPage {
  readonly name: string;
  readonly prefix: number;
  readonly key: number;
  readonly on?: string;
  readonly operands: readonly string[];
  readonly opcodeFetch: boolean;
}

/** Validate the bounded two-prefix layout independently of the chapter parser. */
export function opcodePageLayouts(pages: Readonly<Record<string, OpcodePage>>): readonly DecodedPage[] {
  const result: DecodedPage[] = [], keys = new Set<number>();
  for (const [name, entry] of Object.entries(pages)) {
    const page = typeof entry === "number" ? { prefix: entry, operands: [], opcodeFetch: true } : entry;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || !Number.isInteger(page.prefix) || page.prefix < 1 || page.prefix > 255) {
      throw new Error("Opcode pages need identifier names and byte prefixes from $01 through $FF.");
    }
    const parent = page.on === undefined ? undefined : result.find(candidate => candidate.name === page.on);
    if (page.on !== undefined && (!parent || parent.on !== undefined || parent.operands.length)) {
      throw new Error("A nested opcode page needs an earlier, uncaptured root page.");
    }
    if (typeof page.opcodeFetch !== "boolean" || new Set(page.operands).size !== page.operands.length
      || page.operands.some(name => !/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || name === "opcode")) {
      throw new Error("Opcode page operands need distinct identifiers and an explicit opcode fetch kind.");
    }
    const key = (parent?.key ?? 0) * 256 + page.prefix;
    if (keys.has(key)) throw new Error("Duplicate opcode page prefix.");
    keys.add(key); result.push({ ...page, name, key });
  }
  return result;
}
