import { opcodeFamily, opcodePattern } from "../../opcodes.ts";
import type { OpcodeEntry } from "../../opcodes.ts";
import { registerSource } from "../builders.ts";
import type { CpuDeclaration, Flag, InstructionDefinition, Register, Statement, ValueSource } from "../model.ts";
import { opcodePageLayouts } from "../opcode-pages.ts";
import type { OpcodePage } from "../opcode-pages.ts";
import { defineInstruction } from "../validate.ts";
import { ChapterTokens } from "./document.ts";
import { definitionReference, parameters } from "./expressions.ts";
import type { ChapterCondition, ChapterOperand, StatementOptions } from "./statements.ts";

type Selection = ChapterOperand | ChapterCondition;
interface Selector { readonly choices: readonly Selection[]; readonly view: "read" | "address" | "operand" }
interface FamilyContext {
  readonly cpu: CpuDeclaration;
  readonly names: ReadonlySet<string>;
  readonly registers: ReadonlyMap<string, Register>;
  readonly flags: ReadonlyMap<string, Flag>;
  readonly catalogues: ReadonlyMap<string, readonly ChapterOperand[]>;
  readonly conditions: ReadonlyMap<string, readonly ChapterCondition[]>;
  readonly sources: ReadonlyMap<string, ValueSource>;
  readonly pages: ReadonlyMap<string, OpcodePage>;
  /** Chapter-wide locations retain collisions and late page diagnostics across families. */
  readonly opcodes: Map<number, ChapterTokens>;
  readonly wordPatterns: ChapterTokens[];
}

export interface FamilyBindings {
  readonly bindings: ReadonlyMap<string, ValueSource>;
  readonly operands: ReadonlyMap<string, ChapterOperand>;
  readonly conditions: ReadonlyMap<string, ChapterCondition>;
}

/** Expand each authored encoding with its own bindings and shared immutable instruction bodies. */
export function chapterFamily(header: ChapterTokens, lines: readonly ChapterTokens[], name: string, explanation: string,
  context: FamilyContext, compileBody: (lines: readonly ChapterTokens[], options: StatementOptions & FamilyBindings) => readonly Statement[]): OpcodeEntry<InstructionDefinition>[] {
  const { cpu, names, registers, flags, catalogues, conditions, sources, pages, opcodes, wordPatterns } = context;
  const familyInputs = parameters(header), forms: ChapterTokens[] = [];
  let body = lines;
  if (header.next === "{") {
    header.expect("{"); header.end();
    while (body[forms.length]?.take("encoding")) forms.push(body[forms.length]!);
    if (!forms.length) header.fail("A family needs at least one encoding.");
    body = body.slice(forms.length);
  } else forms.push(header);

  function readEncoding(form: ChapterTokens) {
    const pattern = form.quoted();
    const pageName = form.take("on") ? form.word() : undefined;
    const page = pageName === undefined ? undefined : opcodePageLayouts(Object.fromEntries(pages)).find(page => page.name === pageName)
      ?? form.fail(`Unknown name ${pageName}.`);
    const prefix = page?.key;
    const inputs = { ...familyInputs };
    for (const name of page?.operands ?? []) {
      if (Object.hasOwn(inputs, name)) form.fail(`Duplicate family/page input ${name}.`);
      inputs[name] = 8;
    }
    const bits = pattern.replace(/[\s_]/g, "").length;
    if (bits === 16) wordPatterns.push(form);
    if ((prefix !== undefined || pages.size) && bits !== 8) form.fail("Opcode pages require eight-bit patterns.");
    const selectors = new Map<string, Selector>();
    if (form.take("for")) do {
      const selector = form.word(); form.expect("in");
      const choices = form.lookup(new Map<string, readonly Selection[]>([...catalogues, ...conditions]));
      const requested = form.take(".") ? form.word() : "operand";
      if (selectors.has(selector)) form.fail(`Duplicate selector ${selector}.`);
      if (names.has(selector) || registers.has(selector) || flags.has(selector) || Object.hasOwn(inputs, selector)) form.fail("A family selector must not shadow a source or other declaration.");
      const view = requested === "read" || requested === "address" || requested === "operand" ? requested
        : form.fail("Select a catalogue with .read, .address, or no suffix for operands.");
      if (view !== "operand" && choices[0]?.kind === "condition") form.fail("Conditions have no numeric source view.");
      selectors.set(selector, { choices, view });
    } while (form.take(","));
    const boundSources = new Map(sources), boundOperands = new Map<string, ChapterOperand>(), aliases = new Set<string>();
    if (form.take("with")) do {
      const alias = form.word(); form.expect("=");
      if (names.has(alias) || registers.has(alias) || flags.has(alias) || selectors.has(alias) || aliases.has(alias) || Object.hasOwn(inputs, alias)) {
        form.fail(`Source binding ${alias} must not shadow a declaration or another binding.`);
      }
      aliases.add(alias);
      if (form.take("register")) {
        const reference = form.reference(), register = registers.get(reference) ?? form.fail(`Unknown register ${reference}.`);
        boundOperands.set(alias, { kind: "register", name: reference, register, read: registerSource(register) });
      } else boundSources.set(alias, definitionReference(form, sources));
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
    if (form === header) { header.expect("{"); header.end(); } else form.end();
    if (!explanation) form.fail("A family needs an explanatory paragraph before its cpu fence.");
    return { pattern, prefix, inputs, selectors, boundSources, boundOperands, instructionName, excluded };
  }

  const definitions: OpcodeEntry<InstructionDefinition>[] = [];
  for (const form of forms) {
    const firstDefinition = definitions.length;
    const { pattern, prefix, inputs, selectors, boundSources, boundOperands, instructionName, excluded } = readEncoding(form);
    const choices = Object.fromEntries([...selectors].map(([selector, { choices }]) => [selector, choices]));
    const entries = form.checked(() => opcodeFamily(pattern, choices, selected => selected));
    for (const opcode of excluded) if (!entries.some(([candidate]) => opcode === candidate)) form.fail(`Excluded opcode $${opcode.toString(16)} is outside this family.`);
    // Ignored bits add encodings, not new bindings. Share only within this encoding declaration.
    const bodies = new Map<string, InstructionDefinition>();
    for (const [byte, selected] of entries) {
      if (excluded.has(byte)) continue;
      const bindings = bindSelection(selected, selectors, boundSources, boundOperands);
      if (!bindings) continue;
      const opcode = prefix === undefined ? byte : prefix * 256 + byte;
      if (opcodes.has(opcode)) form.fail(`Duplicate opcode $${opcode.toString(16)}.`);
      opcodes.set(opcode, form);
      const identity = JSON.stringify(selected);
      let definition = bodies.get(identity);
      if (definition === undefined) {
        const steps = compileBody(body.map(tokens => new ChapterTokens(tokens.source, header.file)), { ...bindings, inputs });
        definition = form.checked(() => defineInstruction({ cpu, name: instructionName({ ...Object.fromEntries(boundOperands), ...selected }),
          explanation, ...(Object.keys(inputs).length ? { inputs } : {}), steps }));
        bodies.set(identity, definition);
      }
      definitions.push([opcode, definition]);
    }
    if (definitions.length === firstDefinition) form.fail("An encoding must define at least one instruction.");
  }
  return definitions;
}

/** Bind sources without reading them; unsupported selections emit no opcode. */
function bindSelection(selected: Readonly<Record<string, Selection>>, selectors: ReadonlyMap<string, Selector>,
  sources: ReadonlyMap<string, ValueSource>, boundOperands: ReadonlyMap<string, ChapterOperand>): FamilyBindings | undefined {
  const bindings = new Map(sources), operands = new Map(boundOperands), conditions = new Map<string, ChapterCondition>();
  for (const [selector, { view }] of selectors) {
    const operand = selected[selector]!;
    if (operand.kind === "unsupported") return undefined;
    if (operand.kind === "condition") conditions.set(selector, operand);
    else if (view === "operand") operands.set(selector, operand);
    else if (view === "read") bindings.set(selector, operand.read);
    else if (operand.kind === "memory") bindings.set(selector, operand.address);
    else return undefined; // Only memory operands supply an address view.
  }
  return { bindings, operands, conditions };
}
