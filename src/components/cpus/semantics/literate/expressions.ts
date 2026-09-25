import { addOverflow, addWrap, and, or, xor, select, bit, bits, bitAnd, bitOr, bitXor, borrow, carry, concat, evenParity, extend, flagLiteral,
  equal, flagValue, halfBorrow, halfCarry, highByte, isWidth, lessThan, literal, lowBit, lowByte, multiply, negative, not, shiftLeft, shiftRight,
  overflow, pack, projectAddress, shiftBits, signExtend, subtract, truncate, value, withBits, zero } from "../model.ts";
import type { AddressExpression, Expression, FlagExpression, NumberExpression, ValueType, Width } from "../model.ts";
import type { ChapterTokens } from "./document.ts";

export function width(tokens: ChapterTokens): Width {
  if (tokens.widthParameter && tokens.take(tokens.widthParameter.name)) return tokens.widthParameter.value;
  const bits = tokens.number();
  return isWidth(bits) ? bits : tokens.fail("Expected width 3, 8, 14, 16, or 32.");
}

/** Width arguments select checked definitions, independently of runtime value arguments. */
export function definitionReference<T>(tokens: ChapterTokens, definitions: ReadonlyMap<string, T>): T {
  const column = tokens.column;
  let name = tokens.word();
  if (tokens.take("<")) { name += `<${width(tokens)}>`; tokens.expect(">"); }
  return definitions.get(name) ?? tokens.fail(`Unknown name ${name}; declare it before use.`, column);
}

export const valueType = (tokens: ChapterTokens): ValueType => tokens.take("flag") ? "flag" : width(tokens);
export const typedExpression = (tokens: ChapterTokens, type: ValueType): Expression => type === "flag" ? flagExpression(tokens) : expression(tokens);
export const reference = (name: string, type: ValueType): Expression => type === "flag" ? flagValue(name) : value(name);
export const initialValue = (type: ValueType): Expression => type === "flag" ? flagLiteral(false) : literal(type, 0);

/** Numeric expressions use captures only; state reads are separate ordered statements. */
export function expression(tokens: ChapterTokens): NumberExpression {
  const name = tokens.word();
  if (name === "u" && tokens.take("<")) {
    const bits = width(tokens); tokens.expect(">"); tokens.expect("(");
    const result = literal(bits, tokens.number()); tokens.expect(")"); return result;
  }
  if (name === "pack" && tokens.take("<")) {
    const bits = width(tokens); tokens.expect(">"); tokens.expect("(");
    const flags: FlagExpression[] = [];
    if (!tokens.take(")")) {
      do { flags.push(flagExpression(tokens)); } while (tokens.take(","));
      tokens.expect(")");
    }
    return pack(bits, flags);
  }
  if (!tokens.take("(")) return value(name);
  let result: NumberExpression;
  if (/^u(?:3|8|14|16|32)$/.test(name)) {
    const bits = Number(name.slice(1));
    if (!isWidth(bits)) return tokens.fail("Unsupported literal width.");
    result = literal(bits, tokens.number());
  } else if (name === "select") {
    const condition = flagExpression(tokens); tokens.expect(",");
    const yes = expression(tokens); tokens.expect(",");
    result = select(condition, yes, expression(tokens));
  } else if (name === "highByte" || name === "lowByte") {
    result = (name === "highByte" ? highByte : lowByte)(expression(tokens));
  } else if (name === "bits" || name === "withBits") {
    const contents = expression(tokens); tokens.expect(","); const high = tokens.number(); tokens.expect(",");
    const low = tokens.number();
    if (name === "bits") result = bits(contents, high, low);
    else { tokens.expect(","); result = withBits(contents, high, low, expression(tokens)); }
  } else if (["extend", "signExtend", "truncate"].includes(name)) {
    const contents = expression(tokens); tokens.expect(",");
    const operations = { extend, signExtend, truncate };
    result = operations[name as keyof typeof operations](contents, width(tokens));
  } else if (name === "shiftBits") {
    const contents = expression(tokens); tokens.expect(","); const direction = tokens.word(); tokens.expect(",");
    if (direction !== "left" && direction !== "right") tokens.fail("Shift direction must be left or right.");
    result = shiftBits(contents, direction, tokens.number());
  } else if (name === "shiftLeft" || name === "shiftRight") {
    const contents = expression(tokens); tokens.expect(",");
    result = (name === "shiftLeft" ? shiftLeft : shiftRight)(contents, flagExpression(tokens));
  } else if (name === "add" || name === "subtract") {
    const left = expression(tokens); tokens.expect(","); const right = expression(tokens);
    const incoming = tokens.take(",") ? flagExpression(tokens) : undefined;
    result = (name === "add" ? addWrap : subtract)(left, right, incoming);
  } else if (name === "multiply") {
    const left = expression(tokens); tokens.expect(","); const right = expression(tokens);
    result = multiply(left, right, tokens.take(",") ? signedness(tokens) : false);
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
  else if (name === "and" || name === "or" || name === "xor") {
    const left = flagExpression(tokens); tokens.expect(",");
    result = { and, or, xor }[name](left, flagExpression(tokens));
  } else if (name === "equal" || name === "lessThan") {
    const left = expression(tokens); tokens.expect(","); const right = expression(tokens);
    if (name === "equal") result = equal(left, right);
    else { tokens.expect(","); result = lessThan(left, right, signedness(tokens)); }
  } else if (name === "bit") {
    const contents = expression(tokens); tokens.expect(",");
    result = bit(contents, tokens.number());
  } else if (["carry", "borrow", "halfCarry", "halfBorrow", "addOverflow", "overflow"].includes(name)) {
    const left = expression(tokens); tokens.expect(","); const right = expression(tokens);
    const incoming = tokens.take(",") ? flagExpression(tokens) : undefined;
    const operations = { carry, borrow, halfCarry, halfBorrow, addOverflow, overflow };
    const operation = operations[name as keyof typeof operations];
    result = operation(left, right, incoming);
  } else {
    const operations = { negative, zero, lowBit, evenParity };
    if (!Object.hasOwn(operations, name)) tokens.fail(`Unknown flag operation ${name}.`);
    result = operations[name as keyof typeof operations](expression(tokens));
  }
  tokens.expect(")"); return result;
}

/** Physical projection preserves the distinction between logical words and bus addresses. */
export function address(tokens: ChapterTokens): AddressExpression {
  if (tokens.next !== "projectAddress") return expression(tokens);
  tokens.expect("projectAddress"); tokens.expect("(");
  const base = expression(tokens); tokens.expect(","); const offset = expression(tokens); tokens.expect(",");
  const shift = tokens.number(); tokens.expect(","); const bits = tokens.number(); tokens.expect(")");
  return projectAddress(base, offset, shift, bits);
}

/** Ordered typed inputs shared by sources, actions, policies, and instruction families. */
export function parameters(tokens: ChapterTokens): Record<string, ValueType> {
  const inputs: Record<string, ValueType> = {};
  if (!tokens.take("(")) return inputs;
  if (tokens.next !== ")") do {
    const name = tokens.word(); tokens.expect(":");
    if (Object.hasOwn(inputs, name)) tokens.fail(`Duplicate parameter ${name}.`);
    inputs[name] = valueType(tokens);
  } while (tokens.take(","));
  tokens.expect(")"); return inputs;
}

/** Argument types come from the declaration, including ambiguous and/or/xor calls. */
export function callArguments(tokens: ChapterTokens, inputs: Readonly<Record<string, ValueType>> = {}): Record<string, Expression> {
  tokens.expect("(");
  const args: Record<string, Expression> = {};
  for (const [index, [name, type]] of Object.entries(inputs).entries()) {
    if (index) tokens.expect(",");
    args[name] = typedExpression(tokens, type);
  }
  tokens.expect(")"); return args;
}

/** Signedness belongs to the operation; captured numbers retain their bit widths. */
export function signedness(tokens: ChapterTokens): boolean {
  const mode = tokens.word();
  if (mode !== "signed" && mode !== "unsigned") tokens.fail("Expected signed or unsigned.");
  return mode === "signed";
}
