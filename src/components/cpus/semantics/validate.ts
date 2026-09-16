import type { Flag, FlagExpression, FlagPolicy, InstructionDefinition, NumberExpression, Register, Statement, ValueType, Width } from "./model.ts";

/** Own and freeze a validated definition. Captures and source scopes are instruction-local. */
export function defineInstruction(definition: InstructionDefinition): InstructionDefinition {
  const owned = copyData(definition);
  validateInstruction(owned);
  return owned;
}

/** Check the typed representation's widths, names, capabilities, and lexical value scopes. */
export function validateInstruction(definition: InstructionDefinition): void {
  const cpu = definition.cpu;
  const prefix = `${cpu.name} ${definition.name}`;
  const fail = (where: string, message: string): never => { throw new Error(`${prefix} / ${where}: ${message}`); };
  const width = (bits: number, where: string): Width => {
    if (bits !== 8 && bits !== 16) return fail(where, "expected width 8 or 16");
    return bits;
  };
  const identifier = (name: string, where: string): void => {
    if (!/^[a-z][a-zA-Z0-9_]*$/.test(name)) fail(where, `invalid value name ${JSON.stringify(name)}`);
  };
  function register(ref: Register, where: string): Width {
    const field = cpu.state[ref.field];
    if (ref.cpu !== cpu.name || field?.kind !== "unsigned" || field.bits !== ref.width) {
      return fail(where, `register ${ref.cpu}.${ref.field} does not match the CPU schema`);
    }
    return width(ref.width, where);
  }
  function flag(ref: Flag, where: string): void {
    const flags = cpu.state.flags;
    if (ref.cpu !== cpu.name || flags?.kind !== "group" || flags.fields[ref.field]?.kind !== "flag") fail(where, `unknown flag ${ref.cpu}.${ref.field}`);
  }
  function expression(expr: NumberExpression, scope: ReadonlyMap<string, ValueType>, where: string): Width {
    switch (expr.kind) {
      case "value": {
        const type = scope.get(expr.name) ?? fail(where, `value ${expr.name} has not been captured in this scope`);
        if (type === "flag") return fail(where, `value ${expr.name} is a flag, not a number`);
        return type;
      }
      case "literal": {
        const bits = width(expr.width, where);
        if (!Number.isSafeInteger(expr.value) || expr.value < 0 || expr.value >= 2 ** bits) fail(where, `literal does not fit ${bits} bits`);
        return bits;
      }
      case "extend": {
        const from = expression(expr.value, scope, where), to = width(expr.width, where);
        if (to <= from) fail(where, "extension must widen its operand");
        return to;
      }
      case "shift-left": case "shift-right":
        flagExpression(expr.incoming, scope, where);
        return expression(expr.value, scope, where);
      case "subtract": case "add-wrap": case "concat": {
        const left = expression(expr.left, scope, where), right = expression(expr.right, scope, where);
        if (left !== right) fail(where, "operands must have equal widths; conversions are explicit");
        if (expr.kind !== "concat") return left;
        if (left !== 8) fail(where, "concatenation requires two bytes, high then low");
        return 16;
      }
      default: return fail(where, "unknown numeric expression");
    }
  }
  function flagExpression(expr: FlagExpression, scope: ReadonlyMap<string, ValueType>, where: string): void {
    switch (expr.kind) {
      case "flag-value":
        if (scope.get(expr.name) !== "flag") fail(where, `flag ${expr.name} has not been captured in this scope`);
        return;
      case "flag-literal":
        if (typeof expr.value !== "boolean") fail(where, "flag literal must be Boolean");
        return;
      case "not": return flagExpression(expr.value, scope, where);
      case "negative": case "low-bit": case "zero": case "even-parity": {
        const bits = expression(expr.value, scope, where);
        if (expr.kind === "even-parity" && bits !== 8) fail(where, "even parity requires a byte");
        return;
      }
      case "borrow": case "half-borrow": case "subtract-overflow":
        if (expression(expr.left, scope, where) !== expression(expr.right, scope, where)) fail(where, "flag operands must have equal widths");
        return;
      default: fail(where, "unknown flag expression");
    }
  }
  function policy(policy: FlagPolicy, args: Readonly<Record<string, NumberExpression>>, scope: ReadonlyMap<string, ValueType>, where: string): void {
    const parameters = new Map<string, Width>();
    if (policy.unlisted !== "preserve") fail(where, "unlisted flags must be preserved");
    for (const [name, bits] of Object.entries(policy.parameters)) {
      identifier(name, where);
      parameters.set(name, width(bits, where));
      if (!Object.hasOwn(args, name)) fail(where, `missing argument ${name}`);
      else if (expression(args[name]!, scope, where) !== bits) fail(where, `argument ${name} must have width ${bits}`);
    }
    for (const name of Object.keys(args)) if (!parameters.has(name)) fail(where, `unknown argument ${name}`);
    const assigned = new Set<string>();
    for (const { flag: target, value } of policy.updates) {
      flag(target, where);
      if (assigned.has(target.field)) fail(where, `duplicate flag update ${target.field}`);
      assigned.add(target.field);
      flagExpression(value, parameters, where);
    }
  }
  function steps(body: readonly Statement[], scope: Map<string, ValueType>, parent: string): void {
    body.forEach((step, index) => {
      const where = `${parent} / ${index + 1} ${step.kind}`;
      const number = (expr: NumberExpression): Width => expression(expr, scope, where);
      const expect = (expr: NumberExpression, bits: Width): void => {
        if (number(expr) !== bits) fail(where, `expected ${bits}-bit value`);
      };
      let captured: ValueType;
      switch (step.kind) {
        case "capture": captured = number(step.value); break;
        case "read-register": captured = register(step.register, where); break;
        case "read-flag": flag(step.flag, where); captured = "flag"; break;
        case "fetch-byte": captured = 8; break;
        case "read-memory": expect(step.address, 16); captured = 8; break;
        case "read-source": {
          const local = new Map<string, ValueType>();
          steps(step.source.steps, local, `${where} / source ${step.source.name}`);
          captured = expression(step.source.result, local, where);
          if (captured !== width(step.source.width, where)) fail(where, "source result width does not match its declaration");
          break;
        }
        case "write-register": expect(step.value, register(step.register, where)); return;
        case "write-memory": expect(step.address, 16); expect(step.value, 8); return;
        case "update-flags": policy(step.policy, step.arguments, scope, `${where} / policy ${step.policy.name}`); return;
        default: return fail(where, "unknown statement");
      }
      identifier(step.name, where);
      if (scope.has(step.name)) fail(where, `duplicate capture ${step.name}`);
      scope.set(step.name, captured);
    });
  }
  steps(definition.steps, new Map(), "body");
}

/** Plain data only: cloning must neither retain mutable caller objects nor hide host functions. */
function copyData<Value>(value: Value, ancestors = new Set<object>()): Value {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  const array = Array.isArray(value);
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) {
    throw new Error("Instruction definitions must contain plain data, without host functions or instances.");
  }
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length || Object.values(fields).some(field => !("value" in field))) {
    throw new Error("Instruction definitions require data properties, without accessors or symbol properties.");
  }
  if (ancestors.has(value)) throw new Error("Instruction definitions cannot contain cycles.");
  ancestors.add(value);
  let copy: object;
  if (array) {
    const length: number = fields.length!.value;
    if (Object.keys(fields).length !== length + 1) throw new Error("Instruction definition arrays must be dense and contain only indexed data.");
    copy = Array.from({ length }, (_, index) => copyData(fields[index]?.value, ancestors));
  } else {
    copy = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, copyData(field.value, ancestors)]));
  }
  ancestors.delete(value);
  return Object.freeze(copy) as Value;
}
