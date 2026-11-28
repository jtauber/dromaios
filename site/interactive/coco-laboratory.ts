import type { DebugLocation } from "./instruction-debugger.js";
import type { WatchBoundary } from "./memory-watch-history.js";
import { cocoMemorySupported, cocoRamAddress } from "../../src/machines/6809/coco/memory.js";
import { createCocoCartridgeView } from "./coco-cartridge-view.js";
import { createMachineSound } from "./machine-sound-view.js";
import { createCocoJoystickView } from "./coco-joystick-view.js";
import { createCocoCassetteView } from "./coco-cassette-view.js";
import { createCocoDiskView } from "./coco-disk-view.js";
import { createCocoChangeLog } from "./coco-change-log.js";
import { createChangeLogView } from "./change-log-view.js";
import { createCocoWatchHistory } from "./coco-watch-history.js";
import { accessStopHistoryActions, mappedLocationText } from "./mapped-access-stops.js";
import { createEventStopList } from "./event-stop-list.js";
import { createMemoryWatchHistoryView } from "./memory-watch-history-view.js";
import { decodeCaptured6809 } from "./6809-disassembly.js";
import { createCallStack } from "./call-stack-view.js";
import { createDebuggerStepControls } from "./debugger-step-controls.js";
import { cocoDebugLocation, observeCocoBoundary } from "./coco-debugger.js";
import { romImages } from "../../src/machines/generated/6809/coco-disk.js";
import { createRomWalkthrough } from "./rom-walkthrough-view.js";
import { createCocoRomAnnotations, observeCocoRoms, cocoWalkthroughAvailable, cocoCheckpointReached } from "./coco-rom-guide.js";
import type { CocoCheckpoint, CocoRomGuides } from "./coco-rom-guide.js";
import { romCheckpointPosition } from "./rom-guide.js";
import { createCocoSession } from "./coco-session.js";
import { cocoScreenKey, cocoTextInput } from "./coco-input.js";
import { cocoHex, readCocoStorage } from "./coco-inspection.js";
import type { Catalogue6809 } from "./6809-catalogue.js";
import { create6809CodeView } from "./6809-code-view.js";
import { create6809InstructionView } from "./6809-instruction-view.js";
import { previewCocoInstruction } from "./coco-instruction-preview.js";
import { createCocoScreen } from "./coco-screen-view.js";
import { createCocoPixelInspector } from "./coco-pixel-view.js";
import { createCocoInspectors } from "./coco-inspector-view.js";
import { createCocoStateComparisonView } from "./coco-state-comparison-view.js";
import { createCheckpointView } from "./checkpoint-view.js";
import { cocoSavedCheckpoints } from "./coco-saved-state.js";
import { readRomFile } from "./rom-file.js";
import type { RomFile } from "./rom-file.js";
import { romFileStorage } from "./rom-storage.js";
import { createExecutionController } from "./execution-controller.js";
import { createExecutionSpeedControls } from "./execution-speed-controls.js";
import { createExecutionIntervalView } from "./execution-interval-view.js";
import { createCocoDebugger } from "./coco-debugger.js";
import { createCocoDebuggerView } from "./coco-debugger-view.js";
import { createPanelUpdates } from "./panel-updates.js";
import { createRefreshCadence } from "./refresh-cadence.js";
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
  const targetButton = at<HTMLButtonElement>("run-target-button");
  const removeExtended = at<HTMLButtonElement>("extended-rom-remove");
  const removeDisk = at<HTMLButtonElement>("disk-rom-remove");
  type RomSlot = keyof typeof romImages;
  const roms: Record<RomSlot, RomFile | undefined> = { firmware: undefined, extended: undefined, dos: undefined };
  const slots = ([
    { id: "firmware", prefix: "rom", label: "Color BASIC 1.3", key: "dromaios:coco-rom:v1" },
    { id: "extended", prefix: "extended-rom", label: "Extended Color BASIC 1.1", key: "dromaios:coco-extended-rom:v1" },
    { id: "dos", prefix: "disk-rom", label: "Disk Extended Color BASIC 1.1", key: "dromaios:coco-disk-rom:v1" },
  ] as const).map(slot => ({ ...slot,
    file: at<HTMLInputElement>(`${slot.prefix}-file`), load: at<HTMLButtonElement>(`${slot.prefix}-load`),
    forget: at<HTMLButtonElement>(`${slot.prefix}-forget`), status: at(`${slot.prefix}-status`),
    storageStatus: at(`${slot.prefix}-storage-status`),
    storage: romFileStorage(() => localStorage, slot.key, romImages[slot.id].size,
      file => readRomFile(file, romImages[slot.id])),
  }));
  const memoryKey = "dromaios:coco:ram";
  let memorySize: 32 | 64 = 32;
  try { if (localStorage.getItem(memoryKey) === "64") memorySize = 64; } catch { /* Default to 32 KiB. */ }
  const memoryButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-coco-ram]")];
  let session = createCocoSession(null, null, null, memorySize), selecting = true;
  const sound = createMachineSound(root, () => ({ clock: session.machine.clock, level: session.machine.pias.soundLevel }));
  const joysticks = createCocoJoystickView(root, () => session.machine.pias, {
    changed: () => refreshPanels(["pias"]), releaseKeyboard: () => session.releaseInput(),
  });
  const intervals = createExecutionIntervalView(root, () => session.machine.clock, "board ticks");
  let requested: readonly string[] = [];
  // Readable live tools need fewer redraws than the game screen. Boundary work keeps its own cadence.
  const screenCadence = createRefreshCadence(1000 / 60), inspectorCadence = createRefreshCadence(100);
  let screenDue = true, inspectorsDue = true;
  const panels = [...root.querySelectorAll<HTMLElement>("[data-workspace-panel]")];
  const updates = createPanelUpdates(root, id => refreshPanels([id]), "dromaios:inspectors:coco:live");
  const guides: CocoRomGuides = JSON.parse(at("coco-rom-guides").textContent!);
  const annotations = createCocoRomAnnotations(guides);
  const catalogue: Catalogue6809 = JSON.parse(at("coco-instructions").textContent!);
  const inspectors = createCocoInspectors(root, () => code.memoryMoved(), browse);
  const display = createCocoScreen(root, () => {
    if (debug.pixelTarget) { debug.pause("Pixel run cancelled on display signal change."); execution.stop(); }
    refreshPanels(["screen"]);
  });
  function browse(address: number): void { inspectors.memory.browse(address); workspace.show("memory"); }
  function browseRam(address: number): string | undefined {
    const logical = cocoRamAddress(session.machine, address) === address ? address
      : address >= 0x8000 && cocoRamAddress(session.machine, address - 0x8000) === address ? address - 0x8000 : undefined;
    if (logical === undefined) {
      const reason = `Physical RAM $${cocoHex(address)} is not visible in the current CPU map.`;
      message.textContent = reason; return reason;
    }
    browse(logical);
  }
  const debug = createCocoDebugger(() => session.machine, catalogue);
  const assembly = (address: number, bytes: readonly number[]) => decodeCaptured6809(address, bytes, catalogue).assembly;
  const changeLog = createChangeLogView(root, () => session.machine, createCocoChangeLog,
    instruction => assembly(instruction.address, instruction.bytes))!;
  const watchHistory = createCocoWatchHistory();
  const stopList = createEventStopList(at("access-stops"), { ...debug.accessStops, storageKey: "dromaios:debugger:coco:access:1" });
  const historyOptions = {
    ...accessStopHistoryActions(stopList.add), location: mappedLocationText,
    assembly: (entry: WatchBoundary) => assembly(entry.caller.address, entry.bytes), storageLabel: () => "RAM",
    browseCode(location: DebugLocation) {
      if (cocoDebugLocation(session.machine, location.address).space !== location.space) {
        return `Cannot browse $${cocoHex(location.address)}: its observed ${location.space} mapping is no longer visible.`;
      }
      code.browse(location.address); workspace.show("code");
    },
  };
  const watchView = createMemoryWatchHistoryView(at("coco-watchpoints"), watchHistory, { ...historyOptions, browseMemory: browseRam })!;
  const readView = createMemoryWatchHistoryView(at("coco-read-watches"), watchHistory.reads, { ...historyOptions, browseMemory: browse })!;
  const debugView = createCocoDebuggerView(root, debug, {
    changed: () => code.refreshBreakpoints(), memory: browseRam, logicalMemory: browse,
    readHistory: address => readView.select({ address }),
    history: address => watchView.select({ address }),
    watchesChanged: () => {
      watchHistory.configure(debug.watchpoints); watchView.refresh();
      watchHistory.reads.configure(debug.readWatchpoints); readView.refresh();
    },
    code: address => { code.browse(address); workspace.show("code"); },
  });
  const pixelInspector = createCocoPixelInspector(root, debug, {
    watchWrites: debugView.watchWrites, browseCode: historyOptions.browseCode,
    run: (x, y) => action(() => { debug.runUntilPixelChanges(x, y, display.signal); execution.run(); screen.focus(); }),
  });
  const code = create6809CodeView(at("coco-code"), catalogue, { address: () => inspectors.memory.address, browse }, debugView);
  const calls = createCallStack(root, {
    stackName: "S", stackWidth: 4,
    label: location => location.space === "rom" ? annotations.reference.at(location.address)?.name : undefined,
    browse: address => { code.browse(address); workspace.show("code"); },
  });
  const instruction = create6809InstructionView(at("coco-instruction"), browse);
  function observeBoundary(): ReturnType<typeof observeCocoBoundary> {
    // Every host reset/replacement calls changedMachine(), which clears execution records.
    return observeCocoBoundary(session.machine, execution.records.at(-1)?.after);
  }
  let lastCaller: DebugLocation | undefined;
  const execution = createExecutionController({
    step() {
      const observed = observeBoundary(), log = changeLog.current();
      const record = log.capture(() => debug.capture(() => session.step(), observed.caller), observed);
      sound.observe();
      const transfers = watchHistory.observe(record, observed.caller, debug.watchpoints, log.memoryWrites(record), debug.readWatchpoints);
      debug.observeAccesses(record, observed.caller, transfers);
      lastCaller = observed.caller;
      return record;
    },
    canStep: () => session.ready && !selecting,
    pauseBeforeStep: () => debug.beforeStep(observeBoundary().caller),
    schedule(callback, delay) {
      const id = window.setTimeout(() => { joysticks.poll(); callback(); }, delay);
      return () => window.clearTimeout(id);
    },
    onChange: refresh, batchSize: 10_000, batchTimeMs: 8,
  });
  execution.setDelay(1);
  const speed = createExecutionSpeedControls(root, {
    unit: "board ticks", clock: () => session.machine.clock, setPacing: execution.setPacing, changed: refresh,
  });
  const cassette = createCocoCassetteView(root, () => session.machine.pias, {
    changed: () => refreshPanels(["pias"]),
    pause: () => { debug.pause(); execution.stop(); },
    selecting: value => { selecting = value; refresh(); },
  });
  const disk = createCocoDiskView(root, () => session, {
    changed: () => refreshPanels(["disk"]),
    pause: () => { debug.pause(); execution.stop(); },
    selecting: value => { selecting = value; refresh(); },
  });
  const cartridge = createCocoCartridgeView(root, () => session, {
    changed: () => { changedMachine(); refreshPanels(panels.map(panel => panel.dataset.workspacePanel!)); },
    pause: () => { debug.pause(); execution.stop(); },
    selecting: value => { selecting = value; refresh(); },
  });
  for (const button of memoryButtons) button.addEventListener("click", () => action(() => {
    session.configureMemory(button.dataset.cocoRam === "64" ? 64 : 32); changedMachine();
    try { localStorage.setItem(memoryKey, String(session.memorySize)); } catch { /* Keep this visit's choice. */ }
  }));
  const reached = (step: CocoCheckpoint) => cocoCheckpointReached(step, lastCaller, execution.records.at(-1));
  const walkthrough = createRomWalkthrough(root, {
    routines: Object.values(guides).flatMap(guide => guide.routines),
    walkthroughs: Object.values(guides).flatMap(guide => guide.walkthroughs),
  }, {
    available: tour => cocoWalkthroughAvailable(tour, guides, observeCocoRoms(session.machine)),
    runTo: (address, step: CocoCheckpoint) => runTo(parseInt(step.after?.pc ?? address, 16), "rom",
      step.after ? () => reached(step) : undefined),
    position(step: CocoCheckpoint, location, available, running) {
      if (!step.after || !available || !location) return romCheckpointPosition(step, location, available, running);
      if (running) return `Waiting for ${step.title} at $${step.address} in ROM.`;
      return reached(step) ? `${step.title} observed at $${step.address} in ROM. PC is now $${step.after.pc}.`
        : `Paused at $${cocoHex(location.address)} (${location.space}). Waiting for ${step.title} at $${step.address} in ROM.`;
    },
    browse: address => { code.browse(address); workspace.show("code"); },
    reference: address => {
      const entry = annotations.reference.at(address)!;
      at("coco-routine-reference").textContent = `$${entry.address} · ${entry.name}: ${entry.description}`;
    },
  })!;
  function runTo(address: number, space?: "rom", when?: () => boolean): void {
    if (!session.ready || selecting || checkpoints.busy || execution.running || execution.error !== undefined) return;
    targetInput.value = cocoHex(address); targetInput.setCustomValidity("");
    debug.runTo(address, space, when); message.textContent = ""; execution.run();
  }

  function shouldUpdate(id: string): boolean {
    return requested.includes(id) || (id === "screen" ? screenDue : inspectorsDue) && updates.shouldUpdate(id, execution.running)
      && panels.some(panel => panel.dataset.workspacePanel === id && panel.getClientRects().length > 0);
  }
  function refreshPanels(ids: readonly string[]): void { requested = ids; refresh(); requested = []; }
  function refresh(): void {
    const unavailable = selecting || checkpoints.busy;
    const ready = session.ready && !unavailable, running = execution.running;
    const now = performance.now();
    screenDue = screenCadence.due(now, running); inspectorsDue = inspectorCadence.due(now, running);
    run.disabled = !ready || running || execution.error !== undefined;
    pause.disabled = !running; step.disabled = !ready || running || execution.error !== undefined;
    reset.disabled = !ready || running; power.disabled = unavailable || running;
    targetButton.disabled = targetInput.disabled = !ready || running || execution.error !== undefined;
    speed.refresh(unavailable);
    sound.refresh({ running, normal: speed.normal, unavailable });
    joysticks.refresh(unavailable, running);
    cassette.refresh(unavailable, running);
    disk.refresh(unavailable, running);
    cartridge.refresh(unavailable, running);
    for (const button of memoryButtons) {
      button.disabled = unavailable || running;
      button.setAttribute("aria-pressed", String(Number(button.dataset.cocoRam) === session.memorySize));
    }
    for (const slot of slots) {
      slot.load.disabled = slot.forget.disabled = unavailable;
      const rom = roms[slot.id];
      slot.status.textContent = rom ? `${rom.name} · verified ${slot.label}`
        : slot.id === "firmware" ? "No Color BASIC ROM loaded · RAM and devices are available"
          : slot.id === "extended" ? "No Extended BASIC ROM loaded" : "No Disk BASIC ROM loaded";
    }
    removeExtended.disabled = unavailable || running || roms.extended === undefined;
    removeDisk.disabled = unavailable || running || roms.dos === undefined;
    checkpoints.refresh(ready && !running, !unavailable && !running);
    at("machine-status").textContent = `${checkpoints.busy ? "Updating checkpoint" : running ? "Running" : ready ? "Paused" : "Ready for ROM"} · ${session.memorySize} KiB · ${execution.steps.toLocaleString()} steps`
      + ` · ${session.machine.clock.ticks.toLocaleString()} board ticks`
      + (session.pendingInput ? ` · ${session.pendingInput} keys queued` : "");
    if (session.hasFirmware && !session.ready) at("machine-status").textContent = "Load Extended Color BASIC 1.1 to use Disk BASIC.";
    at("machine-error").textContent = execution.error ?? "";
    debugView.refresh(running);
    intervals.refresh({ running, unavailable, stop: execution.error ? "error" : debug.stop?.kind });
    if (shouldUpdate("log")) changeLog.refresh();
    if (shouldUpdate("debugger")) { watchView.refresh(); readView.refresh(); }
    stepControls(step.disabled, debug.canStepOut);
    if (shouldUpdate("calls")) calls?.refresh(debug.frames, debug.trackingNote, address => cocoDebugLocation(session.machine, address));
    const record = execution.records.at(-1);
    at("last-step").textContent = record ? record.instruction
      ? `$${cocoHex(record.instruction.address)}   ${record.instruction.bytes.map(byte => cocoHex(byte, 2)).join(" ")}   ${record.outcome}`
      : `${"source" in record ? record.source.toUpperCase() + " · " : ""}${record.outcome}` : "No steps recorded";
    inspectors.refresh(session.machine, shouldUpdate);
    const state = session.machine.cpu.snapshot(), mapping = observeCocoRoms(session.machine);
    walkthrough.refresh(cocoDebugLocation(session.machine),
      ready && execution.error === undefined && cocoMemorySupported(session.machine), running);
    if (shouldUpdate("code")) code.refresh(address => readCocoStorage(session.machine, address), state, execution.records, annotations.observe(mapping));
    if (shouldUpdate("instruction")) instruction(cocoMemorySupported(session.machine)
      ? previewCocoInstruction(session.machine, catalogue) : "Unsupported SAM memory configuration.");
    const image = shouldUpdate("screen") ? display.refresh(session.machine) : undefined;
    pixelInspector.refresh(image && !running && !unavailable ? { machine: session.machine, image, runnable: !run.disabled } : undefined);
  }
  function action(work: () => void): void {
    try { work(); message.textContent = ""; }
    catch (cause) { message.textContent = cause instanceof Error ? cause.message : String(cause); }
    refresh();
  }
  function changedMachine(): void {
    comparison.clear(); joysticks.reset();
    intervals.clearStep(); changeLog.reset(); watchHistory.reset(); execution.reset(); debug.reset(); inspectors.reset(); }
  function installRom(id: RomSlot, verified: RomFile): void {
    const firmware = id === "firmware" ? verified : roms.firmware;
    const extended = id === "extended" ? verified : roms.extended;
    const dos = id === "dos" ? verified : roms.dos;
    if (id === "firmware" && !session.hasFirmware) { session.installFirmware(verified.image); session.machine.reset(); }
    else session.configureRoms({ firmware: firmware?.image ?? null, extended: extended?.image ?? null, dos: dos?.image ?? null });
    roms[id] = verified; changedMachine();
    message.textContent = session.hasFirmware ? "ROM loaded. Run boots BASIC; click the screen to type."
      : "Extension loaded. Load Color BASIC 1.3 to boot.";
  }
  for (const slot of slots) {
    slot.load.addEventListener("click", () => slot.file.click());
    slot.file.addEventListener("change", () => { void (async () => {
      const chosen = slot.file.files?.[0]; if (!chosen) return;
      if (execution.running) debug.pause();
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
    for (const slot of slots.filter(slot => slot.id !== "firmware")) slot.storage.forget();
    session.configureRoms({ firmware: roms.firmware?.image ?? null, extended: null, dos: null });
    for (const slot of slots.filter(slot => slot.id !== "firmware")) {
      roms[slot.id] = undefined; slot.storageStatus.textContent = "ROM removed and forgotten. Fresh hardware is ready for Color BASIC.";
    }
    changedMachine();
  }));
  removeDisk.addEventListener("click", () => action(() => {
    const slot = slots.find(slot => slot.id === "dos")!; slot.storage.forget();
    session.configureRoms({ firmware: roms.firmware?.image ?? null, extended: roms.extended?.image ?? null, dos: null });
    roms.dos = undefined; slot.storageStatus.textContent = "Disk BASIC removed and forgotten. The disk remains mounted.";
    changedMachine();
  }));
  run.addEventListener("click", () => { debug.run(); message.textContent = ""; execution.run(); screen.focus(); });
  pause.addEventListener("click", () => { debug.pause(); execution.stop(); });
  step.addEventListener("click", () => { debug.step(); intervals.begin("step"); message.textContent = ""; execution.step(); });
  const stepControls = createDebuggerStepControls(root, {
    over: () => { debug.over(); intervals.begin("over"); },
    out: () => { debug.out(); intervals.begin("out"); },
    run: () => { message.textContent = ""; execution.run(); },
    error: text => { message.textContent = text; },
  });
  targetForm.addEventListener("submit", event => {
    event.preventDefault(); if (targetButton.disabled) return;
    const text = targetInput.value.trim().replace(/^\$|^0x/i, "");
    if (!/^[0-9a-f]{1,4}$/i.test(text)) {
      targetInput.setCustomValidity("Enter a hexadecimal address from 0000 to FFFF."); targetInput.reportValidity(); return;
    }
    runTo(parseInt(text, 16));
  });
  targetInput.addEventListener("input", () => targetInput.setCustomValidity(""));
  reset.addEventListener("click", () => action(() => { session.reset(); changedMachine(); }));
  power.addEventListener("click", () => action(() => { session.powerOn(); changedMachine(); }));
  screen.addEventListener("keydown", event => {
    if (checkpoints.busy || pixelInspector.handleKey(event)) return;
    try {
      if (joysticks.keyDown(event)) { event.preventDefault(); return; }
      const keys = cocoScreenKey(event); if (!keys) return;
      event.preventDefault();
      if (!event.repeat) session.send([keys]);
      message.textContent = execution.running ? "" : "Input queued. Run or Step advances the CoCo.";
    } catch (cause) { message.textContent = cause instanceof Error ? cause.message : String(cause); }
    if (!execution.running) refresh();
  });
  screen.addEventListener("keyup", event => { if (joysticks.keyUp(event)) event.preventDefault(); });
  screen.addEventListener("paste", event => {
    event.preventDefault(); if (checkpoints.busy || pixelInspector.active) return;
    action(() => session.send(cocoTextInput(event.clipboardData?.getData("text/plain") ?? "")));
  });
  at<HTMLInputElement>("coco-scanlines").addEventListener("change", event => {
    screen.classList.toggle("scanlines", (event.currentTarget as HTMLInputElement).checked);
  });
  function releaseFocus(): void {
    const hadInput = session.pendingInput > 0;
    if (execution.running) debug.pause();
    execution.stop(); session.releaseInput(); joysticks.release();
    if (hadInput) message.textContent = "Paused after focus left the window; queued keys were released.";
    refresh();
  }
  window.addEventListener("blur", releaseFocus);
  document.addEventListener("visibilitychange", () => { if (document.hidden) releaseFocus(); });
  window.addEventListener("pagehide", releaseFocus);

  const snapshotPanel = root.querySelector<HTMLElement>('[data-workspace-panel="states"]')!;
  const comparison = createCocoStateComparisonView(snapshotPanel, () => session.machine, {
    browseRam, watchWrites: debugView.watchWrites, signal: () => display.signal,
    inspectPixel(x, y) {
      if (execution.running || checkpoints.busy || selecting) return "Pause the CoCo to inspect a dot.";
      workspace.show("screen"); refreshPanels(["screen"]);
      pixelInspector.selectPixel(x, y);
      if (!pixelInspector.active) return "The current screen cannot be inspected.";
    },
  });
  const checkpoints = createCheckpointView(snapshotPanel,
    cocoSavedCheckpoints(() => localStorage, session.machine.clock.hertz!), {
      comparison, capture: () => session.snapshot(),
      restore(state) { session.restore(state); changedMachine(); message.textContent = ""; },
      refresh,
    });

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
  refreshPanels(panels.map(panel => panel.dataset.workspacePanel!));
  void (async () => {
    await Promise.all(slots.map(async slot => {
      try {
        roms[slot.id] = await slot.storage.restore();
        if (roms[slot.id]) slot.storageStatus.textContent = "Remembered ROM verified. Paused and ready.";
      } catch { slot.storageStatus.textContent = `The remembered ROM could not be restored. Choose your local ${slot.label} file.`; }
    }));
    session = createCocoSession(roms.firmware?.image ?? null, roms.extended?.image ?? null, roms.dos?.image ?? null, memorySize); changedMachine();
    selecting = false; refreshPanels(panels.map(panel => panel.dataset.workspacePanel!));
  })();
}
