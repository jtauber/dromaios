import type { JoystickGamepad } from "../../site/interactive/coco-joystick-input.js";

/** A browser-standard controller report; indices follow the W3C standard layout. */
export function standardGamepad(axes: readonly number[] = [0, 0], pressed: readonly number[] = [], index = 0): JoystickGamepad {
  return { index, id: `Test controller ${index}`, mapping: "standard", connected: true, axes,
    buttons: Array.from({ length: 17 }, (_, button) => ({ pressed: pressed.includes(button) })) };
}
