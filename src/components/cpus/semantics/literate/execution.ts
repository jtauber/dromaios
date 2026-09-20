import type { InstructionDefinition, Latch, Statement, ValueSource } from "../model.ts";
import { chapterBody } from "./document.ts";
import type { ChapterTokens } from "./document.ts";

/** The currently supported execution contract: a flat byte bus and one-byte opcode dispatch. */
export interface ChapterExecution {
  readonly memoryBits: number;
  readonly counter: string;
  readonly writeCounter: string;
  readonly stopped: string;
  readonly word: "little" | "big";
  readonly opcodeAdvance: "dispatch" | "read";
  readonly reset: string;
  readonly retire?: string;
  readonly acceptInterrupt: string;
  readonly interruptCounter: "preserve" | "advance";
}

/** Reject native decoder/fault effects that cannot run in the byte dispatch context. */
export function checkByteExecution(steps: readonly Statement[]): void {
  for (const step of steps) switch (step.kind) {
    case "capture": case "read-register": case "read-element": case "read-flag": case "read-latch":
    case "write-register": case "write-element": case "fill-array": case "write-latch": case "update-flags":
    case "fetch-byte": case "fetch-word": case "read-memory": case "write-memory": case "read-port": case "write-port": break;
    case "when": checkByteExecution(step.steps); break;
    case "read-source": checkByteExecution(step.source.steps); break;
    default: throw new Error(`Byte execution does not support ${step.kind}.`);
  }
}

/** Resolve chapter references and reject policies that the shared runtime cannot faithfully execute. */
export function chapterExecution(header: ChapterTokens, lines: readonly ChapterTokens[], symbols: {
  readonly views: ReadonlyMap<string, ValueSource>;
  readonly actions: ReadonlyMap<string, InstructionDefinition>;
  readonly latches: ReadonlyMap<string, Latch>;
}): ChapterExecution {
  const fields = new Map<string, ChapterTokens>();
  for (let index = 0; index < lines.length; index++) {
    const tokens = lines[index]!, kind = tokens.word();
    if (fields.has(kind)) tokens.fail(`Duplicate execution field ${kind}.`);
    fields.set(kind, tokens);
    if (kind === "interrupt") {
      tokens.expect("{"); tokens.end();
      const { body, end } = chapterBody(lines, index); index = end;
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
  const action = (tokens: ChapterTokens, input?: number): string => {
    const name = tokens.word(), definition = symbols.actions.get(name) ?? tokens.fail(`Unknown state action ${name}.`);
    const widths = Object.values(definition.inputs ?? {});
    if (input === undefined ? widths.length !== 0 : widths.length !== 1 || widths[0] !== input) {
      tokens.fail(input === undefined ? "Execution actions must have no inputs." : `Counter writes require one ${input}-bit input.`);
    }
    return name;
  };
  const memory = required("memory"), memoryBits = memory.number(); memory.end();
  if (!Number.isInteger(memoryBits) || memoryBits < 1 || memoryBits > 16) memory.fail("Flat byte execution needs a memory width from 1 to 16 bits.");
  const pc = required("counter"), counter = pc.word();
  const view = symbols.views.get(counter) ?? pc.fail(`Unknown state view ${counter}.`);
  if (view.width > memoryBits) pc.fail("The counter view must fit the memory address width.");
  pc.expect("write"); const writeCounter = action(pc, 16); pc.end();
  const stop = required("stopped"), stopped = stop.lookup(symbols.latches).field; stop.end();
  const order = required("word"), word = choice(order, ["little", "big"]); order.end();
  const opcode = required("opcode"); opcode.expect("advance"); opcode.expect("on");
  const opcodeAdvance = choice(opcode, ["dispatch", "read"]); opcode.end();
  const operand = required("operand"); operand.expect("advance"); operand.expect("after"); operand.expect("read"); operand.end();
  const failure = required("failure"); failure.expect("retain"); failure.end();
  const resetAt = required("reset"); resetAt.expect("action"); const reset = action(resetAt); resetAt.end();
  const retireAt = required("retire");
  let retire: string | undefined;
  if (!retireAt.take("none")) { retireAt.expect("action"); retire = action(retireAt); }
  retireAt.end();
  required("interrupt");
  const accept = required("interrupt.accept"); accept.expect("always"); accept.expect("with");
  const acceptInterrupt = action(accept); accept.end();
  const bytes = required("interrupt.bytes"); bytes.expect("acknowledge"); bytes.end();
  const advance = required("interrupt.counter"), interruptCounter = choice(advance, ["preserve", "advance"]); advance.end();
  const unknown = required("interrupt.unknown"); unknown.expect("retain"); unknown.end();
  for (const [name, tokens] of fields) tokens.fail(`Unknown execution field ${name}.`);
  return { memoryBits, counter, writeCounter, stopped, word, opcodeAdvance, reset,
    ...(retire === undefined ? {} : { retire }), acceptInterrupt, interruptCounter };
}

/** Bind validated references to generated functions; no processor-specific execution algorithm is emitted. */
export function generateChapterExecution(cpu: string, module: string, policy: ChapterExecution): string {
  const quoted = JSON.stringify, action = (name: string) => `actions[${quoted(name)}](state)`;
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
    retire: () => {${policy.retire === undefined ? "" : ` ${action(policy.retire)}; `}},
    acceptInterrupt: () => ${action(policy.acceptInterrupt)},
    word: ${quoted(policy.word)}, opcodeAdvance: ${quoted(policy.opcodeAdvance)}, interruptCounter: ${quoted(policy.interruptCounter)},
    handlers: opcodeTable(opcodeEntries(state)),
  });
}
`;
}
