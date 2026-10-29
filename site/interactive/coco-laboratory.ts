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
import { createExecutionTarget } from "./execution-target.js";
import { createPanelUpdates } from "./panel-updates.js";
import { createWorkspace } from "./workspace/dock.js";
import { mountWorkspaceControls } from "./workspace/controls.js";
import { cocoDefaultLayout, cocoWorkspaceKey, migrateCocoWorkspace } from "./coco-workspace.js";

for (const root of document.querySelectorAll<HTMLElement>("[data-coco-laboratory]")) mountCoco(root);

function mountCoco(root: HTMLElement): void {
  const at = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`)!;
  const screen = at<HTMLElement>("coco-screen"), message = at("machine-message");
  const run = at<HTMLButtonElement>("machine-run"), pause = at<HTMLButtonElement>("machine-pause");
  const step = at<HTMLButtonElement>("machine-step"), reset = at<HTMLButtonElement>("machine-reset"), power = at<HTMLButtonElement>("machine-power");
  const targetForm = at<HTMLFormElement>("run-target"), targetInput = at<HTMLInputElement>("run-target-address");
  const targetButton = at<HTMLButtonElement>("run-target-button"), target = createExecutionTarget();
  const removeExtended = at<HTMLButtonElement>("extended-rom-remove");
  const save = at<HTMLButtonElement>("snapshot-save"), restore = at<HTMLButtonElement>("snapshot-restore");
  const forgetState = at<HTMLButtonElement>("snapshot-forget");
  type RomSlot = keyof typeof romImages;
  const roms: Record<RomSlot, RomFile | undefined> = { firmware: undefined, extended: undefined };
  const slots = ([
    { id: "firmware", prefix: "rom", label: "Color BASIC 1.3", key: "dromaios:coco-rom:v1" },
    { id: "extended", prefix: "extended-rom", label: "Extended Color BASIC 1.1", key: "dromaios:coco-extended-rom:v1" },
  ] as const).map(slot => ({ ...slot,
    file: at<HTMLInputElement>(`${slot.prefix}-file`), load: at<HTMLButtonElement>(`${slot.prefix}-load`),
    forget: at<HTMLButtonElement>(`${slot.prefix}-forget`), status: at(`${slot.prefix}-status`),
    storageStatus: at(`${slot.prefix}-storage-status`),
    storage: romFileStorage(() => localStorage, slot.key, romImages[slot.id].size,
      file => readRomFile(file, romImages[slot.id])),
  }));
  const saved = cocoSavedState(() => localStorage);
  let session = createCocoSession(), selecting = true, hasSaved = false;
  let requested: readonly string[] = [];
  const panels = [...root.querySelectorAll<HTMLElement>("[data-workspace-panel]")];
  const updates = createPanelUpdates(root, id => refreshPanels([id]), "dromaios:inspectors:coco:live");
  const catalogue: Catalogue6809 = JSON.parse(at("coco-instructions").textContent!);
  const inspectors = createCocoInspectors(root, () => code.memoryMoved(), browse), display = createCocoScreen(root);
  function browse(address: number): void { inspectors.memory.browse(address); workspace.show("memory"); }
  const code = create6809CodeView(at("coco-code"), catalogue, { address: () => inspectors.memory.address, browse });
  const instruction = create6809InstructionView(at("coco-instruction"), browse);
  const execution = createExecutionController({
    step: () => session.step(), canStep: () => session.hasFirmware && !selecting,
    pauseBeforeStep: (): boolean => target.address !== undefined && target.beforeStep(session.machine.cpu.snapshot().pc, execution.steps)
      || execution.records.at(-1)?.outcome === "waiting" && !session.machine.pias.irq && !session.machine.pias.firq,
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
    targetButton.disabled = targetInput.disabled = !ready || running || execution.error !== undefined;
    for (const slot of slots) {
      slot.load.disabled = slot.forget.disabled = selecting;
      const rom = roms[slot.id];
      slot.status.textContent = rom ? `${rom.name} · verified ${slot.label}`
        : slot.id === "firmware" ? "No Color BASIC ROM loaded · RAM and devices are available" : "No extension loaded · Color BASIC only";
    }
    removeExtended.disabled = selecting || running || roms.extended === undefined;
    save.disabled = !ready || running; restore.disabled = !ready || running || !hasSaved;
    forgetState.disabled = selecting || !hasSaved;
    at("machine-status").textContent = `${running ? "Running" : ready ? "Paused" : "Ready for ROM"} · ${execution.steps.toLocaleString()} steps`
      + (session.pendingInput ? ` · ${session.pendingInput} keys queued` : "");
    at("machine-error").textContent = execution.error ?? "";
    if (!running && !target.stopped) target.cancel();
    at("run-target-status").textContent = target.address === undefined ? "" : target.stopped === "reached"
      ? `Paused before the boundary at $${cocoHex(target.address)}.` : target.stopped === "limit"
      ? `Stopped after 2,000,000 boundaries; $${cocoHex(target.address)} was not reached.` : `Running to $${cocoHex(target.address)}…`;
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
  function changedMachine(): void { execution.reset(); target.cancel(); inspectors.reset(); }
  function installRom(id: RomSlot, verified: RomFile): void {
    const firmware = id === "firmware" ? verified : roms.firmware;
    const extended = id === "extended" ? verified : roms.extended;
    if (id === "firmware" && !session.hasFirmware) { session.installFirmware(verified.image); session.reset(); }
    else session = createCocoSession(firmware?.image ?? null, extended?.image ?? null);
    roms[id] = verified; changedMachine();
    message.textContent = session.hasFirmware ? "ROM loaded. Run boots BASIC; click the screen to type."
      : "Extension loaded. Load Color BASIC 1.3 to boot.";
  }
  for (const slot of slots) {
    slot.load.addEventListener("click", () => slot.file.click());
    slot.file.addEventListener("change", () => { void (async () => {
      const chosen = slot.file.files?.[0]; if (!chosen) return;
      execution.stop(); selecting = true; message.textContent = `Checking ${chosen.name}…`; refresh();
      try {
        const prepared = await slot.storage.prepare(chosen); installRom(slot.id, prepared.rom);
        try { slot.storage.remember(prepared.stored); slot.storageStatus.textContent = "ROM remembered on this device. Files are never uploaded."; }
        catch { slot.storageStatus.textContent = "ROM loaded, but this browser could not remember it."; }
      } catch (cause) { message.textContent = cause instanceof Error ? cause.message : String(cause); }
      finally { selecting = false; slot.file.value = ""; refreshPanels(panels.map(panel => panel.dataset.workspacePanel!)); }
    })(); });
    slot.forget.addEventListener("click", () => action(() => {
      slot.storage.forget(); slot.storageStatus.textContent = "Remembered ROM removed. The current machine keeps its loaded ROM.";
    }));
  }
  removeExtended.addEventListener("click", () => action(() => {
    // Forget first: if storage rejects removal, keep the current configuration intact.
    const slot = slots.find(slot => slot.id === "extended")!;
    slot.storage.forget(); session = createCocoSession(roms.firmware?.image ?? null); roms.extended = undefined;
    slot.storageStatus.textContent = "Extension removed and forgotten. Fresh hardware is ready for Color BASIC.";
    changedMachine();
  }));
  run.addEventListener("click", () => { target.cancel(); message.textContent = ""; execution.run(); screen.focus(); });
  pause.addEventListener("click", () => { target.cancel(); execution.stop(); });
  step.addEventListener("click", () => { target.cancel(); message.textContent = ""; execution.step(); });
  targetForm.addEventListener("submit", event => {
    event.preventDefault(); if (targetButton.disabled) return;
    const text = targetInput.value.trim().replace(/^\$|^0x/i, "");
    if (!/^[0-9a-f]{1,4}$/i.test(text)) {
      targetInput.setCustomValidity("Enter a hexadecimal address from 0000 to FFFF."); targetInput.reportValidity(); return;
    }
    target.start(parseInt(text, 16), execution.steps); message.textContent = ""; execution.run();
  });
  targetInput.addEventListener("input", () => targetInput.setCustomValidity(""));
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
    target.cancel(); execution.stop(); session.releaseInput();
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
    await Promise.all(slots.map(async slot => {
      try {
        roms[slot.id] = await slot.storage.restore();
        if (roms[slot.id]) slot.storageStatus.textContent = "Remembered ROM verified. Paused and ready.";
      } catch { slot.storageStatus.textContent = `The remembered ROM could not be restored. Choose your local ${slot.label} file.`; }
    }));
    session = createCocoSession(roms.firmware?.image ?? null, roms.extended?.image ?? null); changedMachine();
    selecting = false; refreshPanels(panels.map(panel => panel.dataset.workspacePanel!));
  })();
}
