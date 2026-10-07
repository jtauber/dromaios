import type { Apple2SessionState } from "./apple2-session.js";
import { apple2RamRegions } from "./apple2-inspection.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";

export interface Apple2ValueDifference {
  readonly name: string;
  readonly before: number;
  readonly after: number;
  readonly width: number;
}

/** Compare physical storage, including hidden banks. Net differences do not imply a write history. */
export function compareApple2States(saved: Apple2SessionState, current: Apple2SessionState) {
  const before = saved.hardware, after = current.hardware;
  const registers: Apple2ValueDifference[] = [], flags: Apple2ValueDifference[] = [], memory: Apple2MemoryChange[] = [];
  for (const name of ["a", "x", "y", "pc", "sp"] as const) {
    if (before.cpu[name] !== after.cpu[name]) registers.push({ name: name.toUpperCase(),
      before: before.cpu[name], after: after.cpu[name], width: name === "pc" ? 4 : 2 });
  }
  for (const name of ["n", "v", "d", "i", "z", "c"] as const) {
    if (before.cpu.flags[name] !== after.cpu.flags[name]) flags.push({ name: name.toUpperCase(),
      before: +before.cpu.flags[name], after: +after.cpu.flags[name], width: 1 });
  }
  for (const { part, base } of apple2RamRegions) {
    before[part].forEach((value, offset) => {
      if (value !== after[part][offset]) memory.push({ region: part, address: base + offset, before: value, after: after[part][offset]! });
    });
  }
  const devices: { name: string; before: string; after: string }[] = [];
  for (const part of ["keyboard", "video", "language", "disk"] as const) {
    for (const [name, value] of Object.entries(before[part])) {
      if (name === "media" || name === "bootstrap") continue;
      const next = Reflect.get(after[part], name);
      if (value !== next) devices.push({ name: `${part}.${name}`, before: String(value), after: String(next) });
    }
  }
  if ((before.disk.media !== null) !== (after.disk.media !== null)) {
    devices.push({ name: "disk.media", before: before.disk.media ? "loaded" : "absent", after: after.disk.media ? "loaded" : "absent" });
  }
  if ((before.disk.bootstrap !== null) !== (after.disk.bootstrap !== null)) {
    devices.push({ name: "disk.bootstrap", before: before.disk.bootstrap ? "installed" : "absent", after: after.disk.bootstrap ? "installed" : "absent" });
  }
  const inputChanged = saved.input.length !== current.input.length || saved.input.some((value, index) => value !== current.input[index]);
  return { registers, flags, memory, devices, inputChanged };
}
