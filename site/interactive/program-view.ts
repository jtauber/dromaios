import type { FetchedInstruction } from "../../src/components/cpus/execution-records.js";
import { hex } from "./register-programs.js";
import type { LessonInstruction } from "./register-programs.js";
import type { ProgramHistory } from "./program-history.js";

/** Inspect a known program in RAM; fetched bytes come from the CPU record. */
export function mountProgramView(
  root: HTMLElement, instructions: readonly LessonInstruction[], endAddress: number | undefined, read: (address: number) => number,
) {
  const list = root.querySelector<HTMLOListElement>("[data-program-instructions]")!;
  const boundary = root.querySelector<HTMLElement>("[data-program-end]")!;
  const fetched = root.querySelector<HTMLElement>("[data-program-fetched]")!;
  const pathLabel = root.querySelector<HTMLElement>("[data-program-path]");
  const rows = instructions.map(instruction => {
    const row = document.createElement("li");
    const heading = document.createElement("div");
    heading.className = "program-instruction-heading";
    const explanation = document.createElement("strong");
    const marker = document.createElement("span");
    marker.className = "program-marker";
    const runs = document.createElement("span");
    runs.className = "program-runs";
    heading.append(explanation, marker, runs);
    const mnemonic = document.createElement("code");
    const bytes = document.createElement("div");
    bytes.className = "program-bytes";
    const cells = Array.from({ length: instruction.length }, (_, offset) => {
      const address = instruction.address + offset;
      const cell = document.createElement("span");
      cell.className = "program-byte";
      const label = document.createElement("span");
      label.textContent = hex(address, 4);
      const value = document.createElement("strong");
      cell.append(label, value);
      bytes.append(cell);
      return { address, cell, value };
    });
    row.append(heading, mnemonic, bytes);
    list.append(row);
    return { instruction, row, explanation, mnemonic, marker, runs, cells };
  });

  return {
    render(pc: number, last: FetchedInstruction | null, history?: ProgramHistory): void {
      // The instruction record excludes data accesses, unlike the full access list.
      const fetchedAddresses = new Set(last?.bytes.map((_, offset) => last.address + offset));
      for (const { instruction, row, explanation, mnemonic, marker, runs, cells } of rows) {
        const { address } = instruction;
        explanation.textContent = instruction.explanation(read);
        mnemonic.textContent = instruction.mnemonic(read);
        if (address === pc) row.setAttribute("aria-current", "step");
        else row.removeAttribute("aria-current");
        const count = history?.visits.get(address) ?? 0;
        const skipped = address !== pc && (history?.skipped.has(address) ?? false);
        marker.textContent = address === pc ? "← Next (PC)" : last?.address === address ? "Last step"
          : skipped ? "Skipped · not fetched" : count > 0 ? "Ran earlier" : "";
        runs.hidden = history === undefined;
        runs.textContent = `Runs: ${count}`;
        row.toggleAttribute("data-skipped", skipped);
        for (const { address, cell, value } of cells) {
          value.textContent = hex(read(address), 2);
          cell.toggleAttribute("data-fetched", fetchedAddresses.has(address));
        }
      }
      boundary.hidden = endAddress === undefined;
      if (endAddress !== undefined) {
        boundary.toggleAttribute("data-current", pc === endAddress);
        boundary.textContent = `${hex(endAddress, 4)} · End of this program${pc === endAddress ? " ← PC" : ""}`;
      }
      fetched.textContent = last
        ? `Last step fetched ${last.bytes.length} bytes, starting at ${hex(last.address, 4)}: ${last.bytes.map(byte => hex(byte, 2)).join(" ")}. PC moved from ${hex(last.address, 4)} to ${hex(pc, 4)}.`
        : "No instruction has run. PC points to the first instruction.";
      if (pathLabel && history) {
        const label = history.truncated ? "Recent PC path (last 12 steps): … → " : "PC path so far: ";
        pathLabel.textContent = `${label}${history.path.map(address => hex(address, 4)).join(" → ")}.`;
      }
    },
  };
}
