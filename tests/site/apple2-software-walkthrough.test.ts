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

test("a stored Heal mixture stop requires MIX and its Heal selection at the shared overlay address", () => {
  const { machine } = createApple2Session();
  const authored = record.walkthroughs.find((tour: { id: string }) => tour.id === "ultima4-magic").steps[2];
  const stored = record.magic.stops.mixtureStored;
  const checkpoint: SoftwareCheckpoint = { ...authored, address: stored.address.toString(16), bytes: stored.bytes };
  for (const [i, byte] of checkpoint.bytes.entries()) machine.ram.write(stored.address + i, byte);
  assert.equal(softwareCheckpointMatches(machine, checkpoint), false);
  const overlay = checkpoint.when[0]!;
  for (const [i, byte] of overlay.bytes.entries()) machine.ram.write(overlay.address + i, byte);
  machine.ram.write(0x8a09, 6); // Gate, not Heal.
  assert.equal(softwareCheckpointMatches(machine, checkpoint), false);
  machine.ram.write(0x8a09, 7);
  const before = machine.snapshot();
  assert.equal(softwareCheckpointMatches(machine, checkpoint), true);
  assert.deepEqual(machine.snapshot(), before);
  machine.ram.write(0x8800, 0x20); // A shop can replace MIX at the same address.
  assert.equal(softwareCheckpointMatches(machine, checkpoint), false);
});

test("the companion combat stops distinguish whose turn it is at the same instruction", () => {
  const { machine } = createApple2Session();
  const authored = record.walkthroughs.find((tour: { id: string }) => tour.id === "ultima4-companions");
  const stop = record.companions.stops.firstTurn;
  const checkpoints: SoftwareCheckpoint[] = authored.steps.slice(5, 7).map((step: SoftwareCheckpoint) => ({
    ...step, address: stop.address.toString(16), bytes: stop.bytes,
  }));
  for (const [i, byte] of (stop.bytes as number[]).entries()) machine.ram.write(stop.address + i, byte);
  machine.ram.write(11, 128); machine.ram.write(15, 2); machine.ram.write(0xd4, 1);
  assert.deepEqual(checkpoints.map(step => softwareCheckpointMatches(machine, step)), [true, false]);
  machine.ram.write(0xd4, 2);
  const before = machine.snapshot();
  assert.deepEqual(checkpoints.map(step => softwareCheckpointMatches(machine, step)), [false, true]);
  assert.deepEqual(machine.snapshot(), before);
  machine.ram.write(11, 1);
  assert.ok(checkpoints.every(step => !softwareCheckpointMatches(machine, step)));
});

test("room stops reject outdoor combat and require the selected actor and established exit", () => {
  const { machine } = createApple2Session();
  const authored = record.walkthroughs.find((tour: { id: string }) => tour.id === "ultima4-rooms");
  const stop = record.companions.stops.firstTurn;
  const checkpoint: SoftwareCheckpoint = { ...authored.steps[8], address: stop.address.toString(16), bytes: stop.bytes };
  for (const [i, byte] of (stop.bytes as number[]).entries()) machine.ram.write(stop.address + i, byte);
  for (const condition of checkpoint.when) for (const [i, byte] of condition.bytes.entries()) machine.ram.write(condition.address + i, byte);
  const before = machine.snapshot();
  assert.equal(softwareCheckpointMatches(machine, checkpoint), true);
  assert.deepEqual(machine.snapshot(), before);
  for (const [address, value] of [[11, 128], [0xd4, 1], [0x7a7d, 0], [0, 6]] as const) {
    const original = machine.ram.read(address); machine.ram.write(address, value);
    assert.equal(softwareCheckpointMatches(machine, checkpoint), false);
    machine.ram.write(address, original);
  }
});
