import assert from "node:assert/strict";
import { ultimaSteps } from "../helpers/ultima-v-guide.js";
import { test } from "node:test";
import { createXtSession } from "../../site/interactive/xt-session.js";
import { matchesXtDosObservation } from "../../site/interactive/xt-dos-observation.js";
import { matchesUltimaObservation } from "../../site/interactive/xt-ultima-v.js";
import type { UltimaObservation } from "../../site/interactive/xt-ultima-v.js";
import { xtCheckpointPosition } from "../../site/interactive/xt-rom-guide.js";

const steps = ultimaSteps<UltimaObservation>("ultima-v");

test("Prepare table tile stops on the packed byte before its in-place conversion", () => {
  const m = createXtSession().machine;
  const { expect } = ultimaSteps("ultima-v-ega-hut").find(step => step.title === "Prepare table tile")!;
  assert.ok("bytes" in expect);
  m.ram.write(0x9eac2, 0x88); m.ram.write(0x9eac3, 0x14); m.ram.write(0x914d9, 0x46);
  const cpu = { ...m.cpu.snapshot(), ds: 0x8ca3, si: 0x4aa9, dx: 0xdf };
  assert.ok(matchesXtDosObservation(expect, m, cpu));
  assert.equal(matchesXtDosObservation(expect, m, { ...cpu, si: 0x4aa5 }), false);
  m.ram.write(0x914d9, 0xdf);
  assert.equal(matchesXtDosObservation(expect, m, cpu), false);
});

test("Select table tile requires the staged table at the new screen cell", () => {
  const m = createXtSession().machine;
  const { expect } = ultimaSteps("ultima-v-ega-hut").find(step => step.title === "Select table tile")!;
  assert.ok("bytes" in expect);
  [0x8a, 0x98, 0x02, 0xab].forEach((byte, i) => m.ram.write(0x11dff + i, byte));
  m.ram.write(0x268b9, 0x95);
  const cpu = { ...m.cpu.snapshot(), ds: 0x1bd3, bx: 0x80, si: 7, di: 4 };
  assert.ok(matchesXtDosObservation(expect, m, cpu));
  for (const other of [{ bx: 0xa0, di: 5 }, { bx: 0xa0 }, { si: 6 }]) {
    assert.equal(matchesXtDosObservation(expect, m, { ...cpu, ...other }), false);
  }
  m.ram.write(0x268b9, 0x94);
  assert.equal(matchesXtDosObservation(expect, m, cpu), false);
});

test("the hut Y stop distinguishes Down from Up at the same ADD instruction", () => {
  const { ram, cpu } = createXtSession().machine;
  const { expect } = ultimaSteps<UltimaObservation>("ultima-v-ega-hut").find(step => step.title === "Update party Y")!;
  ram.write(0x215c3, 13); ram.write(0x215c6, 15); ram.write(0x215c7, 15);
  const down = { ...cpu.snapshot(), ds: 0x1bd3, ax: 1 };
  assert.ok(matchesUltimaObservation(expect, down, ram));
  assert.equal(matchesUltimaObservation(expect, { ...down, ax: 0xffff }, ram), false);
});

test("the exchange checkpoint recognizes the missing save, including its terminating NUL", () => {
  const { ram, cpu } = createXtSession().machine;
  const state = { ...cpu.snapshot(), ax: 2, ds: 0x2000, dx: 0xffff, flags: { ...cpu.snapshot().flags, cf: true } };
  const expect = steps[0]!.expect!;
  for (const [i, char] of [..."SAVED.GAM"].entries()) ram.write(0x20000 + ((0xffff + i) & 0xffff), char.charCodeAt(0));
  assert.ok(matchesUltimaObservation(expect, state, ram));
  assert.equal(matchesUltimaObservation(expect, { ...state, ax: 3 }, ram), false);
  assert.equal(matchesUltimaObservation(expect, { ...state, ds: 0xffff }, ram), false);
  ram.write(0x20008, 0x58);
  assert.equal(matchesUltimaObservation(expect, state, ram), false);
});

test("the hut, movement and reload checkpoints distinguish guest state at shared game addresses", () => {
  const { ram, cpu } = createXtSession().machine;
  const state = { ...cpu.snapshot(), ax: 4192, ds: 0x1bd3, dx: 0x55a6, flags: { ...cpu.snapshot().flags, cf: false } };
  const match = (index: number) => matchesUltimaObservation(steps[index]!.expect!, state, ram);
  ram.write(0x215c3, 13); ram.write(0x215c6, 15); ram.write(0x215c7, 15);
  assert.ok(match(1)); assert.equal(match(2), false); assert.equal(match(4), false);
  ram.write(0x215c7, 16);
  assert.ok(match(2)); assert.equal(match(1), false);
  ram.write(0x215c3, 0); ram.write(0x215c6, 46); ram.write(0x215c7, 62);
  assert.ok(match(3)); assert.ok(match(4)); assert.equal(match(6), false);
  for (const change of [{ ax: 512 }, { dx: 0x100 }, { flags: { ...state.flags, cf: true } }]) {
    assert.equal(matchesUltimaObservation(steps[3]!.expect!, { ...state, ...change }, ram), false);
  }
  const poll = { address: 0xe45c, space: "CS:IP 0C6F:1D6C" };
  assert.match(xtCheckpointPosition(steps[1]!, poll, true, false, () => match(1)), /does not yet match/);
  assert.match(xtCheckpointPosition(steps[4]!, poll, true, false, () => match(4)), /^At checkpoint/);
  ram.write(0x215c6, 45);
  assert.ok(match(5)); assert.ok(match(6)); assert.equal(match(3), false);
  const readReturn = { address: 0x13966, space: "CS:IP 0C6F:7276" };
  assert.match(xtCheckpointPosition(steps[6]!, poll, true, false, () => match(6)), /^Paused at/);
  assert.match(xtCheckpointPosition(steps[6]!, readReturn, true, false, () => match(6)), /^At checkpoint/);
});
