/** ESC carries six external opcode bits; register forms expose the selector, never a CPU register value. */
export interface Cpu8088Escape {
  readonly opcode: number;
  readonly modRM: number;
  readonly memory: { readonly segment: number; readonly offset: number; readonly address: number; readonly value: number } | null;
}

/** Device state and TEST pin level belong to the machine, independently of CPU snapshots. */
export interface Cpu8088ExternalConnections {
  readonly escape?: (instruction: Cpu8088Escape) => void;
  /** Physical TEST level: high waits; low permits the next instruction. */
  readonly test?: () => boolean;
}

export type Cpu8088ExternalAccess = (Cpu8088Escape & { readonly kind: "escape" }) | { readonly kind: "test"; readonly high: boolean };

/** External effects available to generated bodies, independently of their CPU and memory effects. */
export interface Cpu8088ExternalContext {
  readonly readTest: () => boolean;
  readonly sendEscape: (request: Cpu8088Escape) => void;
}

/** Validate pin samples and record successful device effects; callbacks never own the recorded request. */
export function record8088External(connections: Cpu8088ExternalConnections | undefined,
  record: (access: Cpu8088ExternalAccess) => void): Cpu8088ExternalContext {
  return {
    readTest() {
      if (!connections?.test) throw new TypeError("8088 WAIT requires a TEST input connection.");
      const high = connections.test();
      if (typeof high !== "boolean") throw new TypeError("8088 TEST input must return a Boolean pin level.");
      record({ kind: "test", high });
      return high;
    },
    sendEscape(request) {
      connections?.escape?.({ ...request, memory: request.memory && { ...request.memory } });
      record({ kind: "escape", ...request });
    },
  };
}
