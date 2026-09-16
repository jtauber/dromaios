import { Cpu8080 } from "../../components/cpus/8080.ts";
import type { Cpu8080ResetRecord } from "../../components/cpus/8080.ts";
import type { BytePorts } from "../../components/cpus/port-access.ts";
import { ByteOutput } from "../../components/devices/byte-output.ts";
import { Ram } from "../../components/memory/ram.ts";

/** Allocate a port-output machine without resetting or executing it. */
export function create8080OutputExample(onWrite: (value: number) => void): {
  cpu: Cpu8080; ram: Ram; output: ByteOutput; ports: BytePorts; reset: () => Cpu8080ResetRecord;
} {
  const ram = new Ram(0x10000);
  const program = [
    0x21, 0x00, 0x01, // 0000: LXI H,0100 — message in RAM.
    0x06, 0x06,       // 0003: MVI B,06 — six bytes.
    0x7e,             // 0005: MOV A,M
    0xd3, 0x01,       // 0006: OUT 01
    0x23,             // 0008: INX H
    0x05,             // 0009: DCR B
    0xc2, 0x05, 0x00, // 000A: JNZ 0005
    0x76,             // 000D: HLT
  ];
  program.forEach((value, address) => ram.write(address, value));
  [0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x0a].forEach((value, offset) => ram.write(0x100 + offset, value)); // HELLO\n

  const output = new ByteOutput(onWrite);
  const ports: BytePorts = {
    readPort: () => { throw new Error("This machine has no input ports."); },
    writePort: (port, value) => {
      if (port !== 0x01) throw new Error("This machine only connects output port 01.");
      output.write(0, value);
    },
  };
  const cpu = new Cpu8080(ram, {
    a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0, sp: 0,
    flags: { s: false, z: false, ac: false, p: false, cy: false },
    interruptEnabled: false, interruptDeferred: false, halted: false,
  }, ports);

  // CPU reset checks its execution boundary before either component changes.
  const reset = (): Cpu8080ResetRecord => {
    const record = cpu.reset();
    output.reset();
    return record;
  };
  return { cpu, ram, output, ports, reset };
}
