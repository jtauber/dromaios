import { literateBlocks } from "../../../literate.ts";
import type { CpuDeclaration, InstructionDefinition, Latch, Register, ValueSource } from "../../cpus/semantics/model.ts";
import { chapterBody, ChapterError, ChapterTokens } from "../../cpus/semantics/literate/document.ts";
import { chapterState, stateSymbol } from "../../cpus/semantics/literate/state.ts";
import { chapterDeclaration } from "../../cpus/semantics/literate/declarations.ts";
import { chapterStatements, checkStateEffects } from "../../cpus/semantics/literate/statements.ts";

export interface DeviceInterface {
  readonly name: string;
  readonly size: number;
  readonly initialize: string;
  readonly reset: string;
  readonly validate: string;
  readonly offer?: string;
  readonly reads: ReadonlyMap<number, string>;
  readonly writes: ReadonlyMap<number, { readonly source: string; readonly notify: boolean }>;
}
export interface DeviceChapter {
  readonly model: CpuDeclaration;
  readonly sources: Readonly<Record<string, ValueSource>>;
  readonly actions: Readonly<Record<string, InstructionDefinition>>;
  readonly interface: DeviceInterface;
}

/** Devices reuse the checked state/effect language; no opcode decoder or CPU boundary is involved. */
export function compileDeviceChapter(markdown: string, file = "<device>"): DeviceChapter {
  let model: CpuDeclaration | undefined, ownsState = false, api: DeviceInterface | undefined;
  const registers = new Map<string, Register>(), latches = new Map<string, Latch>();
  const sources = new Map<string, ValueSource>(), actions = new Map<string, InstructionDefinition>();
  const names = new Set<string>();
  const fail = (line: number, message: string): never => { throw new ChapterError(file, line, 1, message); };
  for (const block of literateBlocks(markdown, "device", line => fail(line, "Unclosed device fence."))) {
    const lines = block.lines.map(line => new ChapterTokens(line, file)).filter(tokens => tokens.next !== undefined);
    for (let index = 0; index < lines.length; index++) {
      const header = lines[index]!, kind = header.word();
      if (kind === "device") {
        if (model) header.fail("Device is already declared.");
        const name = header.quoted(); header.end();
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) header.fail("Invalid device name.");
        if (["ram", "rom", "byte-input", "byte-output"].includes(name)) header.fail("Device name is reserved.");
        model = { name, state: {} }; continue;
      }
      if (!model) return header.fail("Declare the device before its contents.");
      const currentModel = model;
      if (api) header.fail("The interface must be the last declaration.");
      if (kind === "state") {
        if (ownsState) header.fail("State is already declared.");
        header.expect("{"); header.end();
        const { body, end } = chapterBody(lines, index); index = end;
        if (!body.length) header.fail("Device state must not be empty.");
        const declarations = body.map(tokens => {
          const kind = tokens.word(), name = tokens.word();
          if (kind !== "register" && kind !== "latch") tokens.fail("Device state currently supports registers and latches.");
          declare(tokens, name);
          const symbol = stateSymbol(tokens, kind, name, currentModel.name);
          if (symbol.kind === "register") registers.set(name, symbol);
          if (symbol.kind === "latch") latches.set(name, symbol);
          return { symbol, tokens };
        });
        model = { ...model, state: chapterState(declarations) }; ownsState = true; continue;
      }
      if (!ownsState) header.fail("Declare device state before behavior.");
      if (kind === "interface") {
        const { body, end } = chapterBody(lines, index); index = end;
        api = deviceInterface(header, body, sources, actions); continue;
      }
      if (kind !== "source" && kind !== "action") return header.fail(`Unknown device declaration ${kind}.`);
      const name = header.word(); declare(header, name);
      index = chapterDeclaration(kind, name, lines, index, block.explanation,
        { cpu: model, flags: new Map(), sources, views: new Map(), actions, policies: new Map() },
        (body, options) => chapterStatements(body, {
          cpu: currentModel, registers, latches, sources, actions,
          arrays: new Map(), choices: new Map(), flags: new Map(), flagGroups: new Map(), policies: new Map(),
          operands: new Map(), conditions: new Map(), catalogues: new Map(),
        }, { ...options, effects: "state" }));
    }
  }
  if (!model || !ownsState || !api) return fail(1, "A device chapter requires device, state, and interface declarations.");
  return { model, sources: Object.fromEntries(sources), actions: Object.fromEntries(actions), interface: api };

  function declare(tokens: ChapterTokens, name: string): void {
    if (names.has(name)) tokens.fail(`Duplicate declaration ${name}.`);
    names.add(name);
  }
}

function deviceInterface(header: ChapterTokens, body: readonly ChapterTokens[],
  sources: ReadonlyMap<string, ValueSource>, actions: ReadonlyMap<string, InstructionDefinition>): DeviceInterface {
  const name = header.word(); header.expect("{"); header.end();
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) header.fail("Expected a public class name.");
  if (["MemoryConnection", "ReadonlyState", "StoredState", "TypeError", "RangeError"].includes(name)) header.fail("Public class name is reserved.");
  const reads = new Map<number, string>(), writes = new Map<number, { source: string; notify: boolean }>();
  const entries = new Map<string, string>(); let size: number | undefined;
  for (const tokens of body) {
    const kind = tokens.word();
    if (kind === "size") {
      if (size !== undefined) tokens.fail("Duplicate size.");
      size = tokens.number(); tokens.end();
      if (size < 1 || size > 256) tokens.fail("Device size must be from 1 to 256.");
      continue;
    }
    const address = kind === "read" || kind === "write" ? tokens.number() : undefined;
    const target = tokens.word();
    if (kind === "initialize" || kind === "reset") {
      const action = actions.get(target) ?? tokens.fail(`Unknown action ${target}.`);
      if (Object.keys(action.inputs ?? {}).length) tokens.fail("Lifecycle actions must have no inputs.");
    } else if (["validate", "offer", "read", "write"].includes(kind)) {
      const source = sources.get(target) ?? tokens.fail(`Unknown source ${target}.`);
      const inputTypes = Object.values(source.inputs ?? {}), byteInput = kind === "offer" || kind === "write";
      if (source.type !== (kind === "read" ? 8 : "flag") || inputTypes.length !== (byteInput ? 1 : 0)
        || (byteInput && inputTypes[0] !== 8)) tokens.fail(`Invalid ${kind} source signature.`);
      if (kind === "validate") {
        // A constructor check must not repair or mutate a supplied snapshot.
        tokens.checked(() => checkStateEffects(source.steps, "view"));
      }
    } else tokens.fail(`Unknown interface binding ${kind}.`);
    const notify = kind === "write" && tokens.take("notify"); tokens.end();
    if (address !== undefined) {
      if (size === undefined || address >= size) tokens.fail("Declare size before register bindings; address must be within it.");
      const bindings = kind === "read" ? reads : writes;
      if (bindings.has(address)) tokens.fail(`Duplicate ${kind} address ${address}.`);
      if (kind === "read") reads.set(address, target); else writes.set(address, { source: target, notify });
    } else {
      if (entries.has(kind)) tokens.fail(`Duplicate ${kind}.`);
      entries.set(kind, target);
    }
  }
  const required = (key: string): string => entries.get(key) ?? header.fail(`Missing ${key} binding.`);
  if (size === undefined) return header.fail("Missing size.");
  return { name, size, initialize: required("initialize"), reset: required("reset"), validate: required("validate"),
    ...(entries.has("offer") ? { offer: entries.get("offer")! } : {}), reads, writes };
}
