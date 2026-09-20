import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { Ram } from "../../../../src/components/memory/ram.js";
import { byteExecution } from "../../../../src/components/cpus/byte-execution.js";
import type { BytePorts } from "../../../../src/components/cpus/port-access.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { generateChapterExecution } from "../../../../src/components/cpus/semantics/literate/execution.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";

const file = "src/components/cpus/specifications/8008.md", markdown = readFileSync(file, "utf8");
const compile = (text = markdown) => compileCpuChapter(text, { name: "8008" }, file);
const initial = () => ({ a: 0x42, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0,
  flags: { s: false, z: true, p: false, c: true }, addressStack: [0, 1, 2, 3, 4, 5, 6, 0x3fff], stackIndex: 7, halted: false });

/** Exercise emitted modules together, resolving their normal imports without writing build output. */
async function generated(text = markdown, cpu: "8008" | "8080" = "8008") {
  const chapter = compileCpuChapter(text, { name: cpu }, file);
  const base = new URL("../../../../src/components/cpus/generated/", import.meta.url);
  const moduleUrl = (source: string, bindings: Readonly<Record<string, string>> = {}): string => {
    const code = stripTypeScriptTypes(source).replace(/from "([^"]+)"/g, (_, path: string) =>
      `from ${JSON.stringify(bindings[path] ?? new URL(path.replace(/\.ts$/, ".js"), base).href)}`);
    return `data:text/javascript,${encodeURIComponent(code)}`;
  };
  const instructions = Object.fromEntries(Object.values(chapter.families).flat());
  const opcodes = moduleUrl(generateInstructions(cpu, instructions, { bindOpcodes: true }));
  const actions = moduleUrl(generateInstructions(cpu, chapter.actions,
    { sources: { cpu: { name: cpu, state: chapter.state! }, groups: { views: chapter.views } } }));
  const source = generateChapterExecution(cpu, cpu, chapter.execution!);
  const result: {
    checkMemory(ram: Ram): void;
    createExecution<S>(state: object, ram: Ram, snapshot: () => S, ports?: BytePorts): ReturnType<typeof byteExecution<S>>;
  } = await import(moduleUrl(source, { [`./${cpu}.ts`]: opcodes, [`./${cpu}-state.ts`]: actions }));
  return result;
}

test("chapter-generated execution keeps 8008 ordinary and supplied fetch policies distinct", async () => {
  const model = await generated(), state = initial(), ram = new Ram(0x4000);
  model.checkMemory(ram);
  const cpu = model.createExecution(state, ram, () => structuredClone(state));
  ram.write(0x3fff, 0x06); ram.write(0, 0xa5); // LAI
  const step = cpu.step();
  assert.equal(state.a, 0xa5); assert.equal(state.addressStack[7], 1);
  assert.deepEqual(step.instruction, { address: 0x3fff, bytes: [0x06, 0xa5] });
  assert.deepEqual(step.accesses, [{ kind: "read", address: 0x3fff, value: 0x06 }, { kind: "read", address: 0, value: 0xa5 }]);
  cpu.reset();
  assert.equal(cpu.step().instruction, null);
  const bytes = [0x06, 0x5a]; let index = 0;
  const interrupt = cpu.interrupt(() => {
    assert.equal(state.halted, false); assert.equal(state.addressStack[0], 0);
    return bytes[index++]!;
  });
  assert.equal(state.a, 0x5a); assert.equal(state.addressStack[0], 0);
  assert.deepEqual(interrupt.instruction, { source: "interrupt", bytes });
  assert.deepEqual(interrupt.accesses, bytes.map(value => ({ kind: "acknowledge", value })));
  assert.equal(Object.values(compile().families).flat().length, 250);
});

test("formal opcode and interrupt-counter edits change advancement without changing the runtime", async () => {
  const model = await generated(markdown.replace("opcode advance on dispatch", "opcode advance on read")
    .replace("counter preserve", "counter advance"));
  const state = initial(), ram = new Ram(0x4000), cpu = model.createExecution(state, ram, () => structuredClone(state));
  ram.write(0x3fff, 0x22); // Undefined: the edited policy consumes it.
  assert.equal(cpu.step().outcome, "unsupported"); assert.equal(state.addressStack[7], 0);
  state.halted = true;
  const bytes = [0x46, 0x34, 0x12]; let index = 0; // CAL
  cpu.interrupt(() => bytes[index++]!);
  assert.equal(state.addressStack[7], 3); assert.equal(state.stackIndex, 0); assert.equal(state.addressStack[0], 0x1234);
  const saved = structuredClone(state);
  assert.throws(() => cpu.interrupt(() => 256), /Interrupt instruction byte/);
  assert.deepEqual(state, saved);
});

test("formal memory and acceptance edits change validation and the state visible at acknowledgement", async () => {
  const model = await generated(markdown.replace("memory 14", "memory 16")
    .replace('action resume "accept an external instruction" {', 'action resume "accept an external instruction" {\n  A <- u8($99)'));
  assert.throws(() => model.checkMemory(new Ram(0x4000)), /64 KiB/);
  const ram = new Ram(0x10000), state = initial(); model.checkMemory(ram);
  state.halted = true;
  const cpu = model.createExecution(state, ram, () => structuredClone(state));
  assert.throws(() => Reflect.apply(cpu.interrupt, cpu, [null]), /acknowledgement callback/);
  assert.equal(state.a, 0x42); assert.equal(state.halted, true);
  const error = new Error("acknowledgement failed");
  assert.throws(() => cpu.interrupt(() => {
    assert.equal(state.a, 0x99); assert.equal(state.halted, false); throw error;
  }), thrown => thrown === error);
  assert.equal(cpu.interrupt(() => 0xc0).outcome, "executed");
});

test("a chapter retirement action follows successful instruction effects and skips unsupported or failed attempts", async () => {
  const text = markdown.replace("execution {", 'action finish "retire" {\n  A <- u8($99)\n}\nexecution {')
    .replace("retire none", "retire action finish");
  const model = await generated(text), state = initial(), ram = new Ram(0x4000);
  const error = new Error("output failed");
  const cpu = model.createExecution(state, ram, () => structuredClone(state), {
    readPort: () => 0, writePort: () => { throw error; },
  });
  let index = 0;
  cpu.interrupt(() => [0x06, 0x55][index++]!);
  assert.equal(state.a, 0x99);
  state.a = 0x42;
  assert.equal(cpu.interrupt(() => 0x22).outcome, "unsupported"); assert.equal(state.a, 0x42);
  assert.throws(() => cpu.interrupt(() => 0x51), thrown => thrown === error); assert.equal(state.a, 0x42);
  ram.write(0x3fff, 0x22);
  assert.equal(cpu.step().outcome, "unsupported"); assert.equal(state.a, 0x42);
  ram.write(0x3fff, 0x51);
  assert.throws(() => cpu.step(), thrown => thrown === error); assert.equal(state.a, 0x42);
  ram.write(0, 0xff); // Retirement also follows a successfully executed HLT.
  assert.equal(cpu.step().outcome, "halted"); assert.equal(state.a, 0x99);
});

const invalid: readonly [string, string, string, RegExp][] = [
  ["missing policy", "  failure retain\n", "", /needs failure/],
  ["duplicate field", "memory 14", "memory 14\n  memory 14", /Duplicate execution field memory/],
  ["unknown field", "retire none", "retire none\n  timing cycles", /Unknown execution field timing/],
  ["unsupported bus", "memory 14", "memory 32", /memory width from 1 to 16/],
  ["narrow bus", "memory 14", "memory 8", /counter view must fit/],
  ["stored counter instead of view", "counter PC write", "counter A write", /Unknown state view A/],
  ["missing counter writer", "write setPC", "write absent", /Unknown state action absent/],
  ["wrong writer arity", "write setPC", "write reset", /one 16-bit input/],
  ["non-latch stop", "stopped STOPPED", "stopped A", /Unknown name A/],
  ["unknown word order", "word little", "word middle", /little or big/],
  ["unknown opcode policy", "opcode advance on dispatch", "opcode advance on retirement", /dispatch or read/],
  ["early operand advance", "operand advance after read", "operand advance before read", /Expected "after"/],
  ["unsupported rollback", "  failure retain\n", "  failure rollback\n", /Expected "retain"/],
  ["reset with input", "reset action reset", "reset action setPC", /must have no inputs/],
  ["missing retirement action", "retire none", "retire action absent", /Unknown state action absent/],
  ["masked interrupt", "accept always with resume", "accept masked with resume", /Expected "always"/],
  ["acceptance with input", "accept always with resume", "accept always with setPC", /must have no inputs/],
  ["memory supplied bytes", "bytes acknowledge", "bytes memory", /Expected "acknowledge"/],
  ["missing acceptance", "    accept always with resume\n", "", /needs interrupt.accept/],
  ["duplicate interrupt field", "counter preserve", "counter preserve\n    counter preserve", /Duplicate execution field interrupt.counter/],
  ["unknown interrupt field", "unknown retain", "unknown retain\n    mask none", /Unknown execution field interrupt.mask/],
  ["unsupported interrupt rollback", "unknown retain", "unknown rollback", /Expected "retain"/],
];
for (const [name, before, after, message] of invalid) test(`execution declarations reject ${name} at a Markdown location`, () => {
  assert.ok(markdown.includes(before));
  assert.throws(() => compile(markdown.replace(before, after)), (error: unknown) => {
    assert.ok(error instanceof ChapterError); assert.equal(error.file, file); assert.ok(error.line > 1);
    assert.match(error.message, message); return true;
  });
});

test("a chapter rejects a second execution contract and an oversized opcode at a Markdown location", () => {
  const execution = /^execution \{[\s\S]*?^\}/m.exec(markdown)![0];
  assert.throws(() => compile(`${markdown}\n\`\`\`cpu\n${execution}\n\`\`\`\n`),
    (error: unknown) => error instanceof ChapterError && /Execution is already declared/.test(error.message));
  const text = `${markdown}\nAn oversized encoding cannot use byte dispatch.\n\n\`\`\`cpu\nfamily WIDE "0000000100000000" {\n  A <- u8(0)\n}\n\`\`\`\n`;
  assert.throws(() => compile(text), (error: unknown) => error instanceof ChapterError && error.line > 1 && /one-byte opcodes/.test(error.message));
});

test("byte execution rejects native decoder and fault effects, including hidden sources and untaken branches", () => {
  const setup = markdown.slice(0, markdown.indexOf("## Seven registers")).replace('cpu "8008"', 'cpu "68000"');
  for (const effect of ["address = resolve(8, u3(0), u3(0))", "commit addresses", "fault alignment read(u32(0)) if 0"]) {
    for (const hidden of [false, true]) {
      const source = hidden ? `source hidden "native boundary": 8 {\n  ${effect}\n  return u8(0)\n}\n` : "";
      const body = hidden ? "byte = source hidden" : effect;
      const text = `${setup}\nNative effects need a different runtime contract.\n\n\`\`\`cpu\n${source}family NATIVE "01000010" {\n  when 0 {\n    ${body}\n  }\n}\n\`\`\`\n`;
      const message = hidden && effect.startsWith("fault") ? /value sources cannot reject/ : /Byte execution does not support/;
      assert.throws(() => compileCpuChapter(text, { name: "68000" }, file),
        (error: unknown) => error instanceof ChapterError && error.line > 1 && message.test(error.message));
    }
  }
});

test("execution declarations can drive another schema and CPU name without an 8008 branch", async () => {
  const text = `A deliberately small test CPU exercises the shared execution contract.

\`\`\`cpu
cpu "8080"
state {
  register CURSOR: 8
  register VALUE: 8
  latch ASLEEP
}
view NEXT "next byte": 8 {
  address = register CURSOR
  return address
}
action move "advance counter" (address: 16) {
  CURSOR <- truncate(address, 8)
}
action start "release sleep" {
  ASLEEP <- 0
}
action clear "clear state" {
  CURSOR <- u8(0)
  VALUE <- u8(0)
  ASLEEP <- 1
}
execution {
  memory 8
  counter NEXT write move
  stopped ASLEEP
  word big
  opcode advance on dispatch
  operand advance after read
  failure retain
  reset action clear
  retire none
  interrupt {
    accept always with start
    bytes acknowledge
    counter preserve
    unknown retain
  }
}
family LOAD "01000010" {
  byte = fetch
  VALUE <- byte
}
\`\`\``;
  const model = await generated(text, "8080"), state = { cursor: 255, value: 0, asleep: false }, ram = new Ram(256);
  model.checkMemory(ram); ram.write(255, 0x42); ram.write(0, 0xa5);
  const cpu = model.createExecution(state, ram, () => ({ ...state }));
  assert.equal(cpu.step().outcome, "executed"); assert.deepEqual(state, { cursor: 1, value: 0xa5, asleep: false });
  cpu.reset(); assert.deepEqual(state, { cursor: 0, value: 0, asleep: true });
  let index = 0;
  cpu.interrupt(() => [0x42, 0x5a][index++]!);
  assert.deepEqual(state, { cursor: 0, value: 0x5a, asleep: false });
});

const intelFile = "src/components/cpus/specifications/8080.md", intel = readFileSync(intelFile, "utf8");
const intelState = () => ({ a: 0x42, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0, sp: 0xffff,
  flags: { s: false, z: true, p: false, ac: true, cy: true }, interruptEnabled: false, interruptDeferred: false, halted: false });

test("8080 chapter recognition skips acknowledgement and acceptance for both disabled and deferred offers", async () => {
  const model = await generated(intel, "8080"), ram = new Ram(0x10000);
  for (const enabled of [false, true]) for (const deferred of [false, true]) for (const halted of [false, true]) {
    const state = { ...intelState(), interruptEnabled: enabled, interruptDeferred: deferred, halted };
    const before = structuredClone(state), cpu = model.createExecution(state, ram, () => structuredClone(state));
    let acknowledged = false;
    const result = cpu.interrupt(() => {
      acknowledged = true;
      assert.deepEqual(state, { ...before, interruptEnabled: false, interruptDeferred: false, halted: false });
      return 0x40; // MOV B,B
    });
    assert.equal(acknowledged, enabled && !deferred);
    if (!acknowledged) assert.deepEqual(result, { before, after: before, instruction: null, accesses: [],
      outcome: "ignored", reason: enabled ? "deferred" : "disabled" });
    else assert.deepEqual(result, { before, after: state, instruction: { source: "interrupt", bytes: [0x40] },
      accesses: [{ kind: "acknowledge", value: 0x40 }], outcome: "executed" });
  }
});

test("8080 chapter retirement consumes old delays, renews EI, and skips failures, unsupported bytes, and idle HALT", async () => {
  const model = await generated(intel, "8080"), state = intelState(), ram = new Ram(0x10000);
  const error = Error("device failed"), cpu = model.createExecution(state, ram, () => structuredClone(state), {
    readPort() { throw error; }, writePort() { throw error; },
  });
  [0xfb, 0xfb, 0xdb, 0x07, 0x08, 0x40, 0xf3].forEach((byte, address) => ram.write(address, byte));
  cpu.step(); assert.equal(state.interruptDeferred, true);
  cpu.step(); assert.equal(state.interruptDeferred, true);
  assert.throws(() => cpu.step(), thrown => thrown === error);
  assert.equal(state.pc, 4); assert.equal(state.interruptDeferred, true);
  assert.equal(cpu.step().outcome, "unsupported"); assert.equal(state.interruptDeferred, true);
  state.halted = true;
  assert.equal(cpu.step().outcome, "halted"); assert.equal(state.interruptDeferred, true);
  state.pc = 5; state.halted = false;
  cpu.step(); assert.equal(state.interruptDeferred, false);
  // An externally supplied EI renews the delay after acceptance clears it.
  cpu.interrupt(() => 0xfb);
  assert.equal(state.interruptEnabled, true); assert.equal(state.interruptDeferred, true); assert.equal(state.pc, 6);
  cpu.step(); assert.equal(state.interruptEnabled, false); assert.equal(state.interruptDeferred, false);
});

test("formal edits control interrupt masking, deferral destinations, and callback validation", async () => {
  const changed = intel.replace("accept when ENABLED unless DEFERRED with accept", "accept when ENABLED with accept")
    .replace("retire irq into DEFERRED", "retire irq into ENABLED");
  const model = await generated(changed, "8080"), state = { ...intelState(), interruptEnabled: true, interruptDeferred: true };
  const cpu = model.createExecution(state, new Ram(0x10000), () => structuredClone(state));
  // Removing the blocker makes this offer acceptable despite the old delay.
  assert.equal(cpu.interrupt(() => 0x40).outcome, "executed");
  assert.equal(state.interruptEnabled, false);
  // EI writes ENABLED immediately; retirement targets it instead of DEFERRED.
  state.pc = 0; const ram = new Ram(0x10000); ram.write(0, 0xfb);
  const ordinary = model.createExecution(state, ram, () => structuredClone(state));
  ordinary.step(); assert.equal(state.interruptEnabled, true); assert.equal(state.interruptDeferred, false);
  const eager = await generated(intel.replace("callback validate on read", "callback validate on offer"), "8080");
  const before = { ...intelState(), halted: true }, offered = eager.createExecution(before, ram, () => structuredClone(before));
  assert.throws(() => Reflect.apply(offered.interrupt, offered, [null]), /acknowledgement callback/);
  assert.deepEqual(before, { ...intelState(), halted: true });
  const lazy = await generated(intel, "8080"), accepted = lazy.createExecution(before, ram, () => structuredClone(before));
  assert.equal(Reflect.apply(accepted.interrupt, accepted, [null]).outcome, "ignored");
  before.interruptEnabled = true;
  assert.throws(() => Reflect.apply(accepted.interrupt, accepted, [null]), TypeError);
  assert.equal(before.halted, false); assert.equal(before.interruptEnabled, false);
  // Failure releases the boundary guard and leaves the model usable.
  accepted.reset(); assert.equal(before.pc, 0);
});

for (const [before, after, message] of [
  ["retire irq into DEFERRED", "retire irq into A", /Unknown name A/],
  ["retire irq into DEFERRED", "retire none", /deferral needs a declared retirement destination/],
  ["accept when ENABLED", "accept when A", /Unknown name A/],
  ["unless DEFERRED", "unless CY", /Unknown name CY/],
  ["callback validate on read", "callback validate on dispatch", /offer or read/],
  ["  defer irq\n", "  defer nmi\n", /Expected "irq"/],
] as const) test(`8080 execution rejects ${after} at its Markdown location`, () => {
  assert.throws(() => compileCpuChapter(intel.replace(before, after), { name: "8080" }, intelFile), error =>
    error instanceof ChapterError && error.file === intelFile && error.line > 0 && message.test(error.message));
});

test("IRQ retirement validation descends into untaken branches", () => {
  const text = intel.replace("retire irq into DEFERRED", "retire none").replace("  defer irq", "  when 0 {\n    defer irq\n  }");
  assert.throws(() => compileCpuChapter(text, { name: "8080" }, intelFile), /deferral needs a declared retirement destination/);
});
