import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import { applesoftCursor, applesoftKeywords, createApplesoftListing } from "./apple2-applesoft.js";
import type { ApplesoftListing } from "./apple2-applesoft.js";
import { hex } from "./apple2-explorer.js";
import type { createApple2Session } from "./apple2-session.js";
import { memoryLink } from "./memory-link.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];

const noFirmware: ApplesoftListing = { lines: [], message: "Load the Apple II Plus ROM to read its keyword table." };
const bankedRam: ApplesoftListing = { lines: [], message: "Language Card RAM is mapped in place of the Applesoft ROM." };

export function createApplesoftView(root: HTMLElement, browse: (address: number) => void) {
  const panel = root.querySelector<HTMLElement>('[data-workspace-panel="applesoft"]');
  if (!panel) return;
  const status = panel.querySelector<HTMLElement>("[data-applesoft-status]")!;
  const source = panel.querySelector<HTMLElement>("[data-applesoft-source]")!;
  const tokens = new Map<number, { button: HTMLButtonElement; line: number }>();
  let read: ReturnType<typeof createApplesoftListing> | undefined;
  let displayed: ApplesoftListing | undefined;
  let marked: HTMLButtonElement | undefined;
  function listingFor(machine: Machine): ApplesoftListing {
    if (!machine.firmware.loaded) return noFirmware;
    if (machine.language.ramRead()) return bankedRam;
    read ??= createApplesoftListing(applesoftKeywords(machine.firmware));
    return read(machine.ram);
  }
  function render(listing: ApplesoftListing): void {
    tokens.clear(); marked = undefined;
    const fragment = document.createDocumentFragment();
    for (const line of listing.lines) {
      const row = document.createElement("div");
      row.append(String(line.number), " ");
      for (const part of line.parts) {
        if (part.tokenAddress === undefined) {
          row.append(part.text);
          continue;
        }
        const button = memoryLink(part.tokenAddress, browse, part.text);
        button.setAttribute("aria-label", `${part.text} at $${hex(part.tokenAddress)} in Memory`);
        tokens.set(part.tokenAddress, { button, line: line.number });
        row.append(" ", button, " "); // LIST puts a space on each side of an expanded token.
      }
      fragment.append(row);
    }
    source.replaceChildren(fragment);
    displayed = listing;
  }
  return (machine: Machine, latest?: Cpu6502StepRecord): void => {
    if (panel.hidden) return;
    const listing = listingFor(machine);
    if (listing !== displayed) render(listing);
    if (listing.message) { status.textContent = listing.message; return; }
    const cursor = applesoftCursor(machine.ram, latest);
    const token = cursor && tokens.get(cursor.address);
    const current = token && (cursor.line === undefined || cursor.line === token.line) ? token : undefined;
    if (marked !== current?.button) {
      marked?.removeAttribute("aria-current");
      marked = current?.button;
      marked?.setAttribute("aria-current", "true");
    }
    status.textContent = current && cursor
      ? `${cursor.source} · line ${current.line} · ${current.button.textContent} at $${hex(cursor.address)}`
      : `${listing.lines.length} stored ${listing.lines.length === 1 ? "line" : "lines"} · no current keyword`;
  };
}
