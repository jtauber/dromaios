import { applesoftBranches, resolveApplesoftBranch } from "./apple2-applesoft-flow.js";
import type { ApplesoftBranch, ApplesoftTarget } from "./apple2-applesoft-flow.js";
import type { ApplesoftListing } from "./apple2-applesoft.js";

/** Build annotations once per rendered listing; click-time checks also protect a held view. */
export function applesoftFlowAnnotations(source: ApplesoftListing, current: () => ApplesoftListing, reveal: (address: number) => void) {
  const outgoing = new Map<number, HTMLElement>(), incoming = new Map<number, HTMLElement>();
  function annotation(map: Map<number, HTMLElement>, line: number, label: string): HTMLElement {
    let row = map.get(line);
    if (!row) { row = document.createElement("div"); row.className = "lab-basic-flow"; row.append(label); map.set(line, row); }
    else row.append(" · ");
    return row;
  }
  function link(branch: ApplesoftBranch, target: ApplesoftTarget, direction: "source" | "destination", label: string): HTMLButtonElement {
    const button = document.createElement("button"); button.type = "button"; button.className = "lab-memory-link";
    button.textContent = label;
    const from = `line ${branch.source.line}, statement ${branch.source.index + 1}`;
    const option = branch.kind.startsWith("ON ") ? `, choice ${branch.targets.indexOf(target) + 1}` : "";
    button.title = `${branch.conditional ? "Conditional " : ""}${branch.kind}${option}: ${from} → line ${target.line}. Possible transfer; not an execution record.`;
    button.setAttribute("aria-label", direction === "destination" ? `Show target line ${target.line} from ${from}${option}` : `Show incoming ${branch.kind} from ${from}${option} to line ${target.line}`);
    button.onclick = () => {
      const valid = resolveApplesoftBranch(current(), branch, target);
      if (valid) reveal(valid[direction].address);
      else { button.disabled = true; button.title = "Source or target changed; refresh the listing."; }
    };
    return button;
  }
  for (const branch of applesoftBranches(source)) {
    const row = annotation(outgoing, branch.source.line, "To · ");
    row.append(`s${branch.source.index + 1} ${branch.conditional && branch.kind !== "THEN" ? "conditional " : ""}${branch.kind} → `);
    if (branch.unresolved) row.append("unresolved operand");
    branch.targets.forEach((target, index) => {
      if (index) row.append(", ");
      const label = `${branch.kind.startsWith("ON ") ? `${index + 1}: ` : ""}${target.line}`;
      if (!target.destination) { row.append(`${label} (missing)`); return; }
      row.append(link(branch, target, "destination", label));
      annotation(incoming, target.line, "From · ").append(link(branch, target, "source", `${branch.source.line}.${branch.source.index + 1} ${branch.kind}${branch.kind.startsWith("ON ") ? ` #${index + 1}` : ""}`));
    });
  }
  return { outgoing, incoming };
}
