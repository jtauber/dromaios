import type { CocoPias } from "../../src/machines/6809/coco/pias.js";
import { cocoTapeSampleRate } from "../../src/components/devices/coco-cassette.js";
import { cocoTapeFileLimit, readCocoTapeWav, writeCocoTapeWav } from "../../src/components/devices/coco-tape-wav.js";

/** Recorder controls operate the native transport; they never inspect or modify BASIC. */
export function createCocoCassetteView(root: HTMLElement, pias: () => CocoPias, controls: {
  changed(): void; pause(): void; selecting(value: boolean): void;
}) {
  const at = <T extends HTMLElement>(id: string) => root.querySelector<T>(`[data-cassette-${id}]`)!;
  const file = at<HTMLInputElement>("file"), name = at<HTMLInputElement>("name"), status = at("status"), message = at("message");
  const buttons = Object.fromEntries(["blank", "load", "export", "eject", "copy", "play", "record", "stop", "rewind"]
    .map(id => [id, at<HTMLButtonElement>(id)]));
  function action(work: () => void): void {
    try { work(); message.textContent = ""; }
    catch (cause) { message.textContent = cause instanceof Error ? cause.message : String(cause); }
    controls.changed();
  }
  buttons.blank!.addEventListener("click", () => action(() => pias().cassette.blank(name.value)));
  buttons.eject!.addEventListener("click", () => action(() => pias().cassette.eject()));
  buttons.copy!.addEventListener("click", () => action(() => pias().cassette.writableCopy()));
  for (const mode of ["play", "record", "stop", "rewind"] as const) {
    buttons[mode]!.addEventListener("click", () => action(() => pias().cassette[mode]()));
  }
  buttons.load!.addEventListener("click", () => file.click());
  file.addEventListener("change", () => { void (async () => {
    const selected = file.files?.[0]; if (!selected) return;
    controls.pause(); controls.selecting(true); message.textContent = "Reading tape…";
    try {
      if (selected.size > cocoTapeFileLimit) throw new Error("Choose a WAV tape of at most one minute.");
      const samples = readCocoTapeWav(new Uint8Array(await selected.arrayBuffer()));
      pias().cassette.insert(selected.name, samples); message.textContent = "Tape loaded read-only. Rewind and Play, then enter CLOAD.";
    } catch (cause) { message.textContent = cause instanceof Error ? cause.message : String(cause); }
    finally { file.value = ""; controls.selecting(false); controls.changed(); }
  })(); });
  buttons.export!.addEventListener("click", () => action(() => {
    const tape = pias().cassette, filename = tape.inspect().name!.replace(/(?:-saved)?\.wav$/i, "") + "-saved.wav";
    const bytes = writeCocoTapeWav(tape.samples());
    const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: "audio/wav" }));
    const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
  return {
    refresh(unavailable: boolean, running: boolean): void {
      const tape = pias().cassette.inspect(), mounted = tape.name !== null;
      at("medium").textContent = mounted ? `${tape.name} · ${tape.writable ? "Writable" : "Read-only"}` : "No tape mounted";
      status.textContent = `${{ stop: "Stopped", play: "Play", record: "Record" }[tape.mode]} · Motor ${pias().cassetteMotor ? "on" : "off"}`
        + ` · ${(tape.position / cocoTapeSampleRate).toFixed(2)} / ${(tape.length / cocoTapeSampleRate).toFixed(2)} s`;
      const progress = at<HTMLProgressElement>("progress"); progress.max = tape.length || 1; progress.value = tape.position;
      name.disabled = unavailable || running;
      for (const button of Object.values(buttons)) button.disabled = unavailable;
      for (const id of ["load", "blank", "eject", "copy", "export"]) buttons[id]!.disabled ||= running;
      for (const id of ["eject", "copy", "export", "rewind", "stop", "record", "play"]) buttons[id]!.disabled ||= !mounted;
      buttons.copy!.disabled ||= tape.writable;
      buttons.record!.disabled ||= !tape.writable;
      buttons.play!.disabled ||= tape.position >= tape.length;
      for (const mode of ["play", "record", "stop"] as const) buttons[mode]!.setAttribute("aria-pressed", String(tape.mode === mode));
    },
  };
}
