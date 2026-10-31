import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { compileDeviceChapter } from "../../src/components/devices/semantics/compile.js";
import { generateDevices } from "../../scripts/generate-devices.js";
import { parseMachine } from "../../src/machines/machine-language.js";

const source = readFileSync("src/components/devices/specifications/mc6850-polling.md", "utf8");
const pinSource = source.replace("  register RX: 8", "  register RX: 8\n  array BANK: 8[4]")
  .replace("  TX <- u8($00)", "  TX <- u8($00)\n  BANK[] <- u8(0)")
  .replace("interface Mc6850Polling {", `action setPins "Sample external data and a pin" (byte: 8, high: flag) {
  RX <- byte
  FULL <- high
  BANK[and(byte, u8(3))] <- byte
}

interface Mc6850Polling {
  input setPins`);

test("public device inputs bind actions with typed arguments and reject invalid declarations", () => {
  assert.deepEqual(compileDeviceChapter(pinSource).interface.inputs, ["setPins"]);
  for (const [binding, expected] of [
    ["input missing", /Unknown action/],
    ["input status", /Unknown action/],
    ["input setPins\n  input setPins", /Duplicate input/],
    ["view setPins", /Unknown source/],
  ] as const) assert.throws(() => compileDeviceChapter(pinSource.replace("input setPins", binding), "pins.md"), error => {
    assert.ok(error instanceof Error); assert.match(error.message, /^pins\.md:\d+:\d+:/);
    assert.match(error.message, expected); return true;
  });
  for (const name of ["read", "snapshot", "then", "constructor"]) {
    assert.throws(() => compileDeviceChapter(pinSource.replaceAll("setPins", name)), /conflicts/);
  }
  const rejecting = pinSource.replace("  RX <- byte\n  FULL <- high", `  selected = match byte: 8 {
    case "0000 0000" {
      return u8(0)
    }
    otherwise unsupported
  }
  RX <- selected`);
  assert.throws(() => compileDeviceChapter(rejecting), /cannot reject/);
});

test("addressed device bindings require byte-address signatures and cannot overlap individual bindings", () => {
  const chapter = readFileSync("src/components/devices/specifications/apple2-language-card.md", "utf8");
  for (const [before, after, error] of [
    ["read * readSwitch", "read 0 readSwitch", /signature/],
    ["read * readSwitch", "read * ramRead", /signature/],
    ["write * writeSwitch", "write 0 writeSwitch", /signature/],
    ["read * readSwitch", "read * readSwitch\n  read * readSwitch", /Duplicate read/],
    ["write * writeSwitch", "write * writeSwitch\n  write * writeSwitch", /Duplicate write/],
    ["size 16", "", /Declare size/],
  ] as const) assert.throws(() => compileDeviceChapter(chapter.replace(before, after)), error);
  assert.throws(() => compileDeviceChapter(source.replace("read 1 readData", "read * readData")), /signature/);
});

test("device chapters share typed effects and reject invalid operations at Markdown locations", () => {
  const chapter = compileDeviceChapter(source, "serial.md");
  assert.equal(chapter.model.name, "mc6850-polling");
  assert.deepEqual([...chapter.interface.reads], [[0, { source: "status", addressed: false }], [1, { source: "readData", addressed: false }]]);
  for (const [before, after, message] of [
    ["RX <- byte", "RX <- u16($0000)", /expected 8-bit value/],
    ["byte = register RX", "byte = memory(u16($0000))", /cannot.*memory/],
    ["write 0 configure", "write 0 status", /signature/],
    ["read 1 readData", "read 2 readData", /address must be within/],
    ["read 1 readData", "read 0 readData", /Duplicate read/],
    ["source validState", "source status", /Duplicate declaration/],
    ["  supported = source supportedControl(control)", "  FULL <- 0\n  supported = source supportedControl(control)", /Views may only read/],
    ['device "mc6850-polling"', 'device "ram"', /reserved/],
  ] as const) {
    assert.ok(source.includes(before), before);
    assert.throws(() => compileDeviceChapter(source.replace(before, after), "serial.md"), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^serial\.md:\d+:\d+:/);
      assert.match(error.message, message); return true;
    });
  }
  assert.throws(() => compileDeviceChapter("# Missing\n\n```device\n", "serial.md"), /serial.md:3:1: Unclosed device fence/);
  assert.throws(() => compileDeviceChapter("# Empty", "serial.md"), /requires device, state, and interface/);
});

test("generated device code follows chapter edits and failed regeneration preserves previous modules", async t => {
  const root = mkdtempSync(join(tmpdir(), "dromaios-device-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "src/components/devices"), specifications = join(directory, "specifications");
  mkdirSync(specifications, { recursive: true });
  mkdirSync(join(root, "src/components/cpus"));
  cpSync("src/components/cpus/state.ts", join(root, "src/components/cpus/state.ts"));
  cpSync("src/components/validation.ts", join(root, "src/components/validation.ts"));
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  const path = join(specifications, "probe.md");
  writeFileSync(path, pinSource.replace("RX <- byte", "RX <- xor(byte, u8($FF))").replace("size 2", "size 3\n  view status"));
  generateDevices(directory);
  const files = ["catalogue.ts", "probe-effects.ts", "probe-state.ts", "probe.ts"];
  assert.deepEqual(readdirSync(join(directory, "generated")).sort(), files);
  const { Mc6850Polling } = await import(pathToFileURL(join(directory, "generated/probe.ts")).href);
  const device = new Mc6850Polling(() => {});
  assert.deepEqual(device.snapshot().bank, [0, 0, 0, 0]);
  device.write(0, 0x15); device.offer(0x42);
  assert.equal(device.status(), device.read(0));
  assert.equal(device.read(1), 0xbd); // Changed formal effect reaches the public device API.
  device.setPins(0x35, true);
  const pins = device.snapshot();
  assert.equal(pins.rx, 0x35); assert.equal(pins.full, true);
  assert.deepEqual(pins.bank, [0, 0x35, 0, 0]);
  const restored = new Mc6850Polling(() => {}, pins);
  pins.bank[1] = 0xff;
  assert.deepEqual(restored.snapshot().bank, [0, 0x35, 0, 0]);
  assert.deepEqual(device.snapshot().bank, [0, 0x35, 0, 0]);
  pins.bank[1] = 0x35;
  assert.throws(() => new Mc6850Polling(() => {}, { ...pins, bank: [1, 2, 3] }));
  assert.throws(() => new Mc6850Polling(() => {}, { ...pins, bank: [0, 0, 256, 0] }));
  restored.reset(); assert.deepEqual(restored.snapshot().bank, [0, 0, 0, 0]);
  for (const value of [-1, 256, 0.5, NaN, Infinity, "42"]) {
    assert.throws(() => device.setPins(value, false), RangeError);
  }
  assert.throws(() => device.setPins(0x99, 1), TypeError); // Validate both inputs before writing RX.
  assert.deepEqual(device.snapshot(), pins);
  device.setPins(0x12, false);
  assert.equal(device.snapshot().rx, 0x12); assert.equal(device.snapshot().full, false);
  assert.equal(device.size, 3);
  assert.equal(device.read(2), "bus-error");
  assert.equal(device.write(2, 42), "bus-error");
  const { deviceModels } = await import(pathToFileURL(join(directory, "generated/catalogue.ts")).href);
  assert.deepEqual(deviceModels["mc6850-polling"], {
    name: "Mc6850Polling", module: "devices/generated/probe", size: 3, reads: [0, 1], writes: [0, 1], output: true, selectors: [],
  });
  const previous = files.map(file => readFileSync(join(directory, "generated", file), "utf8"));
  writeFileSync(path, source.replace("RX <- byte", "RX <- u16(0)"));
  assert.throws(() => generateDevices(directory), /probe.md:\d+:\d+:/);
  assert.deepEqual(files.map(file => readFileSync(join(directory, "generated", file), "utf8")), previous);
  rmSync(path); generateDevices(directory);
  assert.deepEqual(readdirSync(join(directory, "generated")), ["catalogue.ts"]);
});

test("machine ports and reset use the generated device's register capabilities", () => {
  const markdown = readFileSync("src/machines/8080/altair-serial.md", "utf8");
  // Direct parser receives language text; Markdown extraction is independently tested by generation.
  const source = [...markdown.matchAll(/```machine\n([\s\S]*?)```/g)].map(match => match[1]).join("\n");
  const machine = parseMachine(source);
  assert.ok("components" in machine && "ports" in machine);
  assert.deepEqual(machine.ports, [
    { direction: "in", port: 16, component: "serial", address: 0 },
    { direction: "out", port: 16, component: "serial", address: 0 },
    { direction: "in", port: 17, component: "serial", address: 1 },
    { direction: "out", port: 17, component: "serial", address: 1 },
  ]);
  assert.throws(() => parseMachine(source.replace("in 11 = serial 1", "in 11 = serial 2")), /Device address exceeds/);
  assert.throws(() => parseMachine(source.replace("in 11 = serial 1", "in 11 = ram 0")), /Ports require a device/);
});


test("public device views reject unknown, duplicate, reserved, and transitively effectful sources", () => {
  const chapter = readFileSync("src/components/devices/specifications/apple2-video.md", "utf8");
  for (const [binding, expected] of [
    ["view missing", /Unknown source/],
    ["view inverse", /Duplicate view/],
    ["view readGraphics", /Views may only read/],
  ] as const) {
    assert.throws(() => compileDeviceChapter(chapter.replace("view textAddress", binding), "video.md"), error => {
      assert.ok(error instanceof Error); assert.match(error.message, /^video\.md:\d+:\d+:/);
      assert.match(error.message, expected); return true;
    });
  }
  assert.throws(() => compileDeviceChapter(chapter.replaceAll("characterCode", "snapshot")), /conflicts/);
  const nested = chapter.replace('  return and(not(bit(byte, 7))', '  ignored = source readGraphics()\n  return and(not(bit(byte, 7))');
  assert.throws(() => compileDeviceChapter(nested), /Views may only read/);
});
