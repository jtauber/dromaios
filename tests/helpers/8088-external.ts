import assert from "node:assert/strict";
import { actions, families } from "../../src/components/cpus/semantics/generated/8088.js";
import { capture, concat, extend, literal, perform, value } from "../../src/components/cpus/semantics/model.js";
import type { InstructionDefinition } from "../../src/components/cpus/semantics/model.js";

// Isolate the chapter's post-resolution ESC effects for independent effect oracles.
// Public CPU tests retain opcode/ModR/M fetching and every addressing mode.
function escape(memory: boolean): InstructionDefinition {
  const definition = families.ESC[0]![1], dispatch = definition.steps[3];
  assert.ok(dispatch?.kind === "dispatch");
  const branch = dispatch.cases.find(branch => branch.value === (memory ? 0 : 0xc0))!;
  if (memory) assert.equal(branch.steps[0]?.kind, "read-source");
  return { ...definition, inputs: { selectedOpcode: 3, modRM: 8, ...(memory ? { segment: 16, offset: 16 } as const : {}) },
    steps: [capture("postbyte", value("modRM")), capture("highOpcode", extend(value("selectedOpcode"), 8)),
      definition.steps[2]!, ...(memory ? [capture("pointer", concat(value("segment"), value("offset"))), ...branch.steps.slice(1)] : branch.steps)] };
}
export const control8088 = {
  enterInterrupt: actions.enterInterrupt,
  resumeWait: { ...actions.pollWait, inputs: {}, steps: [perform(actions.pollWait, { resuming: literal(8, 1) })] },
  escapeRegister: escape(false), escapeMemory: escape(true),
};
