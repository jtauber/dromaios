import { romImages } from "../../src/machines/generated/6502/apple2.js";
import { createExecutionController } from "./execution-controller.js";
import { createApple2Session, apple2ControlKey, apple2Input } from "./apple2-session.js";
import { createApple2Screen } from "./apple2-screen-view.js";
import { readApple2Rom, readApple2Disk } from "./apple2-media.js";
import type { Apple2RomFile, Apple2DiskFile } from "./apple2-media.js";
import { createApple2Explorer } from "./apple2-explorer-view.js";

/** File controls, host scheduling, and screen presentation around the generated machine. */
export function mountApple2(root: HTMLElement): void {
  const element = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`)!;
  const file = element<HTMLInputElement>("rom-file"), keyboard = element<HTMLTextAreaElement>("apple2-keyboard");
  const diskFile = element<HTMLInputElement>("disk-file"), eject = element<HTMLButtonElement>("disk-eject");
  const screen = element<HTMLElement>("apple2-screen"), message = element<HTMLElement>("machine-message");
  const run = element<HTMLButtonElement>("machine-run"), pause = element<HTMLButtonElement>("machine-pause");
  const step = element<HTMLButtonElement>("machine-step"), reset = element<HTMLButtonElement>("machine-reset");
  const power = element<HTMLButtonElement>("machine-power"), enter = element<HTMLButtonElement>("keyboard-enter");
  const interrupt = element<HTMLButtonElement>("keyboard-break"), inspect = element<HTMLElement>("machine-inspect");
  const status = element<HTMLElement>("machine-status");
  const media = {
    bytes: Number(root.dataset.romBytes), offset: Number(root.dataset.romOffset), sha256: root.dataset.romSha256!,
    bootstrap: { bytes: Number(root.dataset.bootstrapBytes), offset: Number(root.dataset.bootstrapOffset), sha256: root.dataset.bootstrapSha256! },
    disk: { bytes: Number(root.dataset.diskBytes), sha256: root.dataset.diskSha256! },
  };
  let session: ReturnType<typeof createApple2Session> | undefined, rom: Apple2RomFile | undefined, disk: Apple2DiskFile | undefined;
  let selecting = false, selection = 0, flash = false, nextFlash = 0;
  const renderScreen = createApple2Screen(screen);
  const execution = createExecutionController({
    step: () => {
      const romMapped = !session!.machine.language.ramRead();
      const record = session!.step();
      if (record.outcome !== "executed") throw new Error(`Processor stopped: ${record.outcome}.`);
      return { record, romMapped };
    },
    canStep: () => session !== undefined && !selecting,
    pauseBeforeStep: () => explorer.pauseBeforeStep(),
    schedule(callback, delay) { const id = window.setTimeout(callback, delay); return () => window.clearTimeout(id); },
    onChange: refresh, batchSize: 10000,
  });
  const explorer = createApple2Explorer(root, () => session?.machine, () => { message.textContent = ""; execution.run(); });
  execution.setDelay(1);
  const hex = (value: number, width = 4) => value.toString(16).toUpperCase().padStart(width, "0");

  function refresh(): void {
    const available = session !== undefined && !selecting;
    run.disabled = !available || execution.running || execution.error !== undefined;
    pause.disabled = !execution.running;
    step.disabled = !available || execution.running || execution.error !== undefined;
    reset.disabled = power.disabled = !available;
    keyboard.disabled = enter.disabled = interrupt.disabled = !available;
    file.disabled = selecting;
    diskFile.disabled = selecting || rom?.bootstrap === undefined;
    eject.disabled = !available || disk === undefined;
    status.textContent = `${session === undefined ? "No ROM loaded" : execution.running ? "Running" : "Paused"} · ${execution.steps.toLocaleString()} instructions`;
    status.setAttribute("aria-live", execution.running ? "off" : "polite");
    element<HTMLElement>("rom-status").textContent = selecting ? "Checking selected file…" : rom ? `${rom.name} · verified` : "No ROM selected.";
    element<HTMLElement>("disk-status").textContent = disk ? `${disk.name} · drive 1 · write protected`
      : rom?.bootstrap ? "No disk selected. Fresh power-on boots Applesoft." : "Disk boot needs the 20 KiB ROM container, which includes the Disk II bootstrap.";
    element<HTMLElement>("input-status").textContent = `${session?.pendingInput ?? 0} keyboard characters queued`;
    if (execution.error !== undefined) explorer.cancel();
    explorer.refresh(execution.records, available && execution.error === undefined, execution.running);
    if (execution.error !== undefined) message.textContent = execution.error;
    if (session === undefined) return;
    const now = performance.now();
    if (execution.running && now >= nextFlash) { flash = !flash; nextFlash = now + 500; }
    const { ram, video, cpu, keyboard: latch } = session.machine;
    renderScreen(ram, video, flash);
    const display = video.snapshot();
    const mode = display.text ? "Text" : display.hires ? "High-resolution graphics" : "Low-resolution graphics";
    element<HTMLElement>("display-status").textContent = `${mode} · page ${display.page2 ? 2 : 1}${!display.text && display.mixed ? " · bottom four text rows shown" : ""}`;
    if (inspect.closest("details")!.open) {
      const state = cpu.snapshot(), key = latch.snapshot(), drive = session.machine.disk.inspect();
      const flags = (["n", "v", "d", "i", "z", "c"] as const).map(flag => `${flag.toUpperCase()}=${+state.flags[flag]}`).join(" ");
      inspect.textContent = `PC ${hex(state.pc)}   SP ${hex(state.sp, 2)}   A ${hex(state.a, 2)}   X ${hex(state.x, 2)}   Y ${hex(state.y, 2)}\n${flags}\nKeyboard ${hex(key.key, 2)} · strobe ${key.strobe ? "set" : "clear"}\nDisk II ${drive.installed ? `drive ${drive.drive} · motor ${drive.motor ? "on" : "off"} · track ${drive.halfTrack / 2} · byte ${drive.position}` : "absent"}`;
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
  async function choose<T>(input: HTMLInputElement, verify: (file: File) => Promise<T>, apply: (verified: T) => void): Promise<void> {
    const chosen = input.files?.[0];
    if (chosen === undefined) return;
    const token = ++selection;
    explorer.cancel(); execution.stop(); selecting = true; message.textContent = ""; refresh();
    try {
      const verified = await verify(chosen);
      if (token !== selection) return;
      apply(verified);
      execution.reset(); flash = false; nextFlash = 0; keyboard.value = "";
    } catch (cause) {
      if (token === selection) message.textContent = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (token === selection) { selecting = false; input.value = ""; refresh(); }
    }
  }
  file.addEventListener("change", () => void choose(file, chosen => readApple2Rom(chosen, romImages.firmware, media), verified => {
    const fresh = createApple2Session(verified.image);
    session = fresh; rom = verified; disk = undefined;
    message.textContent = "ROM loaded. Run boots Applesoft, or select a disk to boot DOS.";
  }));
  diskFile.addEventListener("change", () => void choose(diskFile, chosen => readApple2Disk(chosen, media.disk), verified => {
    const fresh = createApple2Session(rom!.image, { bootstrap: rom!.bootstrap!, image: verified.disk });
    session = fresh; disk = verified;
    message.textContent = "Disk loaded in a fresh machine. Run boots DOS 3.3; wait for the ] prompt after Integer BASIC loads.";
  }));
  eject.addEventListener("click", () => action(() => {
    explorer.cancel(); execution.stop(); session!.eject(); disk = undefined;
    message.textContent = "Disk ejected. RAM is preserved; Fresh power-on returns to ROM-only Applesoft.";
    refresh();
  }));
  run.addEventListener("click", () => { explorer.cancel(); message.textContent = ""; nextFlash = performance.now() + 500; execution.run(); keyboard.focus(); });
  pause.addEventListener("click", () => { explorer.cancel(); execution.stop(); });
  step.addEventListener("click", () => { explorer.cancel(); execution.step(); });
  reset.addEventListener("click", () => action(() => {
    explorer.cancel(); execution.reset(); session!.reset();
    message.textContent = "CPU reset. RAM and device state are preserved; Run continues through the reset firmware.";
    refresh();
  }));
  power.addEventListener("click", () => action(() => {
    explorer.cancel(); execution.reset(); session!.powerOn(); flash = false; nextFlash = 0; keyboard.value = "";
    message.textContent = `Fresh power-on. The previous program is gone; Run boots ${disk ? "DOS 3.3 from the retained disk" : "Applesoft"} again.`;
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
  function suspend(): void { selection++; selecting = false; file.value = diskFile.value = ""; explorer.cancel(); execution.stop(); }
  document.addEventListener("visibilitychange", () => { if (document.hidden) suspend(); });
  window.addEventListener("pagehide", suspend);
  file.disabled = false;
  refresh();
}

for (const root of document.querySelectorAll<HTMLElement>("[data-apple2]")) mountApple2(root);
