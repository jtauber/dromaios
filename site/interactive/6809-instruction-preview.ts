import { Cpu6809 } from "../../src/components/cpus/generated/6809-cpu.js";
import type { Cpu6809Snapshot, Cpu6809StepRecord, Cpu6809InterruptRecord } from "../../src/components/cpus/generated/6809-cpu.js";
import type { Catalogue6809 } from "./6809-catalogue.js";
import { decode6809, hex6809 as hex } from "./6809-disassembly.js";
import { describeFlagCondition, testFlagCondition } from "./instruction-shape.js";
import { explain6809Address } from "./6809-address-explanation.js";
import { previewMemory } from "./preview-memory.js";

export type Boundary6809 = Cpu6809StepRecord | Cpu6809InterruptRecord;
export type InstructionPreview6809 = ReturnType<typeof preview6809>;

/** Execute a copied CPU, with machine-specific storage policy and boundary arbitration supplied by the host. */
export function preview6809(state: Cpu6809Snapshot, read: (address: number) => number | undefined, catalogue: Catalogue6809,
  writeKind: Parameters<typeof previewMemory>[1], advance: (cpu: Cpu6809) => Boundary6809 = cpu => cpu.step()) {
  const decoded = decode6809(read, state.pc, catalogue), preview = previewMemory(read, writeKind);
  const cpu = new Cpu6809(preview.memory, state), record = preview.attempt(() => advance(cpu));
  const blocked = preview.blocked, effects: string[] = [];
  const ordinary = record?.instruction != null;
  let assembly = decoded.assembly;
  if (record && !ordinary) assembly = "source" in record ? `${record.source.toUpperCase()} · ${record.outcome}` : `Waiting · ${state.waitMode.toUpperCase()}`;
  const condition = decoded.shape?.condition;
  if (condition && decoded.info?.operand === "relative" && ordinary && record?.outcome === "executed") {
    effects.push(`Branch if ${describeFlagCondition(condition)}.`,
      `N=${+state.flags.n} Z=${+state.flags.z} V=${+state.flags.v} C=${+state.flags.c}: branch ${testFlagCondition(condition, state.flags) ? "taken" : "not taken"}.`);
  }
  if (blocked) effects.push(`${blocked.kind === "read" ? "Read" : "Write"} $${hex(blocked.address)}: device or unavailable storage.`,
    "Preview stops here; step the machine to observe the result.");
  else if (record?.outcome === "unsupported") effects.push("Unsupported instruction or postbyte.");
  else if (record) {
    for (const name of ["a", "b", "x", "y", "dp", "s", "u"] as const) {
      if (state[name] !== record.after[name]) {
        const width = ["a", "b", "dp"].includes(name) ? 2 : 4;
        effects.push(`${name.toUpperCase()}  $${hex(state[name], width)} → $${hex(record.after[name], width)}`);
      }
    }
    const flags = (["e", "f", "h", "i", "n", "z", "v", "c"] as const).filter(flag => state.flags[flag] !== record.after.flags[flag]);
    if (flags.length) effects.push(flags.map(flag => `${flag.toUpperCase()} ${+state.flags[flag]} → ${+record.after.flags[flag]}`).join("   "));
    if (state.waitMode !== record.after.waitMode) effects.push(`Wait: ${state.waitMode} → ${record.after.waitMode}`);
    if (state.nmiArmed !== record.after.nmiArmed) effects.push(`NMI armed: ${+state.nmiArmed} → ${+record.after.nmiArmed}`);
    for (const access of preview.accesses) if (access.kind === "write") effects.push(`Write $${hex(access.address)} ← $${hex(access.value, 2)}${writeKind(access.address) === "ignored" ? " (ignored by this map)" : ""}`);
    if (!effects.length) effects.push("Registers and flags unchanged.");
    effects.push(`PC → $${hex(record.after.pc)}`);
  }
  return { address: state.pc, assembly, effects, accesses: preview.accesses, record, blocked,
    addressing: ordinary || !record ? explain6809Address(state, decoded, read) : [],
    explanation: ordinary || !record ? decoded.info?.explanation : "External entry and waiting are CPU boundaries; no instruction is fetched." };
}
