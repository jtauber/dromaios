import type { StateFields } from "../../state.ts";
import { opcodeFamily, opcodePattern } from "../../opcodes.ts";
import type { OpcodeEntry } from "../../opcodes.ts";
import { memorySource, registerSource } from "../builders.ts";
import { concat, isWidth, literal, readRegister, readSource, value } from "../model.ts";
import type { CpuDeclaration, Flag, FlagPolicy, InstructionDefinition, Latch, Register, RegisterArray, ValueSource, ValueType, Width } from "../model.ts";
import { defineInstruction, validateFlagPolicy, validateInstruction } from "../validate.ts";
import { chapterBlocks, chapterBody, ChapterError, ChapterTokens } from "./document.ts";
import { expression, flagExpression, width } from "./expressions.ts";
import { chapterExecution, checkByteExecution } from "./execution.ts";
import type { ChapterExecution } from "./execution.ts";
import { chapterInterface } from "./interface.ts";
import type { ChapterInterface } from "./interface.ts";
import { chapterState, checkStateSymbol, stateSymbol } from "./state.ts";
import { chapterStatements } from "./statements.ts";
import type { ChapterCondition, ChapterOperand, StatementOptions } from "./statements.ts";
export type { ChapterCondition, ChapterOperand } from "./statements.ts";

type Selection = ChapterOperand | ChapterCondition;
interface Selector { readonly choices: readonly Selection[]; readonly view: "read" | "address" | "operand" }
export interface CpuChapter {
  readonly cpu: string;
  /** Present only when the chapter owns its complete stored-state schema. */
  readonly state?: StateFields;
  readonly execution?: ChapterExecution;
  readonly interface?: ChapterInterface;
  readonly sources: Readonly<Record<string, ValueSource>>;
  readonly views: Readonly<Record<string, ValueSource>>;
  readonly actions: Readonly<Record<string, InstructionDefinition>>;
  readonly policies: Readonly<Record<string, FlagPolicy>>;
  readonly operands: Readonly<Record<string, readonly ChapterOperand[]>>;
  readonly conditions: Readonly<Record<string, readonly ChapterCondition[]>>;
  readonly families: Readonly<Record<string, readonly OpcodeEntry<InstructionDefinition>[]>>;
}

/** Compile a bounded literate language to the existing IR, without evaluating host-language code. */
export function compileCpuChapter(markdown: string, target: { readonly name?: string; readonly state?: StateFields } = {}, file = "<chapter>"): CpuChapter {
  const registers = new Map<string, Register>(), flags = new Map<string, Flag>();
  const arrays = new Map<string, RegisterArray>(), latches = new Map<string, Latch>();
  const sources = new Map<string, ValueSource>(), policies = new Map<string, FlagPolicy>();
  const catalogues = new Map<string, readonly ChapterOperand[]>(), families = new Map<string, readonly OpcodeEntry<InstructionDefinition>[]>();
  const conditions = new Map<string, readonly ChapterCondition[]>();
  const views = new Map<string, ValueSource>(), actions = new Map<string, InstructionDefinition>();
  const names = new Set<string>(), opcodes = new Map<number, ChapterTokens>();
  let declared = false, ownsState = false;
  let execution: ChapterExecution | undefined;
  let publicInterface: ChapterInterface | undefined;
  let cpu: CpuDeclaration = { name: target.name ?? "", state: target.state ?? {} };

  function declare(tokens: ChapterTokens, kind: string): string {
    const column = tokens.column, name = tokens.word();
    // Registers and flags have distinct namespaces: the 8008 has both register C and flag C.
    if (names.has(name) || (kind !== "flag" && registers.has(name)) || (kind !== "register" && flags.has(name))) {
      tokens.fail(`Duplicate declaration ${name}.`, column);
    }
    if (kind !== "register" && kind !== "flag") names.add(name);
    return name;
  }
  function declareState(tokens: ChapterTokens, kind: string, check = false) {
    const name = declare(tokens, kind), symbol = stateSymbol(tokens, kind, name, cpu.name);
    if (check) checkStateSymbol(tokens, name, symbol, cpu);
    switch (symbol.kind) {
      case "register": registers.set(name, symbol); break;
      case "flag": flags.set(name, symbol); break;
      case "register-array": arrays.set(name, symbol); break;
      case "latch": latches.set(name, symbol); break;
    }
    return symbol;
  }
  function steps(lines: readonly ChapterTokens[], options: StatementOptions & {
    readonly bindings?: ReadonlyMap<string, ValueSource>;
    readonly operands?: ReadonlyMap<string, ChapterOperand>;
    readonly conditions?: ReadonlyMap<string, ChapterCondition>;
  } = {}) {
    return chapterStatements(lines, { cpu, registers, arrays, latches, flags, policies,
      sources: options.bindings ?? sources, operands: options.operands ?? new Map(), conditions: options.conditions ?? new Map() }, options);
  }

  const blocks = chapterBlocks(markdown, file);
  for (const block of blocks) {
    const lines = block.lines.map(line => new ChapterTokens(line, file)).filter(line => line.next !== undefined);
    for (let index = 0; index < lines.length; index++) {
      const header = lines[index]!, kind = header.word();
      if (kind === "cpu") {
        if (declared) header.fail("CPU is already declared.");
        const name = header.quoted();
        if (target.name !== undefined && name !== target.name) header.fail(`Expected CPU ${target.name}.`);
        if (!/^[a-z0-9]+$/.test(name)) header.fail("CPU names must contain lowercase letters or digits.");
        cpu = { ...cpu, name };
        declared = true; header.end(); continue;
      }
      if (!declared) header.fail("Declare the CPU before its contents.");
      if (!["state", "execution", "interface", "register", "flag", "array", "latch", "source", "view", "action", "policy", "operands", "codes", "conditions", "family"].includes(kind)) {
        header.fail(`Unknown declaration ${kind}.`, 1);
      }
      if (kind === "state") {
        if (target.state !== undefined || ownsState) header.fail("CPU state is already defined.");
        header.expect("{"); header.end();
        const { body, end } = chapterBody(lines, index); index = end;
        if (body.length === 0) header.fail("State must declare at least one stored field.");
        const declarations = body.map(tokens => ({ symbol: declareState(tokens, tokens.word()), tokens }));
        cpu = { name: cpu.name, state: chapterState(declarations) }; ownsState = true;
        continue;
      }
      if (!ownsState && target.state === undefined) header.fail("Define state before other declarations.");
      if (kind === "interface") {
        if (publicInterface) header.fail("Public interface is already declared.");
        if (!ownsState || !execution) header.fail("A public interface requires chapter-owned state and an earlier execution contract.");
        const { body, end } = chapterBody(lines, index); index = end;
        publicInterface = chapterInterface(header, body, cpu.state, views);
        continue;
      }
      if (kind === "execution") {
        if (execution) header.fail("Execution is already declared.");
        header.expect("{"); header.end();
        const { body, end } = chapterBody(lines, index); index = end;
        execution = chapterExecution(header, body, { views, actions, latches });
        if (execution.retireDeferral !== undefined) cpu = { ...cpu, irqDeferral: true };
        continue;
      }
      if (["register", "flag", "array", "latch"].includes(kind)) {
        if (ownsState) header.fail("Declare stored fields inside the state block.");
        declareState(header, kind, true); continue;
      }
      const name = declare(header, kind);
      // Keep original lines: each family selection reparses its body, including nested blocks.
      const { body, end } = chapterBody(lines, index); index = end;
      const open = () => { header.expect("{"); header.end(); };
      if (kind === "source" || kind === "view") {
        if (kind === "view" && name !== name.toUpperCase()) header.fail("View names must be uppercase.");
        const description = header.quoted(); header.expect(":"); const bits = width(header); open();
        const last = body.at(-1) ?? header.fail("A source must end with return.");
        if (last.next !== "return") header.fail("A source must end with return.");
        const bodySteps = steps(body.slice(0, -1), { effects: kind === "view" ? "view" : undefined });
        last.expect("return"); const result = expression(last); last.end();
        const source = { name: description, width: bits, steps: bodySteps, result };
        last.checked(() => validateInstruction({ cpu, name, explanation: "", steps: [readSource("result", source)] }));
        sources.set(name, source);
        if (kind === "view") views.set(name, source);
      } else if (kind === "action") {
        const description = header.quoted(), inputs: Record<string, Width> = {};
        if (header.take("(")) {
          if (header.next !== ")") do {
            const parameter = header.word(); header.expect(":");
            if (Object.hasOwn(inputs, parameter)) header.fail(`Duplicate parameter ${parameter}.`);
            inputs[parameter] = width(header);
          } while (header.take(","));
          header.expect(")");
        }
        open();
        const definition = { cpu, name: description, explanation: block.explanation, inputs, steps: [] };
        header.checked(() => validateInstruction(definition));
        const bodySteps = steps(body, { inputs, effects: "state" });
        actions.set(name, header.checked(() => defineInstruction({ ...definition, steps: bodySteps })));
      } else if (kind === "policy") {
        const description = header.quoted(); header.expect("(");
        const parameters: Record<string, ValueType> = {};
        if (header.next !== ")") do {
          const parameter = header.word(); header.expect(":");
          if (Object.hasOwn(parameters, parameter)) header.fail(`Duplicate parameter ${parameter}.`);
          parameters[parameter] = header.take("flag") ? "flag" : width(header);
        } while (header.take(","));
        header.expect(")"); open();
        const updates: FlagPolicy["updates"][number][] = [], seen = new Set<string>();
        const policy: FlagPolicy = { name: description, parameters, unlisted: "preserve", updates };
        const validate = () => validateFlagPolicy(cpu, policy);
        header.checked(validate);
        for (const tokens of body) {
          const flag = tokens.lookup(flags); tokens.expect("=");
          if (seen.has(flag.field)) tokens.fail(`Duplicate update of ${flag.field}.`);
          seen.add(flag.field);
          updates.push({ flag, value: flagExpression(tokens) }); tokens.end();
          tokens.checked(validate);
        }
        policies.set(name, policy);
      } else if (kind === "operands" || kind === "codes" || kind === "conditions") {
        const valueWidth = kind === "codes" && header.take(":") ? width(header) : undefined;
        open(); const entries: ChapterOperand[] = [], tests: ChapterCondition[] = []; let digits: number | undefined;
        for (const tokens of body) {
          const code = tokens.digits(); digits ??= code.length;
          const ordinal = entries.length + tests.length;
          if (!/^[01]+$/.test(code) || code.length !== digits || parseInt(code, 2) !== ordinal) {
            tokens.fail("Selector codes must be consecutive binary values of equal width, starting at zero.");
          }
          const description = tokens.quoted();
          if (kind === "codes") {
            const bits = valueWidth ?? digits;
            if (!isWidth(bits)) return tokens.fail("Encoded values require a supported bit width.");
            const contents = tokens.take("=") ? tokens.number() : ordinal;
            if (!Number.isInteger(contents) || contents < 0 || contents >= 2 ** bits) tokens.fail(`Encoded value must fit ${bits} bits.`);
            entries.push({ kind: "value", name: description,
              read: { name: description, width: bits, steps: [], result: literal(bits, contents) } });
          } else if (kind === "conditions") {
            tokens.expect("="); tokens.expect("flag"); const flag = tokens.lookup(flags); tokens.expect("=");
            const expected = flagExpression(tokens);
            if (expected.kind !== "flag-literal") return tokens.fail("A condition must compare its flag with 0 or 1.");
            tests.push({ kind: "condition", name: description, flag, set: expected.value });
          } else {
            tokens.expect("="); const operandKind = tokens.word();
            if (operandKind === "register") {
              const register = tokens.lookup(registers);
              entries.push({ kind: "register", name: description, register, read: registerSource(register) });
            } else if (operandKind === "pair") {
              const high = tokens.lookup(registers), low = tokens.lookup(registers);
              if (high.width !== 8 || low.width !== 8) tokens.fail("Register pairs require two byte registers, high then low.");
              entries.push({ kind: "pair", name: description, high, low,
                read: { name: description, width: 16, steps: [readRegister("high", high), readRegister("low", low)], result: concat(value("high"), value("low")) } });
            } else {
              if (operandKind !== "memory" && operandKind !== "value") tokens.fail("Expected register, pair, memory, or value operand.");
              const source = tokens.lookup(sources);
              if (operandKind === "memory" && source.width !== 16) tokens.fail("Memory operands require a 16-bit address source.");
              entries.push(operandKind === "memory" ? { kind: "memory", name: description, address: source, read: memorySource(source) }
                : { kind: "value", name: description, read: source });
            }
          }
          tokens.end();
        }
        if (digits === undefined || entries.length + tests.length !== 2 ** digits) header.fail("A catalogue must describe every value of its selector.");
        if (kind === "conditions") conditions.set(name, tests); else catalogues.set(name, entries);
      } else if (kind === "family") {
        const forms: ChapterTokens[] = [], definitions: OpcodeEntry<InstructionDefinition>[] = [];
        if (header.next === "{") {
          open();
          while (body[0]?.take("encoding")) forms.push(body.shift()!);
          if (!forms.length) header.fail("A family needs at least one encoding.");
        } else forms.push(header);
        for (const form of forms) {
          const firstDefinition = definitions.length;
          const pattern = form.quoted();
          const selectors = new Map<string, Selector>();
          if (form.take("for")) do {
            const selector = form.word(); form.expect("in");
            const choices = form.lookup(new Map<string, readonly Selection[]>([...catalogues, ...conditions]));
            const requested = form.take(".") ? form.word() : "operand";
            if (selectors.has(selector)) form.fail(`Duplicate selector ${selector}.`);
            if (names.has(selector) || registers.has(selector) || flags.has(selector)) form.fail("A family selector must not shadow a source or other declaration.");
            const view = requested === "read" || requested === "address" || requested === "operand" ? requested
              : form.fail("Select a catalogue with .read, .address, or no suffix for operands.");
            if (view !== "operand" && choices[0]?.kind === "condition") form.fail("Conditions have no numeric source view.");
            selectors.set(selector, { choices, view });
          } while (form.take(","));
          const boundSources = new Map(sources), aliases = new Set<string>();
          if (form.take("with")) do {
            const alias = form.word(); form.expect("=");
            if (names.has(alias) || registers.has(alias) || flags.has(alias) || selectors.has(alias) || aliases.has(alias)) {
              form.fail(`Source binding ${alias} must not shadow a declaration or another binding.`);
            }
            aliases.add(alias); boundSources.set(alias, form.lookup(sources));
          } while (form.take(","));
          const template = form.take("named") ? form.quoted() : undefined;
          if (template === undefined && selectors.size > 1) form.fail("A multi-selector family needs an explicit instruction name template.");
          // Substitution happens once over authored text; braces in operand labels stay literal.
          const instructionName = (selected: Readonly<Record<string, Selection>>) => template === undefined
            ? [name, ...Object.values(selected).map(operand => operand.name)].join(" ")
            : template.replace(/\{([^{}]*)\}|[{}]/g, (placeholder, field: string | undefined) =>
              field !== undefined && Object.hasOwn(selected, field) ? selected[field]!.name : form.fail(`Unknown name placeholder ${placeholder}.`));
          const excluded = new Set<number>();
          if (form.take("except")) do {
            for (const [opcode] of form.checked(() => opcodePattern(form.quoted(), undefined))) {
              if (excluded.has(opcode)) form.fail(`Duplicate exclusion $${opcode.toString(16)}.`);
              excluded.add(opcode);
            }
          } while (form.take(","));
          if (form === header) open(); else form.end();
          if (!block.explanation) form.fail("A family needs an explanatory paragraph before its cpu fence.");
          const choices = Object.fromEntries([...selectors].map(([selector, { choices }]) => [selector, choices]));
          const entries = form.checked(() => opcodeFamily(pattern, choices, selected => selected));
          for (const opcode of excluded) if (!entries.some(([candidate]) => opcode === candidate)) form.fail(`Excluded opcode $${opcode.toString(16)} is outside this family.`);
          for (const [opcode, selected] of entries) {
            if (excluded.has(opcode)) continue;
            const bindings = new Map(boundSources), operands = new Map<string, ChapterOperand>();
            const selectedConditions = new Map<string, ChapterCondition>();
            let available = true;
            for (const [selector, { view }] of selectors) {
              const operand = selected[selector]!;
              if (operand.kind === "condition") selectedConditions.set(selector, operand);
              else if (view === "operand") operands.set(selector, operand);
              else if (view === "read") bindings.set(selector, operand.read);
              else if (operand.kind === "memory") bindings.set(selector, operand.address);
              else available = false; // Only memory operands supply an address view.
            }
            if (!available) continue;
            if (opcodes.has(opcode)) form.fail(`Duplicate opcode $${opcode.toString(16)}.`);
            opcodes.set(opcode, form);
            const bodySteps = steps(body.map(tokens => new ChapterTokens(tokens.source, file)), { bindings, operands, conditions: selectedConditions });
            definitions.push([opcode, form.checked(() => defineInstruction({ cpu, name: instructionName(selected),
              explanation: block.explanation, steps: bodySteps }))]);
          }
          if (definitions.length === firstDefinition) form.fail("An encoding must define at least one instruction.");
        }
        families.set(name, definitions);
      }
    }
  }
  if (!declared) throw new ChapterError(file, 1, 1, "Expected a cpu declaration in a cpu fence.");
  if (!ownsState && target.state === undefined) throw new ChapterError(file, 1, 1, "Expected a state block.");
  if (execution) for (const entries of families.values()) for (const [opcode, definition] of entries) {
    const tokens = opcodes.get(opcode)!;
    if (opcode > 0xff) tokens.fail("Byte execution requires one-byte opcodes.");
    tokens.checked(() => checkByteExecution(definition.steps, execution.retireDeferral !== undefined));
  }
  return { cpu: cpu.name, ...(ownsState ? { state: cpu.state } : {}), ...(execution ? { execution } : {}), ...(publicInterface ? { interface: publicInterface } : {}), sources: Object.fromEntries(sources), views: Object.fromEntries(views), actions: Object.fromEntries(actions), policies: Object.fromEntries(policies), operands: Object.fromEntries(catalogues), conditions: Object.fromEntries(conditions), families: Object.fromEntries(families) };
}
