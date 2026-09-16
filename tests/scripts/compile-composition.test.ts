import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { compileMachine } from "../../scripts/generate-machines.js";

// Run generated TypeScript with the real compiled components and its actual relative imports.
async function load(source: string, path: string, t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "dromaios-composition-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  cpSync("dist/src/components", join(directory, "src/components"), { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({ type: "module" }));
  const filename = join(directory, "src/machines/generated", path.replace(/\.machine$/, ".ts"));
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, compileMachine(source, path));
  return import(pathToFileURL(filename).href);
}

test("generated mapped factories support named callbacks, aliases, overlays, independent instances, and selective resets", async t => {
  const cpu = readFileSync("src/machines/68000/echo-example.machine", "utf8").split("cpu 68000")[1]!.split("\nmap ")[0]!;
  const source = `cpu 68000${cpu}
components { default=rom 10 default_image=ram 10 input=byte-input sink=byte-output audit=byte-output }
map 1000000 { 0=default 100=default_image 200=input 300=sink 301=audit 400=default_image }
image default 0 { 00 00 01 10 00 00 00 08 }
image default 8 { 4E 71 4E 71 }
image default 9 { 70 }
image default_image 0 { AA BB }
image default_image 1 { CC }
reset { cpu input audit }
reset-devices { sink }
end AB00000C`;
  const { createDeepMapped } = await load(source, "deep/mapped.machine", t);
  const sink: number[] = [], audit: number[] = [];
  const machine = createDeepMapped({ sink: (value: number) => sink.push(value), audit: (value: number) => audit.push(value) });
  const fresh = createDeepMapped({ sink: () => assert.fail("Independent sink"), audit: () => assert.fail("Independent audit") });
  assert.equal(machine.cpu.snapshot().pc, 0); // Construction does not boot or execute RESET.
  assert.deepEqual(sink, []);
  assert.deepEqual(audit, []);
  assert.equal(machine.endAddress, 0xab00000c);
  assert.equal(machine.default.size, 16);
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => machine.default.read(8 + i)), [0x4e, 0x70, 0x4e, 0x71, 0]);
  assert.deepEqual([machine.default_image.read(0), machine.default_image.read(1), machine.default_image.read(2)], [0xaa, 0xcc, 0]);
  assert.equal(machine.memory.write(9, 0), "bus-error");
  assert.equal(machine.memory.read(0x1000), "bus-error");
  machine.memory.write(0x401, 0x55);
  assert.equal(machine.memory.read(0x101), 0x55); // Both regions alias the same RAM.
  assert.equal(fresh.default_image.read(1), 0xcc);
  assert.notEqual(fresh.cpu, machine.cpu);
  assert.notEqual(fresh.input, machine.input);
  machine.input.offer(0x11);
  machine.memory.write(0x300, 0x22);
  machine.memory.write(0x301, 0x33);
  const reset = machine.reset();
  assert.equal(reset.after.pc, 8);
  assert.equal(reset.accesses.length, 8);
  assert.equal(machine.cpu.snapshot().pc, 8);
  assert.deepEqual(machine.input.snapshot(), { pendingByte: null });
  assert.deepEqual(machine.audit.snapshot(), { lastByte: null });
  assert.deepEqual(machine.sink.snapshot(), { lastByte: 0x22 });
  machine.input.offer(0x44);
  machine.audit.write(0, 0x55);
  machine.cpu.step(); // Guest RESET resets only the separately listed sink.
  assert.deepEqual(machine.sink.snapshot(), { lastByte: null });
  assert.deepEqual(machine.input.snapshot(), { pendingByte: 0x44 });
  assert.deepEqual(machine.audit.snapshot(), { lastByte: 0x55 });
  assert.deepEqual(sink, [0x22]);
  assert.deepEqual(audit, [0x33, 0x55]);
  assert.equal(Object.hasOwn(machine, "ports"), false);
});

test("generated port wiring routes each direction and local address without sharing latches or host bindings", async t => {
  const source = readFileSync("src/machines/8080/echo-example.machine", "utf8")
    .replace("output = byte-output", "output = byte-output\nprinter = byte-output")
    .replace("out 01 = output 0", "out 01 = output 0\nout FF = printer 0");
  const { createWiring } = await load(source, "wiring.machine", t);
  const output: number[] = [], printer: number[] = [];
  const machine = createWiring({ output: (byte: number) => output.push(byte), printer: (byte: number) => printer.push(byte) });
  machine.input.offer(0xa5);
  machine.ports.writePort(1, 0x11);
  machine.ports.writePort(255, 0x22);
  assert.deepEqual(machine.input.snapshot(), { pendingByte: 0xa5 });
  assert.equal(machine.ports.readPort(0), 1);
  assert.equal(machine.ports.readPort(1), 0xa5);
  assert.equal(machine.ports.readPort(0), 0);
  assert.deepEqual(output, [0x11]);
  assert.deepEqual(printer, [0x22]);
  assert.throws(() => machine.ports.readPort(255), /Unconnected input port/);
  assert.throws(() => machine.ports.writePort(0, 0x33), /Unconnected output port/);
  machine.reset();
  assert.deepEqual(machine.output.snapshot(), { lastByte: null });
  assert.deepEqual(machine.printer.snapshot(), { lastByte: 0x22 });
  assert.equal(Object.hasOwn(machine, "endAddress"), false);
});

test("generated direct machines need no bindings, ports, reset method, or memory-only factory when none are declared", async t => {
  const source = readFileSync("src/machines/6502/example.machine", "utf8")
    .replace("ram 10000", "components { storage=ram 10000 }\nmemory=storage")
    .replace(/memory ([0-9A-F]+)/g, "image storage $1");
  const module = await load(source, "plain.machine", t);
  assert.deepEqual(Object.keys(module), ["createPlain"]);
  const machine = module.createPlain();
  assert.deepEqual(Object.keys(machine).sort(), ["cpu", "endAddress", "storage"]);
  assert.equal(machine.storage.size, 0x10000);
  assert.equal(machine.storage.read(0x200), 0x18);
  machine.cpu.reset();
  machine.cpu.step();
  assert.equal(machine.cpu.snapshot().pc, 0x201);
});
