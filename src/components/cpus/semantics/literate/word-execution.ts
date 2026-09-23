import { instructionAliases, instructionSet } from "../builders.ts";
import { chapterWordEvents } from "./word-events.ts";
import type { WordEvents } from "./word-events.ts";
import type { Flag, InstructionDefinition, Latch, Statement, ValueSource } from "../model.ts";
import type { OpcodeEntry } from "../../opcodes.ts";
import type { WordExceptionPolicy } from "../../word-execution.ts";
import { checkStateEffects } from "./statements.ts";
import { chapterBody } from "./document.ts";
import type { ChapterTokens } from "./document.ts";

interface EncodedInput { readonly shift: number; readonly mask: number; readonly width: number }
export interface WordExecution {
  readonly mode: "word";
  readonly interrupt: "external" | "events";
  readonly events?: WordEvents;
  readonly counter: string;
  readonly bits: number;
  readonly memoryBits: number;
  readonly order: "big" | "little";
  readonly alignment: 1 | 2;
  readonly terminal: string;
  readonly stopped: string;
  readonly pending: string;
  readonly sample: Flag;
  readonly pendingException: string;
  readonly fetched: string;
  readonly retire: string;
  readonly trace: string;
  readonly address: string;
  readonly unknown: string;
  readonly unsupported: string;
  readonly inputs: Readonly<Record<string, EncodedInput>>;
  readonly exceptions: Readonly<Record<string, WordExceptionPolicy>>;
}

/** An input mask exposes its position in the operation word without assigning register meaning. */
function encodedInput(tokens: ChapterTokens): EncodedInput {
  const pattern = tokens.quoted().replaceAll(/[\s_]/g, "");
  if (!/^x*([a-wyz])\1*x*$/.test(pattern) || pattern.length !== 16) {
    return tokens.fail("A word input needs 16 bits: one contiguous named field and x elsewhere.");
  }
  const first = pattern.search(/[^x]/), last = pattern.search(/[^x]x*$/), width = last - first + 1;
  return { shift: 15 - last, mask: 2 ** width - 1, width };
}

export function chapterWordExecution(header: ChapterTokens, lines: readonly ChapterTokens[], symbols: {
  readonly views: ReadonlyMap<string, ValueSource>; readonly actions: ReadonlyMap<string, InstructionDefinition>;
  readonly sources: ReadonlyMap<string, ValueSource>; readonly latches: ReadonlyMap<string, Latch>; readonly flags: ReadonlyMap<string, Flag>;
}): WordExecution {
  const fields = new Map<string, ChapterTokens>(), blocks = new Map<string, readonly ChapterTokens[]>();
  for (let index = 0; index < lines.length; index++) {
    const tokens = lines[index]!, kind = tokens.word();
    if (fields.has(kind)) tokens.fail(`Duplicate word execution field ${kind}.`);
    fields.set(kind, tokens);
    if (kind === "inputs" || kind === "exceptions" || kind === "events") {
      tokens.expect("{"); tokens.end();
      const { body, end } = chapterBody(lines, index); index = end; blocks.set(kind, body);
    }
  }
  const required = (name: string): ChapterTokens => {
    const tokens = fields.get(name) ?? header.fail(`Word execution needs ${name}.`);
    fields.delete(name); return tokens;
  };
  const action = (tokens: ChapterTokens, widths: readonly number[]): string => {
    tokens.expect("action"); const name = tokens.word(), definition = symbols.actions.get(name) ?? tokens.fail(`Unknown state action ${name}.`);
    if (JSON.stringify(Object.values(definition.inputs ?? {})) !== JSON.stringify(widths)) tokens.fail(`Execution action needs inputs [${widths.join(", ")}].`);
    tokens.checked(() => checkStateEffects(definition.steps, "state", false)); return name;
  };
  const pc = required("counter"), counter = pc.word(), view = symbols.views.get(counter) ?? pc.fail(`Unknown counter view ${counter}.`); pc.end();
  const bits = view.width;
  const memory = required("memory"), memoryBits = memory.number(); memory.end();
  if (!Number.isInteger(memoryBits) || memoryBits < 1 || memoryBits > bits) memory.fail("Word memory width must be an integer within the logical address width.");
  const fetch = required("fetch"), order = fetch.take("big") ? "big" : fetch.take("little") ? "little" : fetch.fail("Expected big or little word order.");
  fetch.expect("advance"); fetch.expect("after"); fetch.expect("word"); fetch.end();
  const align = required("alignment"), alignment = align.take("1") ? 1 : align.take("2") ? 2 : align.fail("Word alignment must be 1 or 2."); align.end();
  const terminalAt = required("terminal"), terminal = terminalAt.lookup(symbols.latches).field; terminalAt.end();
  const stoppedAt = required("stopped"), stopped = stoppedAt.lookup(symbols.latches).field; stoppedAt.end();
  const tracing = required("trace"), sample = tracing.lookup(symbols.flags);
  tracing.expect("pending"); const pending = tracing.lookup(symbols.latches).field;
  tracing.expect("exception"); const pendingException = tracing.quoted(), trace = action(tracing, [8]); tracing.end();
  const fetchedAt = required("fetched"), fetched = action(fetchedAt, [16]); fetchedAt.end();
  const retireAt = required("retire"), retire = action(retireAt, [bits, 8]); retireAt.end();
  const addressAt = required("address"); addressAt.expect("source");
  const address = addressAt.word(), source = symbols.sources.get(address) ?? addressAt.fail(`Unknown address source ${address}.`); addressAt.end();
  if (source.width !== 32 || JSON.stringify(Object.values(source.inputs ?? {})) !== "[8,3,3]") addressAt.fail("Address source needs [8, 3, 3] inputs and a 32-bit result.");
  const unknownAt = required("unknown"), unknown = unknownAt.quoted(); unknownAt.end();
  const unsupportedAt = required("unsupported"), unsupported = unsupportedAt.quoted(); unsupportedAt.end();
  required("inputs"); const inputs = new Map<string, EncodedInput>();
  for (const tokens of blocks.get("inputs")!) {
    const name = tokens.word(); tokens.expect("=");
    if (inputs.has(name)) tokens.fail(`Duplicate encoded input ${name}.`);
    inputs.set(name, encodedInput(tokens)); tokens.end();
  }
  const exceptionsAt = required("exceptions"), exceptions = new Map<string, WordExceptionPolicy>();
  for (const tokens of blocks.get("exceptions")!) {
    const name = tokens.quoted(); tokens.expect("vector"); const vector = tokens.number();
    if (exceptions.has(name) || name === "unsupported") tokens.fail(`Duplicate or reserved exception ${name}.`);
    const offset = tokens.take("plus") ? encodedInput(tokens) : undefined;
    if (!Number.isInteger(vector) || vector < 0 || vector + (offset?.mask ?? 0) > 255) tokens.fail("Exception vectors must fit a byte.");
    const completed = tokens.take("complete"); if (!completed) tokens.expect("restart"); tokens.end();
    exceptions.set(name, { vector, completed, ...(offset ? { offset } : {}) });
  }
  for (const name of [unknown, unsupported, pendingException]) if (!exceptions.has(name)) exceptionsAt.fail(`Unknown exception ${name}.`);
  header.checked(() => checkWordEffects(source.steps, Object.fromEntries(exceptions), "address"));
  const interrupt = required("interrupt"), owned = interrupt.take("events");
  if (!owned) interrupt.expect("external"); interrupt.end();
  const events = owned ? chapterWordEvents(required("events"), blocks.get("events")!, symbols) : undefined;
  for (const [name, tokens] of fields) tokens.fail(`Unknown word execution field ${name}.`);
  return { mode: "word", interrupt: owned ? "events" : "external", ...(events ? { events } : {}), counter, bits, memoryBits, order, alignment, terminal, stopped, pending, sample,
    pendingException, fetched, retire, trace, address, unknown, unsupported, inputs: Object.fromEntries(inputs), exceptions: Object.fromEntries(exceptions) };
}

/** Check effects transitively, so hidden byte fetches, ports, or undeclared exceptions cannot escape. */
export function checkWordEffects(steps: readonly Statement[], exceptions: WordExecution["exceptions"], context: "instruction" | "address" = "instruction"): void {
  for (const step of steps) switch (step.kind) {
    case "fetch-byte": case "read-port": case "write-port": case "defer-interrupt": case "notify-reti": case "report-interrupt": case "read-test": case "send-escape":
      throw new Error(`Word execution does not supply ${step.kind}.`);
    case "read-pending-register": case "stage-register":
      if (context !== "address") throw new Error("Word execution supplies staging inside its address source, not directly to instruction bodies.");
      break;
    case "resolve-address": case "commit-address-updates":
      if (context !== "instruction") throw new Error("A word address source cannot resolve or commit through its own caller.");
      break;
    case "reject": case "divide": {
      const reason = step.kind === "reject" ? step.reason : step.onError;
      if (reason !== "unsupported" && !Object.hasOwn(exceptions, reason)) throw new Error(`Unknown word exception ${reason}.`);
      break;
    }
    case "read-source": checkWordEffects(step.source.steps, exceptions, context); break;
    case "perform": checkWordEffects(step.action.steps, exceptions, context); break;
    case "choose": checkWordEffects(step.yes.steps, exceptions, context); checkWordEffects(step.no.steps, exceptions, context); break;
    case "when": case "iterate": case "iterate-together": checkWordEffects(step.steps, exceptions, context); break;
    case "dispatch": case "match": for (const branch of step.cases) checkWordEffects(branch.steps, exceptions, context); break;
    default: break;
  }
}

export interface WordInstructionModule {
  readonly name: string;
  readonly definitions: Readonly<Record<string, InstructionDefinition>>;
  readonly options?: { readonly opcodeAliases?: readonly OpcodeEntry<string>[] };
}

/** Encoded inputs determine calling conventions; chapter families need no manual module registry. */
export function wordInstructionGroups(module: string, entries: readonly OpcodeEntry<InstructionDefinition>[]) {
  const groups = new Map<string, OpcodeEntry<InstructionDefinition>[]>();
  instructionSet(entries, 16); // Check collisions across every signature, not just within a group.
  for (const entry of entries) {
    const signature = Object.keys(entry[1].inputs ?? {}).join("-");
    const group = groups.get(signature) ?? []; group.push(entry); groups.set(signature, group);
  }
  return [...groups].map(([signature, entries]) => ({
    name: module + (signature ? "-" + signature.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase()) : ""),
    ...(signature ? instructionAliases(entries) : { definitions: instructionSet(entries, 16) }),
  }));
}

/** Only sources referenced by execution or entry contracts need standalone runtime readers. */
export function wordExecutionSources(policy: WordExecution): readonly string[] {
  const events = policy.events;
  return [policy.address, ...(events ? [events.entryReturn, events.functionCode, events.initialTerminal,
    events.initialReturn, events.initialProcessing, events.gate, events.autovector] : [])];
}

/** Existing body modules retain their narrow APIs; this generated adapter binds their encoded inputs once. */
export function generateWordExecution(module: string, policy: WordExecution, modules: readonly WordInstructionModule[]): string {
  if (!modules.length) throw new Error("Word execution needs instruction modules.");
  const quoted = JSON.stringify;
  const tables = modules.map(({ name, definitions, options }, index) => {
    const bodies = Object.values(definitions), inputs = Object.entries(bodies[0]?.inputs ?? {});
    if (!bodies.length || bodies.some(definition => JSON.stringify(Object.entries(definition.inputs ?? {})) !== JSON.stringify(inputs))) {
      throw new Error(`${name}: word binding needs a consistent ordered input signature.`);
    }
    for (const [input, width] of inputs) if (policy.inputs[input]?.width !== width) throw new Error(`${name}: missing or wrong-width encoded input ${input}.`);
    const parameters = inputs.map((_, index) => `input${index}: number`);
    const captures = inputs.map(([name], index) => `input${index} = (opcode >>> ${policy.inputs[name]!.shift}) & ${policy.inputs[name]!.mask}`);
    return { import: `import { ${options?.opcodeAliases ? "opcodeInstructions" : "instructions"} as instructions${index} } from "./${name}.ts";`,
      table: `const table${index}: Readonly<Record<number, (state: State, ${[...parameters, "context: Context"].join(", ")}) => Result>> = instructions${index};`,
      entries: `  ...Object.entries(table${index}).map(([word, execute]): OpcodeEntry<Handler> => {
    const opcode = Number(word)${captures.length ? ", " + captures.join(", ") : ""};
    return [opcode, (state, context) => execute(state, ${[...inputs.map((_, index) => `input${index}`), "context"].join(", ")})];
  }),` };
  });
  const exceptionPolicies = Object.entries(policy.exceptions).map(([name, policy]) => `  [${quoted(name)}]: ${JSON.stringify(policy)},`).join("\n");
  const sample = `state${policy.sample.bank === undefined ? "" : `[${quoted(policy.sample.bank)}]`}.flags[${quoted(policy.sample.field)}]`;
  return `// Generated from the chapter's word execution contract. Do not edit.
import { wordExecution } from "../word-execution.ts";
import type { WordDelivery, WordInstructionContext, WordAddressContext, WordMemoryFault } from "../word-execution.ts";
import { registerUpdates } from "../register-updates.ts";
import type { RegisterUpdateContext } from "../register-updates.ts";
import { opcodeTable } from "../opcodes.ts";
import type { OpcodeEntry } from "../opcodes.ts";
import { instructions as actions, sourceReaders } from "./${module}-state.ts";
${tables.map(table => table.import).join("\n")}

export const exceptions = {
${exceptionPolicies}
} as const;
type Source = keyof typeof exceptions;
type State = Parameters<typeof actions[${quoted(policy.fetched)}]>[0];
type Context = WordInstructionContext & WordAddressContext;
type Result = Source | "unsupported" | WordMemoryFault | void;
type Handler = (state: State, context: Context) => Result;
${tables.map(table => table.table).join("\n")}
const handlers = opcodeTable<Handler>([
${tables.map(table => table.entries).join("\n")}
], 16);

export function createExecution<Exception, Fault>(state: State, delivery: WordDelivery<Source, Exception, Fault>) {
  const { views, sources } = sourceReaders(state);
  const resolve: (size: number, mode: number, code: number, context: WordInstructionContext & RegisterUpdateContext) => number | "unsupported" = sources[${quoted(policy.address)}];
  return wordExecution<Source, Exception, Fault>({
    bits: ${policy.bits}, order: ${quoted(policy.order)}, alignment: ${policy.alignment},
    counter: views[${quoted(policy.counter)}],
    terminal: () => state[${quoted(policy.terminal)}], stopped: () => state[${quoted(policy.stopped)}],
    pending: () => state[${quoted(policy.pending)}], sample: () => ${sample},
    pendingException: ${quoted(policy.pendingException)}, exceptions,
    unsupported: ${quoted(policy.unsupported)},
    fetched: opcode => actions[${quoted(policy.fetched)}](state, opcode),
    retire: (address, sample) => actions[${quoted(policy.retire)}](state, address, sample),
    trace: sample => actions[${quoted(policy.trace)}](state, sample),
    dispatch: (opcode, instruction) => {
      const handler = handlers[opcode];
      if (!handler) return ${quoted(policy.unknown)};
      const updates = registerUpdates(), context = { ...instruction, ...updates };
      return handler(state, { ...instruction, commitAddressUpdates: updates.commit,
        resolveAddress: (size, mode, code) => {
          const address = resolve(size, mode, code, context);
          if (address === "unsupported") throw new Error("Unsupported effective address reached execution.");
          return address;
        },
      });
    },
  }, delivery);
}
`;
}
