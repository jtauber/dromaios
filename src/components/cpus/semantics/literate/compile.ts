import { chapterWordExecution, checkWordEffects } from "./word-execution.ts";
import type { StateFields } from "../../state.ts";
import type { OpcodeEntry } from "../../opcodes.ts";
import { memorySource, registerSource } from "../builders.ts";
import { concat, isWidth, literal, readRegister, readSource, value } from "../model.ts";
import type { Choice, CpuDeclaration, Flag, FlagGroup, FlagPolicy, InstructionDefinition, Latch, Register, RegisterArray, ValueSource, ValueType, Width } from "../model.ts";
import { defineInstruction, ownData, validateFlagPolicy, validateInstruction } from "../validate.ts";
import { opcodePageLayouts } from "../opcode-pages.ts";
import type { OpcodePage } from "../opcode-pages.ts";
import type { WidthParameter } from "./document.ts";
import { chapterBlocks, chapterBody, ChapterError, ChapterTokens } from "./document.ts";
import { definitionReference, expression, flagExpression, parameters, reference, typedExpression, valueType, width } from "./expressions.ts";
import { chapterSegmentedExecution, checkSegmentedEffects } from "./segmented-execution.ts";
import { chapterExecution, checkByteExecution } from "./execution.ts";
import type { ChapterExecution } from "./execution.ts";
import { chapterReset } from "./reset.ts";
import type { ChapterReset } from "./reset.ts";
import { chapterInterface } from "./interface.ts";
import type { ChapterInterface } from "./interface.ts";
import { chapterState, checkStateSymbol, stateSymbol } from "./state.ts";
import { chapterStatements } from "./statements.ts";
import { chapterFamily } from "./families.ts";
import type { FamilyBindings } from "./families.ts";
import type { ActionCapability, ChapterCondition, ChapterOperand, StatementOptions } from "./statements.ts";
export type { ChapterCondition, ChapterOperand } from "./statements.ts";

export interface CpuChapter {
  readonly cpu: string;
  /** Present only when the chapter owns its complete stored-state schema. */
  readonly state?: StateFields;
  readonly execution?: ChapterExecution;
  readonly reset?: ChapterReset;
  readonly interface?: ChapterInterface;
  readonly sources: Readonly<Record<string, ValueSource>>;
  readonly views: Readonly<Record<string, ValueSource>>;
  readonly actions: Readonly<Record<string, InstructionDefinition>>;
  readonly policies: Readonly<Record<string, FlagPolicy>>;
  readonly operands: Readonly<Record<string, readonly ChapterOperand[]>>;
  readonly conditions: Readonly<Record<string, readonly ChapterCondition[]>>;
  /** Prefix paths and ordered captures; family keys omit intervening operand bytes. */
  readonly pages: Readonly<Record<string, OpcodePage>>;
  readonly families: Readonly<Record<string, readonly OpcodeEntry<InstructionDefinition>[]>>;
}

/** Compile a bounded literate language to the existing IR, without evaluating host-language code. */
export function compileCpuChapter(markdown: string, target: { readonly name?: string; readonly state?: StateFields } = {}, file = "<chapter>"): CpuChapter {
  const registers = new Map<string, Register>(), flags = new Map<string, Flag>();
  const flagGroups = new Map<string, FlagGroup>();
  const arrays = new Map<string, RegisterArray>(), latches = new Map<string, Latch>(), choices = new Map<string, Choice>();
  const sources = new Map<string, ValueSource>(), policies = new Map<string, FlagPolicy>();
  const catalogues = new Map<string, readonly ChapterOperand[]>(), families = new Map<string, readonly OpcodeEntry<InstructionDefinition>[]>();
  const conditions = new Map<string, readonly ChapterCondition[]>();
  const views = new Map<string, ValueSource>(), actions = new Map<string, InstructionDefinition>();
  const names = new Set<string>(), opcodes = new Map<number, ChapterTokens>();
  const pages = new Map<string, OpcodePage>(), pageTokens = new Map<number, ChapterTokens>();
  const wordPatterns: ChapterTokens[] = [];
  let declared = false, ownsState = false;
  let execution: ChapterExecution | undefined;
  let reset: ChapterReset | undefined;
  let publicInterface: ChapterInterface | undefined;
  let cpu: CpuDeclaration = { name: target.name ?? "", state: target.state ?? {} };

  function declare(tokens: ChapterTokens, kind: string, prefix = ""): string {
    const column = tokens.column, name = prefix + tokens.word();
    // Registers and flags have distinct namespaces: the 8008 has both register C and flag C.
    if (names.has(name) || (kind !== "flag" && registers.has(name)) || (kind !== "register" && flags.has(name))) {
      tokens.fail(`Duplicate declaration ${name}.`, column);
    }
    if (kind !== "register" && kind !== "flag") names.add(name);
    return name;
  }
  function declareState(tokens: ChapterTokens, kind: string, check = false, bank?: { name: string; field: string; kind: "bank" | "group" }) {
    const prefix = bank ? `${bank.name}.` : "", name = declare(tokens, kind, prefix);
    const declared = stateSymbol(tokens, kind, name.slice(prefix.length), cpu.name);
    if (bank?.kind === "bank" && declared.kind !== "register" && declared.kind !== "flag") tokens.fail("Banks contain only registers and flags.");
    const symbol = bank ? { ...declared, bank: bank.field } : declared;
    if (check) checkStateSymbol(tokens, name, symbol, cpu);
    switch (symbol.kind) {
      case "register": registers.set(name, symbol); break;
      case "flag": flags.set(name, symbol); break;
      case "register-array": arrays.set(name, symbol); break;
      case "latch": latches.set(name, symbol); break;
      case "choice": choices.set(name, symbol); break;
    }
    return symbol;
  }
  function steps(lines: readonly ChapterTokens[], options: StatementOptions & Partial<FamilyBindings> = {}) {
    return chapterStatements(lines, { cpu, registers, arrays, latches, choices, flags, flagGroups, policies, actions, catalogues,
      sources: options.bindings ?? sources, operands: options.operands ?? new Map(), conditions: options.conditions ?? new Map() }, options);
  }

  function defineValue(kind: "source" | "view" | "policy", name: string, header: ChapterTokens, body: readonly ChapterTokens[]) {
    const open = () => { header.expect("{"); header.end(); };
    if (kind === "source" || kind === "view") {
      if (kind === "view" && name !== name.toUpperCase()) header.fail("View names must be uppercase.");
      const description = header.quoted(), inputs = parameters(header);
      if (kind === "view" && Object.keys(inputs).length) header.fail("Views cannot require inputs.");
      header.expect(":"); const type = valueType(header); open();
      const last = body.at(-1) ?? header.fail("A source must end with return.");
      if (last.next !== "return") header.fail("A source must end with return.");
      const bodySteps = steps(body.slice(0, -1), { inputs, effects: kind === "view" ? "view" : undefined });
      last.expect("return"); const result = typedExpression(last, type); last.end();
      const source = ownData({ name: description, type, ...(Object.keys(inputs).length ? { inputs } : {}), steps: bodySteps, result });
      last.checked(() => validateInstruction({ cpu, name, explanation: "", inputs,
        steps: [readSource("result", source, Object.keys(inputs).length ? Object.fromEntries(Object.entries(inputs).map(([name, type]) => [name, reference(name, type)])) : undefined)] }));
      sources.set(name, source);
      if (kind === "view") views.set(name, source);
    } else {
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
        const flag = tokens.lookup(flags, true); tokens.expect("=");
        const key = `${flag.bank ?? ""}.${flag.field}`;
        if (seen.has(key)) tokens.fail(`Duplicate update of ${flag.field}.`);
        seen.add(key);
        updates.push({ flag, value: flagExpression(tokens) }); tokens.end();
        tokens.checked(validate);
      }
      policies.set(name, ownData(policy));
    }
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
        const boundary = header.take("boundary") ? header.word() : undefined;
        if (boundary !== undefined && boundary !== "segmented" && boundary !== "word") header.fail("Expected segmented or word boundary.");
        cpu = { ...cpu, name, ...(boundary === "segmented" ? { segmentedBoundary: true } : boundary === "word" ? { wordBoundary: true } : {}) };
        if (cpu.state.flags?.kind === "group") flagGroups.set("FLAGS", { kind: "flag-group", cpu: name });
        declared = true; header.end(); continue;
      }
      if (!declared) header.fail("Declare the CPU before its contents.");
      if (!["state", "reset", "execution", "interface", "register", "flag", "array", "latch", "choice", "source", "view", "action", "policy", "operands", "codes", "conditions", "page", "family"].includes(kind)) {
        header.fail(`Unknown declaration ${kind}.`, 1);
      }
      if (kind === "state") {
        if (target.state !== undefined || ownsState) header.fail("CPU state is already defined.");
        header.expect("{"); header.end();
        const { body, end } = chapterBody(lines, index); index = end;
        if (body.length === 0) header.fail("State must declare at least one stored field.");
        const declarations: Parameters<typeof chapterState>[0][number][] = [];
        for (let slot = 0; slot < body.length; slot++) {
          const tokens = body[slot]!;
          const grouped = tokens.take("bank") ? "bank" : tokens.take("group") ? "group" : undefined;
          if (!grouped) {
            declarations.push({ symbol: declareState(tokens, tokens.word()), tokens }); continue;
          }
          const name = declare(tokens, grouped), field = tokens.take("=") ? tokens.word() : name.toLowerCase();
          if (name !== name.toUpperCase()) tokens.fail("Group and bank names must be uppercase.");
          tokens.expect("{"); tokens.end();
          const nested = chapterBody(body, slot); slot = nested.end;
          const fields = chapterState(nested.body.map(entry => ({
            symbol: declareState(entry, entry.word(), false, { name, field, kind: grouped }), tokens: entry,
          })));
          if (grouped === "bank" && fields.flags?.kind !== "group") tokens.fail("A register bank needs its own flags.");
          declarations.push({ symbol: { kind: grouped, field, fields }, tokens });
          if (fields.flags?.kind === "group") flagGroups.set(`${name}.FLAGS`, { kind: "flag-group", cpu: cpu.name, bank: field });
        }
        cpu = { ...cpu, state: chapterState(declarations) }; ownsState = true;
        if (cpu.state.flags?.kind === "group") flagGroups.set("FLAGS", { kind: "flag-group", cpu: cpu.name });
        continue;
      }
      if (!ownsState && target.state === undefined) header.fail("Define state before other declarations.");
      // Reuse the current CPU declaration; execution declarations can replace its capabilities.
      cpu = header.checked(() => ownData(cpu));
      if (kind === "reset") {
        if (reset) header.fail("Reset is already declared.");
        header.expect("{"); header.end();
        const { body, end } = chapterBody(lines, index); index = end;
        reset = chapterReset(header, body, actions);
        continue;
      }
      if (kind === "interface") {
        if (publicInterface) header.fail("Public interface is already declared.");
        if (!ownsState || !execution) header.fail("A public interface requires chapter-owned state and an earlier execution contract.");
        if (execution?.interrupt === "external") header.fail("A public interface requires chapter-owned interrupt entry.");
        if (execution?.mode === "word" && !reset) header.fail("A word public interface requires an earlier reset contract.");
        const { body, end } = chapterBody(lines, index); index = end;
        publicInterface = chapterInterface(header, body, cpu.state, views);
        continue;
      }
      if (kind === "execution") {
        const segmented = header.take("segmented"), word = !segmented && header.take("word");
        if (segmented !== (cpu.segmentedBoundary === true)) header.fail("Segmented execution requires a matching CPU boundary declaration.");
        if (word !== (cpu.wordBoundary === true)) header.fail("Word execution requires a matching CPU boundary declaration.");
        if (execution) header.fail("Execution is already declared.");
        header.expect("{"); header.end();
        const { body, end } = chapterBody(lines, index); index = end;
        execution = segmented ? chapterSegmentedExecution(header, body, { registers, views, actions, latches, flags })
          : word ? chapterWordExecution(header, body, { views, actions, sources, latches, flags })
          : chapterExecution(header, body, { views, actions, latches, choices, flags });
        if (execution.mode === "byte" && execution.retireDeferral !== undefined) cpu = { ...cpu, irqDeferral: true };
        if (execution.mode === "byte" && execution.opcodeAdvance === "decode" && execution.notifyReti) cpu = { ...cpu, retiNotification: true };
        continue;
      }
      if (["register", "flag", "array", "latch", "choice"].includes(kind)) {
        if (ownsState) header.fail("Declare stored fields inside the state block.");
        declareState(header, kind, true); continue;
      }
      const name = declare(header, kind);
      if (kind === "page") {
        header.expect("="); const prefix = header.number();
        if (prefix < 1 || prefix > 255) header.fail("Opcode page prefixes must be bytes from $01 through $FF.");
        const on = header.take("on") ? header.word() : undefined;
        const operands: string[] = []; let opcodeFetch = true;
        const detailed = header.take("{");
        if (detailed) {
          header.end(); const nested = chapterBody(lines, index); index = nested.end;
          const last = nested.body.at(-1) ?? header.fail("A page layout must end with opcode = fetch or read.");
          for (const tokens of nested.body.slice(0, -1)) {
            const operand = tokens.word(); tokens.expect(":"); tokens.expect("8"); tokens.expect("="); tokens.expect("read"); tokens.end();
            if (names.has(operand) || registers.has(operand) || flags.has(operand)) tokens.fail("Page operands must not shadow declarations.");
            operands.push(operand);
          }
          last.expect("opcode"); last.expect("=");
          opcodeFetch = last.take("fetch"); if (!opcodeFetch) last.expect("read"); last.end();
        } else header.end();
        const page = on !== undefined || detailed ? { prefix, ...(on ? { on } : {}), operands, opcodeFetch } : prefix;
        const layouts = header.checked(() => opcodePageLayouts({ ...Object.fromEntries(pages), [name]: page }));
        const key = layouts.at(-1)!.key;
        pages.set(name, page); pageTokens.set(key, header); continue;
      }
      const variants: WidthParameter[] = [];
      if (header.take("<")) {
        if (kind !== "source" && kind !== "policy") header.fail("Only sources and policies can declare a width parameter.");
        const parameter = header.word(); header.expect(":");
        if (parameter === "flag") header.fail("A width parameter cannot be named flag.");
        do {
          const value = width(header);
          if (variants.some(item => item.value === value)) header.fail(`Duplicate width ${value}.`);
          variants.push({ name: parameter, value });
        } while (header.take(","));
        header.expect(">");
      }
      // Families and width variants reparse their original lines, including nested blocks.
      const { body, end } = chapterBody(lines, index); index = end;
      const open = () => { header.expect("{"); header.end(); };
      if (kind === "source" || kind === "view" || kind === "policy") {
        if (!variants.length) defineValue(kind, name, header, body);
        for (const parameter of variants) {
          defineValue(kind, `${name}<${parameter.value}>`, header.specialize(parameter),
            body.map(tokens => new ChapterTokens(tokens.source, file, parameter)));
        }
      } else if (kind === "action") {
        const description = header.quoted(), inputs = parameters(header);
        const capabilities: ActionCapability[] = [];
        if (header.take("using")) do {
          const capability = header.word();
          if (capability !== "memory" && capability !== "boundary" && capability !== "staging" && capability !== "alignment") return header.fail("Expected memory, boundary, staging, or alignment capability.");
          if (capabilities.includes(capability)) header.fail(`Duplicate action capability ${capability}.`);
          capabilities.push(capability);
        } while (header.take(","));
        open();
        const definition = { cpu, name: description, explanation: block.explanation, inputs, steps: [] };
        header.checked(() => validateInstruction(definition));
        const bodySteps = steps(body, { inputs, effects: capabilities });
        actions.set(name, header.checked(() => defineInstruction({ ...definition, steps: bodySteps })));
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
              read: { name: description, type: bits, steps: [], result: literal(bits, contents) } });
          } else if (kind === "conditions") {
            tokens.expect("="); tokens.expect("flag"); const flag = tokens.lookup(flags, true); tokens.expect("=");
            const expected = flagExpression(tokens);
            if (expected.kind !== "flag-literal") return tokens.fail("A condition must compare its flag with 0 or 1.");
            tests.push({ kind: "condition", name: description, flag, set: expected.value });
          } else {
            tokens.expect("="); const operandKind = tokens.word();
            if (operandKind === "unsupported") entries.push({ kind: "unsupported", name: description });
            else if (operandKind === "view") {
              const read = tokens.lookup(views); tokens.expect("write"); const write = tokens.lookup(actions);
              if (Object.values(write.inputs ?? {}).length !== 1 || Object.values(write.inputs!)[0] !== read.type) {
                tokens.fail("A writable view needs an action with one input matching its width.");
              }
              entries.push({ kind: "view", name: description, read, write });
            } else if (operandKind === "register") {
              const register = tokens.lookup(registers, true);
              entries.push({ kind: "register", name: description, register, read: registerSource(register) });
            } else if (operandKind === "pair") {
              const high = tokens.lookup(registers, true), low = tokens.lookup(registers, true);
              if (high.width !== 8 || low.width !== 8) tokens.fail("Register pairs require two byte registers, high then low.");
              entries.push({ kind: "pair", name: description, high, low,
                read: { name: description, type: 16, steps: [readRegister("high", high), readRegister("low", low)], result: concat(value("high"), value("low")) } });
            } else {
              if (operandKind !== "memory" && operandKind !== "value") tokens.fail("Expected register, pair, view, memory, value, or unsupported operand.");
              const source = definitionReference(tokens, sources);
              if (operandKind === "memory" && source.type !== 16) tokens.fail("Memory operands require a 16-bit address source.");
              entries.push(operandKind === "memory" ? { kind: "memory", name: description, address: source, read: memorySource(source) }
                : { kind: "value", name: description, read: source });
            }
          }
          tokens.end();
        }
        if (digits === undefined || entries.length + tests.length !== 2 ** digits) header.fail("A catalogue must describe every value of its selector.");
        if (kind === "conditions") conditions.set(name, tests); else catalogues.set(name, entries);
      } else if (kind === "family") {
        families.set(name, chapterFamily(header, body, name, block.explanation,
          { cpu, names, registers, flags, catalogues, conditions, sources, pages, opcodes, wordPatterns }, steps));
      }
    }
  }
  if (!declared) throw new ChapterError(file, 1, 1, "Expected a cpu declaration in a cpu fence.");
  if (!ownsState && target.state === undefined) throw new ChapterError(file, 1, 1, "Expected a state block.");
  if (pages.size && wordPatterns.length) wordPatterns[0]!.fail("Word opcode patterns cannot be mixed with byte opcode pages.");
  for (const [prefix, tokens] of pageTokens) {
    if (opcodes.has(prefix)) tokens.fail(`Opcode page prefix $${prefix.toString(16)} collides with an instruction opcode.`);
  }
  if (pages.size) for (const [opcode, tokens] of opcodes) {
    if (opcode > 255 && !pageTokens.has(opcode >>> 8)) tokens.fail("A word opcode cannot be mixed with byte opcode pages.");
  }
  if (execution && execution.mode !== "word" && reset) throw new ChapterError(file, 1, 1, "Standalone reset cannot duplicate an execution contract’s reset.");
  if (execution?.mode === "segmented") for (const tokens of pageTokens.values()) tokens.fail("Segmented execution uses replaceable prefixes, not opcode pages.");
  if (execution) for (const entries of families.values()) for (const [opcode, definition] of entries) {
    const tokens = opcodes.get(opcode)!;
    if (execution.mode === "word") {
      if (pages.size) tokens.fail("Word execution cannot use byte opcode pages.");
      for (const [name, width] of Object.entries(definition.inputs ?? {})) {
        if (execution.inputs[name]?.width !== width) tokens.fail(`Missing or wrong-width encoded input ${name}.`);
      }
      tokens.checked(() => checkWordEffects(definition.steps, execution.exceptions));
      continue;
    }
    if (opcode > 0xff && !pageTokens.has(opcode >>> 8)) tokens.fail("Byte execution requires one-byte opcodes.");
    if (execution.mode === "segmented") {
      const inputs = Object.entries(definition.inputs ?? {});
      const signatures = [[], [["overridden", 8], ["segmentOverride", 16]],
        [["overridden", 8], ["segmentOverride", 16], ["repeatMode", 8], ["startIP", 16]]];
      if (!signatures.some(signature => JSON.stringify(signature) === JSON.stringify(inputs))) tokens.fail("Segmented families need plain, override, or repeat inputs in declared order.");
      if (opcode > 255 || execution.prefixes.some(prefix => prefix.opcode === opcode)) tokens.fail("Segmented instruction bytes cannot collide with prefixes or use opcode pages.");
      const fault = execution.fault.source;
      tokens.checked(() => checkSegmentedEffects(definition.steps, fault));
    } else tokens.checked(() => checkByteExecution(definition.steps, execution.retireDeferral !== undefined, execution.interrupt === "vectors",
      execution.opcodeAdvance === "decode" ? execution : undefined));
  }
  return { cpu: cpu.name, pages: Object.fromEntries(pages), ...(ownsState ? { state: cpu.state } : {}), ...(execution ? { execution } : {}), ...(reset ? { reset } : {}), ...(publicInterface ? { interface: publicInterface } : {}), sources: Object.fromEntries(sources), views: Object.fromEntries(views), actions: Object.fromEntries(actions), policies: Object.fromEntries(policies), operands: Object.fromEntries(catalogues), conditions: Object.fromEntries(conditions), families: Object.fromEntries(families) };
}
