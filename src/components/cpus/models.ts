import { chapterInterfaces } from "./semantics/generated/interfaces.ts";
import type { ChapterStates } from "./semantics/generated/interfaces.ts";
import { cpu8080StateDescription } from "./state/8080.ts";
import { cpu8088StateDescription } from "./state/8088.ts";
import { cpu6502StateDescription } from "./state/6502.ts";
import { cpu6800StateDescription } from "./state/6800.ts";
import { cpu6809StateDescription } from "./state/6809.ts";
import { cpu68000StateDescription } from "./state/68000.ts";
import { cpuZ80StateDescription } from "./state/z80.ts";
import type { StateFields, StateValues } from "./state.ts";

/** Integration metadata for cores whose complete models have not yet moved to chapters. */
function handwritten<const Fields extends StateFields, const Size extends number>(
  module: string, state: Fields, ramSize: Size, maximumPc = ramSize - 1,
) {
  return { name: `Cpu${module[0]!.toUpperCase()}${module.slice(1)}`, module, state, ramSize, maximumPc };
}

/** Small schemas and entry points only: importing this catalogue never loads CPU execution. */
export const cpuModels = {
  "8080": handwritten("8080", cpu8080StateDescription, 0x10000),
  "8088": handwritten("8088", cpu8088StateDescription, 0x100000),
  "6502": handwritten("6502", cpu6502StateDescription, 0x10000),
  "6800": handwritten("6800", cpu6800StateDescription, 0x10000),
  "6809": handwritten("6809", cpu6809StateDescription, 0x10000),
  "68000": handwritten("68000", cpu68000StateDescription, 0x1000000, 0xffffffff),
  "z80": handwritten("z80", cpuZ80StateDescription, 0x10000),
  ...chapterInterfaces,
} as const;

export type CpuModel = keyof typeof cpuModels;
export type CpuStates = {
  [Model in CpuModel]: Model extends keyof ChapterStates ? ChapterStates[Model] : StateValues<typeof cpuModels[Model]["state"]>;
};
