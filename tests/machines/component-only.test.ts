import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMachine } from "../../src/machines/machine-language.js";
import { Ram } from "../../src/components/memory/ram.js";
import { createLessonsEightByteMemory } from "../../src/machines/generated/lessons/eight-byte-memory.js";

test("component-only definitions retain local images in source order without CPU metadata", () => {
  assert.deepEqual(parseMachine(`image storage 1 { AA BB }
components { storage=ram 08 firmware=rom 02 input=byte-input output=byte-output }
image storage 2 { CC } image firmware 0 { 12 34 }`), {
    components: [
      { name: "storage", kind: "ram", size: 8 }, { name: "firmware", kind: "rom", size: 2 },
      { name: "input", kind: "byte-input" }, { name: "output", kind: "byte-output" },
    ],
    images: [
      { component: "storage", address: 1, bytes: [0xaa, 0xbb] },
      { component: "storage", address: 2, bytes: [0xcc] },
      { component: "firmware", address: 0, bytes: [0x12, 0x34] },
    ],
  });
});

test("component-only definitions reject CPU wiring, empty compositions, and invalid local images", () => {
  const components = "components { ram=ram 08 input=byte-input }";
  for (const [source, error] of [
    ["components {}", /at least one component/],
    ["image ram 0 { AA }", /Missing components/],
    ...["memory=ram", "map 1000000 {}", "ports {}", "reset {}", "reset-devices {}", "end 0"]
      .map(declaration => [`${components} ${declaration}`, /requires a cpu declaration/] as const),
    [components + " ram 10000", /cannot be mixed/],
    [components + " memory 0 {}", /cannot be mixed/],
    [components + " image absent 0 { AA }", /Unknown component/],
    [components + " image input 0 { AA }", /Images require RAM or ROM/],
    [components + " image ram 8 {}", /Image address exceeds/],
    [components + " image ram 7 { AA BB }", /Image extends beyond/],
  ] as const) assert.throws(() => parseMachine(source), error, source);
  assert.throws(() => parseMachine(`${components}\nimage ram 7 { AA BB }`, "eight.machine"), {
    message: "eight.machine:2:18: Image extends beyond component ram\nimage ram 7 { AA BB }\n                 ^",
  });
  assert.doesNotThrow(() => parseMachine(components + " image ram 7 { FF }"));
});

test("the eight-byte lesson factory supplies independent zero-filled RAM with isolated addresses", () => {
  const machine = createLessonsEightByteMemory();
  assert.deepEqual(Object.keys(machine), ["ram", "snapshot"]);
  assert.ok(machine.ram instanceof Ram);
  assert.equal(machine.ram.size, 8);
  const bytes = () => Array.from({ length: machine.ram.size }, (_, address) => machine.ram.read(address));
  assert.deepEqual(bytes(), Array(8).fill(0));
  machine.ram.write(3, 200);
  machine.ram.write(7, 255);
  assert.deepEqual(bytes(), [0, 0, 0, 200, 0, 0, 0, 255]);
  assert.throws(() => machine.ram.write(8, 1), RangeError);
  assert.throws(() => machine.ram.write(3, 256), RangeError);
  assert.equal(machine.ram.read(3), 200);
  const fresh = createLessonsEightByteMemory();
  assert.notEqual(machine.ram, fresh.ram);
  assert.deepEqual(Array.from({ length: 8 }, (_, address) => fresh.ram.read(address)), Array(8).fill(0));
});
