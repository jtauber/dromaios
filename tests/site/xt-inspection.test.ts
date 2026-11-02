import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { instructionCatalogue8088 } from "../../site/8088-instruction-catalogue.js";
import { xtStorageRegions } from "../../site/xt-storage-regions.js";
import { decode8088, physical8088 } from "../../site/interactive/8088-disassembly.js";
import { readXtStorage, xtCodeRows } from "../../site/interactive/xt-inspection.js";
import { migrateXtWorkspace, xtWorkspaceKey } from "../../site/interactive/xt-workspace.js";
import { decodeWorkspaceState, encodeWorkspaceState } from "../../site/interactive/workspace/state.js";
import { groups } from "../../site/interactive/workspace/layout.js";
import { compileCpuChapter } from "../../src/components/cpus/semantics/literate/compile.js";
import { Cpu8088 } from "../../src/components/cpus/generated/8088-cpu.js";
import { Ram } from "../../src/components/memory/ram.js";
import { create8088PcXt } from "../../src/machines/generated/8088/pc-xt.js";
import { parseMachine } from "../../src/machines/machine-language.js";
import { machineChapterSource } from "../../src/machines/machine-chapter.js";
import { initialState } from "../components/cpus/8088/helpers.js";

const cpu = instructionCatalogue8088(compileCpuChapter(readFileSync("src/components/cpus/specifications/8088.md", "utf8")));
const file = "src/machines/8088/pc-xt.md";
const board = parseMachine(machineChapterSource(readFileSync(file, "utf8"), file), file);
if (!("connection" in board)) throw new Error("Expected an XT board");
const regions = xtStorageRegions(board);
const decode = (...bytes: number[]) => decode8088(cpu, 0xffff, 0, index => bytes[index]);

test("8088 Intel notation includes resolved far and relative targets, operands, and prefixes", () => {
  for (const [bytes, assembly] of [
    [[0xea, 0x5b, 0xe0, 0, 0xf0], "JMP F000:E05B"],
    [[0xeb, 0xfc], "JMP FFFF:FFFE"], [[0xe8, 0xfd, 0xff], "CALL FFFF:0000"],
    [[0x83, 0xe4, 0xfe], "AND SP, 0FFFEh"],
    [[0x74, 0xfe], "JE FFFF:0000"], [[0x83, 0x6e, 0xff, 0xfe], "SUB WORD PTR [BP-1h], 0FFFEh"],
    [[0x8b, 0xc4], "MOV AX, SP"], [[0x8a, 0x26, 0x34, 0x12], "MOV AH, BYTE PTR [1234h]"],
    [[0x2e, 0xff, 0x5a, 5], "CS: CALL DWORD PTR [BP+SI+5h]"], [[0xf3, 0xa4], "REP MOVSB"],
    [[0x3e, 0x26, 0xf3, 0xf2, 0xa6], "REPNE ES: CMPSB"], [[0xf3, 0xae], "REPE SCASB"],
    [[0xe5, 0x61], "IN AX, 61h"], [[0xf0, 0x86, 0x00], "LOCK XCHG BYTE PTR [BX+SI], AL"],
  ] as const) {
    const row = decode(...bytes);
    assert.equal(row.assembly, assembly); assert.deepEqual(row.bytes, bytes); assert.ok(row.complete);
  }
  for (const bytes of [[0x83, 0xc8], [0x8e, 0xc8], [0x8d, 0xc0], [0xff, 0xd8], [0xd4, 0], [0xf2, 0xa4], [0xf3, 0xb8]]) {
    assert.match(decode(...bytes).assembly, /Unsupported/);
  }
  assert.match(decode(0xb8, 1).assembly, /Incomplete/);
  assert.match(decode(...Array<number>(64).fill(0xf0)).assembly, /Preview limit/);
});

test("8088 display lengths and ModR/M validity agree with native instruction fetches", () => {
  const ram = new Ram(0x100000), state = initialState({ cs: 0, ip: 0, cx: 1 });
  const connections = { ports: { readPort: () => 0, writePort: () => {} }, escape: () => {}, test: () => false };
  for (let opcode = 0; opcode < 256; opcode++) {
    if (cpu.prefixes[opcode]) continue;
    const postbytes = cpu.instructions[opcode]?.forms
      ? Array.from({ length: 32 }, (_, i) => (i << 3) | 6) : [10];
    for (const post of postbytes) {
      const bytes = [opcode, post, 0, 0, 0, 0];
      bytes.forEach((value, i) => ram.write(i, value));
      const record = new Cpu8088(ram, state, connections).step();
      const row = decode(...bytes), label = bytes.slice(0, 2).map(b => b.toString(16)).join(" ");
      assert.equal(row.complete, record.outcome !== "unsupported", label);
      assert.deepEqual(row.bytes, record.instruction?.bytes, label);
    }
  }
});

test("XT observation follows both address wraps and physical aliases without touching board state", t => {
  const machine = create8088PcXt({ bios: null, basic: null, font: null });
  const read = (address: number) => readXtStorage(machine, regions, address);
  machine.video.write(0x12, 0x81);
  assert.equal(read(0xb8012), 0x81); assert.equal(read(0xbc012), 0x81);
  for (const address of [0xa0000, 0xf2000, 0xf6000, 0xffff0]) assert.equal(read(address), undefined);
  const start = { cs: 0x1000, ip: 0xffff };
  machine.ram.write(0x1ffff, 0xb0); machine.ram.write(0x10000, 0x7f);
  machine.ram.write(0x10001, 0x90);
  machine.io.write(0x63, 0x99); machine.io.write(0x61, 0x40);
  assert.ok(machine.io.offerScanCode(0x1e));
  t.mock.method(machine.memory, "read", () => assert.fail("Inspection issued a guest bus read"));
  t.mock.method(machine.ports, "readPort", () => assert.fail("Inspection issued a port read"));
  const before = machine.snapshot();
  const rows = xtCodeRows(cpu, start, read, []);
  assert.equal(rows[0]!.row.assembly, "MOV AL, 7Fh");
  assert.equal(rows[1]!.row.ip, 1); assert.equal(rows[1]!.row.assembly, "NOP");
  assert.equal(physical8088(0xffff, 0x10), 0);
  const wrapped = xtCodeRows(cpu, { cs: 0xffff, ip: 0xf }, address => ({ 0xfffff: 0xeb, 0: 0xfd })[address], []);
  assert.equal(wrapped[0]!.row.assembly, "JMP FFFF:000E");
  assert.deepEqual(machine.snapshot(), before);
});

test("XT disassembly keeps fetched history when the instruction rewrites its own bytes", () => {
  const machine = create8088PcXt({ bios: null, basic: null, font: null });
  [0xc6, 0x06, 0, 0, 0x90].forEach((byte, i) => machine.ram.write(i, byte));
  const record = machine.cpu.stepTimed();
  assert.equal(machine.ram.read(0), 0x90);
  const rows = xtCodeRows(cpu, record.after, address => machine.ram.read(address), [record]);
  assert.equal(rows[0]!.kind, "executed"); assert.deepEqual(rows[0]!.row.bytes, [0xc6, 0x06, 0, 0, 0x90]);
  assert.equal(rows[1]!.kind, "current"); assert.equal(rows[1]!.row.ip, 5);
});

test("XT layouts gain the inspectors once while preserving existing tabs and hidden panels", () => {
  const old = { root: { kind: "tabs", id: "my-tabs", active: "snapshot", panels: ["screen", "snapshot"], collapsed: true } } as const;
  const map = new Map([["dromaios:workspace:xt:1", encodeWorkspaceState(old)]]);
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, text: string) => map.set(key, text) };
  migrateXtWorkspace(storage);
  const restored = decodeWorkspaceState(map.get(xtWorkspaceKey)!, ["screen", "snapshot", "registers", "code", "memory", "debugger", "instruction", "walkthrough", "log"]);
  assert.deepEqual(groups(restored).map(g => g.panels), [["screen", "snapshot"], ["debugger", "walkthrough"], ["registers"], ["instruction"], ["code", "log"], ["memory"]]);
  assert.deepEqual(groups(restored)[0], old.root);
  map.set(xtWorkspaceKey, encodeWorkspaceState(old)); migrateXtWorkspace(storage);
  assert.equal(map.get(xtWorkspaceKey), encodeWorkspaceState(old));
});

test("XT version-4 layouts gain Instruction and Walkthrough once without reopening hidden tools", () => {
  const old = { root: { kind: "tabs", id: "console", active: "execution", panels: ["screen", "execution"], collapsed: true } } as const;
  const map = new Map([["dromaios:workspace:xt:4", encodeWorkspaceState(old)]]);
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, text: string) => map.set(key, text) };
  migrateXtWorkspace(storage);
  const layout = decodeWorkspaceState(map.get(xtWorkspaceKey)!, ["screen", "execution", "instruction", "walkthrough", "log"]);
  assert.deepEqual(groups(layout).flatMap(g => g.panels).sort(), ["execution", "instruction", "log", "screen", "walkthrough"]);
  assert.equal(groups(layout)[0]!.collapsed, true);
  const saved = map.get(xtWorkspaceKey); migrateXtWorkspace(storage); assert.equal(map.get(xtWorkspaceKey), saved);
});
