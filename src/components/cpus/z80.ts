import { cpuZ80StateDescription } from "./state/z80.ts";
import type { CpuZ80State, CpuZ80RegisterBank } from "./state/z80.ts";
import type { Ram } from "../memory/ram.js";
import { checkMemory, createExecution } from "./generated/z80-execution.ts";
import { sourceReaders } from "./generated/z80-state.ts";
import { callStack16LE } from "./call-stack.ts";
import type { FetchedInstruction, StateTransition, InstructionStep, HaltedStep } from "./execution-records.ts";
import { readWordLE } from "./binary.ts";
import { recordInterruptInstruction } from "./interrupt-instruction.ts";
import type { InterruptInstruction, InterruptAcknowledge } from "./interrupt-instruction.ts";
import { recordPorts } from "./port-access.ts";
import type { BytePorts, PortAccess } from "./port-access.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import { copyState, readState } from "./state.ts";
import type { ReadonlyState } from "./state.js";

export { cpuZ80StateDescription } from "./state/z80.ts";
export type { CpuZ80State, CpuZ80Flags, CpuZ80RegisterBank } from "./state/z80.ts";

export type CpuZ80BankSnapshot = ReadonlyState<CpuZ80RegisterBank> & {
  readonly bc: number;
  readonly de: number;
  readonly hl: number;
};

export type CpuZ80Snapshot = CpuZ80BankSnapshot &
  Readonly<Omit<CpuZ80State, keyof CpuZ80RegisterBank | "alternate">> & {
    readonly alternate: CpuZ80BankSnapshot;
  };

export type CpuZ80MemoryAccess = MemoryAccess;
export type CpuZ80Access = MemoryAccess | PortAccess;

export type CpuZ80Instruction = FetchedInstruction;

export type CpuZ80StepRecord = InstructionStep<CpuZ80Snapshot, CpuZ80Access> | HaltedStep<CpuZ80Snapshot, CpuZ80Access>;

export type CpuZ80ResetRecord = StateTransition<CpuZ80Snapshot>;

export type CpuZ80InterruptSource = "irq" | "nmi";
export type CpuZ80InterruptAccess = CpuZ80Access | InterruptAcknowledge;

/** Mode 0 executes externally supplied bytes, without inventing a RAM fetch address. */
export type CpuZ80InterruptInstruction = InterruptInstruction;

export type CpuZ80InterruptRecord = StateTransition<CpuZ80Snapshot, CpuZ80InterruptAccess> & (
  | { readonly source: CpuZ80InterruptSource; readonly outcome: "ignored"; readonly reason: "deferred"; readonly instruction: null }
  | { readonly source: "irq"; readonly outcome: "ignored"; readonly reason: "disabled"; readonly instruction: null }
  | { readonly source: CpuZ80InterruptSource; readonly outcome: "accepted"; readonly instruction: null }
  | { readonly source: "irq"; readonly outcome: "executed" | "halted"; readonly instruction: CpuZ80InterruptInstruction }
  | { readonly source: "irq"; readonly outcome: "unsupported"; readonly reason: "opcode"; readonly instruction: CpuZ80InterruptInstruction }
);

/** Instruction-level Zilog Z80 with documented opcodes and boundary IRQ/NMI delivery. */
export class CpuZ80 {
  readonly #state: CpuZ80State;
  readonly #execution: ReturnType<typeof createExecution<CpuZ80Snapshot>>;
  readonly #stack: ReturnType<typeof callStack16LE>;
  readonly #ram: Ram;
  readonly #ports: BytePorts | undefined;

  constructor(ram: Ram, initialState: CpuZ80State, ports?: BytePorts, onReti?: () => void) {
    checkMemory(ram);
    this.#state = readState(cpuZ80StateDescription, initialState);
    this.#stack = callStack16LE(this.#state);
    this.#execution = createExecution(this.#state, ram, () => this.snapshot(), ports, onReti);
    this.#ram = ram;
    this.#ports = ports;
  }

  /** Inspect detached register banks and their derived pair views without reading RAM. */
  snapshot(): CpuZ80Snapshot {
    const state = copyState(cpuZ80StateDescription, this.#state);
    const views = sourceReaders(state).views;
    return { ...state, bc: views.BC(), de: views.DE(), hl: views.HL(),
      alternate: { ...state.alternate, bc: views.BC_ALT(), de: views.DE_ALT(), hl: views.HL_ALT() } };
  }

  /** Apply documented reset effects, release HALT, and preserve other stored state and RAM. */
  reset(): CpuZ80ResetRecord { return this.#execution.reset(); }

  /** Attempt one instruction or block iteration; unsupported or already halted attempts preserve all state. */
  step(): CpuZ80StepRecord { return this.#execution.step(); }

  /** Offer a selected request; ignored offers neither acknowledge nor queue an interrupt. */
  interrupt(source: "nmi"): CpuZ80InterruptRecord;
  interrupt(source: "irq", acknowledge: () => number): CpuZ80InterruptRecord;
  interrupt(source: CpuZ80InterruptSource, acknowledge?: () => number): CpuZ80InterruptRecord {
    return this.#execution.atBoundary<CpuZ80InterruptRecord>(() => {
      if (source !== "irq" && source !== "nmi") throw new RangeError("Z80 interrupt source must be irq or nmi.");
      if (source === "irq" && typeof acknowledge !== "function") throw new TypeError("Z80 IRQ requires an acknowledgement callback.");
      const before = this.snapshot();
      if (source === "irq" && !this.#state.iff1) {
        return { before, after: this.snapshot(), instruction: null, accesses: [], source, outcome: "ignored", reason: "disabled" };
      }
      if (source === "nmi" ? this.#state.nmiDeferred : this.#state.interruptDeferred) {
        return { before, after: this.snapshot(), instruction: null, accesses: [], source, outcome: "ignored", reason: "deferred" };
      }
      const accesses: CpuZ80InterruptAccess[] = [];
      const recordAccess = (access: CpuZ80InterruptAccess): void => { accesses.push(access); };
      const { readByte, writeByte } = recordMemory(this.#ram, recordAccess);
      // Acceptance precedes device and stack access. NMI preserves IFF2, including nested NMI.
      this.#state.halted = false;
      this.#state.iff1 = false;
      this.#execution.opcodeFetched(1);
      if (source === "nmi") {
        this.#state.nmiDeferred = true;
        this.#stack.call(0x0066, writeByte);
      } else {
        this.#state.iff2 = false;
        this.#state.interruptDeferred = false;
        const { instruction, fetchByte } = recordInterruptInstruction(acknowledge!, recordAccess);
        const opcode = fetchByte();
        if (this.#state.im === 0) {
          const { handler } = this.#execution.decode(opcode, (opcodeFetch = true) => {
            if (opcodeFetch) this.#execution.opcodeFetched(1);
            return fetchByte();
          });
          if (handler) {
            const { readPort, writePort } = recordPorts(this.#ports, recordAccess);
            this.#execution.execute(handler, { readByte, writeByte, readPort, writePort, fetchByte, fetchWord: () => readWordLE(fetchByte) });
          }
          const record = { before, after: this.snapshot(), instruction, accesses, source };
          return handler
            ? { ...record, outcome: this.#state.halted ? "halted" : "executed" }
            : { ...record, outcome: "unsupported", reason: "opcode" };
        }
        // IM 1 acknowledges but ignores the byte; IM 2 reads its vector AFTER pushing PC.
        this.#stack.push(this.#state.pc, writeByte);
        this.#state.pc = this.#state.im === 1 ? 0x0038 : this.#readMemoryWord((this.#state.i << 8) | opcode, readByte);
      }
      return { before, after: this.snapshot(), instruction: null, accesses, source, outcome: "accepted" };
    });
  }

  // Addressing.

  #readMemoryWord(address: number, readByte: (address: number) => number): number {
    const low = readByte(address);
    return low | (readByte((address + 1) & 0xffff) << 8);
  }
}
