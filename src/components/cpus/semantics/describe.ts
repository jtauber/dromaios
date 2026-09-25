import type { AddressExpression, Expression, FlagExpression, InstructionDefinition, Statement, ValueType } from "./model.ts";
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
      case "pack": return `pack<${expr.width}>(${expr.bits.map(bit => flag(bit, parameters)).join(", ")})`;
      case "bits": return `bits(${number(expr.value, parameters)}, ${expr.high}, ${expr.low})`;
      case "with-bits": return `withBits(${number(expr.value, parameters)}, ${expr.high}, ${expr.low}, ${number(expr.replacement, parameters)})`;
      case "truncate": return `low${expr.width}(${number(expr.value, parameters)})`;
      case "extend": return `zeroExtend${expr.width}(${number(expr.value, parameters)})`;
      case "sign-extend": return `signExtend${expr.width}(${number(expr.value, parameters)})`;
      case "high-byte": return `highByte(${number(expr.value, parameters)})`;
      case "low-byte": return `lowByte(${number(expr.value, parameters)})`;
      case "shift-left": case "shift-right":
        return `${expr.kind === "shift-left" ? "shiftLeft" : "shiftRight"}(${number(expr.value, parameters)}, ${flag(expr.incoming, parameters)})`;
      case "shift-bits": return `shiftBits${expr.direction === "left" ? "Left" : "Right"}(${number(expr.value, parameters)}, ${expr.count})`;
      case "multiply": return `multiply${expr.signed ? "Signed" : "Unsigned"}(${number(expr.left, parameters)}, ${number(expr.right, parameters)})`;
      case "subtract": case "add-wrap": case "concat": case "bit-and": case "bit-or": case "bit-xor": {
        const operation = { subtract: "subtract", "add-wrap": "addWrap", concat: "concatHighLow",
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
      case "bit": return `bit(${number(expr.value, parameters)}, ${expr.position})`;
      case "negative": case "low-bit": case "zero": case "even-parity":
        return `${{ negative: "topBit", "low-bit": "lowBit", zero: "isZero", "even-parity": "evenParity8" }[expr.kind]}(${number(expr.value, parameters)})`;
      case "equal": return `equal(${number(expr.left, parameters)}, ${number(expr.right, parameters)})`;
      case "less-than": return `lessThan(${number(expr.left, parameters)}, ${number(expr.right, parameters)}, ${expr.signed ? "signed" : "unsigned"})`;
      case "borrow": case "half-borrow": case "subtract-overflow": case "carry": case "half-carry": case "add-overflow":
        return `${{ borrow: "borrow", "half-borrow": "halfBorrow4", "subtract-overflow": "subtractOverflow",
          carry: "carry", "half-carry": "halfCarry4", "add-overflow": "addOverflow" }[expr.kind]}(${number(expr.left, parameters)}, ${number(expr.right, parameters)}${incoming(expr.incoming, parameters)})`;
      default: throw new Error("Expected a validated flag expression.");
    }
  }
  const typeName = (type: ValueType): string => type === "flag" ? "flag" : `u${type}`;
  const typed = (expr: Expression, type: ValueType | undefined): string => type === "flag" ? flag(expr, {}) : number(expr);
  function body(steps: readonly Statement[], indent = ""): void {
    const emit = (line: string): void => { lines.push(indent + line); };
    for (const step of steps) {
      switch (step.kind) {
        case "dispatch": case "match":
          emit(`${step.kind === "match" ? `${step.name}:${typeName(step.type)} := ` : ""}match byte ${number(step.selector)} {`);
          for (const [index, branch] of step.cases.entries()) {
            emit(`  case (byte & ${branch.mask.toString(16).toUpperCase().padStart(2, "0")}) = ${branch.value.toString(16).toUpperCase().padStart(2, "0")} {`);
            body(branch.steps, indent + "    ");
            if (step.kind === "match") emit(`    yield ${typed(step.cases[index]!.result, step.type)}`);
            emit("  }");
          }
          emit('  otherwise return outcome "unsupported"; no later effects'); emit("}");
          break;
        case "perform":
          emit(`perform "${step.action.name}" {`);
          for (const [name, bits] of Object.entries(step.action.inputs ?? {})) emit(`  ${name}:${typeName(bits)} := ${typed(step.arguments[name]!, bits)}`);
          body(step.action.steps, indent + "  ");
          emit("}");
          break;
        case "choose":
          emit(`${step.name}:${typeName(step.type)} := choose ${flag(step.condition, {})} {`);
          for (const [index, branch] of [step.yes, step.no].entries()) {
            emit(`  ${index ? "else" : "then"} {`);
            body(branch.steps, indent + "    ");
            emit(`    yield ${typed(branch.result, step.type)}`); emit("  }");
          }
          emit("}");
          break;
        case "when":
          emit(`when ${flag(step.condition, {})} {`);
          body(step.steps, indent + "  ");
          emit("}");
          break;
        case "iterate":
          emit(`${step.name} := ${number(step.initial)}`);
          emit(`iterate ${number(step.count)} times with ${step.name} {`);
          body(step.steps, indent + "  ");
          emit(`  yield ${number(step.result)} as the next ${step.name}`);
          emit("} // Zero iterations retain the initial value and perform no body effects.");
          break;
        case "iterate-together": {
          const entries = Object.entries(step.values);
          const expression = (expr: Expression, type: string | number) => type === "flag" ? flag(expr, {}) : number(expr);
          for (const [name, item] of entries) emit(`${name}:${item.type === "flag" ? "flag" : `u${item.type}`} := ${expression(item.initial, item.type)}`);
          emit(`iterate ${number(step.count)} times with ${entries.map(([name]) => name).join(", ")} {`);
          body(step.steps, indent + "  ");
          for (const [name, item] of entries) emit(`  next ${name} := ${expression(item.next, item.type)}`);
          emit("} // Update all values together; zero iterations retain their initial values without body effects.");
          break;
        }
        case "reject": emit(`return outcome ${JSON.stringify(step.reason)}; no later effects`); break;
        case "divide":
          emit(`${step.quotient}, ${step.remainder} := divide${step.signed ? "Signed" : "Unsigned"}(${number(step.dividend)}, ${number(step.divisor)})`);
          emit(`// Truncate quotient toward zero; remainder follows dividend sign. Both results have divisor width.`);
          if (step.overflow === undefined) emit(`// Zero divisor or quotient overflow returns ${JSON.stringify(step.onError)} before any later effect.`);
          else {
            emit(`${step.overflow}:flag := quotient does not fit the ${step.signed ? "signed" : "unsigned"} divisor width`);
            emit(`// Zero divisor returns ${JSON.stringify(step.onError)}. Overflow continues with truncated results; the caller decides whether to write them.`);
          }
          break;
        case "capture": emit(`${step.name}${step.type === undefined ? "" : `:${typeName(step.type)}`} := ${typed(step.value, step.type)}`); break;
        case "read-register": emit(`${step.name}:u${step.register.width} := read ${bank(step.register)}${step.register.field.toUpperCase()}`); break;
        case "read-pending-register": emit(`${step.name}:u${step.register.width} := pending ${bank(step.register)}${step.register.field.toUpperCase()}, or read stored register if unstaged`); break;
        case "stage-register": emit(`stage ${bank(step.register)}${step.register.field.toUpperCase()}:u${step.register.width} := ${number(step.value)}; preserve stored state until commit`); break;
        case "read-element": emit(`${step.name}:u${step.array.width} := read ${bank(step.array)}${step.array.field.toUpperCase()}[${number(step.index)}]`); break;
        case "read-flag": emit(`${step.name}:flag := read ${bank(step.flag)}${step.flag.field.toUpperCase()}`); break;
        case "test-choice": emit(`${step.name}:flag := test control ${bank(step.choice)}${step.choice.field} equals ${JSON.stringify(step.value)}`); break;
        case "read-latch": emit(`${step.name}:flag := read control latch ${bank(step.latch)}${step.latch.field}`); break;
        case "exchange-flags": {
          emit(`exchange ${bank(step.left)}FLAGS with ${bank(step.right)}FLAGS // Capture right then left; write left then right. Exchange objects without reading individual flags.`);
          const fields = definition.cpu.state.flags;
          if ((step.left.bank === undefined || step.right.bank === undefined) && fields?.kind === "group") Object.keys(fields.fields).forEach(name => changed.add(name));
          break;
        }
        case "fetch-byte": emit(`${step.name}:u8 := fetch byte`); break;
        case "fetch-word": emit(`${step.name}:u16 := fetch complete native-order word`); break;
        case "read-next-address": emit(`${step.name}:u32 := read sequential fetch cursor`); break;
        case "select-target": emit(`select instruction target ${number(step.address)} for successful retirement; preserve the sequential fetch cursor`); break;
        case "resolve-address": emit(`${step.name}:u32 := resolve ${step.size}-bit memory EA (mode ${number(step.mode)}, register ${number(step.code)}); stage auto-updates for later operands`); break;
        case "commit-address-updates": emit("commit staged address-register updates in first-use order; repeated registers receive their final staged value"); break;
        case "alignment-fault": emit(`return ${step.space}-space ${step.operation} alignment fault at ${number(step.address)}; no later effects`); break;
        case "read-program-memory": emit(`${step.name}:u8 := read program memory[${number(step.address)}]`); break;
        case "read-port": emit(`${step.name}:u8 := read port[${number(step.port)}]`); break;
        case "read-memory": emit(`${step.name}:u8 := read memory[${address(step.address)}]`); break;
        case "write-register": emit(`write ${bank(step.register)}${step.register.field.toUpperCase()}:u${step.register.width} := ${number(step.value)}`); break;
        case "write-element": emit(`write ${bank(step.array)}${step.array.field.toUpperCase()}[${number(step.index)}]:u${step.array.width} := ${number(step.value)}`); break;
        case "fill-array": emit(`fill all ${step.array.length} ${bank(step.array)}${step.array.field.toUpperCase()} elements:u${step.array.width} := ${number(step.value)}`); break;
        case "defer-interrupt": emit("request " + ({ irq: "IRQ", intr: "INTR", all: "all interrupt" }[step.scope]) + " deferral at successful retirement"); break;
        case "notify-reti": emit("request RETI device notification after successful architectural retirement"); break;
        case "reset-devices": emit("assert connected device reset now; record only after callback success; preserve CPU state"); break;
        case "report-interrupt": emit(`report completed software interrupt delivery, vector ${number(step.vector)}`); break;
        case "read-test": emit(`${step.name}:flag := sample and record physical TEST level; high waits, low releases`); break;
        case "send-escape": emit(`send and record ESC opcode ${number(step.opcode)}, ModR/M ${number(step.modRM)}`
          + (step.memory ? `, captured memory ${number(step.memory.segment)}:${number(step.memory.offset)} at ${address(step.memory.address)} with word ${number(step.memory.value)}` : ", register selector only")
          + "; device receives a detached request; record only after callback success"); break;
        case "write-choice": emit(`write control ${bank(step.choice)}${step.choice.field} := ${JSON.stringify(step.value)}`); break;
        case "write-latch": emit(`write ${bank(step.latch)}${step.latch.field}:boolean := ${typeof step.value === "boolean" ? step.value : flag(step.value, {})}`); break;
        case "write-port": emit(`write port[${number(step.port)}] := ${number(step.value)}`); break;
        case "write-memory": emit(`write memory[${address(step.address)}] := ${number(step.value)}`); break;
        case "read-source":
          emit(`${step.name}:${typeName(step.source.type)} := source "${step.source.name}" {`);
          for (const [name, bits] of Object.entries(step.source.inputs ?? {})) emit(`  ${name}:${typeName(bits)} := ${typed(step.arguments![name]!, bits)}`);
          body(step.source.steps, indent + "  ");
          emit(`  yield ${typed(step.source.result, step.source.type)}`);
          emit("}");
          break;
        case "update-flags": case "replace-flags":
          emit(`${step.kind === "replace-flags" ? "replace flags" : "flags"} "${step.policy.name}" simultaneously {`);
          for (const update of step.policy.updates) {
            changed.add(bank(update.flag) + update.flag.field);
            emit(`  ${bank(update.flag)}${update.flag.field.toUpperCase()} := ${flag(update.value, step.arguments)}`);
          }
          emit(step.kind === "replace-flags" ? "} // Replace the complete flag object." : "} // Preserve unlisted flags.");
          break;
      }
    }
  }
  for (const [name, type] of Object.entries(definition.inputs ?? {})) lines.push(`${name}:${typeName(type)} := input`);
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
Edit the executable CPU chapters and their explanations, then regenerate this document.
See the [representation contract](instruction-semantics.md) for primitive meanings,
validation, execution bindings, and current limits. The same definitions also
generate typed instruction bodies for all eight CPU models.

Bodies begin after opcode selection. Chapter-owned forms include their operand
fetching and addressing. Generated execution bindings supply declared address
or selector inputs. Declared inputs
are captured before entry. Statements are
ordered. Captures are immutable; each source and action
expansion has its own scope. Action arguments are captured in the caller before its effects. Conditional and bounded iteration blocks inherit outer
captures; local captures do not escape. Each iteration sees its own current value.
Untaken blocks and zero iterations have no effects. Named outcomes end the body.
All expressions in one flag update are evaluated before
any of its assignments. On an effect failure, completed effects remain and no
later statement runs. See the contract for which bodies are bound to CPU opcodes.

## Examples

${definitions.map(describeInstruction).join("\n")}`;
}
