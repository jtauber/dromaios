import { literal } from "../model.ts";
import type { Statement, ValueBranch } from "../model.ts";
import { chapterBody } from "./document.ts";
import type { ChapterTokens } from "./document.ts";
import { expression, flagExpression, width } from "./expressions.ts";

/** A conditional value evaluates exactly one branch, without an implicit rejection. */
export function chapterChoose(header: ChapterTokens, lines: readonly ChapterTokens[], name: string,
  parse: (lines: readonly ChapterTokens[], check: (steps: readonly Statement[]) => void) => Statement[],
  check: (step: Statement) => void): Statement {
  const condition = flagExpression(header); header.expect(":"); const bits = width(header);
  header.expect("{"); header.end();
  const branches: ValueBranch[] = [0, 1].map(() => ({ steps: [], result: literal(bits, 0) }));
  const statement = (): Statement => ({ kind: "choose", name, condition, width: bits, yes: branches[0]!, no: branches[1]! });
  header.checked(() => check(statement()));
  let index = 0;
  for (const [slot, label] of ["then", "else"].entries()) {
    const tokens = lines[index] ?? header.fail(`A conditional value needs a ${label} branch.`);
    tokens.expect(label); tokens.expect("{"); tokens.end();
    const { body, end } = chapterBody(lines, index); index = end + 1;
    const last = body.pop() ?? tokens.fail("A conditional branch must end with return.");
    if (last.next !== "return") last.fail("A conditional branch must end with return.");
    const steps = parse(body, steps => { branches[slot] = { steps, result: literal(bits, 0) }; check(statement()); });
    last.expect("return"); const result = expression(last); last.end();
    branches[slot] = { steps, result };
    last.checked(() => check(statement()));
  }
  if (index !== lines.length) lines[index]!.fail("A conditional value has exactly then and else branches.");
  return statement();
}
