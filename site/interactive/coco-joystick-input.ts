import type { CocoPias, CocoJoystickPort } from "../../src/machines/6809/coco/pias.js";

export type CocoJoystickSource = "sliders" | "keyboard" | "gamepad";
export interface JoystickGamepad {
  readonly index: number;
  readonly id: string;
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean }[];
}
interface JoystickPosition { readonly x: number; readonly y: number; readonly pressed: boolean }
interface JoystickKey {
  readonly key: string;
  readonly repeat?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly isComposing?: boolean;
}
const centre: JoystickPosition = { x: 32, y: 32, pressed: false };
const joystickKeys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "]);
const digitalAxis = (negative: boolean, positive: boolean): number => negative === positive ? 32 : negative ? 0 : 63;

/** Standard gamepad: left stick or D-pad, with the bottom face button as fire. */
export function cocoGamepadPosition(pad: JoystickGamepad): JoystickPosition {
  const pressed = (index: number) => pad.buttons[index]?.pressed === true;
  function axis(index: number, negative: number, positive: number): number {
    if (pressed(negative) || pressed(positive)) return digitalAxis(pressed(negative), pressed(positive));
    const value = pad.axes[index] ?? 0, deadZone = 0.15;
    if (!Number.isFinite(value) || Math.abs(value) <= deadZone) return 32;
    const scaled = Math.sign(value) * (Math.min(1, Math.abs(value)) - deadZone) / (1 - deadZone);
    return Math.round((scaled + 1) * 31.5);
  }
  return { x: axis(0, 14, 15), y: axis(1, 12, 13), pressed: pressed(0) };
}

/** Host controls change physical inputs only; they never execute CPU work or enter a checkpoint. */
export function createCocoJoystickInput(pias: () => CocoPias) {
  let source: CocoJoystickSource = "sliders", port: CocoJoystickPort = "right", active = false;
  let gamepadIndex: number | null = null, gamepadId: string | undefined, armed = false;
  const keys = new Set<string>();
  function write(position: JoystickPosition): void {
    const io = pias(), previous = io.joystick(port);
    if (previous.x !== position.x || previous.y !== position.y) io.setJoystickPosition(port, position.x, position.y);
    if (previous.pressed !== position.pressed) io.setJoystickButton(port, position.pressed);
  }
  function releaseOwned(): void {
    keys.clear(); armed = false;
    if (source !== "sliders") write(centre);
  }
  function keyboard(): void {
    write({ x: digitalAxis(keys.has("ArrowLeft"), keys.has("ArrowRight")),
      y: digitalAxis(keys.has("ArrowUp"), keys.has("ArrowDown")), pressed: keys.has(" ") });
  }
  return {
    get source() { return source; },
    get port() { return port; },
    get active() { return active; },
    get gamepadIndex() { return gamepadIndex; },
    get armed() { return armed; },
    select(next: CocoJoystickSource, target: CocoJoystickPort = port): void {
      releaseOwned(); source = next; port = target; gamepadId = undefined;
      if (source !== "sliders") { pias().connectJoystick(port, true); write(centre); }
    },
    chooseGamepad(index: number | null): void {
      releaseOwned(); gamepadIndex = index; gamepadId = undefined;
    },
    setActive(value: boolean): void {
      if (active && !value) releaseOwned();
      active = value;
    },
    /** Pause/focus loss releases both fire latches, including a manually held one. */
    release(): void { releaseOwned(); pias().releaseJoystickButtons(); active = false; },
    /** A replacement/restored machine keeps its exact inputs; no stale host state can overwrite it. */
    reset(): void {
      keys.clear(); source = "sliders"; active = false; armed = false; gamepadId = undefined;
    },
    keyDown(event: JoystickKey): boolean {
      if (source !== "keyboard" || !joystickKeys.has(event.key)
        || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false;
      if (active && !event.repeat) { keys.add(event.key); keyboard(); }
      return true;
    },
    keyUp(event: Pick<JoystickKey, "key">): boolean {
      if (source !== "keyboard" || !joystickKeys.has(event.key)) return false;
      if (keys.delete(event.key) && active) keyboard();
      return true;
    },
    /** Called once per host batch, never per instruction or by a memory inspector. */
    poll(pads: readonly (JoystickGamepad | null)[]): void {
      if (source !== "gamepad") return;
      const pad = pads.find(pad => pad?.index === gamepadIndex && pad.connected && pad.mapping === "standard");
      if (pad?.id !== gamepadId) { releaseOwned(); gamepadId = pad?.id; }
      if (!active) return;
      if (!pad) { releaseOwned(); return; }
      const position = cocoGamepadPosition(pad);
      if (!armed) {
        // A held control must return to neutral after pause, reconnection or reassignment.
        armed = position.x === 32 && position.y === 32 && !position.pressed
          && [12, 13, 14, 15].every(index => !pad.buttons[index]?.pressed);
        return;
      }
      write(position);
    },
  };
}
