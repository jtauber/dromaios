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
  const points: XtEventStop[] = [{ kind: "input", port: 0, value: 0, enabled: false },
    { kind: "output", port: 0xffff, value: 0xff, enabled: true }, { kind: "interrupt", vector: 0, enabled: true }, { kind: "iret", enabled: true }];
  assert.deepEqual(decodeXtEventStops(JSON.stringify(points)), points);
  const copy = validateXtEventStops(points); assert.notEqual(copy[0], points[0]);
  for (const value of [null, {}, [null], [{ kind: "iret" }], [{ kind: "oops", enabled: true }],
    [{ kind: "input", port: -1, enabled: true }], [{ kind: "output", port: 0x10000, enabled: true }],
    [{ kind: "input", port: 1.5, enabled: true }], [{ kind: "input", port: "60", enabled: true }],
    [{ kind: "input", port: 0x60, value: 0x100, enabled: true }], [{ kind: "interrupt", vector: -1, enabled: true }],
    [{ kind: "interrupt", source: "irq1", enabled: true }], [points[0], points[0]], Array(65).fill(points[0])]) {
    assert.throws(() => validateXtEventStops(value as XtEventStop[]));
    assert.deepEqual(decodeXtEventStops(JSON.stringify(value)), []);
  }
  assert.deepEqual(decodeXtEventStops("not JSON"), []);
});
