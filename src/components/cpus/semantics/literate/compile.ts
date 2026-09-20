import { opcodeFamily, opcodePattern } from "../../opcodes.ts";
import type { OpcodeEntry } from "../../opcodes.ts";
import { memorySource, registerSource } from "../builders.ts";
import { isWidth, literal, readSource } from "../model.ts";
import type { CpuDeclaration, Flag, FlagPolicy, InstructionDefinition, Latch, Register, RegisterArray, ValueSource, ValueType } from "../model.ts";
import { defineInstruction, validateFlagPolicy, validateInstruction } from "../validate.ts";
import { chapterBlocks, chapterBody, ChapterError, ChapterTokens } from "./document.ts";
import { expression, flagExpression, width } from "./expressions.ts";
import { chapterStatements } from "./statements.ts";
import type { ChapterCondition, ChapterOperand } from "./statements.ts";
export type { ChapterCondition, ChapterOperand } from "./statements.ts";

type Selection = ChapterOperand | ChapterCondition;
interface Selector { readonly choices: readonly Selection[]; readonly view: "read" | "address" | "operand" }
export interface CpuChapter {
  readonly sources: Readonly<Record<string, ValueSource>>;
  readonly policies: Readonly<Record<string, FlagPolicy>>;
  readonly operands: Readonly<Record<string, readonly ChapterOperand[]>>;
  readonly conditions: Readonly<Record<string, readonly ChapterCondition[]>>;
  readonly families: Readonly<Record<string, readonly OpcodeEntry<InstructionDefinition>[]>>;
}

/** Compile a bounded literate language to the existing IR, without evaluating host-language code. */
export function compileCpuChapter(markdown: string, cpu: CpuDeclaration, file = "<chapter>"): CpuChapter {
  const registers = new Map<string, Register>(), flags = new Map<string, Flag>();
  const arrays = new Map<string, RegisterArray>(), latches = new Map<string, Latch>();
  const sources = new Map<string, ValueSource>(), policies = new Map<string, FlagPolicy>();
  const catalogues = new Map<string, readonly ChapterOperand[]>(), families = new Map<string, readonly OpcodeEntry<InstructionDefinition>[]>();
  const conditions = new Map<string, readonly ChapterCondition[]>();
  const names = new Set<string>(), opcodes = new Set<number>();
  let declared = false;

  function declare(tokens: ChapterTokens, kind: string): string {
    const column = tokens.column, name = tokens.word();
    // Registers and flags have distinct namespaces: the 8008 has both register C and flag C.
    if (names.has(name) || (kind !== "flag" && registers.has(name)) || (kind !== "register" && flags.has(name))) {
      tokens.fail(`Duplicate declaration ${name}.`, column);
    }
    if (kind !== "register" && kind !== "flag") names.add(name);
    return name;
  }
  function steps(lines: readonly ChapterTokens[], bindings: ReadonlyMap<string, ValueSource> = sources,
    operands: ReadonlyMap<string, ChapterOperand> = new Map(), selectedConditions: ReadonlyMap<string, ChapterCondition> = new Map()) {
    return chapterStatements(lines, { cpu, registers, arrays, latches, flags, policies, sources: bindings, operands, conditions: selectedConditions });
  }

  const blocks = chapterBlocks(markdown, file);
  for (const block of blocks) {
    const lines = block.lines.map(line => new ChapterTokens(line, file)).filter(line => line.next !== undefined);
    for (let index = 0; index < lines.length; index++) {
      const header = lines[index]!, kind = header.word();
      if (kind === "cpu") {
        if (declared) header.fail("CPU is already declared.");
        if (header.quoted() !== cpu.name) header.fail(`Expected CPU ${cpu.name}.`);
        declared = true; header.end(); continue;
      }
      if (!declared) header.fail("Declare the CPU before its contents.");
      if (!["register", "flag", "array", "latch", "source", "policy", "operands", "codes", "conditions", "family"].includes(kind)) {
        header.fail(`Unknown declaration ${kind}.`, 1);
      }
      const name = declare(header, kind);
      if (kind === "register" || kind === "flag" || kind === "array" || kind === "latch") {
        if (name !== name.toUpperCase()) header.fail("Register, flag, array, and latch names must be uppercase.");
        if (kind === "register" || kind === "array") {
          header.expect(":"); const bits = width(header);
          let length = 0;
          if (kind === "array") { header.expect("["); length = header.number(); header.expect("]"); }
          const field = header.take("=") ? header.word() : name.toLowerCase(), stored = cpu.state[field];
          if (kind === "register") {
            if (stored?.kind !== "unsigned" || stored.bits !== bits) header.fail(`Register ${name} does not match the CPU state schema.`);
            registers.set(name, { kind: "register", cpu: cpu.name, field, width: bits });
          } else {
            if (stored?.kind !== "array" || stored.element.bits !== bits || stored.length !== length) header.fail(`Array ${name} does not match the CPU state schema.`);
            arrays.set(name, { kind: "register-array", cpu: cpu.name, field, width: bits, length });
          }
        } else {
          const field = header.take("=") ? header.word() : name.toLowerCase();
          if (kind === "flag") {
            const stored = cpu.state.flags;
            if (stored?.kind !== "group" || stored.fields[field]?.kind !== "flag") header.fail(`Unknown CPU flag ${name}.`);
            flags.set(name, { kind: "flag", cpu: cpu.name, field });
          } else {
            if (cpu.state[field]?.kind !== "boolean") header.fail(`Latch ${name} does not match the CPU state schema.`);
            latches.set(name, { kind: "latch", cpu: cpu.name, field });
          }
        }
        header.end(); continue;
      }
      // Keep original lines: each family selection reparses its body, including nested blocks.
      const { body, end } = chapterBody(lines, index); index = end;
      const open = () => { header.expect("{"); header.end(); };
      if (kind === "source") {
        const description = header.quoted(); header.expect(":"); const bits = width(header); open();
        const last = body.at(-1) ?? header.fail("A source must end with return.");
        if (last.next !== "return") header.fail("A source must end with return.");
        const bodySteps = steps(body.slice(0, -1));
        last.expect("return"); const result = expression(last); last.end();
        const source = { name: description, width: bits, steps: bodySteps, result };
        last.checked(() => validateInstruction({ cpu, name, explanation: "", steps: [readSource("result", source)] }));
        sources.set(name, source);
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
            } else {
              if (operandKind !== "memory" && operandKind !== "value") tokens.fail("Expected register, memory, or value operand.");
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
            opcodes.add(opcode);
            const bodySteps = steps(body.map(tokens => new ChapterTokens(tokens.source, file)), bindings, operands, selectedConditions);
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
  return { sources: Object.fromEntries(sources), policies: Object.fromEntries(policies), operands: Object.fromEntries(catalogues), conditions: Object.fromEntries(conditions), families: Object.fromEntries(families) };
}
