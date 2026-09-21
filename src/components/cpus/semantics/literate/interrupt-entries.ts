import type { Choice, InstructionDefinition, Latch } from "../model.ts";
import { chapterBody } from "./document.ts";
import type { ChapterTokens } from "./document.ts";
import { checkStateEffects, usesMemory } from "./statements.ts";

interface EntryAction { readonly action: string; readonly memory: boolean }
export interface InterruptEntry {
  readonly source: string;
  readonly gates: readonly { readonly field: string; readonly enabled: boolean; readonly reason: string }[];
  readonly accept: string;
  readonly delivery: { readonly kind: "direct"; readonly enter: EntryAction }
    | { readonly kind: "acknowledged"; readonly choice: string; readonly cases: readonly {
      readonly value: string | number; readonly enter?: EntryAction;
    }[] };
}

/** Bind explicit gate order, acceptance effects, and exhaustive mode selection to chapter actions. */
export function chapterInterruptEntries(header: ChapterTokens, lines: readonly ChapterTokens[], symbols: {
  readonly actions: ReadonlyMap<string, InstructionDefinition>;
  readonly choices: ReadonlyMap<string, Choice>;
  readonly latches: ReadonlyMap<string, Latch>;
}): readonly InterruptEntry[] {
  const entries: InterruptEntry[] = [], names = new Set<string>();
  const action = (tokens: ChapterTokens, input: boolean, memory: boolean): EntryAction => {
    tokens.expect("action"); const name = tokens.word(), definition = symbols.actions.get(name) ?? tokens.fail(`Unknown entry action ${name}.`);
    const widths = Object.values(definition.inputs ?? {});
    if (input ? widths.length !== 1 || widths[0] !== 8 : widths.length !== 0) {
      tokens.fail(input ? "Acknowledged entry actions require one 8-bit input." : "Entry actions require no inputs.");
    }
    tokens.checked(() => checkStateEffects(definition.steps, memory ? "memory" : "state")); tokens.end();
    return { action: name, memory: usesMemory(definition.steps) };
  };
  for (let index = 0; index < lines.length; index++) {
    const tokens = lines[index]!; tokens.expect("source"); const source = tokens.word();
    if (names.has(source)) tokens.fail(`Duplicate interrupt source ${source}.`);
    names.add(source);
    const acknowledge = tokens.take("acknowledge"); tokens.expect("{"); tokens.end();
    const { body, end } = chapterBody(lines, index); index = end;
    const gates: InterruptEntry["gates"][number][] = [];
    let accept: string | undefined, delivery: InterruptEntry["delivery"] | undefined;
    for (let slot = 0; slot < body.length; slot++) {
      const field = body[slot]!;
      if (field.next === "when" || field.next === "unless") {
        if (accept !== undefined || delivery !== undefined) field.fail("Recognition gates must precede acceptance and delivery.");
        const enabled = field.take("when"); if (!enabled) field.expect("unless");
        field.expect("latch"); const latch = field.lookup(symbols.latches);
        field.expect("otherwise"); const reason = field.quoted(); field.end();
        if (!reason.trim()) field.fail("A declined entry needs a nonempty reason.");
        gates.push({ field: latch.field, enabled, reason }); continue;
      }
      if (field.take("accept")) {
        if (accept !== undefined || delivery !== undefined) field.fail("Acceptance must appear once, before delivery.");
        accept = action(field, false, false).action; continue;
      }
      if (accept === undefined) field.fail("An entry needs acceptance before delivery.");
      if (delivery !== undefined) field.fail("An entry has only one delivery policy.");
      if (field.take("enter")) {
        if (acknowledge) field.fail("Acknowledged entry requires exhaustive mode selection.");
        delivery = { kind: "direct", enter: action(field, false, true) }; continue;
      }
      field.expect("select");
      if (!acknowledge) field.fail("Mode selection requires acknowledgement.");
      const selected = field.lookup(symbols.choices); field.expect("{"); field.end();
      const modes = chapterBody(body, slot); slot = modes.end;
      const cases: Extract<InterruptEntry["delivery"], { kind: "acknowledged" }>["cases"][number][] = [], seen = new Set<string | number>();
      for (const mode of modes.body) {
        mode.expect("case"); const value = mode.choiceValue();
        if (!selected.values.includes(value)) mode.fail(`Unknown interrupt mode ${JSON.stringify(value)}.`);
        if (seen.has(value)) mode.fail(`Duplicate interrupt mode ${JSON.stringify(value)}.`);
        seen.add(value);
        if (mode.take("supplied")) { mode.end(); cases.push({ value }); }
        else cases.push({ value, enter: action(mode, true, true) });
      }
      if (seen.size !== selected.values.length) field.fail("Interrupt mode selection must cover every declared choice.");
      delivery = { kind: "acknowledged", choice: selected.field, cases };
    }
    if (accept === undefined || delivery === undefined) return tokens.fail("Each interrupt source needs acceptance and delivery.");
    entries.push({ source, gates, accept, delivery });
  }
  if (!entries.length) header.fail("Interrupt entries need at least one source.");
  return entries;
}

/** Each generated entry supplies policy only; recording, acknowledgement, and execution live in the runtime. */
export function generateInterruptEntries(entries: readonly InterruptEntry[]): string {
  const q = JSON.stringify;
  const invoke = (entry: EntryAction, byte = false) => `actions[${q(entry.action)}](state${byte ? ", byte" : ""}${entry.memory ? ", memory" : ""})`;
  return entries.map(entry => {
    const delivery = entry.delivery;
    const gates = entry.gates.map(gate => `        if (${gate.enabled ? "!" : ""}state[${q(gate.field)}]) return ${q(gate.reason)} as const;`).join("\n");
    const dispatch = delivery.kind === "direct" ? `      acknowledge: false, enter: memory => ${invoke(delivery.enter)},`
      : `      acknowledge: true, select: byte => {
        switch (state[${q(delivery.choice)}]) {
${delivery.cases.map(mode => `          case ${q(mode.value)}: return ${mode.enter ? `{ kind: "entry", enter: memory => ${invoke(mode.enter, true)} }` : '{ kind: "supplied" }'};`).join("\n")}
        }
      },`;
    return `    ${q(entry.source)}: {
${gates ? `      decline: () => {\n${gates}\n        return undefined;\n      },\n` : ""}      accept: () => actions[${q(entry.accept)}](state),
${dispatch}
    },`;
  }).join("\n");
}
