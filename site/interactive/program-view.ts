import type { FetchedInstruction } from "../../src/components/cpus/execution-records.js";

interface ProgramInstruction {
  readonly address: number;
  readonly mnemonic: string;
  readonly explanation: string;
}

function hex(value: number, digits: number): string { return value.toString(16).toUpperCase().padStart(digits, "0"); }

/** Inspect a known program in RAM; fetched bytes come from the CPU record. */
export function mountProgramView(
  root: HTMLElement, instructions: readonly ProgramInstruction[], endAddress: number, read: (address: number) => number,
) {
  const list = root.querySelector<HTMLOListElement>("[data-program-instructions]")!;
  const boundary = root.querySelector<HTMLElement>("[data-program-end]")!;
  const fetched = root.querySelector<HTMLElement>("[data-program-fetched]")!;
  const pathLabel = root.querySelector<HTMLElement>("[data-program-path]");
  const rows = instructions.map((instruction, index) => {
    const row = document.createElement("li");
    const heading = document.createElement("div");
    heading.className = "program-instruction-heading";
    const explanation = document.createElement("strong");
    const marker = document.createElement("span");
    marker.className = "program-marker";
    heading.append(explanation, marker);
    const mnemonic = document.createElement("code");
    const bytes = document.createElement("div");
    bytes.className = "program-bytes";
    const end = instructions[index + 1]?.address ?? endAddress;
    const cells = Array.from({ length: end - instruction.address }, (_, offset) => {
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
    return { instruction, row, explanation, mnemonic, marker, cells };
  });

  return {
    render(pc: number, last: FetchedInstruction | null, path?: readonly number[]): void {
      // The instruction record excludes data accesses, unlike the full access list.
      const fetchedAddresses = new Set(last?.bytes.map((_, offset) => last.address + offset));
      const visited = new Set(path?.slice(0, -1));
      for (const { instruction, row, explanation, mnemonic, marker, cells } of rows) {
        const { address } = instruction;
        explanation.textContent = instruction.explanation;
        mnemonic.textContent = instruction.mnemonic;
        if (address === pc) row.setAttribute("aria-current", "step");
        else row.removeAttribute("aria-current");
        // The path is shown for our forward-only jump lesson; an unvisited row behind PC was skipped.
        const skipped = path !== undefined && address < pc && !visited.has(address);
        marker.textContent = address === pc ? "← Next (PC)" : last?.address === address ? "Last step"
          : skipped ? "Skipped · not fetched" : visited.has(address) ? "Ran earlier" : "";
        row.toggleAttribute("data-skipped", skipped);
        for (const { address, cell, value } of cells) {
          value.textContent = hex(read(address), 2);
          cell.toggleAttribute("data-fetched", fetchedAddresses.has(address));
        }
      }
      boundary.toggleAttribute("data-current", pc === endAddress);
      boundary.textContent = `${hex(endAddress, 4)} · End of this program${pc === endAddress ? " ← PC" : ""}`;
      fetched.textContent = last
        ? `Last step fetched ${last.bytes.length} bytes, starting at ${hex(last.address, 4)}: ${last.bytes.map(byte => hex(byte, 2)).join(" ")}. PC moved from ${hex(last.address, 4)} to ${hex(pc, 4)}.`
        : "No instruction has run. PC points to the first instruction.";
      if (pathLabel && path) pathLabel.textContent = `PC path so far: ${path.map(address => hex(address, 4)).join(" → ")}.`;
    },
  };
}
