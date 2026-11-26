import { createXtDiskActivity } from "./xt-disk-activity.js";
import { createXtDiskActivityView } from "./xt-disk-activity-view.js";
import { createXtDiskFilesView } from "./xt-disk-files-view.js";
import { decodeStoredXtCheckpoint, encodeStoredXtCheckpoint } from "./xt-checkpoint-storage.js";
import { createXtDmaView } from "./xt-dma-view.js";
import { createXtIoTrace } from "./xt-io-trace.js";
import { createXtPaletteCapture } from "./xt-ega-palette.js";
import { createXtIoView } from "./xt-io-view.js";
import type { XtIoLabels } from "./xt-io-view.js";
import { createCallStack } from "./call-stack-view.js";
import { createDebuggerStepControls } from "./debugger-step-controls.js";
import { romImages } from "../../src/machines/generated/8088/pc-xt.js";
import { romImages as egaRomImages } from "../../src/machines/generated/8088/pc-xt-ega.js";
import { xtDisketteSize } from "../../src/machines/8088/pc-xt/io.js";
import { xtOscillatorHz } from "../../src/machines/8088/pc-xt/clock.js";
import { createExecutionController } from "./execution-controller.js";
import { createExecutionSpeedControls } from "./execution-speed-controls.js";
import { createExecutionIntervalView } from "./execution-interval-view.js";
import { createMachineSound } from "./machine-sound-view.js";
import { downloadDiskImage } from "./disk-download.js";
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
import { xtEgaPixelReadout } from "./xt-ega-pixel.js";
import { planeByteLabel } from "./xt-ega-plane-watch.js";
import { createXtEgaPixelInspector } from "./xt-ega-pixel-view.js";
import { xtCheckpointKey } from "./xt-checkpoint.js";
import { createXtDebugger, formatXtDebugAddress, observeXtBoundary, parseXtDebugAddress, xtDebugLocation, xtLogicalLocation } from "./xt-debugger.js";
import { createXtDebuggerView } from "./xt-debugger-view.js";
import { previewXtInstruction } from "./xt-instruction-preview.js";
import { createXtInstructionView } from "./xt-instruction-view.js";
import { createXtDosCalls, type DosServices } from "./xt-dos-services.js";
import { createXtDosServicesView } from "./xt-dos-services-view.js";
import { createXtDosFileLinks } from "./xt-dos-file-links.js";
import { createRomWalkthrough } from "./rom-walkthrough-view.js";
import type { RomGuide, RomWalkthrough } from "./rom-guide.js";
import { createXtRomAnnotations, xtCheckpointPosition } from "./xt-rom-guide.js";
import { matchesUltimaObservation, ultimaPartyLocation } from "./xt-ultima-v.js";
import { matchesXtDosObservation } from "./xt-dos-observation.js";
import type { XtCheckpoint } from "./xt-rom-guide.js";
import { describeXtEvent, matchesXtEvent } from "./xt-event-stops.js";
import { createXtChangeLog, createXtWatchHistory, xtHistoryAssembly, xtStorageLabel } from "./xt-history.js";
import { createChangeLogView } from "./change-log-view.js";
import { createMemoryWatchHistoryView } from "./memory-watch-history-view.js";
import { accessStopHistoryActions } from "./mapped-access-stops.js";

for (const root of document.querySelectorAll<HTMLElement>("[data-xt-laboratory]")) mount(root);

function mount(root: HTMLElement): void {
  const at = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`)!;
  const button = (name: string) => at<HTMLButtonElement>(name);
  const screen = at("screen"), message = at("message"), status = at("execution");
  const display = createXtScreen(root.querySelector("canvas")!, at("screen-text"), at("screen-notice"));
  const ega = root.dataset.xtLaboratory === "ega";
  const session = ega ? createXtEgaSession() : createXtSession();
  const intervals = createExecutionIntervalView(root, () => session.machine.io.clock, "oscillator ticks");
  const sound = createMachineSound(root, () => ({ clock: session.machine.io.clock, level: Number(session.machine.io.speakerLevel) }));
  const observeSpeaker = () => session.machine.io.observeSpeaker((ticks, level) => sound.observeAt(ticks, Number(level)));
  let unobserveSpeaker = observeSpeaker();
  const images = { ...romImages, ...egaRomImages };
  const checkpointKey = ega ? xtCheckpointKey + ":ega" : xtCheckpointKey;
  const registers = root.querySelector<HTMLElement>('[data-workspace-panel="registers"]')!;
  const code = root.querySelector<HTMLElement>('[data-workspace-panel="code"]')!;
  const instruction = root.querySelector<HTMLElement>('[data-workspace-panel="instruction"]')!;
  const memoryPanel = root.querySelector<HTMLElement>('[data-workspace-panel="memory"]')!;
  const catalogue: XtCatalogue = JSON.parse(at("xt-catalogue").textContent!);
  const guide: RomGuide & { readonly io: XtIoLabels; readonly dos: DosServices } = JSON.parse(at("xt-rom-guide").textContent!);
  const ultima: RomWalkthrough[] = JSON.parse(at("ultima-walkthroughs").textContent!);
  const annotations = createXtRomAnnotations(guide);
  const showRegisters = createXtRegisterView(registers);
  const showCode = createXtCodeView(code, catalogue, annotations, () => refresh("code"));
  const calls = createCallStack(root, {
    stackName: "SP", stackWidth: 4, formatLocation: location => location.space.replace("CS:IP ", ""),
    formatStack: frame => `SS:SP ${frame.stackRegister}:${hex(frame.stack, 4)}`,
    label: location => session.ready ? annotations.reference.at(location.address)?.name : undefined,
    browse: (_address, location) => { showCode.browse(location); workspace.show("code"); },
  })!;
  const portTrace = createXtIoTrace();
  let paletteCapture = createXtPaletteCapture(session.machine);
  const ioView = createXtIoView(root, portTrace, catalogue.cpu, guide.io,
    location => { showCode.browse(location); workspace.show("code"); },
    condition => act(() => { debugView.addEventStop(condition); workspace.show("debugger"); }), browseMemory);
  const diskActivity = createXtDiskActivity(() => session.machine.io);
  const diskActivityView = createXtDiskActivityView(root, diskActivity, browseMemory,
    location => { showCode.browse(location); workspace.show("code"); }, () => refresh("dma"));
  const dmaView = createXtDmaView(root, browseMemory);
  function diskMode(mode: string): void {
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-disk-inspection]")) button.setAttribute("aria-pressed", String(button.dataset.diskInspection === mode));
    for (const name of ["activity", "files", "registers"]) at(`disk-${name}`).hidden = name !== mode;
    refresh("dma");
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-disk-inspection]")) button.onclick = () => diskMode(button.dataset.diskInspection!);
  const diskFiles = createXtDiskFilesView(root, diskActivity, browseMemory,
    (regions, label, operation) => { diskActivityView.filter(regions, label, operation); diskMode("activity"); }, () => refresh("dma"));
  const showInstruction = createXtInstructionView(instruction, browseMemory);
  const readStorage = (address: number) => readXtStorage(session.machine, catalogue.storage, address);
  const dosFileLinks = createXtDosFileLinks(() => session.machine.io, diskActivity);
  const dosCalls = createXtDosCalls(guide.dos, readStorage, dosFileLinks.observe);
  const debug = createXtDebugger(() => session.machine, undefined, dosCalls, catalogue.cpu);
  const pixelInspector = ega ? createXtEgaPixelInspector(screen.closest<HTMLElement>("[data-workspace-panel]")!, debug, catalogue.cpu,
    (x, y) => act(() => { debug.runUntilPixelChanges(x, y); execution.run(); screen.focus(); }),
    location => { showCode.browse(location); workspace.show("code"); },
    entry => { workspace.show("ports"); ioView.selectPaletteWrite(entry); }, browseMemory,
    (plane, offset) => act(() => { debugView.watchPlane(plane, offset); workspace.show("debugger"); })) : undefined;
  const showDos = createXtDosServicesView(instruction, guide.dos, dosCalls, browseMemory,
    () => { dosFileLinks.reset(); diskFiles.reset(); refresh("instruction"); },
    condition => act(() => { debugView.addEventStop(condition); workspace.show("debugger"); }), dosFileLinks,
    link => { diskFiles.selectRange(link); diskMode("files"); workspace.show("dma"); });
  const memory = createMemoryInspector(memoryPanel, "dromaios:inspectors:xt:memory", (): void => debugView.refreshMemoryWatches(), {
    size: 0x100000, initialAddress: 0xffff0, parseAddress: parseXtAddress, selectOnClick: true,
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
    browseCode(location, bytes) {
      workspace.show("code");
      showCode.browse(location, bytes.length ? { address: location.address, bytes } : undefined);
    },
    ...accessStopHistoryActions(({ caller, kind, address, expectedValue }) => {
      const logical = xtLogicalLocation(caller);
      if (!logical) throw new Error("The captured instruction has no valid CS:IP.");
      debugView.addEventStop({ kind: "access", ...logical, direction: kind, address, value: expectedValue });
    }),
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
  let checkpointBusy = false;
  let loading = true, readingDisk = false, writableCopy = false, saved = false, lastDraw = -Infinity;
  function observeBoundary(): ReturnType<typeof observeXtBoundary> {
    // CPU reset, power-on and checkpoint restore clear the records through resetTools().
    return observeXtBoundary(session.machine, execution.records.at(-1)?.after);
  }
  const execution = createExecutionController({
    step() {
      const log = changeLog.current();
      const observed = log.recording ? observeBoundary() : undefined;
      const step = () => diskActivity.capture(() => session.step());
      const record = log.capture(() => debug.capture(() => paletteCapture && (portTrace.recording || debug.pixelTarget)
        ? paletteCapture.capture(step) : step()), observed);
      portTrace.observe(record, session.machine.io.clock.ticks);
      sound.observe();
      watchHistory.observe(record, log.memoryWrites(record));
      return record;
    }, canStep: () => session.ready && !loading,
    pauseBeforeStep: () => debug.beforeStep(() => observeBoundary().caller),
    onChange: refresh, batchSize: 8192, batchTimeMs: 8,
    schedule(callback, ms) { const id = window.setTimeout(callback, ms); return () => window.clearTimeout(id); },
  });
  execution.setDelay(1);
  const speed = createExecutionSpeedControls(root, {
    unit: "oscillator ticks", clock: () => session.machine.io.clock, setPacing: execution.setPacing, changed: refresh,
  });
  const debugView = createXtDebuggerView(root, debug, {
    ramMaximum: session.machine.ram.size - 1, changed: refresh,
    memory: browseMemory, selection: memory, code: (location, instruction) => { workspace.show("code"); showCode.browse(location, instruction); },
    labels: guide.labels, dos: guide.dos, history: address => watchView.select({ address }),
    watchesChanged: configureWatchHistory,
  });
  function configureWatchHistory(): void {
    watchHistory.configure(debug.watchpoints, debug.readWatchpoints); watchView.refresh();
  }
  configureWatchHistory(); // Include both lists restored from browser storage.
  memory.controls.addEventListener("input", debugView.refreshMemoryWatches);
  function browseMemory(address: number): void { memory.browse(address); workspace.show("memory"); }
  function guestCondition({ expect }: XtCheckpoint) {
    return expect && (() => "bytes" in expect ? matchesXtDosObservation(expect, session.machine)
      : matchesUltimaObservation(expect, session.machine.cpu.snapshot(), session.machine.ram));
  }
  function runTo(text: string, step?: XtCheckpoint): void {
    if (!session.ready || loading || execution.running || execution.error) return;
    const when = step && guestCondition(step);
    // Loading the EGA tiles alone exceeds the ordinary two-million-boundary limit.
    if (step?.event) debug.runToEvent(step.event, when);
    else debug.runTo(parseXtDebugAddress(text), when ? { limit: step?.boundaryLimit ?? 10_000_000, when } : undefined);
    message.textContent = ""; execution.run();
  }
  const walkthrough = createRomWalkthrough(root, { routines: guide.routines, walkthroughs: [...guide.walkthroughs, ...ultima] }, {
    available: tour => tour.id !== "hello-com" || !ega,
    runTo: (text, step) => act(() => runTo(text, step)),
    browse: (address, step) => { showCode.browse({ address, space: "CS:IP " + step.execution }); workspace.show("code"); },
    inspect: ({ expect, event, memory: address, file, fileRange }: XtCheckpoint) => {
      const pixel = expect && "egaPixel" in expect && expect.egaPixel;
      const tools = file ? [
        { label: "Files · " + file, show: () => { workspace.show("dma"); diskMode("files"); diskFiles.select(file, fileRange); } },
      ] : [];
      if (event?.kind === "access") {
        tools.push({ label: "Inspect memory", show: () => browseMemory(event.address) });
      } else if (file && address) {
        tools.push({ label: "Inspect memory", show: () => browseMemory(parseInt(address, 16)) },
          { label: "Instruction", show: () => workspace.show("instruction") });
      } else if (address) {
        tools.push({ label: "Inspect sector buffer", show: () => browseMemory(parseInt(address, 16)) },
          { label: "DMA / diskette", show: () => workspace.show("dma") }, { label: "Port trace", show: () => workspace.show("ports") });
      } else if (expect && "party" in expect) {
        tools.push({ label: "Inspect party bytes", show: () => browseMemory(ultimaPartyLocation) });
      }
      if (expect && "egaPlane" in expect && expect.egaPlane) {
        const { plane, offset } = expect.egaPlane, byte = parseInt(offset, 16);
        tools.push({ label: "Watch " + planeByteLabel(plane, byte), show: () => act(() => debugView.watchPlane(plane, byte)) });
      }
      if (!pixel || !pixelInspector) return tools;
      return [...tools, {
        label: `Inspect pixel (${pixel.x},${pixel.y})`, available: () => pixelInspector.available,
        show: () => { workspace.show("screen"); pixelInspector.select(pixel.x, pixel.y); },
      }];
    },
    readout: ({ expect }: XtCheckpoint) => {
      if (!expect || !("bytes" in expect) || !("ega" in session.machine)) return;
      const { ramByte, egaPlane, egaPixel } = expect, { ram, ega } = session.machine, parts = [];
      if (ramByte) parts.push(`RAM $${ramByte.address} = $${hex(ram.read(parseInt(ramByte.address, 16)), 2)}`);
      if (egaPlane) {
        const offset = parseInt(egaPlane.offset, 16);
        parts.push(`${planeByteLabel(egaPlane.plane, offset)} = $${hex(ega.planeByte(egaPlane.plane, offset), 2)}`);
      }
      if (egaPixel) parts.push(xtEgaPixelReadout(ega, egaPixel.x, egaPixel.y));
      return parts.join(" · ");
    },
    description: (step: XtCheckpoint) => step.event ? describeXtEvent(step.event) : step.execution ?? step.address,
    position: (step: XtCheckpoint, location, available, running) => step.event && available
      ? `${running ? "Running to" : debug.eventHit && matchesXtEvent(step.event, debug.eventHit.event) && (guestCondition(step)?.() ?? true) ? "At checkpoint" : "Selected checkpoint"} ${describeXtEvent(step.event)}.`
      : xtCheckpointPosition(step, location, available, running, guestCondition(step)),
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
    const unavailable = loading || checkpointBusy;
    const running = execution.running, ready = session.ready && !unavailable, runnable = ready && !execution.error;
    speed.refresh(!ready);
    sound.refresh({ running, normal: speed.normal, unavailable: !ready });
    intervals.refresh({ running, unavailable: !ready, stop: execution.error ? "error" : debug.stop?.kind });
    stepControls(!runnable || running, debug.canStepOut);
    button("run").disabled = button("step").disabled = !runnable || running;
    button("run-to").disabled = target.disabled = !runnable || running;
    button("pause").disabled = !running;
    button("reset").disabled = button("power").disabled = button("quick").disabled = !ready || running || readingDisk;
    button("break").disabled = button("warm").disabled = !runnable;
    button("save").disabled = !ready || running || readingDisk;
    button("restore").disabled = !ready || running || readingDisk || !saved;
    button("remove").disabled = unavailable || running || !saved;
    for (const slot of slots) { slot.load.disabled = unavailable || readingDisk || running; slot.forget.disabled = unavailable || running || !slot.remembered; }

    button("disk-insert").disabled = button("disk-writable").disabled = unavailable || readingDisk;
    button("disk-eject").disabled = unavailable || readingDisk || session.diskName === null;
    const name = session.diskName ?? "Empty";
    if (diskName.textContent !== name) { diskName.textContent = name; diskName.title = name; }
    const protection = at("disk-protection"), mode = session.machine.io.disketteWritable ? "Writable" : "Write-protected";
    protection.hidden = session.diskName === null;
    if (protection.textContent !== mode) protection.textContent = mode;
    const motorOn = session.machine.io.disketteMotorOn;
    button("disk-export").disabled = unavailable || readingDisk || session.diskName === null || motorOn;
    if (motorOn !== motor.classList.contains("is-on")) {
      motor.classList.toggle("is-on", motorOn);
      motor.textContent = motorOn ? "Motor on" : "Motor off";
    }

    const cpu = session.machine.cpu.snapshot(), seconds = session.machine.io.oscillatorTicks / xtOscillatorHz;
    status.textContent = [checkpointBusy ? "Saving or restoring checkpoint" : running ? "Running" : ready ? "Paused" : "Waiting for firmware",
      `CS:IP ${hex(cpu.cs, 4)}:${hex(cpu.ip, 4)} · physical ${hex(cpu.pc, 5)}`,
      `${session.machine.io.oscillatorTicks.toLocaleString()} oscillator ticks · ${seconds.toFixed(2)} s on the XT`,
      session.keyboard.queuedBytes ? `${session.keyboard.queuedBytes} scan bytes queued` : "",
      session.keyboard.pasteRemaining ? `${session.keyboard.pasteRemaining} characters to paste` : ""].filter(Boolean).join(" · ");
    at("error").textContent = execution.error ?? "";
    debugView.refresh(running);
    pixelInspector?.refresh(ready && !running && "ega" in session.machine ? session.machine.ega : undefined, runnable);
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
        const preview = previewXtInstruction(session, catalogue);
        showInstruction(preview);
        showDos(preview.record && dosCalls.preview(preview.record), debug.dosHit);
      }
      if (memoryPanel.getClientRects().length && (requested === "memory" || updates.shouldUpdate("memory", running))) {
        memory.refresh(address => readXtStorage(session.machine, catalogue.storage, address), cpu.pc, {
          sp: physical8088(cpu.ss, cpu.sp),
        });
      }
      const callsPanel = root.querySelector<HTMLElement>('[data-workspace-panel="calls"]')!;
      if (callsPanel.getClientRects().length && (requested === "calls" || updates.shouldUpdate("calls", running))) {
        calls.refresh(debug.frames, debug.trackingNote, (address, captured) => captured ?? { address, space: "physical" });
      }
      for (const [id, show] of [["log", changeLog.refresh], ["debugger", watchView.refresh], ["ports", ioView.refreshTrace],
        ["pic", () => ioView.refreshPic(session.machine.io.interruptState(), cpu)],
        ["dma", () => {
          if (!at("disk-registers").hidden) dmaView.refresh(session.machine.io.disketteState());
          diskActivityView.refresh(); diskFiles.refresh(session.machine.io, running);
        }]] as const) {
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
    paletteCapture?.dispose(); paletteCapture = createXtPaletteCapture(session.machine);
    unobserveSpeaker(); unobserveSpeaker = observeSpeaker(); intervals.clearStep();
    execution.reset(); debug.reset(); memory.reset(); showCode.reset(); changeLog.reset(); watchHistory.reset(); ioView.reset(); diskActivity.reset();
    dosFileLinks.reset(); diskFiles.reset(); diskActivityView.resetFilter();
  }
  function run(): void { debug.run(); message.textContent = ""; execution.run(); screen.focus(); }
  function powerOn(start: "cold" | "quick"): void {
    session.powerOn(start); diskMessage.textContent = ""; resetTools();
    if (start === "quick") run();
  }
  button("run").onclick = run;
  button("pause").onclick = () => { debug.pause(); execution.stop(); };
  button("step").onclick = () => { debug.step(); intervals.begin("step"); execution.step(); };
  const stepControls = createDebuggerStepControls(root, {
    over: () => { debug.over(); intervals.begin("over"); },
    out: () => { debug.out(); intervals.begin("out"); },
    run: () => { message.textContent = ""; execution.run(); }, error: text => { message.textContent = text; },
  });
  button("reset").onclick = () => act(() => { session.resetCpu(); resetTools(); });
  button("power").onclick = () => act(() => powerOn("cold"));
  button("quick").onclick = () => act(() => powerOn("quick"));
  button("break").onclick = () => act(() => session.keyboard.chord(["ControlLeft", "ScrollLock"]));
  button("warm").onclick = () => act(() => session.keyboard.chord(["ControlLeft", "AltLeft", "Delete"]));

  screen.addEventListener("keydown", event => {
    if (pixelInspector?.handleKey(event)) return;
    if (!session.ready || loading || event.metaKey || event.code === "Tab" || event.ctrlKey && event.code === "KeyV") return;
    if (!xtKeySupported(event.code)) return;
    event.preventDefault();
    if (!event.repeat) act(() => session.keyboard.down(event.code));
  });
  screen.addEventListener("keyup", event => { session.keyboard.up(event.code); });
  screen.addEventListener("paste", event => {
    if (pixelInspector?.active) { event.preventDefault(); return; }
    if (!session.ready || loading || checkpointBusy) return;
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

  async function checkpointAction(action: "Save" | "Restore", perform: () => Promise<void>): Promise<void> {
    act(() => { checkpointBusy = true; at("saved").textContent = `${action} in progress…`; });
    try { await perform(); }
    catch (cause) {
      at("saved").textContent = `${action} failed. ${saved ? "The previous saved checkpoint is still available." : "No checkpoint was saved."}`;
      message.textContent = cause instanceof Error ? cause.message : String(cause);
    } finally { checkpointBusy = false; refresh(); }
  }
  button("save").onclick = () => void checkpointAction("Save", async () => {
    const text = await encodeStoredXtCheckpoint(session.snapshot());
    localStorage.setItem(checkpointKey, text);
    saved = true; at("saved").textContent = "XT checkpoint saved in this browser.";
  });
  button("restore").onclick = () => void checkpointAction("Restore", async () => {
    const value = localStorage.getItem(checkpointKey);
    if (value === null) throw new Error("No saved XT checkpoint.");
    session.restore(await decodeStoredXtCheckpoint(value, ega)); diskMessage.textContent = ""; resetTools();
    message.textContent = "Session restored and paused."; at("saved").textContent = "XT checkpoint restored.";
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
      session.insertDisk(file.name, new Uint8Array(await file.arrayBuffer()), { writable: writableCopy }); diskActivity.reset(); diskFiles.reset(); diskActivityView.resetFilter();
    } catch (cause) { diskMessage.textContent = cause instanceof Error ? cause.message : String(cause); }
    finally { diskFile.value = ""; readingDisk = false; refresh(); }
  };
  button("disk-eject").onclick = () => act(() => { session.ejectDisk(); diskActivity.reset(); diskFiles.reset(); diskActivityView.resetFilter(); diskMessage.textContent = ""; });
  button("disk-export").onclick = () => act(() => {
    if (!session.diskName || session.machine.io.disketteMotorOn) return;
    const filename = downloadDiskImage(session.diskName, ".img", session.machine.io.exportDiskette());
    diskMessage.textContent = `Exported ${filename}.`;
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
