import type { createApple2Session } from "./apple2-session.js";
import { createApple2ChangeLog } from "./apple2-change-log.js";
import { createChangeLogView } from "./change-log-view.js";
import { disassemble6502 } from "./apple2-explorer.js";
import type { InstructionCatalogue } from "./apple2-explorer.js";

export function createApple2ChangeLogView(root: HTMLElement, machine: () => ReturnType<typeof createApple2Session>["machine"]) {
  const { instructions } = JSON.parse(root.querySelector<HTMLElement>("[data-rom-catalogue]")!.textContent!) as { instructions: InstructionCatalogue };
  return createChangeLogView(root, machine, createApple2ChangeLog,
    ({ address, bytes }) => disassemble6502(address, bytes, instructions));
}
