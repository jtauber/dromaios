import type { InstructionDefinition } from "../model.ts";
import { checkStateEffects, usesMemory } from "./statements.ts";
import type { ChapterTokens } from "./document.ts";

/** A reset sequence can complete after either a returned fault or an explicit bus failure. */
export interface ChapterReset {
  readonly attempt: string;
  readonly complete: string;
  readonly memory: boolean;
}

export function chapterReset(header: ChapterTokens, lines: readonly ChapterTokens[], actions: ReadonlyMap<string, InstructionDefinition>): ChapterReset {
  const fields = new Map<string, { name: string; definition: InstructionDefinition }>();
  for (const tokens of lines) {
    const field = tokens.word();
    if (field !== "attempt" && field !== "complete") tokens.fail("Expected attempt or complete reset field.");
    if (fields.has(field)) tokens.fail(`Duplicate reset field ${field}.`);
    tokens.expect("action");
    const name = tokens.word(), definition = actions.get(name) ?? tokens.fail(`Unknown state action ${name}.`);
    const inputs = Object.values(definition.inputs ?? {});
    if (field === "attempt") {
      if (inputs.length) tokens.fail("Reset attempt actions must have no inputs.");
      tokens.checked(() => checkStateEffects(definition.steps, ["memory", "alignment"], false));
    } else {
      tokens.expect("with"); tokens.expect("failure");
      if (inputs.length !== 1 || inputs[0] !== 8) tokens.fail("Reset completion actions require one 8-bit failure input.");
      tokens.checked(() => checkStateEffects(definition.steps, "state", false));
    }
    tokens.end(); fields.set(field, { name, definition });
  }
  const attempt = fields.get("attempt") ?? header.fail("Reset needs attempt."),
    complete = fields.get("complete") ?? header.fail("Reset needs complete.");
  return { attempt: attempt.name, complete: complete.name, memory: usesMemory(attempt.definition.steps) };
}

/** Bind chapter actions to the shared sequence without emitting processor-specific decisions. */
export function generateChapterReset(module: string, reset: ChapterReset): string {
  const attempt = `actions[${JSON.stringify(reset.attempt)}]`, complete = `actions[${JSON.stringify(reset.complete)}]`;
  return `// Generated from the chapter's reset contract. Do not edit.
import { resetSequence } from "../reset-sequence.ts";
import { instructions as actions } from "./${module}-state.ts";

export function reset<Fault>(state: Parameters<typeof ${attempt}>[0],
  ${reset.memory ? `memory: Parameters<typeof ${attempt}>[1],\n  ` : ""}faultFromError: (error: unknown) => Fault | undefined) {
  return resetSequence(() => ${attempt}(state${reset.memory ? ", memory" : ""}),
    failed => ${complete}(state, failed ? 1 : 0), faultFromError);
}
`;
}
