import assert from "node:assert/strict";
import { test } from "node:test";
import { createApplesoftListing, resolveApplesoftSource } from "../../site/interactive/apple2-applesoft.js";
import { createApplesoftEvents } from "../../site/interactive/apple2-applesoft-events.js";
import { createApple2Session } from "../../site/interactive/apple2-session.js";
import type { Cpu6502Access } from "../../src/components/cpus/generated/6502-cpu.js";

function fixture() {
  const { machine } = createApple2Session(), { ram } = machine;
  const keywords: string[] = []; keywords[0x39] = "POKE";
  keywords[3] = "DATA"; keywords[7] = "READ";
  const decode = createApplesoftListing(keywords), listing = () => decode(ram), events = createApplesoftEvents(listing);
  const word = (at: number, value: number) => { ram.write(at, value & 255); ram.write(at + 1, value >> 8); };
  function program(at: number): void {
    word(0x67, at); word(0x69, at + 15); word(at, at + 13); word(at + 2, 10);
    [0xb9, ...[..."4096,42"].map(c => c.charCodeAt(0)), 0, 0, 0].forEach((b, i) => ram.write(at + 4 + i, b));
    word(0x75, 10); word(0xb8, at + 4);
  }
  program(0x801);
  // Synthetic boundary records isolate the observer; the real-ROM suite executes these hooks.
  function observe(pc: number, bytes: number[] = [], accesses: Cpu6502Access[] = [], space = "rom") {
    const snapshot = machine.cpu.snapshot();
    const record = { before: { ...snapshot, pc }, after: snapshot, accesses, instruction: { address: pc, bytes }, outcome: "executed" as const };
    events.observe(machine, { address: pc, space }, record); return record;
  }
  machine.memory.read = () => { throw new Error("Software observation must not access the guest bus"); };
  return { machine, ram, events, listing, program, word, observe };
}

test("Applesoft bus events retain actual values and source while Memory and program text change", () => {
  const { ram, events, listing, program, observe } = fixture();
  observe(0xd828);
  observe(0xe781, [0x91, 0x50], [{ kind: "write", address: 0x1000, value: 42 }]);
  const event = events.entries[0]!;
  assert.equal(event.kind, "POKE");
  if (event.kind !== "POKE") return;
  ram.write(0x1000, 99);
  assert.equal(event.value, 42);
  program(0x4001);
  assert.equal(resolveApplesoftSource(listing(), event.origin.source!)?.address, 0x4005);
  ram.write(0x4006, 53);
  assert.equal(resolveApplesoftSource(listing(), event.origin.source!), undefined);
  observe(0xe76f, [0xb1, 0x50], [{ kind: "read", address: 0xc010, value: 0x81 }]);
  assert.deepEqual(events.entries.at(-1), { number: 2, origin: event.origin, kind: "PEEK", address: 0xc010, value: 0x81 });
});

test("recording restarts at a statement boundary; clear, errors and banked code discard pending observations", () => {
  const { machine, events, observe } = fixture();
  const peek = () => observe(0xe76f, [0xb1, 0x50], [{ kind: "read", address: 0x1000, value: 42 }]);
  observe(0xd828); events.record(false); peek(); assert.equal(events.total, 0);
  events.record(true); peek(); assert.equal(events.total, 0);
  observe(0xd828); peek(); assert.equal(events.total, 1);
  events.clear(); peek(); assert.equal(events.total, 0);
  for (const boundary of [0xd412, 0xf2e9]) {
    observe(0xd828); observe(boundary); peek(); assert.equal(events.total, 0);
  }
  observe(0xd828); machine.language.read(0); // Map RAM, as an actual PEEK can do.
  peek(); assert.equal(events.total, 1, "The transfer which changed mapping began in ROM and is retained");
  observe(0xe76f, [0xb1, 0x50], [{ kind: "read", address: 0x1000, value: 99 }], "lc-upper");
  machine.language.read(2); peek(); assert.equal(events.total, 1, "Banked execution invalidates the old statement");
  observe(0xd828);
  const record = observe(0x200, [], [], "ram");
  events.observe(machine, { address: 0x200, space: "ram" }, { ...record, outcome: "unsupported", reason: "opcode" });
  peek(); assert.equal(events.total, 1);
});

test("a keyboard wait preserves the originating statement for PEEK in an INPUT subscript", () => {
  const { events, observe } = fixture();
  observe(0xd828); observe(0xfd6f);
  observe(0xe76f, [0xb1, 0x50], [{ kind: "read", address: 0x1000, value: 1 }]);
  assert.equal(events.entries[0]?.origin.source?.line, 10);
});

test("RESTORE records completed cursor resets only for the statement, not shared calls from RUN", () => {
  const { ram, events, observe, word } = fixture();
  word(0x7d, 0x900); observe(0xd828); observe(0xd849); word(0x7d, 0x800); observe(0xd855);
  assert.equal(events.total, 0);
  ram.write(0x805, 0xae); observe(0xd828); word(0x7d, 0x900); observe(0xd849);
  assert.equal(events.total, 0); word(0x7d, 0x800); observe(0xd855);
  assert.equal(events.entries[0]!.kind, "RESTORE");
  const event = events.entries[0]!;
  if (event.kind === "RESTORE") assert.deepEqual([event.previous, event.address], [0x900, 0x800]);
  observe(0xd855); assert.equal(events.total, 1);
});

test("READ logs completed scalar assignments from padded DATA, excludes INPUT/GET and abandons failed pending items", () => {
  const { ram, events, observe, word } = fixture();
  word(0x801, 0x80a); word(0x803, 10);
  [0x87, 65, 44, 66, 0].forEach((b, i) => ram.write(0x805 + i, b));
  word(0x80a, 0x815); word(0x80c, 20);
  [32, 0x83, 32, 49, 44, 50, 0].forEach((b, i) => ram.write(0x80e + i, b));
  word(0x815, 0); word(0x69, 0x817); word(0x6b, 0x81e); word(0x6d, 0x81e);
  [65, 0, 129, 0, 0, 0, 0].forEach((b, i) => ram.write(0x817 + i, b));
  word(0x85, 0x819); word(0x7d, 0x800);
  observe(0xd828); observe(0xdbe2); word(0xb8, 0x811);
  for (const flag of [0, 0x40]) {
    ram.write(0x15, flag); observe(0xdc2e); observe(0xdc72); assert.equal(events.total, 0);
  }
  ram.write(0x15, 0x98); observe(0xdc2e); assert.equal(events.total, 0);
  observe(0xdc72);
  const event = events.entries[0]!; assert.equal(event.kind, "READ");
  if (event.kind !== "READ") return;
  assert.deepEqual([event.data.address, event.data.source.line, event.variable.name, event.variable.address, event.variable.value], [0x811, 20, "A", 0x819, "1"]);
  word(0xb8, 0x813); observe(0xdc2e); observe(0xd412); observe(0xdc72);
  assert.equal(events.total, 1); assert.equal(ram.read(0x7d), 0, "The observer never advances DATPTR");
  ram.write(0x819, 130); assert.equal(event.variable.value, "1");
});
