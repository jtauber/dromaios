import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseMachine } from "../../src/machines/machine-language.js";

const cpu8080 = `cpu 8080 {
  A=00 B=00 C=00 D=00 E=00 H=00 L=00 PC=0000 SP=0000
  flags { S=0 Z=0 AC=0 P=0 CY=0 }
  interruptEnabled=false interruptDeferred=false halted=false
}`;
const direct = `components { ram=ram 10000 input=byte-input output=byte-output }
memory=ram
${cpu8080}`;
const mapped = readFileSync("src/machines/68000/echo-example.machine", "utf8");

test("named definitions resolve forward references, preserve image order, and distinguish port directions", () => {
  const machine = parseMachine(`image main $100 { AA BB }
image main 0101h { CC }
ports { out 01=sink 0 in 01=keyboard 1 in 00=keyboard 0 }
reset { cpu keyboard sink }
memory=main
${cpu8080}
components { sink=byte-output main=ram 0x10000 keyboard=byte-input }`);
  assert.ok("components" in machine);
  assert.deepEqual(machine.components, [
    { name: "sink", kind: "byte-output" }, { name: "main", kind: "ram", size: 65536 },
    { name: "keyboard", kind: "byte-input" },
  ]);
  assert.deepEqual(machine.connection, { kind: "direct", component: "main" });
  assert.deepEqual(machine.images, [
    { component: "main", address: 256, bytes: [170, 187] }, { component: "main", address: 257, bytes: [204] },
  ]);
  assert.deepEqual(machine.ports, [
    { direction: "out", port: 1, component: "sink", address: 0 },
    { direction: "in", port: 1, component: "keyboard", address: 1 },
    { direction: "in", port: 0, component: "keyboard", address: 0 },
  ]);
  assert.deepEqual(machine.reset, ["cpu", "keyboard", "sink"]);
  assert.equal(Object.hasOwn(machine, "resetDevices"), false);
  assert.equal(Object.hasOwn(machine, "endAddress"), false);
});

test("mapped definitions retain physical regions, logical completion, and independent reset lists", () => {
  const machine = parseMachine(`${mapped}\nend AB000100`);
  assert.ok("components" in machine);
  assert.deepEqual(machine.connection, { kind: "mapped", size: 0x1000000, regions: [
    { start: 0, component: "rom" }, { start: 0x10000, component: "ram" },
    { start: 0x20000, component: "output" }, { start: 0x30000, component: "input" },
  ] });
  assert.deepEqual(machine.reset, ["cpu", "input", "output"]);
  assert.deepEqual(machine.resetDevices, ["input", "output"]);
  assert.equal(machine.endAddress, 0xab000100);
  const aliases = parseMachine(mapped.replace("030000 = input", "030000 = input\n040000 = ram"));
  assert.ok("components" in aliases && aliases.connection.kind === "mapped");
  assert.equal(aliases.connection.regions.length, 5);
});

test("direct named RAM works for all eight CPU state models", () => {
  for (const cpu of ["8008", "8080", "6502", "6800", "6809", "z80", "8088", "68000"]) {
    const source = readFileSync(`src/machines/${cpu}/example.machine`, "utf8");
    const legacy = parseMachine(source);
    assert.ok("ramSize" in legacy);
    const converted = parseMachine(source.replace(/ram ([0-9A-Fa-f]+)/, "components { storage=ram $1 }\nmemory=storage")
      .replace(/memory ([0-9A-Fa-f]+)/g, "image storage $1"));
    assert.ok("components" in converted);
    assert.deepEqual(converted.initialState, legacy.initialState);
    assert.deepEqual(converted.images, legacy.memory.map(image => ({ component: "storage", ...image })));
    assert.equal(converted.endAddress, legacy.endAddress);
  }
});

test("composition declarations reject invalid names, duplicate declarations, and incompatible shorthand", () => {
  for (const [source, message] of [
    [direct + "\ncomponents {}", /Duplicate components/],
    [direct + "\nmemory=ram", /Duplicate memory/],
    [mapped + "\nmap 1000000 {}", /Duplicate map/],
    [direct + "\nports {} ports {}", /Duplicate ports/],
    [direct + "\nreset {cpu} reset {cpu}", /Duplicate reset declaration/],
    [mapped + "\nreset-devices {}", /Duplicate reset-devices/],
    [direct.replace("ram=ram", "ram=rom 10 ram=ram"), /Duplicate component/],
    [direct.replace("input=byte-input", "cpu=byte-input"), /Reserved component/],
    [direct.replace("input=byte-input", "Input=byte-input"), /lowercase component name/],
    [direct.replace("input=byte-input", "bad-name=byte-input"), /lowercase component name/],
    [direct.replace("byte-input", "unknown-device"), /Expected component kind/],
    [direct.replace("ram 10000", "ram 0"), /must be positive/],
    [direct.replace("ram 10000", "ram 1000001"), /Component size must be/],
    [direct + "\nram 10000", /cannot be mixed/],
    [direct + "\nmemory 0000 {}", /cannot be mixed/],
    [`${cpu8080} memory=absent`, /Missing components/],
    [`${cpu8080} components { ram=ram 10000 }`, /Missing CPU memory connection/],
    ["components {} memory=ram", /Missing cpu/],
    ["components { ram=ram 10000", /close components/],
  ] as const) assert.throws(() => parseMachine(source), message, source);
});

test("wiring checks targets, CPU support, full component bounds, and overlapping regions", () => {
  for (const [source, message] of [
    [direct.replace("memory=ram", "memory=missing"), /Unknown component "missing"/],
    [direct.replace("memory=ram", "memory=input"), /Direct CPU memory requires RAM/],
    [direct.replace("ram=ram 10000", "ram=rom 10000"), /Direct CPU memory requires RAM/],
    [direct.replace("ram 10000", "ram 1000"), /Direct CPU memory requires RAM/],
    [direct + "\nmap 10000 {}", /Choose memory/],
    [direct.replace("memory=ram", "map 10000 {}"), /Mapped memory currently requires CPU 68000/],
    [mapped.replace("map 1000000", "map 10000"), /Address-space size for 68000/],
    [mapped.replace("010000 = ram", "0003FF = ram"), /Memory regions overlap/],
    [mapped.replace("010000 = ram", "FFF001 = ram"), /beyond the address space/],
    [mapped.replace("010000 = ram", "010000 = missing"), /Unknown component/],
    [mapped + "\nports {}", /Port bindings currently require CPU 8080/],
    [direct + "\nports { in 00=input 0 in 00=input 1 }", /Duplicate in port/],
    [direct + "\nports { out 00=output 0 out 00=output 0 }", /Duplicate out port/],
    [direct + "\nports { read 00=input 0 }", /Expected port direction/],
    [direct + "\nports { in 100=input 0 }", /Port must be in/],
    [direct + "\nports { in 00=output 0 }", /in ports require a byte-input/],
    [direct + "\nports { out 00=input 0 }", /out ports require a byte-output/],
    [direct + "\nports { out 00=missing 0 }", /Unknown component/],
    [direct + "\nports { in 00=input 2 }", /Device address exceeds/],
    [direct + "\nports { out 00=output 1 }", /Device address exceeds/],
    [direct + "\nend 10000", /Completion address must be/],
  ] as const) assert.throws(() => parseMachine(source), message, source);
});

test("images target RAM or ROM, fit locally, and diagnose the first excess byte at its source location", () => {
  for (const [image, message] of [
    ["image absent 0 { AA }", /Unknown component/],
    ["image input 0 { AA }", /Images require RAM or ROM/],
    ["image ram 10000 {}", /Image address exceeds/],
    ["image ram FFFF { AA BB }", /Image extends beyond/],
    ...["F", "0xFF", "FFh", "FF,", "GG", "-1"].map(byte => [`image ram 0000 { ${byte} }`, /two-digit hexadecimal byte/] as const),
    ["image ram 0 {", /close image/],
  ] as const) assert.throws(() => parseMachine(`${direct}\n${image}`), message);
  assert.throws(() => parseMachine(`image rom 0003 { AA BB }\n${mapped.replace("rom 0400", "rom 0004")}`, "bad.machine"),
    { message: 'bad.machine:1:21: Image extends beyond component rom\nimage rom 0003 { AA BB }\n                    ^' });
  const boundary = parseMachine(direct + "\nimage ram FFFF { FF } image ram FFFF {}");
  assert.ok("components" in boundary);
  assert.deepEqual(boundary.images.at(-1)?.bytes, []);
});

test("reset declarations separate machine reset from the 68000 device signal", () => {
  for (const [source, message] of [
    [direct + "\nreset {}", /Machine reset must begin with cpu/],
    [direct + "\nreset { output cpu }", /Machine reset must begin with cpu/],
    [direct + "\nreset { cpu ram }", /Only devices/],
    [direct + "\nreset { cpu missing }", /Unknown component/],
    [direct + "\nreset { cpu output output }", /Duplicate reset target/],
    [direct + "\nreset-devices { output }", /reset-devices currently requires CPU 68000/],
    [mapped.replace("reset-devices { input output }", "reset-devices { ram }"), /Only devices/],
  ] as const) assert.throws(() => parseMachine(source), message, source);
  const noDevices = parseMachine(mapped.replace("reset { cpu input output }", "reset { cpu }")
    .replace("reset-devices { input output }", "reset-devices {}"));
  assert.ok("components" in noDevices);
  assert.deepEqual(noDevices.reset, ["cpu"]);
  assert.deepEqual(noDevices.resetDevices, []);
});
