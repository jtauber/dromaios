import assert from "node:assert/strict";
import { test } from "node:test";
import { createFirstExampleMemory } from "../../src/machines/first-example.js";

test("the first example loads exactly the specified program into 64 KiB of zeroed RAM", () => {
  const ram = createFirstExampleMemory();
  // Expected bytes are stated independently of the loader, from the specification.
  const expectedProgram = [0x3e, 0x02, 0xc6, 0x03, 0x32, 0x80, 0x00, 0x76];
  assert.equal(ram.size, 65_536);
  for (const [address, value] of expectedProgram.entries()) {
    assert.equal(ram.read(address), value, `program byte at ${address}`);
  }
  for (let address = expectedProgram.length; address < ram.size; address++) {
    assert.equal(ram.read(address), 0, `zero byte at ${address}`);
  }
});

test("each setup creates independent memory with the original program and zero result", () => {
  const first = createFirstExampleMemory();
  first.write(0x0000, 0);
  first.write(0x0080, 5);
  first.write(0xffff, 0xff);

  const second = createFirstExampleMemory();
  assert.equal(second.read(0x0000), 0x3e);
  assert.equal(second.read(0x0080), 0);
  assert.equal(second.read(0xffff), 0);
  assert.equal(first.read(0x0000), 0);
  assert.equal(first.read(0x0080), 5);
  assert.equal(first.read(0xffff), 0xff);

  second.write(0x0080, 9);
  assert.equal(first.read(0x0080), 5);
});
