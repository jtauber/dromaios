import { cpu8080StateDescription, cpu8080Status } from "../../state/8080.ts";
import { carry, cpuSymbols, value } from "../model.ts";
import { intelAccumulatorTransfers, intelExchanges, intelJumps, intelRegisterStacks, intelStatusInstructions, intelSubroutines, intelWordArithmeticFamily, intelWordTransfers } from "../intel.ts";
import { instructions as chapterInstructions } from "../generated/8080.ts";

const cpu = cpuSymbols("8080", cpu8080StateDescription);
const conditions = (["z", "cy", "p", "s"] as const).map(flag => cpu.flag(flag));

/** Remaining families join the chapter's forms in one generated opcode table. */
export const instructions8080 = {
  ...chapterInstructions,
  ...intelStatusInstructions(cpu, cpu8080Status, "8080"),
  ...intelRegisterStacks(cpu, (register, operation) => `${operation.toUpperCase()} ${register[0]!.toUpperCase()}`),
  ...intelSubroutines(cpu, conditions, {
    call: condition => condition === undefined ? "CALL" : ["CNZ", "CZ", "CNC", "CC", "CPO", "CPE", "CP", "CM"][condition]!,
    return: condition => condition === undefined ? "RET" : ["RNZ", "RZ", "RNC", "RC", "RPO", "RPE", "RP", "RM"][condition]!,
    restart: address => `RST ${address / 8}`,
  }),
  ...intelJumps(cpu, conditions,
    condition => typeof condition === "number" ? ["JNZ", "JZ", "JNC", "JC", "JPO", "JPE", "JP", "JM"][condition]!
      : condition === "absolute" ? "JMP" : "PCHL"),
  ...intelAccumulatorTransfers(cpu, (address, operation) => address === "absolute" ? `${operation === "store" ? "STA" : "LDA"} nn`
    : `${operation === "store" ? "STAX" : "LDAX"} ${address === "bc" ? "B" : "D"}`),
  ...intelWordTransfers(cpu, (register, operation) => operation === "immediate"
    ? `LXI ${{ bc: "B", de: "D", hl: "H", sp: "SP" }[register]},nn`
    : { load: "LHLD nn", store: "SHLD nn", copy: "SPHL" }[operation]),
  ...intelExchanges(cpu, operation => operation === "stack" ? "XTHL" : "XCHG"),
  ...intelWordArithmeticFamily(cpu, { name: "8080 DAD carry", parameters: { left: 16, right: 16, result: 16 }, unlisted: "preserve",
    updates: [{ flag: cpu.flag("cy"), value: carry(value("left"), value("right")) }] },
    (register, operation) => `${{ increment: "INX", decrement: "DCX", add: "DAD" }[operation]} ${{ bc: "B", de: "D", hl: "H", sp: "SP" }[register]}`),
};
