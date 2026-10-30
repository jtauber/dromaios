import { debuggerStatus } from "./debugger-status.js";
import type { DebugStop } from "./instruction-debugger.js";

export function createDebuggerStatus(root: HTMLElement) {
  const messages = root.querySelectorAll<HTMLElement>("[data-rom-stop-status], [data-disassembly-stop-status], [data-debugger-status], [data-walkthrough-stop-status]");
  function show(text: string, running = false): void {
    for (const message of messages) {
      message.setAttribute("aria-live", running ? "off" : "polite");
      if (message.textContent !== text) message.textContent = text;
    }
  }
  return { show, refresh: (stop: DebugStop | undefined, request: string | undefined, running: boolean) => show(debuggerStatus(stop, request, running), running) };
}
