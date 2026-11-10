import type { CocoPias } from "../../src/machines/6809/coco/pias.js";

/** Physical input controls; the guest still performs its own joystick conversion. */
export function createCocoJoystickView(root: HTMLElement, pias: () => CocoPias, changed: () => void) {
  const controls = (["right", "left"] as const).map(port => {
    const panel = root.querySelector<HTMLElement>(`[data-joystick="${port}"]`)!;
    const x = panel.querySelector<HTMLInputElement>("[data-joystick-x]")!;
    const y = panel.querySelector<HTMLInputElement>("[data-joystick-y]")!;
    const connected = panel.querySelector<HTMLInputElement>("[data-joystick-connected]")!;
    const fire = panel.querySelector<HTMLButtonElement>("[data-joystick-fire]")!;
    const centre = panel.querySelector<HTMLButtonElement>("[data-joystick-centre]")!;
    const position = () => { pias().setJoystickPosition(port, Number(x.value), Number(y.value)); changed(); };
    x.addEventListener("input", position); y.addEventListener("input", position);
    connected.addEventListener("change", () => {
      pias().setJoystickButton(port, false); pias().connectJoystick(port, connected.checked); changed();
    });
    fire.addEventListener("click", () => { pias().setJoystickButton(port, !pias().joystick(port).pressed); changed(); });
    centre.addEventListener("click", () => { pias().setJoystickPosition(port, 32, 32); changed(); });
    return { port, x, y, connected, fire, centre,
      xValue: panel.querySelector<HTMLOutputElement>("[data-joystick-x-value]")!,
      yValue: panel.querySelector<HTMLOutputElement>("[data-joystick-y-value]")! };
  });
  return {
    refresh(unavailable: boolean): void {
      for (const control of controls) {
        const state = pias().joystick(control.port);
        control.connected.checked = state.connected; control.connected.disabled = unavailable;
        control.x.value = control.xValue.value = String(state.x);
        control.y.value = control.yValue.value = String(state.y);
        control.fire.setAttribute("aria-pressed", String(state.pressed));
        for (const element of [control.x, control.y, control.fire, control.centre]) element.disabled = unavailable || !state.connected;
      }
    },
  };
}
