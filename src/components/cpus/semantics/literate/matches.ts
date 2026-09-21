import { opcodeFamily } from "../../opcodes.ts";
import { literal } from "../model.ts";
import type { MatchCase, Statement } from "../model.ts";
import { chapterBody, ChapterTokens } from "./document.ts";
import { expression, width } from "./expressions.ts";
import type { ChapterOperand } from "./statements.ts";

/** Match captured bytes, expanding catalogue selectors while keeping ignored bits masked. */
export function chapterMatch(header: ChapterTokens, lines: readonly ChapterTokens[], name: string,
  catalogues: ReadonlyMap<string, readonly ChapterOperand[]>, operands: ReadonlyMap<string, ChapterOperand>,
  parse: (lines: readonly ChapterTokens[], operands: ReadonlyMap<string, ChapterOperand>, check: (steps: readonly Statement[]) => void) => Statement[],
  check: (step: Statement) => void): Statement {
  const selector = expression(header); header.expect(":"); const bits = width(header);
  header.expect("{"); header.end();
  const cases: MatchCase[] = [];
  const statement = (): Extract<Statement, { kind: "match" }> => ({ kind: "match", name, selector, width: bits, cases });
  const fallback = lines.at(-1) ?? header.fail("A match needs cases and otherwise unsupported.");
  fallback.expect("otherwise"); fallback.expect("unsupported"); fallback.end();
  for (let index = 0; index < lines.length - 1; index++) {
    const tokens = lines[index]!; tokens.expect("case");
    const pattern = tokens.quoted(), compact = pattern.replace(/[\s_]/g, "");
    if (compact.length !== 8) tokens.fail("A byte match pattern must have eight bits.");
    const selectors: Record<string, readonly ChapterOperand[]> = {};
    if (tokens.take("for")) do {
      const field = tokens.word(); tokens.expect("in");
      if (Object.hasOwn(selectors, field) || operands.has(field)) tokens.fail(`Duplicate or shadowed match selector ${field}.`);
      selectors[field] = tokens.lookup(catalogues);
    } while (tokens.take(","));
    tokens.expect("{"); tokens.end();
    const { body, end } = chapterBody(lines, index); index = end;
    const entries = tokens.checked(() => opcodeFamily(pattern, selectors, selected => selected));
    const mask = parseInt([...compact].map(bit => bit === "x" ? "0" : "1").join(""), 2);
    const seen = new Set<number>();
    for (const [opcode, selected] of entries) {
      const value = opcode & mask;
      if (seen.has(value)) continue;
      seen.add(value);
      const branch = body.map(line => new ChapterTokens(line.source, line.file));
      const last = branch.pop() ?? tokens.fail("A match case must end with return.");
      if (last.next !== "return") last.fail("A match case must end with return.");
      const current: MatchCase = { mask, value, steps: [], result: literal(bits, 0) };
      cases.push(current);
      tokens.checked(() => check(statement())); // Reject overlapping encodings before parsing their effects.
      const checkBody = (steps: readonly Statement[]) => check({ ...statement(), cases: [...cases.slice(0, -1), { ...current, steps }] });
      const steps = parse(branch, new Map([...operands, ...Object.entries(selected)]), checkBody);
      last.expect("return"); const result = expression(last); last.end();
      cases[cases.length - 1] = { ...current, steps, result };
      last.checked(() => check(statement()));
    }
  }
  header.checked(() => check(statement()));
  return statement();
}
