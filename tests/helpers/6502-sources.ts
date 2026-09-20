import { stripTypeScriptTypes } from "node:module";
import { sources, operands } from "../../src/components/cpus/semantics/generated/6502.js";
import { state } from "../../src/components/cpus/semantics/generated/state/6502.js";
import type { Cpu6502State } from "../../src/components/cpus/semantics/generated/state/6502.js";
import { generateInstructions } from "../../src/components/cpus/semantics/generate.js";

// Standalone addressing probes exercise generation; production inlines these chapter sources.
const addresses = ["zeroPage", "zeroPageX", "zeroPageY", "absolute", "absoluteX", "absoluteY", "indexedIndirect", "indirectIndexed"] as const;
export const sources6502 = { cpu: { name: "6502", state }, groups: {
  addresses: Object.fromEntries(addresses.map(name => [name, sources[name]])),
  operands: Object.fromEntries(operands.accumulator.map((operand, code) => [code, operand.read])),
} };
type Fetch = { fetchByte(): number };
type Reader = (context: Fetch & { readByte(address: number): number }) => number;
type DirectReader = (context: Fetch) => number;
const source = generateInstructions("6502", {}, { sources: sources6502 });
const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(new URL("../../src/components/cpus/alu.js", import.meta.url).href));
const compiled: { sourceReaders(state: Cpu6502State): {
  addresses: Record<Exclude<typeof addresses[number], "indexedIndirect" | "indirectIndexed">, DirectReader>
    & Record<"indexedIndirect" | "indirectIndexed", Reader>;
  operands: Record<0 | 1 | 3 | 4 | 5 | 6 | 7, Reader> & { 2: DirectReader };
} } =
  await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
export const sourceReaders = compiled.sourceReaders;
