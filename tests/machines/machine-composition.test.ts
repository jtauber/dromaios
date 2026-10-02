import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseMachine as parseDefinition } from "../../src/machines/machine-language.js";

function parseMachine(source: string, filename?: string) {
  const machine = parseDefinition(source, filename);
  assert.ok(machine.cpu !== undefined);
  return machine;
}

const cpu8080 = `cpu 8080 {
  A=00 B=00 C=00 D=00 E=00 H=00 L=00 PC=0000 SP=0000
  flags { S=0 Z=0 AC=0 P=0 CY=0 }
  interruptEnabled=false interruptDeferred=false halted=false
}`;
const direct = `components { ram=ram 10000 input=byte-input output=byte-output }
memory=ram
${cpu8080}`;
const mapped = readFileSync("src/machines/68000/echo-example.machine", "utf8");

test("memory windows resolve pure flag selectors, offsets, and explicit per-direction fallbacks", () => {
  const source = `${cpu8080}
map 10000 { D000=window 1000 {
  read=bank when card.ramRead and card.bank2
  read=rom offset 1000
  write=bank when card.ramWrite
  write=discard
} unmapped=00 }
components { bank=ram 1000 rom=rom 2000 card=apple2-language-card video=apple2-video }`;
  const machine = parseMachine(source);
  assert.ok("components" in machine && machine.connection.kind === "mapped");
  assert.deepEqual(machine.connection.regions, [{ start: 0xd000, window: { size: 0x1000,
    read: [
      { target: { component: "bank", offset: 0 }, when: [{ component: "card", view: "ramRead" }, { component: "card", view: "bank2" }] },
      { target: { component: "rom", offset: 0x1000 }, when: [] },
    ], write: [
      { target: { component: "bank", offset: 0 }, when: [{ component: "card", view: "ramWrite" }] },
      { target: "discard", when: [] },
    ],
  } }]);
  for (const [before, after, message] of [
    ["window 1000", "window 0", /must be positive/],
    ["window 1000", "window 1001", /beyond its target/],
    ["offset 1000", "offset 1001", /beyond its target/],
    ["read=rom offset 1000", "read=discard", /Only writes/],
    ["read=rom offset 1000", "", /unconditional read/],
    ["write=discard", "", /unconditional write/],
    ["write=discard", "write=discard write=bank", /must be last/],
    ["card.ramRead", "video.inverse", /zero-input flag view/], // Has a byte input.
    ["card.ramRead", "video.textAddress", /zero-input flag view/], // Returns an address.
    ["card.ramRead", "card.readSwitch", /zero-input flag view/], // Has effects; not a view.
    ["card.ramRead", "bank.ramRead", /zero-input flag view/],
    ["card.ramRead", "absent.ramRead", /Unknown component/],
    ["card.ramRead", "card", /component.view/],
    ["read=bank", "read=absent", /Unknown component/],
    ["D000=window", "F001=window", /beyond the address space/],
    ["unmapped=00", "DFFF=bank unmapped=00", /overlap/],
  ] as const) assert.throws(() => parseMachine(source.replace(before, after), "window.machine"), error => {
    assert.ok(error instanceof Error); assert.match(error.message, /^window\.machine:\d+:\d+:/);
    assert.match(error.message, message);
    return true;
  });
});

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
    [direct.replace("input=byte-input", "snapshot=byte-input"), /Reserved component/],
    [direct.replace("input=byte-input", "Input=byte-input"), /lowercase component name/],
    [direct.replace("input=byte-input", "bad-name=byte-input"), /lowercase component name/],
    [direct.replace("byte-input", "unknown-device"), /Expected component kind/],
    [direct.replace("ram 10000", "ram 0"), /must be positive/],
    [direct.replace("ram 10000", "ram 1000001"), /Component size must be/],
    [direct + "\nram 10000", /cannot be mixed/],
    [direct + "\nmemory 0000 {}", /cannot be mixed/],
    [`${cpu8080} memory=absent`, /Missing components/],
    [`${cpu8080} components { ram=ram 10000 }`, /Missing CPU memory connection/],
    ["components {} memory=ram", /memory requires a cpu/],
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
    [direct.replace("memory=ram", "map 10000 {}"), /8080 map requires an explicit unmapped bus value/],
    [mapped.replace("map 1000000", "map 10000"), /Address-space size for 68000/],
    [mapped.replace("010000 = ram", "0003FF = ram"), /Memory regions overlap/],
    [mapped.replace("010000 = ram", "FFF001 = ram"), /beyond the address space/],
    [mapped.replace("010000 = ram", "010000 = missing"), /Unknown component/],
    [mapped + "\nports {}", /Port bindings currently require CPU 8080/],
    [direct + "\nports { in 00=input 0 in 00=input 1 }", /Duplicate in port/],
    [direct + "\nports { out 00=output 0 out 00=output 0 }", /Duplicate out port/],
    [direct + "\nports { read 00=input 0 }", /Expected port direction/],
    [direct + "\nports { in 100=input 0 }", /Port must be in/],
    [direct + "\nports { in 00=output 0 }", /in ports require a readable device/],
    [direct + "\nports { out 00=input 0 }", /out ports require a writable device/],
    [direct + "\nports { out 00=missing 0 }", /Unknown component/],
    [direct + "\nports { in 00=input 2 }", /Device address exceeds/],
    [direct + "\nports { out 00=output 1 }", /Device address exceeds/],
    [direct + "\nend 10000", /Completion address must be/],
  ] as const) assert.throws(() => parseMachine(source), message, source);
});

test("8080 maps and ports declare unanswered bus values without changing the 68000 fault policy", () => {
  const source = direct.replace("ram 10000", "ram 1000")
    .replace("memory=ram", "map 10000 { 0000=ram unmapped=FF }") + "\nports { unmapped=5A in 00=input 0 }";
  const machine = parseMachine(source);
  assert.ok("components" in machine);
  assert.deepEqual(machine.connection, { kind: "mapped", size: 65536, unmapped: 255, regions: [{ start: 0, component: "ram" }] });
  assert.equal(machine.unmappedPorts, 0x5a);
  for (const [bad, error] of [
    [source.replace("unmapped=FF", "unmapped=FF unmapped=00"), /Duplicate unmapped bus/],
    [source.replace("unmapped=FF", "unmapped=100"), /Unmapped bus value must be/],
    [source.replace("unmapped=5A", "unmapped=00 unmapped=FF"), /Duplicate unmapped port/],
    [source.replace("unmapped=5A", "unmapped=100"), /Unmapped port value must be/],
    [source.replace("map 10000", "map 1000"), /Address-space size for 8080/],
    [source.replace("0000=ram", "F001=ram"), /beyond the address space/],
    [source.replace("0000=ram", "0000=ram 0FFF=ram"), /overlap/],
    [mapped.replace("map 1000000 {", "map 1000000 { unmapped=FF"), /68000 maps report bus errors/],
  ] as const) assert.throws(() => parseMachine(bad), error);
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

test("6502 maps require an explicit bus policy and retain their full address-space size", () => {
  const cpu = `cpu 6502 { A=0 X=0 Y=0 SP=FF PC=0 flags { N=0 V=0 D=0 I=0 Z=0 C=0 } }`;
  const source = `${cpu} components { ram=ram C000 rom=rom 3000 }
map 10000 { 0000=ram D000=rom unmapped=00 }`;
  const machine = parseMachine(source);
  assert.ok("components" in machine);
  assert.deepEqual(machine.connection, { kind: "mapped", size: 65536, unmapped: 0,
    regions: [{ start: 0, component: "ram" }, { start: 0xd000, component: "rom" }] });
  assert.throws(() => parseMachine(source.replace("unmapped=00", "")), /6502 map requires an explicit/);
  assert.throws(() => parseMachine(source.replace("map 10000", "map FFFF")), /Address-space size for 6502/);
  assert.throws(() => parseMachine(source.replace("D000=rom", "BFFF=rom")), /overlap/);
});

test("external images resolve ROM identities and reject ambiguous initialization", () => {
  const sha256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  const image = `image firmware external sha256 ${sha256}`;
  const components = "components { firmware=rom 3 ram=ram 3 keyboard=byte-input }";
  assert.deepEqual(parseDefinition(`${image.replace(sha256, sha256.toUpperCase())}\n${components}`), {
    components: [{ name: "firmware", kind: "rom", size: 3 }, { name: "ram", kind: "ram", size: 3 }, { name: "keyboard", kind: "byte-input" }],
    images: [], externalImages: [{ component: "firmware", sha256 }],
  });
  for (const [bad, error] of [
    [image.replace(sha256, "abc"), /64-digit SHA-256/],
    [image.replace(sha256, "g".repeat(64)), /64-digit SHA-256/],
    [image.replace("firmware", "ram"), /External images require ROM/],
    [image.replace("firmware", "keyboard"), /External images require ROM/],
    [image.replace("firmware", "absent"), /Unknown component/],
    [image + "\n" + image, /Duplicate external image/],
    [image + "\nimage firmware 0 { AA }", /cannot also contain embedded/],
    ["image firmware 0 {}\n" + image, /cannot also contain embedded/],
  ] as const) assert.throws(() => parseDefinition(`${components}\n${bad}`, "image.machine"), error);
  assert.throws(() => parseDefinition(`${components}\nimage firmware external sha256 xyz`, "bad.machine"),
    /bad.machine:2:32: Expected a 64-digit SHA-256 digest/);
});
