import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { families, sources } from "../../src/components/cpus/semantics/generated/8088.js";
import { stack8088 as nativeStack } from "../../src/components/cpus/semantics/definitions/8088.js";
import { generateInstructions } from "../../src/components/cpus/semantics/generate.js";
import { capture, concat, literal, value } from "../../src/components/cpus/semantics/model.js";
import type { InstructionDefinition } from "../../src/components/cpus/semantics/model.js";
import type { Cpu8088State } from "../../src/components/cpus/state/8088.js";

// These probes bypass fetch/address resolution so independent effect oracles can
// interrupt every arithmetic/stack effect. They retain the chapter's entire case
// after its pointer capture; public CPU tests cover that omitted decoding boundary.
const encoded = new Map(Object.values(families).flat());
function resolved(opcode: number, extension: number, target: number | "memory"): InstructionDefinition {
  const definition = encoded.get(opcode)!;
  const postbyte = (target === "memory" ? 0x06 : 0xc0 + target) + extension * 8;
  const dispatch = definition.steps[1];
  assert.equal(definition.steps[0]?.kind, "fetch-byte");
  assert.ok(dispatch?.kind === "dispatch");
  const branch = dispatch.cases.find(branch => (postbyte & branch.mask) === branch.value)!;
  const first = branch.steps[0];
  assert.ok(first?.kind === "read-source" && first.name === "pointer");
  assert.deepEqual(first.source, sources.resolvedRM);
  return { ...definition, inputs: target === "memory" ? { resolvedSegment: 16, resolvedOffset: 16 } : {},
    steps: [capture("postbyte", literal(8, postbyte)),
      capture("pointer", target === "memory" ? concat(value("resolvedSegment"), value("resolvedOffset")) : literal(32, 0)), ...branch.steps.slice(1)] };
}

export const unary8088: Record<string, InstructionDefinition> = {};
export const arithmetic8088: Record<string, InstructionDefinition> = {};
export const stack8088: Record<string, InstructionDefinition> = { ...nativeStack };
for (const width of [8, 16] as const) for (const target of [0, 1, 2, 3, 4, 5, 6, 7, "memory"] as const) {
  const word = Number(width === 16);
  for (const [index, name] of ["INC", "DEC", "NOT", "NEG"].entries()) {
    unary8088[`${name}_${width}_${target}`] = resolved((index < 2 ? 0xfe : 0xf6) + word, index, target);
  }
  for (const extension of [0, 1, 2, 3, 4, 5, 7]) for (const cl of [false, true]) {
    arithmetic8088[`shift_${extension}_${cl ? "cl" : "one"}_${width}_${target}`] = resolved(0xd0 + word + Number(cl) * 2, extension, target);
  }
  for (const [index, name] of ["MUL", "IMUL", "DIV", "IDIV"].entries()) {
    arithmetic8088[`${name}_${width}_${target}`] = resolved(0xf6 + word, index + 4, target);
  }
  if (width === 16) for (const [name, extension] of [["CALL", 2], ["JMP", 4]] as const) {
    stack8088[`${name}_${target}`] = resolved(0xff, extension, target);
  }
}
for (const [name, extension] of [["PUSH", 6], ["CALL_far", 3], ["JMP_far", 5]] as const) {
  stack8088[`${name}_memory`] = resolved(0xff, extension, "memory");
}

type Context = { fetchByte(): number; readByte(address: number): number; writeByte(address: number, byte: number): void };
type Outcome = "opcode" | "unsupported" | "divide-error" | void;
type Body = (state: Cpu8088State, context: Context) => Outcome;
type MemoryBody = (state: Cpu8088State, segment: number, offset: number, context: Context) => Outcome;
export async function compileResolved(definitions: Record<string, InstructionDefinition>): Promise<Record<string, Body | MemoryBody>> {
  const source = generateInstructions("8088", definitions);
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(new URL("../../src/components/cpus/alu.js", import.meta.url).href));
  const module = await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  return module.instructions;
}
