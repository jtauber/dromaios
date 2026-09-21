import type { Choice, Flag, InstructionDefinition, Latch, Statement, ValueSource } from "../model.ts";
import { checkStateEffects, usesMemory } from "./statements.ts";
import { chapterVectorEntries, generateVectorExecution } from "./vector-execution.ts";
import type { VectorEntry } from "./vector-execution.ts";
import { chapterBody } from "./document.ts";
import type { ChapterTokens } from "./document.ts";

/** The currently supported execution contract: a flat byte bus and one-byte opcode dispatch. */
export interface ExecutionBase {
  readonly memoryBits: number;
  readonly counter: string;
  readonly writeCounter: string;
  readonly word: "little" | "big";
  readonly opcodeAdvance: "dispatch" | "read";
  readonly reset: string;
  readonly resetMemory: boolean;
  readonly retire?: string;
  readonly retireDeferral?: string;
}
export interface SuppliedExecution extends ExecutionBase {
  readonly interrupt: "supplied";
  readonly stopped: string;
  readonly acceptInterrupt: string;
  readonly interruptEnable?: string;
  readonly interruptDefer?: string;
  readonly callbackValidation: "offer" | "read";
  readonly interruptCounter: "preserve" | "advance";
}

export interface VectorExecution extends ExecutionBase {
  readonly interrupt: "vectors";
  readonly waiting?: { readonly field: string; readonly unless?: string };
  readonly entries: readonly VectorEntry[];
}
export type ChapterExecution = SuppliedExecution | VectorExecution;

/** Reject native decoder/fault effects that cannot run in the byte dispatch context. */
export function checkByteExecution(steps: readonly Statement[], deferral = false, memoryOnly = false): void {
  for (const step of steps) switch (step.kind) {
    case "capture": case "read-register": case "read-element": case "read-flag": case "read-latch": case "test-choice":
    case "write-register": case "write-element": case "fill-array": case "write-latch": case "write-choice": case "update-flags": case "replace-flags":
    case "fetch-byte": case "fetch-word": case "read-memory": case "write-memory": break;
    case "read-port": case "write-port":
      if (memoryOnly) throw new Error("Vector execution currently supports memory-only instructions.");
      break;
    case "defer-interrupt":
      if (!deferral || step.scope !== "irq") throw new Error("IRQ deferral needs a declared retirement destination.");
      break;
    case "when": checkByteExecution(step.steps, deferral, memoryOnly); break;
    case "dispatch": case "match": for (const branch of step.cases) checkByteExecution(branch.steps, deferral, memoryOnly); break;
    case "read-source": checkByteExecution(step.source.steps, deferral, memoryOnly); break;
    case "perform": checkByteExecution(step.action.steps, deferral, memoryOnly); break;
    default: throw new Error(`Byte execution does not support ${step.kind}.`);
  }
}

/** Resolve chapter references and reject policies that the shared runtime cannot faithfully execute. */
export function chapterExecution(header: ChapterTokens, lines: readonly ChapterTokens[], symbols: {
  readonly views: ReadonlyMap<string, ValueSource>;
  readonly actions: ReadonlyMap<string, InstructionDefinition>;
  readonly latches: ReadonlyMap<string, Latch>;
  readonly flags: ReadonlyMap<string, Flag>;
  readonly choices: ReadonlyMap<string, Choice<string>>;
}): ChapterExecution {
  const fields = new Map<string, ChapterTokens>();
  let vectorLines: readonly ChapterTokens[] | undefined;
  for (let index = 0; index < lines.length; index++) {
    const tokens = lines[index]!, kind = tokens.word();
    if (fields.has(kind)) tokens.fail(`Duplicate execution field ${kind}.`);
    fields.set(kind, tokens);
    if (kind === "interrupt") {
      const vectors = tokens.take("vectors"); tokens.expect("{"); tokens.end();
      const { body, end } = chapterBody(lines, index); index = end;
      if (vectors) { vectorLines = body; continue; }
      for (const entry of body) {
        const field = `interrupt.${entry.word()}`;
        if (fields.has(field)) entry.fail(`Duplicate execution field ${field}.`);
        fields.set(field, entry);
      }
    }
  }
  const required = (name: string): ChapterTokens => {
    const tokens = fields.get(name) ?? header.fail(`Execution needs ${name}.`);
    fields.delete(name); return tokens;
  };
  const choice = <T extends string>(tokens: ChapterTokens, choices: readonly T[]): T => {
    const text = tokens.word();
    return choices.find(value => value === text) ?? tokens.fail(`Expected ${choices.join(" or ")}.`);
  };
  const action = (tokens: ChapterTokens, input?: number, memory = false): string => {
    const name = tokens.word(), definition = symbols.actions.get(name) ?? tokens.fail(`Unknown state action ${name}.`);
    const widths = Object.values(definition.inputs ?? {});
    if (input === undefined ? widths.length !== 0 : widths.length !== 1 || widths[0] !== input) {
      tokens.fail(input === undefined ? "Execution actions must have no inputs." : `Counter writes require one ${input}-bit input.`);
    }
    tokens.checked(() => checkStateEffects(definition.steps, memory ? "memory" : "state"));
    return name;
  };
  const memory = required("memory"), memoryBits = memory.number(); memory.end();
  if (!Number.isInteger(memoryBits) || memoryBits < 1 || memoryBits > 16) memory.fail("Flat byte execution needs a memory width from 1 to 16 bits.");
  const pc = required("counter"), counter = pc.word();
  const view = symbols.views.get(counter) ?? pc.fail(`Unknown state view ${counter}.`);
  if (view.width > memoryBits) pc.fail("The counter view must fit the memory address width.");
  pc.expect("write"); const writeCounter = action(pc, 16); pc.end();
  const stop = required("stopped");
  let stopped: string | undefined, stoppedUnless: string | undefined;
  if (stop.take("choice")) {
    const selected = stop.lookup(symbols.choices); stopped = selected.field;
    stop.expect("unless"); stoppedUnless = stop.quoted();
    if (!selected.values.includes(stoppedUnless)) stop.fail(`Unknown choice value ${stoppedUnless}.`);
  } else stopped = stop.take("none") ? undefined : stop.lookup(symbols.latches).field;
  const waiting = stop.take("as");
  if (waiting) {
    stop.expect("waiting");
    if (stopped === undefined) stop.fail("A waiting outcome requires a stopped latch or choice.");
  }
  stop.end();
  const order = required("word"), word = choice(order, ["little", "big"]); order.end();
  const opcode = required("opcode"); opcode.expect("advance"); opcode.expect("on");
  const opcodeAdvance = choice(opcode, ["dispatch", "read"]); opcode.end();
  const operand = required("operand"); operand.expect("advance"); operand.expect("after"); operand.expect("read"); operand.end();
  const failure = required("failure"); failure.expect("retain"); failure.end();
  const resetAt = required("reset"); resetAt.expect("action"); const reset = action(resetAt, undefined, vectorLines !== undefined); resetAt.end();
  const resetMemory = usesMemory(symbols.actions.get(reset)!.steps);
  const retireAt = required("retire");
  let retire: string | undefined, retireDeferral: string | undefined;
  if (retireAt.take("irq")) {
    retireAt.expect("into"); retireDeferral = retireAt.lookup(symbols.latches).field;
  } else if (!retireAt.take("none")) { retireAt.expect("action"); retire = action(retireAt); }
  retireAt.end();
  required("interrupt");
  const common = { memoryBits, counter, writeCounter, word, opcodeAdvance, reset, resetMemory,
    ...(retire === undefined ? {} : { retire }), ...(retireDeferral === undefined ? {} : { retireDeferral }) };
  if (vectorLines !== undefined) {
    if (stopped !== undefined && !waiting) stop.fail("Vector execution requires stopped none or a latch or choice declared as waiting.");
    if (retire !== undefined || retireDeferral !== undefined) retireAt.fail("Vector execution currently requires retire none.");
    const entries = chapterVectorEntries(header, vectorLines, symbols);
    for (const [name, tokens] of fields) tokens.fail(`Unknown execution field ${name}.`);
    const waitingPolicy = waiting && stopped !== undefined
      ? { field: stopped, ...(stoppedUnless === undefined ? {} : { unless: stoppedUnless }) } : undefined;
    return { ...common, interrupt: "vectors", entries, ...(waitingPolicy === undefined ? {} : { waiting: waitingPolicy }) };
  }
  if (waiting || stoppedUnless !== undefined) stop.fail("A waiting outcome requires vector interrupts.");
  const stoppedLatch = stopped ?? stop.fail("Supplied-instruction execution requires a stopped latch or choice.");
  const accept = required("interrupt.accept");
  let interruptEnable: string | undefined, interruptDefer: string | undefined;
  if (accept.take("when")) {
    interruptEnable = accept.lookup(symbols.latches).field;
    if (accept.take("unless")) interruptDefer = accept.lookup(symbols.latches).field;
  } else accept.expect("always");
  accept.expect("with");
  const acceptInterrupt = action(accept); accept.end();
  const bytes = required("interrupt.bytes"); bytes.expect("acknowledge"); bytes.end();
  let callbackValidation: "offer" | "read" = "offer";
  if (fields.has("interrupt.callback")) {
    const callback = required("interrupt.callback"); callback.expect("validate"); callback.expect("on");
    callbackValidation = choice(callback, ["offer", "read"]); callback.end();
  }
  const advance = required("interrupt.counter"), interruptCounter = choice(advance, ["preserve", "advance"]); advance.end();
  const unknown = required("interrupt.unknown"); unknown.expect("retain"); unknown.end();
  for (const [name, tokens] of fields) tokens.fail(`Unknown execution field ${name}.`);
  return { ...common, interrupt: "supplied", stopped: stoppedLatch,
    ...(interruptEnable === undefined ? {} : { interruptEnable }), ...(interruptDefer === undefined ? {} : { interruptDefer }),
    acceptInterrupt, interruptCounter, callbackValidation };
}

/** Bind validated references to generated functions; no processor-specific execution algorithm is emitted. */
export function generateChapterExecution(cpu: string, module: string, policy: ChapterExecution): string {
  if (policy.interrupt === "vectors") return generateVectorExecution(cpu, module, policy);
  const quoted = JSON.stringify, action = (name: string) => `actions[${quoted(name)}](state)`;
  let retirement = "() => {}";
  if (policy.retire !== undefined) retirement = `() => ${action(policy.retire)}`;
  if (policy.retireDeferral !== undefined) retirement = `deferred => { state[${quoted(policy.retireDeferral)}] = deferred; }`;
  const rejection = policy.interruptEnable === undefined ? "" :
    `    rejectInterrupt: () => !state[${quoted(policy.interruptEnable)}] ? "disabled"${policy.interruptDefer === undefined ? "" : ` : state[${quoted(policy.interruptDefer)}] ? "deferred"`} : undefined,\n`;
  return `// Generated from the chapter's execution contract. Do not edit.
import { byteExecution, checkByteMemory } from "../byte-execution.ts";
import { programCounter } from "../execute-byte-instruction.ts";
import { opcodeTable } from "../opcodes.ts";
import type { Ram } from "../../memory/ram.ts";
import type { BytePorts } from "../port-access.ts";
import { opcodeEntries } from "./${module}.ts";
import { instructions as actions, sourceReaders } from "./${module}-state.ts";

export const checkMemory = (ram: Ram): void => checkByteMemory(${quoted(cpu)}, ram, ${policy.memoryBits});

export function createExecution<Snapshot>(state: Parameters<typeof opcodeEntries>[0], ram: Ram,
  snapshot: () => Snapshot, ports?: BytePorts) {
  const views = sourceReaders(state).views;
  return byteExecution(${quoted(cpu)}, ram, ports, snapshot, {
    counter: programCounter(views[${quoted(policy.counter)}], value => actions[${quoted(policy.writeCounter)}](state, value)),
    stopped: () => state[${quoted(policy.stopped)}],
    reset: () => ${action(policy.reset)},
    retire: ${retirement},
    acceptInterrupt: () => ${action(policy.acceptInterrupt)},
${rejection}    callbackValidation: ${quoted(policy.callbackValidation)},
    word: ${quoted(policy.word)}, opcodeAdvance: ${quoted(policy.opcodeAdvance)}, interruptCounter: ${quoted(policy.interruptCounter)},
    handlers: opcodeTable(opcodeEntries(state)),
  });
}
`;
}
