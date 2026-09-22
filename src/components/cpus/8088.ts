import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition, InstructionStep, HaltedStep, WaitingStep } from "./execution-records.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import type { BytePorts, PortAccess } from "./port-access.ts";
import { copyState, readState } from "./state.ts";
import { cpu8088StateDescription } from "./state/8088.ts";
import type { Cpu8088State, Cpu8088Flags } from "./state/8088.ts";
import { instructions as actions, sourceReaders } from "./generated/8088-state.ts";
import { checkMemory, createExecution } from "./generated/8088-execution.ts";
import { record8088External } from "./8088-external.ts";
import type { Cpu8088ExternalAccess, Cpu8088ExternalConnections } from "./8088-external.ts";
import type { ReadonlyState } from "./state.js";
import { checkUnsigned } from "../validation.ts";

export type { Cpu8088Escape } from "./8088-external.ts";
export { cpu8088StateDescription } from "./state/8088.ts";
export type { Cpu8088State, Cpu8088Flags } from "./state/8088.ts";

export type Cpu8088Snapshot = ReadonlyState<Cpu8088State> & {
  readonly al: number;
  readonly ah: number;
  readonly bl: number;
  readonly bh: number;
  readonly cl: number;
  readonly ch: number;
  readonly dl: number;
  readonly dh: number;
  /** Physical address of CS:IP, for inspection and runner completion. */
  readonly pc: number;
};

/** Physical byte access on the 20-bit memory bus. */
export type Cpu8088MemoryAccess = MemoryAccess;

/** Independent machine-owned port and coprocessor connections. */
export interface Cpu8088Connections extends Cpu8088ExternalConnections { readonly ports?: BytePorts }

export type Cpu8088Access = MemoryAccess | PortAccess | Cpu8088ExternalAccess;

/** Instruction address is physical; before.cs and before.ip retain its logical address. */
export type Cpu8088Instruction = FetchedInstruction;

/** Interrupt delivery uses a type byte to select a four-byte vector at physical address type * 4. */
export interface Cpu8088Delivery {
  readonly source: "software" | "divide-error" | "trap";
  readonly vector: number;
}

export type Cpu8088StepRecord = (
  (InstructionStep<Cpu8088Snapshot, Cpu8088Access> | HaltedStep<Cpu8088Snapshot, Cpu8088Access>
    | WaitingStep<Cpu8088Snapshot, Cpu8088Access>) & {
    readonly interrupt?: Cpu8088Delivery;
  }
) | (StateTransition<Cpu8088Snapshot> & {
  readonly instruction: null;
  readonly outcome: "executed";
  readonly interrupt: { readonly source: "trap"; readonly vector: 1 };
}) | (StateTransition<Cpu8088Snapshot, Cpu8088Access> & {
  readonly instruction: null;
  readonly outcome: "executed";
  readonly continuation: "wait";
  readonly interrupt?: never;
});

export type Cpu8088InterruptSource = "intr" | "nmi";
export type Cpu8088InterruptAccess = MemoryAccess | { readonly kind: "acknowledge"; readonly value: number };
export type Cpu8088InterruptRecord = StateTransition<Cpu8088Snapshot, Cpu8088InterruptAccess> & {
  readonly source: Cpu8088InterruptSource;
  readonly instruction: null;
} & (
  | { readonly outcome: "accepted"; readonly vector: number }
  | { readonly outcome: "ignored"; readonly reason: "masked" | "deferred" }
);

export type Cpu8088ResetRecord = StateTransition<Cpu8088Snapshot>;

/** Instruction-level Intel 8088 with flat 1 MiB RAM and segmented addresses. */
export class Cpu8088 {
  readonly #ram: Ram;
  readonly #state: Cpu8088State;
  readonly #execution: ReturnType<typeof createExecution<Cpu8088Snapshot>>;

  constructor(ram: Ram, initialState: Cpu8088State, connections?: Cpu8088Connections) {
    checkMemory(ram);
    this.#ram = ram;
    this.#state = readState(cpu8088StateDescription, initialState);
    this.#execution = createExecution(this.#state, ram, () => this.snapshot(), () => connections?.ports,
      record => record8088External(connections, record));
  }

  /** Inspect detached state, byte-register views, and the physical PC without RAM access. */
  snapshot(): Cpu8088Snapshot {
    const state = copyState(cpu8088StateDescription, this.#state);
    const { views } = sourceReaders(state);
    return {
      ...state,
      al: views.AL(), ah: views.AH(),
      bl: views.BL(), bh: views.BH(),
      cl: views.CL(), ch: views.CH(),
      dl: views.DL(), dh: views.DH(),
      pc: views.PC(),
    };
  }

  /** Set CS:IP to FFFF:0000; clear other segments, flags, halt/wait, and recognition latches; preserve general registers and RAM. */
  reset(): Cpu8088ResetRecord {
    return this.#execution.reset();
  }

  /** Deliver an owed trap, sample a waiting TEST input, or attempt one instruction/REP iteration. */
  step(): Cpu8088StepRecord { return this.#execution.step(); }

  /** Offer INTR or a selected NMI edge. Ignored requests remain the caller's responsibility. */
  interrupt(source: "nmi"): Cpu8088InterruptRecord;
  interrupt(source: "intr", acknowledge: () => number): Cpu8088InterruptRecord;
  interrupt(source: Cpu8088InterruptSource, acknowledge?: () => number): Cpu8088InterruptRecord {
    return this.#execution.atBoundary<Cpu8088InterruptRecord>(() => {
      if (source !== "intr" && source !== "nmi") throw new TypeError("8088 interrupt source must be intr or nmi.");
      const before = this.snapshot();
      const deferred = this.#state.recognitionDeferred || (source === "intr" && this.#state.interruptDeferred);
      if (deferred || (source === "intr" && !this.#state.flags.if)) {
        return { before, after: this.snapshot(), source, instruction: null, accesses: [], outcome: "ignored",
          reason: deferred ? "deferred" : "masked" };
      }
      if (source === "intr" && typeof acknowledge !== "function") throw new TypeError("INTR requires an acknowledge callback.");
      this.#state.halted = this.#state.waiting = false;
      const accesses: Cpu8088InterruptAccess[] = [];
      const memory = recordMemory(this.#ram, access => { accesses.push(access); });
      let vector = 2;
      if (source === "intr") {
        vector = acknowledge!();
        checkUnsigned("Interrupt vector", vector, 0xff);
        accesses.push({ kind: "acknowledge", value: vector });
      }
      actions.enterInterrupt(this.#state, vector, memory);
      return { before, after: this.snapshot(), source, instruction: null, accesses, outcome: "accepted", vector };
    });
  }

}
