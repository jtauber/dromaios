import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Ram } from "../../../../src/components/memory/ram.js";
import type { Cpu6800, Cpu6800State } from "../../../../src/components/cpus/generated/6800-cpu.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateChapterModule } from "../../../helpers/literate-model.js";

const file = "src/components/cpus/specifications/6800.md", markdown = readFileSync(file, "utf8");
const initial = (): Cpu6800State => ({ a: 0x12, b: 0x34, x: 0x5678, sp: 0x100, pc: 0x200, waiting: false,
  flags: { h: true, i: false, n: true, z: false, v: true, c: false } });

async function generated(text = markdown, name = "6800", publicName = "Cpu6800") {
  const exports = await generateChapterModule(text, name, file);
  return exports[publicName] as new (ram: Ram, state: Cpu6800State) => Cpu6800;
}

function memory() {
  const ram = new Ram(0x10000);
  for (const [address, byte] of [[0xfff8, 0x56], [0xfff9, 0x78], [0xfffc, 0x12], [0xfffd, 0x34], [0xfffe, 0x9a], [0xffff, 0xbc]]) ram.write(address!, byte!);
  ram.write(0x200, 0x3e); // WAI
  ram.write(0x5678, 0x3b); ram.write(0x1234, 0x3b); // IRQ/NMI handlers: RTI
  return ram;
}

test("6800 reset addresses and ordered effects come from the chapter", async () => {
  for (const changed of [false, true]) {
    const text = changed ? markdown.replace("high = memory(u16($FFFE))", "high = memory(u16($FFFC))")
      .replace("low = memory(u16($FFFF))", "low = memory(u16($FFFD))")
      .replace("  PC <- concat(high, low)\n  apply IFLAG(1)", "  PC <- concat(high, low)\n  apply IFLAG(0)") : markdown;
    const Model = await generated(text), before = { ...initial(), waiting: true }, cpu = new Model(memory(), before);
    const record = cpu.reset();
    assert.deepEqual(record.before, before);
    assert.deepEqual(record.after, { ...initial(), pc: changed ? 0x1234 : 0x9abc,
      flags: { ...initial().flags, i: !changed } });
    assert.deepEqual(record.accesses, changed ? [{ kind: "read", address: 0xfffc, value: 0x12 }, { kind: "read", address: 0xfffd, value: 0x34 }]
      : [{ kind: "read", address: 0xfffe, value: 0x9a }, { kind: "read", address: 0xffff, value: 0xbc }]);
  }
});

test("chapter WAI saves one frame and vector entry reuses it for IRQ and NMI", async () => {
  const Model = await generated();
  for (const source of ["irq", "nmi"] as const) {
    const ram = memory(), cpu = new Model(ram, initial()), wait = cpu.step();
    assert.equal(wait.outcome, "waiting");
    assert.deepEqual(wait.instruction, { address: 0x200, bytes: [0x3e] });
    assert.deepEqual(wait.accesses, [
      { kind: "read", address: 0x200, value: 0x3e },
      ...[1, 2, 0x78, 0x56, 0x12, 0x34, 0xea].map((value, index) => ({ kind: "write", address: 0x100 - index, value })),
    ]);
    assert.deepEqual(cpu.step(), { before: wait.after, after: wait.after, instruction: null, accesses: [], outcome: "waiting" });
    const resumed = new Model(ram, wait.after), entry = resumed.interrupt(source), vector = source === "irq" ? 0xfff8 : 0xfffc;
    assert.deepEqual(entry.accesses, [
      { kind: "read", address: vector, value: source === "irq" ? 0x56 : 0x12 },
      { kind: "read", address: vector + 1, value: source === "irq" ? 0x78 : 0x34 },
    ]);
    assert.deepEqual(entry.after, { ...wait.after, pc: source === "irq" ? 0x5678 : 0x1234, waiting: false,
      flags: { ...initial().flags, i: true } });
    assert.deepEqual(resumed.step().after, { ...initial(), pc: 0x201 });
  }
});

test("waiting policy, entry masking, and wake effects are independently editable", async () => {
  const noWait = await generated(markdown.replace("  stopped WAITING as waiting", "  stopped none"));
  const ram = memory(); ram.write(0x200, 1);
  assert.equal(new noWait(ram, { ...initial(), waiting: true }).step().outcome, "executed");

  const wake = await generated(markdown.replace("  WAITING <- 0\n  apply IFLAG(1)", "  WAITING <- 1\n  apply IFLAG(1)"));
  const cpu = new wake(memory(), { ...initial(), waiting: true });
  assert.equal(cpu.interrupt("nmi").after.waiting, true);
  assert.equal(cpu.step().instruction, null); // Acceptance alone does not clear the latch.

  const mask = await generated(markdown.replace("source irq unless flag I with enterInterrupt($FFF8)", "source irq unless flag H with enterInterrupt($FFFC)"));
  const masked = new mask(memory(), { ...initial(), waiting: true });
  assert.deepEqual(masked.interrupt("irq"), { before: masked.snapshot(), after: masked.snapshot(),
    instruction: null, accesses: [], source: "irq", outcome: "ignored", reason: "masked" });
  const unmasked = new mask(memory(), { ...initial(), waiting: true, flags: { ...initial().flags, h: false, i: true } });
  assert.equal(unmasked.interrupt("irq").after.pc, 0x1234);
  assert.equal(unmasked.snapshot().waiting, false);
});

test("waiting vector execution follows renamed state, CPU, public class, and external sources", async () => {
  const text = markdown.replace('cpu "6800"', 'cpu "probe"').replace("interface Cpu6800", "interface CpuProbe")
    .replace("latch WAITING = waiting", "latch PAUSED = paused").replaceAll("latch WAITING", "latch PAUSED")
    .replaceAll("WAITING <-", "PAUSED <-").replace("  stopped WAITING", "  stopped PAUSED")
    .replace("source irq unless", "source pulse unless").replace("source nmi always", "source edge always");
  const Model = await generated(text, "probe", "CpuProbe"), state = { ...initial(), paused: true };
  Reflect.deleteProperty(state, "waiting");
  const cpu = new Model(memory(), state), interrupt = (source: unknown) => Reflect.apply(cpu.interrupt, cpu, [source]);
  assert.equal(cpu.step().instruction, null);
  assert.equal(interrupt("edge").outcome, "accepted");
  assert.equal(Reflect.get(cpu.snapshot(), "paused"), false);
  assert.equal(interrupt("pulse").outcome, "ignored");
  assert.throws(() => interrupt("irq"), /probe interrupt source must be pulse or edge/);
});

test("6800 vector failures retain exact partial state and release the common execution guard", async () => {
  const Model = await generated();
  for (const waiting of [false, true]) for (const operation of ["reset", "irq", "nmi"] as const) {
    for (let failed = 0; failed < (operation === "reset" || waiting ? 2 : 9); failed++) {
      const ram = memory(), failure = new Error("bus failure"), seen: number[] = [];
      let cpu: Cpu6800, active = true;
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
      const before = { ...initial(), waiting };
      cpu = new Model(ram, before);
      const run = () => operation === "reset" ? cpu.reset() : cpu.interrupt(operation);
      assert.throws(run, error => error === failure);
      const entered = operation !== "reset" && (waiting || failed >= 7);
      assert.deepEqual(cpu.snapshot(), { ...before,
        sp: before.sp - (operation === "reset" || waiting ? 0 : Math.min(failed, 7)),
        waiting: waiting && !entered, flags: { ...before.flags, i: entered } });
      active = false; assert.doesNotThrow(run);
    }
  }
});

test("invalid waiting declarations report their Markdown location", () => {
  for (const [replacement, message] of [
    ["stopped none as waiting", /requires a stopped latch/],
    ["stopped WAITING", /declared as waiting/],
    ["stopped WAITING as halted", /Expected "waiting"/],
    ["stopped PC as waiting", /Unknown name/],
    ["stopped UNKNOWN as waiting", /Unknown name/],
  ] as const) {
    assert.throws(() => compileCpuChapter(markdown.replace("stopped WAITING as waiting\n", `${replacement}\n`), { name: "6800" }, file), (error: unknown) => {
      assert.ok(error instanceof ChapterError); assert.equal(error.file, file); assert.ok(error.line > 1);
      assert.match(error.message, message); return true;
    });
  }
  const suppliedFile = "src/components/cpus/specifications/8008.md", supplied = readFileSync(suppliedFile, "utf8");
  assert.throws(() => compileCpuChapter(supplied.replace("  stopped STOPPED", "  stopped STOPPED as waiting"), { name: "8008" }, suppliedFile), /requires vector interrupts/);
});
