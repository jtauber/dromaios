import { ByteOutput } from "../../src/components/devices/byte-output.js";
import type { ByteOutputSnapshot } from "../../src/components/devices/byte-output.js";
import type { MemoryConnection } from "../../src/components/memory/connection.js";
import { create68000OutputExample } from "../../src/machines/68000/output-example.js";
import { create8080OutputExample } from "../../src/machines/8080/output-example.js";
import type { Cpu8080ResetRecord } from "../../src/components/cpus/8080.js";
import type { BytePorts } from "../../src/components/cpus/port-access.js";

// Compiled, never called: notification, inspection, restoration, and memory-connection types.
export function checkByteOutput(): void {
  const output = new ByteOutput(value => { const byte: number = value; });
  const memory: MemoryConnection = output;
  const snapshot: ByteOutputSnapshot = output.snapshot();
  const last: number | null = snapshot.lastByte;
  new ByteOutput(() => {}, snapshot);
  // @ts-expect-error The latch can be empty.
  const byte: number = snapshot.lastByte;
  // @ts-expect-error Snapshot fields are readonly.
  snapshot.lastByte = 0;
  // @ts-expect-error There is no writable size register.
  output.size = 2;
  // @ts-expect-error A host output connection is required.
  new ByteOutput();
  // @ts-expect-error State contains a byte or null.
  new ByteOutput(() => {}, { lastByte: false });
  const machine = create68000OutputExample(() => {});
  const device: ByteOutput = machine.output;
  // @ts-expect-error The machine requires its host output connection too.
  create68000OutputExample();
  const portMachine = create8080OutputExample(() => {});
  const portDevice: ByteOutput = portMachine.output;
  const ports: BytePorts = portMachine.ports;
  const reset: Cpu8080ResetRecord = portMachine.reset();
  // @ts-expect-error The port machine also requires a host output connection.
  create8080OutputExample();
}
