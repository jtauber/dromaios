import assert from "node:assert/strict";
import { test } from "node:test";
import { createProgramHistory } from "../../site/interactive/program-history.js";

test("backward jumps retain lifetime visits while the recent PC path stays bounded", () => {
  const history = createProgramHistory(0x100, [0x100, 0x103, 0x105, 0x108]);
  history.record({ address: 0x100, bytes: [0x3a, 3, 0] }, 0x103);
  const transitions = [
    [{ address: 0x103, bytes: [0xc6, 1] }, 0x105],
    [{ address: 0x105, bytes: [0x32, 4, 0] }, 0x108],
    [{ address: 0x108, bytes: [0xc3, 3, 1] }, 0x103],
  ] as const;
  for (let repeat = 0; repeat < 20; repeat++) {
    for (const [instruction, next] of transitions) history.record(instruction, next);
  }
  assert.deepEqual([...history.visits], [[0x100, 1], [0x103, 20], [0x105, 20], [0x108, 20]]);
  assert.deepEqual([...history.skipped], []);
  assert.equal(history.truncated, true);
  assert.deepEqual(history.path, [0x103, 0x105, 0x108, 0x103, 0x105, 0x108, 0x103, 0x105, 0x108, 0x103, 0x105, 0x108, 0x103]);
});

test("a forward jump marks only passed-over instructions, clearing the marker if later executed", () => {
  const history = createProgramHistory(0x100, [0x100, 0x103, 0x106, 0x108]);
  history.record({ address: 0x100, bytes: [0x3a, 3, 0] }, 0x103);
  history.record({ address: 0x103, bytes: [0xc3, 8, 1] }, 0x108);
  assert.deepEqual([...history.skipped], [0x106]);
  assert.deepEqual(history.path, [0x100, 0x103, 0x108]);
  assert.equal(history.truncated, false);
  history.record({ address: 0x108, bytes: [0xc3, 6, 1] }, 0x106);
  history.record({ address: 0x106, bytes: [0xc6, 1] }, 0x108);
  assert.deepEqual([...history.skipped], []);
  assert.equal(history.visits.get(0x106), 1);
  const fresh = createProgramHistory(0x100, [0x100, 0x103, 0x106, 0x108]);
  assert.deepEqual([...fresh.visits], []);
  assert.deepEqual([...fresh.skipped], []);
  assert.deepEqual(fresh.path, [0x100]);
  assert.equal(history.visits.get(0x106), 1);
});
