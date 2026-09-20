import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { Ram } from "../../../../src/components/memory/ram.js";
import type { Cpu6502, Cpu6502State } from "../../../../src/components/cpus/generated/6502-cpu.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { generateChapterState } from "../../../../src/components/cpus/semantics/literate/state.js";
import { generateChapterExecution } from "../../../../src/components/cpus/semantics/literate/execution.js";
import { generateChapterInterface, generatePublicState } from "../../../../src/components/cpus/semantics/literate/interface.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";

const file = "src/components/cpus/specifications/6502.md", markdown = readFileSync(file, "utf8");
const initial = (): Cpu6502State => ({ a: 0x12, x: 0x34, y: 0x56, sp: 0xff, pc: 0x200,
  flags: { n: true, v: false, d: true, i: false, z: true, c: false } });

/** Load all generated layers: every mutation must change the public CPU, not just compiler data. */
async function generated(text = markdown, name = "6502", publicName = "Cpu6502") {
  const chapter = compileCpuChapter(text, { name }, file), state = chapter.state!, api = chapter.interface!;
  const base = new URL("../../../../src/components/cpus/generated/", import.meta.url);
  const url = (source: string, bindings: Readonly<Record<string, string>> = {}, relative = base) => {
    const code = stripTypeScriptTypes(source).replace(/from "([^"]+)"/g, (_, path: string) =>
      `from ${JSON.stringify(bindings[path] ?? new URL(path.replace(/\.ts$/, ".js"), relative).href)}`);
    return `data:text/javascript,${encodeURIComponent(code)}`;
  };
  const schema = url(generateChapterState(state) + generatePublicState(state, api), {}, new URL("../semantics/generated/state/", base));
  const opcodes = url(generateInstructions(name, Object.fromEntries(Object.values(chapter.families).flat()), { bindOpcodes: true }));
  const actions = url(generateInstructions(name, chapter.actions, { sources: { cpu: { name, state }, groups: { views: chapter.views } } }));
  const execution = url(generateChapterExecution(name, name, chapter.execution!), { [`./${name}.ts`]: opcodes, [`./${name}-state.ts`]: actions });
  const exports = await import(url(generateChapterInterface(name, state, api, chapter.execution!), {
    [`../semantics/generated/state/${name}.ts`]: schema, [`./${name}-state.ts`]: actions, [`./${name}-execution.ts`]: execution,
  }));
  return exports[publicName] as new (ram: Ram, state: Cpu6502State) => Cpu6502;
}

function memory() {
  const ram = new Ram(0x10000);
  for (const [address, byte] of [[0xfffa, 0x78], [0xfffb, 0x56], [0xfffc, 0x34], [0xfffd, 0x12], [0xfffe, 0xbc], [0xffff, 0x9a]]) ram.write(address!, byte!);
  return ram;
}

test("formal reset addresses and effects drive recorded reads and preserve ordered state changes", async () => {
  for (const changed of [false, true]) {
    const text = changed ? markdown.replace("low = memory(u16($FFFC))", "low = memory(u16($FFFA))")
      .replace("high = memory(u16($FFFD))", "high = memory(u16($FFFB))")
      .replace("SP <- subtract(pointer, u8($03))", "SP <- subtract(pointer, u8($05))") : markdown;
    const Model = await generated(text), cpu = new Model(memory(), initial());
    const reset = cpu.reset();
    assert.deepEqual(reset.before, initial());
    assert.deepEqual(reset.after, { ...initial(), pc: changed ? 0x5678 : 0x1234, sp: changed ? 0xfa : 0xfc,
      flags: { ...initial().flags, i: true } });
    assert.deepEqual(reset.accesses, changed ? [{ kind: "read", address: 0xfffa, value: 0x78 }, { kind: "read", address: 0xfffb, value: 0x56 }]
      : [{ kind: "read", address: 0xfffc, value: 0x34 }, { kind: "read", address: 0xfffd, value: 0x12 }]);
  }
});

test("chapter entry sources select masks and vectors, and edits to entry ordering are observable", async () => {
  const changed = markdown.replace("source irq unless flag I with enter($FFFE)", "source irq unless flag D with enter($FFFA)")
    .replace("  low = memory(vector)\n", "  A <- u8($99)\n  low = memory(vector)\n");
  const Model = await generated(changed), ram = memory();
  const masked = new Model(ram, initial());
  const ignored = masked.interrupt("irq");
  assert.equal(ignored.outcome, "ignored"); assert.deepEqual(ignored.accesses, []);
  const before = { ...initial(), flags: { ...initial().flags, d: false, i: true } };
  const cpu = new Model(ram, before), record = cpu.interrupt("irq");
  assert.equal(record.outcome, "accepted"); assert.equal(record.instruction, null);
  assert.equal(record.after.pc, 0x5678); assert.equal(record.after.a, 0x99);
  assert.deepEqual(record.accesses, [
    { kind: "write", address: 0x1ff, value: 2 }, { kind: "write", address: 0x1fe, value: 0 },
    { kind: "write", address: 0x1fd, value: 0xa6 }, { kind: "read", address: 0xfffa, value: 0x78 },
    { kind: "read", address: 0xfffb, value: 0x56 },
  ]);
  assert.equal(new Model(memory(), initial()).interrupt("nmi").outcome, "accepted");
});

test("chapter opcode policy changes unsupported advancement without inventing halt or interrupt instructions", async () => {
  for (const advance of ["dispatch", "read"]) {
    const Model = await generated(markdown.replace("opcode advance on dispatch", `opcode advance on ${advance}`));
    const ram = memory(); ram.write(0x200, 0x02); const cpu = new Model(ram, initial());
    const record = cpu.step();
    assert.equal(record.outcome, "unsupported"); assert.deepEqual(record.instruction, { address: 0x200, bytes: [2] });
    assert.equal(record.after.pc, advance === "read" ? 0x201 : 0x200);
    assert.equal(cpu.interrupt("nmi").instruction, null);
  }
});

test("vector execution follows a renamed CPU, mask field, public class, and source catalogue", async () => {
  const text = markdown.replace('cpu "6502"', 'cpu "probe"').replace("interface Cpu6502", "interface CpuProbe")
    .replace("flag I", "flag MASK = gated").replaceAll("flag I", "flag MASK").replaceAll("  I =", "  MASK =")
    .replace("source irq unless", "source pulse unless").replace("source nmi always", "source edge always");
  const Model = await generated(text, "probe", "CpuProbe"), state = initial();
  const flags = { ...state.flags, gated: true }; Reflect.deleteProperty(flags, "i");
  const cpu = new Model(memory(), { ...state, flags });
  const interrupt = (source: unknown) => Reflect.apply(cpu.interrupt, cpu, [source]);
  assert.equal(interrupt("pulse").outcome, "ignored");
  assert.equal(interrupt("edge").outcome, "accepted");
  assert.throws(() => interrupt("irq"), /probe interrupt source must be pulse or edge/);
  assert.equal(Reflect.get(cpu.snapshot().flags, "gated"), true);
});

test("vector actions retain exactly the effects before a failed access and release their shared guard", async () => {
  const Model = await generated();
  for (const operation of ["reset", "irq", "nmi"] as const) for (let failed = 0; failed < (operation === "reset" ? 2 : 5); failed++) {
    const ram = memory(), failure = new Error("bus failure"), seen: number[] = [];
    let cpu: Cpu6502, active = true;
    const access = (address: number) => {
      if (!active) return;
      assert.throws(() => cpu.reset(), /not be reentrant/);
      assert.throws(() => cpu.step(), /not be reentrant/);
      assert.throws(() => cpu.interrupt("nmi"), /not be reentrant/);
      assert.ok(cpu.snapshot()); seen.push(address);
      if (seen.length - 1 === failed) throw failure;
    };
    const read = ram.read.bind(ram), write = ram.write.bind(ram);
    ram.read = address => { access(address); return read(address); };
    ram.write = (address, byte) => { access(address); write(address, byte); };
    cpu = new Model(ram, initial());
    const run = () => operation === "reset" ? cpu.reset() : cpu.interrupt(operation);
    assert.throws(run, error => error === failure);
    const after = cpu.snapshot();
    assert.equal(after.pc, 0x200);
    assert.equal(after.sp, operation === "reset" ? 0xff : 0xff - Math.min(failed, 3));
    assert.equal(after.flags.i, operation !== "reset" && failed >= 3);
    assert.equal(after.flags.d, true);
    active = false; assert.doesNotThrow(run);
  }
});

test("invalid vector declarations and hidden action effects report chapter locations", () => {
  const invalid: readonly [string, string, RegExp][] = [
    ["stopped none", "stopped STOPPED", /Unknown name/],
    ["source irq unless flag I", "source irq unless flag A", /Unknown name/],
    ["source nmi always", "source irq always", /Duplicate interrupt source/],
    ["with enter($FFFE)", "with enter($10000)", /fit 16/],
    ["with enter($FFFE)", "with enter()", /decimal number/],
    ["with enter($FFFE)", "with absent($FFFE)", /Unknown entry action/],
    ["counter NEXT write setPC", "counter NEXT write enter", /cannot fetch|using memory/],
    ["reset action reset", "reset action enter", /no inputs/],
    ["retire none", "retire action setPC", /no inputs/],
    ['"read the reset vector and reset PC, I, and SP" using memory', '"read the reset vector and reset PC, I, and SP"', /using memory/],
    ["low = memory(u16($FFFC))", "low = fetch", /cannot fetch/],
    ["low = memory(u16($FFFC))", "low = source immediateByte", /cannot fetch/],
    ["low = memory(u16($FFFC))", "when 0 {\n    low = port(u16(0))\n  }\n  low = memory(u16($FFFC))", /ports/],
    ["family NOP \"111 010 10\" {", "family NOP \"111 010 10\" {\n  byte = port(u16(0))", /memory-only/],
  ];
  for (const [before, after, message] of invalid) {
    assert.ok(markdown.includes(before), before);
    assert.throws(() => compileCpuChapter(markdown.replace(before, after), { name: "6502" }, file), (error: unknown) => {
      assert.ok(error instanceof ChapterError); assert.equal(error.file, file); assert.ok(error.line > 1);
      assert.match(error.message, message); return true;
    });
  }
});
