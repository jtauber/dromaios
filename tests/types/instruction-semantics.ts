import { cpu6502StateDescription } from "../../src/components/cpus/6502.js";
import { cpu8080StateDescription } from "../../src/components/cpus/8080.js";
import { cpuSymbols, literal, not, value, zero } from "../../src/components/cpus/semantics/model.js";
import type { FlagPolicy, NumberExpression, Statement } from "../../src/components/cpus/semantics/model.js";
import { instructions as generated6502 } from "../../src/components/cpus/generated/6502.js";
import { instructions as generated8080 } from "../../src/components/cpus/generated/8080.js";
import type { Cpu6502State } from "../../src/components/cpus/6502.js";
import type { Cpu8080State } from "../../src/components/cpus/8080.js";

// Compiled, never called: names come from CPU schemas; reads, expressions, and writes have distinct roles.
export function checkInstructionSemantics(): void {
  const mos = cpuSymbols("6502", cpu6502StateDescription), intel = cpuSymbols("8080", cpu8080StateDescription);
  mos.register("a");
  intel.flag("cy");
  // @ts-expect-error The 6502 has no B register.
  mos.register("b");
  // @ts-expect-error Flags are not unsigned registers.
  mos.register("flags");
  // @ts-expect-error The 8080's spelling is CY.
  intel.flag("c");
  // @ts-expect-error A Boolean test is not a numeric expression.
  const numeric: NumberExpression = zero(literal(8, 0));
  // @ts-expect-error Register descriptions are not captured values.
  not(mos.register("a"));
  // @ts-expect-error Numeric expressions are not Boolean expressions.
  not(value("byte"));
  // @ts-expect-error This vocabulary covers 8- and 16-bit values.
  literal(32, 0);
  // @ts-expect-error Immediate values cannot be register destinations.
  const destination: Statement = { kind: "write-register", register: literal(8, 0), value: value("byte") };
  // @ts-expect-error Sources are structured bodies, not effectful callbacks.
  const opaque: Statement = { kind: "read-source", name: "byte", source: () => 0 };
  const policy: FlagPolicy = { name: "zero", parameters: { byte: 8 }, unlisted: "preserve", updates: [
    // @ts-expect-error Flag assignments require Boolean formulas.
    { flag: mos.flag("z"), value: literal(8, 0) },
  ] };
}

export function checkGeneratedInstructionTypes(mos: Cpu6502State, intel: Cpu8080State): void {
  generated6502.tax(mos);
  generated6502.cmpImmediate(mos, { fetchByte: () => 0 });
  generated6502.ldxZeroPageY(mos, { fetchByte: () => 0, readByte: () => 0 });
  generated6502.txs(mos);
  generated8080.cmpB(intel);
  // @ts-expect-error Generated handlers use the concrete CPU's stored-state type.
  generated6502.cmpImmediate(intel, { fetchByte: () => 0 });
  // @ts-expect-error ASL needs both memory callbacks as well as instruction fetching.
  generated6502.aslZeroPage(mos, { fetchByte: () => 0 });
  // @ts-expect-error Register comparison neither needs nor accepts a fetching capability.
  generated8080.cmpB(intel, { fetchByte: () => 0 });
  // @ts-expect-error An indexed load also requires a data-memory read capability.
  generated6502.ldxZeroPageY(mos, { fetchByte: () => 0 });
}
