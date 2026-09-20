export interface ChapterLine { readonly text: string; readonly line: number }
export interface ChapterBlock { readonly lines: readonly ChapterLine[]; readonly explanation: string }

/** Diagnostics retain positions in the Markdown, including prose and unrelated code fences. */
export class ChapterError extends Error {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  constructor(file: string, line: number, column: number, message: string) {
    super(`${file}:${line}:${column}: ${message}`);
    this.name = "ChapterError";
    this.file = file; this.line = line; this.column = column;
  }
}

/** Only unindented `cpu` fences are executable. The preceding paragraph describes a family. */
export function chapterBlocks(markdown: string, file: string): readonly ChapterBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n"), blocks: ChapterBlock[] = [];
  let paragraph: string[] = [], preceding: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index]!;
    const fence = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(text);
    if (!fence) {
      if (text.trim() === "") { if (paragraph.length) preceding = paragraph; paragraph = []; }
      else if (/^#{1,6} /.test(text)) { paragraph = []; preceding = []; }
      else paragraph.push(text.trim());
      continue;
    }
    const marker = fence[2]!, executable = fence[1] === "" && fence[3]!.trim() === "cpu", start = index + 1;
    const body: ChapterLine[] = [];
    while (++index < lines.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[index]!)) {
      body.push({ text: lines[index]!, line: index + 1 });
    }
    if (index === lines.length && executable) throw new ChapterError(file, start, 1, "Unclosed cpu fence.");
    if (executable) blocks.push({ lines: body, explanation: (paragraph.length ? paragraph : preceding).join(" ") });
    paragraph = []; preceding = [];
  }
  return blocks;
}

interface Token { readonly text: string; readonly column: number }

/** A statement occupies one line; expressions use explicit calls instead of implicit precedence. */
export class ChapterTokens {
  readonly #tokens: Token[] = [];
  #index = 0;
  readonly source: ChapterLine;
  readonly file: string;
  constructor(source: ChapterLine, file: string) {
    this.source = source; this.file = file;
    const pattern = /\s+|\/\/.*|"(?:[^"\\]|\\.)*"|[A-Za-z][A-Za-z0-9_]*|\$[\da-fA-F]+|\d+|<-|[{}\[\]():=.,]/y;
    let offset = 0;
    while (offset < source.text.length) {
      pattern.lastIndex = offset;
      const match = pattern.exec(source.text);
      if (!match) this.fail("Unexpected character.", offset + 1);
      const text = match[0];
      if (!/^\s|^\/\//.test(text)) this.#tokens.push({ text, column: offset + 1 });
      offset = pattern.lastIndex;
    }
  }
  get next(): string | undefined { return this.#tokens[this.#index]?.text; }
  peek(offset: number): string | undefined { return this.#tokens[this.#index + offset]?.text; }
  get opensBlock(): boolean { return this.#tokens.at(-1)?.text === "{"; }
  get column(): number { return this.#tokens[this.#index]?.column ?? this.source.text.length + 1; }
  fail(message: string, column = this.column): never { throw new ChapterError(this.file, this.source.line, column, message); }
  take(text: string): boolean { if (this.next !== text) return false; this.#index++; return true; }
  expect(text: string): void { if (!this.take(text)) this.fail(`Expected ${JSON.stringify(text)}.`); }
  word(): string {
    const text = this.next;
    if (text === undefined || !/^[A-Za-z][A-Za-z0-9_]*$/.test(text)) return this.fail("Expected a name.");
    this.#index++; return text;
  }
  quoted(): string {
    const text = this.next;
    if (!text?.startsWith('"')) return this.fail("Expected a quoted description.");
    let result: string;
    try { result = JSON.parse(text) as string; } catch { return this.fail("Invalid quoted string."); }
    this.#index++; return result;
  }
  digits(): string {
    const text = this.next;
    if (text === undefined || !/^(?:\d+|\$[\da-fA-F]+)$/.test(text)) return this.fail("Expected a decimal number or $hex value.");
    this.#index++; return text;
  }
  number(): number { const text = this.digits(); return text.startsWith("$") ? parseInt(text.slice(1), 16) : Number(text); }
  end(): void { if (this.next !== undefined) this.fail("Unexpected trailing input."); }

  lookup<T>(table: ReadonlyMap<string, T>): T {
    const column = this.column, name = this.word();
    return table.get(name) ?? this.fail(`Unknown name ${name}; declare it before use.`, column);
  }

  checked<T>(operation: () => T): T {
    try { return operation(); } catch (error) {
      if (error instanceof ChapterError) throw error;
      return this.fail(error instanceof Error ? error.message : String(error), 1);
    }
  }
}

/** Keep nested blocks intact; braces inside quoted text and comments are ordinary tokens. */
export function chapterBody(lines: readonly ChapterTokens[], start: number): { body: ChapterTokens[]; end: number } {
  let depth = 1;
  for (let end = start + 1; end < lines.length; end++) {
    const tokens = lines[end]!;
    if (tokens.next === "}" && --depth === 0) {
      tokens.expect("}"); tokens.end();
      return { body: lines.slice(start + 1, end), end };
    }
    if (tokens.opensBlock) depth++;
  }
  return lines[start]!.fail("Expected a closing } in this cpu fence.");
}
