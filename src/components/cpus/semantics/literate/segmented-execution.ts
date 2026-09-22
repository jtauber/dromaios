import type { Flag, InstructionDefinition, Latch, Register, Statement, ValueSource } from "../model.ts";
import { chapterBody } from "./document.ts";
import type { ChapterTokens } from "./document.ts";
import { chapterVectorOffers, generateVectorOffers } from "./vector-offers.ts";
import type { ChapterVectorOffer } from "./vector-offers.ts";
import { checkStateEffects } from "./statements.ts";

export interface SegmentedExecution {
  readonly mode: "segmented";
  readonly interrupt: "offers";
  readonly entries: readonly ChapterVectorOffer[];
  readonly memoryBits: number;
  readonly counter: string;
  readonly writeCounter: string;
  readonly segment: string;
  readonly baseShift: number;
  readonly recordAddress: string;
  readonly fetched: string;
  readonly prefixLimit: number;
  readonly prefixes: readonly ({ readonly opcode: number } & (
    { readonly kind: "segment"; readonly field: string } | { readonly kind: "repeat"; readonly value: number } | { readonly kind: "ignore" }
  ))[];
  readonly stopped: string;
  readonly waiting: string;
  readonly resume: string;
  readonly resumeArgument: number;
  readonly pending: { readonly source: string; readonly vector: number; readonly owed: string; readonly inhibited: string; readonly consume: string; readonly enter: string };
  readonly fault: { readonly source: string; readonly vector: number; readonly enter: string };
  readonly reset: string;
  readonly retire: string;
  readonly samples: readonly (Flag | Latch)[];
}

type Symbols = {
  readonly registers: ReadonlyMap<string, Register>;
  readonly flags: ReadonlyMap<string, Flag>;
  readonly latches: ReadonlyMap<string, Latch>;
  readonly views: ReadonlyMap<string, ValueSource>;
  readonly actions: ReadonlyMap<string, InstructionDefinition>;
};

/** The segmented boundary admits only effects it can supply and fault outcomes it can deliver. */
export function checkSegmentedEffects(steps: readonly Statement[], fault: string, continuation = false): void {
  for (const step of steps) switch (step.kind) {
    case "choose": checkSegmentedEffects(step.yes.steps, fault, continuation); checkSegmentedEffects(step.no.steps, fault, continuation); break;
    case "when": case "iterate": case "iterate-together": checkSegmentedEffects(step.steps, fault, continuation); break;
    case "read-source": checkSegmentedEffects(step.source.steps, fault, continuation); break;
    case "perform": checkSegmentedEffects(step.action.steps, fault, continuation); break;
    case "dispatch": case "match":
      if (continuation) throw new Error("A waiting continuation cannot reject an encoding.");
      for (const branch of step.cases) checkSegmentedEffects(branch.steps, fault); break;
    case "capture": case "read-register": case "read-element": case "read-flag": case "read-latch": case "test-choice":
    case "write-register": case "write-element": case "fill-array": case "write-latch": case "write-choice": case "update-flags": case "replace-flags": case "exchange-flags":
    case "read-test": break;
    case "defer-interrupt":
      if (step.scope === "irq") throw new Error("Segmented retirement accepts intr or all deferral.");
      break;
    case "fetch-byte": case "read-memory": case "write-memory": case "read-port": case "write-port":
    case "send-escape": case "report-interrupt":
      if (continuation) throw new Error(`A waiting continuation cannot use ${step.kind}.`);
      break;
    case "reject": case "divide":
      if (continuation || (step.kind === "reject" ? step.reason !== fault && step.reason !== "opcode" && step.reason !== "unsupported" : step.onError !== fault || step.overflow !== undefined)) throw new Error("Instruction outcome needs a declared segmented fault.");
      break;
    default: throw new Error(`Segmented execution does not support ${step.kind}.`);
  }
}

/** Keep segmentation, prefix bytes, and lifecycle actions in the chapter, with no implicit CPU defaults. */
export function chapterSegmentedExecution(header: ChapterTokens, lines: readonly ChapterTokens[], symbols: Symbols): SegmentedExecution {
  const fields = new Map<string, ChapterTokens>();
  let prefixLines: readonly ChapterTokens[] = [], offerLines: readonly ChapterTokens[] = [];
  for (let index = 0; index < lines.length; index++) {
    const tokens = lines[index]!, name = tokens.word();
    if (fields.has(name)) tokens.fail(`Duplicate execution field ${name}.`);
    fields.set(name, tokens);
    if (name === "interrupt") { const { body, end } = chapterBody(lines, index); offerLines = body; index = end; }
    if (name === "prefixes") { const { body, end } = chapterBody(lines, index); prefixLines = body; index = end; }
  }
  const required = (name: string) => {
    const tokens = fields.get(name) ?? header.fail(`Segmented execution needs ${name}.`);
    fields.delete(name); return tokens;
  };
  const number = (tokens: ChapterTokens, maximum: number) => {
    const value = tokens.number();
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) tokens.fail(`Expected an integer from 0 to ${maximum}.`);
    return value;
  };
  const register = (tokens: ChapterTokens) => {
    const value = tokens.lookup(symbols.registers);
    if (value.width !== 16 || value.bank) tokens.fail("Segmented execution requires top-level word registers.");
    return value.field;
  };
  const action = (tokens: ChapterTokens, widths: readonly number[], effects: "state" | "memory" | "continuation") => {
    const name = tokens.word(), definition = symbols.actions.get(name) ?? tokens.fail(`Unknown state action ${name}.`);
    if (JSON.stringify(Object.values(definition.inputs ?? {})) !== JSON.stringify(widths)) tokens.fail(`Execution action requires input widths [${widths.join(", ")}].`);
    if (effects === "continuation") tokens.checked(() => checkSegmentedEffects(definition.steps, "", true));
    else tokens.checked(() => checkStateEffects(definition.steps, effects, false));
    return name;
  };
  const memory = required("memory"), memoryBits = number(memory, 24); memory.end();
  if (memoryBits < 16) memory.fail("Segmented memory must have 16 to 24 address bits.");
  const counterAt = required("counter"), counter = register(counterAt); counterAt.expect("write");
  const writeCounter = action(counterAt, [16], "state"); counterAt.end();
  const segmentAt = required("segment"), segment = register(segmentAt); segmentAt.expect("shift");
  const baseShift = number(segmentAt, memoryBits - 16); segmentAt.end();
  const record = required("record"); record.expect("address"); const recordAddress = record.word();
  const view = symbols.views.get(recordAddress) ?? record.fail(`Unknown address view ${recordAddress}.`);
  if (view.width !== 32 || Object.keys(view.inputs ?? {}).length) record.fail("Record address requires a parameterless 32-bit view.");
  record.end();
  const fetch = required("fetch"); fetch.expect("action"); const fetched = action(fetch, [], "state"); fetch.end();
  const prefixAt = required("prefixes"); prefixAt.expect("limit"); const prefixLimit = number(prefixAt, 65536);
  if (prefixLimit === 0) prefixAt.fail("Prefix limit must be positive."); prefixAt.expect("{"); prefixAt.end();
  const seen = new Set<number>();
  const prefixes = prefixLines.map((tokens): SegmentedExecution["prefixes"][number] => {
    const kind = tokens.word(), opcode = number(tokens, 255);
    if (seen.has(opcode)) tokens.fail("Duplicate prefix byte."); seen.add(opcode);
    if (kind === "segment") { const field = register(tokens); tokens.end(); return { kind, opcode, field }; }
    if (kind === "repeat") {
      const value = number(tokens, 255); if (!value) tokens.fail("Repeat mode zero is reserved for an unprefixed instruction.");
      tokens.end(); return { kind, opcode, value };
    }
    if (kind !== "ignore") return tokens.fail("Expected segment, repeat, or ignore prefix.");
    tokens.end(); return { kind, opcode };
  });
  const stop = required("stopped"), stopped = stop.lookup(symbols.latches).field; stop.end();
  const wait = required("waiting"), waiting = wait.lookup(symbols.latches).field; wait.expect("with");
  const resume = action(wait, [8], "continuation"); wait.expect("("); const resumeArgument = number(wait, 255); wait.expect(")"); wait.end();
  const pendingAt = required("pending"), source = pendingAt.quoted(); pendingAt.expect("vector"); const vector = number(pendingAt, 255);
  pendingAt.expect("when"); const owed = pendingAt.lookup(symbols.latches).field;
  pendingAt.expect("unless"); const inhibited = pendingAt.lookup(symbols.latches).field;
  pendingAt.expect("with"); const consume = action(pendingAt, [], "state"); pendingAt.expect("then");
  const enter = action(pendingAt, [8], "memory"); pendingAt.end();
  const faultAt = required("fault"), faultSource = faultAt.quoted(); faultAt.expect("vector"); const faultVector = number(faultAt, 255);
  faultAt.expect("with"); const faultEnter = action(faultAt, [8], "memory"); faultAt.end();
  if (!source.trim() || !faultSource.trim() || ["unsupported", "opcode", "software"].includes(faultSource)) faultAt.fail("Pending and fault delivery need nonempty, unreserved source names.");
  const resetAt = required("reset"); resetAt.expect("action"); const reset = action(resetAt, [], "state"); resetAt.end();
  const retireAt = required("retire"); retireAt.expect("action"); const retire = retireAt.word(); retireAt.expect("sampling");
  const samples: (Flag | Latch)[] = [];
  do {
    const kind = retireAt.word();
    if (kind === "flag") samples.push(retireAt.lookup(symbols.flags, true));
    else if (kind === "latch") samples.push(retireAt.lookup(symbols.latches));
    else retireAt.fail("Retirement samples must name a flag or latch.");
  } while (retireAt.take(","));
  retireAt.end();
  const retireDefinition = symbols.actions.get(retire) ?? retireAt.fail(`Unknown state action ${retire}.`);
  const widths = Object.values(retireDefinition.inputs ?? {});
  if (widths.length !== samples.length + 2 || widths.some(width => width !== 8)) retireAt.fail("Retirement takes two byte deferrals followed by one byte per sample.");
  retireAt.checked(() => checkStateEffects(retireDefinition.steps, "state", false));
  const unsupported = required("unsupported"); unsupported.expect("restore"); unsupported.expect("counter"); unsupported.end();
  const failure = required("failure"); failure.expect("retain"); failure.end();
  const interrupt = required("interrupt"); interrupt.expect("offers"); interrupt.expect("{"); interrupt.end();
  const entries = chapterVectorOffers(interrupt, offerLines, symbols);
  for (const [name, tokens] of fields) tokens.fail(`Unknown execution field ${name}.`);
  return { mode: "segmented", interrupt: "offers", entries, memoryBits, counter, writeCounter, segment, baseShift, recordAddress,
    fetched, prefixLimit, prefixes, stopped, waiting, resume, resumeArgument,
    pending: { source, vector, owed, inhibited, consume, enter }, fault: { source: faultSource, vector: faultVector, enter: faultEnter }, reset, retire, samples };
}

/** Bind the three chapter family signatures to one shared segmented execution service. */
export function generateSegmentedExecution(cpu: string, module: string, policy: SegmentedExecution): string {
  const q = JSON.stringify, field = (name: string) => `state[${q(name)}]`, call = (name: string, args = "") => `actions[${q(name)}](state${args})`;
  const prefix = policy.prefixes.map(entry => `      [${entry.opcode}, { kind: ${q(entry.kind)}${entry.kind === "segment" ? `, read: () => ${field(entry.field)}` : entry.kind === "repeat" ? `, value: ${entry.value}` : ""} }],`).join("\n");
  const { pending, fault } = policy;
  return `// Generated from the chapter's execution contract. Do not edit.
import { segmentedExecution } from "../segmented-execution.ts";
import { vectorOffers } from "../vector-offers.ts";
import type { SegmentedExecutionPolicy } from "../segmented-execution.ts";
import { programCounter } from "../execute-byte-instruction.ts";
import { checkByteMemory } from "../byte-execution.ts";
import { opcodeTable } from "../opcodes.ts";
import type { Ram } from "../../memory/ram.ts";
import type { BytePorts } from "../port-access.ts";
import { recordCoprocessor } from "../coprocessor-access.ts";
import type { CoprocessorAccess, CoprocessorContext, CoprocessorConnections } from "../coprocessor-access.ts";
import { opcodeEntries } from "./${module}.ts";
import { instructions as operands } from "./${module}-operands.ts";
import { instructions as strings } from "./${module}-strings.ts";
import { instructions as actions, sourceReaders } from "./${module}-state.ts";

export const checkMemory = (ram: Ram): void => checkByteMemory(${q(cpu)}, ram, ${policy.memoryBits});
export const recordDevices = (connections: CoprocessorConnections | undefined, record: (access: CoprocessorAccess) => void) =>
  recordCoprocessor(${q(cpu)}, connections, record);

export function createExecution<Snapshot>(state: Parameters<typeof opcodeEntries>[0], ram: Ram, snapshot: () => Snapshot,
  ports: () => BytePorts | undefined, devices: (record: (access: CoprocessorAccess) => void) => CoprocessorContext) {
  const views = sourceReaders(state).views;
  type Policy = SegmentedExecutionPolicy<CoprocessorContext, ${q(fault.source)}, { readonly source: ${q(pending.source)}; readonly vector: ${pending.vector} }>;
  type Handler = NonNullable<Policy["handlers"][number]>;
  const policy: Policy = {
    memoryBits: ${policy.memoryBits}, segment: () => ${field(policy.segment)}, baseShift: ${policy.baseShift},
    counter: programCounter(() => ${field(policy.counter)}, value => ${call(policy.writeCounter, ", value")}),
    recordAddress: views[${q(policy.recordAddress)}], fetched: () => ${call(policy.fetched)},
    prefixLimit: ${policy.prefixLimit}, prefixes: opcodeTable([
${prefix}
    ]),
    handlers: opcodeTable<Handler>([
      ...opcodeEntries(state).map(([opcode, execute]): readonly [number, Handler] => [opcode, { repeated: false, execute: (_inputs, context) => execute(context) }]),
      ...Object.entries(operands).map(([opcode, execute]): readonly [number, Handler] => [Number(opcode), { repeated: false,
        execute: (inputs, context) => execute(state, inputs.overridden, inputs.segmentOverride, context) }]),
      ...Object.entries(strings).map(([opcode, execute]): readonly [number, Handler] => [Number(opcode), { repeated: true,
        execute: (inputs, context) => execute(state, inputs.overridden, inputs.segmentOverride, inputs.repeatMode, inputs.startIP, context) }]),
    ]),
    stopped: () => ${field(policy.stopped)}, waiting: () => ${field(policy.waiting)},
    resume: context => ${call(policy.resume, `, ${policy.resumeArgument}, context`)}, reset: () => ${call(policy.reset)},
    sample: () => [${policy.samples.map(sample => `Number(${sample.kind === "flag" ? `state${sample.bank ? `[${q(sample.bank)}]` : ""}.flags[${q(sample.field)}]` : field(sample.field)})`).join(", ")}],
    retire: (intr, all, samples) => ${call(policy.retire, ", intr, all" + policy.samples.map((_, index) => `, samples[${index}]!`).join(""))},
    pending: {
      delivery: { source: ${q(pending.source)}, vector: ${pending.vector} },
      owed: () => ${field(pending.owed)}, inhibited: () => ${field(pending.inhibited)},
      enter: memory => { ${call(pending.consume)}; ${call(pending.enter, `, ${pending.vector}, memory`)}; },
    },
    faults: { [${q(fault.source)}]: { vector: ${fault.vector}, enter: memory => ${call(fault.enter, `, ${fault.vector}, memory`)} } },
  };
  const boundary = segmentedExecution(${q(cpu)}, ram, ports, snapshot, devices, policy);
  const offer = vectorOffers(${q(cpu)}, ram, snapshot, {
${generateVectorOffers(policy.entries)}
  });
  return { reset: boundary.reset, step: boundary.step,
    interrupt: (source: ${policy.entries.map(entry => q(entry.source)).join(" | ")}, acknowledge?: () => number) => boundary.atBoundary(() => offer(source, acknowledge)),
  };
}
`;
}
