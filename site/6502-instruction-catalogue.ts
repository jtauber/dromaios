import type { FlagExpression, InstructionDefinition, Statement } from "../src/components/cpus/semantics/model.ts";
import type { BranchCondition6502, InstructionCatalogue, InstructionControlFlow } from "./interactive/apple2-explorer.ts";

interface InstructionLayout {
  readonly operandBytes: number;
  readonly controlFlow: InstructionControlFlow;
  readonly branchCondition?: BranchCondition6502;
}

/** Resolve a test of one captured branch flag, including its negation. */
function branchCondition(condition: FlagExpression, flags: ReadonlyMap<string, string>): BranchCondition6502 | undefined {
  if (condition.kind === "not") {
    const test = branchCondition(condition.value, flags);
    return test && { ...test, set: !test.set };
  }
  const flag = condition.kind === "flag-value" ? flags.get(condition.name) : undefined;
  return flag === "n" || flag === "v" || flag === "c" || flag === "z" ? { flag, set: true } : undefined;
}

/** Fixed operand fetches (including BRK's padding) and explicit PC writes in the chapter. */
function instructionLayout(steps: readonly Statement[]): InstructionLayout {
  let operandBytes = 0, controlFlow: InstructionControlFlow = "sequential";
  const flags = new Map<string, string>();
  let condition: BranchCondition6502 | undefined, conditionalWrites = 0;
  for (const step of steps) {
    let nested: InstructionLayout;
    switch (step.kind) {
      case "fetch-byte": operandBytes++; continue;
      case "fetch-word": operandBytes += 2; continue;
      case "read-flag": flags.set(step.name, step.flag.field); continue;
      case "write-register":
        if (step.register.field === "pc") controlFlow = "unconditional";
        continue;
      case "read-source": nested = instructionLayout(step.source.steps); break;
      case "perform": nested = instructionLayout(step.action.steps); break;
      case "when": {
        const body = instructionLayout(step.steps);
        if (body.operandBytes !== 0) throw new Error("6502 instruction length cannot depend on a condition.");
        nested = { operandBytes: 0, controlFlow: body.controlFlow === "sequential" ? "sequential" : "conditional",
          branchCondition: body.controlFlow === "unconditional" ? branchCondition(step.condition, flags) : undefined };
        break;
      }
      case "choose": {
        const yes = instructionLayout(step.yes.steps), no = instructionLayout(step.no.steps);
        if (yes.operandBytes !== no.operandBytes) throw new Error("6502 instruction length cannot depend on a condition.");
        nested = { operandBytes: yes.operandBytes, controlFlow: yes.controlFlow === no.controlFlow ? yes.controlFlow : "conditional" };
        break;
      }
      case "dispatch": case "match": case "iterate": case "iterate-together":
        throw new Error(`6502 instruction layout does not support ${step.kind}.`);
      default: continue; // Other register, flag, and data-memory effects preserve instruction flow.
    }
    operandBytes += nested.operandBytes;
    if (nested.controlFlow === "conditional") {
      conditionalWrites++;
      condition = conditionalWrites === 1 ? nested.branchCondition : undefined;
    }
    if (controlFlow !== "unconditional" && nested.controlFlow !== "sequential") controlFlow = nested.controlFlow;
  }
  return { operandBytes, controlFlow, branchCondition: controlFlow === "conditional" ? condition : undefined };
}

/** Build-time presentation data; no semantic compiler or execution is needed in the browser. */
export function instructionCatalogue6502(entries: readonly (readonly [number, InstructionDefinition])[]): InstructionCatalogue {
  return Object.fromEntries(entries.map(([opcode, definition]) => {
    const { operandBytes, controlFlow, branchCondition } = instructionLayout(definition.steps), length = 1 + operandBytes;
    if (length !== 1 && length !== 2 && length !== 3) throw new Error(`Invalid 6502 instruction length for ${definition.name}.`);
    return [opcode, { name: definition.name, length, controlFlow, ...(branchCondition && { branchCondition }) }];
  }));
}
