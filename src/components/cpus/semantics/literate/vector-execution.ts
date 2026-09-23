import type { Choice, Flag, InstructionDefinition, Latch } from "../model.ts";
import type { ChapterTokens } from "./document.ts";
import type { VectorExecution } from "./execution.ts";
import { checkStateEffects, usesMemory } from "./statements.ts";

interface EntryAction {
  readonly action: string;
  readonly arguments: readonly number[];
  readonly memory: boolean;
}
export interface VectorEntry extends EntryAction {
  readonly source: string;
  readonly gate?: { readonly kind: "mask" | "latch"; readonly field: string; readonly reason: string };
  readonly resume?: { readonly field: string; readonly value: string; readonly action: string };
}

/** Each source declares its entry action, acceptance gate, and optional masked wake-up. */
export function chapterVectorEntries(header: ChapterTokens, lines: readonly ChapterTokens[], symbols: {
  readonly actions: ReadonlyMap<string, InstructionDefinition>;
  readonly flags: ReadonlyMap<string, Flag>;
  readonly latches: ReadonlyMap<string, Latch>;
  readonly choices: ReadonlyMap<string, Choice>;
}): readonly VectorEntry[] {
  const names = new Set<string>();
  if (!lines.length) header.fail("Vector interrupts need at least one source.");
  const action = (tokens: ChapterTokens, effects: "memory" | "state"): EntryAction => {
    const name = tokens.word(), definition = symbols.actions.get(name) ?? tokens.fail(`Unknown entry action ${name}.`);
    tokens.checked(() => checkStateEffects(definition.steps, effects === "memory" ? "data-memory" : effects));
    const inputs = Object.values(definition.inputs ?? {});
    if (effects === "state" && inputs.length) tokens.fail("Resume actions must have no inputs.");
    tokens.expect("(");
    const args = inputs.map((bits, index) => {
      if (bits === "flag") return tokens.fail("Vector entry arguments must be numeric.");
      if (index) tokens.expect(","); const value = tokens.number();
      if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** bits) tokens.fail(`Entry argument must fit ${bits} bits.`);
      return value;
    });
    tokens.expect(")");
    return { action: name, arguments: args, memory: usesMemory(definition.steps) };
  };
  return lines.map(tokens => {
    tokens.expect("source"); const source = tokens.word();
    if (names.has(source)) tokens.fail(`Duplicate interrupt source ${source}.`);
    names.add(source);
    let gate: VectorEntry["gate"], resume: VectorEntry["resume"];
    if (tokens.take("unless")) {
      tokens.expect("flag"); const flag = tokens.lookup(symbols.flags, true);
      if (flag.bank !== undefined) tokens.fail("Vector masks require a top-level flag.");
      gate = { kind: "mask", field: flag.field, reason: "masked" };
    } else if (tokens.take("when")) {
      tokens.expect("latch"); const field = tokens.lookup(symbols.latches).field;
      tokens.expect("otherwise"); const reason = tokens.quoted();
      if (!reason.trim()) tokens.fail("A declined entry needs a nonempty reason.");
      gate = { kind: "latch", field, reason };
    } else tokens.expect("always");
    tokens.expect("with"); const entry = action(tokens, "memory");
    if (tokens.take("resume")) {
      if (gate?.kind !== "mask") tokens.fail("Resume requires a masked source.");
      tokens.expect("when"); tokens.expect("choice"); const choice = tokens.lookup(symbols.choices);
      tokens.expect("="); const value = tokens.quoted();
      if (!choice.values.includes(value)) tokens.fail(`Unknown choice value ${value}.`);
      tokens.expect("with"); const wake = action(tokens, "state");
      resume = { field: choice.field, value, action: wake.action };
    }
    tokens.end();
    return { source, ...entry, ...(gate === undefined ? {} : { gate }), ...(resume === undefined ? {} : { resume }) };
  });
}

/** Connect chapter actions and gates to the boundary runtime without embedding processor rules. */
export function generateVectorExecution(cpu: string, module: string, policy: VectorExecution): string {
  const q = JSON.stringify;
  const invoke = (name: string, args: readonly number[], memory: boolean) =>
    `actions[${q(name)}](state${args.map(value => `, ${value}`).join("")}${memory ? ", memory" : ""})`;
  const declines = policy.entries.flatMap(({ source, gate, resume }) => {
    if (gate === undefined) return [];
    const condition = gate.kind === "mask" ? `state.flags[${q(gate.field)}]` : `!state[${q(gate.field)}]`;
    const outcome = (value: string) => `{ source, outcome: ${q(value)}, reason: ${q(gate.reason)} } as const`;
    return `        case ${q(source)}:
          if (${condition}) {
${resume === undefined ? "" : `            if (state[${q(resume.field)}] === ${q(resume.value)}) {
              ${invoke(resume.action, [], false)};
              return ${outcome("resumed")};
            }
`}            return ${outcome("ignored")};
          }
          return undefined;`;
  }).join("\n");
  const waiting = policy.waiting;
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
${waiting === undefined ? "" : `    waiting: () => state[${q(waiting.field)}]${waiting.unless === undefined ? "" : ` !== ${q(waiting.unless)}`},\n`}    reset: memory => ${invoke(policy.reset, [], policy.resetMemory)},
    handlers: opcodeTable(opcodeEntries(state)),
    entries: {
${policy.entries.map(entry => `      ${q(entry.source)}: memory => ${invoke(entry.action, entry.arguments, entry.memory)},`).join("\n")}
    },
${declines ? `    decline: source => {
      switch (source) {
${declines}
      }
    },\n` : ""}  });
}
`;
}
