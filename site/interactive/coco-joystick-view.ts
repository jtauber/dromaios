import type { CocoPias } from "../../src/machines/6809/coco/pias.js";
import { createCocoJoystickInput } from "./coco-joystick-input.js";
import type { JoystickGamepad } from "./coco-joystick-input.js";

/** Physical input controls; the guest still performs its own joystick conversion. */
export function createCocoJoystickView(root: HTMLElement, pias: () => CocoPias, options: {
  readonly changed: () => void;
  readonly releaseKeyboard: () => void;
}) {
  const input = createCocoJoystickInput(pias), screen = root.querySelector<HTMLElement>("[data-coco-screen]")!;
  const gamepadControls = root.querySelector<HTMLElement>("[data-joystick-gamepad-controls]")!;
  const picker = root.querySelector<HTMLSelectElement>("[data-joystick-gamepad]")!;
  const status = root.querySelector<HTMLElement>("[data-joystick-status]")!;
  let running = false, unavailable = false, pads: readonly (JoystickGamepad | null)[] = [], padError = "";
  let listedPads = "";
  function focus(): void {
    input.setActive(running && !unavailable && document.hasFocus() && !document.hidden && document.activeElement === screen);
  }
  function poll(): void {
    if (input.source !== "gamepad") return;
    try {
      const available = typeof navigator.getGamepads === "function";
      pads = available ? navigator.getGamepads() : [];
      padError = available ? "" : "Gamepad input is unavailable in this browser.";
    } catch { pads = []; padError = "This browser has blocked gamepad access."; }
    if (input.gamepadIndex === null) {
      const first = pads.find(pad => pad?.connected && pad.mapping === "standard");
      if (first) input.chooseGamepad(first.index);
    }
    focus(); input.poll(pads);
  }
  const sources = (["sliders", "keyboard", "gamepad"] as const).map(source => {
    const button = root.querySelector<HTMLButtonElement>(`[data-joystick-source="${source}"]`)!;
    button.addEventListener("click", () => {
      options.releaseKeyboard(); input.select(source); poll(); options.changed();
    });
    return { source, button };
  });
  const ports = (["right", "left"] as const).map(port => {
    const button = root.querySelector<HTMLButtonElement>(`[data-joystick-port="${port}"]`)!;
    button.addEventListener("click", () => { input.select(input.source, port); poll(); options.changed(); });
    return { port, button };
  });
  picker.addEventListener("change", () => {
    input.chooseGamepad(picker.value === "" ? null : Number(picker.value)); poll(); options.changed();
  });
  screen.addEventListener("focus", () => { focus(); options.changed(); });
  screen.addEventListener("blur", () => { input.setActive(false); options.changed(); });
  for (const event of ["gamepadconnected", "gamepaddisconnected"]) {
    window.addEventListener(event, () => { poll(); options.changed(); });
  }
  const controls = (["right", "left"] as const).map(port => {
    const panel = root.querySelector<HTMLElement>(`[data-joystick="${port}"]`)!;
    const x = panel.querySelector<HTMLInputElement>("[data-joystick-x]")!;
    const y = panel.querySelector<HTMLInputElement>("[data-joystick-y]")!;
    const connected = panel.querySelector<HTMLInputElement>("[data-joystick-connected]")!;
    const fire = panel.querySelector<HTMLButtonElement>("[data-joystick-fire]")!;
    const centre = panel.querySelector<HTMLButtonElement>("[data-joystick-centre]")!;
    const position = () => { pias().setJoystickPosition(port, Number(x.value), Number(y.value)); options.changed(); };
    x.addEventListener("input", position); y.addEventListener("input", position);
    connected.addEventListener("change", () => {
      if (!connected.checked && input.port === port) input.select("sliders");
      pias().setJoystickButton(port, false); pias().connectJoystick(port, connected.checked); options.changed();
    });
    fire.addEventListener("click", () => { pias().setJoystickButton(port, !pias().joystick(port).pressed); options.changed(); });
    centre.addEventListener("click", () => { pias().setJoystickPosition(port, 32, 32); options.changed(); });
    return { port, x, y, connected, fire, centre,
      xValue: panel.querySelector<HTMLOutputElement>("[data-joystick-x-value]")!,
      yValue: panel.querySelector<HTMLOutputElement>("[data-joystick-y-value]")! };
  });
  return {
    keyDown: input.keyDown, keyUp: input.keyUp, release: input.release, poll,
    reset(): void { input.reset(); running = false; },
    refresh(blocked: boolean, isRunning: boolean): void {
      if (running && !isRunning) input.release();
      running = isRunning; unavailable = blocked; focus();
      for (const { source, button } of sources) {
        button.disabled = unavailable; button.setAttribute("aria-pressed", String(input.source === source));
      }
      for (const { port, button } of ports) {
        button.disabled = unavailable || input.source === "sliders";
        button.setAttribute("aria-pressed", String(input.port === port));
      }
      gamepadControls.hidden = input.source !== "gamepad"; picker.disabled = unavailable;
      const available = pads.filter((pad): pad is JoystickGamepad => pad !== null && pad.connected);
      const signature = JSON.stringify([input.gamepadIndex, available.map(pad => [pad.index, pad.id, pad.mapping])]);
      if (signature !== listedPads) {
        listedPads = signature; picker.replaceChildren(new Option("Choose gamepad", ""));
        for (const pad of available) {
          const option = new Option(`${pad.index + 1}: ${pad.id}${pad.mapping === "standard" ? "" : " (unsupported mapping)"}`, String(pad.index));
          option.disabled = pad.mapping !== "standard"; picker.add(option);
        }
        if (input.gamepadIndex !== null && !available.some(pad => pad.index === input.gamepadIndex)) {
          picker.add(new Option(`${input.gamepadIndex + 1}: disconnected`, String(input.gamepadIndex)));
        }
        picker.value = input.gamepadIndex === null ? "" : String(input.gamepadIndex);
      }
      status.textContent = input.source === "sliders" ? "Sliders retain positions. Hold fire toggles the button."
        : input.source === "keyboard" ? `Arrows + Space → ${input.port} joystick. ${input.active ? "Release keys to centre." : running ? "Click the screen to play." : "Run and click the screen to play."}`
          : padError || (!available.some(pad => pad.index === input.gamepadIndex && pad.mapping === "standard")
            ? "Connect a standard gamepad and press a button to make it available."
            : !input.active ? `${running ? "Click" : "Run and click"} the screen to use the gamepad.`
              : !input.armed ? "Centre the stick and release fire / D-pad to enable the gamepad."
                : `Left stick / D-pad + bottom face button → ${input.port} joystick.`);
      for (const control of controls) {
        const state = pias().joystick(control.port);
        control.connected.checked = state.connected; control.connected.disabled = unavailable;
        control.x.value = control.xValue.value = String(state.x);
        control.y.value = control.yValue.value = String(state.y);
        control.fire.setAttribute("aria-pressed", String(state.pressed));
        const live = input.source !== "sliders" && control.port === input.port;
        for (const element of [control.x, control.y, control.fire, control.centre]) element.disabled = unavailable || !state.connected || live;
      }
    },
  };
}
