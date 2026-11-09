import type { RomCheckpoint, RomWalkthrough } from "./rom-guide.js";
import type { createApple2Session } from "./apple2-session.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];
export interface SoftwareBytes { readonly address: number; readonly bytes: readonly number[] }
export interface SoftwareInspection { readonly label: string; readonly address: number; readonly space: "ram" | "lc-upper" }
export interface SoftwareCheckpoint extends RomCheckpoint {
  readonly bytes: readonly number[];
  readonly when: readonly SoftwareBytes[];
  readonly inspect: readonly SoftwareInspection[];
  readonly limit: number;
}
export interface SoftwareWalkthrough extends Omit<RomWalkthrough, "steps"> {
  readonly requires: readonly SoftwareBytes[];
  readonly steps: readonly SoftwareCheckpoint[];
}

/** Loaded code identifies the supported game build even after its saved disk has changed. */
export function softwareWalkthroughAvailable(machine: Machine | undefined, tour: SoftwareWalkthrough): boolean {
  return !!machine && tour.requires.every(check => matchesBytes(machine, check));
}

function matchesBytes(machine: Machine, check: SoftwareBytes): boolean {
  return check.bytes.every((byte, i) => machine.ram.read(check.address + i) === byte);
}

/** The debugger separately checks PC; these checks distinguish loaded instructions and game modes. */
export function softwareCheckpointMatches(machine: Machine | undefined, step: SoftwareCheckpoint): boolean {
  return !!machine && matchesBytes(machine, { address: parseInt(step.address, 16), bytes: step.bytes })
    && step.when.every(check => matchesBytes(machine, check));
}

/** Memory links follow the visible bank without operating a guest soft switch. */
export function softwareInspectionAvailable(machine: Machine | undefined, inspection: SoftwareInspection): boolean {
  return !!machine && (inspection.space === "ram" || machine.language.ramRead());
}
