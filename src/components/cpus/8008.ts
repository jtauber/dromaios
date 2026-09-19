import { instructions as semantics, opcodeEntries as transferEntries } from "./generated/8008.ts";
import { cpu8008StateDescription } from "./state/8008.ts";
import type { Cpu8008State, Cpu8008StoredState } from "./state/8008.ts";
import type { Ram } from "../memory/ram.js";
import type { FetchedInstruction, StateTransition, InstructionStep, HaltedStep } from "./execution-records.ts";
import { readWordLE } from "./binary.ts";
import { executeByteInstruction, programCounter } from "./execute-byte-instruction.ts";
import { executionBoundary } from "./execution-boundary.ts";
import { recordInterruptInstruction } from "./interrupt-instruction.ts";
import type { InterruptInstruction, InterruptAcknowledge } from "./interrupt-instruction.ts";
import { recordMemory } from "./memory-access.ts";
import type { MemoryAccess } from "./memory-access.ts";
import { recordPorts } from "./port-access.ts";
import type { BytePorts, PortAccess } from "./port-access.ts";
import type { WordInstructionContext } from "./instruction-context.ts";
import { copyState, readState } from "./state.ts";
import type { ReadonlyState } from "./state.js";
import { opcodeFamily, opcodePattern, opcodeTable } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.ts";
import { intel8008PortForms, intel8008ControlForms as controlForms } from "./intel-encodings.ts";

export { cpu8008StateDescription } from "./state/8008.ts";
export type { Cpu8008State, Cpu8008AddressStack, Cpu8008Flags } from "./state/8008.ts";

export type Cpu8008Snapshot = ReadonlyState<Cpu8008State> & {
  readonly pc: number;
  /** Raw H:L byte pair; memory addressing uses only its low 14 bits. */
  readonly hl: number;
};

export type Cpu8008MemoryAccess = MemoryAccess;
export type Cpu8008Access = MemoryAccess | PortAccess;

export type Cpu8008Instruction = FetchedInstruction;

export type Cpu8008StepRecord = InstructionStep<Cpu8008Snapshot, Cpu8008Access> | HaltedStep<Cpu8008Snapshot, Cpu8008Access>;

export type Cpu8008ResetRecord = StateTransition<Cpu8008Snapshot>;

export type Cpu8008InterruptAccess = Cpu8008Access | InterruptAcknowledge;
export type Cpu8008InterruptInstruction = InterruptInstruction;

export type Cpu8008InterruptRecord = StateTransition<Cpu8008Snapshot, Cpu8008InterruptAccess> & (
  | { readonly outcome: "executed" | "halted"; readonly instruction: Cpu8008InterruptInstruction }
  | { readonly outcome: "unsupported"; readonly reason: "opcode"; readonly instruction: Cpu8008InterruptInstruction }
);

interface InstructionContext extends WordInstructionContext, BytePorts {}
type OpcodeHandler = (instruction: InstructionContext) => void;
type ByteOperand = "a" | "b" | "c" | "d" | "e" | "h" | "l" | "m";

/** Instruction-level Intel 8008 with native port selectors and 14-bit addresses. */
export class Cpu8008 {
  readonly #ram: Ram;
  readonly #ports: BytePorts | undefined;
  readonly #state: Cpu8008StoredState;
  readonly #opcodeHandlers: Readonly<Partial<Record<number, OpcodeHandler>>>;
  readonly #atBoundary = executionBoundary("8008 step, reset, and interrupt calls must not be reentrant.");
  readonly #counter = programCounter(() => this.#pc, value => { this.#pc = value & 0x3fff; });

  constructor(ram: Ram, initialState: Cpu8008State, ports?: BytePorts) {
    if (ram.size !== 0x4000) throw new RangeError("The 8008 model requires exactly 16 KiB of RAM.");
    this.#ram = ram;
    this.#ports = ports;
    this.#state = readState(cpu8008StateDescription, initialState);
    this.#opcodeHandlers = this.#createOpcodeHandlers();
  }

  /** Inspect detached state, the selected PC, and the raw H:L pair without RAM accesses. */
  snapshot(): Cpu8008Snapshot {
    return { ...copyState(cpu8008StateDescription, this.#state), pc: this.#pc, hl: this.#hl };
  }

  /** Model settled power-on clearing and STOPPED, not an interrupt or a lesson restart. */
  reset(): Cpu8008ResetRecord {
    return this.#atBoundary(() => {
      const before = this.snapshot();
      for (const name of ["a", "b", "c", "d", "e", "h", "l"] as const) this.#state[name] = 0;
      this.#state.addressStack.fill(0);
      this.#state.stackIndex = 0;
      this.#state.halted = true;
      // The startup description does not specify flag values; preserve them as model policy.
      return { before, after: this.snapshot(), accesses: [] };
    });
  }

  /** Attempt one instruction; unsupported and already halted attempts preserve all state. */
  step(): Cpu8008StepRecord {
    return this.#atBoundary<Cpu8008StepRecord>(() => {
      const before = this.snapshot();
      if (this.#state.halted) {
        return { before, after: this.snapshot(), instruction: null, accesses: [], outcome: "halted" };
      }
      const ports = recordPorts(this.#ports);
      const execution = executeByteInstruction(this.#counter, this.#ram, opcode => {
        const handler = this.#opcodeHandlers[opcode];
        return handler && (context => handler({ ...context, readPort: ports.readPort, writePort: ports.writePort }));
      }, readWordLE);
      // INP/OUT fetch one opcode byte, then perform one port transfer with no further RAM accesses.
      const accesses: readonly Cpu8008Access[] = [...execution.accesses, ...ports.accesses];
      const record = { before, after: this.snapshot(), instruction: execution.instruction, accesses };
      return execution.executed
        ? { ...record, outcome: this.#state.halted ? "halted" : "executed" }
        : { ...record, outcome: "unsupported", reason: "opcode" };
    });
  }

  /** Offer an external instruction at this boundary; the 8008 has no interrupt mask or queue. */
  interrupt(acknowledge: () => number): Cpu8008InterruptRecord {
    return this.#atBoundary<Cpu8008InterruptRecord>(() => {
      if (typeof acknowledge !== "function") throw new TypeError("8008 interrupt requires an acknowledgement callback.");
      const before = this.snapshot();
      // Acceptance releases STOPPED. Only the supplied instruction can change flags or call a handler.
      this.#state.halted = false;
      const accesses: Cpu8008InterruptAccess[] = [];
      const recordAccess = (access: Cpu8008InterruptAccess): void => { accesses.push(access); };
      const { readByte, writeByte } = recordMemory(this.#ram, recordAccess);
      const { readPort, writePort } = recordPorts(this.#ports, recordAccess);
      const { instruction, fetchByte } = recordInterruptInstruction(acknowledge, recordAccess);
      // T1I suppresses PC advancement for every supplied byte, including immediate/address operands.
      const handler = this.#opcodeHandlers[fetchByte()];
      if (handler) handler({ readByte, writeByte, readPort, writePort, fetchByte, fetchWord: () => readWordLE(fetchByte) });
      const record = { before, after: this.snapshot(), instruction, accesses };
      return handler
        ? { ...record, outcome: this.#state.halted ? "halted" : "executed" }
        : { ...record, outcome: "unsupported", reason: "opcode" };
    });
  }

  // Register views. PC is a selected address register, not duplicate stored state.

  get #pc(): number {
    // Construction validates the selector and all eight slots.
    return this.#state.addressStack[this.#state.stackIndex]!;
  }

  set #pc(value: number) {
    this.#state.addressStack[this.#state.stackIndex] = value;
  }

  get #hl(): number {
    return (this.#state.h << 8) | this.#state.l;
  }

  // Opcode selectors and construction.

  // rrr/ddd/sss select A/B/C/D/E/H/L/M in order; M addresses RAM through H:L's low 14 bits.
  readonly #byteOperands = ["a", "b", "c", "d", "e", "h", "l", "m"] as const;

  // ooo in 10 ooo sss / 00 ooo 100 selects the same ALU family.
  // Complete generated bodies read their source and flags; compare never writes A.
  readonly #aluInstructions = ([
    ["ad", "adi"], // 000 ADr / ADI
    ["ac", "aci"], // 001 ACr / ACI
    ["su", "sui"], // 010 SUr / SUI
    ["sb", "sbi"], // 011 SBr / SBI
    ["nd", "ndi"], // 100 NDr / NDI
    ["xr", "xri"], // 101 XRr / XRI
    ["or", "ori"], // 110 ORr / ORI
    ["cp", "cpi"], // 111 CPr / CPI
  ] as const).map(([operation, immediate]) => (source: ByteOperand | "immediate"): OpcodeHandler => {
    const suffix = { a: "A", b: "B", c: "C", d: "D", e: "E", h: "H", l: "L", m: "M" } as const;
    const execute = source === "immediate" ? semantics[immediate] : semantics[`${operation}${suffix[source]}`];
    return instruction => execute(this.#state, instruction);
  });

  // Native 8008 opcode bits: 7 6 | 5 4 3 | 2 1 0 = xx yyy zzz.
  // xx selects a block; the other fields select its operation and operands.
  #createOpcodeHandlers(): Readonly<Partial<Record<number, OpcodeHandler>>> {
    return opcodeTable<OpcodeHandler>([
      // 00 rrr 00d: d=0 increments, d=1 decrements B/C/D/E/H/L; preserve carry.
      // rrr=000 selects HLT (00/01); rrr=111 is undefined, with no memory adjustment.
      ...this.#adjustHandlers("00 rrr 00d"), // INr / DCr / HLT

      // 00 0td 010: t=0 circular, t=1 through carry; d=0 left, d=1 right.
      // Only carry changes; the four 00 1xx 010 encodings are undefined.
      ...opcodePattern("00 000 010", () => semantics.rlc(this.#state)), // RLC
      ...opcodePattern("00 001 010", () => semantics.rrc(this.#state)), // RRC
      ...opcodePattern("00 010 010", () => semantics.ral(this.#state)), // RAL
      ...opcodePattern("00 011 010", () => semantics.rar(this.#state)), // RAR

      // 00 ccc 011: conditional return; ccc=vff, v=false/true, ff=C/Z/S/P.
      ...this.#instructionHandlers(controlForms.conditionalReturns), // RFc / RTc

      // 00 ooo 100: ooo (bits 5..3) selects the ALU operation; the next byte is its operand.
      ...opcodeFamily("00 ooo 100", { o: this.#aluInstructions }, ({ o: instruction }) => instruction("immediate")), // ADI / ACI / SUI / SBI / NDI / XRI / ORI / CPI

      // 00 vvv 101: a one-byte call to 0000..0038; vvv supplies address bits 5..3.
      ...this.#instructionHandlers(controlForms.restarts), // RST

      // Chapter-defined transfers: 00 ddd 110 loads an immediate byte; 11 ddd sss copies an operand.
      // ddd/sss select A/B/C/D/E/H/L/M; the chapter excludes 11 111 111 (HLT).
      ...transferEntries(this.#state), // LrI n / LMI n / Lr1r2 / LrM / LMr

      // 00 xxx 111: RET. Bits 5–3 are don't-care bits: all eight encodings return.
      ...this.#instructionHandlers(controlForms.return), // RET

      // 01 ccc 000/010: conditional jump/call; ccc = vff uses the same conditions as returns.
      // Both paths fetch llllllll, xxhhhhhh (low byte first), ignoring the high two address bits.
      ...this.#instructionHandlers(controlForms.conditionalJumps), // JFc / JTc addr
      ...this.#instructionHandlers(controlForms.conditionalCalls), // CFc / CTc addr

      // 01 xxx 100/110: unconditional JMP/CAL; xxx is ignored, not a condition.
      ...this.#instructionHandlers(controlForms.jump), // JMP addr
      ...this.#instructionHandlers(controlForms.call), // CAL addr

      // 01 ppppp 1: bits 5..1 select the port. ppppp = rrmmm: rr=00 inputs 0..7;
      // rr=01/10/11 outputs 8..31. INP replaces A; OUT sends A; both preserve flags.
      ...this.#instructionHandlers(intel8008PortForms), // INP / OUT

      // 10 ooo sss: ooo (bits 5..3) selects the operation; sss (bits 2..0) selects A/B/C/D/E/H/L/M.
      ...opcodeFamily("10 ooo sss", { o: this.#aluInstructions, s: this.#byteOperands }, ({ o: instruction, s: source }) => instruction(source)), // ADr / ACr / SUr / SBr / NDr / XRr / ORr / CPr (including M)

      // 11 111 111 belongs to HLT and performs no data access.
      ...opcodePattern("11 111 111", () => semantics[0xff](this.#state)), // HLT
    ]);
  }

  #adjustHandlers(pattern: string): readonly OpcodeEntry<OpcodeHandler>[] {
    return opcodeFamily(pattern, { r: this.#byteOperands, d: ["in", "dc"] as const }, ({ r: operand, d: operation }) => {
      if (operand === "m") return undefined;
      if (operand === "a") return () => semantics[operation === "in" ? 0x00 : 0x01](this.#state);
      return () => semantics[`${operation}${operand}`](this.#state);
    }).flatMap(([opcode, handler]) => handler ? [[opcode, handler] as const] : []);
  }

  #instructionHandlers(forms: readonly (readonly [number, unknown])[]): readonly OpcodeEntry<OpcodeHandler>[] {
    const instructions: Readonly<Record<number, (state: Cpu8008StoredState, instruction: InstructionContext) => void>> = semantics;
    return forms.map(([opcode]) => [opcode, instruction => instructions[opcode]!(this.#state, instruction)]);
  }
}
