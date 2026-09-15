import { checkUnsigned } from "../validation.ts";

/** Byte-wide port connection; the CPU selects port addresses and the device owns its state. */
export interface BytePorts {
  readonly readPort: (port: number) => number;
  readonly writePort: (port: number, value: number) => void;
}

/** A completed port transfer, distinct from a memory read or write. */
export interface PortAccess {
  readonly kind: "input" | "output";
  readonly port: number;
  readonly value: number;
}

export interface RecordedPorts extends BytePorts {
  readonly accesses: readonly PortAccess[];
}

/** Record one step's port transfers. An absent connection fails only when an instruction uses it. */
export function recordPorts(ports: BytePorts | undefined, onAccess?: (access: PortAccess) => void): RecordedPorts {
  const accesses: PortAccess[] = [];
  const record = (access: PortAccess): void => { accesses.push(access); onAccess?.(access); };
  const connected = (): BytePorts => {
    if (!ports) throw new Error("Port I/O requires a connected device.");
    return ports;
  };
  return {
    accesses,
    readPort: port => {
      const value = connected().readPort(port);
      checkUnsigned("Port input byte", value, 0xff);
      record({ kind: "input", port, value });
      return value;
    },
    writePort: (port, value) => {
      connected().writePort(port, value);
      record({ kind: "output", port, value });
    },
  };
}
