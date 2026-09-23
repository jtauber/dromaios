import { instructionAliases, instructionSet } from "../../src/components/cpus/semantics/builders.js";
import { families } from "../../src/components/cpus/semantics/generated/68000.js";

export const instructions68000 = instructionSet(Object.entries(families)
  .filter(([name]) => name !== "moveQuick" && !name.startsWith("operand")).flatMap(([, entries]) => entries), 16);

// Test inventories retain semantic categories independently of generated file partitioning.
export const { definitions: quick68000, opcodeAliases: quickOpcodes68000 } = instructionAliases(families.moveQuick!);

// Production partitions only by encoded input signature; these selections focus existing family oracles.
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

/** Select one family for its independent oracle while retaining concrete generated signatures. */
export function selectFamily<T extends { instructions: object; opcodeInstructions: object }>(module: T, prefix: string): T {
  const { definitions, opcodeAliases } = prefix === "moveQuick" ? instructionAliases(families.moveQuick!) : bindings(prefix);
  const select = <Table extends object>(table: Table, keys: readonly (string | number)[]) => {
    for (const key of keys) if (!Object.hasOwn(table, key)) throw new Error(`Missing generated body ${key}.`);
    return Object.fromEntries(keys.map(key => [key, table[key as keyof Table]])) as Table;
  };
  return { ...module, instructions: select(module.instructions, Object.keys(definitions)),
    opcodeInstructions: select(module.opcodeInstructions, opcodeAliases.map(([opcode]) => opcode)) };
}
