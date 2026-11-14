import type { createCocoSession } from "./coco-session.js";
import { cocoDiskSize } from "../../src/machines/6809/coco/disk-controller.js";

/** Host media controls and passive controller observation; BASIC performs every sector transfer. */
export function createCocoDiskView(root: HTMLElement, session: () => ReturnType<typeof createCocoSession>, controls: {
  changed(): void; pause(): void; selecting(value: boolean): void;
}) {
  const at = <T extends HTMLElement>(id: string) => root.querySelector<T>(`[data-disk-${id}]`)!;
  const file = at<HTMLInputElement>("file"), load = at<HTMLButtonElement>("load"), eject = at<HTMLButtonElement>("eject");
  const copy = at<HTMLButtonElement>("copy"), download = at<HTMLButtonElement>("export");
  const message = at("message");
  let observedMachine = session().machine;
  function action(work: () => void): void {
    try { work(); message.textContent = ""; }
    catch (cause) { message.textContent = cause instanceof Error ? cause.message : String(cause); }
    controls.changed();
  }
  copy.addEventListener("click", () => action(() => session().machine.disk.writableCopy()));
  download.addEventListener("click", () => action(() => {
    const current = session(), bytes = current.machine.disk.exportImage();
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const link = document.createElement("a"); link.href = url;
    link.download = current.diskName!.replace(/(?:-saved)?\.(?:dsk|img)$/i, "") + "-saved.dsk";
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
  load.addEventListener("click", () => file.click());
  file.addEventListener("change", () => { void (async () => {
    const selected = file.files?.[0]; if (!selected) return;
    controls.pause(); controls.selecting(true); message.textContent = "Reading disk…";
    try {
      if (selected.size !== cocoDiskSize) throw new Error("Choose a headerless 35-track, single-sided 161,280-byte disk image.");
      session().mountDisk(selected.name, new Uint8Array(await selected.arrayBuffer()));
      message.textContent = "Disk mounted read-only. In Disk BASIC, type DIR to list its files.";
    } catch (cause) { message.textContent = cause instanceof Error ? cause.message : String(cause); }
    finally { file.value = ""; controls.selecting(false); controls.changed(); }
  })(); });
  eject.addEventListener("click", () => {
    try { session().ejectDisk(); message.textContent = "Disk ejected."; }
    catch (cause) { message.textContent = cause instanceof Error ? cause.message : String(cause); }
    controls.changed();
  });
  return {
    refresh(unavailable: boolean, running: boolean): void {
      const current = session(), state = current.machine.disk.inspect(), busy = state.phase !== 0;
      // A restore or power-on supersedes the previous load/eject result.
      if (current.machine !== observedMachine) { message.textContent = ""; observedMachine = current.machine; }
      at("medium").textContent = current.diskName === null ? "No disk mounted" : `${current.diskName} · ${state.writable ? "Writable copy" : "Read-only"} · 35 tracks`;
      at("status").textContent = `${["Idle", "Seeking", "Finding sector", "Reading sector", "Completing", "Verifying", "Requesting first byte", "Writing sector"][state.phase]}`
        + ` · Motor ${state.control & 8 ? "on" : "off"} · Head ${state.cylinder} · Track ${state.track} · Sector ${state.sector}`;
      at("signals").textContent = `DRQ ${+state.drq} · INTRQ ${+state.intrq} · HALT ${+current.machine.disk.halted}`;
      const progress = at<HTMLProgressElement>("progress"); progress.value = state.byte_index;
      load.disabled = unavailable || running || busy;
      eject.disabled = load.disabled || current.diskName === null;
      copy.disabled = eject.disabled || state.writable;
      download.disabled = unavailable || running || current.diskName === null;
    },
  };
}
