import type { FlagExpression, InstructionDefinition, NumberExpression, Statement, Width } from "./model.ts";
import { defineInstruction } from "./validate.ts";

interface CapturedValue { readonly code: string; readonly width: Width }
type Scope = ReadonlyMap<string, CapturedValue>;
type Capability = "fetchByte" | "readByte" | "writeByte";

/** Compile the bounded experiment to ordinary typed statements, without executing any effects. */
export function generateInstructions(cpu: "6502" | "8080" | "6809", definitions: Readonly<Record<string, InstructionDefinition>>): string {
  const helpers = new Set<string>();
  let needsContext = false;
  const methods = Object.entries(definitions).map(([name, input]) => {
    const definition = defineInstruction(input);
    if (definition.cpu.name !== cpu) throw new Error(`${name}: expected a ${cpu} definition.`);
    const lines: string[] = [];
    const capabilities = new Set<Capability>();
    let nextValue = 0;
    const emit = (line: string): void => { lines.push(`    ${line}`); };
    const local = (hint: string): string => `v${nextValue++}_${hint}`;
    const helper = (name: string): string => { helpers.add(name); return name; };
    const access = (name: Capability): string => { capabilities.add(name); return `instruction.${name}`; };
    const field = (name: string): string => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
    const comment = (text: string): void => { emit(`// ${JSON.stringify(text)}`); };

    function number(expr: NumberExpression, scope: Scope): CapturedValue {
      switch (expr.kind) {
        case "value": return scope.get(expr.name)!; // Validation has resolved names and widths.
        case "literal": return { code: `0x${expr.value.toString(16)}`, width: expr.width };
        case "extend": return { code: number(expr.value, scope).code, width: expr.width };
        case "subtract": case "add-wrap": case "concat": {
          const left = number(expr.left, scope), right = number(expr.right, scope);
          if (expr.kind === "concat") return { code: `((${left.code} << 8) | ${right.code})`, width: 16 };
          const operation = helper(expr.kind === "subtract" ? "subtract" : "add");
          return { code: `${operation}(${left.width}, ${left.code}, ${right.code}).result`, width: left.width };
        }
      }
    }
    function flag(expr: FlagExpression, scope: Scope): string {
      switch (expr.kind) {
        case "not": return `!(${flag(expr.value, scope)})`;
        case "negative": case "zero": case "even-parity": {
          const value = number(expr.value, scope);
          if (expr.kind === "negative") return `(${value.code} & 0x${(2 ** (value.width - 1)).toString(16)}) !== 0`;
          if (expr.kind === "zero") return `${value.code} === 0`;
          return `${helper("evenParity8")}(${value.code})`;
        }
        case "borrow": case "half-borrow": case "subtract-overflow": {
          const left = number(expr.left, scope), right = number(expr.right, scope);
          const property = { borrow: "borrow", "half-borrow": "halfBorrow", "subtract-overflow": "overflow" }[expr.kind];
          return `${helper("subtract")}(${left.width}, ${left.code}, ${right.code}).${property}`;
        }
      }
    }
    function body(steps: readonly Statement[], scope: Map<string, CapturedValue>): void {
      for (const step of steps) {
        let captured: CapturedValue;
        switch (step.kind) {
          case "capture": captured = number(step.value, scope); break;
          case "read-register": captured = { code: `state${field(step.register.field)}`, width: step.register.width }; break;
          case "fetch-byte": captured = { code: `${access("fetchByte")}()`, width: 8 }; break;
          case "read-memory": captured = { code: `${access("readByte")}(${number(step.address, scope).code})`, width: 8 }; break;
          case "read-source": {
            comment(`Source: ${step.source.name}`);
            const sourceScope = new Map<string, CapturedValue>();
            body(step.source.steps, sourceScope);
            captured = number(step.source.result, sourceScope);
            break;
          }
          case "write-register": emit(`state${field(step.register.field)} = ${number(step.value, scope).code};`); continue;
          case "write-memory": emit(`${access("writeByte")}(${number(step.address, scope).code}, ${number(step.value, scope).code});`); continue;
          case "update-flags": {
            comment(`Flags: ${step.policy.name}; preserve unlisted flags`);
            // Arguments are pure expressions in the caller's scope. Evaluate once, before the policy.
            const parameters = new Map<string, CapturedValue>();
            for (const name of Object.keys(step.policy.parameters)) {
              const argument = number(step.arguments[name]!, scope), code = local(name);
              emit(`const ${code} = ${argument.code};`);
              parameters.set(name, { code, width: argument.width });
            }
            // Compute every right-hand side before making any of the flag assignments.
            const updates = step.policy.updates.map(update => {
              const code = local("flag");
              emit(`const ${code} = ${flag(update.value, parameters)};`);
              return { field: update.flag.field, code };
            });
            for (const update of updates) emit(`state.flags${field(update.field)} = ${update.code};`);
            continue;
          }
        }
        const code = local(step.name);
        emit(`const ${code} = ${captured.code};`);
        scope.set(step.name, { code, width: captured.width });
      }
    }
    body(definition.steps, new Map());
    needsContext ||= capabilities.size > 0;
    const context = capabilities.size
      ? `, instruction: Pick<ByteInstructionContext, ${[...capabilities].map(name => JSON.stringify(name)).join(" | ")}>`
      : "";
    return `  // ${JSON.stringify(`${cpu} ${definition.name}`)}\n`
      + `  ${JSON.stringify(name)}(state: Cpu${cpu}State${context}): void {\n${lines.join("\n")}\n  },`;
  });
  const imports = [`import type { Cpu${cpu}State } from "../state/${cpu}.ts";`];
  if (needsContext) imports.push('import type { ByteInstructionContext } from "../instruction-context.ts";');
  if (helpers.size) imports.push(`import { ${[...helpers].sort().join(", ")} } from "../alu.ts";`);
  return '// Generated by scripts/generate-cpu-semantics.ts; edit semantics/examples.ts instead.\n'
    + `${imports.join("\n")}\n\nexport const instructions = {\n${methods.join("\n\n")}\n};\n`;
}
