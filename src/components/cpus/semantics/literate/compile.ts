import { opcodeFamily, opcodePattern } from "../../opcodes.ts";
import type { OpcodeEntry } from "../../opcodes.ts";
import { memorySource, registerSource } from "../builders.ts";
import { addWrap, bitAnd, capture, concat, extend, fetchByte, isWidth, literal, negative, readMemory, readRegister,
  readSource, updateFlags, value, writeMemory, writeRegister, zero } from "../model.ts";
import type { CpuDeclaration, Flag, FlagPolicy, InstructionDefinition, NumberExpression, Register, Statement, ValueSource, Width } from "../model.ts";
import { defineInstruction, validateInstruction } from "../validate.ts";
import { chapterBlocks, ChapterError, ChapterTokens } from "./document.ts";

export type ChapterMode = { readonly name: string; readonly read: ValueSource } & (
  | { readonly kind: "memory"; readonly address: ValueSource }
  | { readonly kind: "register"; readonly register: Register }
  | { readonly kind: "value" }
);
interface Selector { readonly choices: readonly ChapterMode[]; readonly view: "read" | "address" | "operand" }
export interface CpuChapter {
  readonly sources: Readonly<Record<string, ValueSource>>;
  readonly policies: Readonly<Record<string, FlagPolicy>>;
  readonly modes: Readonly<Record<string, readonly ChapterMode[]>>;
  readonly families: Readonly<Record<string, readonly OpcodeEntry<InstructionDefinition>[]>>;
}

/** Compile a bounded literate language to the existing IR, without evaluating host-language code. */
export function compileCpuChapter(markdown: string, cpu: CpuDeclaration, file = "<chapter>"): CpuChapter {
  const registers = new Map<string, Register>(), flags = new Map<string, Flag>();
  const sources = new Map<string, ValueSource>(), policies = new Map<string, FlagPolicy>();
  const modes = new Map<string, readonly ChapterMode[]>(), families = new Map<string, readonly OpcodeEntry<InstructionDefinition>[]>();
  const names = new Set<string>(), opcodes = new Set<number>();
  let declared = false;

  function checked<T>(tokens: ChapterTokens, operation: () => T): T {
    try { return operation(); } catch (error) {
      if (error instanceof ChapterError) throw error;
      return tokens.fail(error instanceof Error ? error.message : String(error), 1);
    }
  }
  function lookup<T>(table: ReadonlyMap<string, T>, tokens: ChapterTokens): T {
    const column = tokens.column, name = tokens.word();
    return table.get(name) ?? tokens.fail(`Unknown name ${name}; declare it before use.`, column);
  }
  function declare(tokens: ChapterTokens): string {
    const column = tokens.column, name = tokens.word();
    if (names.has(name)) tokens.fail(`Duplicate declaration ${name}.`, column);
    names.add(name); return name;
  }
  function width(tokens: ChapterTokens): Width {
    const bits = tokens.number();
    return isWidth(bits) ? bits : tokens.fail("Expected width 3, 8, 14, 16, or 32.");
  }
  function expression(tokens: ChapterTokens): NumberExpression {
    const name = tokens.word();
    if (!tokens.take("(")) return value(name);
    let result: NumberExpression;
    if (/^u(?:3|8|14|16|32)$/.test(name)) {
      const bits = Number(name.slice(1));
      if (!isWidth(bits)) return tokens.fail("Unsupported literal width.");
      result = literal(bits, tokens.number());
    } else {
      if (!["add", "and", "concat", "extend"].includes(name)) tokens.fail(`Unknown numeric operation ${name}.`);
      const left = expression(tokens); tokens.expect(",");
      result = name === "extend" ? extend(left, width(tokens))
        : (name === "add" ? addWrap : name === "and" ? bitAnd : concat)(left, expression(tokens));
    }
    tokens.expect(")"); return result;
  }
  function steps(lines: readonly ChapterTokens[], bindings: ReadonlyMap<string, ValueSource> = sources,
    operands: ReadonlyMap<string, ChapterMode> = new Map()): Statement[] {
    const result: Statement[] = [];
    // Lowering a memory destination needs a capture. Keep it distinct from every authored
    // name, including later references, so it cannot collide with or become visible to the author.
    const usedNames = new Set(lines.flatMap(tokens => tokens.source.text.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []));
    let nextTemporary = 0;
    const temporary = () => {
      let name: string;
      do { name = `destinationAddress${nextTemporary++}`; } while (usedNames.has(name));
      return name;
    };
    for (const tokens of lines) {
      if (tokens.take("apply")) {
        const policy = lookup(policies, tokens); tokens.expect("(");
        const args: Record<string, NumberExpression> = {};
        for (const [index, name] of Object.keys(policy.parameters).entries()) {
          if (index) tokens.expect(","); args[name] = expression(tokens);
        }
        tokens.expect(")"); result.push(updateFlags(policy, args));
      } else if (tokens.take("operand")) {
        const operand = lookup(operands, tokens); tokens.expect("<-"); const contents = expression(tokens);
        if (operand.kind === "value") tokens.fail("A value-only operand cannot be written.");
        if (operand.kind === "register") result.push(writeRegister(operand.register, contents));
        if (operand.kind === "memory") {
          const address = temporary();
          result.push(readSource(address, operand.address), writeMemory(value(address), contents));
        }
      } else if (tokens.take("memory")) {
        tokens.expect("("); const address = expression(tokens); tokens.expect(")"); tokens.expect("<-");
        result.push(writeMemory(address, expression(tokens)));
      } else {
        const name = tokens.word();
        if (tokens.take("<-")) {
          const register = registers.get(name) ?? tokens.fail(`Unknown register ${name}.`);
          result.push(writeRegister(register, expression(tokens)));
        } else {
          tokens.expect("=");
          if (tokens.take("fetch")) result.push(fetchByte(name));
          else if (tokens.take("register")) result.push(readRegister(name, lookup(registers, tokens)));
          else if (tokens.take("source")) result.push(readSource(name, lookup(bindings, tokens)));
          else if (tokens.take("operand")) {
            const operand = lookup(operands, tokens);
            result.push(operand.kind === "register" ? readRegister(name, operand.register) : readSource(name, operand.read));
          }
          else if (tokens.take("memory")) {
            tokens.expect("("); result.push(readMemory(name, expression(tokens))); tokens.expect(")");
          } else result.push(capture(name, expression(tokens)));
        }
      }
      tokens.end();
      // Validate each prefix so width/scope errors point to the statement that introduced them.
      checked(tokens, () => validateInstruction({ cpu, name: "chapter", explanation: "", steps: result }));
    }
    return result;
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
      const name = declare(header);
      if (kind === "register" || kind === "flag") {
        if (name !== name.toUpperCase()) header.fail("Register and flag names must be uppercase.");
        const field = name.toLowerCase();
        if (kind === "register") {
          header.expect(":"); const bits = width(header), stored = cpu.state[field];
          if (stored?.kind !== "unsigned" || stored.bits !== bits) header.fail(`Register ${name} does not match the CPU state schema.`);
          registers.set(name, { kind: "register", cpu: cpu.name, field, width: bits });
        } else {
          const stored = cpu.state.flags;
          if (stored?.kind !== "group" || stored.fields[field]?.kind !== "flag") header.fail(`Unknown CPU flag ${name}.`);
          flags.set(name, { kind: "flag", cpu: cpu.name, field });
        }
        header.end(); continue;
      }
      // Keep the original lines: family templates are parsed afresh for each selected mode.
      const body: ChapterTokens[] = [];
      while (++index < lines.length && lines[index]!.next !== "}") body.push(lines[index]!);
      if (index === lines.length) header.fail("Expected a closing } in this cpu fence.");
      lines[index]!.expect("}"); lines[index]!.end();
      const open = () => { header.expect("{"); header.end(); };
      if (kind === "source") {
        const description = header.quoted(); header.expect(":"); const bits = width(header); open();
        const last = body.at(-1) ?? header.fail("A source must end with return.");
        if (last.next !== "return") header.fail("A source must end with return.");
        const bodySteps = steps(body.slice(0, -1));
        last.expect("return"); const result = expression(last); last.end();
        const source = { name: description, width: bits, steps: bodySteps, result };
        checked(last, () => validateInstruction({ cpu, name, explanation: "", steps: [readSource("result", source)] }));
        sources.set(name, source);
      } else if (kind === "policy") {
        const description = header.quoted(); header.expect("("); const parameter = header.word(); header.expect(":");
        const bits = width(header); header.expect(")"); open();
        const updates: FlagPolicy["updates"][number][] = [], seen = new Set<string>();
        for (const tokens of body) {
          const flag = lookup(flags, tokens); tokens.expect("="); const operation = tokens.word(); tokens.expect("(");
          if (seen.has(flag.field)) tokens.fail(`Duplicate update of ${flag.field}.`);
          seen.add(flag.field);
          if (operation !== "negative" && operation !== "zero") tokens.fail(`Unknown flag operation ${operation}.`);
          updates.push({ flag, value: (operation === "negative" ? negative : zero)(expression(tokens)) });
          tokens.expect(")"); tokens.end();
        }
        const policy: FlagPolicy = { name: description, parameters: { [parameter]: bits }, unlisted: "preserve", updates };
        checked(header, () => validateInstruction({ cpu, name, explanation: "", inputs: { [parameter]: bits },
          steps: [updateFlags(policy, { [parameter]: value(parameter) })] }));
        policies.set(name, policy);
      } else if (kind === "modes") {
        open(); const entries: ChapterMode[] = []; let digits: number | undefined;
        for (const tokens of body) {
          const code = tokens.digits(); digits ??= code.length;
          if (!/^[01]+$/.test(code) || code.length !== digits || parseInt(code, 2) !== entries.length) {
            tokens.fail("Mode codes must be consecutive binary values of equal width, starting at zero.");
          }
          const description = tokens.quoted(); tokens.expect("="); const modeKind = tokens.word();
          if (modeKind === "register") {
            const register = lookup(registers, tokens);
            entries.push({ kind: "register", name: description, register, read: registerSource(register) });
          } else {
            if (modeKind !== "memory" && modeKind !== "value") tokens.fail("Expected register, memory, or value mode.");
            const source = lookup(sources, tokens);
            if (modeKind === "memory" && source.width !== 16) tokens.fail("Memory modes require a 16-bit address source.");
            entries.push(modeKind === "memory" ? { kind: "memory", name: description, address: source, read: memorySource(source) }
              : { kind: "value", name: description, read: source });
          }
          tokens.end();
        }
        if (digits === undefined || entries.length !== 2 ** digits) header.fail("Modes must describe every value of their selector.");
        modes.set(name, entries);
      } else if (kind === "family") {
        const pattern = header.quoted(); header.expect("for");
        const selectors = new Map<string, Selector>();
        do {
          const selector = header.word(); header.expect("in"); const choices = lookup(modes, header);
          const requested = header.take(".") ? header.word() : "operand";
          if (selectors.has(selector)) header.fail(`Duplicate selector ${selector}.`);
          if (names.has(selector)) header.fail("A family selector must not shadow a source or other declaration.");
          const view = requested === "read" || requested === "address" || requested === "operand" ? requested
            : header.fail("Select modes.read or modes.address, or an operand catalogue.");
          selectors.set(selector, { choices, view });
        } while (header.take(","));
        const template = header.take("named") ? header.quoted() : undefined;
        if (template === undefined && selectors.size !== 1) header.fail("A multi-selector family needs an explicit instruction name template.");
        // Substitution happens once over authored text; braces in operand labels stay literal.
        const instructionName = (selected: Readonly<Record<string, ChapterMode>>) => template === undefined
          ? `${name} ${Object.values(selected)[0]!.name}`
          : template.replace(/\{([^{}]*)\}|[{}]/g, (placeholder, field: string | undefined) =>
            field !== undefined && Object.hasOwn(selected, field) ? selected[field]!.name : header.fail(`Unknown name placeholder ${placeholder}.`));
        const excluded = new Set<number>();
        if (header.take("except")) do {
          for (const [opcode] of checked(header, () => opcodePattern(header.quoted(), undefined))) {
            if (excluded.has(opcode)) header.fail(`Duplicate exclusion $${opcode.toString(16)}.`);
            excluded.add(opcode);
          }
        } while (header.take(","));
        open();
        if (!block.explanation) header.fail("A family needs an explanatory paragraph before its cpu fence.");
        const choices = Object.fromEntries([...selectors].map(([selector, { choices }]) => [selector, choices]));
        const entries = checked(header, () => opcodeFamily(pattern, choices, selected => selected));
        for (const opcode of excluded) if (!entries.some(([candidate]) => opcode === candidate)) header.fail(`Excluded opcode $${opcode.toString(16)} is outside this family.`);
        const definitions: OpcodeEntry<InstructionDefinition>[] = [];
        for (const [opcode, selected] of entries) {
          if (excluded.has(opcode)) continue;
          const bindings = new Map(sources), operands = new Map<string, ChapterMode>();
          let available = true;
          for (const [selector, { view }] of selectors) {
            const mode = selected[selector]!;
            if (view === "operand") operands.set(selector, mode);
            else if (view === "read") bindings.set(selector, mode.read);
            else if (mode.kind === "memory") bindings.set(selector, mode.address);
            else available = false; // Only memory modes supply an address view.
          }
          if (!available) continue;
          if (opcodes.has(opcode)) header.fail(`Duplicate opcode $${opcode.toString(16)}.`);
          opcodes.add(opcode);
          const bodySteps = steps(body.map(tokens => new ChapterTokens(tokens.source, file)), bindings, operands);
          definitions.push([opcode, checked(header, () => defineInstruction({ cpu, name: instructionName(selected),
            explanation: block.explanation, steps: bodySteps }))]);
        }
        if (!definitions.length) header.fail("A family must define at least one instruction.");
        families.set(name, definitions);
      } else header.fail(`Unknown declaration ${kind}.`);
    }
  }
  if (!declared) throw new ChapterError(file, 1, 1, "Expected a cpu declaration in a cpu fence.");
  return { sources: Object.fromEntries(sources), policies: Object.fromEntries(policies), modes: Object.fromEntries(modes), families: Object.fromEntries(families) };
}
