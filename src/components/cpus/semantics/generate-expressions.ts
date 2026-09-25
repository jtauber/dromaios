import type { AddressExpression, ArithmeticOperands, Expression, ValueType, Width } from "./model.ts";

/** Generated code paired with the value type established by semantic validation. */
export interface EmittedValue { readonly code: string; readonly type: ValueType }
type EmittedNumber = EmittedValue & { readonly type: Width };
export type ExpressionScope = ReadonlyMap<string, EmittedValue>;
const unsigned = (code: string, width: Width): string => width === 32 ? `(${code} >>> 0)` : code;
const signed = (operand: EmittedNumber): string => `((${operand.code} ^ ${2 ** (operand.type - 1)}) - ${2 ** (operand.type - 1)})`;
/** Interpret emitted bits as an integer for multiplication, comparison, or division. */
export const integer = (operand: EmittedNumber, isSigned: boolean): string => !isSigned ? operand.code
  : operand.type === 32 ? `(${operand.code} | 0)` : signed(operand);

/** Render validated expressions from captured values, collecting the required ALU imports. */
export function expressionEmitter(helpers: Set<string>) {
  const helper = (name: string): string => { helpers.add(name); return name; };
  function number(expr: Expression, scope: ExpressionScope): EmittedNumber {
    switch (expr.kind) {
      case "select": {
        const yes = number(expr.yes, scope), no = number(expr.no, scope);
        return { code: `((${flag(expr.condition, scope)}) ? ${yes.code} : ${no.code})`, type: yes.type };
      }
      case "value": return scope.get(expr.name)! as EmittedNumber; // Validation has resolved names and types.
      case "literal": return { code: `0x${expr.value.toString(16)}`, type: expr.width };
      case "pack": {
        // Disjoint positive weights also keep bit 31 unsigned, without host bitwise coercion.
        const terms = expr.bits.map((bit, index) => `((${flag(bit, scope)}) ? 0x${(2 ** (expr.width - index - 1)).toString(16)} : 0)`);
        return { code: `(${terms.join(" + ")})`, type: expr.width };
      }
      case "high-byte": return { code: `(${number(expr.value, scope).code} >>> 8)`, type: 8 };
      case "low-byte": return { code: `(${number(expr.value, scope).code} & 0xff)`, type: 8 };
      case "bits": {
        const width = (expr.high - expr.low + 1) as Width; // Validation checks the range and resulting width.
        const shifted = `(${number(expr.value, scope).code} >>> ${expr.low})`;
        return { code: width === 32 ? shifted : `(${shifted} & 0x${(2 ** width - 1).toString(16)})`, type: width };
      }
      case "with-bits": {
        const original = number(expr.value, scope), replacement = number(expr.replacement, scope);
        // Arithmetic mask construction also covers fields containing bit 31.
        const fieldMask = (2 ** (expr.high - expr.low + 1) - 1) * 2 ** expr.low;
        const preservedMask = 2 ** original.type - 1 - fieldMask;
        const code = `((${original.code} & 0x${preservedMask.toString(16)}) | (${replacement.code} << ${expr.low}))`;
        return { code: unsigned(code, original.type), type: original.type };
      }
      case "extend": return { code: number(expr.value, scope).code, type: expr.width };
      case "truncate": return { code: `(${number(expr.value, scope).code} & 0x${(2 ** expr.width - 1).toString(16)})`, type: expr.width };
      case "sign-extend": {
        const operand = number(expr.value, scope);
        return { code: expr.width === 32 ? `(${signed(operand)} >>> 0)` : `(${signed(operand)} & ${2 ** expr.width - 1})`, type: expr.width };
      }
      case "shift-left": case "shift-right": {
        const operand = number(expr.value, scope), operation = helper(expr.kind === "shift-left" ? "shiftLeft" : "shiftRight");
        return { code: `${operation}(${operand.type}, ${operand.code}, (${flag(expr.incoming, scope)}) ? 1 : 0).result`, type: operand.type };
      }
      case "shift-bits": {
        const operand = number(expr.value, scope);
        return { code: expr.count === 32 ? "0" : expr.direction === "right" ? `(${operand.code} >>> ${expr.count})`
          : operand.type === 32 ? `((${operand.code} << ${expr.count}) >>> 0)`
          : `((${operand.code} << ${expr.count}) & 0x${(2 ** operand.type - 1).toString(16)})`, type: operand.type };
      }
      case "bit-and": case "bit-or": case "bit-xor": {
        const left = number(expr.left, scope), right = number(expr.right, scope);
        const operator = { "bit-and": "&", "bit-or": "|", "bit-xor": "^" }[expr.kind];
        const code = `(${left.code} ${operator} ${right.code})`;
        return { code: unsigned(code, left.type), type: left.type };
      }
      case "concat": {
        const high = number(expr.left, scope), low = number(expr.right, scope);
        return high.type === 8 ? { code: `((${high.code} << 8) | ${low.code})`, type: 16 }
          : { code: `(${high.code} * 0x10000 + ${low.code})`, type: 32 };
      }
      case "multiply": {
        const left = number(expr.left, scope), right = number(expr.right, scope), width = left.type === 8 ? 16 : 32;
        const product = `(${integer(left, expr.signed ?? false)} * ${integer(right, expr.signed ?? false)})`;
        return { code: expr.signed ? `(${product} ${width === 32 ? ">>> 0" : "& 0xffff"})` : product, type: width };
      }
      case "subtract": case "add-wrap": {
        const { code, type } = arithmetic(expr.kind === "subtract" ? "subtract" : "add", expr, scope);
        return { code: `${code}.result`, type };
      }
      default: throw new Error("Expected a validated numeric expression.");
    }
  }
  function typed(expr: Expression, type: ValueType | undefined, scope: ExpressionScope): EmittedValue {
    return type === "flag" ? { code: flag(expr, scope), type } : number(expr, scope);
  }
  // The ALU call returns both a result and flag facts; callers select the needed property.
  function arithmetic(operation: "add" | "subtract", expr: ArithmeticOperands, scope: ExpressionScope): { readonly code: string; readonly type: Width } {
    const left = number(expr.left, scope), right = number(expr.right, scope);
    const name = helper(operation);
    const incoming = expr.incoming === undefined ? "" : `, (${flag(expr.incoming, scope)}) ? 1 : 0`;
    return { code: `${name}(${left.type}, ${left.code}, ${right.code}${incoming})`, type: left.type };
  }
  function flag(expr: Expression, scope: ExpressionScope): string {
    switch (expr.kind) {
      case "flag-value": return scope.get(expr.name)!.code;
      case "flag-literal": return String(expr.value);
      case "not": return `!(${flag(expr.value, scope)})`;
      case "xor": return `(${flag(expr.left, scope)}) !== (${flag(expr.right, scope)})`;
      case "or": return `(${flag(expr.left, scope)}) || (${flag(expr.right, scope)})`;
      case "and": return `(${flag(expr.left, scope)}) && (${flag(expr.right, scope)})`;
      case "bit": return `(${number(expr.value, scope).code} & 0x${(2 ** expr.position).toString(16)}) !== 0`;
      case "negative": case "low-bit": case "zero": case "even-parity": {
        const value = number(expr.value, scope);
        if (expr.kind === "negative" || expr.kind === "low-bit") return `(${value.code} & 0x${(expr.kind === "low-bit" ? 1 : 2 ** (value.type - 1)).toString(16)}) !== 0`;
        if (expr.kind === "zero") return `${value.code} === 0`;
        return `${helper("evenParity8")}(${value.code})`;
      }
      case "equal": case "less-than": {
        const left = number(expr.left, scope), right = number(expr.right, scope);
        return expr.kind === "equal" ? `${left.code} === ${right.code}`
          : `${integer(left, expr.signed)} < ${integer(right, expr.signed)}`;
      }
      case "borrow": case "half-borrow": case "subtract-overflow": case "carry": case "half-carry": case "add-overflow": {
        const property = { borrow: "borrow", "half-borrow": "halfBorrow", "subtract-overflow": "overflow",
          carry: "carry", "half-carry": "halfCarry", "add-overflow": "overflow" }[expr.kind];
        const operation = ["carry", "half-carry", "add-overflow"].includes(expr.kind) ? "add" : "subtract";
        return `${arithmetic(operation, expr, scope).code}.${property}`;
      }
      default: throw new Error("Expected a validated flag expression.");
    }
  }
  function address(expr: AddressExpression, scope: ExpressionScope): string {
    return expr.kind === "address-projection"
      ? `((${number(expr.base, scope).code} * ${2 ** expr.baseShift} + ${number(expr.offset, scope).code}) % ${2 ** expr.addressBits})`
      : number(expr, scope).code;
  }
  return { number, flag, typed, address };
}
