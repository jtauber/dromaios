import { romImages } from "../../src/machines/generated/8088/pc-xt.js";
import { romImages as egaRomImages } from "../../src/machines/generated/8088/pc-xt-ega.js";
import { xtDisketteSize } from "../../src/machines/8088/pc-xt/io.js";
import { xtOscillatorHz } from "../../src/machines/8088/pc-xt/clock.js";
import { createExecutionController } from "./execution-controller.js";
import { readRomFile } from "./rom-file.js";
import { romFileStorage } from "./rom-storage.js";
import { createWorkspace } from "./workspace/dock.js";
import { mountWorkspaceControls } from "./workspace/controls.js";
import { createPanelUpdates } from "./panel-updates.js";
import { migrateXtWorkspace, xtDefaultLayout, xtWorkspaceKey } from "./xt-workspace.js";
import { createXtCodeView, createXtRegisterView } from "./xt-inspector-view.js";
import { physical8088, xtHex as hex } from "./8088-disassembly.js";
import { createMemoryInspector } from "./memory-inspector.js";
import { parseXtAddress, readXtStorage } from "./xt-inspection.js";
import type { XtCatalogue } from "./xt-inspection.js";
import { createXtEgaSession, createXtSession } from "./xt-session.js";
import type { XtRomSlot } from "./xt-session.js";
import { xtKeySupported } from "./xt-keyboard.js";
import { createXtScreen } from "./xt-screen.js";
import { decodeXtCheckpoint, encodeXtCheckpoint, xtCheckpointKey } from "./xt-checkpoint.js";
import { createXtDebugger, formatXtDebugAddress, parseXtDebugAddress, xtDebugLocation } from "./xt-debugger.js";
import { createXtDebuggerView } from "./xt-debugger-view.js";
import { previewXtInstruction } from "./xt-instruction-preview.js";
import { createXtInstructionView } from "./xt-instruction-view.js";
import { createRomWalkthrough } from "./rom-walkthrough-view.js";
import type { RomGuide, RomWalkthrough } from "./rom-guide.js";
import { createXtRomAnnotations, xtCheckpointPosition } from "./xt-rom-guide.js";
import { matchesUltimaObservation, ultimaPartyLocation } from "./xt-ultima-v.js";
import type { XtCheckpoint } from "./xt-ultima-v.js";
import { createXtChangeLog, createXtWatchHistory, xtHistoryAssembly, xtStorageLabel } from "./xt-history.js";
import { createChangeLogView } from "./change-log-view.js";
import { createMemoryWatchHistoryView } from "./memory-watch-history-view.js";

for (const root of document.querySelectorAll<HTMLElement>("[data-xt-laboratory]")) mount(root);

function mount(root: HTMLElement): void {
  const at = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`)!;
  const button = (name: string) => at<HTMLButtonElement>(name);
  const screen = at("screen"), message = at("message"), status = at("execution");
  const display = createXtScreen(root.querySelector("canvas")!, at("screen-text"), at("screen-notice"));
  const ega = root.dataset.xtLaboratory === "ega";
  const session = ega ? createXtEgaSession() : createXtSession();
  const images = { ...romImages, ...egaRomImages };
  const checkpointKey = ega ? xtCheckpointKey + ":ega" : xtCheckpointKey;
  const debug = createXtDebugger(() => session.machine);
  const registers = root.querySelector<HTMLElement>('[data-workspace-panel="registers"]')!;
  const code = root.querySelector<HTMLElement>('[data-workspace-panel="code"]')!;
  const instruction = root.querySelector<HTMLElement>('[data-workspace-panel="instruction"]')!;
  const memoryPanel = root.querySelector<HTMLElement>('[data-workspace-panel="memory"]')!;
  const catalogue: XtCatalogue = JSON.parse(at("xt-catalogue").textContent!);
  const guide: RomGuide = JSON.parse(at("xt-rom-guide").textContent!);
  const ultima: RomWalkthrough = JSON.parse(at("ultima-walkthrough").textContent!);
  const annotations = createXtRomAnnotations(guide);
  const showRegisters = createXtRegisterView(registers);
  const showCode = createXtCodeView(code, catalogue, annotations, () => refresh("code"));
  const showInstruction = createXtInstructionView(instruction, browseMemory);
  const memory = createMemoryInspector(memoryPanel, "dromaios:inspectors:xt:memory", undefined, {
    size: 0x100000, initialAddress: 0xffff0, parseAddress: parseXtAddress,
    followChoices: [
      { value: "pc", label: "CS:IP", title: "Follow CS:IP at its physical address" },
      { value: "sp", label: "SS:SP", title: "Follow SS:SP at its physical address" },
    ],
  });
  const updates = createPanelUpdates(root, id => refresh(id), "dromaios:inspectors:xt:live");
  const changeLog = createChangeLogView(root, () => session.machine, machine => createXtChangeLog(machine, catalogue.storage),
    (instruction, caller) => xtHistoryAssembly(catalogue.cpu, caller!, instruction.bytes), { location: formatXtDebugAddress })!;
  const watchHistory = createXtWatchHistory();
  const watchView = createMemoryWatchHistoryView(root, watchHistory, {
    addressWidth: 5, location: formatXtDebugAddress, storageLabel: xtStorageLabel,
    assembly: entry => xtHistoryAssembly(catalogue.cpu, entry.caller, entry.bytes), browseMemory,
    browseCode(location) { showCode.browse(location); workspace.show("code"); },
  })!;
  const slots = [...root.querySelectorAll<HTMLElement>("[data-slot]")].map(panel => {
    const id = panel.dataset.slot as XtRomSlot;
    return { id, file: panel.querySelector("input")!, load: panel.querySelector<HTMLButtonElement>("[data-load]")!,
      forget: panel.querySelector<HTMLButtonElement>("[data-forget]")!, status: panel.querySelector<HTMLElement>("[data-slot-status]")!,
      storage: romFileStorage(() => localStorage, "dromaios:xt-rom:" + id + ":v1", images[id].size,
        file => readRomFile(file, images[id])), remembered: false };
  });
  const diskFile = at<HTMLInputElement>("disk-file"), diskName = at("disk-name"), motor = at("disk-motor");
  const diskMessage = at("disk-message");
  let loading = true, readingDisk = false, writableCopy = false, saved = false, lastDraw = -Infinity;
  const execution = createExecutionController({
    step() {
      const log = changeLog.current();
      const record = log.capture(() => debug.capture(() => session.step()));
      watchHistory.observe(record, debug.watchpoints, log.memoryWrites(record));
      return record;
    }, canStep: () => session.ready && !loading,
    pauseBeforeStep: debug.beforeStep,
    onChange: refresh, batchSize: 8192,
    schedule(callback, ms) { const id = window.setTimeout(callback, ms); return () => window.clearTimeout(id); },
  });
  execution.setDelay(1);
  const debugView = createXtDebuggerView(root, debug, {
    ramMaximum: session.machine.ram.size - 1, changed: refresh,
    memory: browseMemory,
    labels: guide.labels, history: address => watchView.select({ address }),
    watchesChanged: () => { watchHistory.configure(debug.watchpoints); watchView.refresh(); },
  });
  function browseMemory(address: number): void { memory.browse(address); workspace.show("memory"); }
  function guestCondition({ expect }: XtCheckpoint) {
    return expect && (() => matchesUltimaObservation(expect, session.machine.cpu.snapshot(), session.machine.ram));
  }
  function runTo(text: string, step?: XtCheckpoint): void {
    if (!session.ready || loading || execution.running || execution.error) return;
    const when = step && guestCondition(step);
    // Loading the EGA tiles alone exceeds the ordinary two-million-boundary limit.
    debug.runTo(parseXtDebugAddress(text), when ? { limit: 10_000_000, when } : undefined);
    message.textContent = ""; execution.run();
  }
  const walkthrough = createRomWalkthrough(root, { routines: guide.routines, walkthroughs: [...guide.walkthroughs, ultima] }, {
    runTo: (text, step) => act(() => runTo(text, step)),
    browse: (address, step) => { showCode.browse({ address, space: "CS:IP " + step.execution }); workspace.show("code"); },
    inspect: ({ expect }: XtCheckpoint) => expect && "party" in expect
      ? { label: "Inspect party bytes", show: () => browseMemory(ultimaPartyLocation) } : undefined,
    position: (step, location, available, running) => xtCheckpointPosition(step, location, available, running, guestCondition(step)),
    reference: address => {
      const entry = annotations.reference.at(address)!;
      at("walkthrough-reference-text").textContent = `${entry.name} · ${entry.description}`;
    },
  })!;
  const target = at<HTMLInputElement>("run-to-address");
  at<HTMLFormElement>("run-to-form").onsubmit = event => {
    event.preventDefault();
    try { runTo(target.value); }
    catch (cause) { target.setCustomValidity((cause as Error).message); target.reportValidity(); }
  };
  target.oninput = () => target.setCustomValidity("");

  function refresh(requested?: string): void {
    const running = execution.running, ready = session.ready && !loading, runnable = ready && !execution.error;
    button("run").disabled = button("step").disabled = !runnable || running;
    button("run-to").disabled = target.disabled = !runnable || running;
    button("pause").disabled = !running;
    button("reset").disabled = button("power").disabled = button("quick").disabled = !ready || running || readingDisk;
    button("break").disabled = button("warm").disabled = !runnable;
    button("save").disabled = !ready || running || readingDisk;
    button("restore").disabled = !ready || running || readingDisk || !saved;
    button("remove").disabled = loading || running || !saved;
    for (const slot of slots) { slot.load.disabled = loading || readingDisk || running; slot.forget.disabled = loading || running || !slot.remembered; }

    button("disk-insert").disabled = button("disk-writable").disabled = loading || readingDisk;
    button("disk-eject").disabled = loading || readingDisk || session.diskName === null;
    const name = session.diskName ?? "Empty";
    if (diskName.textContent !== name) { diskName.textContent = name; diskName.title = name; }
    const protection = at("disk-protection"), mode = session.machine.io.disketteWritable ? "Writable" : "Write-protected";
    protection.hidden = session.diskName === null;
    if (protection.textContent !== mode) protection.textContent = mode;
    const motorOn = session.machine.io.disketteMotorOn;
    button("disk-export").disabled = loading || readingDisk || session.diskName === null || motorOn;
    if (motorOn !== motor.classList.contains("is-on")) {
      motor.classList.toggle("is-on", motorOn);
      motor.textContent = motorOn ? "Motor on" : "Motor off";
    }

    const cpu = session.machine.cpu.snapshot(), seconds = session.machine.io.oscillatorTicks / xtOscillatorHz;
    status.textContent = [running ? "Running" : ready ? "Paused" : "Waiting for firmware",
      `CS:IP ${hex(cpu.cs, 4)}:${hex(cpu.ip, 4)} · physical ${hex(cpu.pc, 5)}`, `${seconds.toFixed(2)} s on the XT`,
      session.keyboard.queuedBytes ? `${session.keyboard.queuedBytes} scan bytes queued` : "",
      session.keyboard.pasteRemaining ? `${session.keyboard.pasteRemaining} characters to paste` : ""].filter(Boolean).join(" · ");
    at("error").textContent = execution.error ?? "";
    debugView.refresh(running);
    walkthrough.refresh(xtDebugLocation(cpu), runnable, running);
    const now = performance.now();
    if (requested || !running || now - lastDraw >= 65) {
      lastDraw = now;
      if (screen.getClientRects().length) display(session.machine, ready);
      if (registers.getClientRects().length && (requested === "registers" || updates.shouldUpdate("registers", running))) {
        showRegisters(cpu, execution.error ? undefined : execution.records.at(-1)?.before);
      }
      if (code.getClientRects().length && (requested === "code" || updates.shouldUpdate("code", running))) {
        showCode.refresh(session.machine, cpu, execution.records);
      }
      if (instruction.getClientRects().length && (requested === "instruction" || updates.shouldUpdate("instruction", running))) {
        showInstruction(previewXtInstruction(session, catalogue));
      }
      if (memoryPanel.getClientRects().length && (requested === "memory" || updates.shouldUpdate("memory", running))) {
        memory.refresh(address => readXtStorage(session.machine, catalogue.storage, address), cpu.pc, {
          sp: physical8088(cpu.ss, cpu.sp),
        });
      }
      for (const [id, show] of [["log", changeLog.refresh], ["debugger", watchView.refresh]] as const) {
        if (root.querySelector<HTMLElement>(`[data-workspace-panel="${id}"]`)!.getClientRects().length
          && (requested === id || updates.shouldUpdate(id, running))) show();
      }
    }
  }
  function act(work: () => void) {
    try { message.textContent = ""; work(); }
    catch (error) { message.textContent = error instanceof Error ? error.message : String(error); }
    refresh();
  }
  function resetTools(): void {
    execution.reset(); debug.reset(); memory.reset(); showCode.reset(); changeLog.reset(); watchHistory.reset();
  }
  function run(): void { debug.run(); message.textContent = ""; execution.run(); screen.focus(); }
  function powerOn(start: "cold" | "quick"): void {
    session.powerOn(start); diskMessage.textContent = ""; resetTools();
    if (start === "quick") run();
  }
  button("run").onclick = run;
  button("pause").onclick = () => { debug.pause(); execution.stop(); };
  button("step").onclick = () => { debug.step(); execution.step(); };
  button("reset").onclick = () => act(() => { session.resetCpu(); resetTools(); });
  button("power").onclick = () => act(() => powerOn("cold"));
  button("quick").onclick = () => act(() => powerOn("quick"));
  button("break").onclick = () => act(() => session.keyboard.chord(["ControlLeft", "ScrollLock"]));
  button("warm").onclick = () => act(() => session.keyboard.chord(["ControlLeft", "AltLeft", "Delete"]));

  screen.addEventListener("keydown", event => {
    if (!session.ready || loading || event.metaKey || event.code === "Tab" || event.ctrlKey && event.code === "KeyV") return;
    if (!xtKeySupported(event.code)) return;
    event.preventDefault();
    if (!event.repeat) act(() => session.keyboard.down(event.code));
  });
  screen.addEventListener("keyup", event => { session.keyboard.up(event.code); });
  screen.addEventListener("paste", event => {
    if (!session.ready || loading) return;
    event.preventDefault(); act(() => session.keyboard.paste(event.clipboardData?.getData("text/plain") ?? ""));
  });
  screen.addEventListener("blur", () => session.keyboard.releaseHeld());
  function leaveWindow() {
    session.keyboard.releaseHeld();
    if (execution.running) debug.pause("The laboratory lost focus. Choose Run to continue.");
    execution.stop();
  }
  window.addEventListener("blur", leaveWindow);
  window.addEventListener("pagehide", leaveWindow);
  document.addEventListener("visibilitychange", () => { if (document.hidden) leaveWindow(); });

  button("save").onclick = () => act(() => {
    localStorage.setItem(checkpointKey, encodeXtCheckpoint(session.snapshot()));
    saved = true; at("saved").textContent = "XT checkpoint saved in this browser.";
  });
  button("restore").onclick = () => act(() => {
    const value = localStorage.getItem(checkpointKey);
    if (value === null) throw new Error("No saved XT checkpoint.");
    session.restore(decodeXtCheckpoint(value, ega)); diskMessage.textContent = ""; resetTools();
    message.textContent = "Session restored and paused.";
  });
  button("remove").onclick = () => act(() => {
    localStorage.removeItem(checkpointKey); saved = false; at("saved").textContent = "No checkpoint saved.";
  });

  button("disk-insert").onclick = () => { writableCopy = false; diskFile.click(); };
  button("disk-writable").onclick = () => { writableCopy = true; diskFile.click(); };
  diskFile.onchange = async () => {
    const file = diskFile.files?.[0];
    if (!file || loading || readingDisk) return;
    readingDisk = true; diskMessage.textContent = ""; refresh();
    try {
      if (file.size !== xtDisketteSize) throw new Error("Choose a raw 360 KiB disk image (368,640 bytes).");
      session.insertDisk(file.name, new Uint8Array(await file.arrayBuffer()), { writable: writableCopy });
    } catch (cause) { diskMessage.textContent = cause instanceof Error ? cause.message : String(cause); }
    finally { diskFile.value = ""; readingDisk = false; refresh(); }
  };
  button("disk-eject").onclick = () => act(() => { session.ejectDisk(); diskMessage.textContent = ""; });
  button("disk-export").onclick = () => act(() => {
    if (!session.diskName || session.machine.io.disketteMotorOn) return;
    const link = document.createElement("a");
    link.download = session.diskName.replace(/(?:-saved)?\.(?:img|ima|dsk)$/i, "") + "-saved.img";
    const url = URL.createObjectURL(new Blob([session.machine.io.exportDiskette()], { type: "application/octet-stream" }));
    link.href = url;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    diskMessage.textContent = `Exported ${link.download}.`;
  });

  for (const slot of slots) {
    slot.load.onclick = () => slot.file.click();
    slot.file.onchange = async () => {
      const file = slot.file.files?.[0]; if (!file || loading || execution.running) return;
      loading = true; message.textContent = `Checking ${file.name}…`; refresh();
      try {
        const media = await slot.storage.prepare(file);
        session.install(slot.id, media.rom.image); resetTools(); slot.status.textContent = media.rom.name + " · verified";
        try { slot.storage.remember(media.stored); slot.remembered = true; message.textContent = "ROM loaded and remembered."; }
        catch { slot.remembered = false; message.textContent = "ROM loaded for this visit. Browser storage is unavailable."; }
      } catch (error) { message.textContent = error instanceof Error ? error.message : String(error); }
      finally { slot.file.value = ""; loading = false; refresh(); }
    };
    slot.forget.onclick = () => act(() => {
      slot.storage.forget(); slot.remembered = false;
      message.textContent = "Remembered file removed. The loaded ROM is available for this visit.";
    });
  }
  const controls = document.querySelector<HTMLElement>("[data-workspace-controls]")!, layoutStatus = document.createElement("span");
  layoutStatus.setAttribute("role", "status"); layoutStatus.className = "workspace-status";
  const panels = [...root.querySelectorAll<HTMLElement>("[data-workspace-panel]")].map(content => {
    const id = content.dataset.workspacePanel!, controls = document.createElement("span");
    controls.className = "lab-inspector-controls";
    if (id === "memory") controls.append(memory.controls);
    const live = updates.controls(id); if (live) controls.append(live);
    return { content, id, title: content.dataset.panelTitle!, heading: content.dataset.panelHeading,
      detail: content.dataset.panelDetail, controls };
  });
  try { migrateXtWorkspace(localStorage); } catch { /* Use the default layout if storage is unavailable or invalid. */ }
  const workspace = createWorkspace(at("workspace-root"), at("workspace-panels"), panels, {
    defaults: xtDefaultLayout, storageKey: xtWorkspaceKey, onShow: id => queueMicrotask(() => refresh(id)),
    onStatus: text => { layoutStatus.textContent = text; },
  });
  mountWorkspaceControls(controls, workspace, layoutStatus);
  try {
    saved = localStorage.getItem(checkpointKey) !== null;
    if (saved) at("saved").textContent = "Local XT checkpoint available.";
  } catch { at("saved").textContent = "Browser storage unavailable."; }
  refresh();
  void Promise.all(slots.map(async slot => {
    try {
      const rom = await slot.storage.restore(); if (!rom) return;
      session.install(slot.id, rom.image); slot.remembered = true; slot.status.textContent = rom.name + " · verified";
    } catch { slot.status.textContent = "Remembered ROM unavailable. Choose the local file again."; }
  })).then(() => { loading = false; refresh(); });
}
