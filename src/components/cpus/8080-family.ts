import type { WordInstructionContext as InstructionContext } from "./instruction-context.ts";
import { opcodeFamily, opcodePattern } from "./opcodes.ts";
import type { OpcodeEntry } from "./opcodes.ts";
import { intelAccumulatorTransferForms, intelExchangeForms, intelJumpForms, intelStackForms, intelSubroutineForms, intelWordArithmeticForms, intelWordTransferForms } from "./intel-encodings.ts";

export type OpcodeHandler = (instruction: InstructionContext) => void;
type Registers = Record<"a" | "b" | "c" | "d" | "e" | "h" | "l" | "pc" | "sp", number> & { halted: boolean };
const instructionPattern = opcodePattern<OpcodeHandler>;

/** Z80 base encodings inherited from the 8080; the 8080 itself now uses chapter-generated dispatch. */
export abstract class Cpu8080Family<State extends Registers> {
  protected readonly state: State;

  protected constructor(state: State) {
    this.state = state;
  }

  // These hooks describe instruction differences, without imposing a common flag layout.
  protected abstract readonly generatedInstructions: Readonly<Record<number, (state: State, instruction: InstructionContext) => void>>;
  protected abstract readonly accumulatorOperations: readonly (() => void)[];

  // rrr/ddd/sss select B/C/D/E/H/L/(HL)/A; the 8080 calls (HL) M.
  protected readonly byteOperands = ["b", "c", "d", "e", "h", "l", "(hl)", "a"] as const;

  // Called by each CPU only after its operation fields have initialized.
  // Builders capture callbacks and selectors; none reads live registers, flags, or RAM.
  // Shared opcode bits: 7 6 | 5 4 3 | 2 1 0 = xx yyy zzz.
  // xx selects a block; the other fields select its operation and operands.
  // Pair families split yyy into pp q. Comments give 8080 / Z80 mnemonics.
  // Byte loads, arithmetic, and adjustments now come from the Z80 chapter;
  // the remaining inherited families stay here until their migration.
  protected baseInstructions(): readonly OpcodeEntry<OpcodeHandler>[] {
    return [
      // xx=00, zzz=000: only yyy=000 (NOP) is documented on the 8080.
      ...instructionPattern("00 000 000", instruction => this.generatedInstructions[0x00]!(this.state, instruction)), // NOP

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

      // 00 ooo 111: accumulator rotates, DAA, complement A, set/complement carry.
      // Each CPU supplies the operations because their flag effects differ.
      ...opcodeFamily("00 ooo 111", { o: this.accumulatorOperations }, ({ o: operate }) => operate),

      ...instructionPattern("01 110 110", instruction => this.generatedInstructions[0x76]!(this.state, instruction)), // HLT / HALT; no data access

      // 11 ccc 000: conditional returns read the stack only when the condition is true.
      ...this.#generatedHandlers(intelSubroutineForms.conditionalReturns), // RET cc

      // 11 pp q 001: q=0 pops BC/DE/HL/status (PSW or AF).
      // q=1 selects RET, an extension slot, PCHL / JP (HL), or SPHL / LD SP,HL.
      ...this.#generatedHandlers(intelStackForms.pop), // POP BC/DE/HL
      ...instructionPattern("11 11 0 001", instruction => this.generatedInstructions[0xf1]!(this.state, instruction)), // POP PSW/AF
      ...this.#generatedHandlers(intelSubroutineForms.return), // RET
      ...this.#generatedHandlers(intelJumpForms.indirect), // PCHL / JP (HL)
      ...this.#generatedHandlers(intelWordTransferForms.stackPointer), // SPHL / LD SP,HL

      // 11 ccc 010: all eight absolute jump conditions fetch nn on both paths.
      ...this.#generatedHandlers(intelJumpForms.conditional), // JMP cc / JP cc,nn

      // 11 yyy 011: absolute jump, extensions/I/O, stack exchange, DE/HL exchange, DI/EI.
      // Each CPU owns extension decoding, port I/O, and interrupt controls.
      ...this.#generatedHandlers(intelJumpForms.absolute), // JMP / JP nn
      ...this.#generatedHandlers(intelExchangeForms), // 11 10 m 011: m=0 XTHL / EX (SP),HL; m=1 XCHG / EX DE,HL

      // 11 ccc 100: conditional calls always fetch nn, then push only on a taken path.
      ...this.#generatedHandlers(intelSubroutineForms.conditionalCalls), // CALL cc,nn

      // 11 pp 0 101: PUSH uses BC/DE/HL/status. Bit 3=1 includes unconditional CALL.
      ...this.#generatedHandlers(intelStackForms.push), // PUSH BC/DE/HL
      ...instructionPattern("11 11 0 101", instruction => this.generatedInstructions[0xf5]!(this.state, instruction)), // PUSH PSW/AF
      ...this.#generatedHandlers(intelSubroutineForms.call), // CALL nn

      // 11 ttt 111: ttt selects the restart address 00,08,10,18,20,28,30,38; it is an ordinary call.
      ...this.#generatedHandlers(intelSubroutineForms.restarts), // RST p
    ];
  }

  #generatedHandlers(forms: readonly OpcodeEntry<unknown>[]): readonly OpcodeEntry<OpcodeHandler>[] {
    return forms.map(([opcode]) => [opcode, instruction => this.generatedInstructions[opcode]!(this.state, instruction)]);
  }

  // Data words are little-endian and wrap independently of the instruction stream.

  protected readMemoryWord(address: number, readByte: InstructionContext["readByte"]): number {
    const low = readByte(address);
    return low | (readByte((address + 1) & 0xffff) << 8);
  }
}
