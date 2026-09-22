import { stripTypeScriptTypes } from "node:module";
import { actions, sources } from "../../src/components/cpus/semantics/generated/8088.js";
import { cpu8088StateDescription } from "../../src/components/cpus/state/8088.js";
import type { Cpu8088State } from "../../src/components/cpus/state/8088.js";
import { generateInstructions } from "../../src/components/cpus/semantics/generate.js";
import { capture, perform, readSource, signExtend, value } from "../../src/components/cpus/semantics/model.js";
import type { InstructionDefinition } from "../../src/components/cpus/semantics/model.js";
import type { AluName } from "../components/cpus/8088/helpers.js";

// Numeric probes exercise chapter composition after address resolution. The public-CPU
// tests independently check ModR/M decoding, prefixes, and rejection before fetching.
const cpu = { name: "8088", state: cpu8088StateDescription };
const definitions: Record<string, InstructionDefinition> = {};
const operations = ["ADD", "OR", "ADC", "SBB", "AND", "SUB", "XOR", "CMP", "TEST"] as const;
for (const width of [8, 16] as const) {
  definitions[`fetchAndStore${width}`] = { cpu, name: "fetch and store", explanation: "Chapter immediate source then memory action.",
    inputs: { pointer: 32 }, steps: [readSource("contents", sources[width === 8 ? "immediateByte" : "immediateWord"]),
      perform(actions[`store${width}`], { pointer: value("pointer"), contents: value("contents") })] };
  for (const [index, operation] of operations.entries()) for (const form of ["operand", "immediate", "signed"] as const) {
    if (form === "signed" && (width !== 16 || !["ADD", "ADC", "SBB", "SUB", "CMP"].includes(operation))) continue;
    const actionName = ["add", "or", "adc", "sbb", "and", "sub", "xor", "cmp", "test"][index]!;
    const sourceName = form === "operand" ? `readRM${width}` as const : width === 8 || form === "signed" ? "immediateByte" : "immediateWord";
    definitions[`${operation}_${width}_${form}`] = { cpu, name: operation, explanation: "Capture the chapter source, then perform its ALU action.",
      inputs: { destination: 8, source: 8, pointer: 32 }, steps: [
        readSource("captured", sources[sourceName],
          form === "operand" ? { postbyte: value("source"), pointer: value("pointer") } : undefined),
        capture("right", form === "signed" ? signExtend(value("captured"), 16) : value("captured")),
        perform(actions[`${actionName}RM${width}` as keyof typeof actions], { destination: value("destination"), pointer: value("pointer"), right: value("right") }),
      ] };
  }
}
const source = generateInstructions("8088", definitions);
const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(new URL("../../src/components/cpus/alu.js", import.meta.url).href));
export type OperandContext = { fetchByte(): number; readByte(address: number): number; writeByte(address: number, byte: number): void };
const compiled: { instructions: Record<`${AluName}_${8 | 16}_${"operand" | "immediate" | "signed"}`,
  (state: Cpu8088State, destination: number, source: number, pointer: number, context: OperandContext) => "unsupported" | void>
  & Record<`fetchAndStore${8 | 16}`, (state: Cpu8088State, pointer: number, context: OperandContext) => void> } =
  await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
export const probes = compiled.instructions;
