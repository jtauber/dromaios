import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createXtSession } from "../../site/interactive/xt-session.js";
import { matchesUltimaObservation } from "../../site/interactive/xt-ultima-v.js";
import type { XtCheckpoint } from "../../site/interactive/xt-ultima-v.js";
import { xtCheckpointPosition } from "../../site/interactive/xt-rom-guide.js";

const guide = readFileSync("docs/machines/pc-xt-ultima-v.md", "utf8");
const { steps }: { steps: XtCheckpoint[] } = JSON.parse(guide.match(/^```json\n([\s\S]*?)^```$/m)![1]!);

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
  assert.ok(match(3)); assert.ok(match(4));
  for (const change of [{ ax: 512 }, { dx: 0x100 }, { flags: { ...state.flags, cf: true } }]) {
    assert.equal(matchesUltimaObservation(steps[3]!.expect!, { ...state, ...change }, ram), false);
  }
  const poll = { address: 0xe45c, space: "CS:IP 0C6F:1D6C" };
  assert.match(xtCheckpointPosition(steps[1]!, poll, true, false, () => match(1)), /does not yet match/);
  assert.match(xtCheckpointPosition(steps[4]!, poll, true, false, () => match(4)), /^At checkpoint/);
});
