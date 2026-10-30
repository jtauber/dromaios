import type { DebugLocation, ObservedFrame } from "./instruction-debugger.js";
const hex = (value: number, width = 4) => value.toString(16).toUpperCase().padStart(width, "0");

/** Observed calls, never a guess based on the bytes currently on the hardware stack. */
export function createCallStack(root: HTMLElement, options: {
  readonly stackName: string; readonly stackWidth: number;
  readonly label: (location: DebugLocation) => string | undefined;
  readonly browse: (address: number) => void;
}) {
  const output = root.querySelector<HTMLElement>("[data-call-stack]");
  if (!output) return undefined;
  const note = root.querySelector<HTMLElement>("[data-call-stack-status]")!;
  return {
    refresh(frames: readonly ObservedFrame[], trackingNote: string | undefined, location: (address: number) => DebugLocation): void {
      output.replaceChildren();
      note.textContent = trackingNote ?? "Only calls observed since reset, restore, or the last register/RAM edit are shown.";
      if (!frames.length) { output.textContent = "No active observed calls."; return; }
      function link(address: number, captured?: DebugLocation): HTMLButtonElement {
        const current = location(address), space = captured?.space ?? current.space;
        const label = options.label({ address, space });
        const button = document.createElement("button"); button.type = "button"; button.className = "lab-memory-link";
        button.textContent = `$${hex(address)}${label ? ` ${label}` : ""}`;
        button.title = `Browse $${hex(address)} in Disassembly · ${space}`;
        // Historical ROM labels must not silently navigate to a different mapped bank.
        button.disabled = captured !== undefined && current.space !== captured.space;
        if (button.disabled) button.title += `; currently mapped to ${current.space}`;
        button.addEventListener("click", () => {
          // A held view can outlive a mapping change while the machine runs.
          if (captured && location(address).space !== captured.space) {
            note.textContent = `Cannot browse $${hex(address)}: its observed ${captured.space} mapping is no longer visible.`;
            button.disabled = true; return;
          }
          options.browse(address);
        });
        return button;
      }
      for (const frame of [...frames].reverse()) {
        const row = document.createElement("div"), heading = document.createElement("div"), detail = document.createElement("div");
        row.className = "lab-call-frame"; detail.className = "lab-hint";
        heading.append(frame.kind === "call" ? "Call → " : "Interrupt → ", link(frame.entry.address, frame.entry));
        detail.append("From ", link(frame.caller.address, frame.caller), " · return ", link(frame.returnAddress), ` · ${options.stackName} $${hex(frame.stack, options.stackWidth)}`);
        row.append(heading, detail); output.append(row);
      }
    },
  };
}
