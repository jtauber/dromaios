import { create8080AltairBasic } from "../../src/machines/generated/8080/altair-basic.js";
import { SerialSession } from "../../src/runtime/serial-session.js";
import { mountAltairExplorer } from "./altair-explorer.js";
import { createAltairMachinePanel } from "./altair-machine-panel.js";
import { describeBasicTape, readBasicTape } from "./altair-basic-media.js";
import type { BasicTape } from "./altair-basic-media.js";
import { createSerialExecution } from "./serial-execution.js";
import { createSerialTerminal, terminalControlKey, terminalInput } from "./serial-terminal.js";

/** Presentation and operator actions for the machine generated from the published guide. */
export function mountAltairBasic(root: HTMLElement): void {
  const element = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`)!;
  const file = element<HTMLInputElement>("tape-file");
  const keyboard = element<HTMLTextAreaElement>("terminal-keyboard"), screen = element<HTMLElement>("serial-screen");
  const run = element<HTMLButtonElement>("machine-run"), stop = element<HTMLButtonElement>("machine-stop");
  const reset = element<HTMLButtonElement>("machine-reset"), reload = element<HTMLButtonElement>("machine-reload");
  const enter = element<HTMLButtonElement>("terminal-enter"), interrupt = element<HTMLButtonElement>("terminal-break");
  const status = element<HTMLElement>("machine-status"), message = element<HTMLElement>("machine-message");
  const progress = element<HTMLProgressElement>("tape-progress"), tapeStatus = element<HTMLElement>("tape-status");
  const inputStatus = element<HTMLElement>("input-status"), resumePosition = element<HTMLElement>("resume-position");
  const panelDetails = element<HTMLDetailsElement>("machine-panel");
  const inspect = element<HTMLElement>("machine-inspect"), trace = element<HTMLElement>("machine-trace");
  const terminal = createSerialTerminal();
  const session = new SerialSession(output => create8080AltairBasic({ serial: output }));
  let tape: BasicTape | undefined, selecting = false, selection = 0;
  const execution = createSerialExecution(session, {
    schedule(callback) { const timer = window.setTimeout(callback, 0); return () => window.clearTimeout(timer); },
    output: terminal.write,
    onChange: refresh,
  });
  const hex = (value: number, width = 4) => value.toString(16).toUpperCase().padStart(width, "0");

  function refresh(): void {
    panelView.refresh();
  }
  function renderConsole(): void {
    run.disabled = selecting || session.running || execution.error !== undefined;
    stop.disabled = !session.running;
    reset.disabled = selecting;
    reload.disabled = tape === undefined || selecting;
    keyboard.disabled = enter.disabled = interrupt.disabled = selecting;
    status.textContent = `${execution.status} · ${execution.steps.toLocaleString()} instructions`;
    status.setAttribute("aria-live", session.running ? "off" : "polite");
    if (execution.error !== undefined) message.textContent = execution.error;
    progress.max = session.tapeLength || 1;
    progress.value = session.tapePosition;
    progress.hidden = session.tapeLength === 0;
    tapeStatus.textContent = selecting ? "Checking selected file…" : describeBasicTape(tape, session.tapePosition, session.tapeLength);
    inputStatus.textContent = `${session.pendingInput} keyboard bytes queued`;
    if (screen.textContent !== terminal.text) {
      const following = screen.scrollHeight - screen.scrollTop - screen.clientHeight < 40;
      screen.textContent = terminal.text;
      if (following) screen.scrollTop = screen.scrollHeight;
    }
    const cpu = session.machine.cpu.snapshot(), serial = session.machine.serial.snapshot();
    const previousPc = execution.records.at(-1)?.after.pc;
    resumePosition.hidden = session.running || selecting || previousPc === undefined || previousPc === cpu.pc;
    resumePosition.textContent = previousPc === undefined ? ""
      : `Last execution left PC at ${hex(previousPc)}. The panel now selects ${hex(cpu.pc)}. Restore ${hex(previousPc)} with EXAMINE to resume from that location.`;
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
    session.reload(tape?.bytes);
    terminal.clear(); keyboard.value = "";
    panelDetails.open = true;
    message.textContent = "Raise only A11 + A10, then RUN to load BASIC. Leave PC at 0000.";
    panelView.reset();
  }

  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    const token = ++selection;
    execution.stop(); selecting = true; message.textContent = ""; refresh();
    try {
      const verified = await readBasicTape(chosen, { bytes: Number(root.dataset.tapeSize), sha256: root.dataset.tapeSha256! });
      if (token !== selection) return;
      tape = verified;
      freshTape();
    } catch (cause) {
      if (token === selection) message.textContent = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (token === selection) { selecting = false; file.value = ""; refresh(); }
    }
  });
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
  const canAccessMemory = () => !session.running && !selecting;
  const panelView = mountAltairExplorer(root, {
    createPanel: () => createAltairMachinePanel(session.machine, canAccessMemory),
    canAccessMemory,
    canSetSwitches: () => !selecting,
    onChange: renderConsole,
    initialMessage: "PC starts at 0000 with the bootstrap in RAM and all switches down. Raise only A11 and A10 for BASIC loading.",
  });
  file.disabled = false;
  refresh();
}

for (const root of document.querySelectorAll<HTMLElement>("[data-altair-basic]")) mountAltairBasic(root);
