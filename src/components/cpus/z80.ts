import { cpuZ80StateDescription } from "./state/z80.ts";
import type { CpuZ80State, CpuZ80RegisterBank } from "./state/z80.ts";
import type { Ram } from "../memory/ram.js";
import { opcodeDecoder } from "./generated/z80-chapter.ts";
import { sourceReaders } from "./generated/z80-state.ts";
import { callStack16LE } from "./call-stack.ts";
import type { FetchedInstruction, StateTransition, InstructionStep, HaltedStep } from "./execution-records.ts";
import { readWordLE } from "./binary.ts";
import { executionBoundary } from "./execution-boundary.ts";
import { recordInterruptInstruction } from "./interrupt-instruction.ts";
import type { InterruptInstruction, InterruptAcknowledge } from "./interrupt-instruction.ts";
import { recordPorts } from "./port-access.ts";
import type { BytePorts, PortAccess } from "./port-access.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import type { WordInstructionContext, InterruptDeferralContext, RetiNotificationContext } from "./instruction-context.ts";
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

interface InstructionContext extends WordInstructionContext, BytePorts, InterruptDeferralContext<"irq">, RetiNotificationContext {}
type OpcodeHandler = (instruction: InstructionContext) => void;
/** Instruction-level Zilog Z80 with documented opcodes and boundary IRQ/NMI delivery. */
export class CpuZ80 {
  readonly #state: CpuZ80State;
  readonly #decode: ReturnType<typeof opcodeDecoder>;
  readonly #stack: ReturnType<typeof callStack16LE>;
  readonly #ram: Ram;
  readonly #ports: BytePorts | undefined;
  readonly #onReti: (() => void) | undefined;
  readonly #atBoundary = executionBoundary("Z80 step, reset, and interrupt calls must not be reentrant.");

  constructor(ram: Ram, initialState: CpuZ80State, ports?: BytePorts, onReti?: () => void) {
    if (ram.size !== 0x10000) throw new RangeError("The Z80 model requires exactly 64 KiB of RAM.");
    this.#state = readState(cpuZ80StateDescription, initialState);
    this.#stack = callStack16LE(this.#state);
    this.#decode = opcodeDecoder(this.#state);
    this.#ram = ram;
    this.#ports = ports;
    this.#onReti = onReti;
  }

  /** Inspect detached register banks and their derived pair views without reading RAM. */
  snapshot(): CpuZ80Snapshot {
    const state = copyState(cpuZ80StateDescription, this.#state);
    const views = sourceReaders(state).views;
    return { ...state, bc: views.BC(), de: views.DE(), hl: views.HL(),
      alternate: { ...state.alternate, bc: views.BC_ALT(), de: views.DE_ALT(), hl: views.HL_ALT() } };
  }

  /** Apply documented reset effects, release HALT, and preserve other stored state and RAM. */
  reset(): CpuZ80ResetRecord {
    return this.#atBoundary(() => {
      const before = this.snapshot();
      this.#state.pc = 0;
      this.#state.i = 0;
      this.#state.r = 0;
      this.#state.iff1 = false;
      this.#state.iff2 = false;
      this.#state.im = 0;
      this.#state.interruptDeferred = this.#state.nmiDeferred = false;
      this.#state.halted = false;
      return { before, after: this.snapshot(), accesses: [] };
    });
  }

  /** Attempt one instruction or block iteration; unsupported or already halted attempts preserve all state. */
  step(): CpuZ80StepRecord {
    return this.#atBoundary(() => {
      const before = this.snapshot();
      if (this.#state.halted) {
        return { before, after: this.snapshot(), instruction: null, accesses: [], outcome: "halted" };
      }
      const accesses: CpuZ80Access[] = [];
      const recordAccess = (access: CpuZ80Access): void => { accesses.push(access); };
      const { readByte, writeByte } = recordMemory(this.#ram, recordAccess);
      const { readPort, writePort } = recordPorts(this.#ports, recordAccess);
      const address = this.#state.pc;
      const opcode = readByte(address);
      const bytes = [opcode];
      // Decode the complete opcode before changing PC/R. Prefixes select only documented pages.
      const nextEncodingByte = (): number => {
        const byte = readByte((address + bytes.length) & 0xffff);
        bytes.push(byte);
        return byte;
      };
      const { handler, opcodeFetches } = this.#decode(opcode, nextEncodingByte);
      if (handler) {
        this.#state.pc = (address + bytes.length) & 0xffff;
        // Operand fetches below are ordinary reads and do not increment R.
        this.#refresh(opcodeFetches);
        const fetchByte = (): number => {
          const byte = readByte(this.#state.pc);
          this.#state.pc = (this.#state.pc + 1) & 0xffff;
          bytes.push(byte);
          return byte;
        };
        this.#executeHandler(handler, {
          fetchByte,
          fetchWord: () => readWordLE(fetchByte),
          readByte,
          writeByte,
          readPort,
          writePort,
        });
      }
      const record = { instruction: { address, bytes }, before, after: this.snapshot(), accesses };
      return handler
        ? { ...record, outcome: this.#state.halted ? "halted" : "executed" }
        : { ...record, outcome: "unsupported", reason: "opcode" };
    });
  }

  /** Offer a selected request; ignored offers neither acknowledge nor queue an interrupt. */
  interrupt(source: "nmi"): CpuZ80InterruptRecord;
  interrupt(source: "irq", acknowledge: () => number): CpuZ80InterruptRecord;
  interrupt(source: CpuZ80InterruptSource, acknowledge?: () => number): CpuZ80InterruptRecord {
    return this.#atBoundary<CpuZ80InterruptRecord>(() => {
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
      this.#refresh(1);
      if (source === "nmi") {
        this.#state.nmiDeferred = true;
        this.#stack.call(0x0066, writeByte);
      } else {
        this.#state.iff2 = false;
        this.#state.interruptDeferred = false;
        const { instruction, fetchByte } = recordInterruptInstruction(acknowledge!, recordAccess);
        const opcode = fetchByte();
        if (this.#state.im === 0) {
          const { handler } = this.#decode(opcode, (opcodeFetch = true) => {
            if (opcodeFetch) this.#refresh(1);
            return fetchByte();
          });
          if (handler) {
            const { readPort, writePort } = recordPorts(this.#ports, recordAccess);
            this.#executeHandler(handler, { readByte, writeByte, readPort, writePort, fetchByte, fetchWord: () => readWordLE(fetchByte) });
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

  // Instruction decoding, retirement, and interrupt returns.

  #refresh(count: number): void {
    this.#state.r = (this.#state.r & 0x80) | ((this.#state.r + count) & 0x7f);
  }

  #executeHandler(handler: OpcodeHandler, context: WordInstructionContext & BytePorts): void {
    let deferred = false, reti = false;
    handler({ ...context, deferInterrupt: () => { deferred = true; }, notifyReti: () => { reti = true; } });
    // A retired instruction consumes old inhibition; EI or an IFF-changing return renews IRQ inhibition.
    this.#state.interruptDeferred = deferred;
    this.#state.nmiDeferred = false;
    // Notify after architectural retirement; device failure cannot undo the completed return.
    if (reti) this.#onReti?.();
  }

  // Addressing.

  #readMemoryWord(address: number, readByte: InstructionContext["readByte"]): number {
    const low = readByte(address);
    return low | (readByte((address + 1) & 0xffff) << 8);
  }

}
