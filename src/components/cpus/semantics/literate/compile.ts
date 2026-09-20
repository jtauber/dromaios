import { opcodeFamily, opcodePattern } from "../../opcodes.ts";
import type { OpcodeEntry } from "../../opcodes.ts";
import { memorySource, registerSource } from "../builders.ts";
import { addWrap, alignmentFault, bitAnd, bitOr, capture, commitAddressUpdates, concat, extend, fetchByte,
  flagLiteral, highByte, isWidth, literal, lowBit, lowByte, negative, readMemory, readRegister,
  readSource, resolveAddress, truncate, updateFlags, value, when, writeMemory, writeRegister, zero } from "../model.ts";
import type { CpuDeclaration, Flag, FlagExpression, FlagPolicy, InstructionDefinition, NumberExpression, Register, Statement, ValueSource, Width } from "../model.ts";
import { defineInstruction, validateInstruction } from "../validate.ts";
import { chapterBlocks, ChapterError, ChapterTokens } from "./document.ts";

export type ChapterOperand = { readonly name: string; readonly read: ValueSource } & (
  | { readonly kind: "memory"; readonly address: ValueSource }
  | { readonly kind: "register"; readonly register: Register }
  | { readonly kind: "value" }
);
interface Selector { readonly choices: readonly ChapterOperand[]; readonly view: "read" | "address" | "operand" }
export interface CpuChapter {
  readonly sources: Readonly<Record<string, ValueSource>>;
  readonly policies: Readonly<Record<string, FlagPolicy>>;
  readonly operands: Readonly<Record<string, readonly ChapterOperand[]>>;
  readonly families: Readonly<Record<string, readonly OpcodeEntry<InstructionDefinition>[]>>;
}

/** Compile a bounded literate language to the existing IR, without evaluating host-language code. */
export function compileCpuChapter(markdown: string, cpu: CpuDeclaration, file = "<chapter>"): CpuChapter {
  const registers = new Map<string, Register>(), flags = new Map<string, Flag>();
  const sources = new Map<string, ValueSource>(), policies = new Map<string, FlagPolicy>();
  const catalogues = new Map<string, readonly ChapterOperand[]>(), families = new Map<string, readonly OpcodeEntry<InstructionDefinition>[]>();
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
    } else if (name === "highByte" || name === "lowByte") {
      result = (name === "highByte" ? highByte : lowByte)(expression(tokens));
    } else if (name === "extend" || name === "truncate") {
      const contents = expression(tokens); tokens.expect(",");
      result = (name === "extend" ? extend : truncate)(contents, width(tokens));
    } else {
      const operations = { add: addWrap, and: bitAnd, or: bitOr, concat };
      if (!Object.hasOwn(operations, name)) tokens.fail(`Unknown numeric operation ${name}.`);
      const left = expression(tokens); tokens.expect(",");
      result = operations[name as keyof typeof operations](left, expression(tokens));
    }
    tokens.expect(")"); return result;
  }
  function flagExpression(tokens: ChapterTokens): FlagExpression {
    if (tokens.take("0")) return flagLiteral(false);
    if (tokens.take("1")) return flagLiteral(true);
    const name = tokens.word(), operations = { negative, zero, lowBit };
    if (!Object.hasOwn(operations, name)) tokens.fail(`Unknown flag operation ${name}.`);
    tokens.expect("("); const result = operations[name as keyof typeof operations](expression(tokens));
    tokens.expect(")"); return result;
  }
  function steps(lines: readonly ChapterTokens[], bindings: ReadonlyMap<string, ValueSource> = sources,
    operands: ReadonlyMap<string, ChapterOperand> = new Map()): Statement[] {
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
      if (tokens.take("fault")) {
        tokens.expect("alignment"); const operation = tokens.word();
        if (operation !== "read" && operation !== "write") tokens.fail("Expected a data read or write alignment fault.");
        tokens.expect("("); const address = expression(tokens); tokens.expect(")"); tokens.expect("if");
        result.push(when(flagExpression(tokens), [alignmentFault(operation, address)]));
      } else if (tokens.take("commit")) {
        tokens.expect("addresses"); result.push(commitAddressUpdates());
      } else if (tokens.take("apply")) {
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
          if (tokens.take("resolve")) {
            tokens.expect("("); const size = tokens.number();
            if (size !== 8 && size !== 16 && size !== 32) tokens.fail("Operand size must be 8, 16, or 32.");
            tokens.expect(","); const mode = expression(tokens); tokens.expect(","); const code = expression(tokens); tokens.expect(")");
            result.push(resolveAddress(name, size, mode, code));
          } else if (tokens.take("fetch")) result.push(fetchByte(name));
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
      if (!["register", "flag", "source", "policy", "operands", "codes", "family"].includes(kind)) {
        header.fail(`Unknown declaration ${kind}.`, 1);
      }
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
      // Keep the original lines: family templates are parsed afresh for each selected operand.
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
        const policy: FlagPolicy = { name: description, parameters: { [parameter]: bits }, unlisted: "preserve", updates };
        const validate = () => validateInstruction({ cpu, name, explanation: "", inputs: { [parameter]: bits },
          steps: [updateFlags(policy, { [parameter]: value(parameter) })] });
        checked(header, validate);
        for (const tokens of body) {
          const flag = lookup(flags, tokens); tokens.expect("=");
          if (seen.has(flag.field)) tokens.fail(`Duplicate update of ${flag.field}.`);
          seen.add(flag.field);
          updates.push({ flag, value: flagExpression(tokens) }); tokens.end();
          checked(tokens, validate);
        }
        policies.set(name, policy);
      } else if (kind === "operands" || kind === "codes") {
        open(); const entries: ChapterOperand[] = []; let digits: number | undefined;
        for (const tokens of body) {
          const code = tokens.digits(); digits ??= code.length;
          if (!/^[01]+$/.test(code) || code.length !== digits || parseInt(code, 2) !== entries.length) {
            tokens.fail("Selector codes must be consecutive binary values of equal width, starting at zero.");
          }
          const description = tokens.quoted();
          if (kind === "codes") {
            if (!isWidth(digits)) tokens.fail("Encoded values require a supported bit width.");
            entries.push({ kind: "value", name: description,
              read: { name: description, width: digits, steps: [], result: literal(digits, entries.length) } });
            tokens.end(); continue;
          }
          tokens.expect("="); const operandKind = tokens.word();
          if (operandKind === "register") {
            const register = lookup(registers, tokens);
            entries.push({ kind: "register", name: description, register, read: registerSource(register) });
          } else {
            if (operandKind !== "memory" && operandKind !== "value") tokens.fail("Expected register, memory, or value operand.");
            const source = lookup(sources, tokens);
            if (operandKind === "memory" && source.width !== 16) tokens.fail("Memory operands require a 16-bit address source.");
            entries.push(operandKind === "memory" ? { kind: "memory", name: description, address: source, read: memorySource(source) }
              : { kind: "value", name: description, read: source });
          }
          tokens.end();
        }
        if (digits === undefined || entries.length !== 2 ** digits) header.fail("A catalogue must describe every value of its selector.");
        catalogues.set(name, entries);
      } else if (kind === "family") {
        const pattern = header.quoted(); header.expect("for");
        const selectors = new Map<string, Selector>();
        do {
          const selector = header.word(); header.expect("in"); const choices = lookup(catalogues, header);
          const requested = header.take(".") ? header.word() : "operand";
          if (selectors.has(selector)) header.fail(`Duplicate selector ${selector}.`);
          if (names.has(selector)) header.fail("A family selector must not shadow a source or other declaration.");
          const view = requested === "read" || requested === "address" || requested === "operand" ? requested
            : header.fail("Select a catalogue with .read, .address, or no suffix for operands.");
          selectors.set(selector, { choices, view });
        } while (header.take(","));
        const template = header.take("named") ? header.quoted() : undefined;
        if (template === undefined && selectors.size !== 1) header.fail("A multi-selector family needs an explicit instruction name template.");
        // Substitution happens once over authored text; braces in operand labels stay literal.
        const instructionName = (selected: Readonly<Record<string, ChapterOperand>>) => template === undefined
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
          const bindings = new Map(sources), operands = new Map<string, ChapterOperand>();
          let available = true;
          for (const [selector, { view }] of selectors) {
            const operand = selected[selector]!;
            if (view === "operand") operands.set(selector, operand);
            else if (view === "read") bindings.set(selector, operand.read);
            else if (operand.kind === "memory") bindings.set(selector, operand.address);
            else available = false; // Only memory operands supply an address view.
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
      }
    }
  }
  if (!declared) throw new ChapterError(file, 1, 1, "Expected a cpu declaration in a cpu fence.");
  return { sources: Object.fromEntries(sources), policies: Object.fromEntries(policies), operands: Object.fromEntries(catalogues), families: Object.fromEntries(families) };
}
