import { romImages } from "../../src/machines/generated/8088/pc-xt.js";
import { xtOscillatorHz } from "../../src/machines/8088/pc-xt/clock.js";
import { createExecutionController } from "./execution-controller.js";
import { readRomFile } from "./rom-file.js";
import { romFileStorage } from "./rom-storage.js";
import { createWorkspace } from "./workspace/dock.js";
import { mountWorkspaceControls } from "./workspace/controls.js";
import type { TabGroup } from "./workspace/layout.js";
import { createXtSession } from "./xt-session.js";
import type { XtRomSlot } from "./xt-session.js";
import { xtKeySupported } from "./xt-keyboard.js";
import { createXtScreen } from "./xt-screen.js";
import { decodeXtCheckpoint, encodeXtCheckpoint, xtCheckpointKey } from "./xt-checkpoint.js";

const group = (id: string): TabGroup => ({ kind: "tabs", id: "xt-" + id, active: id, panels: [id], collapsed: false });
const hex = (number: number, digits: number) => number.toString(16).toUpperCase().padStart(digits, "0");

for (const root of document.querySelectorAll<HTMLElement>("[data-xt-laboratory]")) mount(root);

function mount(root: HTMLElement): void {
  const at = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`)!;
  const button = (name: string) => at<HTMLButtonElement>(name);
  const screen = at("screen"), message = at("message"), status = at("execution");
  const display = createXtScreen(root.querySelector("canvas")!, at("screen-text"), at("screen-notice"));
  const session = createXtSession();
  const slots = [...root.querySelectorAll<HTMLElement>("[data-slot]")].map(panel => {
    const id = panel.dataset.slot as XtRomSlot;
    return { id, file: panel.querySelector("input")!, load: panel.querySelector<HTMLButtonElement>("[data-load]")!,
      forget: panel.querySelector<HTMLButtonElement>("[data-forget]")!, status: panel.querySelector<HTMLElement>("[data-slot-status]")!,
      storage: romFileStorage(() => localStorage, "dromaios:xt-rom:" + id + ":v1", romImages[id].size,
        file => readRomFile(file, romImages[id])), remembered: false };
  });
  let loading = true, saved = false, lastDraw = -Infinity;
  const execution = createExecutionController({
    step: () => session.step(), canStep: () => session.ready && !loading,
    onChange: refresh, batchSize: 8192,
    schedule(callback, ms) { const id = window.setTimeout(callback, ms); return () => window.clearTimeout(id); },
  });
  execution.setDelay(1);

  function refresh(): void {
    const running = execution.running, ready = session.ready && !loading, runnable = ready && !execution.error;
    button("run").disabled = button("step").disabled = !runnable || running;
    button("pause").disabled = !running;
    button("reset").disabled = button("power").disabled = !ready || running;
    button("break").disabled = button("warm").disabled = !runnable;
    button("save").disabled = !ready || running;
    button("restore").disabled = !ready || running || !saved;
    button("remove").disabled = loading || running || !saved;
    for (const slot of slots) { slot.load.disabled = loading || running; slot.forget.disabled = loading || running || !slot.remembered; }

    const cpu = session.machine.cpu.snapshot(), seconds = session.machine.io.oscillatorTicks / xtOscillatorHz;
    status.textContent = [running ? "Running" : ready ? "Paused" : "Waiting for firmware",
      `CS:IP ${hex(cpu.cs, 4)}:${hex(cpu.ip, 4)} · physical ${hex(cpu.pc, 5)}`, `${seconds.toFixed(2)} s on the XT`,
      session.keyboard.queuedBytes ? `${session.keyboard.queuedBytes} scan bytes queued` : "",
      session.keyboard.pasteRemaining ? `${session.keyboard.pasteRemaining} characters to paste` : ""].filter(Boolean).join(" · ");
    at("error").textContent = execution.error ?? "";
    const now = performance.now();
    if (screen.getClientRects().length && (!running || now - lastDraw >= 65)) {
      display(session.machine, ready); lastDraw = now;
    }
  }
  function act(work: () => void) {
    try { message.textContent = ""; work(); }
    catch (error) { message.textContent = error instanceof Error ? error.message : String(error); }
    refresh();
  }
  button("run").onclick = () => { message.textContent = ""; execution.run(); screen.focus(); };
  button("pause").onclick = () => execution.stop();
  button("step").onclick = () => execution.step();
  button("reset").onclick = () => act(() => { execution.reset(); session.resetCpu(); });
  button("power").onclick = () => act(() => { execution.reset(); session.powerOn(); });
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
  function leaveWindow() { session.keyboard.releaseHeld(); execution.stop(); }
  window.addEventListener("blur", leaveWindow);
  window.addEventListener("pagehide", leaveWindow);
  document.addEventListener("visibilitychange", () => { if (document.hidden) leaveWindow(); });

  button("save").onclick = () => act(() => {
    localStorage.setItem(xtCheckpointKey, encodeXtCheckpoint(session.snapshot()));
    saved = true; at("saved").textContent = "XT checkpoint saved in this browser.";
  });
  button("restore").onclick = () => act(() => {
    const value = localStorage.getItem(xtCheckpointKey);
    if (value === null) throw new Error("No saved XT checkpoint.");
    session.restore(decodeXtCheckpoint(value)); execution.reset();
    message.textContent = "Session restored and paused.";
  });
  button("remove").onclick = () => act(() => {
    localStorage.removeItem(xtCheckpointKey); saved = false; at("saved").textContent = "No checkpoint saved.";
  });

  for (const slot of slots) {
    slot.load.onclick = () => slot.file.click();
    slot.file.onchange = async () => {
      const file = slot.file.files?.[0]; if (!file || loading || execution.running) return;
      loading = true; message.textContent = `Checking ${file.name}…`; refresh();
      try {
        const media = await slot.storage.prepare(file);
        session.install(slot.id, media.rom.image); slot.status.textContent = media.rom.name + " · verified";
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
  const panels = [...root.querySelectorAll<HTMLElement>("[data-workspace-panel]")].map(content => ({
    content, id: content.dataset.workspacePanel!, title: content.dataset.panelTitle!,
    heading: content.dataset.panelHeading, detail: content.dataset.panelDetail,
  }));
  const workspace = createWorkspace(at("workspace-root"), at("workspace-panels"), panels, {
    defaults: { root: { kind: "split", id: "xt-columns", axis: "horizontal", items: [
      { weight: .68, node: { kind: "split", id: "xt-console", axis: "vertical", items: [
        { weight: .77, node: group("screen") }, { weight: .23, node: group("execution") }] } },
      { weight: .32, node: { kind: "split", id: "xt-session", axis: "vertical", items: [
        { weight: .65, node: group("rom") }, { weight: .35, node: group("snapshot") }] } },
    ] } }, storageKey: "dromaios:workspace:xt:1", onShow: () => queueMicrotask(refresh),
    onStatus: text => { layoutStatus.textContent = text; },
  });
  mountWorkspaceControls(controls, workspace, layoutStatus);
  try {
    saved = localStorage.getItem(xtCheckpointKey) !== null;
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
