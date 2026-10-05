import { editApple2Register } from "./apple2-register-edit.js";
import { romImages } from "../../src/machines/generated/6502/apple2.js";
import { createExecutionController } from "./execution-controller.js";
import { createApple2Session, apple2ControlKey, apple2ScreenKey, apple2Input } from "./apple2-session.js";
import { createApple2Screen } from "./apple2-screen-view.js";
import { readApple2Disk } from "./apple2-media.js";
import type { Apple2RomFile, Apple2DiskFile } from "./apple2-media.js";
import { apple2RomStorage } from "./apple2-rom-storage.js";
import { createApple2Inspection } from "./apple2-inspection-view.js";
import { createApple2ChangeLogView } from "./apple2-change-log-view.js";
import { createApple2Explorer } from "./apple2-explorer-view.js";
import { createPanelUpdates } from "./panel-updates.js";

/** File controls, host scheduling, and screen presentation around the generated machine. */
export function mountApple2(root: HTMLElement, showPanel: (id: string) => void = () => {}) {
  const element = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`)!;
  const file = element<HTMLInputElement>("rom-file");
  const keyboard = root.querySelector<HTMLTextAreaElement>("[data-apple2-keyboard]");
  const inputStatus = root.querySelector<HTMLElement>("[data-input-status]");
  const diskFile = element<HTMLInputElement>("disk-file"), eject = element<HTMLButtonElement>("disk-eject");
  const loadRom = element<HTMLButtonElement>("rom-load"), loadDisk = element<HTMLButtonElement>("disk-load");
  const screen = element<HTMLElement>("apple2-screen"), message = element<HTMLElement>("machine-message");
  const run = element<HTMLButtonElement>("machine-run"), pause = element<HTMLButtonElement>("machine-pause");
  const step = element<HTMLButtonElement>("machine-step"), reset = element<HTMLButtonElement>("machine-reset");
  const power = element<HTMLButtonElement>("machine-power");
  const enter = root.querySelector<HTMLButtonElement>("[data-keyboard-enter]");
  const interrupt = root.querySelector<HTMLButtonElement>("[data-keyboard-break]");
  const status = element<HTMLElement>("machine-status");
  const forgetRom = element<HTMLButtonElement>("rom-forget");
  const storageStatus = element<HTMLElement>("rom-storage-status");
  const media = {
    bytes: Number(root.dataset.romBytes), offset: Number(root.dataset.romOffset), sha256: root.dataset.romSha256!,
    bootstrap: { bytes: Number(root.dataset.bootstrapBytes), offset: Number(root.dataset.bootstrapOffset), sha256: root.dataset.bootstrapSha256! },
    disk: { bytes: Number(root.dataset.diskBytes), sha256: root.dataset.diskSha256! },
  };
  const romStorage = apple2RomStorage(() => window.localStorage, romImages.firmware, media);
  let session = createApple2Session(), rom: Apple2RomFile | undefined, disk: Apple2DiskFile | undefined;
  let selecting = false, selection = 0, flash = false, nextFlash = 0, restoring = false;
  const renderScreen = createApple2Screen(screen, element<HTMLInputElement>("apple2-scanlines"));
  const monochrome = element<HTMLInputElement>("apple2-monochrome");
  monochrome.disabled = false;
  monochrome.addEventListener("change", refresh);
  let requestedPanels: readonly string[] = [];
  const updates = createPanelUpdates(root, id => refreshPanels([id]));
  const shouldUpdate = (id: string) => requestedPanels.includes(id) || updates.shouldUpdate(id, execution.running);
  const inspection = createApple2Inspection(root, shouldUpdate, () => refreshPanels(["rom", "code"]), (register, text) => {
    if (execution.running || selecting) throw new Error("Pause execution before editing a register.");
    editApple2Register(session.machine, register, text);
    explorer.cancel(); execution.reset(); changeLog?.reset();
    message.textContent = `${register.toUpperCase()} edited. Execution history cleared; RAM and devices preserved.`;
    refresh();
  }, showPanel);
  const changeLog = createApple2ChangeLogView(root, () => session.machine);
  const inputTarget = keyboard ?? screen;
  const execution = createExecutionController({
    step: () => {
      const romMapped = !session.machine.language.ramRead();
      const record = changeLog ? changeLog.capture(() => session.step()) : session.step();
      if (record.outcome !== "executed") throw new Error(`Processor stopped: ${record.outcome}.`);
      inspection.observe(session.machine, changeLog?.memoryChanges(record) ?? []);
      return { record, romMapped };
    },
    canStep: () => session.hasFirmware && !selecting,
    pauseBeforeStep: () => explorer.pauseBeforeStep(),
    schedule(callback, delay) { const id = window.setTimeout(callback, delay); return () => window.clearTimeout(id); },
    onChange: refresh, batchSize: 10000,
  });
  const explorer = createApple2Explorer(root, () => session.machine, () => { message.textContent = ""; execution.run(); }, shouldUpdate, {
    memoryAddress: () => inspection.memoryAddress, browseMemory: address => inspection.browseMemory(address), showPanel,
  });
  root.querySelector<HTMLElement>("[data-rom-explorer]")?.addEventListener("toggle", refresh);
  execution.setDelay(1);

  function refresh(): void {
    const available = session.hasFirmware && !selecting;
    run.disabled = !available || execution.running || execution.error !== undefined;
    pause.disabled = !execution.running;
    step.disabled = !available || execution.running || execution.error !== undefined;
    reset.disabled = !available;
    power.disabled = selecting;
    for (const control of [keyboard, enter, interrupt]) if (control) control.disabled = !available;
    loadRom.disabled = file.disabled = forgetRom.disabled = selecting;
    loadDisk.disabled = diskFile.disabled = selecting || rom?.bootstrap === undefined;
    loadRom.textContent = rom ? "Replace ROM…" : "Load ROM…";
    loadDisk.textContent = disk ? "Replace disk…" : "Load disk…";
    eject.disabled = !available || disk === undefined;
    status.textContent = `${!session.hasFirmware ? "Hardware ready · no ROM installed" : execution.running ? "Running" : "Paused"} · ${execution.steps.toLocaleString()} instructions`;
    status.setAttribute("aria-live", execution.running ? "off" : "polite");
    element<HTMLElement>("rom-status").textContent = rom ? `Loaded: ${rom.name} · verified`
      : restoring ? "Checking saved ROM…" : "No ROM loaded.";
    element<HTMLElement>("disk-status").textContent = disk ? `Loaded: ${disk.name} · drive 1 · write protected`
      : rom?.bootstrap ? "No disk loaded. Fresh power-on boots Applesoft." : "Disk boot needs the 20 KiB ROM container, which includes the Disk II bootstrap.";
    if (inputStatus) inputStatus.textContent = `${session.pendingInput} keyboard characters queued`;
    if (execution.error !== undefined) explorer.cancel();
    if (execution.error !== undefined) message.textContent = execution.error;
    const latest = execution.error === undefined ? execution.records.at(-1)?.record : undefined;
    inspection.refresh(session.machine, latest, changeLog?.memoryChanges(latest), !execution.running && !selecting);
    explorer.refresh(execution.records, available && execution.error === undefined, execution.running);
    if (shouldUpdate("log")) changeLog?.refresh();
    const now = performance.now();
    if (execution.running && now >= nextFlash) { flash = !flash; nextFlash = now + 500; }
    const { ram, video } = session.machine;
    renderScreen(ram, video, flash, monochrome.checked);
    const display = video.snapshot();
    const mode = display.text ? "Text" : display.hires ? "High-resolution graphics" : "Low-resolution graphics";
    element<HTMLElement>("display-status").textContent = `${mode} · page ${display.page2 ? 2 : 1}${!display.text && display.mixed ? " · bottom four text rows shown" : ""}`
      + (session.hasFirmware ? "" : " · initial RAM: 00 = inverse @");
  }
  function refreshPanels(ids: readonly string[]): void {
    requestedPanels = ids;
    try { refresh(); } finally { requestedPanels = []; }
  }
  function action(perform: () => void): void {
    try { perform(); }
    catch (cause) { message.textContent = cause instanceof Error ? cause.message : String(cause); }
  }
  function send(bytes: readonly number[]): void {
    if (!session.hasFirmware || selecting) return;
    session.send(bytes);
    message.textContent = execution.running ? "" : "Input queued. Run resumes the machine.";
    refresh();
  }
  const sendText = (text: string) => action(() => send(apple2Input(text)));
  async function choose<T>(input: HTMLInputElement, verify: (file: File) => Promise<T>, apply: (verified: T) => void): Promise<void> {
    const chosen = input.files?.[0];
    if (chosen === undefined) return;
    const token = ++selection;
    explorer.cancel(); execution.stop(); selecting = true; message.textContent = `Checking ${chosen.name}…`; refresh();
    try {
      const verified = await verify(chosen);
      if (token !== selection) return;
      apply(verified);
      execution.reset(); changeLog?.reset(); flash = false; nextFlash = 0;
      if (keyboard) keyboard.value = "";
    } catch (cause) {
      if (token === selection) message.textContent = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (token === selection) { selecting = false; input.value = ""; refresh(); }
    }
  }
  function installRom(verified: Apple2RomFile): void {
    const fresh = rom === undefined ? session : createApple2Session();
    fresh.installFirmware(verified.image);
    fresh.reset();
    session = fresh; rom = verified; disk = undefined;
    message.textContent = "ROM loaded. Run boots Applesoft, or select a disk to boot DOS.";
  }
  loadRom.addEventListener("click", () => file.click());
  loadDisk.addEventListener("click", () => diskFile.click());
  file.addEventListener("change", () => void choose(file, chosen => romStorage.prepare(chosen), ({ rom, stored }) => {
    installRom(rom);
    try {
      romStorage.remember(stored);
      storageStatus.textContent = "ROM remembered in this browser for the classroom and laboratory.";
    } catch {
      storageStatus.textContent = "ROM loaded for this session, but the browser could not remember it.";
    }
  }));
  forgetRom.addEventListener("click", () => {
    try {
      romStorage.forget();
      storageStatus.textContent = "Saved ROM forgotten. Any ROM already loaded stays available until you leave the page.";
    } catch {
      storageStatus.textContent = "The browser could not remove the saved ROM. You can clear it through this site's browser storage settings.";
    }
  });
  diskFile.addEventListener("change", () => void choose(diskFile, chosen => readApple2Disk(chosen, media.disk), verified => {
    const fresh = createApple2Session(rom!.image, { bootstrap: rom!.bootstrap!, image: verified.disk });
    session = fresh; disk = verified;
    message.textContent = "Disk loaded in a fresh machine. Run boots DOS 3.3; wait for the ] prompt after Integer BASIC loads.";
  }));
  eject.addEventListener("click", () => action(() => {
    explorer.cancel(); execution.stop(); session.eject(); disk = undefined;
    message.textContent = "Disk ejected. RAM is preserved; Fresh power-on returns to ROM-only Applesoft.";
    refresh();
  }));
  run.addEventListener("click", () => { explorer.cancel(); message.textContent = ""; nextFlash = performance.now() + 500; execution.run(); inputTarget.focus(); });
  pause.addEventListener("click", () => { explorer.cancel(); execution.stop(); });
  step.addEventListener("click", () => { explorer.cancel(); execution.step(); });
  reset.addEventListener("click", () => action(() => {
    explorer.cancel(); execution.reset(); session.reset(); changeLog?.reset();
    message.textContent = "CPU reset. RAM and device state are preserved; Run continues through the reset firmware.";
    refresh();
  }));
  power.addEventListener("click", () => action(() => {
    explorer.cancel(); execution.reset(); session.powerOn(); changeLog?.reset(); flash = false; nextFlash = 0;
    if (keyboard) keyboard.value = "";
    message.textContent = session.hasFirmware
      ? `Fresh power-on. The previous program is gone; Run boots ${disk ? "DOS 3.3 from the retained disk" : "Applesoft"} again.`
      : "Fresh hardware. RAM is zeroed; install a ROM to boot.";
    refresh();
  }));
  enter?.addEventListener("click", () => { action(() => send([13])); inputTarget.focus(); });
  interrupt?.addEventListener("click", () => { action(() => send([3])); inputTarget.focus(); });
  keyboard?.addEventListener("keydown", event => {
    const byte = apple2ControlKey(event);
    if (byte !== undefined) { event.preventDefault(); action(() => send([byte])); }
  });
  keyboard?.addEventListener("beforeinput", event => {
    if (event.isComposing) return;
    if (event.inputType === "deleteContentBackward") { event.preventDefault(); action(() => send([8])); }
    else if (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") { event.preventDefault(); action(() => send([13])); }
    else if (event.inputType === "insertText" && event.data !== null) { event.preventDefault(); sendText(event.data); }
  });
  keyboard?.addEventListener("input", event => { if (!event.isComposing) { sendText(keyboard.value); keyboard.value = ""; } });
  keyboard?.addEventListener("paste", event => { event.preventDefault(); sendText(event.clipboardData?.getData("text/plain") ?? ""); });
  screen.addEventListener("keydown", event => {
    const byte = apple2ScreenKey(event);
    if (byte !== undefined) { event.preventDefault(); action(() => send([byte])); }
  });
  screen.addEventListener("paste", event => { event.preventDefault(); sendText(event.clipboardData?.getData("text/plain") ?? ""); });
  function suspend(): void {
    // A saved ROM may finish restoring in a hidden tab, but never starts execution.
    if (!restoring) { selection++; selecting = false; file.value = diskFile.value = ""; }
    explorer.cancel(); execution.stop();
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) suspend(); });
  window.addEventListener("pagehide", suspend);
  async function restoreRom(): Promise<void> {
    restoring = selecting = true; refresh();
    try {
      const saved = await romStorage.restore();
      if (saved !== undefined) {
        installRom(saved);
        execution.reset(); changeLog?.reset();
        storageStatus.textContent = "Remembered ROM restored and verified. Run starts a fresh machine.";
      } else {
        storageStatus.textContent = "Your ROM will be remembered in this browser. RAM and disks are not saved.";
      }
    } catch {
      storageStatus.textContent = "The saved ROM could not be restored. Choose a ROM file to continue, or forget the saved copy.";
    } finally {
      restoring = selecting = false; refresh();
    }
  }
  void restoreRom();
  return {
    refreshPanels,
    controls(id: string): HTMLElement | undefined {
      const format = inspection.controls(id) ?? explorer.controls(id), live = updates.controls(id);
      if (!format) return live;
      const controls = document.createElement("span"); controls.className = "lab-inspector-controls";
      controls.append(format);
      if (live) controls.append(live);
      return controls;
    },
  };
}
