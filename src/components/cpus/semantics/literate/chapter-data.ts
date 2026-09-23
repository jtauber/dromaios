import type { CpuChapter } from "./compile.ts";

type SharedType = "CpuDeclaration" | "StateFields" | "ValueSource" | "FlagPolicy" | "Action" | "InstructionDefinition";

/** Preserve named IR building blocks as typed references instead of expanding them at every use. */
export function generateChapterData(chapter: CpuChapter): string {
  const declarations: string[] = [], shared = new Map<string, string>();
  const counts = new Map<SharedType, number>();
  const indent = (text: string) => text.replace(/^/gm, "  ");
  const key = (name: string) => name === "__proto__" ? `[${JSON.stringify(name)}]` : JSON.stringify(name);

  function reference(type: SharedType, value: unknown): string {
    // Compare ordered plain data first; only distinct blocks need formatted declarations.
    const identity = `${type}:${JSON.stringify(value)}`;
    const existing = shared.get(identity);
    if (existing !== undefined) return existing;
    const fields: Record<string, SharedType> = type === "InstructionDefinition" ? { cpu: "CpuDeclaration" }
      : type === "CpuDeclaration" ? { state: "StateFields" } : {};
    const body = render(value, fields);
    const index = counts.get(type) ?? 0;
    const name = type[0]!.toLowerCase() + type.slice(1) + index;
    counts.set(type, index + 1); shared.set(identity, name);
    declarations.push(type === "InstructionDefinition"
      ? `const ${name} = defineInstruction(${body});`
      : `const ${name}: ${type} = ${body};`);
    return name;
  }

  function render(value: unknown, references: Readonly<Record<string, SharedType>> = {}): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return value.length ? `[\n${value.map(item => indent(render(item, references))).join(",\n")}\n]` : "[]";
    // Only semantic edges are references: a captured argument named "source" is ordinary data.
    const kind = "kind" in value ? value.kind : undefined;
    if (kind === "read-source") references = { source: "ValueSource" };
    else if (kind === "perform") references = { action: "Action" };
    else if (kind === "update-flags" || kind === "replace-flags") references = { policy: "FlagPolicy" };
    const fields = Object.entries(value).filter(([, item]) => item !== undefined).map(([name, item]) =>
      indent(`${key(name)}: ${Object.hasOwn(references, name) ? reference(references[name]!, item) : render(item)}`));
    return fields.length ? `{\n${fields.join(",\n")}\n}` : "{}";
  }

  const groups = {
    sources: "ValueSource", views: "ValueSource", actions: "InstructionDefinition", policies: "FlagPolicy",
    operands: "readonly ChapterOperand[]", conditions: "readonly ChapterCondition[]", families: "readonly OpcodeEntry<InstructionDefinition>[]",
  } as const;
  const exports = Object.entries(groups).map(([group, type]) => {
    const members = chapter[group as keyof typeof groups];
    const fields = Object.keys(members).map(name => `  readonly ${key(name)}: ${type};`).join("\n");
    const entries = Object.entries(members).map(([name, value]) => {
      const data = group === "families" ? `[\n${chapter.families[name]!.map(([opcode, definition]) =>
        `    [${opcode}, ${reference("InstructionDefinition", definition)}],`).join("\n")}\n  ]`
        : group === "sources" || group === "views" ? reference("ValueSource", value)
        : group === "actions" ? reference("InstructionDefinition", value)
        : group === "policies" ? reference("FlagPolicy", value)
        : group === "operands" ? render(value, { read: "ValueSource", write: "InstructionDefinition", address: "ValueSource" }) : render(value);
      return indent(`${key(name)}: ${data}`);
    });
    return `export const ${group}: {\n${fields}\n} = {\n${entries.join(",\n")}\n};`;
  });
  return [
    'import type { Action, CpuDeclaration, ValueSource, FlagPolicy, InstructionDefinition } from "../model.ts";',
    'import type { StateFields } from "../../state.ts";',
    'import type { OpcodeEntry } from "../../opcodes.ts";',
    'import type { ChapterOperand, ChapterCondition } from "../literate/compile.ts";',
    'import { defineInstruction } from "../validate.ts";', "",
    declarations.join("\n\n"), "", exports.join("\n\n"), "",
  ].join("\n");
}
