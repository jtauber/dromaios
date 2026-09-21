import type { StateFields } from "../../state.ts";
import type { ValueSource } from "../model.ts";
import type { ChapterExecution } from "./execution.ts";
import type { ChapterTokens } from "./document.ts";

/** Public names and derived snapshot fields; storage and execution are declared separately. */
export interface ChapterInterface {
  readonly name: string;
  readonly description: string;
  readonly banks?: readonly { readonly field: string; readonly name: string; readonly snapshot: string }[];
  readonly snapshots: readonly { readonly field: string; readonly view: string; readonly description: string }[];
}

export function chapterInterface(header: ChapterTokens, lines: readonly ChapterTokens[], state: StateFields,
  views: ReadonlyMap<string, ValueSource>): ChapterInterface {
  const name = header.word(), description = header.quoted(); header.expect("{"); header.end();
  if (!/^Cpu[A-Z0-9][A-Za-z0-9]*$/.test(name)) header.fail("Public class names must start with Cpu followed by an uppercase letter or digit.");
  const fields = new Set(Object.keys(state));
  const snapshots: ChapterInterface["snapshots"][number][] = [], banks: NonNullable<ChapterInterface["banks"]>[number][] = [];
  for (const tokens of lines) {
    if (tokens.take("bank")) {
      const alias = tokens.word(); tokens.expect("="); const field = tokens.word();
      tokens.expect("snapshot"); const snapshot = tokens.word(); tokens.end();
      if (state[field]?.kind !== "group") tokens.fail(`Bank alias requires a stored group, not ${field}.`);
      if (!/^[A-Z][A-Za-z0-9]*$/.test(alias) || !/^[A-Z][A-Za-z0-9]*$/.test(snapshot)) tokens.fail("Public bank aliases must start with an uppercase letter.");
      if (banks.some(bank => bank.field === field)) tokens.fail(`Duplicate bank alias for ${field}.`);
      banks.push({ field, name: alias, snapshot }); continue;
    }
    tokens.expect("snapshot"); const field = tokens.reference(); tokens.expect("=");
    const view = tokens.word(), source = views.get(view) ?? tokens.fail(`Unknown state view ${view}.`); tokens.end();
    const [parent, child] = field.split(".");
    if (child !== undefined) {
      const group = state[parent!];
      if (group?.kind !== "group") tokens.fail(`Nested snapshot requires a stored group, not ${parent}.`);
      else if (Object.hasOwn(group.fields, child)) tokens.fail(`Duplicate or reserved snapshot field ${field}.`);
    }
    if (field.split(".").includes("__proto__") || fields.has(field)) tokens.fail(`Duplicate or reserved snapshot field ${field}.`);
    fields.add(field); snapshots.push({ field, view, description: source.name });
  }
  // Array/group aliases share the public namespace with standard record and state types.
  const types = new Set(["State", "StoredState", "Snapshot", "MemoryAccess", "Access", "Instruction", "StepRecord", "ResetRecord",
    "InterruptAccess", "InterruptInstruction", "InterruptRecord", "InterruptSource"]);
  for (const alias of [...stateAliases(state).map(alias => alias.name), ...banks.flatMap(bank => [bank.name, bank.snapshot])]) {
    if (types.has(alias)) header.fail(`Public state alias ${name}${alias} conflicts with another type.`);
    types.add(alias);
  }
  return { name, description, snapshots, ...(banks.length ? { banks } : {}) };
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
${[...stateAliases(state), ...(api.banks ?? [])].map(alias => `export type ${name}${alias.name} = StoredState[${quoted(alias.field)}];`).join("\n")}
`;
}

/** Emit the conventional public adapter, with every processor-specific choice supplied by the chapter. */
export function generateChapterInterface(module: string, state: StateFields, api: ChapterInterface, execution: ChapterExecution): string {
  if (execution.interrupt === "external") throw new Error("A public interface requires chapter-owned interrupt entry.");
  const vectors = execution.interrupt === "vectors";
  const stoppedStep = vectors ? execution.waiting === undefined ? undefined : "WaitingStep" : "HaltedStep";
  const name = api.name, schema = `${name[0]!.toLowerCase() + name.slice(1)}StateDescription`, quoted = JSON.stringify;
  const comment = (text: string) => `/** ${text.replace(/\*\//g, "* /").replace(/[\r\n\u2028\u2029]/g, " ")} */`;
  const aliases = [...stateAliases(state), ...(api.banks ?? [])].map(alias => `${name}${alias.name}`);
  const named = execution.interrupt === "entries";
  const notification = execution.opcodeAdvance === "decode" && execution.notifyReti;
  const sourceNames = vectors || named ? execution.entries.map(entry => quoted(entry.source)) : [];
  const interruptParameter = vectors ? `source: ${name}InterruptSource` : named ? `source: ${name}InterruptSource, acknowledge?: () => number` : "acknowledge: () => number";
  const interruptTypes = [
    ...(sourceNames.length ? [`export type ${name}InterruptSource = ${sourceNames.join(" | ")};`] : []),
    ...(vectors ? [] : [`export type ${name}InterruptAccess = ${name}Access | InterruptAcknowledge;`, `export type ${name}InterruptInstruction = InterruptInstruction;`]),
  ].join("\n");
  const overloads = named ? execution.entries.map(entry =>
    `  interrupt(source: ${quoted(entry.source)}${entry.delivery.kind === "acknowledged" ? ", acknowledge: () => number" : ""}): ${name}InterruptRecord;`).join("\n") + "\n" : "";
  const initialState = vectors ? `ReadonlyState<${name}State>` : `${name}State`;
  const nested = [...new Set(api.snapshots.filter(({ field }) => field.includes(".")).map(({ field }) => field.split(".")[0]!))];
  const at = (parent?: string) => api.snapshots.filter(({ field }) => parent === undefined ? !field.includes(".") : field.startsWith(parent + "."));
  const additions = (parent?: string) => at(parent).map(({ field, description }) =>
    `  ${comment(description)}\n  readonly ${quoted(field.split(".").at(-1)!)}: number;`).join("\n");
  const bankType = (field: string) => `ReadonlyState<${name}State[${quoted(field)}]> & {\n${additions(field)}\n}`;
  const snapshotTypes = (api.banks ?? []).map(bank => `export type ${name}${bank.snapshot} = ${bankType(bank.field)};`).join("\n");
  const derived = (parent?: string) => at(parent).map(({ field, view }) => `${quoted(field.split(".").at(-1)!)}: views[${quoted(view)}]()`);
  const snapshotValues = [...derived(), ...nested.map(field => `${quoted(field)}: { ...state[${quoted(field)}], ${derived(field).join(", ")} }`)];
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

${snapshotTypes}
export type ${name}Snapshot = ReadonlyState<${name}State> & {
${additions()}
${nested.map(field => {
  const alias = api.banks?.find(bank => bank.field === field);
  return `  readonly ${quoted(field)}: ${alias ? name + alias.snapshot : bankType(field)};`;
}).join("\n")}
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
  readonly #execution: ReturnType<typeof createExecution<${name}Snapshot>>;

  constructor(ram: Ram, initialState: ${initialState}${vectors ? "" : ", ports?: BytePorts"}${notification ? ", onReti?: () => void" : ""}) {
    checkMemory(ram);
    this.#state = readState(${schema}, initialState);
    this.#execution = createExecution(this.#state, ram, () => this.snapshot()${vectors ? "" : ", ports"}${notification ? ", onReti" : ""});
  }

  snapshot(): ${name}Snapshot {
    const state = copyState(${schema}, this.#state), views = sourceReaders(state).views;
    return { ...state${snapshotValues.length ? ", " + snapshotValues.join(", ") : ""} };
  }

  reset(): ${name}ResetRecord { return this.#execution.reset(); }
  step(): ${name}StepRecord { return this.#execution.step(); }
${overloads}  interrupt(${interruptParameter}): ${name}InterruptRecord { return this.#execution.interrupt(${vectors ? "source" : named ? "source, acknowledge" : "acknowledge"}); }
}
`;
}
