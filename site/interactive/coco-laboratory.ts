import { romImages } from "../../src/machines/generated/6809/coco.js";
import { createCocoSession } from "./coco-session.js";
import { cocoScreenKey, cocoTextInput } from "./coco-input.js";
import { cocoHex, readCocoStorage } from "./coco-inspection.js";
import type { Catalogue6809 } from "./6809-catalogue.js";
import { create6809CodeView } from "./6809-code-view.js";
import { create6809InstructionView } from "./6809-instruction-view.js";
import { previewCocoInstruction } from "./coco-instruction-preview.js";
import { createCocoScreen } from "./coco-screen-view.js";
import { createCocoInspectors } from "./coco-inspector-view.js";
import { cocoSavedState } from "./coco-saved-state.js";
import { readRomFile } from "./rom-file.js";
import type { RomFile } from "./rom-file.js";
import { romFileStorage } from "./rom-storage.js";
import { createExecutionController } from "./execution-controller.js";
import { createPanelUpdates } from "./panel-updates.js";
import { createWorkspace } from "./workspace/dock.js";
import { mountWorkspaceControls } from "./workspace/controls.js";
import { cocoDefaultLayout, cocoWorkspaceKey, migrateCocoWorkspace } from "./coco-workspace.js";

for (const root of document.querySelectorAll<HTMLElement>("[data-coco-laboratory]")) mountCoco(root);

function mountCoco(root: HTMLElement): void {
  const at = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`)!;
  const file = at<HTMLInputElement>("rom-file"), screen = at<HTMLElement>("coco-screen");
  const message = at("machine-message"), storageStatus = at("rom-storage-status");
  const run = at<HTMLButtonElement>("machine-run"), pause = at<HTMLButtonElement>("machine-pause");
  const step = at<HTMLButtonElement>("machine-step"), reset = at<HTMLButtonElement>("machine-reset"), power = at<HTMLButtonElement>("machine-power");
  const load = at<HTMLButtonElement>("rom-load"), forget = at<HTMLButtonElement>("rom-forget");
  const save = at<HTMLButtonElement>("snapshot-save"), restore = at<HTMLButtonElement>("snapshot-restore");
  const forgetState = at<HTMLButtonElement>("snapshot-forget");
  const romStorage = romFileStorage(() => localStorage, "dromaios:coco-rom:v1", romImages.firmware.size,
    file => readRomFile(file, romImages.firmware));
  const saved = cocoSavedState(() => localStorage);
  let session = createCocoSession(), rom: RomFile | undefined, selecting = true, hasSaved = false;
  let requested: readonly string[] = [];
  const panels = [...root.querySelectorAll<HTMLElement>("[data-workspace-panel]")];
  const updates = createPanelUpdates(root, id => refreshPanels([id]), "dromaios:inspectors:coco:live");
  const catalogue: Catalogue6809 = JSON.parse(at("coco-instructions").textContent!);
  const inspectors = createCocoInspectors(root, () => code.memoryMoved()), display = createCocoScreen(root);
  function browse(address: number): void { inspectors.memory.browse(address); workspace.show("memory"); }
  const code = create6809CodeView(at("coco-code"), catalogue, { address: () => inspectors.memory.address, browse });
  const instruction = create6809InstructionView(at("coco-instruction"), browse);
  const execution = createExecutionController({
    step: () => session.step(), canStep: () => session.hasFirmware && !selecting,
    pauseBeforeStep: (): boolean => execution.records.at(-1)?.outcome === "waiting" && !session.machine.pias.irq && !session.machine.pias.firq,
    schedule(callback, delay) { const id = window.setTimeout(callback, delay); return () => window.clearTimeout(id); },
    onChange: refresh, batchSize: 10_000,
  });
  execution.setDelay(1);

  function shouldUpdate(id: string): boolean {
    return requested.includes(id) || updates.shouldUpdate(id, execution.running)
      && panels.some(panel => panel.dataset.workspacePanel === id && panel.getClientRects().length > 0);
  }
  function refreshPanels(ids: readonly string[]): void { requested = ids; refresh(); requested = []; }
  function refresh(): void {
    const ready = session.hasFirmware && !selecting, running = execution.running;
    run.disabled = !ready || running || execution.error !== undefined;
    pause.disabled = !running; step.disabled = !ready || running || execution.error !== undefined;
    reset.disabled = !ready || running; power.disabled = selecting || running;
    load.disabled = selecting; forget.disabled = selecting;
    save.disabled = !ready || running; restore.disabled = !ready || running || !hasSaved;
    forgetState.disabled = selecting || !hasSaved;
    at("rom-status").textContent = rom ? `${rom.name} · verified Color BASIC 1.3` : "No ROM loaded · RAM and devices are available";
    at("machine-status").textContent = `${running ? "Running" : ready ? "Paused" : "Ready for ROM"} · ${execution.steps.toLocaleString()} steps`
      + (session.pendingInput ? ` · ${session.pendingInput} keys queued` : "");
    at("machine-error").textContent = execution.error ?? "";
    const record = execution.records.at(-1);
    at("last-step").textContent = record ? record.instruction
      ? `$${cocoHex(record.instruction.address)}   ${record.instruction.bytes.map(byte => cocoHex(byte, 2)).join(" ")}   ${record.outcome}`
      : `${"source" in record ? record.source.toUpperCase() + " · " : ""}${record.outcome}` : "No steps recorded";
    inspectors.refresh(session.machine, shouldUpdate);
    if (shouldUpdate("code")) code.refresh(address => readCocoStorage(session.machine, address), session.machine.cpu.snapshot().pc, execution.records);
    if (shouldUpdate("instruction")) instruction(session.machine.sam.supportedMemory()
      ? previewCocoInstruction(session.machine, catalogue) : "Unsupported SAM memory configuration.");
    if (shouldUpdate("screen")) display.refresh(session.machine);
  }
  function action(work: () => void): void {
    try { work(); message.textContent = ""; }
    catch (cause) { message.textContent = cause instanceof Error ? cause.message : String(cause); }
    refresh();
  }
  function changedMachine(): void { execution.reset(); inspectors.reset(); }
  function installRom(verified: RomFile): void {
    if (session.hasFirmware) session = createCocoSession(verified.image);
    else { session.installFirmware(verified.image); session.reset(); }
    rom = verified; changedMachine();
    message.textContent = "ROM loaded. Run boots Color BASIC; click the screen to type.";
  }
  load.addEventListener("click", () => file.click());
  file.addEventListener("change", () => { void (async () => {
    const chosen = file.files?.[0]; if (!chosen) return;
    execution.stop(); selecting = true; message.textContent = `Checking ${chosen.name}…`; refresh();
    try {
      const prepared = await romStorage.prepare(chosen); installRom(prepared.rom);
      try { romStorage.remember(prepared.stored); storageStatus.textContent = "ROM remembered on this device. Files are never uploaded."; }
      catch { storageStatus.textContent = "ROM loaded, but this browser could not remember it."; }
    } catch (cause) { message.textContent = cause instanceof Error ? cause.message : String(cause); }
    finally { selecting = false; file.value = ""; refreshPanels(panels.map(panel => panel.dataset.workspacePanel!)); }
  })(); });
  forget.addEventListener("click", () => action(() => {
    romStorage.forget(); storageStatus.textContent = "Remembered ROM removed. The current machine keeps its loaded ROM.";
  }));
  run.addEventListener("click", () => { message.textContent = ""; execution.run(); screen.focus(); });
  pause.addEventListener("click", () => execution.stop());
  step.addEventListener("click", () => { message.textContent = ""; execution.step(); });
  reset.addEventListener("click", () => action(() => { session.reset(); changedMachine(); }));
  power.addEventListener("click", () => action(() => { session.powerOn(); changedMachine(); }));
  screen.addEventListener("keydown", event => {
    try {
      const keys = cocoScreenKey(event); if (!keys) return;
      event.preventDefault();
      if (!event.repeat) session.send([keys]);
      message.textContent = execution.running ? "" : "Input queued. Run or Step advances the CoCo.";
    } catch (cause) { message.textContent = cause instanceof Error ? cause.message : String(cause); }
    if (!execution.running) refresh();
  });
  screen.addEventListener("paste", event => {
    event.preventDefault(); action(() => session.send(cocoTextInput(event.clipboardData?.getData("text/plain") ?? "")));
  });
  at<HTMLInputElement>("coco-scanlines").addEventListener("change", event => {
    screen.classList.toggle("scanlines", (event.currentTarget as HTMLInputElement).checked);
  });
  function releaseFocus(): void {
    const hadInput = session.pendingInput > 0;
    execution.stop(); session.releaseInput();
    if (hadInput) message.textContent = "Paused after focus left the window; queued keys were released.";
    refresh();
  }
  window.addEventListener("blur", releaseFocus);
  document.addEventListener("visibilitychange", () => { if (document.hidden) releaseFocus(); });
  window.addEventListener("pagehide", releaseFocus);

  function savedStatus(): void {
    try {
      const state = saved.read(); hasSaved = state !== undefined;
      at("snapshot-status").textContent = state ? `Saved ${new Date(state.savedAt).toLocaleString()}` : "No snapshot saved";
    } catch { hasSaved = true; at("snapshot-status").textContent = "Saved snapshot unavailable or invalid. Forget it to clear this entry."; }
  }
  save.addEventListener("click", () => action(() => { saved.save(session.snapshot()); savedStatus(); }));
  restore.addEventListener("click", () => action(() => {
    const state = saved.read(); if (!state) throw new Error("No saved CoCo snapshot.");
    session.restore(state.state); changedMachine();
  }));
  forgetState.addEventListener("click", () => action(() => { saved.forget(); savedStatus(); }));

  const status = document.createElement("span"); status.className = "workspace-status"; status.setAttribute("role", "status");
  const pending = new Set<string>();
  try { migrateCocoWorkspace(localStorage, panels.map(panel => panel.dataset.workspacePanel!)); }
  catch { /* Use the default arrangement if browser storage or a previous layout is unavailable. */ }
  const workspace = createWorkspace(at("workspace-root"), at("workspace-panels"), panels.map(content => {
    const id = content.dataset.workspacePanel!, controls = document.createElement("span"); controls.className = "lab-inspector-controls";
    for (const control of [inspectors.controls(id), id === "code" ? code.controls : undefined, updates.controls(id)]) if (control) controls.append(control);
    return { id, title: content.dataset.panelTitle!, heading: content.dataset.panelHeading, detail: content.dataset.panelDetail, content, controls };
  }), { defaults: cocoDefaultLayout, storageKey: cocoWorkspaceKey,
    onShow(id) {
      const scheduled = pending.size > 0; pending.add(id);
      if (!scheduled) queueMicrotask(() => { refreshPanels([...pending]); pending.clear(); });
    }, onStatus: message => { status.textContent = message; },
  });
  mountWorkspaceControls(document.getElementById("coco-layout-controls")!, workspace, status);
  savedStatus(); refreshPanels(panels.map(panel => panel.dataset.workspacePanel!));
  void (async () => {
    try {
      const remembered = await romStorage.restore();
      if (remembered) { installRom(remembered); storageStatus.textContent = "Remembered ROM verified. Paused and ready to run."; }
    } catch { storageStatus.textContent = "The remembered ROM could not be restored. Choose your local Color BASIC file."; }
    finally { selecting = false; refreshPanels(panels.map(panel => panel.dataset.workspacePanel!)); }
  })();
}
