import { flagValue, iterateTogether, value } from "../model.ts";
import type { IterationValue, Statement } from "../model.ts";
import { chapterBody } from "./document.ts";
import type { ChapterTokens } from "./document.ts";
import { expression, flagExpression, width } from "./expressions.ts";

/** Typed locals advance together; initial expressions see only the enclosing scope. */
export function chapterIteration(header: ChapterTokens, lines: readonly ChapterTokens[],
  parse: (lines: readonly ChapterTokens[], check: (steps: readonly Statement[]) => void) => Statement[],
  check: (step: Statement) => void): Statement {
  header.expect("iterate"); header.expect("("); const count = expression(header);
  header.expect(")"); header.expect("{"); header.end();
  const values: Record<string, IterationValue> = {};
  let index = 0;
  for (; index < lines.length && !(lines[index]!.next === "step" && lines[index]!.peek(1) === "{"); index++) {
    const tokens = lines[index]!, name = tokens.word(); tokens.expect(":");
    if (Object.hasOwn(values, name)) tokens.fail(`Duplicate iteration value ${name}.`);
    const type = tokens.take("flag") ? "flag" : width(tokens);
    tokens.expect("="); const initial = type === "flag" ? flagExpression(tokens) : expression(tokens); tokens.end();
    values[name] = { type, initial, next: type === "flag" ? flagValue(name) : value(name) };
    tokens.checked(() => check(iterateTogether(count, values, [])));
  }
  const step = lines[index] ?? header.fail("An iteration needs a step block.");
  step.expect("step"); step.expect("{"); step.end();
  header.checked(() => check(iterateTogether(count, values, [])));
  const { body, end } = chapterBody(lines, index);
  if (end + 1 !== lines.length) lines[end + 1]!.fail("An iteration ends after its step block.");
  // Only trailing next clauses declare updates; an ordinary capture may still be named next.
  let updates = body.length;
  while (updates && body[updates - 1]!.next === "next" && body[updates - 1]!.peek(1) !== "=") updates--;
  const steps = parse(body.slice(0, updates), steps => check(iterateTogether(count, values, steps)));
  const supplied = new Set<string>();
  for (const tokens of body.slice(updates)) {
    tokens.expect("next"); const name = tokens.word();
    if (!Object.hasOwn(values, name)) tokens.fail(`Unknown iteration value ${name}.`);
    if (supplied.has(name)) tokens.fail(`Duplicate next value ${name}.`);
    supplied.add(name); tokens.expect("=");
    const previous = values[name]!;
    values[name] = { ...previous, next: previous.type === "flag" ? flagExpression(tokens) : expression(tokens) };
    tokens.end(); tokens.checked(() => check(iterateTogether(count, values, steps)));
  }
  for (const name of Object.keys(values)) if (!supplied.has(name)) step.fail(`Missing next value ${name}.`);
  return iterateTogether(count, values, steps);
}
