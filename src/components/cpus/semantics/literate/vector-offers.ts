import type { Flag, InstructionDefinition, Latch } from "../model.ts";
import { chapterBody } from "./document.ts";
import type { ChapterTokens } from "./document.ts";
import { checkStateEffects, usesMemory } from "./statements.ts";

export interface ChapterVectorOffer {
  readonly source: string;
  readonly vector: number | "acknowledge";
  readonly gates: readonly { readonly value: Flag | Latch; readonly enabled: boolean; readonly reason: string }[];
  readonly accept: string;
  readonly enter: string;
  readonly memory: boolean;
}

/** Ordered recognition gates and chapter actions for fixed or externally supplied vectors. */
export function chapterVectorOffers(header: ChapterTokens, lines: readonly ChapterTokens[], symbols: {
  readonly flags: ReadonlyMap<string, Flag>;
  readonly latches: ReadonlyMap<string, Latch>;
  readonly actions: ReadonlyMap<string, InstructionDefinition>;
}): readonly ChapterVectorOffer[] {
  const entries: ChapterVectorOffer[] = [], names = new Set<string>();
  const action = (tokens: ChapterTokens, input: boolean) => {
    tokens.expect("action"); const name = tokens.word(), definition = symbols.actions.get(name) ?? tokens.fail(`Unknown entry action ${name}.`);
    const widths = Object.values(definition.inputs ?? {});
    if (input ? widths.length !== 1 || widths[0] !== 8 : widths.length !== 0) tokens.fail(input ? "Vector entry requires one byte input." : "Acceptance requires no inputs.");
    tokens.checked(() => checkStateEffects(definition.steps, input ? "memory" : "state", false)); tokens.end();
    return { name, memory: usesMemory(definition.steps) };
  };
  for (let index = 0; index < lines.length; index++) {
    const tokens = lines[index]!; tokens.expect("source"); const source = tokens.word();
    if (names.has(source)) tokens.fail(`Duplicate interrupt source ${source}.`);
    names.add(source);
    let vector: ChapterVectorOffer["vector"] = "acknowledge";
    if (!tokens.take("acknowledge")) {
      tokens.expect("vector"); vector = tokens.number();
      if (!Number.isInteger(vector) || vector < 0 || vector > 255) tokens.fail("Interrupt vector must be a byte.");
    }
    tokens.expect("{"); tokens.end();
    const { body, end } = chapterBody(lines, index); index = end;
    const gates: ChapterVectorOffer["gates"][number][] = [];
    let accept: string | undefined, enter: ReturnType<typeof action> | undefined;
    for (const field of body) {
      if (field.next === "when" || field.next === "unless") {
        if (accept !== undefined || enter !== undefined) field.fail("Recognition gates must precede acceptance and delivery.");
        const enabled = field.take("when"); if (!enabled) field.expect("unless");
        const kind = field.word();
        const value = kind === "flag" ? field.lookup(symbols.flags, true) : kind === "latch" ? field.lookup(symbols.latches)
          : field.fail("Recognition gates require a flag or latch.");
        field.expect("otherwise"); const reason = field.quoted(); field.end();
        if (!reason.trim()) field.fail("A declined offer needs a nonempty reason.");
        gates.push({ value, enabled, reason }); continue;
      }
      if (field.take("accept")) {
        if (accept !== undefined || enter !== undefined) field.fail("Acceptance must appear once, before delivery.");
        accept = action(field, false).name; continue;
      }
      field.expect("enter");
      if (accept === undefined || enter !== undefined) field.fail("Delivery must appear once, after acceptance.");
      enter = action(field, true);
    }
    if (accept === undefined || enter === undefined) return tokens.fail("Each vector offer needs acceptance and delivery.");
    entries.push({ source, vector, gates, accept, enter: enter.name, memory: enter.memory });
  }
  if (!entries.length) header.fail("Vector offers need at least one source.");
  return entries;
}

export function generateVectorOffers(entries: readonly ChapterVectorOffer[]): string {
  const q = JSON.stringify;
  return entries.map(entry => `    [${q(entry.source)}]: {
      decline: () => {
${entry.gates.map(({ value, enabled, reason }) => {
    const field = value.kind === "flag" ? `state${value.bank ? `[${q(value.bank)}]` : ""}.flags[${q(value.field)}]` : `state[${q(value.field)}]`;
    return `        if (${enabled ? "!" : ""}${field}) return ${q(reason)} as const;`;
  }).join("\n")}
        return undefined;
      },
      accept: () => actions[${q(entry.accept)}](state), vector: ${q(entry.vector)},
      enter: (vector, memory) => actions[${q(entry.enter)}](state, vector${entry.memory ? ", memory" : ""}),
    },`).join("\n");
}
