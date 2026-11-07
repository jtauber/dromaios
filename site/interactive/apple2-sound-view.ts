import { createSpeakerPlayback } from "./speaker-samples.js";
import { createSpeakerAudioOutput } from "./speaker-audio-output.js";

/** Sound is an opt-in observer. Audio failures must never interrupt the guest CPU. */
export function createApple2Sound(root: HTMLElement, machine: () => {
  readonly clock: { readonly ticks: number; readonly hertz: number | undefined };
  readonly speaker: { level(): boolean };
}) {
  const button = root.querySelector<HTMLButtonElement>("[data-apple2-sound]")!;
  const status = root.querySelector<HTMLElement>("[data-sound-status]")!;
  let context: AudioContext | undefined, playback: ReturnType<typeof createSpeakerPlayback> | undefined;
  let enabled = false, generation = 0, error = "", running = false, normal = true, unavailable = false;
  function failed(cause: unknown): void {
    try { playback?.stop(); } catch { /* A failed audio backend must not reach the CPU. */ }
    enabled = false;
    error = `Sound unavailable: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
  function refresh(): void {
    try {
      const current = machine();
      playback?.sync(current.clock, current.speaker.level(), enabled && running && normal && !unavailable && context?.state === "running");
    } catch (cause) { failed(cause); }
    button.disabled = unavailable;
    button.setAttribute("aria-pressed", String(enabled));
    status.textContent = error || (!enabled ? "Off" : !normal ? "Muted in Unlimited" : !running ? "Paused"
      : context?.state !== "running" ? "Suspended by browser" : "On");
  }
  button.addEventListener("click", () => {
    const token = ++generation;
    if (enabled) { enabled = false; refresh(); return; }
    error = "";
    try {
      if (!context || context.state === "closed") {
        context = new AudioContext();
        const hertz = machine().clock.hertz;
        if (hertz === undefined) throw new Error("The machine has no declared clock frequency.");
        playback = createSpeakerPlayback(createSpeakerAudioOutput(context), hertz);
        context.addEventListener("statechange", refresh);
      }
      enabled = true;
      // Called directly in a user gesture; browsers may reject or suspend audio.
      void context.resume().then(() => { if (generation === token) refresh(); }, cause => {
        if (generation === token) { failed(cause); refresh(); }
      });
    } catch (cause) { failed(cause); }
    refresh();
  });
  button.disabled = false;
  return {
    observe(): void {
      try { const current = machine(); playback?.observe(current.clock.ticks, current.speaker.level()); }
      catch (cause) { failed(cause); }
    },
    refresh(state: { readonly running: boolean; readonly normal: boolean; readonly unavailable: boolean }): void {
      ({ running, normal, unavailable } = state); refresh();
    },
  };
}
