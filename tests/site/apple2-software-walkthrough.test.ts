import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import { softwareCheckpointMatches, softwareInspectionAvailable, softwareWalkthroughAvailable } from "../../site/interactive/apple2-software-walkthrough.js";
import type { SoftwareCheckpoint, SoftwareWalkthrough } from "../../site/interactive/apple2-software-walkthrough.js";

const record = JSON.parse(readFileSync("docs/software/ultima-iv.md", "utf8").match(/```json\n([\s\S]*?)```/)![1]!);
const step: SoftwareCheckpoint = { title: "Combat command", address: "71D7", bytes: record.combat.stops.command.bytes,
  prepare: "Wait for combat.", observe: "Combat mode.", when: [{ address: 11, bytes: [128] }], inspect: [], limit: 1000 };
const tour: SoftwareWalkthrough = { id: "test", title: "Loaded game", setup: "", requires: [record.stops.command, record.save.start], steps: [step] };

test("software stops require loaded instructions and matching mode, without operating guest hardware", () => {
  const { machine } = createApple2Session();
  assert.equal(softwareWalkthroughAvailable(undefined, tour), false);
  assert.equal(softwareWalkthroughAvailable(machine, tour), false);
  for (const { address, bytes } of tour.requires) bytes.forEach((byte, i) => machine.ram.write(address + i, byte));
  assert.equal(softwareWalkthroughAvailable(machine, tour), true);
  step.bytes.forEach((byte, i) => machine.ram.write(0x71d7 + i, byte));
  assert.equal(softwareCheckpointMatches(machine, step), false);
  machine.ram.write(11, 128);
  const before = machine.snapshot();
  assert.equal(softwareCheckpointMatches(machine, step), true);
  assert.deepEqual(machine.snapshot(), before);
  machine.ram.write(0x71d7, 0);
  assert.equal(softwareCheckpointMatches(machine, step), false);
  machine.ram.write(0x40c0, 0);
  assert.equal(softwareWalkthroughAvailable(machine, tour), false);
});

test("party and enemy links follow upper RAM mapping without toggling it", () => {
  const { machine } = createApple2Session();
  const party = { label: "Position", address: 0, space: "ram" as const };
  const health = { label: "Health", address: 0xec18, space: "lc-upper" as const };
  assert.equal(softwareInspectionAvailable(undefined, party), false);
  assert.equal(softwareInspectionAvailable(machine, party), true);
  assert.equal(softwareInspectionAvailable(machine, health), false);
  const before = machine.snapshot();
  for (let i = 0; i < 5; i++) softwareInspectionAvailable(machine, health);
  assert.deepEqual(machine.snapshot(), before);
  machine.language.read(0); // Explicit guest switch operation for this fixture only.
  assert.equal(softwareInspectionAvailable(machine, health), true);
  machine.language.read(2);
  assert.equal(softwareInspectionAvailable(machine, health), false);
});
