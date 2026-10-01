import { create8080AltairBasic } from "../../src/machines/generated/8080/altair-basic.js";
import { SerialSession } from "../../src/runtime/serial-session.js";
import { mountAltairExplorer } from "./altair-explorer.js";
import { createAltairMachinePanel } from "./altair-machine-panel.js";
import { describeBasicTape, readBasicTape } from "./altair-basic-media.js";
import type { BasicTape } from "./altair-basic-media.js";
import { basicSessionStorage, readBasicSession, saveBasicSession } from "./altair-basic-session.js";
import type { BasicSession } from "./altair-basic-session.js";
import { createSerialExecution } from "./serial-execution.js";
import { createSerialTerminal, terminalControlKey, terminalInput } from "./serial-terminal.js";

/** Presentation and operator actions for the machine generated from the published guide. */
export async function mountAltairBasic(root: HTMLElement): Promise<void> {
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
  const media = { bytes: Number(root.dataset.tapeSize), sha256: root.dataset.tapeSha256! };
  const continuation = root.querySelector<HTMLElement>("[data-session-status]");
  const store = root.dataset.basicSession === undefined ? undefined
    : basicSessionStorage(() => window.sessionStorage, `basic-session:${root.dataset.basicSession}`);
  const reloadLabel = store === undefined ? "Reload tape" : "Start fresh";
  let retired = false;
  // Install before asynchronous tape verification, so even a quick history visit
  // replaces cached hardware with the latest checkpoint without saving over it.
  window.addEventListener("pageshow", event => {
    if (event.persisted && store !== undefined) { retired = true; window.location.reload(); }
  });
  const kept = "This tab keeps your BASIC machine and program between lessons. Returning restores it paused; press RUN to continue.";
  let restored: BasicSession | undefined, storageFailed = false;
  if (store !== undefined) {
    try {
      const saved = store.read();
      if (saved !== null) restored = await readBasicSession(saved, media);
      continuation!.textContent = restored === undefined ? kept : "Your BASIC session is restored and paused. Press RUN to continue where you left off.";
    } catch {
      try { store.clear(); } catch { storageFailed = true; }
      continuation!.textContent = storageFailed
        ? "This browser cannot keep the session between pages. Keep this page open and copy your program before leaving."
        : "The saved session could not be restored. Load the tape to start fresh.";
    }
  }
  if (retired) return;
  const terminal = restored?.terminal ?? createSerialTerminal();
  const session = restored?.session ?? new SerialSession(output => create8080AltairBasic({ serial: output }));
  let tape: BasicTape | undefined = restored?.tape, selecting = false, selection = 0;
  let lowSwitches = restored?.panel.lowSwitches ?? 0, previousPc = restored?.previousPc;
  const execution = createSerialExecution(session, {
    schedule(callback) { const timer = window.setTimeout(callback, 0); return () => window.clearTimeout(timer); },
    output: terminal.write,
    onChange: refresh,
  }, restored?.execution);
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
    tapeStatus.textContent = selecting ? "Checking selected file…" : describeBasicTape(tape, session.tapePosition, session.tapeLength, reloadLabel);
    inputStatus.textContent = `${session.pendingInput} keyboard bytes queued`;
    if (screen.textContent !== terminal.text) {
      const following = screen.scrollHeight - screen.scrollTop - screen.clientHeight < 40;
      screen.textContent = terminal.text;
      if (following) screen.scrollTop = screen.scrollHeight;
    }
    const cpu = session.machine.cpu.snapshot(), serial = session.machine.serial.snapshot();
    previousPc = execution.records.at(-1)?.after.pc ?? previousPc;
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
    lowSwitches = 0; previousPc = undefined;
    panelDetails.open = true;
    message.textContent = "Raise only A11 + A10, then RUN to load BASIC. Leave PC at 0000.";
    panelView.reset();
    element<HTMLElement>("panel-last").textContent = freshPanelMessage;
    save();
  }

  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    const token = ++selection;
    execution.stop(); selecting = true; message.textContent = ""; refresh();
    try {
      const verified = await readBasicTape(chosen, media);
      if (token !== selection) return;
      tape = verified;
      freshTape();
    } catch (cause) {
      if (token === selection) message.textContent = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (token === selection) { selecting = false; file.value = ""; refresh(); }
    }
  });
  run.addEventListener("click", () => {
    message.textContent = "";
    if (continuation !== null && !storageFailed) continuation.textContent = kept;
    execution.run(); keyboard.focus();
  });
  stop.addEventListener("click", () => { execution.stop(); save(); });
  reload.addEventListener("click", freshTape);
  reset.addEventListener("click", () => {
    execution.clear(); session.reset();
    previousPc = undefined;
    message.textContent = `CPU and serial reset; RAM and switches preserved. Use ${reloadLabel} for a fresh boot.`;
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
  function save(): void {
    if (store === undefined || retired) return;
    try {
      store.write(saveBasicSession({
        session, terminal, tape, execution: execution.snapshot(), previousPc,
        panel: { lowSwitches: panelView.switches & 0xff, open: panelDetails.open,
          guides: element<HTMLInputElement>("panel-guides").checked },
      }));
      storageFailed = false;
      continuation!.textContent = kept;
    } catch {
      storageFailed = true;
      continuation!.textContent = "The session could not be saved. Keep this page open and copy your program before leaving.";
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { execution.stop(); save(); }
  });
  window.addEventListener("pagehide", () => { selection++; execution.stop(); save(); });
  const canAccessMemory = () => !session.running && !selecting;
  const freshPanelMessage = "PC starts at 0000 with the bootstrap in RAM and all switches down. Raise only A11 and A10 for BASIC loading.";
  const panelView = mountAltairExplorer(root, {
    createPanel: () => createAltairMachinePanel(session.machine, canAccessMemory, lowSwitches),
    canAccessMemory,
    canSetSwitches: () => !selecting,
    onChange: renderConsole,
    initialMessage: restored === undefined
      ? freshPanelMessage
      : "Restored the paused machine and its switches. EXAMINE changes PC; use RUN to continue execution.",
  });
  if (restored !== undefined) {
    panelDetails.open = restored.panel.open;
    element<HTMLInputElement>("panel-guides").checked = restored.panel.guides;
  }
  file.disabled = false;
  refresh();
}

for (const root of document.querySelectorAll<HTMLElement>("[data-altair-basic]")) void mountAltairBasic(root);
