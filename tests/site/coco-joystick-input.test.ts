import assert from "node:assert/strict";
import { test } from "node:test";
import { createCocoJoystickInput, cocoGamepadPosition } from "../../site/interactive/coco-joystick-input.js";
import { createCocoSession } from "../../site/interactive/coco-session.js";
import { cocoScreenKey } from "../../site/interactive/coco-input.js";
import { standardGamepad } from "../helpers/gamepad.js";

function example() {
  const session = createCocoSession(), input = createCocoJoystickInput(() => session.machine.pias);
  return { session, input, state: (port: "right" | "left" = input.port) => session.machine.pias.joystick(port) };
}
const centre = { connected: true, x: 32, y: 32, pressed: false };

test("joystick keys require explicit selection; normal typing and shortcuts retain their keyboard path", () => {
  const { session, input, state } = example(), before = session.snapshot();
  assert.equal(input.keyDown({ key: "ArrowLeft" }), false);
  assert.deepEqual(session.snapshot(), before);
  input.select("keyboard", "left"); input.setActive(true);
  for (const key of ["A", "Enter", "Escape", "Backspace"]) assert.equal(input.keyDown({ key }), false);
  for (const modifiers of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }]) {
    assert.equal(input.keyDown({ key: "ArrowLeft", ...modifiers }), false);
  }
  assert.deepEqual(state(), centre);
  const keyboard = session.machine.pias.snapshot().keyboard;
  assert.equal(input.keyDown({ key: "ArrowLeft" }), true);
  assert.equal(input.keyDown({ key: " " }), true);
  assert.deepEqual(state(), { ...centre, x: 0, pressed: true });
  assert.deepEqual(session.machine.pias.snapshot().keyboard, keyboard, "joystick keys never reach the keyboard matrix");
  input.select("sliders");
  const event = { key: "ArrowLeft", ctrlKey: false, altKey: false, metaKey: false, isComposing: false };
  assert.equal(input.keyDown(event), false); assert.deepEqual(cocoScreenKey(event), ["ArrowLeft"]);
});

test("held keys combine both axes and fire; opposing directions cancel and keyup restores the remaining direction", () => {
  const { input, state } = example(); input.select("keyboard"); input.setActive(true);
  for (const key of ["ArrowRight", "ArrowUp", " "]) input.keyDown({ key });
  assert.deepEqual(state(), { ...centre, x: 63, y: 0, pressed: true });
  input.keyDown({ key: "ArrowLeft" }); assert.equal(state().x, 32);
  input.keyUp({ key: "ArrowRight" }); assert.equal(state().x, 0);
  input.keyUp({ key: " " }); assert.equal(state().pressed, false);
  input.keyUp({ key: "ArrowLeft" }); input.keyUp({ key: "ArrowUp" }); assert.deepEqual(state(), centre);
});

test("pause and focus loss release live controls; repeats cannot reassert them after resume", () => {
  for (const releaseAll of [false, true]) {
    const { input, session, state } = example(); input.select("keyboard", "left"); input.setActive(true);
    session.machine.pias.connectJoystick("right", true);
    session.machine.pias.setJoystickPosition("right", 7, 58); session.machine.pias.setJoystickButton("right", true);
    input.keyDown({ key: "ArrowDown" }); input.keyDown({ key: " " });
    if (releaseAll) input.release(); else input.setActive(false);
    assert.deepEqual(state(), centre);
    assert.deepEqual(state("right"), { connected: true, x: 7, y: 58, pressed: !releaseAll });
    input.keyDown({ key: "ArrowRight" }); assert.deepEqual(state(), centre, "paused keys are not queued");
    input.setActive(true); input.keyDown({ key: "ArrowDown", repeat: true }); input.keyDown({ key: " ", repeat: true });
    assert.deepEqual(state(), centre);
    input.keyUp({ key: "ArrowDown" }); input.keyDown({ key: "ArrowDown" }); assert.equal(state().y, 63);
  }
});

test("switching sources or ports releases the old port and connects the new one without CPU time", () => {
  const { input, session, state } = example(), cpu = session.machine.cpu.snapshot();
  input.select("keyboard", "left"); input.setActive(true); input.keyDown({ key: "ArrowLeft" }); input.keyDown({ key: " " });
  input.select("keyboard", "right"); assert.deepEqual(state("left"), centre); assert.deepEqual(state(), centre);
  input.keyDown({ key: "ArrowDown" }); input.select("gamepad"); assert.deepEqual(state(), centre);
  assert.equal(input.keyDown({ key: "ArrowDown" }), false);
  assert.deepEqual(session.machine.cpu.snapshot(), cpu); assert.equal(session.machine.clock.ticks, 0);
});

test("standard gamepad axes cover 0–63 with a centre dead zone; D-pad overrides only its own axis", () => {
  for (const [axis, expected] of [[-1, 0], [-0.875, 5], [-0.15, 32], [0, 32], [0.15, 32], [0.875, 58], [1, 63], [2, 63], [NaN, 32]]) {
    assert.deepEqual(cocoGamepadPosition(standardGamepad([axis!, axis!])), { x: expected, y: expected, pressed: false });
  }
  assert.deepEqual(cocoGamepadPosition(standardGamepad([1, 0.875], [14, 0])), { x: 0, y: 58, pressed: true });
  assert.deepEqual(cocoGamepadPosition(standardGamepad([1, 1], [12, 13, 14, 15])), { x: 32, y: 32, pressed: false });
  assert.deepEqual(cocoGamepadPosition(standardGamepad([], [1, 2, 3])), { x: 32, y: 32, pressed: false });
});

test("gamepads require a neutral report after selecting, pausing, switching controllers and reconnecting", () => {
  const { input, state } = example(); input.select("gamepad", "left"); input.chooseGamepad(2); input.setActive(true);
  const held = standardGamepad([1, -1], [0], 2), neutral = standardGamepad([0, 0], [], 2);
  input.poll([null, standardGamepad([-1, -1], [0]), held]); assert.deepEqual(state(), centre); assert.equal(input.armed, false);
  input.poll([standardGamepad([0, 0], [12, 13, 14, 15], 2)]);
  assert.equal(input.armed, false, "opposing D-pad buttons cancel movement but are not released controls");
  input.poll([neutral]); assert.equal(input.armed, true);
  input.poll([held]); assert.deepEqual(state(), { ...centre, x: 63, y: 0, pressed: true });
  for (const pause of [() => input.release(), () => input.setActive(false), () => input.chooseGamepad(2), () => input.poll([])]) {
    pause(); assert.deepEqual(state(), centre); input.setActive(true);
    input.poll([held]); assert.deepEqual(state(), centre);
    input.poll([neutral]); input.poll([held]); assert.equal(state().pressed, true);
  }
  input.poll([{ ...held, id: "Replacement controller" }]); assert.deepEqual(state(), centre);
  input.poll([{ ...neutral, id: "Replacement controller" }]);
  input.poll([{ ...held, id: "Replacement controller" }]); assert.equal(state().pressed, true);
  input.poll([{ ...held, connected: false }]); assert.deepEqual(state(), centre);
});

test("paused, unavailable and nonstandard gamepad reports cannot press buttons", () => {
  const { input, state } = example(); input.select("gamepad"); input.chooseGamepad(0);
  input.poll([standardGamepad()]); assert.equal(input.armed, false);
  input.setActive(true); input.poll([{ ...standardGamepad(), mapping: "" }]); assert.equal(input.armed, false);
  input.poll([standardGamepad()]); input.poll([standardGamepad([1, 1], [0])]); assert.equal(state().pressed, true);
  input.poll([{ ...standardGamepad([1, 1], [0]), mapping: "" }]); assert.deepEqual(state(), centre);
});

test("restoring retains exact hardware inputs and drops host ownership until explicitly selected again", () => {
  for (const source of ["keyboard", "gamepad"] as const) {
    const { session, input, state } = example(); input.select(source, "left"); input.setActive(true);
    input.chooseGamepad(0); input.poll([standardGamepad()]);
    input.keyDown({ key: "ArrowRight" }); input.keyDown({ key: " " }); input.poll([standardGamepad([1, 0], [0])]);
    const saved = session.snapshot(); assert.equal(state().pressed, true);
    input.release(); session.powerOn(); input.reset(); session.restore(saved); input.reset();
    assert.deepEqual(session.snapshot(), saved); assert.equal(input.source, "sliders");
    input.setActive(true); input.keyDown({ key: "ArrowLeft" }); input.keyUp({ key: " " }); input.poll([standardGamepad([-1, -1], [0])]);
    assert.deepEqual(session.snapshot(), saved, "stale host input never overwrites a checkpoint");
    input.select(source, "left"); assert.deepEqual(state(), centre);
  }
});
