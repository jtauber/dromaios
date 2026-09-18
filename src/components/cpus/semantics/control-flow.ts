import { addWrap, flagValue, not, readFlag, readRegister, readSource, signExtend, value, when, writeRegister } from "./model.ts";
import type { CpuDeclaration, Flag, FlagExpression, Register, Statement, ValueSource } from "./model.ts";
import { defineInstruction } from "./validate.ts";

export interface FlowCpu { readonly declaration: CpuDeclaration; register(field: "pc"): Register }
export interface Condition { readonly steps: readonly Statement[]; readonly test: FlagExpression }

export function flagCondition(flag: Flag, set: boolean): Condition {
  return { steps: [readFlag("condition", flag)], test: set ? flagValue("condition") : not(flagValue("condition")) };
}

/** Conditions capture live state at this stage; only the taken path evaluates its ordered effects. */
function conditional(condition: Condition | undefined, steps: readonly Statement[]): readonly Statement[] {
  return condition ? [...condition.steps, when(condition.test, steps)] : steps;
}

/** Fetch or read the complete target before testing flags. Untaken paths never write PC. */
export function jump(cpu: FlowCpu, name: string, target: ValueSource, condition?: Condition) {
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: "Read the complete target, then test the condition if present. Only a taken path writes PC; do not read memory at the jump destination. "
      + "Preserve flags and other registers. Failed fetches or reads stop later effects; completed accesses remain.",
    steps: [readSource("target", target), ...conditional(condition, [writeRegister(cpu.register("pc"), value("target"))])],
  });
}

/** Resolve a signed displacement against the post-fetch PC, but read PC only on a taken path. */
export function relativeBranch(cpu: FlowCpu, name: string, displacement: ValueSource, condition?: Condition) {
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: "Fetch the complete displacement before testing the condition. Only on a taken path read the post-fetch PC, "
      + "add the signed displacement with word wraparound, and write PC. Preserve flags and other registers. "
      + "Untaken paths do not read or write PC. A failed fetch stops later effects; completed fetches remain.",
    steps: [readSource("offset", displacement), ...conditional(condition, [
      readRegister("pc", cpu.register("pc")), writeRegister(cpu.register("pc"),
        addWrap(value("pc"), displacement.width === 8 ? signExtend(value("offset"), 16) : value("offset")))])],
  });
}

/** CPU-owned address decoding finishes before entering this body, including any indexed side effects. */
export function resolvedJump(cpu: FlowCpu) {
  return defineInstruction({ cpu: cpu.declaration, name: "JMP resolved address", inputs: { address: 16 },
    explanation: "After successful address resolution, write the captured address to PC without a target-memory read. Preserve all flags and other registers.",
    steps: [writeRegister(cpu.register("pc"), value("address"))],
  });
}
