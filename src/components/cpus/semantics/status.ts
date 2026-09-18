import { bitAnd, bitOr, flagLiteral, flagValue, literal, not, readFlag, replaceFlags, select, updateFlags, value, zero } from "./model.ts";
import type { CpuDeclaration, Flag, FlagExpression, FlagPolicy, NumberExpression, ValueSource } from "./model.ts";
import { defineInstruction } from "./validate.ts";

interface StatusCpu { readonly declaration: CpuDeclaration; flag(field: string): Flag }
interface StatusLayout { readonly bits: Readonly<Record<string, number>>; readonly fixed: number; readonly width?: 8 | 16 }

/** Read each flag in layout order and insert its bit; fixed bits are not stored flags. */
export function packedStatus(cpu: StatusCpu, layout: StatusLayout, set = 0): ValueSource {
  const width = layout.width ?? 8;
  return { name: "packed status", width,
    steps: Object.keys(layout.bits).map(name => readFlag(name, cpu.flag(name))),
    result: Object.entries(layout.bits).reduce((result, [name, bit]) =>
      bitOr(result, select(flagValue(name), literal(width, 2 ** bit), literal(width, 0))), literal(width, layout.fixed | set)),
  };
}

function decodedStatus(cpu: StatusCpu, layout: StatusLayout): FlagPolicy {
  const width = layout.width ?? 8;
  return { name: "restore packed status", parameters: { status: width }, unlisted: "preserve",
    updates: Object.entries(layout.bits).map(([name, bit]) => ({ flag: cpu.flag(name), value: not(zero(bitAnd(value("status"), literal(width, 2 ** bit)))) })),
  };
}

/** Decode the captured status, ignoring reserved bits, then replace the complete flag object. */
export function restoreStatus(cpu: StatusCpu, layout: StatusLayout, contents: NumberExpression) {
  return replaceFlags(decodedStatus(cpu, layout), { status: contents });
}

/** Update only the layout's flags, preserving the flag object and all unlisted flags. */
export function updateStatus(cpu: StatusCpu, layout: StatusLayout, contents: NumberExpression) {
  return updateFlags(decodedStatus(cpu, layout), { status: contents });
}

/** Set, clear, or complement one flag without reading or replacing the others. */
export function flagInstruction(cpu: StatusCpu, name: string, field: string, change: boolean | "complement") {
  const complement = change === "complement";
  const policy: FlagPolicy = { name, parameters: complement ? { original: "flag" } : {}, unlisted: "preserve",
    updates: [{ flag: cpu.flag(field), value: complement ? not(flagValue("original")) : flagLiteral(change === true) }],
  };
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: `${complement ? "Complement" : change ? "Set" : "Clear"} ${field.toUpperCase()}; preserve every other flag and register.`,
    steps: [...(complement ? [readFlag("original", cpu.flag(field))] : []), updateFlags(policy, complement ? { original: flagValue("original") } : {})],
  });
}

/** A one-stage flag policy whose parameters are explicit captured values. */
export function flagPolicy(cpu: StatusCpu, name: string, parameters: FlagPolicy["parameters"], updates: Readonly<Record<string, FlagExpression>>): FlagPolicy {
  return { name, parameters, unlisted: "preserve", updates: Object.entries(updates).map(([field, value]) => ({ flag: cpu.flag(field), value })) };
}
