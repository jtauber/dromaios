import { createDebuggerStepControls } from "./debugger-step-controls.js";
import { editApple2Register } from "./apple2-register-edit.js";
import { editApple2Memory } from "./apple2-memory-edit.js";
import { romImages } from "../../src/machines/generated/6502/apple2.js";
import { createExecutionController } from "./execution-controller.js";
import { createExecutionSpeedControls } from "./execution-speed-controls.js";
import { createMachineSound } from "./machine-sound-view.js";
import { createExecutionIntervalView } from "./execution-interval-view.js";
import { createApple2Session, apple2ControlKey, apple2ScreenKey, apple2Input } from "./apple2-session.js";
import { createApple2ScreenInspector } from "./apple2-screen-inspector-view.js";
import { createApple2Screen } from "./apple2-screen-view.js";
import { readApple2Disk } from "./apple2-media.js";
import type { Apple2RomFile, Apple2DiskMode } from "./apple2-media.js";
import { downloadDiskImage } from "./disk-download.js";
import { createApple2DiskInspector } from "./apple2-disk-inspector.js";
import { apple2RomStorage } from "./apple2-rom-storage.js";
import { createApple2Inspection } from "./apple2-inspection-view.js";
import { createApplesoftVariablesView } from "./apple2-applesoft-variables-view.js";
import { applesoftStepBoundary } from "./apple2-applesoft-step.js";
import { createApplesoftBreakpoints } from "./apple2-applesoft-breakpoints.js";
import { createApplesoftView } from "./apple2-applesoft-view.js";
import { createApplesoftStackView } from "./apple2-applesoft-stack-view.js";
import { createApplesoftHistoryView } from "./apple2-applesoft-history-view.js";
import { createApplesoftHistory } from "./apple2-applesoft-history.js";
import { createApplesoftProfile } from "./apple2-applesoft-profile.js";
import { createApplesoftEvents } from "./apple2-applesoft-events.js";
import { createApplesoftEventsView } from "./apple2-applesoft-events-view.js";
import { createApple2ChangeLogView } from "./apple2-change-log-view.js";
import { createApple2Explorer } from "./apple2-explorer-view.js";
import { createPanelUpdates } from "./panel-updates.js";
import { apple2DebugLocation } from "./apple2-debugger.js";
import { createApple2SavedStateView } from "./apple2-saved-state-view.js";
import { prepareApple2SavedState } from "./apple2-saved-state.js";
import type { Apple2SavedState } from "./apple2-saved-state.js";
import { apple2MemoryHighlights } from "./apple2-inspection.js";
import { createInspectorNavigation } from "./inspector-navigation.js";
import { Apple2DiskSet } from "./apple2-disk-set.js";
import type { Apple2DiskEntry } from "./apple2-disk-set.js";
import { createApple2DiskSetView } from "./apple2-disk-set-view.js";
import { Dos33Disk } from "../../src/components/devices/dos33-disk.js";

/** File controls, host scheduling, and screen presentation around the generated machine. */
export function mountApple2(root: HTMLElement, showPanel: (id: string) => void = () => {}) {
  const element = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`)!;
  const file = element<HTMLInputElement>("rom-file");
  const keyboard = root.querySelector<HTMLTextAreaElement>("[data-apple2-keyboard]");
  const inputStatus = root.querySelector<HTMLElement>("[data-input-status]");
  const diskFile = element<HTMLInputElement>("disk-file"), eject = element<HTMLButtonElement>("disk-eject");
  const loadRom = element<HTMLButtonElement>("rom-load"), loadDisk = element<HTMLButtonElement>("disk-load");
  const writableDisk = root.querySelector<HTMLButtonElement>("[data-disk-writable]");
  const exportDisk = root.querySelector<HTMLButtonElement>("[data-disk-export]");
  const diskNotice = root.querySelector<HTMLElement>("[data-disk-notice]");
  const diskActions = root.querySelectorAll<HTMLButtonElement>("[data-disk-action]");
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
  let session = createApple2Session(), rom: Apple2RomFile | undefined, diskName: string | null = null;
  let diskSet = new Apple2DiskSet();
  const intervals = createExecutionIntervalView(root, () => session.machine.clock);
  const sound = createMachineSound(root, () => ({ clock: session.machine.clock, level: Number(session.machine.speaker.level()) }));
  let diskMode: Apple2DiskMode = writableDisk ? "read-only" : "system-master";
  let diskAction: "boot" | "swap" = "boot";
  let selecting = false, selection = 0, flash = false, nextFlash = 0, restoring = false;
  const renderScreen = createApple2Screen(screen, element<HTMLInputElement>("apple2-scanlines"));
  const monochrome = element<HTMLInputElement>("apple2-monochrome");
  monochrome.disabled = false;
  monochrome.addEventListener("change", refresh);
  let requestedPanels: readonly string[] = [];
  const updates = createPanelUpdates(root, id => refreshPanels([id]));
  const shouldUpdate = (id: string) => requestedPanels.includes(id) || updates.shouldUpdate(id, execution.running);
  const diskInspector = createApple2DiskInspector(root, address => navigation.browse("memory", address));
  const navigation = createInspectorNavigation(root, tool => tool === "memory" ? inspection.memoryAddress : explorer.address(tool), location => {
    if (location.tool === "memory") inspection.browseMemory(location.address);
    else explorer.browse(location.tool, location.address);
    showPanel(location.tool); refreshPanels([location.tool, "rom", "code"]);
  });
  const browseMemory = (address: number) => navigation.browse("memory", address);
  const basicStep = root.querySelector<HTMLButtonElement>("[data-applesoft-step]");
  const basicBreakpoints = createApplesoftBreakpoints(() => session.machine);
  const basicHistory = basicStep && createApplesoftHistory(basicBreakpoints.listing);
  const basicProfile = basicStep && createApplesoftProfile(basicBreakpoints.listing);
  const basicEvents = basicStep && createApplesoftEvents(basicBreakpoints.listing);
  const applesoft = basicHistory && createApplesoftView(root, browseMemory, basicBreakpoints, basicHistory, revealStatement);
  function revealStatement(address: number): void {
    showPanel("applesoft"); refreshPanels(["applesoft"]); applesoft?.reveal(address);
  }
  const basicStack = basicProfile && createApplesoftStackView(root, basicBreakpoints.listing, browseMemory, revealStatement, basicProfile);
  const historyView = basicHistory && createApplesoftHistoryView(root, basicHistory, basicBreakpoints.listing, revealStatement);
  const eventsView = basicEvents && createApplesoftEventsView(root, basicEvents, basicBreakpoints.listing, browseMemory, revealStatement);
  const variables = createApplesoftVariablesView(root, browseMemory);
  const inspection = createApple2Inspection(root, shouldUpdate, () => refreshPanels(["rom", "code"]), (register, text) => {
    if (execution.running || selecting) throw new Error("Pause execution before editing a register.");
    editApple2Register(session.machine, register, text);
    explorer.reset(); resetExecutionHistory();
    message.textContent = `${register.toUpperCase()} edited. Execution history cleared; RAM and devices preserved.`;
    refresh();
  }, { showPanel, memory: address => navigation.browse("memory", address), history: watch => explorer.watchHistory(watch),
    watchesChanged: watches => explorer.watchesChanged(watches) }, {
    apply(edit, text) {
      if (execution.running || selecting) throw new Error("Pause execution before editing RAM.");
      const change = editApple2Memory(session.machine, edit, text);
      if (!change) return;
      if (basicBreakpoints.active) basicBreakpoints.reconcile();
      explorer.reset(); resetExecutionHistory();
      changeLog?.current().recordEdit(change);
      message.textContent = "RAM edited. Execution history cleared; the user edit is recorded in Changes.";
      refreshPanels(["memory", "zero", "stack", "watches", "instruction", "code", "log"]);
    },
    refresh: id => refreshPanels([id]),
  });
  const changeLog = createApple2ChangeLogView(root, () => session.machine);
  const inputTarget = keyboard ?? screen;
  const execution = createExecutionController({
    step: () => {
      const before = apple2DebugLocation(session.machine), romMapped = !session.machine.language.ramRead();
      const perform = () => explorer.captureDiskStep(before, () => session.step());
      const log = changeLog?.current();
      const record = log ? log.capture(perform) : perform();
      if (record.outcome !== "executed") throw new Error(`Processor stopped: ${record.outcome}.`);
      sound.observe();
      basicHistory?.observe(session.machine, before);
      basicProfile?.observe(session.machine, before, record.after);
      basicEvents?.observe(session.machine, before, record);
      const changes = log?.memoryChanges(record) ?? [];
      const writes = log?.memoryWrites(record) ?? [];
      explorer.observe(record, before, inspection.watches, changes, writes);
      inspection.observe(session.machine, changes);
      screenInspector?.observe(record, before, writes);
      // Complete manual stepping before its single refresh, preserving sample-based highlights.
      if (!execution.running) pauseBeforeStep();
      return { record, romMapped };
    },
    canStep: () => session.hasFirmware && !selecting,
    pauseBeforeStep,
    schedule(callback, delay) { const id = window.setTimeout(callback, delay); return () => window.clearTimeout(id); },
    onChange: refresh, batchSize: 10000, batchTimeMs: 8,
  });
  const explorer = createApple2Explorer(root, () => session.machine, () => { message.textContent = ""; execution.run(); }, shouldUpdate, {
    memoryAddress: () => inspection.memoryAddress, browseMemory: address => inspection.browseMemory(address), browse: navigation.browse,
    inspectPixel: (x, y) => { showPanel("screen"); screenInspector?.selectPixel(x, y); },
    browseDiskSector: (track, sector) => diskInspector?.browseSector(track, sector),
  }, diskInspector?.trace);
  const screenInspector = createApple2ScreenInspector(root, () => session.machine, {
    memory: address => navigation.browse("memory", address),
    watch: address => inspection.watchMemory(address, "write"), code: explorer.browseCode,
  });
  const diskSetView = createApple2DiskSetView(root, {
    insert: entry => action(() => {
      if (selecting || !rom?.bootstrap) return;
      const restart = diskAction === "boot";
      if (restart) explorer.reset(); else explorer.pause("Paused for disk exchange.");
      execution.stop(); insertDisk(entry, restart);
      if (restart) { resetExecutionHistory(); flash = false; nextFlash = 0; if (keyboard) keyboard.value = ""; }
      refresh();
    }),
    copy: entry => action(() => {
      diskSet.checkCapacity(1);
      const disk = new Dos33Disk(entry.disk.exportImage(), { writable: true });
      const name = entry.name.replace(/\.(?:dsk|do)$/i, "") + "-copy.dsk";
      diskSet.add([{ name, disk }]); diskSetView!.select(disk);
      if (diskNotice) diskNotice.textContent = `Added ${name}. Insert selected to use the writable copy.`;
      refresh();
    }),
    export: entry => action(() => {
      const name = downloadDiskImage(entry.name, ".dsk", entry.disk.exportImage());
      if (diskNotice) diskNotice.textContent = `Exported ${name}.`;
    }),
    remove: entry => action(() => {
      diskSet.remove(entry, session.machine.disk.medium);
      if (diskNotice) diskNotice.textContent = `Removed ${entry.name} from this session's set.`;
      refresh();
    }),
  });
  const savedStates = createApple2SavedStateView(root, {
    capture() {
      requirePaused();
      return { state: session.snapshot(), diskName, flash, diskSet: diskSet.snapshot(session.machine.disk.medium) };
    },
    restore: saved => withSavedState(saved, prepared => {
      session = prepared.session; diskName = prepared.diskName; flash = prepared.flash; nextFlash = 0;
      diskSet = prepared.diskSet;
      if (diskNotice) diskNotice.textContent = "";
      explorer.reset(); resetExecutionHistory();
      if (keyboard) keyboard.value = "";
      message.textContent = `Restored “${saved.name}”. Paused; CPU clocks restored, instruction count restarted.`;
    }),
    compare: saved => withSavedState(saved, prepared => ({ saved: prepared.session.snapshot(), current: session.snapshot() })),
    memory: change => {
      if (!apple2MemoryHighlights(session.machine, [change]).has(change.address)) {
        return "That physical RAM bank is not currently mapped. Its saved and current values are shown here; mapping is unchanged.";
      }
      navigation.browse("memory", change.address);
    },
    registers: () => { showPanel("registers"); refreshPanels(["registers"]); },
  });
  root.querySelector<HTMLElement>("[data-rom-explorer]")?.addEventListener("toggle", refresh);
  execution.setDelay(1);
  const speed = createExecutionSpeedControls(root, {
    clock: () => session.machine.clock, setPacing: execution.setPacing, changed: refresh,
  });

  function pauseBeforeStep(): boolean {
    return explorer.pauseBeforeStep(basicBreakpoints.active ? basicBreakpoints.match : undefined);
  }

  function resetExecutionHistory(): void {
    intervals.clearStep();
    execution.reset(); changeLog?.reset(); screenInspector?.reset();
    basicHistory?.clear(); basicHistory?.clearCounts();
    basicProfile?.clear();
    basicEvents?.clear();
  }

  function requirePaused(): void {
    if (execution.running || selecting) throw new Error("Pause execution before saving, restoring, or comparing a state.");
  }
  async function withSavedState<T>(saved: Apple2SavedState,
    apply: (prepared: Awaited<ReturnType<typeof prepareApple2SavedState>>) => T): Promise<T> {
    requirePaused();
    const token = ++selection;
    selecting = true; refresh();
    try {
      const prepared = await prepareApple2SavedState(saved, rom?.image ?? null, media);
      if (token !== selection) throw new Error("Saved state operation cancelled because the page was hidden.");
      return apply(prepared);
    } finally {
      if (token === selection) { selecting = false; refresh(); }
    }
  }

  function refresh(): void {
    basicBreakpoints.reconnect();
    const available = session.hasFirmware && !selecting;
    run.disabled = !available || execution.running || execution.error !== undefined;
    pause.disabled = !execution.running;
    step.disabled = !available || execution.running || execution.error !== undefined;
    stepControls(step.disabled, explorer.canStepOut);
    if (basicStep) basicStep.disabled = step.disabled || session.machine.language.ramRead();
    reset.disabled = !available;
    power.disabled = selecting;
    speed.refresh(selecting);
    for (const control of [keyboard, enter, interrupt]) if (control) control.disabled = !available;
    loadRom.disabled = file.disabled = forgetRom.disabled = selecting;
    loadDisk.disabled = diskFile.disabled = selecting || rom?.bootstrap === undefined;
    loadRom.textContent = rom ? "Replace ROM…" : "Load ROM…";
    if (!writableDisk) loadDisk.textContent = diskName ? "Replace disk…" : "Load disk…";
    if (writableDisk) writableDisk.disabled = loadDisk.disabled;
    const drive = session.machine.disk.inspect();
    diskSetView?.refresh({ set: diskSet, mounted: session.machine.disk.medium, selecting,
      canInsert: rom?.bootstrap !== undefined, motor: drive.motor });
    if (!drive.installed) diskAction = "boot";
    for (const button of diskActions) {
      button.disabled = loadDisk.disabled || button.dataset.diskAction === "swap" && !drive.installed;
      button.setAttribute("aria-pressed", String(button.dataset.diskAction === diskAction));
    }
    diskInspector?.refresh(session.machine.disk, shouldUpdate("disk"));
    if (exportDisk) exportDisk.disabled = selecting || !drive.loaded || drive.motor;
    eject.disabled = !available || !drive.loaded;
    status.textContent = `${!session.hasFirmware ? "Hardware ready · no ROM installed" : execution.running ? "Running" : "Paused"} · ${execution.steps.toLocaleString()} instructions · ${session.machine.clock.ticks.toLocaleString()} CPU clocks`;
    status.setAttribute("aria-live", execution.running ? "off" : "polite");
    element<HTMLElement>("rom-status").textContent = rom ? `Loaded: ${rom.name} · verified`
      : restoring ? "Checking saved ROM…" : "No ROM loaded.";
    element<HTMLElement>("disk-status").textContent = diskName ? `${diskName} · drive 1 · ${drive.writable ? "writable copy" : "write protected"} · motor ${drive.motor ? "on" : "off"}`
      : rom?.bootstrap ? "No disk loaded. Fresh power-on boots Applesoft." : "Disk boot needs the 20 KiB ROM container, which includes the Disk II bootstrap.";
    if (inputStatus) inputStatus.textContent = `${session.pendingInput} keyboard characters queued`;
    if (execution.error !== undefined) { explorer.fail(execution.error); screenInspector?.reset(); }
    if (execution.error !== undefined) message.textContent = execution.error;
    intervals.refresh({ running: execution.running, unavailable: selecting, stop: explorer.stop?.kind });
    sound.refresh({ running: execution.running, normal: speed.normal, unavailable: selecting });
    const latest = execution.error === undefined ? execution.records.at(-1)?.record : undefined;
    if (shouldUpdate("variables")) variables?.(session.machine);
    if (shouldUpdate("applesoft")) applesoft?.refresh(session.machine, latest, explorer.stop);
    basicStack?.(session.machine, execution.running);
    if (shouldUpdate("applesoft-history")) historyView?.refresh();
    if (shouldUpdate("applesoft-events")) eventsView?.refresh();
    inspection.refresh(session.machine, latest, changeLog?.current().memoryChanges(latest), !execution.running && !selecting);
    explorer.refresh(execution.records, available && execution.error === undefined, execution.running);
    if (shouldUpdate("log")) changeLog?.refresh();
    const now = performance.now();
    if (execution.running && now >= nextFlash) { flash = !flash; nextFlash = now + 500; }
    const { ram, video } = session.machine;
    renderScreen(ram, video, flash, monochrome.checked);
    screenInspector?.refresh(execution.running);
    savedStates?.refresh(session.machine, !execution.running && !selecting);
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
  async function choose<T>(input: HTMLInputElement, verify: (file: File) => Promise<T>, apply: (verified: T) => void,
    notice?: HTMLElement | null, restart = true): Promise<void> {
    const chosen = input.files?.[0];
    if (chosen === undefined) return;
    const token = ++selection;
    if (restart) explorer.reset(); else explorer.pause("Paused for disk exchange.");
    execution.stop(); selecting = true; message.textContent = `Checking ${chosen.name}…`; refresh();
    if (notice) notice.textContent = message.textContent;
    try {
      const verified = await verify(chosen);
      if (token !== selection) return;
      apply(verified);
      if (restart) {
        resetExecutionHistory(); flash = false; nextFlash = 0;
        if (keyboard) keyboard.value = "";
      }
    } catch (cause) {
      if (token === selection) {
        message.textContent = cause instanceof Error ? cause.message : String(cause);
        if (notice) notice.textContent = message.textContent;
      }
    } finally {
      if (token === selection) { selecting = false; input.value = ""; refresh(); }
    }
  }
  function installRom(verified: Apple2RomFile): void {
    const fresh = rom === undefined ? session : createApple2Session();
    fresh.installFirmware(verified.image);
    fresh.reset();
    session = fresh; rom = verified; diskName = null;
    if (diskNotice) diskNotice.textContent = "";
    message.textContent = "ROM loaded. Run boots Applesoft, or select a disk to boot DOS.";
  }
  function insertDisk(entry: Apple2DiskEntry, restart: boolean): void {
    if (restart) session = createApple2Session(rom!.image, { bootstrap: rom!.bootstrap!, image: entry.disk });
    else if (session.machine.disk.medium !== entry.disk) session.swapDisk(entry.disk);
    diskName = entry.name; diskSetView?.select(entry.disk);
    if (diskNotice) diskNotice.textContent = `Inserted ${entry.name}. Other disks remain in the set.`;
    message.textContent = restart ? "Disk loaded in a fresh, paused machine. Choose Run to boot drive 1."
      : "Disk exchanged. CPU, RAM, clocks and queued input preserved. Run resumes the program.";
  }
  loadRom.addEventListener("click", () => file.click());
  for (const button of diskActions) button.addEventListener("click", () => {
    diskAction = button.dataset.diskAction === "swap" ? "swap" : "boot"; refresh();
  });
  loadDisk.addEventListener("click", () => { diskMode = writableDisk ? "read-only" : "system-master"; diskFile.click(); });
  writableDisk?.addEventListener("click", () => { diskMode = "writable-copy"; diskFile.click(); });
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
  diskFile.addEventListener("change", () => {
    const restart = diskAction === "boot";
    void choose(diskFile, chosen => {
      if (diskSetView) diskSet.checkCapacity(1);
      return readApple2Disk(chosen, media.disk, diskMode);
    }, loaded => {
      if (!diskSetView) diskSet = new Apple2DiskSet();
      diskSet.add([loaded]); insertDisk(loaded, restart);
      if (diskNotice) diskNotice.textContent = loaded.systemMaster ? "Verified DOS 3.3 System Master." : "Local DOS-order image.";
    }, diskNotice, restart);
  });
  diskSetView?.file.addEventListener("change", () => {
    const files = [...(diskSetView.file.files ?? [])];
    void choose(diskSetView.file, () => {
      diskSet.checkCapacity(files.length);
      return Promise.all(files.map(file => readApple2Disk(file, media.disk, "read-only")));
    }, loaded => {
      diskSet.add(loaded); diskSetView.select(loaded[0]!.disk);
      message.textContent = `Added ${loaded.length} disks to the set. Drive 1 is unchanged; choose Insert selected when ready.`;
      if (diskNotice) diskNotice.textContent = message.textContent;
    }, diskNotice, false);
  });
  exportDisk?.addEventListener("click", () => action(() => {
    if (!diskName || selecting || session.machine.disk.inspect().motor) return;
    const name = downloadDiskImage(diskName, ".dsk", session.machine.disk.exportImage());
    if (diskNotice) diskNotice.textContent = `Exported ${name}.`;
  }));
  eject.addEventListener("click", () => action(() => {
    explorer.pause("Disk ejected."); execution.stop(); session.eject(); diskName = null;
    if (diskNotice) diskNotice.textContent = "";
    message.textContent = diskSetView ? "Disk ejected and retained in the set. RAM is preserved."
      : "Disk ejected. RAM is preserved; Fresh power-on returns to ROM-only Applesoft.";
    refresh();
  }));
  run.addEventListener("click", () => { explorer.run(); message.textContent = ""; nextFlash = performance.now() + 500; execution.run(); inputTarget.focus(); });
  pause.addEventListener("click", () => { explorer.pause(); execution.stop(); });
  step.addEventListener("click", () => {
    explorer.step(); intervals.begin("step"); message.textContent = ""; execution.step();
  });
  basicStep?.addEventListener("click", () => {
    explorer.stepUntil(at => applesoftStepBoundary(session.machine, at, session.pendingInput));
    message.textContent = ""; execution.run();
  });
  const stepControls = createDebuggerStepControls(root, {
    over: () => { explorer.over(); intervals.begin("over"); },
    out: () => { explorer.out(); intervals.begin("out"); },
    run: () => { message.textContent = ""; execution.run(); },
    error: text => { message.textContent = text; },
  });
  reset.addEventListener("click", () => action(() => {
    explorer.reset(); session.reset(); resetExecutionHistory();
    message.textContent = "CPU reset. RAM and device state are preserved; Run continues through the reset firmware.";
    refresh();
  }));
  power.addEventListener("click", () => action(() => {
    explorer.reset(); session.powerOn(); resetExecutionHistory(); flash = false; nextFlash = 0;
    if (keyboard) keyboard.value = "";
    message.textContent = session.hasFirmware
      ? `Fresh power-on. The previous program is gone; Run boots ${diskName ? "from the retained disk" : "Applesoft"} again.`
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
    if (screenInspector?.active) { if (event.key !== "Tab") event.preventDefault(); return; }
    const byte = apple2ScreenKey(event);
    if (byte !== undefined) { event.preventDefault(); action(() => send([byte])); }
  });
  screen.addEventListener("paste", event => { event.preventDefault(); if (screenInspector?.active) return; sendText(event.clipboardData?.getData("text/plain") ?? ""); });
  function suspend(): void {
    // A saved ROM may finish restoring in a hidden tab, but never starts execution.
    if (!restoring) { selection++; selecting = false; file.value = diskFile.value = ""; }
    if (diskSetView) diskSetView.file.value = "";
    if (execution.running) explorer.pause("Execution paused because the page is hidden.");
    execution.stop();
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) suspend(); });
  window.addEventListener("pagehide", suspend);
  async function restoreRom(): Promise<void> {
    restoring = selecting = true; refresh();
    try {
      const saved = await romStorage.restore();
      if (saved !== undefined) {
        installRom(saved);
        resetExecutionHistory();
        storageStatus.textContent = "Remembered ROM restored and verified. Run starts a fresh machine.";
      } else {
        storageStatus.textContent = "Your ROM will be remembered in this browser. Use Saved states in the laboratory to keep an experiment.";
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
