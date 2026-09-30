import { create8080AltairBasic } from "../../src/machines/generated/8080/altair-basic.js";
import { SerialSession } from "../../src/runtime/serial-session.js";
import { createSerialExecution } from "./serial-execution.js";
import { createSerialTerminal, terminalControlKey, terminalInput } from "./serial-terminal.js";

/** Presentation and operator actions for the machine generated from the published guide. */
export function mountAltairBasic(root: HTMLElement): void {
  const element = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`)!;
  const file = element<HTMLInputElement>("tape-file"), switches = element<HTMLInputElement>("loading-switches");
  const keyboard = element<HTMLTextAreaElement>("terminal-keyboard"), screen = element<HTMLElement>("serial-screen");
  const run = element<HTMLButtonElement>("machine-run"), stop = element<HTMLButtonElement>("machine-stop");
  const reset = element<HTMLButtonElement>("machine-reset"), reload = element<HTMLButtonElement>("machine-reload");
  const enter = element<HTMLButtonElement>("terminal-enter"), interrupt = element<HTMLButtonElement>("terminal-break");
  const status = element<HTMLElement>("machine-status"), message = element<HTMLElement>("machine-message");
  const progress = element<HTMLProgressElement>("tape-progress"), tapeStatus = element<HTMLElement>("tape-status");
  const inspect = element<HTMLElement>("machine-inspect"), trace = element<HTMLElement>("machine-trace");
  const terminal = createSerialTerminal();
  const session = new SerialSession(output => create8080AltairBasic({ serial: output }));
  let tape: Uint8Array | undefined, tapeName = "", selecting = false, selection = 0;
  const execution = createSerialExecution(session, {
    schedule(callback) { const timer = window.setTimeout(callback, 0); return () => window.clearTimeout(timer); },
    output: terminal.write,
    onChange: refresh,
  });
  const hex = (value: number, width = 4) => value.toString(16).toUpperCase().padStart(width, "0");

  function refresh(): void {
    run.disabled = tape === undefined || selecting || session.running || execution.error !== undefined;
    stop.disabled = !session.running;
    reset.disabled = reload.disabled = tape === undefined || selecting;
    keyboard.disabled = enter.disabled = interrupt.disabled = tape === undefined || selecting;
    switches.disabled = selecting || session.running;
    switches.checked = session.machine.sense.snapshot().switches === 0x0c;
    status.textContent = `${execution.status} · ${execution.steps.toLocaleString()} instructions`;
    status.setAttribute("aria-live", session.running ? "off" : "polite");
    if (execution.error !== undefined) message.textContent = execution.error;
    progress.max = session.tapeLength || 1;
    progress.value = session.tapePosition;
    tapeStatus.textContent = selecting ? "Checking selected file…" : tape === undefined ? "No tape selected."
      : `${tapeName} · ${session.tapePosition.toLocaleString()} / ${session.tapeLength.toLocaleString()} bytes offered · ${session.pendingInput} keyboard bytes queued`;
    if (screen.textContent !== terminal.text) {
      const following = screen.scrollHeight - screen.scrollTop - screen.clientHeight < 40;
      screen.textContent = terminal.text;
      if (following) screen.scrollTop = screen.scrollHeight;
    }
    const cpu = session.machine.cpu.snapshot(), serial = session.machine.serial.snapshot();
    inspect.textContent = `PC ${hex(cpu.pc)}   SP ${hex(cpu.sp)}   A ${hex(cpu.a, 2)}   HL ${hex(cpu.hl)}\nSerial receive: ${serial.full ? "full" : "empty"}   Sense switches: ${hex(session.machine.sense.snapshot().switches, 2)}`;
    // Only format history when opened; inspection reads snapshots, never device ports.
    if (trace.closest("details")!.open) {
      trace.textContent = execution.records.map(record => `${hex(record.before.pc)} → ${hex(record.after.pc)}  ${record.outcome}`).join("\n");
    }
  }

  function send(bytes: readonly number[]): void {
    if (keyboard.disabled) return;
    if (session.pendingInput + bytes.length > 4096) throw new Error("The keyboard queue is full. Let the machine catch up.");
    session.send(bytes);
    message.textContent = session.running ? "" : "Input queued. RUN resumes the machine.";
    refresh();
  }
  function action(perform: () => void): void {
    try { perform(); }
    catch (cause) { message.textContent = cause instanceof Error ? cause.message : String(cause); }
  }
  function sendText(text: string): void { action(() => send(terminalInput(text))); }
  function freshTape(): void {
    execution.clear();
    session.reload(tape);
    terminal.clear(); keyboard.value = "";
    message.textContent = "Raise A11 + A10, then RUN to load BASIC.";
    refresh();
  }

  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    const token = ++selection;
    execution.stop(); selecting = true; message.textContent = ""; refresh();
    try {
      if (chosen.size !== Number(root.dataset.tapeSize)) throw new Error(`This machine needs the ${root.dataset.tapeSize}-byte 4K BASIC 3.2 tape.`);
      const bytes = new Uint8Array(await chosen.arrayBuffer());
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = Array.from(new Uint8Array(digest), byte => hex(byte, 2).toLowerCase()).join("");
      if (hash !== root.dataset.tapeSha256) throw new Error("This file does not match the 4K BASIC 3.2 tape in the guide.");
      if (token !== selection) return;
      tape = bytes; tapeName = chosen.name;
      freshTape();
    } catch (cause) {
      if (token === selection) message.textContent = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (token === selection) { selecting = false; file.value = ""; refresh(); }
    }
  });
  switches.addEventListener("change", () => { session.machine.sense.offer(switches.checked ? 0x0c : 0); refresh(); });
  run.addEventListener("click", () => { message.textContent = ""; execution.run(); keyboard.focus(); });
  stop.addEventListener("click", () => execution.stop());
  reload.addEventListener("click", freshTape);
  reset.addEventListener("click", () => {
    execution.clear(); session.reset();
    message.textContent = "CPU and serial reset; RAM and switches preserved. Use Reload tape for a fresh boot.";
    refresh();
  });
  enter.addEventListener("click", () => { action(() => send([13])); keyboard.focus(); });
  interrupt.addEventListener("click", () => { action(() => send([3])); keyboard.focus(); });
  keyboard.addEventListener("keydown", event => {
    const byte = terminalControlKey(event);
    if (byte !== undefined) { event.preventDefault(); action(() => send([byte])); }
  });
  keyboard.addEventListener("beforeinput", event => {
    if (event.isComposing) return;
    if (event.inputType === "deleteContentBackward") { event.preventDefault(); action(() => send([95])); }
    else if (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") { event.preventDefault(); action(() => send([13])); }
    else if (event.inputType === "insertText" && event.data !== null) { event.preventDefault(); sendText(event.data); }
  });
  keyboard.addEventListener("input", event => {
    if (event.isComposing) return;
    sendText(keyboard.value); keyboard.value = "";
  });
  keyboard.addEventListener("paste", event => {
    event.preventDefault(); sendText(event.clipboardData?.getData("text/plain") ?? "");
  });
  trace.closest("details")!.addEventListener("toggle", refresh);
  document.addEventListener("visibilitychange", () => { if (document.hidden) execution.stop(); });
  window.addEventListener("pagehide", () => execution.stop());
  file.disabled = false;
  refresh();
}

for (const root of document.querySelectorAll<HTMLElement>("[data-altair-basic]")) mountAltairBasic(root);
