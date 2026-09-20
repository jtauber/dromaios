import type { StateFields } from "../../state.ts";
import type { ValueSource } from "../model.ts";
import type { ChapterExecution } from "./execution.ts";
import type { ChapterTokens } from "./document.ts";

/** Public names and derived snapshot fields; storage and execution are declared separately. */
export interface ChapterInterface {
  readonly name: string;
  readonly description: string;
  readonly snapshots: readonly { readonly field: string; readonly view: string; readonly description: string }[];
}

export function chapterInterface(header: ChapterTokens, lines: readonly ChapterTokens[], state: StateFields,
  views: ReadonlyMap<string, ValueSource>): ChapterInterface {
  const name = header.word(), description = header.quoted(); header.expect("{"); header.end();
  if (!/^Cpu[A-Z0-9][A-Za-z0-9]*$/.test(name)) header.fail("Public class names must start with Cpu followed by an uppercase letter or digit.");
  const fields = new Set(Object.keys(state));
  const snapshots = lines.map(tokens => {
    tokens.expect("snapshot"); const field = tokens.word(); tokens.expect("=");
    const view = tokens.word(), source = views.get(view) ?? tokens.fail(`Unknown state view ${view}.`); tokens.end();
    if (field === "__proto__" || fields.has(field)) tokens.fail(`Duplicate or reserved snapshot field ${field}.`);
    fields.add(field);
    return { field, view, description: source.name };
  });
  // Array/group aliases share the public namespace with standard record and state types.
  const types = new Set(["State", "StoredState", "Snapshot", "MemoryAccess", "Access", "Instruction", "StepRecord", "ResetRecord",
    "InterruptAccess", "InterruptInstruction", "InterruptRecord", "InterruptSource"]);
  for (const alias of stateAliases(state)) {
    if (types.has(alias.name)) header.fail(`Public state alias ${name}${alias.name} conflicts with another type.`);
    types.add(alias.name);
  }
  return { name, description, snapshots };
}

function stateAliases(state: StateFields) {
  return Object.entries(state).filter(([, value]) => value.kind === "array" || value.kind === "group")
    .map(([field]) => ({ field, name: field[0]!.toUpperCase() + field.slice(1) }));
}

/** Preserve mutable storage while accepting readonly caller arrays and detached readonly snapshots. */
export function generatePublicState(state: StateFields, api: ChapterInterface): string {
  const name = api.name, quoted = JSON.stringify;
  return `
export { state as ${name[0]!.toLowerCase() + name.slice(1)}StateDescription };
export type ${name}StoredState = StoredState;
export type ${name}State = { [Key in keyof StoredState]: StoredState[Key] extends readonly number[] ? Readonly<StoredState[Key]> : StoredState[Key] };
${stateAliases(state).map(alias => `export type ${name}${alias.name} = StoredState[${quoted(alias.field)}];`).join("\n")}
`;
}

/** Emit the conventional public adapter, with every processor-specific choice supplied by the chapter. */
export function generateChapterInterface(module: string, state: StateFields, api: ChapterInterface, execution: ChapterExecution): string {
  const vectors = execution.interrupt === "vectors";
  const stoppedStep = vectors ? execution.waiting === undefined ? undefined : "WaitingStep" : "HaltedStep";
  const name = api.name, schema = `${name[0]!.toLowerCase() + name.slice(1)}StateDescription`, quoted = JSON.stringify;
  const comment = (text: string) => `/** ${text.replace(/\*\//g, "* /").replace(/[\r\n\u2028\u2029]/g, " ")} */`;
  const aliases = stateAliases(state).map(alias => `${name}${alias.name}`);
  const interruptParameter = vectors ? `source: ${name}InterruptSource` : "acknowledge: () => number";
  const interruptTypes = vectors
    ? `export type ${name}InterruptSource = ${execution.entries.map(entry => quoted(entry.source)).join(" | ")};`
    : `export type ${name}InterruptAccess = ${name}Access | InterruptAcknowledge;\nexport type ${name}InterruptInstruction = InterruptInstruction;`;
  return `// Generated from the chapter's public interface. Do not edit.
import { sourceReaders } from "./${module}-state.ts";
import { checkMemory, createExecution } from "./${module}-execution.ts";
import { ${schema} } from "../semantics/generated/state/${module}.ts";
import type { ${name}State, ${name}StoredState } from "../semantics/generated/state/${module}.ts";
import type { Ram } from "../../memory/ram.ts";
import type { FetchedInstruction, StateTransition, InstructionStep${stoppedStep ? `, ${stoppedStep}` : ""} } from "../execution-records.ts";
${vectors ? "" : 'import type { InterruptInstruction, InterruptAcknowledge } from "../interrupt-instruction.ts";'}
import type { MemoryAccess } from "../memory-access.ts";
${vectors ? "" : 'import type { BytePorts, PortAccess } from "../port-access.ts";'}
import { copyState, readState } from "../state.ts";
import type { ReadonlyState } from "../state.ts";

export { ${schema} } from "../semantics/generated/state/${module}.ts";
export type { ${[`${name}State`, `${name}StoredState`, ...aliases].join(", ")} } from "../semantics/generated/state/${module}.ts";

export type ${name}Snapshot = ReadonlyState<${name}State> & {
${api.snapshots.map(({ field, description }) => `  ${comment(description)}\n  readonly ${quoted(field)}: number;`).join("\n")}
};
export type ${name}MemoryAccess = MemoryAccess;
export type ${name}Access = MemoryAccess${vectors ? "" : " | PortAccess"};
export type ${name}Instruction = FetchedInstruction;
export type ${name}StepRecord = InstructionStep<${name}Snapshot, ${name}Access>${stoppedStep ? ` | ${stoppedStep}<${name}Snapshot, ${name}Access>` : ""};
export type ${name}ResetRecord = StateTransition<${name}Snapshot>;
${interruptTypes}
export type ${name}InterruptRecord = ReturnType<ReturnType<typeof createExecution<${name}Snapshot>>["interrupt"]>;

${comment(api.description)}
export class ${name} {
  readonly #state: ${name}StoredState;
  readonly #views: ReturnType<typeof sourceReaders>["views"];
  readonly #execution: ReturnType<typeof createExecution<${name}Snapshot>>;

  constructor(ram: Ram, initialState: ${name}${vectors ? "Snapshot" : "State"}${vectors ? "" : ", ports?: BytePorts"}) {
    checkMemory(ram);
    this.#state = readState(${schema}, initialState);
    this.#views = sourceReaders(this.#state).views;
    this.#execution = createExecution(this.#state, ram, () => this.snapshot()${vectors ? "" : ", ports"});
  }

  snapshot(): ${name}Snapshot {
    return { ...copyState(${schema}, this.#state)${api.snapshots.map(({ field, view }) => `, ${quoted(field)}: this.#views[${quoted(view)}]()` ).join("")} };
  }

  reset(): ${name}ResetRecord { return this.#execution.reset(); }
  step(): ${name}StepRecord { return this.#execution.step(); }
  interrupt(${interruptParameter}): ${name}InterruptRecord { return this.#execution.interrupt(${vectors ? "source" : "acknowledge"}); }
}
`;
}
