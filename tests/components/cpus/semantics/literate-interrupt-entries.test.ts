import assert from "node:assert/strict";
import { test } from "node:test";
import { Ram } from "../../../../src/components/memory/ram.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { generateChapterModule } from "../../../helpers/literate-model.js";

// Different storage, source names, mode values, bus width, and word order from the Z80.
const markdown = `A prefixed load exercises named interrupt entry and public bank views.

\`\`\`cpu
cpu "probe"
state {
  register CURSOR: 8
  register TICKS: 8
  register RESULT: 16
  bank SAVED = spare {
    register HIGH: 8
    register LOW: 8
    flag Z
  }
  choice MODE: "stream", "vector"
  latch ENABLED
  latch INHIBITED
  latch PAUSED
  latch DELAY
}
view NEXT "cursor": 8 {
  current = register CURSOR
  return current
}
view PAIR "saved word": 16 {
  high = register SAVED.HIGH
  low = register SAVED.LOW
  return concat(high, low)
}
action advance "write cursor" (value: 16) {
  CURSOR <- lowByte(value)
}
action reset "reset boundary" () {
  CURSOR <- u8(0)
  PAUSED <- 0
}
action fetched "count fetches" (count: 8) {
  old = register TICKS
  TICKS <- add(old, count)
}
action accept "accept request" () {
  ENABLED <- 0
  PAUSED <- 0
  perform fetched(u8(1))
}
action direct "direct entry" () using memory {
  old = register CURSOR
  memory(u16($FF)) <- old
  CURSOR <- u8($40)
}
action vector "acknowledged entry" (byte: 8) using memory {
  memory(u16($FF)) <- byte
  CURSOR <- byte
}
execution {
  memory 8
  counter NEXT write advance
  stopped PAUSED
  word big
  opcode advance on decode with action fetched
  operand advance after read
  failure retain
  reset action reset
  retire irq into DELAY
  notify reti after retire
  interrupt entries {
    source device acknowledge {
      when latch ENABLED otherwise "off"
      unless latch INHIBITED otherwise "later"
      accept action accept
      select MODE {
        case "stream" supplied
        case "vector" action vector
      }
    }
    source edge {
      accept action accept
      enter action direct
    }
  }
}
interface CpuProbe "Tiny generated public model" {
  bank Backup = spare snapshot BackupSnapshot
  snapshot spare.word = PAIR
}
page EXTRA = $42
family LOAD "0000 0000" on EXTRA {
  high = fetch
  low = fetch
  RESULT <- concat(high, low)
  defer irq
  notify reti
}
\`\`\``;
const initial = () => ({ cursor: 0xfe, ticks: 0x7f, result: 0, spare: { high: 0x12, low: 0x34, flags: { z: false } },
  mode: "stream", enabled: true, inhibited: false, paused: true, delay: false });
type State = ReturnType<typeof initial>;
type Snapshot = State & { spare: State["spare"] & { word: number } };
interface Cpu {
  snapshot(): Snapshot;
  reset(): unknown;
  step(): unknown;
  interrupt(source: string, acknowledge?: () => number): {
    before: Snapshot; after: Snapshot; outcome: string; reason?: string;
    instruction: { source: string; bytes: number[] } | null;
    accesses: unknown[];
  };
}
async function generate(text = markdown) {
  const model = await generateChapterModule(text, "probe", "probe.md");
  return model.CpuProbe as new (ram: Ram, state: State, ports?: undefined, onReti?: () => void) => Cpu;
}

test("named entries generate gates, vector actions, supplied decoding, and RETI delivery without CPU-specific names", async () => {
  const CpuProbe = await generate(), ram = new Ram(256), supplied = [0x42, 0, 0x12, 0x34];
  let notifications = 0;
  const cpu = new CpuProbe(ram, initial(), undefined, () => {
    notifications++;
    assert.equal(cpu.snapshot().result, 0x1234); assert.equal(cpu.snapshot().delay, true);
    assert.throws(() => cpu.interrupt("edge"), /not be reentrant/);
  });
  const observed: number[] = [];
  const record = cpu.interrupt("device", () => { observed.push(cpu.snapshot().ticks); return supplied[observed.length - 1]!; });
  assert.equal(record.outcome, "executed"); assert.equal(notifications, 1);
  assert.equal(record.after.cursor, 0xfe); assert.equal(record.after.paused, false);
  assert.deepEqual(observed, [0x80, 0x81, 0x81, 0x81]);
  assert.deepEqual(record.instruction, { source: "interrupt", bytes: supplied });
  assert.deepEqual(record.accesses, supplied.map(value => ({ kind: "acknowledge", value })));
  for (const mode of ["stream", "vector"]) {
    const direct = new CpuProbe(ram, { ...initial(), mode });
    assert.equal(direct.interrupt("edge").outcome, "accepted");
    assert.equal(ram.read(255), 0xfe); assert.equal(direct.snapshot().cursor, 0x40);
  }
  const vector = new CpuProbe(ram, { ...initial(), mode: "vector" });
  const entry = vector.interrupt("device", () => 0x56);
  assert.equal(entry.outcome, "accepted"); assert.equal(entry.instruction, null);
  assert.deepEqual(entry.accesses, [{ kind: "acknowledge", value: 0x56 }, { kind: "write", address: 255, value: 0x56 }]);
  assert.equal(vector.snapshot().cursor, 0x56); assert.equal(vector.snapshot().delay, false);
  for (const enabled of [false, true]) {
    const disabled = new CpuProbe(ram, { ...initial(), enabled, inhibited: true });
    assert.throws(() => disabled.interrupt("device"), /DEVICE requires an acknowledgement/);
    assert.throws(() => disabled.interrupt("irq"), /device or edge/);
    const ignored = disabled.interrupt("device", () => { assert.fail("ignored offers never acknowledge"); });
    assert.equal(ignored.reason, enabled ? "later" : "off");
    assert.deepEqual(ignored.before, ignored.after); assert.deepEqual(ignored.accesses, []);
  }
});

test("nested public views detach both input and output and remain chapter-controlled", async () => {
  const CpuProbe = await generate(markdown.replace("return concat(high, low)", "return concat(low, high)"));
  const state = initial(), ram = new Ram(256), cpu = new CpuProbe(ram, state), saved = cpu.snapshot();
  assert.equal(saved.spare.word, 0x3412);
  state.spare.high = 0; saved.spare.low = 0;
  assert.deepEqual(cpu.snapshot().spare, { high: 0x12, low: 0x34, flags: { z: false }, word: 0x3412 });
  assert.deepEqual(new CpuProbe(ram, cpu.snapshot()).snapshot(), cpu.snapshot());
  assert.throws(() => new CpuProbe(new Ram(65536), state), /256 bytes/);
  const failed = new CpuProbe(ram, initial()), before = failed.snapshot();
  assert.throws(() => failed.interrupt("device", () => 256), /byte/);
  assert.deepEqual(failed.snapshot(), { ...before, ticks: 0x80, enabled: false, paused: false });
  failed.reset(); // A failed acknowledgement releases the shared execution guard.
});

test("entry and bank declarations reject ambiguous or incomplete contracts at their chapter locations", () => {
  for (const [before, after, diagnostic] of [
    ['source edge {', 'source device {', /Duplicate interrupt source/],
    ['interrupt entries {', 'interrupt entries vectors {', /Expected/],
    ['      accept action accept\n      select', '      select', /acceptance before delivery/],
    ['      enter action direct', '      accept action accept\n      enter action direct', /Acceptance must appear once/],
    ['      enter action direct', '      enter action direct\n      unless latch ENABLED otherwise "off"', /gates must precede/],
    ['otherwise "off"', 'otherwise ""', /nonempty reason/],
    ['      accept action accept', '      accept action vector', /no inputs/],
    ['      accept action accept', '      accept action direct', /memory/],
    ['case "vector" action vector', 'case "vector" action direct', /one 8-bit input/],
    ['case "vector" action vector', 'case "other" action vector', /Unknown interrupt mode/],
    ['case "vector" action vector', 'case "stream" action vector', /Duplicate interrupt mode/],
    ['        case "vector" action vector\n', '', /every declared choice/],
    ['source device acknowledge', 'source device', /requires acknowledgement/],
    ['source edge {', 'source edge acknowledge {', /requires exhaustive mode selection/],
    ['      enter action direct\n', '', /acceptance and delivery/],
    ['bank Backup = spare', 'bank Backup = cursor', /stored group/],
    ['snapshot BackupSnapshot', 'snapshot Snapshot', /conflicts with another type/],
    ['snapshot spare.word', 'snapshot cursor.word', /stored group/],
    ['snapshot spare.word', 'snapshot spare.low', /Duplicate or reserved/],
    ['snapshot spare.word = PAIR', 'snapshot spare.word = PAIR\n  snapshot spare.word = PAIR', /Duplicate or reserved/],
  ] as const) {
    assert.ok(markdown.includes(before));
    assert.throws(() => compileCpuChapter(markdown.replace(before, after), {}, "probe.md"), error =>
      error instanceof ChapterError && error.line > 1 && diagnostic.test(error.message), `${before} -> ${after}`);
  }
});
