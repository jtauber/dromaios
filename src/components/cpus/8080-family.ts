import { callStack16LE } from "./call-stack.ts";
import { readRegisterPair, writeRegisterPair } from "./register-pairs.ts";
import type { RegisterPair } from "./register-pairs.ts";
import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { opcodeFamily, opcodePattern } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.ts";
import { intelAccumulatorTransferForms, intelByteTransferForms, intelExchangeForms, intelJumpForms, intelWordArithmeticForms, intelWordTransferForms } from "./intel-encodings.ts";

export type OpcodeHandler = (instruction: InstructionContext) => void;
type ByteOperand = "b" | "c" | "d" | "e" | "h" | "l" | "(hl)" | "a";
export type ByteInstruction = (operand: ByteOperand) => OpcodeHandler;
export type AluInstruction = (operand: ByteOperand | "immediate") => OpcodeHandler;
export type WordOperand = RegisterPair | "sp" | "status";
type Registers = Record<"a" | "b" | "c" | "d" | "e" | "h" | "l" | "pc" | "sp", number> & { halted: boolean };
const instructionPattern = opcodePattern<OpcodeHandler>;

/** Common 8080/Z80 encodings and operand mechanics; flags and CPU lifecycle belong to each CPU. */
export abstract class Cpu8080Family<State extends Registers> {
  protected readonly state: State;
  protected readonly stack: ReturnType<typeof callStack16LE>;

  protected constructor(state: State) {
    this.state = state;
    this.stack = callStack16LE(state);
  }

  // These hooks describe instruction differences, without imposing a common flag layout.
  protected abstract readonly aluInstructions: readonly AluInstruction[];
  protected abstract readonly byteAdjustments: readonly ByteInstruction[];
  protected abstract readonly generatedInstructions: Readonly<Record<number, (state: State, instruction: InstructionContext) => void>>;
  protected abstract readonly accumulatorOperations: readonly (() => void)[];
  protected abstract readonly conditions: readonly (() => boolean)[];
  protected abstract get statusWord(): number;
  protected abstract set statusWord(value: number);

  protected get hl(): number {
    return (this.state.h << 8) | this.state.l;
  }

  protected set hl(value: number) {
    this.state.h = value >>> 8;
    this.state.l = value & 0xff;
  }

  // rrr/ddd/sss select B/C/D/E/H/L/(HL)/A; the 8080 calls (HL) M.
  protected readonly byteOperands = ["b", "c", "d", "e", "h", "l", "(hl)", "a"] as const;
  // Stack pp selects BC/DE/HL/status: PSW on the 8080, AF on the Z80.
  readonly #stackPairs = ["bc", "de", "hl", "status"] as const;

  // Called by each CPU only after its operation and condition fields have initialized.
  // Builders capture callbacks and selectors; none reads live registers, flags, or RAM.
  // Shared opcode bits: 7 6 | 5 4 3 | 2 1 0 = xx yyy zzz.
  // xx selects a block; the other fields select its operation and operands.
  // Pair families split yyy into pp q. Comments give 8080 / Z80 mnemonics.
  // Only the 240 supported, documented 8080 encodings enter this table;
  // the Z80 adds its other base instructions and prefix pages in its own module.
  protected baseInstructions(): readonly OpcodeEntry<OpcodeHandler>[] {
    return [
      // xx=00, zzz=000: only yyy=000 (NOP) is documented on the 8080.
      ...instructionPattern("00 000 000", () => {}), // NOP

      // 00 pp q 001: pp selects BC/DE/HL/SP; q=0 loads nn, q=1 adds the pair to HL.
      ...this.#generatedHandlers(intelWordTransferForms.immediate), // LXI / LD dd,nn
      ...this.#generatedHandlers(intelWordArithmeticForms.addition), // DAD / ADD HL,ss

      // 00 pp q 010: q=0 stores, q=1 loads. pp=00/01 uses A and (BC)/(DE);
      // pp=10 uses HL and (nn), pp=11 uses A and (nn). Word operands are low byte first.
      ...this.#generatedHandlers(intelAccumulatorTransferForms.indirect), // STAX/LDAX / LD (BC)/(DE),A or A,(BC)/(DE)
      ...this.#generatedHandlers(intelWordTransferForms.memory), // SHLD/LHLD / LD (nn),HL or HL,(nn)
      ...this.#generatedHandlers(intelAccumulatorTransferForms.absolute), // STA/LDA / LD (nn),A or A,(nn)

      // 00 pp q 011: q=0 increments, q=1 decrements the selected word pair; preserve every flag.
      ...this.#generatedHandlers(intelWordArithmeticForms.adjustment), // INX/DCX / INC/DEC ss

      // 00 rrr zzz: rrr selects B/C/D/E/H/L/(HL)/A; zzz selects INC, DEC, or immediate LD.
      ...opcodeFamily("00 rrr 10d", { r: this.byteOperands, d: this.byteAdjustments }, ({ r: operand, d: instruction }) => instruction(operand)), // d=0 INR / INC; d=1 DCR / DEC
      ...this.#generatedHandlers(intelByteTransferForms.immediate), // 00 rrr 110: MVI / LD r,n or (HL),n

      // 00 ooo 111: accumulator rotates, DAA, complement A, set/complement carry.
      // Each CPU supplies the operations because their flag effects differ.
      ...opcodeFamily("00 ooo 111", { o: this.accumulatorOperations }, ({ o: operate }) => operate),

      // 01 ddd sss: ddd (bits 5..3) selects destination; sss (bits 2..0) selects source.
      ...this.#generatedHandlers(intelByteTransferForms.matrix), // MOV / LD; excludes memory-to-memory
      ...instructionPattern("01 110 110", () => { this.state.halted = true; }), // HLT / HALT; no data access

      // 10 ooo rrr: ooo selects ADD/ADC/SUB/SBC/AND/XOR/OR/CP; rrr selects B/C/D/E/H/L/(HL)/A.
      ...opcodeFamily("10 ooo rrr", { o: this.aluInstructions, r: this.byteOperands }, ({ o: instruction, r: operand }) => instruction(operand)), // ALU r / ALU (HL)

      // 11 ccc 000: conditional returns read the stack only when the condition is true.
      ...opcodeFamily("11 ccc 000", { c: this.conditions }, ({ c: condition }) => ({ readByte }: InstructionContext) => this.stack.return(readByte, condition())), // RET cc

      // 11 pp q 001: q=0 pops BC/DE/HL/status (PSW or AF).
      // q=1 selects RET, an extension slot, PCHL / JP (HL), or SPHL / LD SP,HL.
      ...opcodeFamily("11 pp 0 001", { p: this.#stackPairs }, ({ p: pair }) => ({ readByte }: InstructionContext) => this.writePair(pair, this.stack.pop(readByte))), // POP
      ...instructionPattern("11 00 1 001", ({ readByte }) => this.stack.return(readByte)), // RET
      ...this.#generatedHandlers(intelJumpForms.indirect), // PCHL / JP (HL)
      ...this.#generatedHandlers(intelWordTransferForms.stackPointer), // SPHL / LD SP,HL

      // 11 ccc 010: all eight absolute jump conditions fetch nn on both paths.
      ...this.#generatedHandlers(intelJumpForms.conditional), // JMP cc / JP cc,nn

      // 11 yyy 011: absolute jump, extensions/I/O, stack exchange, DE/HL exchange, DI/EI.
      // Each CPU owns extension decoding, port I/O, and interrupt controls.
      ...this.#generatedHandlers(intelJumpForms.absolute), // JMP / JP nn
      ...this.#generatedHandlers(intelExchangeForms), // 11 10 m 011: m=0 XTHL / EX (SP),HL; m=1 XCHG / EX DE,HL

      // 11 ccc 100: conditional calls always fetch nn, then push only on a taken path.
      ...opcodeFamily("11 ccc 100", { c: this.conditions }, ({ c: condition }) => ({ fetchWord, writeByte }: InstructionContext) => this.stack.call(fetchWord(), writeByte, condition())), // CALL cc,nn

      // 11 pp 0 101: PUSH uses BC/DE/HL/status. Bit 3=1 includes unconditional CALL.
      ...opcodeFamily("11 pp 0 101", { p: this.#stackPairs }, ({ p: pair }) => ({ writeByte }: InstructionContext) => this.stack.push(this.readPair(pair), writeByte)), // PUSH
      ...instructionPattern("11 00 1 101", ({ fetchWord, writeByte }) => this.stack.call(fetchWord(), writeByte)), // CALL nn

      // 11 ooo 110: the same ooo operations with an immediate byte instead of a register/memory selector.
      ...opcodeFamily("11 ooo 110", { o: this.aluInstructions }, ({ o: instruction }) => instruction("immediate")), // ALU n

      // 11 ttt 111: ttt selects the restart address 00,08,10,18,20,28,30,38; it is an ordinary call.
      ...opcodeFamily("11 ttt 111", { t: [0x00, 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38] }, ({ t: address }) => ({ writeByte }: InstructionContext) => this.stack.call(address, writeByte)), // RST p
    ];
  }

  #generatedHandlers(forms: readonly OpcodeEntry<unknown>[]): readonly OpcodeEntry<OpcodeHandler>[] {
    return forms.map(([opcode]) => [opcode, instruction => this.generatedInstructions[opcode]!(this.state, instruction)]);
  }

  // Register operands.

  protected readPair(pair: WordOperand): number {
    if (pair === "sp") return this.state.sp;
    if (pair === "status") return this.statusWord;
    return readRegisterPair(this.state, pair);
  }

  protected writePair(pair: WordOperand, value: number): void {
    if (pair === "sp") this.state.sp = value;
    else if (pair === "status") this.statusWord = value;
    else writeRegisterPair(this.state, pair, value);
  }

  // Data words are little-endian and wrap independently of the instruction stream.

  protected readMemoryWord(address: number, readByte: InstructionContext["readByte"]): number {
    const low = readByte(address);
    return low | (readByte((address + 1) & 0xffff) << 8);
  }
}
