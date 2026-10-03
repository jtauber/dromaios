import type { InstructionDefinition, Statement } from "../src/components/cpus/semantics/model.ts";
import type { InstructionCatalogue, InstructionControlFlow } from "./interactive/apple2-explorer.ts";

interface InstructionLayout {
  readonly operandBytes: number;
  readonly controlFlow: InstructionControlFlow;
}

/** Fixed operand fetches (including BRK's padding) and explicit PC writes in the chapter. */
function instructionLayout(steps: readonly Statement[]): InstructionLayout {
  let operandBytes = 0, controlFlow: InstructionControlFlow = "sequential";
  for (const step of steps) {
    let nested: InstructionLayout;
    switch (step.kind) {
      case "fetch-byte": operandBytes++; continue;
      case "fetch-word": operandBytes += 2; continue;
      case "write-register":
        if (step.register.field === "pc") controlFlow = "unconditional";
        continue;
      case "read-source": nested = instructionLayout(step.source.steps); break;
      case "perform": nested = instructionLayout(step.action.steps); break;
      case "when": {
        const body = instructionLayout(step.steps);
        if (body.operandBytes !== 0) throw new Error("6502 instruction length cannot depend on a condition.");
        nested = { operandBytes: 0, controlFlow: body.controlFlow === "sequential" ? "sequential" : "conditional" };
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
    if (controlFlow !== "unconditional" && nested.controlFlow !== "sequential") controlFlow = nested.controlFlow;
  }
  return { operandBytes, controlFlow };
}

/** Build-time presentation data; no semantic compiler or execution is needed in the browser. */
export function instructionCatalogue6502(entries: readonly (readonly [number, InstructionDefinition])[]): InstructionCatalogue {
  return Object.fromEntries(entries.map(([opcode, definition]) => {
    const { operandBytes, controlFlow } = instructionLayout(definition.steps), length = 1 + operandBytes;
    if (length !== 1 && length !== 2 && length !== 3) throw new Error(`Invalid 6502 instruction length for ${definition.name}.`);
    return [opcode, { name: definition.name, length, controlFlow }];
  }));
}
