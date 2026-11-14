import type { createCocoSession } from "./coco-session.js";

/** Inserting or removing a Program Pak starts fresh hardware, just like switching off to change it. */
export function createCocoCartridgeView(root: HTMLElement, session: () => ReturnType<typeof createCocoSession>, controls: {
  changed(): void; pause(): void; selecting(value: boolean): void;
}) {
  const at = <T extends HTMLElement>(id: string) => root.querySelector<T>(`[data-cartridge-${id}]`)!;
  const file = at<HTMLInputElement>("file"), load = at<HTMLButtonElement>("load"), eject = at<HTMLButtonElement>("eject");
  const message = at("message");
  let observedMachine = session().machine;
  load.addEventListener("click", () => file.click());
  file.addEventListener("change", () => { void (async () => {
    const selected = file.files?.[0]; if (!selected) return;
    controls.pause(); controls.selecting(true); message.textContent = "Reading cartridge…";
    try {
      if (![2048, 4096, 8192, 16384].includes(selected.size)) throw new Error("Choose a raw 2, 4, 8, or 16 KiB ROM cartridge (.ccc or .rom).");
      session().mountCartridge(selected.name, new Uint8Array(await selected.arrayBuffer()));
      controls.changed(); message.textContent = "Cartridge inserted. Run starts it through Color BASIC.";
    } catch (cause) { message.textContent = cause instanceof Error ? cause.message : String(cause); }
    finally { file.value = ""; controls.selecting(false); }
  })(); });
  eject.addEventListener("click", () => {
    try { session().ejectCartridge(); controls.changed(); message.textContent = "Cartridge removed. Run boots the installed BASIC ROMs."; }
    catch (cause) { message.textContent = cause instanceof Error ? cause.message : String(cause); }
  });
  return {
    refresh(unavailable: boolean, running: boolean): void {
      const current = session().machine;
      if (current !== observedMachine) { message.textContent = ""; observedMachine = current; }
      const cartridge = current.cartridge.snapshot();
      at("status").textContent = cartridge.image ? `${cartridge.name} · ${cartridge.image.length / 1024} KiB · Disk BASIC disconnected` : "No ROM cartridge inserted";
      load.disabled = unavailable || running; eject.disabled = load.disabled || cartridge.image === null;
    },
  };
}
