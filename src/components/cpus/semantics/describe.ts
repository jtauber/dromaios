import type { AddressExpression, Expression, FlagExpression, InstructionDefinition, Statement } from "./model.ts";
import { validateInstruction } from "./validate.ts";

/** Expand every source and flag policy from its represented meaning, without running any effects. */
export function describeInstruction(definition: InstructionDefinition): string {
  validateInstruction(definition);
  const lines: string[] = [];
  const changed = new Set<string>();
  const bank = (ref: { readonly bank?: string }): string => ref.bank === undefined ? "" : `${ref.bank.toUpperCase()}.`;
  function number(expr: Expression, parameters: Readonly<Record<string, Expression>> = {}): string {
    switch (expr.kind) {
      // Arguments are in the caller's scope: substitution happens once, never recursively by name.
      case "select": return `select(${flag(expr.condition, parameters)}, ${number(expr.yes, parameters)}, ${number(expr.no, parameters)})`;
      case "value": return Object.hasOwn(parameters, expr.name) ? number(parameters[expr.name]!) : expr.name;
      case "literal": return `${expr.value.toString(16).toUpperCase().padStart(Math.ceil(expr.width / 4), "0")}:u${expr.width}`;
      case "truncate": return `low${expr.width}(${number(expr.value, parameters)})`;
      case "extend": return `zeroExtend${expr.width}(${number(expr.value, parameters)})`;
      case "sign-extend": return `signExtend${expr.width}(${number(expr.value, parameters)})`;
      case "high-byte": return `highByte(${number(expr.value, parameters)})`;
      case "low-byte": return `lowByte(${number(expr.value, parameters)})`;
      case "shift-left": case "shift-right":
        return `${expr.kind === "shift-left" ? "shiftLeft" : "shiftRight"}(${number(expr.value, parameters)}, ${flag(expr.incoming, parameters)})`;
      case "shift-bits": return `shiftBits${expr.direction === "left" ? "Left" : "Right"}(${number(expr.value, parameters)}, ${expr.count})`;
      case "subtract": case "add-wrap": case "concat": case "multiply": case "bit-and": case "bit-or": case "bit-xor": {
        const operation = { subtract: "subtract", "add-wrap": "addWrap", concat: "concatHighLow", multiply: "multiplyUnsigned8",
          "bit-and": "bitAnd", "bit-or": "bitOr", "bit-xor": "bitXor" }[expr.kind];
        return `${operation}(${number(expr.left, parameters)}, ${number(expr.right, parameters)}${
          expr.kind === "subtract" || expr.kind === "add-wrap" ? incoming(expr.incoming, parameters) : ""})`;
      }
      default: throw new Error("Expected a validated numeric expression.");
    }
  }
  function incoming(expr: FlagExpression | undefined, parameters: Readonly<Record<string, Expression>>): string {
    return expr === undefined ? "" : `, ${flag(expr, parameters)}`;
  }
  function address(expr: AddressExpression): string {
    return expr.kind === "address-projection"
      ? `projectAddress(${number(expr.base)} * ${2 ** expr.baseShift} + ${number(expr.offset)}, ${expr.addressBits} bits)` : number(expr);
  }
  function flag(expr: Expression, parameters: Readonly<Record<string, Expression>>): string {
    switch (expr.kind) {
      case "flag-value": return Object.hasOwn(parameters, expr.name) ? flag(parameters[expr.name]!, {}) : expr.name;
      case "flag-literal": return expr.value ? "1:flag" : "0:flag";
      case "not": return `not(${flag(expr.value, parameters)})`;
      case "xor": return `xor(${flag(expr.left, parameters)}, ${flag(expr.right, parameters)})`;
      case "or": return `or(${flag(expr.left, parameters)}, ${flag(expr.right, parameters)})`;
      case "and": return `and(${flag(expr.left, parameters)}, ${flag(expr.right, parameters)})`;
      case "negative": case "low-bit": case "zero": case "even-parity":
        return `${{ negative: "topBit", "low-bit": "lowBit", zero: "isZero", "even-parity": "evenParity8" }[expr.kind]}(${number(expr.value, parameters)})`;
      case "borrow": case "half-borrow": case "subtract-overflow": case "carry": case "half-carry": case "add-overflow":
        return `${{ borrow: "borrow", "half-borrow": "halfBorrow4", "subtract-overflow": "subtractOverflow",
          carry: "carry", "half-carry": "halfCarry4", "add-overflow": "addOverflow" }[expr.kind]}(${number(expr.left, parameters)}, ${number(expr.right, parameters)}${incoming(expr.incoming, parameters)})`;
      default: throw new Error("Expected a validated flag expression.");
    }
  }
  function body(steps: readonly Statement[], indent = ""): void {
    const emit = (line: string): void => { lines.push(indent + line); };
    for (const step of steps) {
      switch (step.kind) {
        case "when":
          emit(`when ${flag(step.condition, {})} {`);
          body(step.steps, indent + "  ");
          emit("}");
          break;
        case "capture": emit(`${step.name} := ${number(step.value)}`); break;
        case "read-register": emit(`${step.name}:u${step.register.width} := read ${bank(step.register)}${step.register.field.toUpperCase()}`); break;
        case "read-element": emit(`${step.name}:u${step.array.width} := read ${step.array.field.toUpperCase()}[${number(step.index)}]`); break;
        case "read-flag": emit(`${step.name}:flag := read ${step.flag.field.toUpperCase()}`); break;
        case "read-latch": emit(`${step.name}:flag := read control latch ${step.latch.field}`); break;
        case "exchange-flags": {
          emit(`exchange ${bank(step.left)}FLAGS with ${bank(step.right)}FLAGS // Capture right then left; write left then right. Exchange objects without reading individual flags.`);
          const fields = definition.cpu.state.flags;
          if ((step.left.bank === undefined || step.right.bank === undefined) && fields?.kind === "group") Object.keys(fields.fields).forEach(name => changed.add(name));
          break;
        }
        case "fetch-byte": emit(`${step.name}:u8 := fetch byte`); break;
        case "read-memory": emit(`${step.name}:u8 := read memory[${address(step.address)}]`); break;
        case "write-register": emit(`write ${bank(step.register)}${step.register.field.toUpperCase()}:u${step.register.width} := ${number(step.value)}`); break;
        case "write-element": emit(`write ${step.array.field.toUpperCase()}[${number(step.index)}]:u${step.array.width} := ${number(step.value)}`); break;
        case "defer-interrupt": emit("request " + (step.scope === "intr" ? "INTR" : "all interrupt") + " deferral at successful retirement"); break;
        case "write-latch": emit(`write ${step.latch.field}:boolean := ${step.value}`); break;
        case "write-memory": emit(`write memory[${address(step.address)}] := ${number(step.value)}`); break;
        case "read-source":
          emit(`${step.name}:u${step.source.width} := source "${step.source.name}" {`);
          body(step.source.steps, indent + "  ");
          emit(`  yield ${number(step.source.result)}`);
          emit("}");
          break;
        case "update-flags": case "replace-flags":
          emit(`${step.kind === "replace-flags" ? "replace flags" : "flags"} "${step.policy.name}" simultaneously {`);
          for (const update of step.policy.updates) {
            changed.add(update.flag.field);
            emit(`  ${update.flag.field.toUpperCase()} := ${flag(update.value, step.arguments)}`);
          }
          emit(step.kind === "replace-flags" ? "} // Replace the complete flag object." : "} // Preserve unlisted flags.");
          break;
      }
    }
  }
  for (const [name, bits] of Object.entries(definition.inputs ?? {})) lines.push(`${name}:u${bits} := input`);
  body(definition.steps);
  const fields = definition.cpu.state.flags;
  const preserved = fields?.kind === "group" ? Object.entries(fields.fields)
    .filter(([name, field]) => field.kind === "flag" && !changed.has(name)).map(([name]) => name.toUpperCase()) : [];
  return `### ${definition.cpu.name} ${definition.name}\n\n${definition.explanation}\n\n\`\`\`text\n${lines.join("\n")}\n\`\`\`\n\n`
    + `Flags preserved throughout: ${preserved.length ? preserved.join(", ") : "none"}.\n`;
}

/** Reproducible review artifact; this is an expansion, not generated emulator code. */
export function describeInstructions(definitions: readonly InstructionDefinition[]): string {
  return `# Instruction definition examples

Generated by \`node scripts/describe-cpu-semantics.ts\` from
[the typed definitions](../../src/components/cpus/semantics/definitions.ts).
Edit those definitions and their explanations, then regenerate this document.
See the [representation contract](instruction-semantics.md) for primitive meanings,
validation, execution bindings, and current limits. The same definitions also
generate typed instruction bodies for the bounded CPU migration.

Bodies begin after opcode selection. Motorola memory bodies receive a resolved
address from the existing decoder. Declared inputs
are captured before entry. Statements are
ordered. Captures are immutable; a source
block has its own scope. Conditional blocks inherit outer captures; local captures
do not escape. Untaken blocks have no effects. All expressions in one flag update are evaluated before
any of its assignments. On an effect failure, completed effects remain and no
later statement runs. See the contract for which bodies are bound to CPU opcodes.

## Examples

${definitions.map(describeInstruction).join("\n")}`;
}
