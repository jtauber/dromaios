/** ESC carries six external opcode bits; register forms expose the selector, never a CPU register value. */
export interface CoprocessorEscape {
  readonly opcode: number;
  readonly modRM: number;
  readonly memory: { readonly segment: number; readonly offset: number; readonly address: number; readonly value: number } | null;
}

/** Device state and TEST pin level belong to the machine, independently of CPU snapshots. */
export interface CoprocessorConnections {
  readonly escape?: (instruction: CoprocessorEscape) => void;
  /** Physical TEST level: high waits; low permits the next instruction. */
  readonly test?: () => boolean;
}

export type CoprocessorAccess = (CoprocessorEscape & { readonly kind: "escape" }) | { readonly kind: "test"; readonly high: boolean };

/** External effects available to generated bodies, independently of their CPU and memory effects. */
export interface CoprocessorContext {
  readonly readTest: () => boolean;
  readonly sendEscape: (request: CoprocessorEscape) => void;
}

/** Validate pin samples and record successful device effects; callbacks never own the recorded request. */
export function recordCoprocessor(cpu: string, connections: CoprocessorConnections | undefined,
  record: (access: CoprocessorAccess) => void): CoprocessorContext {
  return {
    readTest() {
      if (!connections?.test) throw new TypeError(`${cpu} WAIT requires a TEST input connection.`);
      const high = connections.test();
      if (typeof high !== "boolean") throw new TypeError(`${cpu} TEST input must return a Boolean pin level.`);
      record({ kind: "test", high });
      return high;
    },
    sendEscape(request) {
      connections?.escape?.({ ...request, memory: request.memory && { ...request.memory } });
      record({ kind: "escape", ...request });
    },
  };
}
