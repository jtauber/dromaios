import { Cpu8080 } from "../../components/cpus/8080.ts";
import type { Cpu8080ResetRecord } from "../../components/cpus/8080.ts";
import type { BytePorts } from "../../components/cpus/port-access.ts";
import { ByteInput } from "../../components/devices/byte-input.ts";
import { ByteOutput } from "../../components/devices/byte-output.ts";
import { Ram } from "../../components/memory/ram.ts";

/** Allocate a polling echo machine; the host offers input between execution calls. */
export function create8080EchoExample(onWrite: (value: number) => void): {
  cpu: Cpu8080; ram: Ram; input: ByteInput; output: ByteOutput; ports: BytePorts; reset: () => Cpu8080ResetRecord;
} {
  const ram = new Ram(0x10000);
  const program = [
    0xdb, 0x00,       // 0000: IN 00 — input ready?
    0xb7,             // 0002: ORA A
    0xca, 0x00, 0x00, // 0003: JZ 0000 — poll while empty.
    0xdb, 0x01,       // 0006: IN 01 — consume the pending byte.
    0xd3, 0x01,       // 0008: OUT 01 — echo it.
    0xfe, 0x0a,       // 000A: CPI 0A — stop after echoing newline.
    0xc2, 0x00, 0x00, // 000C: JNZ 0000
    0x76,             // 000F: HLT
  ];
  program.forEach((value, address) => ram.write(address, value));
  const input = new ByteInput();
  const output = new ByteOutput(onWrite);
  const ports: BytePorts = {
    readPort: port => {
      if (port !== 0 && port !== 1) throw new Error("This machine only connects input ports 00 and 01.");
      return input.read(port);
    },
    writePort: (port, value) => {
      if (port !== 1) throw new Error("This machine only connects output port 01.");
      output.write(0, value);
    },
  };
  const cpu = new Cpu8080(ram, {
    a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0, sp: 0,
    flags: { s: false, z: false, ac: false, p: false, cy: false },
    interruptEnabled: false, interruptDeferred: false, halted: false,
  }, ports);
  const reset = (): Cpu8080ResetRecord => {
    const record = cpu.reset(); // Check the CPU boundary before clearing either device.
    input.reset();
    output.reset();
    return record;
  };
  return { cpu, ram, input, output, ports, reset };
}
