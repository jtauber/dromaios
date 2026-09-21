import { alignmentFault, capture, commitAddressUpdates, deferInterrupt, fetchByte, fillArray, flagValue, highByte, lowByte, replaceFlags, not, perform, readElement,
  readFlag, readLatch, readMemory, readPort, readRegister, readSource, resolveAddress, updateFlags,
  testChoice, value, when, writeChoice, writeElement, writeLatch, writeMemory, writePort, writeRegister } from "../model.ts";
import type { Choice, CpuDeclaration, Expression, Flag, FlagExpression, FlagPolicy, InstructionDefinition, Latch, NumberExpression, Register, RegisterArray, Statement, ValueSource, Width } from "../model.ts";
import { validateInstruction } from "../validate.ts";
import { chapterBody } from "./document.ts";
import type { ChapterTokens } from "./document.ts";
import { expression, flagExpression } from "./expressions.ts";
import { chapterMatch } from "./matches.ts";

export type ChapterOperand = { readonly name: string; readonly kind: "unsupported" } | { readonly name: string; readonly read: ValueSource } & (
  | { readonly kind: "view"; readonly write: InstructionDefinition }
  | { readonly kind: "memory"; readonly address: ValueSource }
  | { readonly kind: "register"; readonly register: Register }
  | { readonly kind: "pair"; readonly high: Register; readonly low: Register }
  | { readonly kind: "value" }
);
export interface ChapterCondition {
  readonly kind: "condition";
  readonly name: string;
  readonly flag: Flag;
  readonly set: boolean;
}
interface Symbols {
  readonly cpu: CpuDeclaration;
  readonly registers: ReadonlyMap<string, Register>;
  readonly arrays: ReadonlyMap<string, RegisterArray>;
  readonly latches: ReadonlyMap<string, Latch>;
  readonly choices: ReadonlyMap<string, Choice>;
  readonly flags: ReadonlyMap<string, Flag>;
  readonly policies: ReadonlyMap<string, FlagPolicy>;
  readonly actions: ReadonlyMap<string, InstructionDefinition>;
  readonly sources: ReadonlyMap<string, ValueSource>;
  readonly operands: ReadonlyMap<string, ChapterOperand>;
  readonly conditions: ReadonlyMap<string, ChapterCondition>;
  readonly catalogues: ReadonlyMap<string, readonly ChapterOperand[]>;
}

export interface StatementOptions {
  readonly inputs?: Readonly<Record<string, Width>>;
  readonly effects?: "view" | "state" | "memory";
}

/** Views are pure reads; actions need an explicit memory capability for bus effects. */
export function checkStateEffects(steps: readonly Statement[], effects: "view" | "state" | "memory"): void {
  for (const step of steps) {
    switch (step.kind) {
      case "capture": case "read-register": case "read-element": case "read-flag": case "read-latch": case "test-choice": break;
      case "when": checkStateEffects(step.steps, effects); break;
      case "read-source": checkStateEffects(step.source.steps, effects); break;
      case "perform": checkStateEffects(step.action.steps, effects); break;
      case "write-register": case "write-element": case "fill-array": case "write-latch": case "write-choice": case "update-flags": case "replace-flags":
        if (effects !== "view") break;
        throw new Error("Views may only read stored state.");
      case "read-memory": case "write-memory":
        if (effects === "memory") break;
        throw new Error("Views and state actions cannot fetch instructions or access memory without using memory.");
      default: throw new Error("Views and actions cannot fetch instructions or access ports or CPU boundaries.");
    }
  }
}

/** Lower ordered effects, checking each prefix in its enclosing lexical scopes. */
export function chapterStatements(lines: readonly ChapterTokens[], symbols: Symbols, options: StatementOptions = {}): Statement[] {
  const { cpu, registers, arrays, latches, choices, flags, policies, actions, sources, operands, conditions } = symbols;
  // Compiler captures cannot collide with, or be referenced by, any authored name,
  // including later statements and nested blocks.
  const usedNames = new Set([...Object.keys(options.inputs ?? {}), ...lines.flatMap(tokens => tokens.source.text.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? [])]);
  let nextTemporary = 0;
  const temporary = (prefix: string) => {
    let name: string;
    do { name = `${prefix}${nextTemporary++}`; } while (usedNames.has(name));
    return name;
  };
  function parse(lines: readonly ChapterTokens[], validate: (steps: readonly Statement[]) => void,
    selectedOperands: ReadonlyMap<string, ChapterOperand> = operands): Statement[] {
    const result: Statement[] = [];
    for (let index = 0; index < lines.length; index++) {
      const tokens = lines[index]!;
      if (tokens.take("match")) {
        const { body, end } = chapterBody(lines, index); index = end;
        result.push(chapterMatch(tokens, body, undefined, symbols.catalogues, selectedOperands,
          (body, selected, check) => parse(body, check, selected), step => validate([...result, step])));
      } else if (tokens.take("when")) {
        const captures: Statement[] = [];
        let predicate: FlagExpression;
        if (tokens.take("test")) {
          const selected = tokens.lookup(conditions), name = temporary("condition");
          captures.push(readFlag(name, selected.flag));
          predicate = selected.set ? flagValue(name) : not(flagValue(name));
        } else predicate = flagExpression(tokens);
        tokens.expect("{"); tokens.end();
        const { body, end } = chapterBody(lines, index); index = end;
        const prefix = [...result, ...captures];
        const check = (body: readonly Statement[]) => validate([...prefix, when(predicate, body)]);
        tokens.checked(() => check([]));
        const nested = parse(body, check, selectedOperands);
        result.push(...captures, when(predicate, nested));
      } else if (tokens.take("perform")) {
        const action = tokens.lookup(actions); tokens.expect("(");
        const args: Record<string, NumberExpression> = {};
        for (const [index, name] of Object.keys(action.inputs ?? {}).entries()) {
          if (index) tokens.expect(","); args[name] = expression(tokens);
        }
        tokens.expect(")"); result.push(perform(action, args));
      } else if (tokens.take("fault")) {
        tokens.expect("alignment"); const operation = tokens.word();
        if (operation !== "read" && operation !== "write") return tokens.fail("Expected a data read or write alignment fault.");
        tokens.expect("("); const address = expression(tokens); tokens.expect(")"); tokens.expect("if");
        result.push(when(flagExpression(tokens), [alignmentFault(operation, address)]));
      } else if (tokens.take("defer")) {
        tokens.expect("irq"); result.push(deferInterrupt("irq"));
      } else if (tokens.take("commit")) {
        tokens.expect("addresses"); result.push(commitAddressUpdates());
      } else if (tokens.next === "apply" || tokens.next === "replace") {
        const effect = tokens.word() === "apply" ? updateFlags : replaceFlags;
        const policy = tokens.lookup(policies); tokens.expect("(");
        const args: Record<string, Expression> = {};
        for (const [index, [name, type]] of Object.entries(policy.parameters).entries()) {
          if (index) tokens.expect(","); args[name] = type === "flag" ? flagExpression(tokens) : expression(tokens);
        }
        tokens.expect(")"); result.push(effect(policy, args));
      } else if (tokens.take("operand")) {
        const operand = tokens.lookup(selectedOperands); tokens.expect("<-"); const contents = expression(tokens);
        if (operand.kind === "unsupported") return tokens.fail("Unsupported operands cannot be selected.");
        if (operand.kind === "view") result.push(perform(operand.write, { [Object.keys(operand.write.inputs!)[0]!]: contents }));
        if (operand.kind === "value") tokens.fail("A value-only operand cannot be written.");
        if (operand.kind === "register") result.push(writeRegister(operand.register, contents));
        if (operand.kind === "pair") result.push(writeRegister(operand.high, highByte(contents)), writeRegister(operand.low, lowByte(contents)));
        if (operand.kind === "memory") {
          const address = temporary("destinationAddress");
          result.push(readSource(address, operand.address), writeMemory(value(address), contents));
        }
      } else if ((tokens.next === "memory" || tokens.next === "port") && tokens.peek(1) === "(") {
        const effect = tokens.word() === "memory" ? writeMemory : writePort;
        tokens.expect("("); const address = expression(tokens); tokens.expect(")"); tokens.expect("<-");
        result.push(effect(address, expression(tokens)));
      } else {
        const name = tokens.reference();
        if (tokens.take("[")) {
          const array = arrays.get(name) ?? tokens.fail(`Unknown array ${name}.`);
          if (tokens.take("]")) {
            tokens.expect("<-"); result.push(fillArray(array, expression(tokens)));
          } else {
            const slot = expression(tokens); tokens.expect("]"); tokens.expect("<-");
            result.push(writeElement(array, slot, expression(tokens)));
          }
        } else if (tokens.take("<-")) {
          const latch = latches.get(name), choice = choices.get(name);
          if (choice) result.push(writeChoice(choice, tokens.choiceValue()));
          else if (latch) {
            const contents = flagExpression(tokens);
            result.push(writeLatch(latch, contents.kind === "flag-literal" ? contents.value : contents));
          } else {
            const register = registers.get(name) ?? tokens.fail(`Unknown register or latch ${name}.`);
            result.push(writeRegister(register, expression(tokens)));
          }
        } else {
          tokens.expect("=");
          if (tokens.take("match")) {
            const { body, end } = chapterBody(lines, index); index = end;
            result.push(chapterMatch(tokens, body, name, symbols.catalogues, selectedOperands,
              (body, selected, check) => parse(body, check, selected), step => validate([...result, step])));
          } else if (tokens.take("resolve")) {
            tokens.expect("("); const size = tokens.number();
            if (size !== 8 && size !== 16 && size !== 32) return tokens.fail("Operand size must be 8, 16, or 32.");
            tokens.expect(","); const mode = expression(tokens); tokens.expect(","); const code = expression(tokens); tokens.expect(")");
            result.push(resolveAddress(name, size, mode, code));
          } else if (tokens.take("fetch")) result.push(fetchByte(name));
          else if (tokens.take("choice")) {
            const choice = tokens.lookup(choices); tokens.expect("=");
            result.push(testChoice(name, choice, tokens.choiceValue()));
          } else if (tokens.take("flag")) result.push(readFlag(name, tokens.lookup(flags, true)));
          else if (tokens.take("latch")) result.push(readLatch(name, tokens.lookup(latches)));
          else if (tokens.take("register")) result.push(readRegister(name, tokens.lookup(registers, true)));
          else if (tokens.take("array")) {
            const array = tokens.lookup(arrays); tokens.expect("[");
            result.push(readElement(name, array, expression(tokens))); tokens.expect("]");
          } else if (tokens.take("source")) result.push(readSource(name, tokens.lookup(sources)));
          else if (tokens.take("operand")) {
            const operand = tokens.lookup(selectedOperands);
            if (operand.kind === "unsupported") return tokens.fail("Unsupported operands cannot be selected.");
            result.push(operand.kind === "register" ? readRegister(name, operand.register) : readSource(name, operand.read));
          } else if ((tokens.next === "memory" || tokens.next === "port") && tokens.peek(1) === "(") {
            const effect = tokens.word() === "memory" ? readMemory : readPort;
            tokens.expect("("); result.push(effect(name, expression(tokens))); tokens.expect(")");
          } else result.push(capture(name, expression(tokens)));
        }
      }
      tokens.end();
      tokens.checked(() => validate(result));
    }
    return result;
  }
  const validate = (steps: readonly Statement[]) => {
    validateInstruction({ cpu, name: "chapter", explanation: "", inputs: options.inputs, steps });
    if (options.effects) checkStateEffects(steps, options.effects);
  };
  return parse(lines, validate);
}

/** Generated action signatures include a context only when an actual memory effect needs one. */
export function usesMemory(steps: readonly Statement[]): boolean {
  return steps.some(step => step.kind === "read-memory" || step.kind === "write-memory"
    || ((step.kind === "match" || step.kind === "dispatch") && step.cases.some(branch => usesMemory(branch.steps)))
    || (step.kind === "perform" && usesMemory(step.action.steps))
    || (step.kind === "read-source" && usesMemory(step.source.steps))
    || (step.kind === "when" && usesMemory(step.steps)));
}
