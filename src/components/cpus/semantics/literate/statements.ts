import { divide, iterate, reject, alignmentFault, capture, commitAddressUpdates, deferInterrupt, notifyReti, exchangeFlags, fetchByte, fetchWord, fillArray, flagValue, highByte, lowByte, replaceFlags, not, perform, readElement,
  readFlag, readLatch, readMemory, readProgramMemory, readPort, readRegister, readSource, readTest, reportInterrupt, sendEscape, resolveAddress, updateFlags,
  testChoice, value, when, writeChoice, writeElement, writeLatch, writeMemory, writePort, writeRegister } from "../model.ts";
import type { Choice, CpuDeclaration, Expression, Flag, FlagGroup, FlagExpression, FlagPolicy, InstructionDefinition, Latch, NumberExpression, Register, RegisterArray, Statement, ValueSource, Width } from "../model.ts";
import { validateInstruction } from "../validate.ts";
import { chapterBody } from "./document.ts";
import type { ChapterTokens } from "./document.ts";
import { address, expression, flagExpression, signedness } from "./expressions.ts";
import { chapterChoose } from "./choose.ts";
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
  readonly flagGroups: ReadonlyMap<string, FlagGroup>;
  readonly policies: ReadonlyMap<string, FlagPolicy>;
  readonly actions: ReadonlyMap<string, InstructionDefinition>;
  readonly sources: ReadonlyMap<string, ValueSource>;
  readonly operands: ReadonlyMap<string, ChapterOperand>;
  readonly conditions: ReadonlyMap<string, ChapterCondition>;
  readonly catalogues: ReadonlyMap<string, readonly ChapterOperand[]>;
}

export type ActionCapability = "memory" | "boundary";
type Effects = "view" | "state" | ActionCapability | readonly ActionCapability[];
export interface StatementOptions {
  readonly inputs?: Readonly<Record<string, Width>>;
  readonly effects?: Effects;
}

/** Action capabilities are explicit and transitive; lifecycle hooks recheck their narrower contract. */
export function checkStateEffects(steps: readonly Statement[], effects: Effects, allowMatches = true): void {
  const permits = (capability: ActionCapability) => effects === capability || (Array.isArray(effects) && effects.includes(capability));
  for (const step of steps) {
    switch (step.kind) {
      case "capture": case "read-register": case "read-element": case "read-flag": case "read-latch": case "test-choice": break;
      case "choose":
        checkStateEffects(step.yes.steps, effects, allowMatches); checkStateEffects(step.no.steps, effects, allowMatches); break;
      case "when": case "iterate": checkStateEffects(step.steps, effects, allowMatches); break;
      case "match": case "dispatch":
        if (effects === "view") throw new Error("Views may only read stored state; byte matches can reject.");
        if (!allowMatches) throw new Error("Execution actions cannot reject through byte matches.");
        step.cases.forEach(branch => checkStateEffects(branch.steps, effects, allowMatches)); break;
      case "read-source": checkStateEffects(step.source.steps, effects, allowMatches); break;
      case "perform": checkStateEffects(step.action.steps, effects, allowMatches); break;
      case "write-register": case "write-element": case "fill-array": case "write-latch": case "write-choice": case "update-flags": case "replace-flags": case "exchange-flags":
        if (effects !== "view") break;
        throw new Error("Views may only read stored state.");
      case "read-memory": case "write-memory":
        if (permits("memory")) break;
        throw new Error("Views and state actions cannot fetch instructions or access memory without using memory.");
      case "read-test": case "send-escape": case "report-interrupt": case "defer-interrupt": case "notify-reti":
        if (permits("boundary")) break;
        throw new Error("Actions need using boundary for CPU boundaries; views cannot access CPU boundaries.");
      default: throw new Error("Views and actions cannot fetch instructions or access ports or CPU boundaries.");
    }
  }
}

/** Lower ordered effects, checking each prefix in its enclosing lexical scopes. */
export function chapterStatements(lines: readonly ChapterTokens[], symbols: Symbols, options: StatementOptions = {}): Statement[] {
  const { cpu, registers, arrays, latches, choices, flags, flagGroups, policies, actions, sources, operands, conditions } = symbols;
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
      } else if (tokens.next === "exchange" && tokens.peek(1) !== "=") {
        tokens.expect("exchange");
        const left = tokens.lookup(flagGroups, true); tokens.expect(",");
        result.push(exchangeFlags(left, tokens.lookup(flagGroups, true)));
      } else if (tokens.take("perform")) {
        const action = tokens.lookup(actions); tokens.expect("(");
        const args: Record<string, NumberExpression> = {};
        for (const [index, name] of Object.keys(action.inputs ?? {}).entries()) {
          if (index) tokens.expect(","); args[name] = expression(tokens);
        }
        tokens.expect(")"); result.push(perform(action, args));
      } else if (tokens.take("reject")) {
        const failure = reject(tokens.quoted());
        result.push(tokens.take("if") ? when(flagExpression(tokens), [failure]) : failure);
      } else if (tokens.take("fault")) {
        tokens.expect("alignment"); const program = tokens.take("program"); const operation = tokens.word();
        if (operation !== "read" && operation !== "write") return tokens.fail("Expected a read or write alignment fault.");
        tokens.expect("("); const address = expression(tokens); tokens.expect(")"); tokens.expect("if");
        result.push(when(flagExpression(tokens), [alignmentFault(operation, address, program ? "program" : "data")]));
      } else if (tokens.take("defer")) {
        const scope = tokens.word();
        if (scope !== "irq" && scope !== "intr" && scope !== "all") return tokens.fail("Expected irq, intr, or all deferral scope.");
        result.push(deferInterrupt(scope));
      } else if (tokens.next === "notify" && tokens.peek(1) !== "=") {
        tokens.expect("notify"); tokens.expect("reti"); result.push(notifyReti());
      } else if (tokens.next === "report" && tokens.peek(1) !== "=") {
        tokens.expect("report"); tokens.expect("interrupt"); tokens.expect("("); result.push(reportInterrupt(expression(tokens))); tokens.expect(")");
      } else if (tokens.next === "send" && tokens.peek(1) !== "=") {
        tokens.expect("send"); tokens.expect("escape"); tokens.expect("("); const opcode = expression(tokens); tokens.expect(",");
        const modRM = expression(tokens); tokens.expect(")");
        if (tokens.take("with")) {
          tokens.expect("memory"); tokens.expect("("); const segment = expression(tokens); tokens.expect(","); const offset = expression(tokens); tokens.expect(",");
          const physical = address(tokens); tokens.expect(","); const contents = expression(tokens); tokens.expect(")");
          result.push(sendEscape({ opcode, modRM, memory: { segment, offset, address: physical, value: contents } }));
        } else result.push(sendEscape({ opcode, modRM }));
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
        const memory = tokens.word() === "memory";
        tokens.expect("(");
        if (memory) {
          const target = address(tokens); tokens.expect(")"); tokens.expect("<-"); result.push(writeMemory(target, expression(tokens)));
        } else {
          const target = expression(tokens); tokens.expect(")"); tokens.expect("<-"); result.push(writePort(target, expression(tokens)));
        }
      } else {
        const name = tokens.reference();
        if (tokens.take(",")) {
          const remainder = tokens.word(); tokens.expect("="); tokens.expect("divide"); tokens.expect("(");
          const dividend = expression(tokens); tokens.expect(","); const divisor = expression(tokens); tokens.expect(",");
          const signed = signedness(tokens); tokens.expect(")"); tokens.expect("otherwise");
          result.push(divide({ quotient: name, remainder, dividend, divisor, signed, onError: tokens.quoted() }));
        } else if (tokens.take("[")) {
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
          if (tokens.take("choose")) {
            const { body, end } = chapterBody(lines, index); index = end;
            result.push(chapterChoose(tokens, body, name, (body, check) => parse(body, check, selectedOperands),
              step => validate([...result, step])));
          } else if (tokens.take("match")) {
            const { body, end } = chapterBody(lines, index); index = end;
            result.push(chapterMatch(tokens, body, name, symbols.catalogues, selectedOperands,
              (body, selected, check) => parse(body, check, selected), step => validate([...result, step])));
          } else if (tokens.take("iterate")) {
            tokens.expect("("); const count = expression(tokens); tokens.expect(","); const initial = expression(tokens);
            tokens.expect(")"); tokens.expect("{"); tokens.end();
            const { body, end } = chapterBody(lines, index); index = end;
            const last = body.pop() ?? tokens.fail("An iteration must end with return.");
            if (last.next !== "return") last.fail("An iteration must end with return.");
            const check = (steps: readonly Statement[]) => validate([...result, iterate(name, count, initial, steps, value(name))]);
            tokens.checked(() => check([]));
            const steps = parse(body, check, selectedOperands);
            last.expect("return"); const contents = expression(last); last.end();
            const iteration = iterate(name, count, initial, steps, contents);
            last.checked(() => validate([...result, iteration]));
            result.push(iteration);
          } else if (tokens.take("resolve")) {
            tokens.expect("("); const size = tokens.number();
            if (size !== 8 && size !== 16 && size !== 32) return tokens.fail("Operand size must be 8, 16, or 32.");
            tokens.expect(","); const mode = expression(tokens); tokens.expect(","); const code = expression(tokens); tokens.expect(")");
            result.push(resolveAddress(name, size, mode, code));
          } else if (tokens.take("fetch")) result.push(tokens.take("word") ? fetchWord(name) : fetchByte(name));
          else if (tokens.next === "sample" && tokens.peek(1) === "test") {
            tokens.expect("sample"); tokens.expect("test"); result.push(readTest(name));
          }
          else if (tokens.take("choice")) {
            const choice = tokens.lookup(choices, true); tokens.expect("=");
            result.push(testChoice(name, choice, tokens.choiceValue()));
          } else if (tokens.take("flag")) result.push(readFlag(name, tokens.lookup(flags, true)));
          else if (tokens.take("latch")) result.push(readLatch(name, tokens.lookup(latches, true)));
          else if (tokens.take("register")) result.push(readRegister(name, tokens.lookup(registers, true)));
          else if (tokens.take("array")) {
            const array = tokens.lookup(arrays, true); tokens.expect("[");
            result.push(readElement(name, array, expression(tokens))); tokens.expect("]");
          } else if (tokens.take("source")) {
            const source = tokens.lookup(sources), args: Record<string, NumberExpression> = {};
            if (tokens.take("(")) {
              for (const [index, parameter] of Object.keys(source.inputs ?? {}).entries()) {
                if (index) tokens.expect(","); args[parameter] = expression(tokens);
              }
              tokens.expect(")");
            }
            result.push(readSource(name, source, Object.keys(args).length ? args : undefined));
          }
          else if (tokens.take("operand")) {
            const operand = tokens.lookup(selectedOperands);
            if (operand.kind === "unsupported") return tokens.fail("Unsupported operands cannot be selected.");
            result.push(operand.kind === "register" ? readRegister(name, operand.register) : readSource(name, operand.read));
          } else if (tokens.next === "program" && tokens.peek(1) === "memory") {
            tokens.expect("program"); tokens.expect("memory"); tokens.expect("(");
            result.push(readProgramMemory(name, expression(tokens))); tokens.expect(")");
          } else if ((tokens.next === "memory" || tokens.next === "port") && tokens.peek(1) === "(") {
            const memory = tokens.word() === "memory";
            tokens.expect("("); result.push(memory ? readMemory(name, address(tokens)) : readPort(name, expression(tokens))); tokens.expect(")");
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

/** Whether a lifecycle binding needs byte memory after its effect contract has been checked. */
export function usesMemory(steps: readonly Statement[]): boolean {
  return steps.some(step => step.kind === "read-memory" || step.kind === "write-memory"
    || ((step.kind === "match" || step.kind === "dispatch") && step.cases.some(branch => usesMemory(branch.steps)))
    || (step.kind === "choose" && (usesMemory(step.yes.steps) || usesMemory(step.no.steps)))
    || (step.kind === "perform" && usesMemory(step.action.steps))
    || (step.kind === "read-source" && usesMemory(step.source.steps))
    || ((step.kind === "when" || step.kind === "iterate") && usesMemory(step.steps)));
}
