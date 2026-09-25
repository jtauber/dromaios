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
  if (/^u(?:3|8|14|16|32)$/.test(name)) {
    const bits = Number(name.slice(1));
    if (!isWidth(bits)) return tokens.fail("Unsupported literal width.");
    const result = literal(bits, tokens.number()); tokens.expect(")"); return result;
  }
  return operation(tokens, name, "numeric", numericOperations);
}

/** Flag expressions retain their type, including captured inputs to arithmetic and shifts. */
export function flagExpression(tokens: ChapterTokens): FlagExpression {
  if (tokens.take("0")) return flagLiteral(false);
  if (tokens.take("1")) return flagLiteral(true);
  const name = tokens.word();
  if (name === "true" || name === "false") tokens.fail("Write flag literals as 0 or 1.");
  if (!tokens.take("(")) return flagValue(name);
  return operation(tokens, name, "flag", flagOperations);
}

type Parser<T> = (tokens: ChapterTokens) => T;

function operation<T>(tokens: ChapterTokens, name: string, type: string, operations: Readonly<Record<string, Parser<T>>>): T {
  if (!Object.hasOwn(operations, name)) tokens.fail(`Unknown ${type} operation ${name}.`);
  const result = operations[name]!(tokens); tokens.expect(")"); return result;
}

function pair<T>(tokens: ChapterTokens, parse: Parser<T>): [T, T] {
  const left = parse(tokens); tokens.expect(","); return [left, parse(tokens)];
}

function arithmetic<T>(build: (left: NumberExpression, right: NumberExpression, incoming?: FlagExpression) => T): Parser<T> {
  return tokens => {
    const operands = pair(tokens, expression);
    return build(...operands, tokens.take(",") ? flagExpression(tokens) : undefined);
  };
}

function conversion(build: (contents: NumberExpression, width: Width) => NumberExpression): Parser<NumberExpression> {
  return tokens => { const contents = expression(tokens); tokens.expect(","); return build(contents, width(tokens)); };
}

function bitRange(tokens: ChapterTokens): [NumberExpression, number, number] {
  const contents = expression(tokens); tokens.expect(",");
  const high = tokens.number(); tokens.expect(","); return [contents, high, tokens.number()];
}

// Each table gives the argument grammar for one result type. In particular,
// and/or/xor parse numeric operands here and Boolean operands in flagOperations.
const numericOperations: Readonly<Record<string, Parser<NumberExpression>>> = {
  highByte: tokens => highByte(expression(tokens)), lowByte: tokens => lowByte(expression(tokens)),
  and: tokens => bitAnd(...pair(tokens, expression)), or: tokens => bitOr(...pair(tokens, expression)),
  xor: tokens => bitXor(...pair(tokens, expression)), concat: tokens => concat(...pair(tokens, expression)),
  add: arithmetic(addWrap), subtract: arithmetic(subtract),
  extend: conversion(extend), signExtend: conversion(signExtend), truncate: conversion(truncate),
  bits: tokens => bits(...bitRange(tokens)),
  withBits: tokens => { const range = bitRange(tokens); tokens.expect(","); return withBits(...range, expression(tokens)); },
  select: tokens => { const condition = flagExpression(tokens); tokens.expect(","); return select(condition, ...pair(tokens, expression)); },
  multiply: tokens => multiply(...pair(tokens, expression), tokens.take(",") ? signedness(tokens) : false),
  shiftLeft: tokens => { const contents = expression(tokens); tokens.expect(","); return shiftLeft(contents, flagExpression(tokens)); },
  shiftRight: tokens => { const contents = expression(tokens); tokens.expect(","); return shiftRight(contents, flagExpression(tokens)); },
  shiftBits: tokens => {
    const contents = expression(tokens); tokens.expect(","); const direction = tokens.word(); tokens.expect(",");
    if (direction !== "left" && direction !== "right") return tokens.fail("Shift direction must be left or right.");
    return shiftBits(contents, direction, tokens.number());
  },
};

const flagOperations: Readonly<Record<string, Parser<FlagExpression>>> = {
  not: tokens => not(flagExpression(tokens)),
  and: tokens => and(...pair(tokens, flagExpression)), or: tokens => or(...pair(tokens, flagExpression)),
  xor: tokens => xor(...pair(tokens, flagExpression)),
  negative: tokens => negative(expression(tokens)), zero: tokens => zero(expression(tokens)),
  lowBit: tokens => lowBit(expression(tokens)), evenParity: tokens => evenParity(expression(tokens)),
  carry: arithmetic(carry), borrow: arithmetic(borrow),
  halfCarry: arithmetic(halfCarry), halfBorrow: arithmetic(halfBorrow), addOverflow: arithmetic(addOverflow), overflow: arithmetic(overflow),
  bit: tokens => { const contents = expression(tokens); tokens.expect(","); return bit(contents, tokens.number()); },
  equal: tokens => equal(...pair(tokens, expression)),
  lessThan: tokens => { const operands = pair(tokens, expression); tokens.expect(","); return lessThan(...operands, signedness(tokens)); },
};

/** Physical projection preserves the distinction between logical words and bus addresses. */
export function address(tokens: ChapterTokens): AddressExpression {
  if (tokens.next !== "projectAddress") return expression(tokens);
  tokens.expect("projectAddress"); tokens.expect("(");
  const base = expression(tokens); tokens.expect(","); const offset = expression(tokens); tokens.expect(",");
  const shift = tokens.number(); tokens.expect(","); const bits = tokens.number(); tokens.expect(")");
  return projectAddress(base, offset, shift, bits);
}

/** Ordered typed inputs shared by sources, actions, policies, and instruction families. */
export function parameters(tokens: ChapterTokens, required = false): Record<string, ValueType> {
  const inputs: Record<string, ValueType> = {};
  if (required) tokens.expect("(");
  else if (!tokens.take("(")) return inputs;
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
