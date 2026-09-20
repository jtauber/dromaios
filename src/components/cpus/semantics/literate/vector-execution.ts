import type { Flag, InstructionDefinition } from "../model.ts";
import type { ChapterTokens } from "./document.ts";
import type { VectorExecution } from "./execution.ts";
import { checkStateEffects, usesMemory } from "./statements.ts";

export interface VectorEntry {
  readonly source: string;
  readonly action: string;
  readonly arguments: readonly number[];
  readonly memory: boolean;
  readonly mask?: string;
}

/** Each external source selects an explicit entry action and optional live flag mask. */
export function chapterVectorEntries(header: ChapterTokens, lines: readonly ChapterTokens[], symbols: {
  readonly actions: ReadonlyMap<string, InstructionDefinition>;
  readonly flags: ReadonlyMap<string, Flag>;
}): readonly VectorEntry[] {
  const names = new Set<string>();
  if (!lines.length) header.fail("Vector interrupts need at least one source.");
  return lines.map(tokens => {
    tokens.expect("source"); const source = tokens.word();
    if (names.has(source)) tokens.fail(`Duplicate interrupt source ${source}.`);
    names.add(source);
    let mask: string | undefined;
    if (tokens.take("unless")) { tokens.expect("flag"); mask = tokens.lookup(symbols.flags).field; }
    else tokens.expect("always");
    tokens.expect("with"); const action = tokens.word();
    const definition = symbols.actions.get(action) ?? tokens.fail(`Unknown entry action ${action}.`);
    tokens.checked(() => checkStateEffects(definition.steps, "memory"));
    tokens.expect("(");
    const args = Object.values(definition.inputs ?? {}).map((bits, index) => {
      if (index) tokens.expect(","); const value = tokens.number();
      if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** bits) tokens.fail(`Entry argument must fit ${bits} bits.`);
      return value;
    });
    tokens.expect(")"); tokens.end();
    return { source, action, arguments: args, memory: usesMemory(definition.steps), ...(mask === undefined ? {} : { mask }) };
  });
}

/** Connect named chapter actions to a memory-only boundary runtime, without embedding CPU rules. */
export function generateVectorExecution(cpu: string, module: string, policy: VectorExecution): string {
  const q = JSON.stringify;
  const invoke = (name: string, args: readonly number[], memory: boolean) =>
    `actions[${q(name)}](state${args.map(value => `, ${value}`).join("")}${memory ? ", memory" : ""})`;
  return `// Generated from the chapter's execution contract. Do not edit.
import { checkByteMemory } from "../byte-execution.ts";
import { vectorExecution } from "../vector-execution.ts";
import { programCounter } from "../execute-byte-instruction.ts";
import { opcodeTable } from "../opcodes.ts";
import type { Ram } from "../../memory/ram.ts";
import { opcodeEntries } from "./${module}.ts";
import { instructions as actions, sourceReaders } from "./${module}-state.ts";

export const checkMemory = (ram: Ram): void => checkByteMemory(${q(cpu)}, ram, ${policy.memoryBits});

export function createExecution<Snapshot>(state: Parameters<typeof opcodeEntries>[0], ram: Ram, snapshot: () => Snapshot) {
  const views = sourceReaders(state).views;
  return vectorExecution(${q(cpu)}, ram, snapshot, {
    counter: programCounter(views[${q(policy.counter)}], value => actions[${q(policy.writeCounter)}](state, value)),
    word: ${q(policy.word)}, opcodeAdvance: ${q(policy.opcodeAdvance)},
${policy.waiting === undefined ? "" : `    waiting: () => state[${q(policy.waiting)}],\n`}    reset: memory => ${invoke(policy.reset, [], policy.resetMemory)},
    handlers: opcodeTable(opcodeEntries(state)),
    entries: {
${policy.entries.map(entry => `      ${q(entry.source)}: memory => ${invoke(entry.action, entry.arguments, entry.memory)},`).join("\n")}
    },
    masks: {
${policy.entries.filter(entry => entry.mask !== undefined).map(entry => `      ${q(entry.source)}: () => state.flags[${q(entry.mask)}],`).join("\n")}
    },
  });
}
`;
}
