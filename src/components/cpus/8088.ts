import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition, InstructionStep, HaltedStep, WaitingStep } from "./execution-records.ts";
import { readWordLE } from "./binary.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import { recordPorts } from "./port-access.ts";
import type { BytePorts, PortAccess } from "./port-access.ts";
import { executionBoundary } from "./execution-boundary.ts";
import type { WordInstructionContext, InterruptDeferralContext, InterruptReportContext } from "./instruction-context.ts";
import { copyState, readState } from "./state.ts";
import { cpu8088StateDescription } from "./state/8088.ts";
import type { Cpu8088State, Cpu8088Flags } from "./state/8088.ts";
import { instructions as actions, sourceReaders } from "./generated/8088-state.ts";
import { opcodeEntries } from "./generated/8088.ts";
import { instructions as operands } from "./generated/8088-operands.ts";
import { instructions as strings } from "./generated/8088-strings.ts";
import { record8088External } from "./8088-external.ts";
import type { Cpu8088ExternalAccess, Cpu8088ExternalConnections, Cpu8088ExternalContext } from "./8088-external.ts";
import type { ReadonlyState } from "./state.js";
import { opcodeFamily, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.ts";
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

interface InstructionContext extends WordInstructionContext, BytePorts, InterruptDeferralContext, InterruptReportContext, Cpu8088ExternalContext {
  readonly startIp: number;
  readonly segment: number | undefined;
  // F3 repeats while equal, F2 while unequal; only CMPS/SCAS test the condition.
  readonly repeat: boolean | undefined;
}
type Rejection = "opcode" | "divide-error";
type OpcodeHandler = (instruction: InstructionContext) => Rejection | void;
type SegmentRegister = "es" | "cs" | "ss" | "ds";

// The original 8088 has twenty address lines; carries beyond bit 19 are discarded.
function physicalAddress(segment: number, offset: number): number {
  return ((segment << 4) + offset) & 0xfffff;
}

/** Instruction-level Intel 8088 with flat 1 MiB RAM and segmented addresses. */
export class Cpu8088 {
  readonly #ram: Ram;
  readonly #state: Cpu8088State;
  readonly #opcodeHandlers: Readonly<Partial<Record<number, OpcodeHandler>>>;
  readonly #connections: Cpu8088Connections | undefined;
  readonly #atBoundary = executionBoundary("8088 step, reset, and interrupt calls must not be reentrant.");

  constructor(ram: Ram, initialState: Cpu8088State, connections?: Cpu8088Connections) {
    if (ram.size !== 0x100000) throw new RangeError("The 8088 model requires exactly 1 MiB of RAM.");
    this.#ram = ram;
    this.#state = readState(cpu8088StateDescription, initialState);
    this.#connections = connections;
    this.#opcodeHandlers = opcodeTable(this.#instructionEntries());
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
    return this.#atBoundary<Cpu8088ResetRecord>(() => {
      const before = this.snapshot();
      this.#state.cs = 0xffff;
      this.#state.ip = 0;
      this.#state.halted = this.#state.waiting = false;
      this.#state.interruptDeferred = this.#state.recognitionDeferred = this.#state.trapPending = false;
      this.#state.ds = this.#state.ss = this.#state.es = 0;
      this.#state.flags = { cf: false, pf: false, af: false, zf: false, sf: false,
        tf: false, if: false, df: false, of: false };
      return { before, after: this.snapshot(), accesses: [] };
    });
  }

  /** Deliver an owed trap, sample a waiting TEST input, or attempt one instruction/REP iteration. */
  step(): Cpu8088StepRecord {
    return this.#atBoundary<Cpu8088StepRecord>(() => {
      const before = this.snapshot();
      if (this.#state.trapPending && !this.#state.recognitionDeferred) {
        const memory = recordMemory(this.#ram);
        this.#state.trapPending = false;
        actions.enterInterrupt(this.#state, 1, memory);
        return { before, after: this.snapshot(), instruction: null, accesses: memory.accesses,
          outcome: "executed", interrupt: { source: "trap", vector: 1 } };
      }
      if (this.#state.halted) return { before, after: this.snapshot(), instruction: null, accesses: [], outcome: "halted" };
      const accesses: Cpu8088Access[] = [];
      const recordAccess = (access: Cpu8088Access): void => { accesses.push(access); };
      const { readByte, writeByte } = recordMemory(this.#ram, recordAccess);
      const { readPort, writePort } = recordPorts(this.#connections?.ports, recordAccess);
      const { readTest, sendEscape } = record8088External(this.#connections, recordAccess);
      const bytes: number[] = [];
      const fetchByte = (): number => {
        const value = readByte(physicalAddress(this.#state.cs, this.#state.ip));
        this.#state.ip = (this.#state.ip + 1) & 0xffff;
        bytes.push(value);
        return value;
      };
      // Prefixes are local to this attempt. Later prefixes of the same kind replace earlier ones.
      let segment: number | undefined;
      let repeat: boolean | undefined;
      let reason: Rejection | void = "opcode";
      let interruptDeferred = false, recognitionDeferred = false;
      let interrupt: Cpu8088Delivery | undefined;
      const context = {
        startIp: before.ip, fetchByte, fetchWord: () => readWordLE(fetchByte), readByte, writeByte, readPort, writePort, readTest, sendEscape,
        deferInterrupt: (scope: "intr" | "all"): void => {
          if (scope === "all") recognitionDeferred = true;
          else interruptDeferred = true;
        },
        reportInterrupt: (vector: number): void => { interrupt = { source: "software", vector }; },
      };
      if (before.waiting) reason = actions.pollWait(this.#state, 1, context);
      else {
        // A full code segment of prefixes cannot reach an opcode; bound the attempt without a later-x86 length limit.
        while (bytes.length < 0x10000) {
          const opcode = fetchByte();
          const override = this.#segmentOverrides[opcode];
          if (override) { segment = this.#state[override]; continue; }
          if (opcode === 0xf0) continue; // LOCK has no bus-arbitration effect in this CPU-and-RAM model.
          if (opcode === 0xf2 || opcode === 0xf3) { repeat = opcode === 0xf3; continue; }
          const handler = this.#opcodeHandlers[opcode];
          if (handler && (repeat === undefined || Object.hasOwn(strings, opcode))) {
            reason = handler({ ...context, segment, repeat });
          }
          break;
        }
      }
      if (reason === "divide-error") {
        // Original 8088 type 0 returns AFTER DIV/IDIV, unlike later x86 fault restart.
        actions.enterInterrupt(this.#state, 0, { readByte, writeByte });
        interrupt = { source: "divide-error", vector: 0 };
      }
      if (reason === "opcode") this.#state.ip = before.ip;
      else {
        this.#state.interruptDeferred = interruptDeferred;
        this.#state.recognitionDeferred = recognitionDeferred;
        // Instructions and busy WAIT polls sample TF; POPF/IRET cannot retroactively change the owed trap.
        this.#state.trapPending = before.trapPending || before.flags.tf;
      }
      const transition = { before, after: this.snapshot(), accesses };
      if (before.waiting) {
        return this.#state.waiting && !this.#state.trapPending
          ? { ...transition, instruction: null, outcome: "waiting" }
          : { ...transition, instruction: null, outcome: "executed", continuation: "wait" };
      }
      const record = { ...transition, instruction: { address: before.pc, bytes } };
      if (reason === "opcode") return { ...record, outcome: "unsupported", reason };
      if (interrupt) return { ...record, outcome: "executed", interrupt };
      if (this.#state.waiting && !this.#state.trapPending) return { ...record, outcome: "waiting" };
      // A trapped HLT still allows the runner to reach its pending type-1 entry.
      return { ...record, outcome: this.#state.halted && !this.#state.trapPending ? "halted" : "executed" };
    });
  }

  /** Offer INTR or a selected NMI edge. Ignored requests remain the caller's responsibility. */
  interrupt(source: "nmi"): Cpu8088InterruptRecord;
  interrupt(source: "intr", acknowledge: () => number): Cpu8088InterruptRecord;
  interrupt(source: Cpu8088InterruptSource, acknowledge?: () => number): Cpu8088InterruptRecord {
    return this.#atBoundary<Cpu8088InterruptRecord>(() => {
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

  // Opcode selectors and construction. Arrays follow encoded register order.

  readonly #segmentRegisters = ["es", "cs", "ss", "ds"] as const;
  readonly #segmentOverrides = opcodeTable<SegmentRegister>(opcodeFamily("001 ss 110", { s: this.#segmentRegisters }, ({ s }) => s));
  #instructionEntries(): readonly OpcodeEntry<OpcodeHandler>[] {
    return [
      ...opcodeEntries(this.#state).map(([opcode, execute]): OpcodeEntry<OpcodeHandler> => [opcode, instruction => {
        const outcome = execute(instruction);
        return outcome === "unsupported" ? "opcode" : outcome;
      }]),
      // Chapter families receive the captured override; prefix scanning remains at the boundary.
      ...Object.entries(operands).map(([opcode, execute]): OpcodeEntry<OpcodeHandler> => [Number(opcode), instruction => {
        const outcome = execute(this.#state, Number(instruction.segment !== undefined), instruction.segment ?? 0, instruction);
        return outcome === "unsupported" ? "opcode" : outcome;
      }]),

      // Repeated bodies execute one element and receive the original prefix start.
      ...Object.entries(strings).map(([opcode, execute]): OpcodeEntry<OpcodeHandler> => [Number(opcode), instruction => {
        const outcome = execute(this.#state, Number(instruction.segment !== undefined), instruction.segment ?? 0,
          instruction.repeat === undefined ? 0 : instruction.repeat ? 1 : 2, instruction.startIp, instruction);
        return outcome === "unsupported" ? "opcode" : outcome;
      }]),
    ];
  }
}
