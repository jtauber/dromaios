import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeXtEventStops, validateXtEventStops, matchesXtEvent, xtEventCondition, describeXtEvent } from "../../site/interactive/xt-event-stops.js";
import type { XtEventStop } from "../../site/interactive/xt-event-stops.js";
import type { XtIoTransfer } from "../../site/interactive/xt-io-events.js";

const target = { address: 0xfe987, space: "CS:IP F000:E987" };
test("trace conditions retain exact port/value or source/vector; INTA selects entry and IRET selects returns", () => {
  for (const event of [
    { kind: "input", port: 0x60, value: 0 }, { kind: "output", port: 0xffff, value: 0xff },
    ...["intr", "nmi", "software", "trap", "divide-error"].map(source => ({ kind: "interrupt", source, vector: 9, target })),
    { kind: "iret", target },
    { kind: "dma", channel: 2, address: 0xfffff, value: 0, offset: 511, terminal: true, direction: "disk-to-memory", oscillatorTicks: 15 },
  ] as XtIoTransfer[]) {
    const condition = xtEventCondition(event);
    assert.equal(matchesXtEvent(condition, event), true);
    assert.deepEqual(validateXtEventStops([{ ...condition, enabled: true }]), [{ ...condition, enabled: true }]);
  }
  assert.deepEqual(xtEventCondition({ kind: "acknowledge", value: 9 }), { kind: "interrupt", source: "intr", vector: 9 });
  assert.equal(matchesXtEvent({ kind: "interrupt", source: "intr", vector: 9 }, { kind: "interrupt", source: "software", vector: 9, target }), false);
  assert.equal(matchesXtEvent({ kind: "interrupt", vector: 8 }, { kind: "interrupt", source: "intr", vector: 9, target }), false);
  assert.equal(matchesXtEvent({ kind: "interrupt" }, { kind: "acknowledge", value: 9 }), false);
  assert.equal(matchesXtEvent({ kind: "interrupt" }, { kind: "interrupt", source: "nmi", vector: 2, target }), true);
  assert.equal(matchesXtEvent({ kind: "input", port: 0x60, value: 0 }, { kind: "input", port: 0x60, value: 1 }), false);
  assert.equal(matchesXtEvent({ kind: "input", port: 0x60 }, { kind: "output", port: 0x60, value: 0 }), false);
  assert.equal(matchesXtEvent({ kind: "input", port: 0x60 }, { kind: "input", port: 0x61, value: 0 }), false);
  assert.equal(matchesXtEvent({ kind: "input", port: 0x60 }, { kind: "input", port: 0x60, value: 0xff }), true);
  assert.equal(describeXtEvent({ kind: "input", port: 0x60, value: 0 }), "IN $0060 = $00");
});

test("event preferences validate bounds, reject malformed/duplicate input, and detach accepted entries", () => {
  const access = { kind: "access", cs: 0x0c6f, ip: 0x570f, direction: "read", address: 0x268b9, enabled: true } as const;
  const points: XtEventStop[] = [{ kind: "input", port: 0, value: 0, enabled: false },
    access, { ...access, value: 0 }, { ...access, value: 0x95 },
    { kind: "output", port: 0xffff, value: 0xff, enabled: true }, { kind: "interrupt", vector: 0, enabled: true }, { kind: "iret", enabled: true },
    { kind: "dos", phase: "call", function: 0, enabled: true }, { kind: "dos", phase: "return", function: 255, enabled: false },
    { kind: "dos", phase: "error", enabled: true }];
  assert.deepEqual(decodeXtEventStops(JSON.stringify(points)), points);
  const copy = validateXtEventStops(points); assert.notEqual(copy[0], points[0]);
  for (const value of [null, {}, [null], [{ kind: "iret" }], [{ kind: "oops", enabled: true }],
    [{ kind: "dos", enabled: true }], [{ kind: "dos", phase: "success", enabled: true }],
    [{ kind: "dos", phase: "call", function: "3F", enabled: true }], [{ kind: "dos", phase: "error", function: 256, enabled: true }],
    [{ kind: "dma", address: 0x100000, enabled: true }], [{ kind: "dma", address: "3000", enabled: true }],
    ...[{ cs: -1 }, { ip: 0x10000 }, { direction: "fetch" }, { address: 0x100000 }].map(invalid => [{ ...access, ...invalid }]),
    ...[-1, 256, 1.5, "95", null].map(value => [{ ...access, value }]),
    [{ ...access, value: 0x95 }, { ...access, value: 0x95 }],
    [{ kind: "input", port: -1, enabled: true }], [{ kind: "output", port: 0x10000, enabled: true }],
    [{ kind: "input", port: 1.5, enabled: true }], [{ kind: "input", port: "60", enabled: true }],
    [{ kind: "input", port: 0x60, value: 0x100, enabled: true }], [{ kind: "interrupt", vector: -1, enabled: true }],
    [{ kind: "interrupt", source: "irq1", enabled: true }], [points[0], points[0]], Array(65).fill(points[0])]) {
    assert.throws(() => validateXtEventStops(value as XtEventStop[]));
    assert.deepEqual(decodeXtEventStops(JSON.stringify(value)), []);
  }
  assert.deepEqual(decodeXtEventStops("not JSON"), []);
});

test("an instruction access condition keeps the logical caller, physical byte and direction across replays", () => {
  const condition = { kind: "access", cs: 0xc6f, ip: 0x570f, address: 0x268b9, direction: "read" } as const;
  const observed = { ...condition, value: 0x95 };
  assert.deepEqual(xtEventCondition(observed), condition);
  assert.equal(describeXtEvent(condition), "CS:IP 0C6F:570F · READ $268B9");
  assert.ok(matchesXtEvent(condition, { ...observed, value: 0 }));
  const exact = { ...condition, value: 0 };
  assert.equal(describeXtEvent(exact), "CS:IP 0C6F:570F · READ $268B9 = $00");
  assert.ok(matchesXtEvent(exact, { ...observed, value: 0 }));
  assert.equal(matchesXtEvent(exact, observed), false);
  for (const different of [{ cs: 0xc70, ip: 0x56ff }, { direction: "write" }, { address: 0x268ba }] as const) {
    assert.equal(matchesXtEvent(condition, { ...observed, ...different }), false);
  }
  assert.equal(matchesXtEvent(condition, { kind: "iret", target }), false);
});
