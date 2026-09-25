import type { AddressExpression, Choice, CpuDeclaration, Expression, Flag, FlagGroup, FlagPolicy, InstructionDefinition, Latch, NumberExpression, Register, RegisterArray, Statement, ValueType, Width } from "./model.ts";
import { flagValue, isWidth, value } from "./model.ts";

// Only definitions validated here are trusted; caller freezes cannot bypass checking.
const validatedDefinitions = new WeakSet<InstructionDefinition>();

/** Own and freeze a validated definition. Captures and source scopes are instruction-local. */
export function defineInstruction(definition: InstructionDefinition): InstructionDefinition {
  if (validatedDefinitions.has(definition)) return definition;
  const owned = copyData(definition);
  validateInstruction(owned);
  validatedDefinitions.add(owned);
  return owned;
}

/** Check the typed representation's widths, names, capabilities, and lexical value scopes. */
export function validateInstruction(definition: InstructionDefinition): void {
  validation(definition.cpu, `${definition.cpu.name} ${definition.name}`).instruction(definition);
}

/** Check a policy in its own typed parameter scope, before an instruction applies it. */
export function validateFlagPolicy(cpu: CpuDeclaration, policy: FlagPolicy): void {
  const parameters = new Map(Object.entries(policy.parameters));
  const args = Object.fromEntries([...parameters].map(([name, type]) => [name, type === "flag" ? flagValue(name) : value(name)]));
  validation(cpu, `${cpu.name} ${policy.name}`).policy(policy, args, parameters, "policy");
}

function validation(cpu: CpuDeclaration, prefix: string) {
  const fail = (where: string, message: string): never => { throw new Error(`${prefix} / ${where}: ${message}`); };
  const width = (bits: number, where: string): Width => {
    if (!isWidth(bits)) return fail(where, "expected width 3, 8, 14, 16, or 32");
    return bits;
  };
  const valueType = (type: ValueType, where: string): ValueType => type === "flag" ? type : width(type, where);
  const arithmeticWidth = (bits: Width, where: string): Width => {
    if (bits !== 8 && bits !== 16 && bits !== 32) fail(where, "arithmetic requires an 8-, 16-, or 32-bit operand; widen narrow values explicitly");
    return bits;
  };
  const identifier = (name: string, where: string): void => {
    if (!/^[a-z][a-zA-Z0-9_]*$/.test(name)) fail(where, `invalid value name ${JSON.stringify(name)}`);
  };
  function bank(ref: { readonly cpu: string; readonly bank?: string }, where: string) {
    if (ref.cpu !== cpu.name) return fail(where, `reference does not match the CPU schema`);
    if (ref.bank === undefined) return cpu.state;
    const field = cpu.state[ref.bank];
    if (field?.kind !== "group") return fail(where, `unknown state group ${ref.bank}`);
    return field.fields;
  }
  function register(ref: Register, where: string): Width {
    const field = bank(ref, where)[ref.field];
    if (ref.cpu !== cpu.name || field?.kind !== "unsigned" || field.bits !== ref.width) {
      return fail(where, `register ${ref.cpu}.${ref.field} does not match the CPU schema`);
    }
    return width(ref.width, where);
  }
  function flag(ref: Flag, where: string): void {
    const flags = ref.cpu === cpu.name ? bank(ref, where).flags : undefined;
    if (flags?.kind !== "group" || flags.fields[ref.field]?.kind !== "flag") fail(where, `unknown flag ${ref.cpu}.${ref.field}`);
  }
  function latch(ref: Latch, where: string): void {
    if (ref.cpu !== cpu.name || bank(ref, where)[ref.field]?.kind !== "boolean") fail(where, `unknown control latch ${ref.cpu}.${ref.field}`);
  }
  function choice(ref: Choice, value: string | number, where: string): void {
    const field = ref.cpu === cpu.name ? bank(ref, where)[ref.field] : undefined;
    if (ref.cpu !== cpu.name || (field?.kind !== "choice" && field?.kind !== "named-choice")
      || ref.values.length !== field.values.length || ref.values.some((v, i) => v !== field.values[i])) fail(where, "control choices do not match the CPU schema");
    if (!ref.values.includes(value)) fail(where, "value is not a declared control choice");
  }
  function flagGroup(ref: FlagGroup, where: string): string[] {
    const flags = bank(ref, where).flags;
    if (ref.kind !== "flag-group" || flags?.kind !== "group" || Object.values(flags.fields).some(field => field.kind !== "flag")) {
      return fail(where, "expected a complete group of stored flags");
    }
    return Object.keys(flags.fields).sort();
  }
  function registerArray(ref: RegisterArray, where: string): Width {
    const field = bank(ref, where)[ref.field];
    if (ref.cpu !== cpu.name || field?.kind !== "array" || field.element.bits !== ref.width || field.length !== ref.length) {
      return fail(where, `register array ${ref.cpu}.${ref.field} does not match the CPU schema`);
    }
    return width(ref.width, where);
  }
  function element(ref: RegisterArray, index: NumberExpression, scope: ReadonlyMap<string, ValueType>, where: string): Width {
    const elementWidth = registerArray(ref, where);
    const bits = expression(index, scope, where);
    // A dynamic selector's entire unsigned range must fit; constants can name any valid slot.
    const maximum = index.kind === "literal" ? index.value : 2 ** bits - 1;
    if (maximum >= ref.length) fail(where, `index may exceed the ${ref.length}-element register array`);
    return elementWidth;
  }
  function expression(expr: Expression, scope: ReadonlyMap<string, ValueType>, where: string): Width {
    switch (expr.kind) {
      case "select": {
        flagExpression(expr.condition, scope, where);
        const yes = expression(expr.yes, scope, where), no = expression(expr.no, scope, where);
        if (yes !== no) fail(where, "selected values must have equal widths");
        return yes;
      }
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
      case "pack": {
        const bits = width(expr.width, where);
        if (!Array.isArray(expr.bits) || expr.bits.length !== bits) fail(where, `pack requires exactly ${bits} flag expressions, most significant bit first`);
        for (const bit of expr.bits) flagExpression(bit, scope, where);
        return bits;
      }
      case "high-byte":
        if (expression(expr.value, scope, where) !== 16) fail(where, "high byte requires a word");
        return 8;
      case "low-byte":
        if (expression(expr.value, scope, where) < 8) fail(where, "low byte requires at least eight bits");
        return 8;
      case "bits": case "with-bits": {
        const from = expression(expr.value, scope, where);
        if (!Number.isInteger(expr.high) || !Number.isInteger(expr.low) || expr.low < 0 || expr.high < expr.low || expr.high >= from) {
          fail(where, `bit range requires integer bounds with 0 <= low <= high < ${from}`);
        }
        const selected = width(expr.high - expr.low + 1, where);
        if (expr.kind === "bits") return selected;
        if (expression(expr.replacement, scope, where) !== selected) fail(where, `replacement must have width ${selected}`);
        return from;
      }
      case "extend": case "sign-extend": {
        const from = expression(expr.value, scope, where), to = width(expr.width, where);
        if (to <= from) fail(where, "extension must widen its operand");
        return to;
      }
      case "truncate": {
        const from = expression(expr.value, scope, where), to = width(expr.width, where);
        if (to >= from) fail(where, "truncation must narrow its operand");
        return to;
      }
      case "shift-left": case "shift-right":
        flagExpression(expr.incoming, scope, where);
        return arithmeticWidth(expression(expr.value, scope, where), where);
      case "shift-bits": {
        const bits = arithmeticWidth(expression(expr.value, scope, where), where);
        if (!Number.isInteger(expr.count) || expr.count < 0 || expr.count > bits || !["left", "right"].includes(expr.direction)) fail(where, "logical shift needs a direction and a constant count from zero through the operand width");
        return bits;
      }
      case "subtract": case "add-wrap": case "concat": case "multiply": case "bit-and": case "bit-or": case "bit-xor": {
        const left = expression(expr.left, scope, where), right = expression(expr.right, scope, where);
        if (left !== right) fail(where, "operands must have equal widths; conversions are explicit");
        if (expr.kind === "subtract" || expr.kind === "add-wrap") {
          arithmeticWidth(left, where);
          if (expr.incoming !== undefined) flagExpression(expr.incoming, scope, where);
        }
        if (expr.kind === "multiply") {
          if (left !== 8 && left !== 16) fail(where, "multiplication requires two bytes or two words and yields double width");
          if (expr.signed !== undefined && typeof expr.signed !== "boolean") fail(where, "multiplication signedness must be Boolean");
          return left === 8 ? 16 : 32;
        }
        if (expr.kind !== "concat") return left;
        if (left !== 8 && left !== 16) fail(where, "concatenation requires two bytes or two words, high then low");
        return left === 8 ? 16 : 32;
      }
      default: return fail(where, "unknown numeric expression");
    }
  }
  function flagExpression(expr: Expression, scope: ReadonlyMap<string, ValueType>, where: string): void {
    switch (expr.kind) {
      case "flag-value":
        if (scope.get(expr.name) !== "flag") fail(where, `flag ${expr.name} has not been captured in this scope`);
        return;
      case "flag-literal":
        if (typeof expr.value !== "boolean") fail(where, "flag literal must be Boolean");
        return;
      case "not": return flagExpression(expr.value, scope, where);
      case "xor": case "and": case "or": flagExpression(expr.left, scope, where); flagExpression(expr.right, scope, where); return;
      case "negative": case "low-bit": case "zero": case "even-parity": {
        const bits = expression(expr.value, scope, where);
        if (expr.kind === "even-parity" && bits !== 8) fail(where, "even parity requires a byte");
        return;
      }
      case "bit": {
        const bits = expression(expr.value, scope, where);
        if (!Number.isInteger(expr.position) || expr.position < 0 || expr.position >= bits) fail(where, `bit position must be an integer from 0 through ${bits - 1}`);
        return;
      }
      case "equal": case "less-than":
        if (expression(expr.left, scope, where) !== expression(expr.right, scope, where)) fail(where, "comparison operands must have equal widths");
        if (expr.kind === "less-than" && typeof expr.signed !== "boolean") fail(where, "comparison signedness must be Boolean");
        return;
      case "borrow": case "half-borrow": case "subtract-overflow": case "carry": case "half-carry": case "add-overflow":
        if (expression(expr.left, scope, where) !== expression(expr.right, scope, where)) fail(where, "flag operands must have equal widths");
        arithmeticWidth(expression(expr.left, scope, where), where);
        if (expr.incoming !== undefined) flagExpression(expr.incoming, scope, where);
        return;
      default: fail(where, "unknown flag expression");
    }
  }
  function expectValue(expr: Expression, type: ValueType, scope: ReadonlyMap<string, ValueType>, where: string, message: string): ValueType {
    const expected = valueType(type, where);
    if (expected === "flag") flagExpression(expr, scope, where);
    else if (expression(expr, scope, where) !== expected) fail(where, message);
    return expected;
  }
  function policy(policy: FlagPolicy, args: Readonly<Record<string, Expression>>, scope: ReadonlyMap<string, ValueType>, where: string): void {
    const parameters = new Map<string, ValueType>();
    if (policy.unlisted !== "preserve") fail(where, "unlisted flags must be preserved");
    for (const [name, bits] of Object.entries(policy.parameters)) {
      identifier(name, where);
      parameters.set(name, bits === "flag" ? "flag" : width(bits, where));
      if (!Object.hasOwn(args, name)) fail(where, `missing argument ${name}`);
      else if (bits === "flag") flagExpression(args[name]!, scope, where);
      else if (expression(args[name]!, scope, where) !== bits) fail(where, `argument ${name} must have width ${bits}`);
    }
    for (const name of Object.keys(args)) if (!parameters.has(name)) fail(where, `unknown argument ${name}`);
    const assigned = new Set<string>();
    for (const { flag: target, value } of policy.updates) {
      flag(target, where);
      const key = `${target.bank ?? ""}.${target.field}`;
      if (assigned.has(key)) fail(where, `duplicate flag update ${target.field}`);
      assigned.add(key);
      flagExpression(value, parameters, where);
    }
  }
  function address(expr: AddressExpression, scope: ReadonlyMap<string, ValueType>, where: string): void {
    if (expr.kind === "address-projection") {
      if (expression(expr.base, scope, where) !== 16 || expression(expr.offset, scope, where) !== 16) fail(where, "address projection requires word base and offset");
      if (!Number.isInteger(expr.baseShift) || expr.baseShift < 0 || expr.baseShift > 16) fail(where, "address base shift must be a constant from 0 through 16");
      if (!Number.isInteger(expr.addressBits) || expr.addressBits < 1 || expr.addressBits > 32) fail(where, "physical address width must be a constant from 1 through 32");
    } else {
      const bits = cpu.wordBoundary === true ? 32 : 16;
      if (expression(expr, scope, where) !== bits) fail(where, `expected ${bits}-bit value`);
    }
  }
  function steps(body: readonly Statement[], scope: Map<string, ValueType>, parent: string, allowRejection: boolean | "match" = true): void {
    body.forEach((step, index) => {
      const where = `${parent} / ${index + 1} ${step.kind}`;
      const number = (expr: Expression): Width => expression(expr, scope, where);
      const expect = (expr: NumberExpression, bits: Width): void => {
        if (number(expr) !== bits) fail(where, `expected ${bits}-bit value`);
      };
      const bind = (name: string, type: ValueType): void => {
        identifier(name, where);
        if (scope.has(name)) fail(where, `duplicate capture ${name}`);
        scope.set(name, type);
      };
      const rejection = (reason: string): void => {
        if (allowRejection !== true) fail(where, "value sources and composed actions cannot reject an instruction");
        if (typeof reason !== "string" || !/^[a-z][a-z0-9-]*$/.test(reason)) fail(where, "invalid rejection reason");
      };
      let captured: ValueType;
      switch (step.kind) {
        case "dispatch": case "match": {
          if (allowRejection === false) fail(where, "composed actions cannot reject an instruction through a byte match");
          expect(step.selector, 8);
          const type = step.kind === "match" ? valueType(step.type, where) : undefined;
          if (!step.cases.length) fail(where, "a byte match needs at least one case");
          for (const [index, branch] of step.cases.entries()) {
            if (![branch.mask, branch.value].every(n => Number.isInteger(n) && n >= 0 && n <= 255)
              || (branch.value & branch.mask) !== branch.value) fail(where, "invalid byte match mask or value");
            if (step.cases.slice(0, index).some(other => ((other.value ^ branch.value) & other.mask & branch.mask) === 0)) {
              fail(where, "byte match cases overlap");
            }
            const local = new Map(scope);
            steps(branch.steps, local, `${where} / case ${index + 1}`, allowRejection);
            if (step.kind === "match") expectValue(step.cases[index]!.result, type!, local, where, "match result width does not match its declaration");
          }
          if (step.kind === "match") bind(step.name, type!);
          return;
        }
        case "perform": {
          const inputs = step.action.inputs ?? {}, local = new Map<string, ValueType>();
          if (Object.keys(step.arguments).length !== Object.keys(inputs).length
            || Object.keys(step.arguments).some(name => !Object.hasOwn(inputs, name))) fail(where, "action arguments must match its inputs");
          for (const [name, type] of Object.entries(inputs)) {
            identifier(name, where);
            local.set(name, expectValue(step.arguments[name]!, type, scope, where, `expected ${type}-bit value`));
          }
          steps(step.action.steps, local, `${where} / action ${step.action.name}`, "match");
          return;
        }
        case "choose": {
          flagExpression(step.condition, scope, where);
          const type = valueType(step.type, where);
          for (const branch of [step.yes, step.no]) {
            const local = new Map(scope);
            steps(branch.steps, local, where, allowRejection);
            expectValue(branch.result, type, local, where, "conditional result width does not match its declaration");
          }
          bind(step.name, type);
          return;
        }
        case "when":
          flagExpression(step.condition, scope, where);
          steps(step.steps, new Map(scope), where, allowRejection);
          return;
        case "iterate": {
          expect(step.count, 8);
          const initial = number(step.initial), local = new Map(scope);
          identifier(step.name, where);
          if (scope.has(step.name)) fail(where, `duplicate capture ${step.name}`);
          local.set(step.name, initial);
          steps(step.steps, local, where, allowRejection);
          if (expression(step.result, local, where) !== initial) fail(where, "iteration result must retain its initial width");
          bind(step.name, initial);
          return;
        }
        case "iterate-together": {
          expect(step.count, 8);
          const entries = Object.entries(step.values), local = new Map(scope);
          if (!entries.length) fail(where, "iteration requires at least one value");
          const check = (expr: Expression, type: ValueType, names: ReadonlyMap<string, ValueType>) => {
            if (type === "flag") flagExpression(expr, names, where);
            else if (expression(expr, names, where) !== width(type, where)) fail(where, "iteration value must retain its declared width");
          };
          for (const [name, item] of entries) {
            identifier(name, where);
            if (scope.has(name)) fail(where, `duplicate capture ${name}`);
            check(item.initial, item.type, scope);
            local.set(name, item.type);
          }
          steps(step.steps, local, where, allowRejection);
          for (const [name, item] of entries) { check(item.next, item.type, local); bind(name, item.type); }
          return;
        }
        case "reject": rejection(step.reason); return;
        case "divide": {
          rejection(step.onError);
          const divisor = number(step.divisor), dividend = number(step.dividend);
          if ((divisor !== 8 && divisor !== 16) || dividend !== 2 * divisor) fail(where, "division requires a double-width dividend and a byte or word divisor");
          if (typeof step.signed !== "boolean") fail(where, "division signedness must be Boolean");
          bind(step.quotient, divisor); bind(step.remainder, divisor);
          if (step.overflow !== undefined) bind(step.overflow, "flag");
          return;
        }
        case "capture":
          captured = step.type === undefined ? number(step.value)
            : expectValue(step.value, step.type, scope, where, "capture width does not match its declaration");
          break;
        case "read-register": case "read-pending-register": captured = register(step.register, where); break;
        case "read-element": captured = element(step.array, step.index, scope, where); break;
        case "read-flag": flag(step.flag, where); captured = "flag"; break;
        case "test-choice": choice(step.choice, step.value, where); captured = "flag"; break;
        case "read-latch": latch(step.latch, where); captured = "flag"; break;
        case "exchange-flags": {
          const left = flagGroup(step.left, where), right = flagGroup(step.right, where);
          if (left.length !== right.length || left.some((name, index) => name !== right[index])) fail(where, "exchanged flag groups must have the same fields");
          return;
        }
        case "fetch-byte": captured = 8; break;
        case "fetch-word": captured = 16; break;
        case "read-next-address":
          if (!cpu.wordBoundary) fail(where, "a separate fetch cursor requires a word context");
          captured = 32; break;
        case "select-target":
          if (!cpu.wordBoundary) fail(where, "separate target selection requires a word context");
          expect(step.address, 32); return;
        case "resolve-address":
          if (!cpu.wordBoundary) fail(where, "staged address decoding requires a word context");
          if (![8, 16, 32].includes(step.size)) fail(where, "operand size must be 8, 16, or 32");
          expect(step.mode, 3); expect(step.code, 3); captured = 32; break;
        case "commit-address-updates":
          if (!cpu.wordBoundary) fail(where, "staged address updates require a word context");
          return;
        case "alignment-fault":
          if (!cpu.wordBoundary) fail(where, "alignment faults require a word boundary");
          if (allowRejection !== true) fail(where, "value sources and composed actions cannot reject an instruction");
          if (!["read", "write", "fetch"].includes(step.operation) || !["data", "program"].includes(step.space)
            || (step.operation === "write" && step.space === "program") || (step.operation === "fetch" && step.space !== "program")) fail(where, "invalid alignment fault access space");
          expect(step.address, 32); return;
        case "read-program-memory":
          if (!cpu.wordBoundary) fail(where, "program-space reads require a word context");
          expect(step.address, 32); captured = 8; break;
        case "read-port": expect(step.port, 16); captured = 8; break;
        case "read-memory": address(step.address, scope, where); captured = 8; break;
        case "read-source": {
          const inputs = step.source.inputs ?? {}, args = step.arguments ?? {}, local = new Map<string, ValueType>();
          if (Object.keys(args).length !== Object.keys(inputs).length || Object.keys(args).some(name => !Object.hasOwn(inputs, name))) {
            fail(where, "source arguments must match its inputs");
          }
          for (const [name, type] of Object.entries(inputs)) {
            identifier(name, where);
            local.set(name, expectValue(args[name]!, type, scope, where, `expected ${type}-bit value`));
          }
          steps(step.source.steps, local, `${where} / source ${step.source.name}`, allowRejection === false ? false : "match");
          captured = expectValue(step.source.result, step.source.type, local, where, "source result width does not match its declaration");
          break;
        }
        case "write-register": case "stage-register": expect(step.value, register(step.register, where)); return;
        case "write-element": expect(step.value, element(step.array, step.index, scope, where)); return;
        case "fill-array": expect(step.value, registerArray(step.array, where)); return;
        case "defer-interrupt":
          if (cpu.segmentedBoundary === true) {
            if (step.scope !== "intr" && step.scope !== "all") fail(where, "Segmented interrupt deferral scope must be intr or all");
          } else if (cpu.irqDeferral !== true || step.scope !== "irq") fail(where, "IRQ deferral needs a declared retirement destination");
          return;
        case "notify-reti":
          if (cpu.retiNotification !== true) fail(where, "RETI notification requires a declared notification policy");
          return;
        case "report-interrupt":
          if (cpu.segmentedBoundary !== true) fail(where, "software delivery reporting requires a segmented boundary");
          expect(step.vector, 8); return;
        case "reset-devices":
          if (!cpu.wordBoundary) fail(where, "device reset requires a word connection");
          return;
        case "read-test":
          if (cpu.segmentedBoundary !== true) fail(where, "TEST sampling requires a segmented coprocessor connection");
          captured = "flag"; break;
        case "send-escape":
          if (cpu.segmentedBoundary !== true) fail(where, "ESC requests require a segmented coprocessor connection");
          expect(step.opcode, 8); expect(step.modRM, 8);
          if (step.memory) {
            expect(step.memory.segment, 16); expect(step.memory.offset, 16); expect(step.memory.value, 16);
            address(step.memory.address, scope, where);
          }
          return;
        case "write-choice": choice(step.choice, step.value, where); return;
        case "write-latch":
          latch(step.latch, where);
          if (typeof step.value !== "boolean") {
            if (!step.value || typeof step.value !== "object") fail(where, "control latch value must be Boolean or a flag expression");
            flagExpression(step.value, scope, where);
          }
          return;
        case "write-port": expect(step.port, 16); expect(step.value, 8); return;
        case "write-memory": address(step.address, scope, where); expect(step.value, 8); return;
        case "update-flags": case "replace-flags":
          policy(step.policy, step.arguments, scope, `${where} / policy ${step.policy.name}`);
          if (step.kind === "replace-flags") {
            const target = step.policy.updates[0]?.flag;
            const fields = bank(target ?? { cpu: cpu.name }, where).flags;
            if (step.policy.updates.some(update => update.flag.bank !== target?.bank)) fail(where, "replacing flags requires a single bank");
            if (fields?.kind !== "group" || Object.keys(fields.fields).some(name => !step.policy.updates.some(update => update.flag.field === name))) {
              fail(where, "replacing flags requires every stored flag");
            }
          }
          return;
        default: return fail(where, "unknown statement");
      }
      bind(step.name, captured);
    });
  }
  return { policy, instruction(definition: InstructionDefinition) {
    const inputs = new Map<string, ValueType>();
    for (const [name, bits] of Object.entries(definition.inputs ?? {})) {
      identifier(name, "inputs");
      inputs.set(name, valueType(bits, "inputs"));
    }
    steps(definition.steps, inputs, "body");
  } };
}

/** Plain data only: cloning must neither retain mutable caller objects nor hide host functions. */
function copyData<Value>(value: Value, ancestors = new Set<object>(), copies = new Map<object, object>()): Value {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  const array = Array.isArray(value);
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) {
    throw new Error("Instruction definitions must contain plain data, without host functions or instances.");
  }
  // Keep shared subexpressions shared within this owned graph; only completed copies enter the map.
  const previous = copies.get(value);
  if (previous) return previous as Value;
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
    copy = Array.from({ length }, (_, index) => copyData(fields[index]?.value, ancestors, copies));
  } else {
    copy = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, copyData(field.value, ancestors, copies)]));
  }
  ancestors.delete(value);
  Object.freeze(copy);
  copies.set(value, copy);
  return copy as Value;
}
