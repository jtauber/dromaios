export interface Token { readonly text: string; readonly offset: number }

/** Token reading and source diagnostics shared by state and composition declarations. */
export function machineSyntax(source: string, filename: string) {
  // Keep atoms whole: malformed values such as FF, or 0x12oops cannot parse in part.
  const tokens = source.matchAll(/\/\/[^\r\n]*|\s+|[{}=\[\]]|[^\s{}=\[\]/]+|\//g);
  function nextToken(): Token {
    for (let next = tokens.next(); !next.done; next = tokens.next()) {
      const match = next.value;
      if (/^(?:\s|\/\/)/.test(match[0])) continue;
      return { text: match[0], offset: match.index };
    }
    return { text: "", offset: source.length };
  }
  let current = nextToken();

  function fail(token: Token, message: string): never {
    const lines = source.slice(0, token.offset).split(/\r\n|\r|\n/);
    const prefix = lines.at(-1) ?? "";
    const line = prefix + source.slice(token.offset).split(/\r\n|\r|\n/, 1)[0];
    const caret = prefix.replace(/[^\t]/g, " ") + "^";
    throw new SyntaxError(`${filename}:${lines.length}:${prefix.length + 1}: ${message}\n${line}\n${caret}`);
  }
  function take(): Token {
    const token = current;
    current = nextToken();
    return token;
  }
  function expect(text: string): Token {
    if (current.text !== text) fail(current, `Expected ${JSON.stringify(text)}, found ${describe(current)}`);
    return take();
  }
  function describe(token: Token): string {
    return token.text === "" ? "end of file" : JSON.stringify(token.text);
  }
  function readNumber(token: Token, label: string, maximum: number): number {
    const match = /^(?:0[xX]([\da-fA-F]+)|\$([\da-fA-F]+)|([\d][\da-fA-F]*)[hH]|([\da-fA-F]+))$/.exec(token.text);
    const digits = match?.slice(1).find(value => value !== undefined);
    if (digits === undefined) fail(token, `Expected a hexadecimal value for ${label}, found ${describe(token)}`);
    const value = Number.parseInt(digits, 16);
    if (!Number.isSafeInteger(value) || value > maximum) {
      fail(token, `${label} must be in 0..${maximum.toString(16).toUpperCase()} (hexadecimal)`);
    }
    return value;
  }
  function readByte(token: Token): number {
    if (!/^[\da-fA-F]{2}$/.test(token.text)) fail(token, `Expected a two-digit hexadecimal byte, found ${describe(token)}`);
    return Number.parseInt(token.text, 16);
  }
  return { current: () => current, take, expect, fail, describe, readNumber, readByte };
}

export type MachineSyntax = ReturnType<typeof machineSyntax>;
