import type { InstructionDefinition, Latch, ValueSource } from "../model.ts";
import { checkStateEffects, usesMemory } from "./statements.ts";
import type { ChapterTokens } from "./document.ts";

export interface WordEvents {
  readonly stack: string; readonly status: string; readonly instruction: string;
  readonly prepare: string; readonly checkStack: string;
  readonly shortFrame: string; readonly shortBytes: number;
  readonly vector: string; readonly complete: string; readonly entryReturn: string;
  readonly memoryFrame: string; readonly memoryBytes: number; readonly addressVector: number; readonly busVector: number;
  readonly functionCode: string; readonly codes: readonly number[]; readonly beginFault: string; readonly halt: string;
  readonly initialTerminal: string; readonly initialReturn: string; readonly initialProcessing: string;
  readonly gate: string; readonly reasons: readonly string[]; readonly accept: string;
  readonly minimum: number; readonly maximum: number; readonly autovector: string; readonly spurious: number;
  readonly vectorMaximum: number; readonly interruptReturn: string; readonly interruptProcessing: boolean;
  /** Only hooks that actually touch RAM receive the memory context in generated calls. */
  readonly memoryActions: readonly string[];
}

type Symbols = {
  readonly views: ReadonlyMap<string, ValueSource>; readonly sources: ReadonlyMap<string, ValueSource>;
  readonly actions: ReadonlyMap<string, InstructionDefinition>; readonly latches: ReadonlyMap<string, Latch>;
};

/** Entry contracts bind narrow, checked hooks; the chapter owns every numeric and state policy. */
export function chapterWordEvents(header: ChapterTokens, lines: readonly ChapterTokens[], symbols: Symbols): WordEvents {
  const fields = new Map<string, ChapterTokens>(), memoryActions = new Set<string>();
  for (const tokens of lines) {
    const first = tokens.word();
    const name = ["stack", "short", "entry", "fault", "function", "initial", "interrupt"].includes(first) ? `${first}-${tokens.word()}` : first;
    if (fields.has(name)) tokens.fail(`Duplicate word event field ${name}.`);
    fields.set(name, tokens);
  }
  const required = (name: string) => {
    const tokens = fields.get(name) ?? header.fail(`Word events need ${name}.`); fields.delete(name); return tokens;
  };
  const number = (tokens: ChapterTokens, maximum = 255) => {
    const value = tokens.number();
    if (!Number.isInteger(value) || value < 0 || value > maximum) tokens.fail(`Expected an integer from 0 to ${maximum}.`);
    return value;
  };
  const signature = (tokens: ChapterTokens, inputs: InstructionDefinition["inputs"], widths: readonly number[]) => {
    if (JSON.stringify(Object.values(inputs ?? {})) !== JSON.stringify(widths)) tokens.fail(`Event hook needs inputs [${widths.join(", ")}].`);
  };
  const view = (tokens: ChapterTokens, width: number) => {
    tokens.expect("view"); const name = tokens.word(), source = symbols.views.get(name) ?? tokens.fail(`Unknown view ${name}.`);
    signature(tokens, source.inputs, []);
    if (source.type !== width) tokens.fail(`Event view needs width ${width}.`);
    return name;
  };
  const source = (tokens: ChapterTokens, widths: readonly number[], width: number) => {
    tokens.expect("source"); const name = tokens.word(), definition = symbols.sources.get(name) ?? tokens.fail(`Unknown source ${name}.`);
    signature(tokens, definition.inputs, widths);
    if (definition.type !== width) tokens.fail(`Event source needs width ${width}.`);
    tokens.checked(() => checkStateEffects(definition.steps, "view", false)); return name;
  };
  const action = (tokens: ChapterTokens, widths: readonly number[], effects: "state" | "alignment" | "memory" | "vector") => {
    tokens.expect("action"); const name = tokens.word(), definition = symbols.actions.get(name) ?? tokens.fail(`Unknown state action ${name}.`);
    signature(tokens, definition.inputs, widths);
    tokens.checked(() => checkStateEffects(definition.steps, effects === "vector" ? ["memory", "alignment"] : effects === "alignment" ? ["alignment"] : effects, false));
    if (usesMemory(definition.steps)) memoryActions.add(name);
    return name;
  };
  const capture = required("capture"), stack = view(capture, 32), status = view(capture, 16), instruction = view(capture, 16); capture.end();
  const prepareAt = required("prepare"), prepare = action(prepareAt, [32, 8], "state"); prepareAt.end();
  const checkAt = required("stack-check"), checkStack = action(checkAt, [32], "alignment"); checkAt.end();
  const short = required("short-frame"), shortFrame = action(short, [32, 16, 32], "memory"); short.expect("bytes"); const shortBytes = number(short); short.end();
  const vectorAt = required("vector"), vector = action(vectorAt, [8], "vector"); vectorAt.end();
  const completeAt = required("complete"), complete = action(completeAt, [8, 8], "state"); completeAt.end();
  const returnAt = required("entry-return"), entryReturn = source(returnAt, [32, 8, 8], 32); returnAt.end();
  const frame = required("fault-frame"), memoryFrame = action(frame, [32, 16, 32, 32, 8, 8, 8], "memory"); frame.expect("bytes"); const memoryBytes = number(frame); frame.end();
  const vectors = required("fault-vectors"); vectors.expect("address"); const addressVector = number(vectors); vectors.expect("bus"); const busVector = number(vectors); vectors.end();
  const code = required("function-code"), functionCode = source(code, [8], 8); code.expect("values");
  const codes: number[] = []; do { codes.push(number(code)); } while (code.take(",")); code.end();
  if (new Set(codes).size !== codes.length) code.fail("Duplicate function code.");
  const begin = required("fault-begin"), beginFault = action(begin, [8], "state"); begin.end();
  const haltAt = required("halt"), halt = action(haltAt, [], "state"); haltAt.end();
  const initial = required("initial-fetch"); initial.expect("terminal"); const initialTerminal = source(initial, [], 8);
  initial.expect("return"); const initialReturn = source(initial, [], 32);
  initial.expect("processing"); const initialProcessing = source(initial, [], 8); initial.end();
  const levels = required("levels"), minimum = number(levels), maximum = number(levels); levels.end();
  if (minimum > maximum) levels.fail("Interrupt level range is reversed.");
  const gateAt = required("gate"), gate = source(gateAt, [8], 8); gateAt.expect("reasons");
  const reasons: string[] = []; do { reasons.push(gateAt.quoted()); } while (gateAt.take(",")); gateAt.end();
  if (reasons.some(reason => !reason.trim()) || new Set(reasons).size !== reasons.length || reasons.length > 255) gateAt.fail("Gate reasons must be distinct nonempty names with byte selectors.");
  const acceptAt = required("accept"), accept = action(acceptAt, [8], "state"); acceptAt.end();
  const acknowledge = required("acknowledge"); acknowledge.expect("autovector"); const autovector = source(acknowledge, [8], 8);
  acknowledge.expect("spurious"); const spurious = number(acknowledge);
  acknowledge.expect("maximum"); const vectorMaximum = number(acknowledge); acknowledge.end();
  const interrupt = required("interrupt-return"), interruptReturn = view(interrupt, 32);
  interrupt.expect("processing"); const interruptProcessing = number(interrupt, 1) === 1; interrupt.end();
  for (const [name, tokens] of fields) tokens.fail(`Unknown word event field ${name}.`);
  return { stack, status, instruction, prepare, checkStack, shortFrame, shortBytes, vector, complete, entryReturn,
    memoryFrame, memoryBytes, addressVector, busVector, functionCode, codes, beginFault, halt,
    initialTerminal, initialReturn, initialProcessing, minimum, maximum, gate, reasons, accept, autovector, spurious,
    vectorMaximum, interruptReturn, interruptProcessing, memoryActions: [...memoryActions] };
}

export function generateWordEvents(module: string, events: WordEvents, terminal: string): string {
  const q = JSON.stringify;
  const action = (name: string, args = "") => `actions[${q(name)}](state${args ? `, ${args}` : ""}${events.memoryActions.includes(name) ? ", memory" : ""})`;
  const source = (name: string, args = "") => `sources[${q(name)}](${args})`;
  const view = (name: string) => `views[${q(name)}]()`;
  return `// Generated from the chapter's word event contract. Do not edit.
import { wordEvents } from "../word-events.ts";
import type { WordBusFault } from "../word-events.ts";
import { instructions as actions, sourceReaders } from "./${module}-state.ts";
import { exceptions } from "./${module}-execution.ts";

export function createEvents(state: Parameters<typeof actions[${q(events.prepare)}]>[0], faultFromError: (error: unknown) => WordBusFault | undefined) {
  const { views, sources } = sourceReaders(state);
  return wordEvents({
    exceptions,
    capture: () => ({ stack: ${view(events.stack)}, status: ${view(events.status)} }),
    instruction: () => ${view(events.instruction)},
    prepare: (stack, bytes) => ${action(events.prepare, "stack, bytes")},
    checkStack: stack => ${action(events.checkStack, "stack")},
    shortBytes: ${events.shortBytes},
    shortFrame: (stack, status, returnPc, memory) => ${action(events.shortFrame, "stack, status, returnPc")},
    vector: (vector, memory) => ${action(events.vector, "vector")},
    complete: (processing, vector) => ${action(events.complete, "processing, vector")},
    entryReturn: (returnPc, vector, vectorPhase) => ${source(events.entryReturn, "returnPc, vector, vectorPhase")},
    memory: {
      addressVector: ${events.addressVector} as const, busVector: ${events.busVector} as const, bytes: ${events.memoryBytes},
      codes: ${q(events.codes)} as const,
      functionCode: program => ${source(events.functionCode, "program")},
      begin: vector => ${action(events.beginFault, "vector")},
      frame: (stack, status, returnPc, address, write, processing, code, memory) => ${action(events.memoryFrame, "stack, status, returnPc, address, write, processing, code")},
    },
    terminal: () => state[${q(terminal)}], halt: () => ${action(events.halt)},
    initial: { terminal: () => ${source(events.initialTerminal)}, returnPc: () => ${source(events.initialReturn)}, processing: () => ${source(events.initialProcessing)} },
    interrupt: {
      minimum: ${events.minimum}, maximum: ${events.maximum},
      gate: level => ${source(events.gate, "level")}, reasons: ${q(events.reasons)} as const,
      accept: level => ${action(events.accept, "level")},
      autovector: level => ${source(events.autovector, "level")}, spurious: ${events.spurious}, vectorMaximum: ${events.vectorMaximum},
      returnPc: () => ${view(events.interruptReturn)}, processing: ${events.interruptProcessing},
    },
  }, faultFromError);
}
`;
}
