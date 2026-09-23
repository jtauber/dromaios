import type { StateFields } from "../../state.ts";
import type { ChapterInterface } from "./interface.ts";

export function stateAliases(state: StateFields) {
  return Object.entries(state).filter(([, value]) => value.kind === "array" || value.kind === "group")
    .map(([field]) => ({ field, name: field[0]!.toUpperCase() + field.slice(1) }));
}

export const comment = (text: string) => `/** ${text.replace(/\*\//g, "* /").replace(/[\r\n\u2028\u2029]/g, " ")} */`;

/** Shared snapshot rendering preserves detached storage and declared derived views in every runtime. */
export function snapshotInterface(api: ChapterInterface) {
  const name = api.name, quoted = JSON.stringify;
  const nested = [...new Set(api.snapshots.filter(({ field }) => field.includes(".")).map(({ field }) => field.split(".")[0]!))];
  const at = (parent?: string) => api.snapshots.filter(({ field }) => parent === undefined ? !field.includes(".") : field.startsWith(parent + "."));
  const additions = (parent?: string) => at(parent).map(({ field, description, type }) =>
    `  ${comment(description)}\n  readonly ${quoted(field.split(".").at(-1)!)}: ${type === "flag" ? "boolean" : "number"};`).join("\n");
  const bankType = (field: string) => `ReadonlyState<${name}State[${quoted(field)}]> & {\n${additions(field)}\n}`;
  const snapshotTypes = (api.banks ?? []).map(bank => `export type ${name}${bank.snapshot} = ${bankType(bank.field)};`).join("\n");
  const derived = (parent?: string) => at(parent).map(({ field, view }) => `${quoted(field.split(".").at(-1)!)}: views[${quoted(view)}]()`);
  const values = [...derived(), ...nested.map(field => `${quoted(field)}: { ...state[${quoted(field)}], ${derived(field).join(", ")} }`)];
  return { types: snapshotTypes, fields: [additions(), ...nested.map(field => {
    const alias = api.banks?.find(bank => bank.field === field);
    return `  readonly ${quoted(field)}: ${alias ? name + alias.snapshot : bankType(field)};`;
  })].join("\n"), values };
}
