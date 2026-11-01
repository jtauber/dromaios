import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { captureMemory, memoryViewport, parseMemoryAddress } from "../../site/interactive/memory-window.js";
import { parseXtAddress, readXtStorage } from "../../site/interactive/xt-inspection.js";
import { xtStorageRegions } from "../../site/xt-storage-regions.js";
import { create8088PcXt } from "../../src/machines/generated/8088/pc-xt.js";
import { parseMachine } from "../../src/machines/machine-language.js";
import { machineChapterSource } from "../../src/machines/machine-chapter.js";
import { decodeWorkspaceState, encodeWorkspaceState } from "../../site/interactive/workspace/state.js";
import { groups } from "../../site/interactive/workspace/layout.js";
import { migrateXtWorkspace, xtWorkspaceKey } from "../../site/interactive/xt-workspace.js";

test("XT memory accepts physical addresses and segment aliases, with 20-bit wrap only on projection", () => {
  for (const text of ["FFFF0", "$FFFF0", "0xffff0", "ffff:0000", "F000:FFF0", " 0xf000 : $fff0 "]) assert.equal(parseXtAddress(text), 0xffff0);
  assert.equal(parseXtAddress("FFFF:0010"), 0);
  assert.equal(parseXtAddress("FFFF:FFFF"), 0xffef);
  assert.equal(parseXtAddress("0:0"), 0);
  assert.equal(parseXtAddress("10000"), 0x10000);
  for (const text of ["", "100000", "FFFFF0", "10000:0", "0:10000", "-1", "1.5", "0x", ":0", "0:", "1:2:3", "xyz", "123abc456"]) {
    assert.throws(() => parseXtAddress(text), RangeError, text);
  }
  assert.throws(() => parseMemoryAddress("10000"), RangeError);
  assert.equal(parseMemoryAddress("$FFFF"), 0xffff);
});

test("memory scrolling covers both address spaces at 8 and 16 bytes per row without wrapping the final row", () => {
  for (const size of [0x10000, 0x100000]) for (const width of [8, 16] as const) {
    for (const row of [0, 0xfff0 / width, 0x10000 / width, size / width - 1]) {
      const view = memoryViewport(row * 20, 113, width, 20, size);
      assert.equal(view.totalHeight, size / width * 20);
      assert.ok(view.start >= 0 && view.start + view.length <= size);
      assert.ok(view.length <= 10 * width);
    }
    const last = memoryViewport(1e9, 113, width, 20, size);
    assert.equal(last.start + last.length, size);
    assert.equal(last.address, size - width);
    assert.equal(memoryViewport(-20, 0, width, 20, size).address, 0);
  }
  assert.equal(memoryViewport(1e9, 113, 16, 20).address, 0xfff0);
});

test("held 20-bit images include RAM, both CGA aliases, and gaps without servicing pending keyboard input", t => {
  const file = "src/machines/8088/pc-xt.md";
  const parsed = parseMachine(machineChapterSource(readFileSync(file, "utf8"), file), file);
  assert.ok("connection" in parsed);
  const regions = xtStorageRegions(parsed), machine = create8088PcXt({ bios: null, basic: null, font: null });
  machine.ram.write(0xffff, 0x7a); machine.ram.write(0x10000, 0x3b); machine.ram.write(0x9ffff, 0x49);
  machine.video.write(0x12, 0x81);
  machine.io.write(0x63, 0x99); machine.io.write(0x61, 0x40);
  assert.ok(machine.io.offerScanCode(0x1e));
  t.mock.method(machine.memory, "read", () => assert.fail("Guest memory read"));
  t.mock.method(machine.ports, "readPort", () => assert.fail("Guest port read"));
  const before = machine.snapshot();
  const read = (address: number) => readXtStorage(machine, regions, address);
  const image = captureMemory(read, 0x100000);
  assert.equal(image.length, 0x100000);
  assert.deepEqual([image[0xffff], image[0x10000], image[0x9ffff], image[0xb8012], image[0xbc012]], [0x7a, 0x3b, 0x49, 0x81, 0x81]);
  for (const location of [0xa0000, 0xc0000, 0xf0000, 0xfffff]) assert.equal(image[location], -1);
  assert.deepEqual(machine.snapshot(), before);
  machine.ram.write(0x10000, 0x99);
  assert.equal(image[0x10000], 0x3b);
  assert.equal(captureMemory(read, 0x100000)[0x10000], 0x99);
  assert.equal(captureMemory(read).length, 0x10000);
});

test("XT version-2 layouts gain Memory once and retain deliberately hidden and tabbed inspectors", () => {
  const old = { root: { kind: "tabs", id: "my-tools", active: "code", panels: ["code", "snapshot"], collapsed: false } } as const;
  const saved = new Map([["dromaios:workspace:xt:2", encodeWorkspaceState(old)]]);
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, text: string) => saved.set(key, text) };
  migrateXtWorkspace(storage);
  const next = decodeWorkspaceState(saved.get(xtWorkspaceKey)!, ["code", "snapshot", "memory", "debugger"]);
  assert.deepEqual(groups(next).map(group => group.panels), [["code", "snapshot"], ["debugger"], ["memory"]]);
  assert.deepEqual(groups(next)[0], old.root);
  saved.set(xtWorkspaceKey, encodeWorkspaceState(old));
  migrateXtWorkspace(storage);
  assert.equal(saved.get(xtWorkspaceKey), encodeWorkspaceState(old));
});
