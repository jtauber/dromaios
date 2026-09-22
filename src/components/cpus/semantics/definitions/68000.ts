import { instructionAliases, instructionSet } from "../builders.ts";
import { families } from "../generated/68000.ts";

export const instructions68000 = instructionSet(Object.entries(families)
  .filter(([name]) => name !== "moveQuick" && !name.startsWith("operand")).flatMap(([, entries]) => entries), 16);

// Native binding supplies the immediate byte; the chapter owns every opcode entry.
export const { definitions: quick68000, opcodeAliases: quickOpcodes68000 } = instructionAliases(families.moveQuick!);

// The chapter owns behavior, legality, and roles; this adapter groups native calling conventions.
const bindings = (prefix: string) => instructionAliases(Object.entries(families)
  .filter(([name]) => name.startsWith(prefix)).flatMap(([, entries]) => entries));

export const { definitions: moves68000, opcodeAliases: moveOpcodes68000 } = bindings("operandMove");
export const { definitions: logic68000, opcodeAliases: logicOpcodes68000 } = bindings("operandLogic");
export const { definitions: arithmetic68000, opcodeAliases: arithmeticOpcodes68000 } = bindings("operandArithmetic");
export const { definitions: bits68000, opcodeAliases: bitOpcodes68000 } = bindings("operandBits");
export const { definitions: wordArithmetic68000, opcodeAliases: wordArithmeticOpcodes68000 } = bindings("operandWord");
export const { definitions: decimal68000, opcodeAliases: decimalOpcodes68000 } = bindings("operandDecimal");
export const { definitions: control68000, opcodeAliases: controlOpcodes68000 } = bindings("operandControl");
export const { definitions: transfers68000, opcodeAliases: transferOpcodes68000 } = bindings("operandTransfer");
export const { definitions: system68000, opcodeAliases: systemOpcodes68000 } = bindings("operandSystem");
