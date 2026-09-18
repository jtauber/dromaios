import { addWrap, capture, flagValue, literal, not, readFlag, readRegister, readSource, signExtend, value, when, writeRegister } from "./model.ts";
import type { CpuDeclaration, Flag, FlagExpression, NumberExpression, Register, Statement, ValueSource } from "./model.ts";
import type { Stack } from "./stack.ts";
import { defineInstruction } from "./validate.ts";

export interface FlowCpu { readonly declaration: CpuDeclaration; register(field: "pc"): Register }
export interface Condition { readonly steps: readonly Statement[]; readonly test: FlagExpression }

export function flagCondition(flag: Flag, set: boolean): Condition {
  return { steps: [readFlag("condition", flag)], test: set ? flagValue("condition") : not(flagValue("condition")) };
}

/** Conditions capture live state at this stage; only the taken path evaluates its ordered effects. */
export function conditional(condition: Condition | undefined, steps: readonly Statement[]): readonly Statement[] {
  return condition ? [...condition.steps, when(condition.test, steps)] : steps;
}

/** Expand a short-circuit decision; only the selected arm observes its ordered effects. */
export function choose(condition: Condition, yes: readonly Statement[], no: readonly Statement[]): readonly Statement[] {
  return [...condition.steps, ...(yes.length ? [when(condition.test, yes)] : []), ...(no.length ? [when(not(condition.test), no)] : [])];
}

/** Add a captured word displacement to the live program-counter role (PC or IP), with word wrapping. */
export function relativeBranchSteps(pc: Register, displacement: NumberExpression): readonly Statement[] {
  return [readRegister("pc", pc), writeRegister(pc, addWrap(value("pc"), displacement))];
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
    steps: [readSource("offset", displacement), ...conditional(condition,
      relativeBranchSteps(cpu.register("pc"), displacement.width === 8 ? signExtend(value("offset"), 16) : value("offset")))],
  });
}

/** CPU-owned address decoding finishes before entering this body, including any indexed side effects. */
export function resolvedJump(cpu: FlowCpu) {
  return defineInstruction({ cpu: cpu.declaration, name: "JMP resolved address", inputs: { address: 16 },
    explanation: "After successful address resolution, write the captured address to PC without a target-memory read. Preserve all flags and other registers.",
    steps: [writeRegister(cpu.register("pc"), value("address"))],
  });
}

/** Resolve the relative target before any call-stack effects; the return PC is captured separately. */
export function relativeTarget(cpu: FlowCpu, displacement: ValueSource): ValueSource {
  return { name: "relative call target", width: 16,
    steps: [readSource("offset", displacement), readRegister("pc", cpu.register("pc"))],
    result: addWrap(value("pc"), displacement.width === 8 ? signExtend(value("offset"), 16) : value("offset")),
  };
}

function callSteps(cpu: FlowCpu, stack: Stack, target: NumberExpression): readonly Statement[] {
  return [readRegister("returnPC", cpu.register("pc")), ...stack.push(value("returnPC")), writeRegister(cpu.register("pc"), target)];
}

/** Capture a complete target before the condition; stack the return PC only on the taken path. */
export function subroutineCall(cpu: FlowCpu, name: string, target: ValueSource | NumberExpression, stack: Stack, condition?: Condition) {
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: "Capture the complete target before testing any condition. On a taken path, capture the current return PC, "
      + "push it, then write the target to PC after both writes succeed. Preserve flags and other registers. " + stack.explanation,
    steps: ["kind" in target ? capture("target", target) : readSource("target", target),
      ...conditional(condition, callSteps(cpu, stack, value("target")))],
  });
}

/** Address resolution, including any indexed side effects, has completed before entry. */
export function resolvedCall(cpu: FlowCpu, stack: Stack) {
  return defineInstruction({ cpu: cpu.declaration, name: "JSR resolved address", inputs: { address: 16 },
    explanation: "After address resolution, capture the current return PC, push it, then write the captured target to PC. "
      + "Preserve flags, other registers, and control state. " + stack.explanation,
    steps: callSteps(cpu, stack, value("address")),
  });
}

/** Untaken returns never access the stack; a taken return replaces PC only after the complete pop. */
export function subroutineReturn(cpu: FlowCpu, name: string, stack: Stack, condition?: Condition, increment = 0) {
  return defineInstruction({ cpu: cpu.declaration, name,
    explanation: "If present, test the condition before any stack access. On a taken path, pop the complete return address and write PC"
      + (increment ? ` after adding ${increment} with word wrapping. ` : ". ")
      + "Preserve flags, other registers, and control state. " + stack.explanation,
    steps: conditional(condition, [readSource("returnPC", stack.pop),
      writeRegister(cpu.register("pc"), increment ? addWrap(value("returnPC"), literal(16, increment)) : value("returnPC"))]),
  });
}
