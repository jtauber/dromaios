import { generateInstructions } from "../../cpus/semantics/generate.ts";
import { generateChapterState } from "../../cpus/semantics/literate/state.ts";
import type { DeviceChapter } from "./compile.ts";

/** Bind the declared register operations to a byte-device API; hardware rules stay in the chapter. */
export function generateDevice(chapter: DeviceChapter, stem: string) {
  const { model, interface: api } = chapter;
  const output = [...api.writes.values()].some(binding => binding.notify);
  const state = JSON.stringify(Object.fromEntries(Object.entries(model.state).map(([name, field]) =>
    [name, field.kind === "unsigned" ? 0 : false])));
  const read = (source: string, argument = "") => `this.#sources[${JSON.stringify(source)}](${argument})`;
  const lifecycle = (action: string) => `instructions[${JSON.stringify(action)}](this.#state)`;
  const methods = [...api.views, ...api.inputs].map(name => {
    const view = api.views.includes(name);
    const definition = view ? chapter.sources[name]! : chapter.actions[name]!;
    const inputs = Object.entries(definition.inputs ?? {}).map(([name, type], index) => ({ name, type, argument: `input${index}` }));
    const parameters = inputs.map(({ argument, type }) => `${argument}: ${type === "flag" ? "boolean" : "number"}`);
    const checks = inputs.map(({ name, type, argument }) => type === "flag"
      ? `    if (typeof ${argument} !== "boolean") throw new TypeError(${JSON.stringify(`${name} must be Boolean.`)});`
      : `    checkUnsigned(${JSON.stringify(name)}, ${argument}, ${2 ** type - 1});`);
    const result = view ? (chapter.sources[name]!.type === "flag" ? "boolean" : "number") : "void";
    const call = view ? `return ${read(name, inputs.map(input => input.argument).join(", "))}`
      : `instructions[${JSON.stringify(name)}](this.#state${inputs.map(input => `, ${input.argument}`).join("")})`;
    return `  ${JSON.stringify(name)}(${parameters.join(", ")}): ${result} {\n${checks.join("\n")}\n    ${call};\n  }\n`;
  }).join("\n");
  const description = {
    name: api.name, module: `devices/generated/${stem}`, size: api.size,
    reads: [...api.reads.keys()], writes: [...api.writes.keys()], output,
    selectors: api.views.filter(name => chapter.sources[name]!.type === "flag"
      && Object.keys(chapter.sources[name]!.inputs ?? {}).length === 0),
  };
  return {
    description,
    state: generateChapterState(model.state, "../../cpus/state.ts"),
    effects: generateInstructions(model.name, chapter.actions, {
      state: { name: "StoredState", module: `./${stem}-state.ts` }, runtime: "../../cpus",
      sources: { cpu: model, groups: { device: chapter.sources } }, origin: `../specifications/${stem}.md`,
    }),
    module: `// Generated from ../specifications/${stem}.md; do not edit.
import type { MemoryConnection } from "../../memory/connection.ts";
import { checkUnsigned } from "../../validation.ts";
import { copyState, readState } from "../../cpus/state.ts";
import type { ReadonlyState } from "../../cpus/state.ts";
import { state as description } from "./${stem}-state.ts";
import type { StoredState } from "./${stem}-state.ts";
import { instructions, sourceReaders } from "./${stem}-effects.ts";

export type ${api.name}Snapshot = ReadonlyState<StoredState>;

export class ${api.name} implements MemoryConnection {
  readonly #state: StoredState;
  readonly #sources;
${output ? "  readonly #onWrite: (value: number) => void;\n" : ""}
  constructor(${output ? "onWrite: (value: number) => void, " : ""}initialState?: ${api.name}Snapshot) {
${output ? `    if (typeof onWrite !== "function") throw new TypeError("Device requires an output callback.");
    this.#onWrite = onWrite;
` : ""}    this.#state = readState(description, initialState === undefined ? ${state} : initialState);
    this.#sources = sourceReaders(this.#state).device;
    if (initialState === undefined) ${lifecycle(api.initialize)};
    if (!${read(api.validate)}) throw new RangeError("Invalid ${model.name} state.");
  }

  get size(): number { return ${api.size}; }
  snapshot(): ${api.name}Snapshot { return copyState(description, this.#state); }
  reset(): void { ${lifecycle(api.reset)}; }
${methods}
${api.offer ? `
  /** Offer a host byte; false leaves it with the host for later delivery. */
  offer(value: number): boolean {
    checkUnsigned("Offered byte", value, 0xff);
    return ${read(api.offer, "value")};
  }
` : ""}
${api.reads.size && api.reads.size < api.size ? `  read(address: ${[...api.reads.keys()].join(" | ")}): number;
  read(address: number): number | "bus-error";
` : ""}  read(address: number): number${api.reads.size === api.size ? "" : ' | "bus-error"'} {
    checkUnsigned("Device address", address, ${api.size - 1});
    switch (address) {
${[...api.reads].map(([address, { source, addressed }]) => `      case ${address}: return ${read(source, addressed ? String(address) : "")};`).join("\n")}
      default: ${api.reads.size === api.size ? 'throw new RangeError("Invalid device address.");' : 'return "bus-error";'}
    }
  }

  write(address: number, value: number): void${api.writes.size === api.size ? "" : ' | "bus-error"'} {
    checkUnsigned("Device address", address, ${api.size - 1});
    checkUnsigned("Device byte", value, 0xff);
    switch (address) {
${[...api.writes].map(([address, { source, addressed, notify }]) => `      case ${address}:
        if (!${read(source, addressed ? `${address}, value` : "value")}) throw new RangeError("Unsupported ${model.name} write to register ${address}: " + value);
${notify ? "        this.#onWrite(value);\n" : ""}        return;`).join("\n")}
      default: ${api.writes.size === api.size ? 'throw new RangeError("Invalid device address.");' : 'return "bus-error";'}
    }
  }
}
`,
  };
}
