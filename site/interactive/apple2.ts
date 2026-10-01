import { romImages } from "../../src/machines/generated/6502/apple2.js";
import { createExecutionController } from "./execution-controller.js";
import { createApple2Session, apple2ControlKey, apple2Input } from "./apple2-session.js";
import { apple2TextFrame } from "./apple2-screen.js";
import { readRomFile } from "./rom-file.js";
import type { RomFile } from "./rom-file.js";

/** File controls, host scheduling, and screen presentation around the generated machine. */
export function mountApple2(root: HTMLElement): void {
  const element = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`)!;
  const file = element<HTMLInputElement>("rom-file"), keyboard = element<HTMLTextAreaElement>("apple2-keyboard");
  const screen = element<HTMLElement>("apple2-screen"), message = element<HTMLElement>("machine-message");
  const run = element<HTMLButtonElement>("machine-run"), pause = element<HTMLButtonElement>("machine-pause");
  const step = element<HTMLButtonElement>("machine-step"), reset = element<HTMLButtonElement>("machine-reset");
  const power = element<HTMLButtonElement>("machine-power"), enter = element<HTMLButtonElement>("keyboard-enter");
  const interrupt = element<HTMLButtonElement>("keyboard-break"), inspect = element<HTMLElement>("machine-inspect");
  const trace = element<HTMLElement>("machine-trace"), status = element<HTMLElement>("machine-status");
  const container = { bytes: Number(root.dataset.romBytes), offset: Number(root.dataset.romOffset), sha256: root.dataset.romSha256! };
  let session: ReturnType<typeof createApple2Session> | undefined, rom: RomFile | undefined;
  let selecting = false, selection = 0, flash = false, nextFlash = 0;
  const cells = Array.from({ length: 24 }, () => {
    const row = document.createElement("div"); row.className = "apple2-row";
    const cells = Array.from({ length: 40 }, () => {
      const cell = document.createElement("span"); cell.textContent = " "; row.append(cell); return cell;
    });
    screen.append(row); return cells;
  });
  const execution = createExecutionController({
    step: () => {
      const record = session!.step();
      if (record.outcome !== "executed") throw new Error(`Processor stopped: ${record.outcome}.`);
      return record;
    },
    canStep: () => session !== undefined && !selecting,
    schedule(callback, delay) { const id = window.setTimeout(callback, delay); return () => window.clearTimeout(id); },
    onChange: refresh, batchSize: 2000,
  });
  execution.setDelay(1);
  const hex = (value: number, width = 4) => value.toString(16).toUpperCase().padStart(width, "0");

  function refresh(): void {
    const available = session !== undefined && !selecting;
    run.disabled = !available || execution.running || execution.error !== undefined;
    pause.disabled = !execution.running;
    step.disabled = !available || execution.running || execution.error !== undefined;
    reset.disabled = power.disabled = !available;
    keyboard.disabled = enter.disabled = interrupt.disabled = !available;
    status.textContent = `${session === undefined ? "No ROM loaded" : execution.running ? "Running" : "Paused"} · ${execution.steps.toLocaleString()} instructions`;
    status.setAttribute("aria-live", execution.running ? "off" : "polite");
    element<HTMLElement>("rom-status").textContent = selecting ? "Checking selected file…" : rom ? `${rom.name} · verified` : "No ROM selected.";
    element<HTMLElement>("input-status").textContent = `${session?.pendingInput ?? 0} keyboard characters queued`;
    if (execution.error !== undefined) message.textContent = execution.error;
    if (session === undefined) return;
    const now = performance.now();
    if (execution.running && now >= nextFlash) { flash = !flash; nextFlash = now + 500; }
    const { ram, video, cpu, keyboard: latch } = session.machine;
    const frame = apple2TextFrame(ram, video, flash);
    frame.forEach((row, y) => row.forEach((cell, x) => {
      const span = cells[y]![x]!;
      if (span.textContent !== cell.character) span.textContent = cell.character;
      span.classList.toggle("inverse", cell.inverse);
    }));
    const display = video.snapshot();
    element<HTMLElement>("display-status").textContent = display.text
      ? `Text · page ${display.page2 ? 2 : 1}`
      : `${display.hires ? "High" : "Low"}-resolution graphics not yet rendered${display.mixed ? " · bottom four text rows shown" : ""}`;
    if (inspect.closest("details")!.open) {
      const state = cpu.snapshot(), key = latch.snapshot();
      inspect.textContent = `PC ${hex(state.pc)}   SP ${hex(state.sp, 2)}   A ${hex(state.a, 2)}   X ${hex(state.x, 2)}   Y ${hex(state.y, 2)}\nKeyboard ${hex(key.key, 2)} · strobe ${key.strobe ? "set" : "clear"}`;
      trace.textContent = execution.records.map(record => `${hex(record.before.pc)} → ${hex(record.after.pc)}  ${record.outcome}`).join("\n");
    }
  }
  function action(perform: () => void): void {
    try { perform(); }
    catch (cause) { message.textContent = cause instanceof Error ? cause.message : String(cause); }
  }
  function send(bytes: readonly number[]): void {
    if (keyboard.disabled) return;
    session!.send(bytes);
    message.textContent = execution.running ? "" : "Input queued. Run resumes the machine.";
    refresh();
  }
  const sendText = (text: string) => action(() => send(apple2Input(text)));
  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    if (chosen === undefined) return;
    const token = ++selection;
    execution.stop(); selecting = true; message.textContent = ""; refresh();
    try {
      const verified = await readRomFile(chosen, romImages.firmware, container);
      if (token !== selection) return;
      const fresh = createApple2Session(verified.image);
      execution.reset(); session = fresh; rom = verified; flash = false; nextFlash = 0;
      keyboard.value = "";
      message.textContent = "ROM loaded. Run boots Applesoft; wait for the ] prompt.";
    } catch (cause) {
      if (token === selection) message.textContent = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (token === selection) { selecting = false; file.value = ""; refresh(); }
    }
  });
  run.addEventListener("click", () => { message.textContent = ""; nextFlash = performance.now() + 500; execution.run(); keyboard.focus(); });
  pause.addEventListener("click", () => execution.stop());
  step.addEventListener("click", () => execution.step());
  reset.addEventListener("click", () => action(() => {
    execution.reset(); session!.reset();
    message.textContent = "CPU reset. RAM, keyboard latch, and display switches are preserved; Run continues through the reset firmware.";
    refresh();
  }));
  power.addEventListener("click", () => action(() => {
    execution.reset(); session!.powerOn(); flash = false; nextFlash = 0; keyboard.value = "";
    message.textContent = "Fresh power-on. The previous program is gone; Run boots Applesoft again.";
    refresh();
  }));
  enter.addEventListener("click", () => { action(() => send([13])); keyboard.focus(); });
  interrupt.addEventListener("click", () => { action(() => send([3])); keyboard.focus(); });
  keyboard.addEventListener("keydown", event => {
    const byte = apple2ControlKey(event);
    if (byte !== undefined) { event.preventDefault(); action(() => send([byte])); }
  });
  keyboard.addEventListener("beforeinput", event => {
    if (event.isComposing) return;
    if (event.inputType === "deleteContentBackward") { event.preventDefault(); action(() => send([8])); }
    else if (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") { event.preventDefault(); action(() => send([13])); }
    else if (event.inputType === "insertText" && event.data !== null) { event.preventDefault(); sendText(event.data); }
  });
  keyboard.addEventListener("input", event => { if (!event.isComposing) { sendText(keyboard.value); keyboard.value = ""; } });
  keyboard.addEventListener("paste", event => { event.preventDefault(); sendText(event.clipboardData?.getData("text/plain") ?? ""); });
  inspect.closest("details")!.addEventListener("toggle", refresh);
  function suspend(): void { selection++; selecting = false; file.value = ""; execution.stop(); }
  document.addEventListener("visibilitychange", () => { if (document.hidden) suspend(); });
  window.addEventListener("pagehide", suspend);
  file.disabled = false;
  refresh();
}

for (const root of document.querySelectorAll<HTMLElement>("[data-apple2]")) mountApple2(root);
