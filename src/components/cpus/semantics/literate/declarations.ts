import { readSource } from "../model.ts";
import type { CpuDeclaration, Flag, FlagPolicy, InstructionDefinition, Statement, ValueSource } from "../model.ts";
import { defineInstruction, ownData, validateFlagPolicy, validateInstruction } from "../validate.ts";
import { chapterBody, chapterContext, ChapterTokens } from "./document.ts";
import type { WidthParameter } from "./document.ts";
import { flagExpression, parameters, reference, typedExpression, valueType, width } from "./expressions.ts";
import type { ActionCapability, StatementOptions } from "./statements.ts";

type DeclarationKind = "source" | "view" | "action" | "policy";
interface DeclarationContext {
  readonly cpu: CpuDeclaration;
  readonly flags: ReadonlyMap<string, Flag>;
  readonly sources: Map<string, ValueSource>;
  readonly views: Map<string, ValueSource>;
  readonly actions: Map<string, InstructionDefinition>;
  readonly policies: Map<string, FlagPolicy>;
}

/** Compile and register reusable definitions in order, checking every declared width. */
export function chapterDeclaration(kind: DeclarationKind, name: string, lines: readonly ChapterTokens[], start: number,
  explanation: string, context: DeclarationContext,
  compileBody: (lines: readonly ChapterTokens[], options: StatementOptions) => readonly Statement[]): number {
  const header = lines[start]!, { cpu, flags, sources, views, actions, policies } = context;
  let definitionName = name;
  return chapterContext(() => `${kind} ${definitionName} at ${header.file}:${header.source.line}`, () => {
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
    const { body, end } = chapterBody(lines, start);
    if (!variants.length) define(header, body);
    for (const parameter of variants) {
      definitionName = `${name}<${parameter.value}>`;
      define(header.specialize(parameter), body.map(tokens => new ChapterTokens(tokens.source, header.file, parameter)));
    }
    return end;
  });

  function define(header: ChapterTokens, body: readonly ChapterTokens[]) {
    const open = () => { header.expect("{"); header.end(); };
    if (kind === "view" && name !== name.toUpperCase()) header.fail("View names must be uppercase.");
    const description = header.quoted(), inputs = parameters(header, kind === "policy");
    if (kind === "source" || kind === "view") {
      if (kind === "view" && Object.keys(inputs).length) header.fail("Views cannot require inputs.");
      header.expect(":"); const type = valueType(header); open();
      const last = body.at(-1) ?? header.fail("A source must end with return.");
      if (last.next !== "return") header.fail("A source must end with return.");
      const steps = compileBody(body.slice(0, -1), { inputs, effects: kind === "view" ? "view" : undefined });
      last.expect("return"); const result = typedExpression(last, type); last.end();
      const source = ownData({ name: description, type, ...(Object.keys(inputs).length ? { inputs } : {}), steps, result });
      last.checked(() => validateInstruction({ cpu, name: definitionName, explanation: "", inputs,
        steps: [readSource("result", source, Object.keys(inputs).length ? Object.fromEntries(Object.entries(inputs).map(([name, type]) => [name, reference(name, type)])) : undefined)] }));
      sources.set(definitionName, source);
      if (kind === "view") views.set(definitionName, source);
    } else if (kind === "policy") {
      open();
      const updates: FlagPolicy["updates"][number][] = [], seen = new Set<string>();
      const policy: FlagPolicy = { name: description, parameters: inputs, unlisted: "preserve", updates };
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
      policies.set(definitionName, ownData(policy));
    } else {
      const capabilities: ActionCapability[] = [];
      if (header.take("using")) do {
        const capability = header.word();
        if (capability !== "memory" && capability !== "boundary" && capability !== "staging" && capability !== "alignment") return header.fail("Expected memory, boundary, staging, or alignment capability.");
        if (capabilities.includes(capability)) header.fail(`Duplicate action capability ${capability}.`);
        capabilities.push(capability);
      } while (header.take(","));
      open();
      const definition = { cpu, name: description, explanation, inputs, steps: [] };
      header.checked(() => validateInstruction(definition));
      const steps = compileBody(body, { inputs, effects: capabilities });
      actions.set(definitionName, header.checked(() => defineInstruction({ ...definition, steps })));
    }
  }
}
