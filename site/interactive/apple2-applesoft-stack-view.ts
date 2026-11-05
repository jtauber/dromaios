import type { ApplesoftListing } from "./apple2-applesoft.js";
import { applesoftStack } from "./apple2-applesoft-stack.js";
import type { createApple2Session } from "./apple2-session.js";
import { memoryLink } from "./memory-link.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];

export function createApplesoftStackView(root: HTMLElement, listing: () => ApplesoftListing,
  browse: (address: number) => void, reveal: (address: number) => void) {
  const panel = root.querySelector<HTMLElement>('[data-workspace-panel="applesoft-stack"]');
  if (!panel) return;
  const status = panel.querySelector<HTMLElement>("[data-basic-stack-status]")!;
  const table = panel.querySelector("table")!, body = table.tBodies[0]!;
  let displayed: string | undefined;
  return (machine: Machine, running: boolean): void => {
    if (panel.hidden) return;
    const stack = running ? { frames: [], message: "Running. Stop at a BASIC statement to inspect the stack." } : applesoftStack(machine, listing());
    const key = JSON.stringify(stack);
    if (key === displayed) return;
    displayed = key;
    status.textContent = stack.message ?? (stack.frames.length ? "" : "No active FOR loops or GOSUB calls.");
    status.hidden = !status.textContent; table.hidden = !stack.frames.length;
    body.replaceChildren();
    for (const frame of stack.frames) {
      const row = body.insertRow(), info = row.insertCell();
      info.textContent = frame.kind;
      if (frame.kind === "FOR") {
        info.append(` ${frame.variable} = ${frame.value}`, document.createElement("br"), `Limit ${frame.limit} · Step ${frame.step}`);
      }
      const target = row.insertCell(), dest = frame.destination;
      if (dest.kind === "statement") {
        const button = document.createElement("button");
        button.type = "button"; button.className = "lab-memory-link";
        button.textContent = `${dest.line} · ${dest.text}`;
        button.title = "Show statement in Applesoft listing";
        button.addEventListener("click", () => reveal(dest.address));
        target.append(button);
      } else target.textContent = dest.kind === "end" ? "End of program" : "Direct command";
      row.insertCell().append(memoryLink(frame.address, browse));
    }
  };
}
