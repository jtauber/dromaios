import { addWrap, bitAnd, bitOr, bitXor, borrow, carry, concat, evenParity, extend, flagLiteral,
  flagValue, halfBorrow, halfCarry, highByte, isWidth, literal, lowBit, lowByte, negative, not, shiftLeft, shiftRight,
  subtract, truncate, value, zero } from "../model.ts";
import type { FlagExpression, NumberExpression, Width } from "../model.ts";
import type { ChapterTokens } from "./document.ts";

export function width(tokens: ChapterTokens): Width {
  const bits = tokens.number();
  return isWidth(bits) ? bits : tokens.fail("Expected width 3, 8, 14, 16, or 32.");
}

/** Numeric expressions use captures only; state reads are separate ordered statements. */
export function expression(tokens: ChapterTokens): NumberExpression {
  const name = tokens.word();
  if (!tokens.take("(")) return value(name);
  let result: NumberExpression;
  if (/^u(?:3|8|14|16|32)$/.test(name)) {
    const bits = Number(name.slice(1));
    if (!isWidth(bits)) return tokens.fail("Unsupported literal width.");
    result = literal(bits, tokens.number());
  } else if (name === "highByte" || name === "lowByte") {
    result = (name === "highByte" ? highByte : lowByte)(expression(tokens));
  } else if (name === "extend" || name === "truncate") {
    const contents = expression(tokens); tokens.expect(",");
    result = (name === "extend" ? extend : truncate)(contents, width(tokens));
  } else if (name === "shiftLeft" || name === "shiftRight") {
    const contents = expression(tokens); tokens.expect(",");
    result = (name === "shiftLeft" ? shiftLeft : shiftRight)(contents, flagExpression(tokens));
  } else if (name === "add" || name === "subtract") {
    const left = expression(tokens); tokens.expect(","); const right = expression(tokens);
    const incoming = tokens.take(",") ? flagExpression(tokens) : undefined;
    result = (name === "add" ? addWrap : subtract)(left, right, incoming);
  } else {
    const operations = { and: bitAnd, or: bitOr, xor: bitXor, concat };
    if (!Object.hasOwn(operations, name)) tokens.fail(`Unknown numeric operation ${name}.`);
    const left = expression(tokens); tokens.expect(",");
    result = operations[name as keyof typeof operations](left, expression(tokens));
  }
  tokens.expect(")"); return result;
}

/** Flag expressions retain their type, including captured inputs to arithmetic and shifts. */
export function flagExpression(tokens: ChapterTokens): FlagExpression {
  if (tokens.take("0")) return flagLiteral(false);
  if (tokens.take("1")) return flagLiteral(true);
  const name = tokens.word();
  if (name === "true" || name === "false") tokens.fail("Write flag literals as 0 or 1.");
  if (!tokens.take("(")) return flagValue(name);
  let result: FlagExpression;
  if (name === "not") result = not(flagExpression(tokens));
  else if (["carry", "borrow", "halfCarry", "halfBorrow"].includes(name)) {
    const left = expression(tokens); tokens.expect(","); const right = expression(tokens);
    const incoming = tokens.take(",") ? flagExpression(tokens) : undefined;
    const operation = { carry, borrow, halfCarry, halfBorrow }[name as "carry" | "borrow" | "halfCarry" | "halfBorrow"];
    result = operation(left, right, incoming);
  } else {
    const operations = { negative, zero, lowBit, evenParity };
    if (!Object.hasOwn(operations, name)) tokens.fail(`Unknown flag operation ${name}.`);
    result = operations[name as keyof typeof operations](expression(tokens));
  }
  tokens.expect(")"); return result;
}
