# CPU implementation coverage

All eight initial CPU models now implement **100% of their documented opcode
forms through [shared, inspectable instruction definitions](instruction-semantics.md)**
that generate both executable code and explanations. The table records the
completed instruction-definition migration and current source footprint. The
detailed support inventory remains below as a reference for implemented behavior
and processor limitations.

Update this document whenever migration, CPU support, or source footprint changes.
The [model contracts](../README.md#cpu-models) define state and execution policies;
example specifications define programs and expected results. [CPU scope](scope.md)
records intended targets and the reasons for choosing them. Existing reference
emulators do not count toward implementation here.

## At a glance

| Model | Introduced | Transistors (approx.) | Source lines | Migrated / documented forms | Definition migration |
| --- | --- | ---: | ---: | --- | --- |
| [Intel 8008](#8008) | 1972 | [3,500][intel-transistors] | [228](../../src/components/cpus/8008.ts) | 250 / 250 | 100% |
| [Intel 8080](#8080) | 1974 | [6,000][intel-transistors] | [197](../../src/components/cpus/8080.ts) | 244 / 244 | 100% |
| [Motorola 6800](#6800) | 1974 | [4,100][6800-transistors] | [213](../../src/components/cpus/6800.ts) | 197 / 197 | 100% |
| [MOS 6502](#6502) | 1975 | [3,510][6502-transistors] | [101](../../src/components/cpus/6502.ts) | 151 / 151 | 100% |
| [Zilog Z80](#z80) | 1976 | [8,500][z80-transistors] | [392](../../src/components/cpus/z80.ts) | 698 / 698 | 100% |
| [Motorola 6809](#6809) | 1978 | [9,000][6809-transistors] | [370](../../src/components/cpus/6809.ts) | 268 / 268 | 100% |
| [Intel 8088](#8088) | 1979 | [29,000][intel-transistors] | [522](../../src/components/cpus/8088.ts) | 291 / 291 | 100% |
| [Motorola 68000](#68000) | 1979 | [68,000][68000-transistors] | [596](../../src/components/cpus/68000.ts) | 36,029 / 36,029 | 100% |

The current [definition inventory](../../src/components/cpus/semantics/definitions.ts)
contains **12,197 generated bodies**, all used by CPU execution,
including 6502/6800/8088 entry helpers, a 6809 frame-push helper, and 8088 WAIT
resumption. They cover **38,128 complete opcode forms**. All eight CPUs now
have complete instruction-definition migration. The current
family inventory is:

- [6502 definitions](../../src/components/cpus/semantics/definitions/6502.ts):
  14 CMP/CPX/CPY forms, 18 LDA/LDX/LDY forms, 13 STA/STX/STY forms, all six register transfers,
  all 20 ASL/ROL/LSR/ROR forms, eight memory INC/DEC forms, INX/INY/DEX/DEY,
  all 24 ORA/AND/EOR forms, both BIT forms, eight conditional branches,
  and absolute/indirect JMP. Branches fetch before testing flags and read/write
  PC only when taken. Indirect JMP retains the NMOS pointer-page wrap.
  PHA/PLA and JSR/RTS add four bodies. PLA applies N/Z only after a successful
  pull; JSR fetches target low, pushes current PC high/low, then fetches target
  high, retaining code/stack overlap. RTS adds one after the complete pop.
  ADC/SBC in all sixteen addressing forms, PHP/PLP, the seven flag changes,
  and NOP add 26 bodies. NMOS decimal correction retains distinct flag/write
  stages and invalid-digit behavior. Status packing uses the CPU-owned layout;
  PLP replaces flags only after a successful pull. BRK/RTI complete all 151 forms;
  BRK consumes padding, pushes live PC bytes and status, then sets I and loads
  the vector. RTI restores flags before PC. A generated external-entry helper
  shares BRK's sequence with the saved B marker clear. The accumulator
  families share their addressing inventory, with STA excluding the immediate
  slot. Logical instructions read the operand before A; ORA/AND/EOR write A then
  set N/Z, while BIT preserves A and copies memory bits 7/6 into N/V.
- [8080 definitions](../../src/components/cpus/semantics/definitions/8080.ts):
  All 72 ADD/ADC/SUB/SBB/ANA/XRA/ORA/CMP register, memory, and immediate forms,
  plus RLC/RRC/RAL/RAR, are integrated: 76 migrated forms. Arithmetic shares
  its calculation and flag-application recipe with the Motorola CPUs, while
  ADC/SBB explicitly capture CY before A. Policies retain parity, inverse
  half-borrow on subtraction, and ANA's bit-3 auxiliary carry rule. Flags precede
  writeback; CMP never writes A. INR/DCR add all 16 register/memory forms,
  sharing adjustment construction with the Z80. They preserve CY without reading
  it, derive S/Z/P from the result, and use carry/inverse borrow for AC.
  Flags precede writeback, so a failed memory write retains them.
  All 63 MOV and eight MVI forms add 71 bodies sharing transfer construction
  and an encoding inventory with the Z80. Sources are captured before writes;
  memory destinations read H/L after the source or immediate fetch. Transfers
  never access flags. MOV B,A is now part of this production family, with no
  separate test-only body. Four LXI forms, LHLD/SHLD, and SPHL add seven word
  bodies sharing construction and base encodings with the Z80. Word operands
  and memory transfer low byte first; pairs use explicit high-then-low register
  reads and writes. Stores capture both source bytes after fetching the address;
  a failed second write retains the first. Loads replace the destination only
  after both reads succeed. INX/DCX and DAD add twelve word-arithmetic bodies
  sharing pair descriptions, construction, and base encodings with the Z80.
  Adjustments never access flags; DAD reads the source pair before HL, writes
  H then L, and updates only CY. STAX/LDAX through BC/DE and absolute STA/LDA
  add six accumulator-transfer bodies, sharing construction and encodings with
  the Z80. They capture the complete address before reading A or memory;
  stores never read the destination and loads write A only after a successful
  read. Flags are never accessed. XTHL/XCHG add two exchange bodies shared with
  the Z80. XTHL captures HL before SP, reads low/high, writes high/low, then
  replaces HL only after both writes succeed; SP and flags are unchanged.
  XCHG swaps D/H before E/L without memory or flag access. Eight conditional
  jumps, JMP, and PCHL add ten bodies using shared control-flow construction
  and Intel encodings. Immediate targets are fetched completely before flags
  are tested; PCHL reads H/L without a memory access. PUSH/POP BC/DE/HL,
  nine CALL forms, nine RET forms, and eight RST forms add 32 bodies. All use
  shared descending-stack construction: predecrement before writes, increment
  after successful reads, and little-endian words. Calls fetch targets before
  testing flags; untaken calls/returns leave SP untouched and only advance PC
  through instruction fetching. DAA, CMA/STC/CMC, NOP/HLT, and PUSH/POP PSW
  add eight bodies. PSW shares its reserved-bit layout with runtime encoding;
  POP replaces A then the complete flags only after both reads succeed.
  IN/OUT add two bodies using shared port-transfer construction, with the
  immediate port fetched before A is read or written. DI/EI complete all 244
  bodies and forms. EI sets the enable latch and requests IRQ deferral; the
  CPU commits that request only at successful retirement.
- [6800 definitions](../../src/components/cpus/semantics/definitions/6800.ts):
  All eleven unary operations on A/B and indexed/extended memory count as 44
  migrated forms. Their 33 bodies use the same
  [Motorola construction](../../src/components/cpus/semantics/motorola.ts) as the
  6809, with explicit differences for CLR reads, TST carry, and right-shift overflow.
  CMPA/CMPB/CPX across all four addressing modes and CBA add 13 forms from seven
  bodies. Comparison construction and address-mode bindings are shared with the
  6809; CPX supplies its own high-byte N/V, whole-word Z, and preserved-C policy.
  AND/BIT/EOR/OR on A/B add 32 forms from 16 bodies, using shared Motorola logical
  construction and the same immediate/resolved-memory binding as comparisons.
  The original mnemonic spelling ORAA/ORAB is retained in explanations.
  LDAA/LDAB and STAA/STAB add 14 forms from six shared load/store bodies;
  TAB/TBA add two more bodies and forms. Loads and transfers write the register
  before N/Z/V; stores apply these flags only after a successful memory write.
  LDS/LDX and STS/STX add 14 word forms from six bodies using the same transfer
  construction, with high-byte-first accesses and flags after both writes.
  ADD/ADC/SUB/SBC on A/B add 32 forms from 16 shared binary-arithmetic bodies;
  ABA/SBA add two more bodies and forms. Flags precede register writeback.
  Byte addition replaces H; subtraction preserves it.
  Fifteen short branches and indexed/extended JMP add 17 forms from 16 bodies.
  Branch construction and conditions are shared with the 6809; the unused BRN
  slot stays absent. One JMP body serves both resolved addresses.
  PSHA/PSHB/PULA/PULB, BSR, indexed/extended JSR, and RTS add eight forms from
  seven bodies. SP names the next free byte: push writes before decrementing,
  pull increments before reading. Word calls push low/high and return reads
  high/low. Calls capture targets before stacking; completed effects remain
  on failure. Stack operations preserve flags.
  DAA, TAP/TPA, six flag changes, INX/DEX, INS/DES, TSX/TXS, and NOP add
  sixteen bodies. Decimal correction is shared with the 6809; only INX/DEX
  affect Z among the pointer/index operations. TAP ignores reserved bits and
  replaces the whole flag object. RTI/WAI/SWI complete all 197 forms. Their
  generated frames capture each field at its turn and restore CC before
  registers. The external-entry helper shares SWI's sequence, reusing an
  existing WAI frame before masking IRQ and loading the vector.
- [6809 definitions](../../src/components/cpus/semantics/definitions/6809.ts):
  CMPA/B/D/X/Y/U/S across immediate/direct/indexed/extended addressing count as
  28 migrated forms from 14 bodies. All eleven unary operations (NEG, COM, LSR,
  ROR, ASR, ASL, ROL, DEC, INC, TST, CLR) on A/B and direct/indexed/extended memory
  add 55 more forms from 33 bodies. Each memory body serves all three addressing
  modes after the existing decoder supplies its resolved address, including all
  documented indexed postbytes. Comparisons read their complete operand before
  the compared register; D is explicitly read as A followed by B.
  AND/BIT/EOR/OR on A/B add 32 forms from 16 bodies shared in construction with
  the 6800. Both CPUs derive N/Z from the logical result, clear V, and preserve
  C/H and control flags; BIT omits writeback. The 6809 retains its indexed
  address updates and unsupported-postbyte rejection before body entry.
  LDA/LDB and STA/STB add 14 forms from six shared load/store bodies. Stores
  capture A/B after address resolution, never read the destination, and update
  N/Z/V only after a successful write, preserving C/H and control flags.
  LDD/LDX/LDY/LDU/LDS and their stores add 35 word forms from 15 bodies.
  D is read and written explicitly as A then B; a successful LDS writes S and
  arms NMI before applying flags. Failed second reads preserve destination
  registers; failed second writes retain the first byte but preserve flags.
  ADD/ADC/SUB/SBC on A/B and ADDD/SUBD add 40 forms from 20 shared arithmetic
  bodies. ADC/SBC capture incoming C after the operand and accumulator reads.
  Word arithmetic preserves H and writes D as A then B after applying N/Z/V/C.
  Sixteen short and sixteen long branches add 32 bodies; BRN/LBRN still fetch
  their complete displacement. LBRA keeps its standalone opcode. One resolved
  JMP body serves direct/indexed/extended forms, preserving all indexed-decoder
  side effects and rejection before entry: 35 further forms from 33 bodies.
  BSR/LBSR, direct/indexed/extended JSR, and RTS add six forms from four bodies.
  S names the occupied byte: pushes predecrement; pulls increment after reads.
  Words use the same big-endian layout as the 6800. Indexed JSR captures its
  resolved target before stacking, retaining S auto-updates and NMI arming;
  the call/return bodies themselves preserve arming. Shared DAA and generated
  ORCC/ANDCC add three more forms. CC is captured before fetching the mask;
  only a successful fetch permits the complete flag replacement.
  TFR/EXG add 104 specialized bodies for their 52 legal same-width postbytes
  each, counting as two opcode forms. They capture both registers before
  writing the destination, then the source for EXG. D expands to A/B, CC writes
  replace all flags, and S writes arm NMI. Four mask-driven PSHS/PULS/PSHU/PULU
  bodies cover all 256 masks each, capturing each pushed register at its turn
  and committing each pulled register only after its full read. Nonempty
  PSHS/PULS arm NMI only after success; PULU's S write arms immediately.
  A supplied-mask frame-push helper reuses that construction for external entry
  without instruction fetching or final arming; it earns no opcode credit.
  Complete RTI replaces the former partial frame-pull helper.
  LEAX/LEAY/LEAS/LEAU, SEX, ABX, MUL, and NOP add eight more forms. LEA enters
  after indexed resolution; MUL uses a checked byte-by-byte product yielding
  a word, with C from product bit 7. SYNC, CWAI, RTI, and SWI/SWI2/SWI3
  complete all 268 forms. Generated wait-mode choices retain CWAI frame reuse;
  restored E selects RTI's full or short frame before final NMI arming.
- [Z80 definitions](../../src/components/cpus/semantics/definitions/z80.ts):
  All eight byte ALU families (ADD/ADC/SUB/SBC/AND/XOR/OR/CP) are integrated:
  72 register, (HL), and immediate forms, plus 16 (IX+d)/(IY+d) forms. Eight
  resolved-memory bodies each serve both index registers, giving 80 bodies for
  88 forms. The Z80 shares source and ALU construction with the 8080, while
  declaring its own P/V, H, N, and C policies. Prefix decoding, displacement
  fetching, address wrapping, and R updates remain in the CPU. Generated bodies
  preserve the alternate bank and control state; CP never writes A.
  RLCA/RRCA/RLA/RRA add four forms using the shared Intel accumulator-rotate
  recipe, followed by N/H clearing; S/Z/PV are preserved. All seven documented
  CB shift/rotate families add 70 register, (HL), (IX+d), and (IY+d) forms from
  56 bodies. Each resolved-memory body serves all three memory operands.
  CB forms derive S/Z/PV from the result, clear H/N, and set outgoing C before
  writeback. Failed reads leave flags unchanged; failed writes retain calculated
  flags. BIT/RES/SET add 240 forms from 192 bodies, completing the documented
  ordinary and indexed CB pages. BIT reads without writing, preserves C, and
  retains the model's observed S/PV policy. RES/SET preserve all flags, including
  on a failed write. All CB families share register/memory construction and
  opcode bindings, replacing the handwritten bit-operation path and BIT helper.
  INC/DEC add 20 byte forms from 16 bodies using shared Intel adjustment
  construction. The two memory bodies serve HL, IX, and IY at a resolved address.
  They preserve C, set H from carry/borrow, derive P/V from signed overflow, and
  apply flags before writeback. The handwritten adjustment and indexed memory
  wrappers are removed. The 63 byte-transfer matrix slots and eight immediate
  loads add 71 bodies shared in construction and binding with the 8080. Fifteen
  resolved-memory transfer bodies cover 30 further IX/IY forms, retaining real
  H/L operands and displacement-before-immediate order. The memory-to-memory
  slot is a separate generated HALT body. Word loads/stores and SP copies add 23 forms
  from 21 bodies: the seven shared base forms, eight ED absolute pair transfers,
  and eight IX/IY immediate, absolute, and SP forms. ED's HL transfers reuse
  their unprefixed bodies. Address fetching, complete source capture, low-first
  memory access, and split pair writes are explicit; flags and alternate banks
  are untouched. Word INC/DEC, ADD HL/IX/IY, and ADC/SBC HL add 32
  bodies and forms. They reuse the 8080's pair descriptions and arithmetic
  construction; IX/IY use stored words. ADC/SBC read C after both operands.
  All word arithmetic writes before flags: ADD replaces H/C/N and preserves
  S/Z/PV, while ADC/SBC derive whole-word sign, zero, and signed overflow.
  H uses carry/borrow out of bit 11. Adjustments preserve all flags without
  reading them. Six further accumulator LD forms through BC, DE, and absolute
  addresses reuse the 8080's transfer construction and bindings. Pair addresses
  read high byte first; absolute addresses fetch low byte first. Stores capture
  A after the address, while loads preserve A on a failed read. Both directions
  preserve flags and alternate banks without accessing them.
  EX DE,HL and EX (SP),HL/IX/IY add four bodies using shared Intel exchange
  construction. Stack exchanges capture the register before SP, read low/high,
  write high/low, and replace the register only after both writes succeed.
  Failed writes retain completed memory effects; SP, flags, and alternate banks
  are untouched. Eight conditional JP forms, JP nn, and JP (HL/IX/IY) add
  twelve bodies. Five JR forms and DJNZ add six more. All targets/displacements
  are read before conditions; untaken paths do not read or write PC. DJNZ
  decrements B after fetching, preserves flags, and tests the resulting B.
  PUSH/POP BC/DE/HL/IX/IY and every ordinary CALL/RET/RST add 36 bodies and
  forms. They share the 8080's stack/subroutine construction, including complete
  source capture, delayed pop writeback, and byte-level failure boundaries.
  DAA, CPL/SCF/CCF, NOP/HALT, and PUSH/POP AF add eight more bodies. AF uses
  the same declared layout for packing and unpacking; DAA retains incoming N
  after result writeback. Prefix decoding, supplied instructions, refresh, and
  retirement retain their existing contracts. The runtime stack helper now
  belongs to the Z80 alone, for interrupt entry/return.
  EX AF,AF′ and EXX add two bodies using schema-owned alternate registers;
  the former exchanges whole flag objects without reading their bits. Four
  I/R transfers retain refresh before entry and PV from a captured IFF2.
  NEG, RLD, and RRD add three bodies; digit rotates capture HL/memory/A,
  write memory, then read C, replace flags, and write A. Eight block transfer
  and search bodies perform one iteration per step: capture BC after the read,
  retain live pair updates, then conditionally rewind PC for refetching.
  Constant logical shifts describe nibble movement directly. These 17 forms
  complete ordinary instruction migration. All 24 I/O forms now add generated
  bodies: immediate ports capture old A before fetching, register ports use BC,
  and block I/O preserves B decrement between the read and write. Repeated
  forms transfer one byte per step, then rewind PC and correct H/PV as required.
  DI/EI, IM 0/1/2, and RETN/RETI complete 607 bodies covering all 698 forms.
  Mode choices come from the state schema. Returns commit PC before restoring
  IFF1 from IFF2; deferral and RETI notification remain retirement requests.
- [8008 definitions](../../src/components/cpus/semantics/definitions/8008.ts):
  All 72 byte ALU forms are integrated: AD/AC/SU/SB/ND/XR/OR/CP with each
  register, memory, and immediate source. The existing Intel ALU construction
  is reused unchanged, with S/Z/P/C policies and explicit C-before-A reads for
  AC/SB. Native sources follow A/B/C/D/E/H/L/M; M masks H:L to `3FFF` without
  changing H or L. Comparison never writes A. Fetching and interrupt acceptance
  remain in the CPU, including the selected address slot and supplied bytes
  that leave every address register unchanged.
  INr/DCr on B/C/D/E/H/L add twelve forms, applying S/Z/P before register
  writeback and preserving C without reading it. RLC/RRC/RAL/RAR add four
  forms using the same accumulator-rotate construction as the 8080: capture A,
  read incoming C only for RAL/RAR, then write A before C. S/Z/P are preserved.
  All 63 register/memory transfers and eight immediate loads add 71 bodies using
  shared Intel transfer construction, with native A/B/C/D/E/H/L/M selectors,
  `11 ddd sss` matrix encodings, and a `3FFF` address mask. Stores capture the
  source or fetch the immediate before reading H/L; masking never narrows the
  stored register bytes. Transfers do not access flags or control state.
  Definition generation and execution consume the same native opcode inventory;
  HLT remains explicit. Handwritten arithmetic and operand read/write helpers
  are removed. All conditional jumps/calls/returns, unconditional aliases,
  eight restarts, and three halts add 59 bodies and forms. Targets fetch low/high
  and narrow to 14 bits before any condition read. Taken calls advance the
  three-bit selector and write the next physical address slot; returns only
  decrement the selector, retaining every slot. Untaken paths never read the
  selector or access the array. Generated bodies leave fetch-time PC advancement
  and supplied-byte behavior with the core. INP/OUT add all 32 port forms,
  using encoded input selectors 0..7 and output selectors 8..31 without flag
  access. All 250 documented forms are migrated. Fetching, reset, and external
  interrupt acceptance remain CPU-owned.

- [8088 definitions](../../src/components/cpus/semantics/definitions/8088.ts):
  Sixteen immediate MOV forms, sixteen accumulator ADD/OR/ADC/SBB/AND/SUB/XOR/CMP
  forms, both immediate TEST forms, sixteen word INC/DEC forms, and eight
  AX/register exchanges including NOP add 58 bodies and complete forms.
  Construction-time byte views read AL/AH and their siblings from stored words;
  writes reread the word at writeback and retain the current other half.
  Immediates fetch completely before operand or flag reads; word operands use
  the existing low-first Intel source. ADC/SBB capture CF after the accumulator.
  Arithmetic and logical flags precede writeback, word parity uses the low
  byte, and logical AF retains deterministic clearing. INC/DEC capture CF,
  update arithmetic flags, then restore CF before writing the register.
  Exchanges read the selected register before AX and write AX first, retaining
  the self-exchange schedule for NOP. Definitions own the encoding families and
  generate their bindings, sharing register selectors with runtime operands.
  The accumulator-dispatch and register-adjustment wrappers are removed.
  ModR/M MOV in both directions, ModR/M XCHG, absolute accumulator MOV, and
  immediate r/m MOV add twelve complete forms.
  Their 306 specialized bodies cover every register pair and reuse resolved
  memory bodies across addressing modes; immediate register choices reuse the
  earlier bodies. The decoder supplies a captured segment and offset. Each
  word access wraps its byte offset before projecting onto the 20-bit bus,
  transferring low byte first. Sources are captured before writes; XCHG reads
  r/m before the register and writes r/m first. Failed second accesses retain
  completed effects. Prefix handling, ModR/M resolution, rejection, segmented
  fetching, and retirement remain in the CPU.
  All 32 register/memory ALU forms, 26 immediate r/m ALU forms, and four
  register/immediate TEST forms add 62 more.
  Their 1,631 specialized bodies reuse the transfer operands and accumulator
  arithmetic/flag construction, with no new primitive or compiler support.
  Sources are captured before destinations; ADC/SBB then read CF. Immediate
  words fetch completely before the destination read, including explicit byte
  sign extension for 83. Flags precede writeback, so a failed memory write
  retains them and any completed byte write. CMP/TEST never write operands.
  One ModR/M binding now selects MOV, XCHG, ALU, and TEST bodies. The old ALU
  function table, operand-pair/apply wrappers, immediate TEST wrapper, immediate
  reader, and runtime logical-flag helper are removed.
  Unary INC/DEC/NOT/NEG add eight forms with 72 register/memory specializations,
  sharing the same operand construction. INC/DEC capture CF after the complete
  operand, update arithmetic flags, restore CF, then write; NEG uses ordinary
  subtraction flags, while NOT never accesses flags.
  All sixteen Jcc, four LOOP/JCXZ, and two relative JMP forms add 22 bodies.
  Conditions retain short-circuit flag reads; LOOP decrements and rereads CX
  before testing, and only taken branches read/write IP.
  CBW/CWD, SAHF/LAHF, HLT, and carry/direction controls add ten bodies.
  SAHF updates only its five flags; LAHF preserves live AL at writeback.
  These 40 forms retain the existing boundary contracts. Prefixes, addressing,
  selector rejection, and retirement remain CPU-owned; the old unary-operation,
  branch-condition, adjustment, addition, jump, and loop paths are removed.
  PUSH/POP of registers, segments, memory, and FLAGS; near/far CALL and RET;
  and the remaining indirect/far JMP add 38 complete forms.
  Their 54 instruction bodies share a segmented word
  stack: decrement SP once before a push, capture SS:SP for both byte accesses,
  and increment live SP only after a complete pop. PUSH SP captures its
  decremented value; POP SP replaces the incremented pointer. Far calls read the
  whole target before stacking CS and then live IP. POPF replaces all flags
  after a complete read and requests INTR deferral only when IF becomes set;
  segment pops request all-interrupt deferral. The boundary commits these
  requests only at successful retirement. Complete interrupt entry now expands
  that same word-push construction, replacing the earlier standalone helper.
  Handwritten stack/call/return/FLAGS helpers are removed.
  Segment MOV, LEA, LES/LDS, and XLAT add six forms using 89 specialized bodies.
  LES/LDS share complete far-pointer reads with CALL/JMP but write the general
  register before the segment and never request inhibition. XLAT preserves
  live AH after its table read. Ten byte/word string forms add 48 bodies for
  ordinary, repeated, and overridden sources. Zero repeated counts skip all
  operand effects; each nonempty invocation performs one element, then reads
  DF and advances live indices before decrementing and rereading CX. CMPS/SCAS
  reuse subtraction flags and test the new ZF only when CX remains nonzero.
  Prefix fetching and interrupt boundaries remain in the CPU. CLI/STI and IRET
  add three generated opcode bodies; IRET shares the complete return and FLAGS
  sequences and now earns full migration credit. These 19 forms bring the
  total to **229 migrated forms**, with no new primitive or compiler support.
  Shifts and rotates add 28 forms; MUL/IMUL/DIV/IDIV add eight; the six decimal
  and ASCII adjustments complete the ordinary arithmetic migration. Their 324
  resolved-operand specializations and six numeric bodies reuse byte views,
  segmented memory, result flags, and the shared one-bit shift recipe. A bounded
  iteration keeps full CL counts and per-bit CF effects explicit, including
  unchanged-value writes at count zero. Full products use unsigned 32-bit
  intermediates where needed; checked division returns a named outcome before
  writeback, with the original 8088 signed minimum rejected explicitly. Decimal
  adjustment retains short-circuit flag reads and its original-chip thresholds.
  IN/OUT add all eight forms with immediate or DX addressing and AL/AX operands.
  Word transfers use low then high bytes, wrapping the second port within 16
  bits. Input commits only after all reads; byte input preserves live AH.
  The final twelve forms—eight ESC encodings, WAIT, and INT3/INT/INTO—complete
  all **291 forms**. Six instruction bodies share two ESC operand paths;
  complete entry and WAIT resumption add two boundary helpers. Software,
  divide-error, trap, and external delivery share the explicit vector/frame
  sequence: capture the full vector before clearing masks or stacking, push
  FLAGS and live CS/IP, then commit CS:IP. Software delivery is reported only
  after completion. WAIT samples TEST before changing waiting/IP and requests
  inhibition only on release. ESC resolves its operand in the CPU, then its
  generated body reads a dummy word for memory forms before sending the request.
  Device adapters retain validation, detached requests, and access recording;
  recognition and retirement remain CPU-owned.

- [68000 definitions](../../src/components/cpus/semantics/definitions/68000.ts):
  The first **800 forms** comprise 576 register-only MOVE/MOVEA forms, eight
  MOVEQ destinations, sixteen EXT forms, eight SWAP forms, and all 192 EXG
  pairs. MOVEQ's embedded immediate byte is a parameter: its 2,048 operation
  words count as eight forms. In total the bodies serve **2,840 operation words**.
  Byte/word data writes retain the live upper portion; EXT.W retains its
  captured upper word. MOVEA.W sign-extends and preserves every flag.
  A7 resolves to SSP/USP at each operand's turn without reading the inactive
  stack. EXG resolves both identities and captures both originals before either
  write. MOVE/MOVEQ/EXT write before N/Z/V/C; SWAP applies flags first. X/T/S
  remain untouched. The existing conditional, width, transfer, and flag
  vocabulary suffices for these register forms.
  All remaining **9,150 MOVE/MOVEA forms** now use **169 shared bodies**,
  completing the entire ordinary transfer family. Sources finish before
  destination-address decoding. The decoder stages auto-updates, making them
  visible to later base/index calculations; the body commits them only after
  alignment checks and before writeback. Source/extension failures discard
  pending updates; failed destination writes retain committed updates and
  completed bytes, with flags unchanged. Immediate operands fetch complete
  words; data reads/writes remain explicit high-first byte accesses. PC-relative
  sources retain program-space identity in both bus and alignment faults.
  The CPU still owns EA decoding, fetch cursors, exception delivery, and retirement.
  AND/OR/EOR, ordinary ANDI/ORI/EORI, and CLR/NOT/TST add **6,660 forms**
  through **906 shared bodies**. MOVE and logic now share operand classification,
  source reads, immediate fetching, byte transfers, alignment checks, partial Dn
  writes, and result flags. Logical memory destinations commit staged updates
  before their read, including CLR's otherwise unused read. Source-read failures
  discard updates; destination-read failures retain them. Flags precede writeback,
  so failed writes retain computed flags and completed bytes; TST never writes.
  AND/OR immediate source-EA encodings share bodies with their ANDI/ORI-to-Dn
  equivalents. CCR/SR immediates retain their separate handwritten delivery paths.
  ADD/SUB/CMP, their immediate/quick/address-register forms, ADDX/SUBX,
  NEG/NEGX, and CMPM add **11,186 forms** through **2,678 shared bodies**.
  Quick constants remain decoded parameters, so these forms cover **13,510
  operation words**. Logic and arithmetic share the complete destination
  read/modify/write sequence. Arithmetic reuses the shared calculation recipe
  with 68000 flag policies: comparisons preserve X and never write a result;
  other data arithmetic copies carry/borrow to X. Extended operations capture
  Z then X after the operand reads and accumulate zero across results. Address
  arithmetic uses all 32 destination bits, sign-extends word EA sources, keeps
  quick constants positive, and preserves flags except for CMPA. Resolve A7's
  destination bank before committing updates, then read its updated value.
  Paired memory operands resolve source before destination, including repeated
  predecrement/postincrement of one register. Alignment failures discard both
  pending updates; destination-read/write failures retain committed updates.
  BTST/BCHG/BCLR/BSET, every register/memory shift and rotate, and TAS add
  **3,940 forms** through **2,086 shared bodies** (**5,284 operation words**).
  Bit numbers and register counts are captured before the tested operand,
  including aliased registers. Bits test modulo 32 for Dn and modulo 8 otherwise;
  BTST writes only Z and retains its program-space and immediate-source forms.
  TAS derives flags from the old byte before setting bit 7. Memory operands
  reuse the destination stages, including A7 byte stepping and update/fault
  boundaries. Shifts reuse the shared one-bit recipe with named local values
  for result, X, C, and accumulated ASL overflow; flags publish after the loop.
  Zero-count shifts still set N/Z, clear V, and preserve X; ROX copies X to C,
  while the other families clear C. Ordinary rotates preserve X for all counts.
  MULU/MULS/DIVU/DIVS and CHK add **2,120 forms** through **440 bodies**;
  ABCD/SBCD/NBCD add **306 forms** through **139 bodies**. Word-source families
  commit address updates after result/flag effects, including before a zero-divisor
  or bounds-check exception. Division captures quotient overflow separately:
  overflow sets V and preserves Dn/N/Z/X, while success packs remainder:quotient
  into Dn. Multiply writes the full product before flags. CHK preserves flags
  on success and changes only N on failure. Decimal operations reuse the ALU
  destination stages, correct low then high digit, set C/X, read cumulative Z,
  and finally write the byte, retaining deterministic invalid-digit behavior.
  Scc, DBcc, BRA/Bcc/BSR, LEA/PEA/JMP/JSR, LINK/UNLK, and RTS add
  **1,285 forms** through **332 shared bodies** (**5,349 operation words**).
  Conditions share construction with the 6800/6809. Branches capture flags
  before any displacement extension; targets use the pre-extension cursor.
  Calls check stack alignment before target alignment, select the target before
  stacking, and commit the original stack bank only after all bytes succeed.
  DBcc validates a taken target before changing its counter. LEA selects its
  destination A7 bank before source resolution. Frame instructions retain A7
  aliases, and RTS validates the full return target before advancing the stack.
  Scc reads its destination before testing flags and writing even unchanged
  bytes. The unused runtime Motorola condition table is removed.
  MOVEP and MOVEM add **396 forms** through **294 bodies**. MOVEP reuses
  high-first byte transfers with a stride of two and permits odd addresses.
  MOVEM fetches its mask before resolving the EA, visits selected registers in
  normal or reversed order, and commits its base pointer only after the whole
  list succeeds. Empty lists still resolve the EA but perform no alignment
  check or base update. Word loads sign-extend; PC-relative loads use program
  space. Failed transfers retain earlier complete registers and written bytes.
  The final **186 status/system forms** add **63 bodies**, completing the
  migration. Those bodies also serve all TRAP literals and both software
  emulator lines. Status logic captures old SR before the immediate fetch;
  privilege checks precede operand effects. SR loads restore status before
  committing pending address updates to the original bank. RTE reads PC high,
  SR, then PC low; both RTE and RTR validate targets before committing pointer
  or status changes. RESET uses an explicit device signal, with recording and
  exception delivery retained at the CPU boundary.

The [current review](instruction-semantics.md#decision-and-next-review)
focuses on complete operation families, explicit carry and writeback stages,
and the total authored source needed to share these definitions across CPUs.

[intel-transistors]: https://www.intel.com/pressroom/kits/quickreffam.htm "Intel Microprocessor Quick Reference Guide"
[6800-transistors]: https://www.rocelec.com/news/the-bygone-motorola-6800 "Rochester Electronics: The Bygone Motorola 6800"
[6502-transistors]: http://www.visual6502.org/docs/6502_in_action_14_web.pdf "Visual6502: Visualizing a Classic CPU in Action"
[z80-transistors]: https://bitsavers.computerhistory.org/magazines/Datamation/19781115.pdf "Zilog die photograph and caption, Datamation, November 15, 1978, page 18"
[6809-transistors]: https://classiccmp.org/mailman3/hyperkitty/list/test-drb%40ccmp.vtda.org/message/FQT5Q6A5Z72YYRFD2XIYELPGINCANG3U/ "Microprocessor Report figures, as transcribed by Mike Cheponis in May 2001"
[68000-transistors]: https://www.eetimes.com/motorolas-68000-microprocessor-receives-technology-award/ "Motorola Semiconductor Products Sector announcement, November 1996"

Transistor figures describe the original chips and link to their sources.
Treat them as approximate historical counts: conventions differ, including
whether pull-up devices and unused transistor sites are included. The 6502
figure follows Visual6502's 3,510-transistor model; the 6809 figure comes from
an archived transcription of Microprocessor Report data.

Source lines count the entire linked CPU implementation file, including
comments and blank lines, using `wc -l`. Shared helpers, tests, and machine
definitions are excluded, including the [8080/Z80 family core](../../src/components/cpus/8080-family.ts)
and [Motorola operations](../../src/components/cpus/motorola.ts). Separate state
schemas, authored semantics, and generated instruction bodies are also excluded. A CPU row therefore
measures its own module rather than all the code it executes. These counts describe
the current instruction-level models.

Completed examples are linked in each CPU section below and grouped by topic
in the [example catalog](../README.md#cpu-examples).

All eight initial CPU models meet the [CPU-only capability checkpoint](completion.md#cpu-only-checkpoint-review)
and have complete documented opcode coverage, following the
[completion sequence](completion.md#completion-sequence). All eight also support
explicit external interrupt delivery at instruction boundaries; their model
contracts define native recognition and entry policies. Cycle timing remains
unmodeled. The 68000 also delivers explicit bus and address errors within its
instruction-level recovery contract.
Opcode completion does not imply complete processor emulation.

## Source footprint

The per-CPU line counts above omit supporting code. Use this wider count when
judging source reduction; all counts include comments and blank lines.

| Scope | Lines |
| --- | ---: |
| Eight CPU implementation files | 2,619 |
| CPU-specific instruction definition files | 2,477 |
| Other authored CPU source: shared helpers, state schemas, semantic model, builders, validation, generator, and reporter | 3,888 |
| **All authored TypeScript under `src/components/cpus`, excluding `generated/`** | **8,984** |
| CPU generation script (`scripts/generate-cpu-semantics.ts`) | 16 |
| Generated CPU output, counted separately | 310,832 |

Tests, documentation, machine definitions, and compiled JavaScript are outside
this source count. Generated TypeScript is reproducible build output, not
maintained source. Its size is still reported to keep expansion visible.
Shared word-read and word-write builders now serve Intel transfers and stack
exchange, Motorola word operands, and 8088 memory and stack access. Callers
specify byte significance and both addresses in access order, retaining their
wrapping, segmentation, and state-update boundaries. All **12,197 definitions**
remain structurally unchanged, and all **27 generated modules** remain
byte-identical.

This extraction increases authored CPU source from **8,971 to 8,984 lines**
(**13 more**): CPU-specific definitions add **2**, and shared support adds **11**.
It replaces repeated byte assembly/splitting with explicit word operations;
it does not achieve a net line reduction. Further source reduction remains ahead.
The 16 standalone address/operand readers remain generator probes; CPU execution
now expands those sources into complete bodies. They do not earn separate
migration credit.

## How the percentages are counted

Definition migration is **fully migrated documented opcode forms / total
documented opcode forms × 100**, rounded to one decimal place. A positive result that
would round to zero is shown as **<0.1%**; an incomplete result that would
round to 100% is shown as **>99.9%**. A form counts only when the real CPU uses
its generated instruction body for every documented operand choice, with the
existing behavior and failure boundaries verified. A generated sample used
only in tests does not count. A shared definition may cover several encodings;
each migrated encoding counts under the same rules as the support inventory.

This measures migration of instruction bodies, not effort, code reduction, or
processor completeness. Opcode selection, core execution machinery, and an
explicit address-decoder boundary can remain handwritten. The generated body
must handle every documented operand choice at that boundary; this does not
claim migration of the decoder itself. Reset, external interrupt delivery, cycle timing, and other
processor features are outside the percentage. Test coverage is a separate
measure of how much existing code the tests exercise.

An opcode form is a specific encoding, including its addressing form. For
example, immediate LDA and absolute LDA count separately. Operand values do
not create additional forms. Partly migrated forms earn no credit until all
their documented choices use generated semantics. The support inventory below
continues to describe the behavior of both generated and handwritten bodies.

The denominators count distinct documented encodings in the manufacturer
instruction tables, with register fields expanded where they form part of
the opcode. Mnemonic aliases sharing an encoding count once; undocumented
encodings and instructions belonging to other CPU variants are excluded.

| Model | Documented forms | Counting basis |
| --- | --- | --- |
| Intel 8008 | 250 | [Intel 8008 User's Manual, Basic Instruction Set and Appendix I](https://www.bitsavers.org/components/intel/MCS8/Intel_8008_8-Bit_Parallel_Central_Processing_Unit_Rev1_Apr72.pdf): expand documented selectors and opcode don't-care bits; 58 forms in `00`, and 64 each in `01`, `10`, and `11` |
| Intel 8080 | 244 | [Intel 8080 Assembly Language Programming Manual, Appendix B](https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf): expand the opcode bit patterns, excluding the 12 undocumented byte encodings |
| Motorola 6800 | 197 | [Motorola MC6800 data sheet, tables 3–6](https://vtda.org/docs/computing/Motorola/M6800SystemsReferenceDataSheets_May75.pdf): 140 accumulator/memory + 24 index/stack + 25 jump/branch + 8 condition-code forms |
| MOS 6502 | 151 | [Synertek 6500 Programming Manual, Appendix B](https://syncopate.us/books/Synertek6502ProgrammingManual.html#ap-b): count the documented instruction/addressing forms |
| Motorola 6809 | 268 | [Motorola MC6809–MC6809E Programming Manual, Appendix D](https://www.maddes.net/m6809pm/appendix_d.htm): 221 unprefixed forms + 38 on page 2 + 9 on page 3, counting mnemonic aliases once |
| Zilog Z80 | 698 | [Zilog Z80 CPU User Manual, UM008011-0816](https://www.zilog.com/docs/z80/um0080.pdf): 252 unprefixed + 248 CB + 58 ED + 39 DD + 39 FD + 31 DD CB + 31 FD CB forms |
| Intel 8088 | 291 | [Intel 8086 Family User's Manual, October 1979, table 4-13](https://www.ardent-tool.com/CPU/docs/Intel/808x/manuals/9800722-03_alt.pdf): 226 documented non-prefix first bytes + 65 additional ModR/M opcode-extension forms; audit below |
| Motorola 68000 | 36,029 | [Motorola M68000 Family Programmer's Reference Manual](https://www.nxp.com/docs/en/reference-manual/M68000PRM.pdf): original-68000 operation words with register/addressing selectors expanded and literal operand values collapsed; [family audit](68000/opcode-count.md) |

For the 8008, the six absent encodings are `22`, `2A`, `32`, `38`, `39`,
and `3A`. The documented opcode don't-care bits are expanded: JMP, CAL,
and RET each have eight encodings, and HLT has three (`00`, `01`, `FF`).
Counting all these documented encodings follows the same rule as the other
CPUs; different mnemonic names for one encoding still count once. Immediate
values and address bytes, including their ignored high bits, do not add forms.
The full count includes all 32 I/O forms.

For the 6800, count each instruction/addressing encoding in tables 3–6 on
printed pages 18–21, expanding A/B choices. The total includes interrupt
instructions. Undocumented encodings and
later-family additions are excluded; operand and address bytes do not add forms.

For the 6809, a prefix and following opcode byte identify one form; prefixes
alone do not count. Indexed and register-selection postbytes do not create
additional forms, but an opcode remains partial until all its documented
postbyte choices work.

For the Z80, prefixes and the final opcode identify a form; displacement and
immediate values do not create forms. The DD CB and FD CB counts include only
the documented memory forms. Undocumented SLL, index-half register operations,
ignored-prefix aliases, and alternate encodings absent from the manual are
excluded. The ED count includes `ED 63` and `ED 6B`: the manual explicitly lists
HL among the choices for `LD (nn),dd` and `LD dd,(nn)` (printed pages 108 and 103).
These are different documented encodings from the unprefixed HL transfers,
so both count, giving 698 rather than the 696 obtained by excluding that pair.

For the 8088, start with the 256 first-byte values in table 4-13 (printed
pages 4-27–4-35). Exclude 23 unused bytes (`0F`, `60`–`6F`, `C0`, `C1`, `C8`,
`C9`, `D6`, `F1`) and seven prefixes (`26`, `2E`, `36`, `3E`, `F0`, `F2`, `F3`),
leaving 226. Expand the ModR/M `reg` field where it selects an operation:

| First bytes | Documented operations per byte | Additional forms beyond one per byte |
| --- | --- | --- |
| `80`, `81` | 8 | 14 |
| `82`, `83` | 5: ADD, ADC, SBB, SUB, CMP | 8 |
| `D0`–`D3` | 7 rotations/shifts | 24 |
| `F6`, `F7` | 7 | 12 |
| `FE` | 2: INC, DEC | 1 |
| `FF` | 7 | 6 |
| **Total** | | **65** |

This gives **226 + 65 = 291**. In particular, the October 1979 decoding guide
marks `/1`, `/4`, and `/6` unused for `82` and `83`; it documents the five
arithmetic forms counted here. Register fields within the first opcode byte
are expanded, as on the other CPUs. ModR/M register and effective-address
choices are operands, as are displacements, immediate values, and the external
opcode carried by ESC. They do not add forms; a form remains partial until
all its documented operand choices work. Each ESC first byte `D8`–`DF` counts
once. AAM/AAD's fixed second byte does not add forms.

The 8088 count measures unprefixed forms. Segment overrides, LOCK, and repetition
are modifiers; their support is tracked separately rather than multiplying the
denominator by prefix combinations. Mnemonic aliases count once. Undocumented
encodings and later x86 instructions are excluded, while deferred interrupts
and I/O remain in the total. DIV/IDIV count their arithmetic and divide-error
detection; interrupt delivery remains a separate deferred processor feature.

For the 68000, the operation word contains both register and effective-address
selectors, so they contribute separate forms. Literal operands do not: MOVEQ
immediates, ADDQ/SUBQ and shift counts, branch displacements, and TRAP vectors
are collapsed. Index extension words and MOVEM register masks do not multiply
forms, but each form must support all its documented choices to be complete.
The [count audit](68000/opcode-count.md) gives the permitted address sets and
family arithmetic. MOVE and MOVEA supply 9,726 forms; the six immediate ALU
families supply 900 (six × three sizes × 50 destinations), and MOVEQ supplies
eight. BRA/BSR/Bcc supply 32 (sixteen operations × byte/word displacement),
DBcc supplies 128 (sixteen conditions × eight registers), and RTS supplies one.
ADD/SUB supply 4,816 (two × eight registers × (53 byte sources + 61 word
sources + 61 long sources + three sizes × 42 memory destinations)). CMP supplies
1,400 (eight × (53 + 61 + 61)); ADDA/SUBA/CMPA supply 2,928 (three × two sizes
× eight address registers × 61 sources). AND/OR supply 4,560 (two × three sizes
× eight registers × (53 sources + 42 memory destinations)); EOR supplies 1,200
(three sizes × eight source registers × 50 data-alterable destinations).
The eight MOVEQ forms accept 2,048 operation words; the 32 relative-branch
forms accept 4,096 words. Embedded literal values do not add coverage forms.

## Support shared by the current models

| Area | Implemented scope |
| --- | --- |
| Memory connection | Flat RAM with recorded byte reads and writes: 16 KiB for the 8008, 1 MiB for the 8088, 16 MiB for the 68000, 64 KiB for the other current models |
| Initialization | Explicit caller-supplied registers and flags, copied and validated; no implicit reset |
| Inspection | Detached state snapshots, recursively readonly in TypeScript, without RAM access |
| Stepping | At most one instruction attempt; before/after snapshots, fetched instruction bytes, ordered accesses, and outcome |
| Reset records | Separate before/after snapshots and access list; CPU-specific reset effects |
| Arithmetic and addresses | Results wrap at their modeled widths; 14-bit addresses for the 8008, 16-bit addresses for the other 8-bit cores; the 8088 forms 20-bit physical addresses from segments/offsets; the 68000 preserves 32-bit registers and masks bus addresses to 24 bits |
| Unsupported attempts | Undocumented encodings on the byte CPUs report `reason: "opcode"` with unchanged CPU state and RAM; the 68000 delivers illegal/emulator-line and address-error exceptions |
| Lesson restart | Fresh CPU and RAM from the example factory |

All eight currently omit cycle counts, complete bus-cycle modeling, electrical
signals, memory-mapped devices, disassembly, and an execution UI. External
interrupt delivery is implemented on all eight with CPU-specific policies;
the 8008 accepts each explicit offer without an interrupt-enable flag.

The following tables exhaustively list complete and partial opcode forms.
Unlisted forms remain unsupported. Opcodes and addresses are hexadecimal;
instruction lengths are in bytes.

## 8008

[Source](../../src/components/cpus/8008.ts) ·
[Model contract](8008/model.md) ·
[Arithmetic example](8008/examples/arithmetic.md) ·
[Example definition](../../src/machines/8008/example.machine)

[Stack specification](8008/examples/stack.md) ·
[Stack definition](../../src/machines/8008/stack-example.machine)

[Transfer specification](8008/examples/transfers.md) ·
[Transfer definition](../../src/machines/8008/transfers-example.machine)

[ALU specification](8008/examples/alu.md) ·
[ALU definition](../../src/machines/8008/alu-example.machine)

[Control-flow specification](8008/examples/control-flow.md) ·
[Control-flow definition](../../src/machines/8008/control-flow-example.machine)

[Carry and restart specification](8008/examples/carry.md) ·
[Carry definition](../../src/machines/8008/carry-example.machine)

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `00` | HLT | Implied | 1 | Advance PC and stop; preserve flags |
| `01` | HLT | Implied | 1 | Second documented low-page HLT encoding |
| `02/0A/12/1A` | RLC / RRC / RAL / RAR | Accumulator | 1 | Circular or through-carry rotation; replace C and preserve S/Z/P |
| `03/0B/13/1B/23/2B/33/3B` | RFc / RTc | Conditional return | 1 | Test C/Z/S/P for false or true; advance the outgoing PC, then select the previous slot only when taken |
| `04/0C/14/1C/24/2C/34/3C` | ADI / ACI / SUI / SBI / NDI / XRI / ORI / CPI | Immediate | 2 | All eight ALU operations with a fetched operand; [flag rules](8008/model.md#arithmetic-and-logic) match register/memory forms |
| `05/0D/15/1D/25/2D/35/3D` | RST | Encoded vector | 1 | Call `0000/0008/0010/0018/0020/0028/0030/0038`, saving the address after the opcode in the circular stack |
| `06/0E/16/1E/26/2E/36` | LrI n | Immediate | 2 | Load A/B/C/D/E/H/L; preserve flags |
| `07` | RET | Implied | 1 | Select the preceding address slot; preserve flags |
| `08/10/18/20/28/30` | INr | Register B/C/D/E/H/L | 1 | Increment the selected byte; set S/Z/P and preserve C |
| `09/11/19/21/29/31` | DCr | Register B/C/D/E/H/L | 1 | Decrement the selected byte; set S/Z/P and preserve C |
| `0F` | RET | Implied | 1 | Documented RET alias |
| `17` | RET | Implied | 1 | Documented RET alias |
| `1F` | RET | Implied | 1 | Documented RET alias |
| `27` | RET | Implied | 1 | Documented RET alias |
| `2F` | RET | Implied | 1 | Documented RET alias |
| `37` | RET | Implied | 1 | Documented RET alias |
| `3E` | LMI n | Immediate byte to indirect memory | 2 | Fetch the byte, then write RAM at the low 14 bits of H:L; preserve flags |
| `3F` | RET | Implied | 1 | Documented RET alias |
| `40/48/50/58/60/68/70/78` | JFc / JTc addr | Conditional absolute | 3 | Fetch both address bytes on either path; replace PC only when the selected flag matches |
| `42/4A/52/5A/62/6A/72/7A` | CFc / CTc addr | Conditional absolute call | 3 | Fetch both address bytes on either path; preserve the fall-through PC and select the next slot only when taken |
| `44` | JMP addr | Absolute | 3 | Set PC to the 14-bit destination; preserve flags |
| `46` | CAL addr | Absolute | 3 | Save the return PC in its slot, select the next slot, and jump; preserve flags |
| `4C` | JMP addr | Absolute | 3 | Documented JMP alias |
| `4E` | CAL addr | Absolute | 3 | Documented CAL alias |
| `54` | JMP addr | Absolute | 3 | Documented JMP alias |
| `56` | CAL addr | Absolute | 3 | Documented CAL alias |
| `5C` | JMP addr | Absolute | 3 | Documented JMP alias |
| `5E` | CAL addr | Absolute | 3 | Documented CAL alias |
| `64` | JMP addr | Absolute | 3 | Documented JMP alias |
| `66` | CAL addr | Absolute | 3 | Documented CAL alias |
| `6C` | JMP addr | Absolute | 3 | Documented JMP alias |
| `6E` | CAL addr | Absolute | 3 | Documented CAL alias |
| `74` | JMP addr | Absolute | 3 | Documented JMP alias |
| `76` | CAL addr | Absolute | 3 | Documented CAL alias |
| `7C` | JMP addr | Absolute | 3 | Documented JMP alias |
| `7E` | CAL addr | Absolute | 3 | Documented CAL alias |
| `41`, `43`, …, `4F` | INP | Encoded port `00`–`07` | 1 | Read one byte into A; preserve flags |
| `51`, `53`, …, `7F` | OUT | Encoded port `08`–`1F` | 1 | Send A to one output port; preserve registers and flags |
| `80`–`87` | ADr / ADM | Register or indirect memory | 1 | Add the source to A, ignoring incoming C; set S/Z/P and carry out |
| `88`–`8F` | ACr / ACM | Register or indirect memory | 1 | Add the source and incoming C to A; set S/Z/P and carry out |
| `90`–`97` | SUr / SUM | Register or indirect memory | 1 | Subtract the source from A, ignoring incoming C; set S/Z/P and borrow |
| `98`–`9F` | SBr / SBM | Register or indirect memory | 1 | Subtract the source and incoming borrow from A; set S/Z/P and borrow |
| `A0`–`A7` | NDr / NDM | Register or indirect memory | 1 | AND with A; set S/Z/P and clear C |
| `A8`–`AF` | XRr / XRM | Register or indirect memory | 1 | XOR with A; set S/Z/P and clear C |
| `B0`–`B7` | ORr / ORM | Register or indirect memory | 1 | OR with A; set S/Z/P and clear C |
| `B8`–`BF` | CPr / CPM | Register or indirect memory | 1 | Set S/Z/P/C from A − source, ignoring incoming C; retain A |
| `C0`–`FE` | Lr1r2 / LrM / LMr | Register or indirect memory | 1 | All 49 register transfers, seven memory reads, and seven memory writes; preserve flags |
| `FF` | HLT | Implied | 1 | HLT occupies the M,M transfer slot |

These families contribute **8 immediate loads + 63 transfers + 3 HLT encodings +
48 jump/call/return forms + 72 ALU forms + 12 register adjustments + 4 rotations +
8 RST forms + 32 port forms = 250** complete forms. The jump/call/return total includes
24 unconditional encodings and 24 conditional forms. The eight INP and 24 OUT
encodings complete the documented opcode inventory; only six undefined bytes
remain unsupported.
External interrupt delivery is implemented separately from opcode coverage;
timing remains deferred.

The 8008 now meets the [CPU-only checkpoint](../../ROADMAP.md#cpu-only-checkpoint).
Its control-flow example combines loads, arithmetic, logic, conditional
branches, calls and returns, and a RAM store in an independently checked
bounded run. The stack example and CPU tests additionally exercise nested
calls and the circular address registers.

| Area | Implemented scope |
| --- | --- |
| Stored state | A/B/C/D/E/H/L, S/Z/P/C, eight 14-bit address registers, selector 0–7, and halt state |
| Register views | PC selects an address-stack slot; HL exposes the raw H:L pair |
| Memory | Exactly 16 KiB RAM; instruction fetches wrap at 14 bits; H bits 7–6 are ignored for memory addressing while H remains a full byte in register transfers |
| Loads and transfers | All immediate and register/memory byte loads preserve flags; H/L memory destinations read through the original pair; stores do not read their destination |
| Arithmetic and logic | All eight accumulator operations across seven register sources, indirect memory, and immediate bytes; shared operation selector, explicit carry/borrow, logical C clearing, and compare preserving A |
| Adjustments and rotations | INr/DCr on B/C/D/E/H/L set S/Z/P and preserve C; all four accumulator rotations replace only C |
| Control flow | Unconditional and all eight conditional jumps, calls, and returns; shared C/Z/S/P selector with explicit true/false choices; untaken jumps/calls still fetch their address bytes |
| Address stack | Eight circular address registers: CAL/RST select the next slot, RET selects the preceding slot; ordinary RST saves the PC after its opcode, supplied RST saves the interrupted PC; overwrite on overflow, retain outgoing PC after RET, no RAM stack |
| Reset | Model settled power-on clearing: zero data/address registers, select slot zero, stay stopped, preserve flags and RAM under the documented policy |
| Stopping | All three documented HLT encodings report once; already halted steps have no instruction or accesses |
| Port I/O | Optional shared byte-port connection; eight native inputs and 24 native outputs; one transfer after the opcode read; live device values, explicit connection errors, and guarded execution boundaries |
| External interrupts | Explicit offers release STOPPED, including after reset; supplied instruction bytes do not advance PC; ordinary handlers retain native stack, flag, memory, and port behavior; separate acknowledgement records, no internal mask or queue |
| Remaining scope | Memory-mapped devices and timing |

Verification: [CPU tests](../../tests/components/cpus/8008.test.ts),
[arithmetic example tests](../../tests/machines/8008/example.test.ts),
[stack example tests](../../tests/machines/8008/stack-example.test.ts),
[transfer example tests](../../tests/machines/8008/transfers-example.test.ts),
[ALU example tests](../../tests/machines/8008/alu-example.test.ts),
[control-flow example tests](../../tests/machines/8008/control-flow-example.test.ts),
[carry example tests](../../tests/machines/8008/carry-example.test.ts),
[interrupt program test](../../tests/machines/8008/interrupts.test.ts), and
[public type checks](../../tests/types/8008.ts). Checks cover every immediate ALU
operand pair and both carry inputs, all load bytes and flag patterns, arithmetic
boundaries, every H:L combination and PC, all selectors, and every unsupported opcode. Complete
records and actual RAM calls verify wrapping, overlapping/unchanged-value
stores, HALT, reset, and retained snapshots. Control-flow checks cover every
alias, encoded destination, selector, and flag pattern; wrapped fetches,
overflowing calls, and unbalanced returns. Examples check whole RAM images,
complete traces, bounded running, caller completion, and restart.
Port checks exercise every encoding and byte, direction and native selector,
flags and active slots, wrapping, current device state, failure effects,
reentrancy, and detached records. A wrapped-call program combines ports with
arithmetic, return, halt, bounded running, and snapshot restoration.
Interrupt checks cover supplied bytes and native calls/returns, conditions,
memory/port ordering, startup, halt release/reentry, failures, reentrancy, and
detached records. A complete startup/service/resume program preserves its trace
across snapshot reconstruction.
Parser and generator checks cover the smaller RAM size and explicit address list.
The load matrix checks every encoding, byte, and flag pattern, including
self-transfers, all PC slots, and HLT's lack of a data access. LAM and LMA
each check every H:L pair. Additional cases check all four address aliases,
H/L destination changes, LMI's wrapped and overlapping fetch/write sequence,
and current RAM. The transfer example verifies its fourteen-step trace,
whole memory image, and resumption from a snapshot.
All 72 ALU encodings also check every source byte and incoming flag pattern at
accumulator boundaries, including A as its own source. Independent decimal
arithmetic, logical truth tables, and digit counts supply expected results
and flags. Memory ALU cases check H's four address aliases, code overlaps,
and read-only accesses. The ALU example checks carry/borrow propagation, bit
operations, comparison, five output bytes, and resumption with a pending borrow.
Conditional control-flow checks cover all 24 encodings, flag combinations,
stack slots, taken/untaken paths, address aliases and wrapping, unchanged
inactive slots, and current flags and address bytes. The control-flow example
checks its 46-step trace, skipped failure path, single output byte, and
resumption between two conditional returns.
Adjustments and rotations check every byte and incoming flag pattern. RST
checks every vector from every PC, all slots/flags, one-byte returns, and
circular-stack overflow. The carry example checks its 20-step trace, both
return paths, a pointer crossing a page boundary, and resumption between bytes.

## 8080

[Source](../../src/components/cpus/8080.ts) ·
[Model contract](8080/model.md) ·
[Arithmetic example](8080/examples/arithmetic.md) ·
[Example definition](../../src/machines/8080/example.machine)

[Register-pair specification](8080/examples/register-pairs.md) ·
[Register-pair definition](../../src/machines/8080/register-pairs-example.machine)

[Stack specification](8080/examples/stack.md) ·
[Stack definition](../../src/machines/8080/stack-example.machine)

[PSW specification](8080/examples/psw.md) ·
[PSW definition](../../src/machines/8080/psw-example.machine)

[Addressing specification](8080/examples/addressing.md) ·
[Addressing definition](../../src/machines/8080/addressing-example.machine)

[Control-flow specification](8080/examples/control-flow.md) ·
[Control-flow definition](../../src/machines/8080/control-flow-example.machine)

[Transfers specification](8080/examples/transfers.md) ·
[Transfers definition](../../src/machines/8080/transfers-example.machine)

[ALU specification](8080/examples/alu.md) ·
[ALU definition](../../src/machines/8080/alu-example.machine)

[Decimal specification](8080/examples/decimal.md) ·
[Decimal definition](../../src/machines/8080/decimal-example.machine)

[Counted-loop specification](8080/examples/counted-loop.md) ·
[Counted-loop definition](../../src/machines/8080/counted-loop-example.machine)

[Rotates specification](8080/examples/rotates.md) ·
[Rotates definition](../../src/machines/8080/rotates-example.machine)

The MOV row groups 63 forms: all B/C/D/E/H/L/M/A source and destination
combinations except M,M, whose encoding is HLT. M means memory at current HL.
The two three-bit selector fields use the order B, C, D, E, H, L, M, A.
Each register/memory ALU row groups eight forms with the same source-selector
order. Their immediate counterparts are listed separately. These accumulator ALU forms
update S/Z/AC/P/CY according to the
[8080 flag contract](8080/model.md#accumulator-arithmetic-and-logic). INR/DCR,
DCX, and DAD have distinct [flag and access rules](8080/model.md#increment-decrement-and-word-arithmetic).

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `00` | `NOP` | Implied | 1 | Advance PC; preserve all other state; fetch only the opcode |
| `01` | `LXI B,nn` | Immediate | 3 | Load B:C; low byte then high; preserve flags |
| `02` | `STAX B` | Register indirect through BC | 1 | Store A; preserve pair and flags |
| `03` | `INX B` | Register pair | 1 | Increment B:C with 16-bit wrapping; preserve flags |
| `04` | `INR B` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `05` | `DCR B` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `06` | `MVI B,n` | Immediate | 2 | Load B; preserve flags |
| `07` | `RLC` | Implied | 1 | Rotate A left circularly; update only CY |
| `09` | `DAD B` | Register pair | 1 | Add to HL with 16-bit wrapping; update only CY |
| `0A` | `LDAX B` | Register indirect through BC | 1 | Load A; preserve pair and flags |
| `0B` | `DCX B` | Register pair | 1 | Decrement with 16-bit wrapping; preserve flags |
| `0C` | `INR C` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `0D` | `DCR C` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `0E` | `MVI C,n` | Immediate | 2 | Load C; preserve flags |
| `0F` | `RRC` | Implied | 1 | Rotate A right circularly; update only CY |
| `11` | `LXI D,nn` | Immediate | 3 | Load D:E; low byte then high; preserve flags |
| `12` | `STAX D` | Register indirect through DE | 1 | Store A; preserve pair and flags |
| `13` | `INX D` | Register pair | 1 | Increment D:E with 16-bit wrapping; preserve flags |
| `14` | `INR D` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `15` | `DCR D` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `16` | `MVI D,n` | Immediate | 2 | Load D; preserve flags |
| `17` | `RAL` | Implied | 1 | Rotate A left through carry; update only CY |
| `19` | `DAD D` | Register pair | 1 | Add to HL with 16-bit wrapping; update only CY |
| `1A` | `LDAX D` | Register indirect through DE | 1 | Load A; preserve pair and flags |
| `1B` | `DCX D` | Register pair | 1 | Decrement with 16-bit wrapping; preserve flags |
| `1C` | `INR E` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `1D` | `DCR E` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `1E` | `MVI E,n` | Immediate | 2 | Load E; preserve flags |
| `1F` | `RAR` | Implied | 1 | Rotate A right through carry; update only CY |
| `21` | `LXI H,nn` | Immediate | 3 | Load H:L; low byte then high; preserve flags |
| `22` | `SHLD addr` | Direct memory address | 3 | Store L then H at consecutive wrapped addresses; preserve flags |
| `23` | `INX H` | Register pair | 1 | Increment H:L with 16-bit wrapping; preserve flags |
| `24` | `INR H` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `25` | `DCR H` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `26` | `MVI H,n` | Immediate | 2 | Load H; preserve flags |
| `27` | `DAA` | Implied | 1 | Decimal-adjust A using incoming AC/CY; replace S/Z/AC/P/CY |
| `29` | `DAD H` | Register pair | 1 | Add to HL with 16-bit wrapping; update only CY |
| `2A` | `LHLD addr` | Direct memory address | 3 | Load L then H from consecutive wrapped addresses; preserve flags |
| `2B` | `DCX H` | Register pair | 1 | Decrement with 16-bit wrapping; preserve flags |
| `2C` | `INR L` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `2D` | `DCR L` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `2E` | `MVI L,n` | Immediate | 2 | Load L; preserve flags |
| `2F` | `CMA` | Implied | 1 | Complement A; preserve every flag |
| `31` | `LXI SP,nn` | Immediate | 3 | Load SP; low byte then high; preserve flags |
| `32` | `STA addr` | Direct memory address | 3 | Store A; address bytes low then high |
| `33` | `INX SP` | Register pair | 1 | Increment SP with 16-bit wrapping; preserve flags |
| `34` | `INR M` | Memory through HL | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `35` | `DCR M` | Memory through HL | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `36` | `MVI M,n` | Immediate | 2 | Load memory at HL; preserve flags |
| `37` | `STC` | Implied | 1 | Set CY; preserve A and other flags |
| `39` | `DAD SP` | Register pair | 1 | Add to HL with 16-bit wrapping; update only CY |
| `3A` | `LDA addr` | Direct memory address | 3 | Load A; address bytes low then high; preserve flags |
| `3B` | `DCX SP` | Register pair | 1 | Decrement with 16-bit wrapping; preserve flags |
| `3C` | `INR A` | Register | 1 | Increment byte; update S/Z/AC/P; preserve CY |
| `3D` | `DCR A` | Register | 1 | Decrement byte; update S/Z/AC/P; preserve CY |
| `3E` | `MVI A,n` | Immediate | 2 | Load A; preserve flags |
| `3F` | `CMC` | Implied | 1 | Complement CY; preserve A and other flags |
| `40–75`, `77–7F` | `MOV dst,src` | Register or indirect through HL | 1 | All 63 forms; read source before writing destination; preserve flags |
| `76` | `HLT` | Implied | 1 | Advance PC and enter halted state |
| `80–87` | `ADD r` | Register or memory through HL | 1 | Add to A without incoming carry |
| `88–8F` | `ADC r` | Register or memory through HL | 1 | Add to A with incoming carry |
| `90–97` | `SUB r` | Register or memory through HL | 1 | Subtract from A without incoming borrow |
| `98–9F` | `SBB r` | Register or memory through HL | 1 | Subtract from A with incoming borrow |
| `A0–A7` | `ANA r` | Register or memory through HL | 1 | AND with A; clear CY; AC is bit 3 of A OR operand |
| `A8–AF` | `XRA r` | Register or memory through HL | 1 | XOR with A; clear AC and CY |
| `B0–B7` | `ORA r` | Register or memory through HL | 1 | OR with A; clear AC and CY |
| `B8–BF` | `CMP r` | Register or memory through HL | 1 | Subtraction flags without incoming borrow; preserve A |
| `C0` | `RNZ` | Stack | 1 | Return if Z = 0 |
| `C1` | `POP B` | Stack | 1 | Read low then high into B:C; increment SP by 2; preserve flags |
| `C2` | `JNZ addr` | Absolute target | 3 | Jump if Z = 0 |
| `C3` | `JMP addr` | Absolute target | 3 | Replace PC with target |
| `C4` | `CNZ addr` | Absolute target / stack | 3 | Call if Z = 0 |
| `C5` | `PUSH B` | Stack | 1 | Write B:C high then low; decrement SP by 2; preserve flags |
| `C6` | `ADI n` | Immediate | 2 | Add to A without incoming carry |
| `C7` | `RST 0` | Encoded vector / stack | 1 | Push following PC; jump to `0000`; preserve interrupt enable |
| `C8` | `RZ` | Stack | 1 | Return if Z = 1 |
| `C9` | `RET` | Stack | 1 | Pop PC low then high |
| `CA` | `JZ addr` | Absolute target | 3 | Jump if Z = 1 |
| `CC` | `CZ addr` | Absolute target / stack | 3 | Call if Z = 1 |
| `CD` | `CALL addr` | Absolute target / stack | 3 | Push following PC, then jump to target |
| `CE` | `ACI n` | Immediate | 2 | Add to A with incoming carry |
| `CF` | `RST 1` | Encoded vector / stack | 1 | Push following PC; jump to `0008`; preserve interrupt enable |
| `D0` | `RNC` | Stack | 1 | Return if CY = 0 |
| `D1` | `POP D` | Stack | 1 | Read low then high into D:E; increment SP by 2; preserve flags |
| `D2` | `JNC addr` | Absolute target | 3 | Jump if CY = 0 |
| `D3` | `OUT n` | Immediate port | 2 | Write A to the selected byte port; preserve flags |
| `D4` | `CNC addr` | Absolute target / stack | 3 | Call if CY = 0 |
| `D5` | `PUSH D` | Stack | 1 | Write D:E high then low; decrement SP by 2; preserve flags |
| `D6` | `SUI n` | Immediate | 2 | Subtract from A without incoming borrow |
| `D7` | `RST 2` | Encoded vector / stack | 1 | Push following PC; jump to `0010`; preserve interrupt enable |
| `D8` | `RC` | Stack | 1 | Return if CY = 1 |
| `DA` | `JC addr` | Absolute target | 3 | Jump if CY = 1 |
| `DB` | `IN n` | Immediate port | 2 | Read the selected byte port into A; preserve flags |
| `DC` | `CC addr` | Absolute target / stack | 3 | Call if CY = 1 |
| `DE` | `SBI n` | Immediate | 2 | Subtract from A with incoming borrow |
| `DF` | `RST 3` | Encoded vector / stack | 1 | Push following PC; jump to `0018`; preserve interrupt enable |
| `E0` | `RPO` | Stack | 1 | Return if P = 0 |
| `E1` | `POP H` | Stack | 1 | Read low then high into H:L; increment SP by 2; preserve flags |
| `E2` | `JPO addr` | Absolute target | 3 | Jump if P = 0 |
| `E3` | `XTHL` | Stack | 1 | Exchange HL with the word at SP; preserve SP and flags |
| `E4` | `CPO addr` | Absolute target / stack | 3 | Call if P = 0 |
| `E5` | `PUSH H` | Stack | 1 | Write H:L high then low; decrement SP by 2; preserve flags |
| `E6` | `ANI n` | Immediate | 2 | AND with A; clear CY; AC is bit 3 of A OR operand |
| `E7` | `RST 4` | Encoded vector / stack | 1 | Push following PC; jump to `0020`; preserve interrupt enable |
| `E8` | `RPE` | Stack | 1 | Return if P = 1 |
| `E9` | `PCHL` | Register indirect through HL | 1 | Replace PC with current HL; no data read |
| `EA` | `JPE addr` | Absolute target | 3 | Jump if P = 1 |
| `EB` | `XCHG` | Register pairs | 1 | Exchange DE and HL; preserve flags |
| `EC` | `CPE addr` | Absolute target / stack | 3 | Call if P = 1 |
| `EE` | `XRI n` | Immediate | 2 | XOR with A; clear AC and CY |
| `EF` | `RST 5` | Encoded vector / stack | 1 | Push following PC; jump to `0028`; preserve interrupt enable |
| `F0` | `RP` | Stack | 1 | Return if S = 0 |
| `F1` | `POP PSW` | Stack | 1 | Read flags then A; ignore reserved flag bits; increment SP by 2 |
| `F2` | `JP addr` | Absolute target | 3 | Jump if S = 0 |
| `F3` | `DI` | Implied | 1 | Clear interrupt enable and any EI deferral; preserve flags |
| `F4` | `CP addr` | Absolute target / stack | 3 | Call if S = 0 |
| `F5` | `PUSH PSW` | Stack | 1 | Write A then packed flags; decrement SP by 2; preserve A and flags |
| `F6` | `ORI n` | Immediate | 2 | OR with A; clear AC and CY |
| `F7` | `RST 6` | Encoded vector / stack | 1 | Push following PC; jump to `0030`; preserve interrupt enable |
| `F8` | `RM` | Stack | 1 | Return if S = 1 |
| `F9` | `SPHL` | Register pair | 1 | Copy HL to SP; preserve HL and flags |
| `FA` | `JM addr` | Absolute target | 3 | Jump if S = 1 |
| `FB` | `EI` | Implied | 1 | Set interrupt enable; defer acceptance through the following instruction; preserve flags |
| `FC` | `CM addr` | Absolute target / stack | 3 | Call if S = 1 |
| `FE` | `CPI n` | Immediate | 2 | Subtraction flags without incoming borrow; preserve A |
| `FF` | `RST 7` | Encoded vector / stack | 1 | Push following PC; jump to `0038`; preserve interrupt enable |

| Area | Current coverage |
| --- | --- |
| Stored registers | A, B, C, D, E, H, L, PC, SP |
| Stored flags/control | S, Z, AC, P, CY; interrupt-enable, interrupt-deferral, and halted state |
| Register relationships | Snapshots derive BC, DE, and HL from stored bytes; byte transfers, INR/DCR, and pair operations update those views; XCHG exchanges DE/HL and SPHL copies HL to SP |
| Memory addressing | MOV/MVI, INR/DCR, and accumulator ALU operands through current HL; LDAX/STAX through BC or DE; LDA/STA and LHLD/SHLD with an explicit 16-bit address |
| Stack | PUSH/POP for BC, DE, HL, and PSW plus control-flow return addresses, using a descending RAM stack and wrapping 16-bit SP; PSW packs/restores A and five flags with fixed reserved bits on PUSH; XTHL exchanges HL with stack memory without moving SP |
| Control flow | JMP, CALL, RET and all eight conditions for each; PCHL and RST 0–7; preserve arithmetic flags and interrupt enable |
| Reset | Set PC to `0000`, clear interrupt-enable, deferral, and halted; preserve data registers, SP, flags, and RAM; no memory accesses |
| Stopping | HLT is implemented; subsequent steps return `halted` with no instruction or memory access; an accepted external interrupt releases HALT |
| Accumulator arithmetic/logic | ADD/ADC, SUB/SBB, ANA/XRA/ORA, CMP and all immediate counterparts; 8-bit results, carry/borrow propagation, comparison without changing A, and 8080 auxiliary carry rules |
| Decimal adjustment | DAA corrects A using incoming AC/CY; updates result flags and AC while retaining or setting CY; no decimal-mode latch |
| Byte and word arithmetic | INR/DCR update byte results and S/Z/AC/P while preserving CY; INX/DCX wrap pairs and SP without changing flags; DAD adds to HL and updates only CY |
| Rotates and carry | RLC/RRC rotate within A; RAL/RAR rotate through CY; all preserve S/Z/AC/P. CMA complements A without changing flags; STC/CMC change only CY |
| Port I/O | IN/OUT through an explicit byte-port connection; ordered port records; missing connections and invalid input bytes throw host errors |
| Interrupt controls and delivery | DI/EI with snapshot-preserved one-instruction EI deferral; explicit boundary offers, acknowledgement-supplied instructions, and HALT release; caller-owned request scheduling; no cycle-level sampling |

Verification: [CPU tests](../../tests/components/cpus/8080.test.ts),
[arithmetic example tests](../../tests/machines/8080/example.test.ts),
[register-pair example tests](../../tests/machines/8080/register-pairs-example.test.ts),
[stack example tests](../../tests/machines/8080/stack-example.test.ts),
[PSW example tests](../../tests/machines/8080/psw-example.test.ts),
[addressing example tests](../../tests/machines/8080/addressing-example.test.ts),
[control-flow example tests](../../tests/machines/8080/control-flow-example.test.ts),
[transfers example tests](../../tests/machines/8080/transfers-example.test.ts),
[ALU example tests](../../tests/machines/8080/alu-example.test.ts),
[decimal example tests](../../tests/machines/8080/decimal-example.test.ts),
[counted-loop example tests](../../tests/machines/8080/counted-loop-example.test.ts),
[port-output example tests](../../tests/machines/8080/output-example.test.ts),
[polling-echo example tests](../../tests/machines/8080/echo-example.test.ts),
[rotates example tests](../../tests/machines/8080/rotates-example.test.ts), and
[public type checks](../../tests/types/8080.ts). ALU checks cover every byte operand
pair and both incoming carry values for all eight operations, using independent
bit-by-bit arithmetic and logic references. Other checks cover exact accesses,
wrapping, self-overwriting stores, halt/reset behavior, rejection of every
unimplemented opcode, input validation, and detached records.
The [port-output example](8080/examples/output.md) sends the same six bytes
as the 68000 through the shared byte-output device. Checks cover all 33
instruction records, port routing, machine versus CPU reset, host failures,
and snapshot-based resumption without replaying output.
The [echo example](8080/examples/echo.md) polls input status, consumes one byte,
and echoes it through the shared output device, stopping after newline.
Tests distinguish pending input from data captured in A across pauses and resets.
LXI/INX checks cover all pair and SP forms, derived views, byte carry and
16-bit wrapping, flag preservation, operand order, and successive operations.
PUSH/POP checks cover all three pairs, stack-access order, SP and PC wrapping,
nested operations, program overlap, current RAM reads, and retained stack data.
Memory MOV checks cover HL addressing, flag preservation, PC wrapping, exact
data accesses, instruction-byte overlap, current RAM, and successive operations
across page and address-space boundaries.
Control-flow checks cover all 32 flag combinations and both interrupt-enable
values for every condition, all RST vectors, taken/untaken accesses, PC/SP
wrapping, code/stack overlap, nested CALL/RST/RET, current RAM and HL, and
retained records. The loop-and-subroutine example checks complete records,
final RAM, and resumption after a bounded run.
Transfer checks cover every MOV combination and every MVI destination/byte,
self-moves, register/pair views, current HL/BC/DE and RAM, flags and control
preservation, wrapped operand/data addresses, code overlap, ordered accesses,
and unchanged-value writes. The transfers example checks all records and the
full memory image, including different successive writes to one address.
ALU encoding checks cover all register/memory and immediate forms, all 32 flag
combinations, both interrupt-enable values, accumulator aliases, comparison
preservation, wrapped PC, memory/code overlap, and current HL/RAM across
successive operations. Literal regressions pin down subtraction and AND auxiliary
carry. The combined example checks complete records, two-byte carry/borrow
propagation, comparison-driven branching, final RAM, and bounded resumption.
INR/DCR checks cover all byte values, all 32 initial flag combinations, and
both interrupt-enable values for every destination, plus exact read/write
ordering, self-modifying code, current HL/RAM, and literal flag regressions.
DCX checks cover every word value for each pair and SP. DAD checks cover all
sources and flag combinations at arithmetic boundaries, every HL value with
BC = 0000/0001/FFFF, and every DAD H input. Independent byte additions supply
word-result expectations. Successive operations verify current pair values and
retained records; the counted loop checks all records, final RAM, and resumption
after address wrapping.
Rotate/CMA/STC/CMC checks cover every accumulator value, all 32 flag combinations,
and both interrupt-enable values, using bit-string rotations and literal
regressions as independent expectations. They verify flag preservation, wrapped
PC, exact opcode reads, and current A/CY across successive operations. The
rotates example checks a word rotated through carry and restored, complete
records, final RAM, resumption between bytes, reset, and restart.
PSW checks independently cover every A/flag combination on PUSH and every
saved word on POP with both interrupt-enable values, including reserved bits,
wrapped PC/SP, overlapping opcode/data, mixed pair/PSW stacks, current RAM,
fixed-bit reconstruction, and retained records. NOP checks all flag combinations,
control preservation, wrapped PC, and exactly one opcode read. The PSW example
checks saved/restored state, use of restored carry, final RAM, and resumption
after a NOP step.
DAA checks cover every accumulator value and all 32 incoming flag combinations
with both interrupt-enable values, ordinary and wrapped PC, exact opcode reads,
and preserved unrelated state. Independent digit-wise correction and literal
regressions check all result flags, incoming carry retention, and non-BCD states.
ADI/ACI followed by DAA match decimal arithmetic for all two-digit operand pairs
and incoming carries. Successive adjustments retain independent records; the
decimal example checks carry propagation between bytes, complete records,
final RAM, resumption before adjustment, reset, and restart.

## 6800

[Source](../../src/components/cpus/6800.ts) ·
[Model contract](6800/model.md) ·
[Arithmetic example](6800/examples/arithmetic.md) ·
[Example definition](../../src/machines/6800/example.machine)

[Counted-loop specification](6800/examples/counted-loop.md) ·
[Counted-loop definition](../../src/machines/6800/counted-loop-example.machine)

[Stack specification](6800/examples/stack.md) ·
[Stack definition](../../src/machines/6800/stack-example.machine)

[Logic specification](6800/examples/logic.md) ·
[Logic definition](../../src/machines/6800/logic-example.machine)

[Addressing/carry specification](6800/examples/addressing.md) ·
[Addressing/carry definition](../../src/machines/6800/addressing-example.machine)

[Word-transformation specification](6800/examples/word-transform.md) ·
[Word-transformation definition](../../src/machines/6800/word-transform-example.machine)

[Decimal and stack-inspection specification](6800/examples/decimal.md) ·
[Decimal definition](../../src/machines/6800/decimal-example.machine)

**197 of 197 documented forms are complete (100%).** The accumulator families
below contribute 86 forms: ten byte-read operations for both A/B across four
addressing modes, plus three stores for each accumulator. Unary operations
contribute 44 forms, word transfers and CPX contribute 18, and the final table
contains 15 short branches plus 34 other forms, including CLI, SEI, WAI, SWI,
and RTI. Explicit IRQ/NMI delivery supports native frames and vectors, masked
offers, and WAI wake-up. The 6800 has no separate port-I/O opcodes; mapped
devices, external HALT, look-ahead, and cycle timing remain outside the model.

All documented forms of LDAA/LDAB, STAA/STAB, ADDA/ADDB, ADCA/ADCB,
SUBA/SUBB, SBCA/SBCB, CMPA/CMPB, ANDA/ANDB, BITA/BITB, EORA/EORB, and
ORAA/ORAB are implemented. Direct operands address page zero; indexed operands
add an unsigned byte to X and wrap at 16 bits. Extended addresses are high byte
first. A dash means there is no documented form on the original 6800.

| Instruction | Immediate | Direct | Indexed | Extended |
| --- | --- | --- | --- | --- |
| Length | 2 | 2 | 2 | 3 |
| SUBA | `80` | `90` | `A0` | `B0` |
| SUBB | `C0` | `D0` | `E0` | `F0` |
| CMPA | `81` | `91` | `A1` | `B1` |
| CMPB | `C1` | `D1` | `E1` | `F1` |
| SBCA | `82` | `92` | `A2` | `B2` |
| SBCB | `C2` | `D2` | `E2` | `F2` |
| ANDA | `84` | `94` | `A4` | `B4` |
| ANDB | `C4` | `D4` | `E4` | `F4` |
| BITA | `85` | `95` | `A5` | `B5` |
| BITB | `C5` | `D5` | `E5` | `F5` |
| LDAA | `86` | `96` | `A6` | `B6` |
| LDAB | `C6` | `D6` | `E6` | `F6` |
| STAA | — | `97` | `A7` | `B7` |
| STAB | — | `D7` | `E7` | `F7` |
| EORA | `88` | `98` | `A8` | `B8` |
| EORB | `C8` | `D8` | `E8` | `F8` |
| ADCA | `89` | `99` | `A9` | `B9` |
| ADCB | `C9` | `D9` | `E9` | `F9` |
| ORAA | `8A` | `9A` | `AA` | `BA` |
| ORAB | `CA` | `DA` | `EA` | `FA` |
| ADDA | `8B` | `9B` | `AB` | `BB` |
| ADDB | `CB` | `DB` | `EB` | `FB` |

Unary encodings use **`01 tt oooo`**: `tt=00/01/10/11` selects A/B/indexed/extended;
`oooo` selects the operation. Accumulator forms are one byte, indexed two,
extended three. The original 6800 has no direct-page unary forms. All preserve
H/I, and memory forms preserve both accumulators and X/SP.

| Operation | A | B | Indexed | Extended | Flag effects |
| --- | --- | --- | --- | --- | --- |
| NEG | `40` | `50` | `60` | `70` | N/Z/V/C from subtraction from zero |
| COM | `43` | `53` | `63` | `73` | N/Z; V=0, C=1 |
| LSR | `44` | `54` | `64` | `74` | N=0; Z/C from shift, V=C |
| ROR | `46` | `56` | `66` | `76` | N/Z/C from rotation through C; V=N XOR C |
| ASR | `47` | `57` | `67` | `77` | Preserve sign; N/Z/C from shift, V=N XOR C |
| ASL | `48` | `58` | `68` | `78` | N/Z/C from shift; V=N XOR C |
| ROL | `49` | `59` | `69` | `79` | N/Z/C from rotation through C; V=N XOR C |
| DEC | `4A` | `5A` | `6A` | `7A` | N/Z/V; preserve C |
| INC | `4C` | `5C` | `6C` | `7C` | N/Z/V; preserve C |
| TST | `4D` | `5D` | `6D` | `7D` | N/Z from operand; V=0, C=0; no write |
| CLR | `4F` | `5F` | `6F` | `7F` | N=0, Z=1, V=0, C=0 |

The [unary model contract](6800/model.md#unary-operations) defines memory-access
records and the flag differences from the 6809. JMP occupies `oooo=1110` in
the two memory groups and uses the address without reading target data.

Word transfers set N/Z from the full word and clear V, preserving H/I/C.
CPX sets Z from whole-word equality and N/V from the separate high-byte
subtraction, with no low-byte borrow; C is preserved. All word memory
accesses are high byte first and wrap across `FFFF`, while a direct word at
`00FF` continues at `0100`.

| Instruction | Immediate | Direct | Indexed | Extended |
| --- | --- | --- | --- | --- |
| Length | 3 | 2 | 2 | 3 |
| CPX | `8C` | `9C` | `AC` | `BC` |
| LDS | `8E` | `9E` | `AE` | `BE` |
| STS | — | `9F` | `AF` | `BF` |
| LDX | `CE` | `DE` | `EE` | `FE` |
| STX | — | `DF` | `EF` | `FF` |

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `01` | NOP | Inherent | 1 | Advance PC only |
| `06` | TAP | Inherent | 1 | Replace H/I/N/Z/V/C from A bits 5–0 |
| `07` | TPA | Inherent | 1 | Pack flags into A with bits 7–6 set; preserve flags |
| `08` / `09` | INX / DEX | Inherent | 1 | Adjust X by one, wrapping at 16 bits; replace only Z |
| `0A` / `0B` | CLV / SEV | Inherent | 1 | Clear/set V; preserve other flags |
| `0C` / `0D` | CLC / SEC | Inherent | 1 | Clear/set C; preserve other flags |
| `0E` / `0F` | CLI / SEI | Inherent | 1 | Clear/set I; preserve other flags |
| `10` | SBA | Inherent | 1 | A − B into A; set N/Z/V/C, preserve H/I/B |
| `11` | CBA | Inherent | 1 | Compare A − B without writeback; set N/Z/V/C, preserve H/I |
| `16` | TAB | Inherent | 1 | Copy A to B; set N/Z, clear V, preserve H/I/C |
| `17` | TBA | Inherent | 1 | Copy B to A; set N/Z, clear V, preserve H/I/C |
| `19` | DAA | Inherent | 1 | Correct A after packed-BCD addition; set N/Z/C, preserve H/I, clear undefined V as [model policy](6800/model.md#decimal-adjustment) |
| `1B` | ABA | Inherent | 1 | A + B into A; set H/N/Z/V/C, preserve I/B |
| `20` | BRA rel | Relative | 2 | Always branch |
| `22` | BHI rel | Relative | 2 | Branch if C = 0 and Z = 0 |
| `23` | BLS rel | Relative | 2 | Branch if C = 1 or Z = 1 |
| `24` | BCC rel | Relative | 2 | Branch if C = 0 |
| `25` | BCS rel | Relative | 2 | Branch if C = 1 |
| `26` | BNE rel | Relative | 2 | Branch if Z = 0 |
| `27` | BEQ rel | Relative | 2 | Branch if Z = 1 |
| `28` | BVC rel | Relative | 2 | Branch if V = 0 |
| `29` | BVS rel | Relative | 2 | Branch if V = 1 |
| `2A` | BPL rel | Relative | 2 | Branch if N = 0 |
| `2B` | BMI rel | Relative | 2 | Branch if N = 1 |
| `2C` | BGE rel | Relative | 2 | Branch if N = V |
| `2D` | BLT rel | Relative | 2 | Branch if N ≠ V |
| `2E` | BGT rel | Relative | 2 | Branch if Z = 0 and N = V |
| `2F` | BLE rel | Relative | 2 | Branch if Z = 1 or N ≠ V |
| `30` | TSX | Inherent | 1 | X = SP + 1, wrapping at 16 bits; preserve flags |
| `31` | INS | Inherent | 1 | Increment SP without a data access; preserve flags |
| `32` | PULA | Inherent | 1 | Increment SP, then read A; preserve all flags |
| `33` | PULB | Inherent | 1 | Increment SP, then read B; preserve all flags |
| `34` | DES | Inherent | 1 | Decrement SP without a data access; preserve flags |
| `35` | TXS | Inherent | 1 | SP = X − 1, wrapping at 16 bits; preserve flags |
| `36` | PSHA | Inherent | 1 | Write A at SP, then decrement SP; preserve all flags |
| `37` | PSHB | Inherent | 1 | Write B at SP, then decrement SP; preserve all flags |
| `39` | RTS | Inherent | 1 | Pull return address high byte first; preserve all flags |
| `3B` | RTI | Inherent | 1 | Pull CC, B, A, X high/low, PC high/low from current stack RAM |
| `3E` | WAI | Inherent | 1 | Save full frame and wait; preserve I; accepted delivery reuses the frame |
| `3F` | SWI | Inherent | 1 | Save full frame with original I, set I, and enter through FFFA/FFFB |
| `6E` / `7E` | JMP | Indexed / extended | 2 / 3 | Set PC to the resolved address without a target read; preserve flags |
| `8D` | BSR rel | Relative | 2 | Push return PC low byte first, then branch relative to it; preserve flags |
| `AD` | JSR offset,X | Indexed | 2 | Resolve original X + unsigned offset, push return PC low byte first, and jump; preserve flags |
| `BD` | JSR addr | Extended | 3 | Push return PC low byte first, then jump to the high-byte-first target; preserve flags |

Opcode `21` is unused on the original 6800 and remains unsupported. It is not
the 6809's BRN instruction.

The 6800 now meets the [CPU-only checkpoint](../../ROADMAP.md#cpu-only-checkpoint).
Its logic example combines loads, stores, arithmetic, logic, conditional
branches, a call and return, and a saved accumulator on the RAM stack in an
independently checked bounded run. The stack example also checks nested calls.

| Area | Implemented scope |
| --- | --- |
| Stored state | Byte A/B, word X/SP/PC, H/I/N/Z/V/C flags, and required Boolean waiting latch |
| Inspection | Detached registers and flags; no derived register pairs |
| Accumulator operations | A/B loads in all four modes, A↔B transfers, and wrapping A/B increment/decrement; preserve H/I/C |
| Unary operations | All 44 A/B/indexed/extended forms of NEG/COM/LSR/ROR/ASR/ASL/ROL/DEC/INC/TST/CLR; preserve H/I, with CPU-specific N/Z/V/C rules |
| Arithmetic and logic | A/B ADD/ADC/SUB/SBC/CMP and AND/OR/XOR/BIT in all four modes; CMP/BIT preserve operands, subtraction preserves H/I |
| Word and pointer operations | All LDS/LDX/STS/STX/CPX forms; INX/DEX replace only Z; INS/DES/TSX/TXS preserve flags |
| Status and decimal operations | TAP/TPA, CLC/SEC/CLV/SEV/CLI/SEI, ABA/SBA/CBA, DAA; explicit original-6800 flag rules and undefined-result policies |
| Control flow | BRA and all fourteen short conditional branches, relative BSR, indexed/extended JMP and JSR, and RTS; 16-bit targets and unchanged flags |
| Stack | All LDS/STS forms; A/B pushes and pulls; pointer adjustments/transfers; calls and returns share ordinary RAM, with SP pointing to the next free byte and wrapping at 16 bits |
| Memory | Exactly 64 KiB RAM; page-zero direct, unsigned X+offset indexed, and high-byte-first extended addressing; A/B stores in all three memory modes |
| Interrupts | SWI and explicit IRQ/NMI offers use the seven-byte native frame and vectors; RTI restores from RAM; ignored masked IRQs make no accesses |
| Reset | Read FFFE then FFFF into PC, set I, and clear waiting; preserve other registers, flags, and RAM under the model policy |
| Stopping | WAI reports waiting after stacking; subsequent waiting steps have no instruction or accesses; accepted delivery/reset releases waiting |
| Remaining scope | Mapped devices, external HALT, look-ahead, and cycle timing |

Verification: [CPU tests](../../tests/components/cpus/6800.test.ts),
[arithmetic example tests](../../tests/machines/6800/example.test.ts),
[counted-loop tests](../../tests/machines/6800/counted-loop-example.test.ts),
[stack tests](../../tests/machines/6800/stack-example.test.ts),
[logic tests](../../tests/machines/6800/logic-example.test.ts),
[addressing/carry tests](../../tests/machines/6800/addressing-example.test.ts),
[word-transformation tests](../../tests/machines/6800/word-transform-example.test.ts),
[decimal example tests](../../tests/machines/6800/decimal-example.test.ts), and
[public type checks](../../tests/types/6800.ts). Checks cover every addition
operand pair, every load/store/transfer/increment/decrement byte and incoming
flag pattern, arithmetic boundaries, every store destination, PC, and
reset-vector value. Literal branch truth tables check all flag combinations;
displacement checks cover every byte, both paths, and address boundaries.
Stack checks cover every LDS word, push/pull byte and flag pattern, full-width
SP, BSR displacement, and JSR/RTS target. Boundary cases verify LDS word flags,
code/stack overlap, PC/SP wrapping, byte order, and reads of edited stack RAM.
Independent per-bit truth tables check every logic operand pair in both
accumulators; mixed flag patterns and boundary operands check N/Z/V replacement,
H/I/C preservation, wrapped fetches, and BIT leaving registers unchanged.
Every unary form covers all 256 byte values and all 64 flag combinations
against independent arithmetic ranges and bit strings. Indexed forms check
every unsigned displacement across base/address boundaries; memory forms
check operand/code overlap, read/write ordering, TST without writes, and CLR
as a zero write. Shared shift helpers are also exercised by the 6809's existing
independent tests. The word-transformation example checks arithmetic right
shift across two bytes, negation with a low-byte wrap path, exact records, full
memory images, resumption between shifts, reset, and bounded looping.
Complete records and observed RAM calls verify wrapping, byte order,
self-modifying code, unchanged-value stores, unsupported attempts, reset, and
detached snapshots. The examples check whole RAM images, complete records,
bounded running, caller completion, reset, and fresh restart. The counted loop
also checks resumption and an edited displacement that branches to itself.
Word tests cover every loaded/stored word, every mode and flag pattern at
boundaries, direct/indexed addresses, and code/data overlap. CPX exhausts
high-byte pairs with low-byte equality and borrowing; pointer operations
exhaust their 16-bit inputs. TAP/TPA exhaust bytes and flags, and ABA/SBA/CBA
exhaust byte pairs. DAA checks Motorola's adjustment table and every valid
BCD pair after ABA/ADDA/ADCA. The decimal example follows a 20-step indexed
call, stack inspection, BCD addition, flag capture, word comparison, and jump;
it also checks resumption, reset, and a bounded failure path.
The stack example checks nested calls, saved accumulators, residual stack bytes,
resumption from snapshots and RAM at different call depths, and reset during a call.
The logic example checks all eight immediate forms, branches after BIT,
stack preservation, snapshot resumption, and edited masks that select alternate paths.
New accumulator checks cover all eighty read encodings, every incoming flag
pattern at arithmetic boundaries, every immediate arithmetic operand pair in
both accumulators, and both incoming bits for ADC/SBC. All six store forms
check every byte and flag pattern. Direct and indexed address sweeps verify
page-zero addressing, unsigned offsets, and wrapping; overlap tests record
separate data reads and complete address fetches before stores. The addressing
example checks carry/borrow propagation, indexed wraparound, memory comparisons,
full records and RAM images, resumption, and an edited operand that selects a
fallback path.
Interrupt tests check flags, packed status, wrapping, vector/stack overlaps,
masked offers, wait/wake frame reuse, live returns, and each memory-failure
position. The [runner tests](../../tests/runtime/run-cpu.test.ts) combine WAI,
IRQ, nested NMIs, RTI, and SWI with complete trace/RAM comparison after restoring
a waiting snapshot. Parser and generator checks preserve the 6800's required
waiting state and generated factory types. See the [model contract](6800/model.md#waiting-and-external-interrupt-delivery)
for current-mask recognition, snapshot, and host-failure policies.

## 6502

[Source](../../src/components/cpus/6502.ts) ·
[Model contract](6502/model.md) ·
[Arithmetic example](6502/examples/arithmetic.md) ·
[Example definition](../../src/machines/6502/example.machine)

[Stack specification](6502/examples/stack.md) ·
[Stack definition](../../src/machines/6502/stack-example.machine)

[Addressing specification](6502/examples/addressing.md) ·
[Addressing definition](../../src/machines/6502/addressing-example.machine)

[Counted-loop specification](6502/examples/counted-loop.md) ·
[Counted-loop definition](../../src/machines/6502/counted-loop-example.machine)

[Subroutine specification](6502/examples/subroutines.md) ·
[Subroutine definition](../../src/machines/6502/subroutines-example.machine)

[Buffer-processing specification](6502/examples/buffer.md) ·
[Buffer definition](../../src/machines/6502/buffer-example.machine)

[Shift specification](6502/examples/shifts.md) ·
[Shift definition](../../src/machines/6502/shifts-example.machine)

[Comparison/flag specification](6502/examples/flags.md) ·
[Comparison/flag definition](../../src/machines/6502/flags-example.machine)

[Status/dispatch specification](6502/examples/status.md) ·
[Status/dispatch definition](../../src/machines/6502/status-example.machine) ·
[Decimal specification](6502/examples/decimal.md) ·
[Decimal definition](../../src/machines/6502/decimal-example.machine)

**All 151 documented forms are complete (100%).** The accumulator families
below contribute 63 forms; X/Y loads and stores contribute 16; shifts, rotates,
and memory INC/DEC contribute 28; CPX/CPY/BIT contribute 8. The remaining 36
complete forms appear in the final instruction table. BRK/RTI/CLI/SEI now
complete that inventory; IRQ/NMI delivery uses an explicit boundary-offer policy.

All documented addressing forms of ORA, AND, EOR, ADC, SBC, CMP, LDA, STA, LDX, LDY,
STX, STY, ASL, LSR, ROL, ROR, INC, DEC, CPX, CPY, and BIT are implemented.
A dash in these matrices means the original 6502 has no such form, rather than an implementation
gap. Length includes the opcode; absolute operands are low byte first.

| Instruction | `(zp,X)` | `zp` | `#n` | `addr` | `(zp),Y` | `zp,X` | `addr,Y` | `addr,X` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Length | 2 | 2 | 2 | 3 | 2 | 2 | 3 | 3 |
| ORA | `01` | `05` | `09` | `0D` | `11` | `15` | `19` | `1D` |
| AND | `21` | `25` | `29` | `2D` | `31` | `35` | `39` | `3D` |
| EOR | `41` | `45` | `49` | `4D` | `51` | `55` | `59` | `5D` |
| ADC | `61` | `65` | `69` | `6D` | `71` | `75` | `79` | `7D` |
| STA | `81` | `85` | — | `8D` | `91` | `95` | `99` | `9D` |
| LDA | `A1` | `A5` | `A9` | `AD` | `B1` | `B5` | `B9` | `BD` |
| CMP | `C1` | `C5` | `C9` | `CD` | `D1` | `D5` | `D9` | `DD` |
| SBC | `E1` | `E5` | `E9` | `ED` | `F1` | `F5` | `F9` | `FD` |

| Instruction | `#n` | `zp` | `addr` | `zp,X` | `zp,Y` | `addr,X` | `addr,Y` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Length | 2 | 2 | 3 | 2 | 2 | 3 | 3 |
| LDY | `A0` | `A4` | `AC` | `B4` | — | `BC` | — |
| LDX | `A2` | `A6` | `AE` | — | `B6` | — | `BE` |
| STY | — | `84` | `8C` | `94` | — | — | — |
| STX | — | `86` | `8E` | — | `96` | — | — |

| Instruction | `A` | `zp` | `addr` | `zp,X` | `addr,X` |
| --- | --- | --- | --- | --- | --- |
| Length | 1 | 2 | 3 | 2 | 3 |
| ASL | `0A` | `06` | `0E` | `16` | `1E` |
| ROL | `2A` | `26` | `2E` | `36` | `3E` |
| LSR | `4A` | `46` | `4E` | `56` | `5E` |
| ROR | `6A` | `66` | `6E` | `76` | `7E` |
| DEC | — | `C6` | `CE` | `D6` | `DE` |
| INC | — | `E6` | `EE` | `F6` | `FE` |

| Instruction | `#n` | `zp` | `addr` |
| --- | --- | --- | --- |
| Length | 2 | 2 | 3 |
| CPY | `C0` | `C4` | `CC` |
| CPX | `E0` | `E4` | `EC` |
| BIT | — | `24` | `2C` |

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `00` | `BRK` | Implied / stack | 1 | Consume padding; push PC after both bytes and NV11DIZC; set I and read the IRQ/BRK vector |
| `08` | `PHP` | Implied / stack | 1 | Push NV11DIZC at 0100 + SP, then decrement SP; preserve flags |
| `10` | `BPL rel` | Relative | 2 | Branch if N = 0 |
| `18` | `CLC` | Implied | 1 | Clear carry |
| `20` | `JSR addr` | Absolute / stack | 3 | Fetch target low; push the last operand's address high then low; fetch target high and jump |
| `28` | `PLP` | Implied / stack | 1 | Increment SP, then restore N/V/D/I/Z/C from the stacked byte; ignore bits 5/4 |
| `30` | `BMI rel` | Relative | 2 | Branch if N = 1 |
| `38` | `SEC` | Implied | 1 | Set carry; preserve other flags |
| `40` | `RTI` | Implied / stack | 1 | Pull status, PC low, PC high; ignore status bits 5/4; return without incrementing PC |
| `48` | `PHA` | Implied | 1 | Write A at 0100 + SP, then decrement 8-bit SP; preserve flags |
| `4C` | `JMP addr` | Absolute | 3 | Set PC from a low/high target; preserve flags |
| `50` | `BVC rel` | Relative | 2 | Branch if V = 0 |
| `58` | `CLI` | Implied | 1 | Clear I; preserve other flags |
| `60` | `RTS` | Implied / stack | 1 | Pull PC low then high and add one with 16-bit wrapping; preserve flags |
| `68` | `PLA` | Implied | 1 | Increment 8-bit SP, then read A at 0100 + SP; update N/Z |
| `6C` | `JMP (addr)` | Absolute indirect | 3 | Read target low/high from a pointer whose high-byte read stays on the same page; preserve flags |
| `70` | `BVS rel` | Relative | 2 | Branch if V = 1 |
| `78` | `SEI` | Implied | 1 | Set I; preserve other flags |
| `88` | `DEY` | Implied | 1 | Decrement Y; update N/Z |
| `8A` | `TXA` | Implied | 1 | Copy X to A; update N/Z |
| `90` | `BCC rel` | Relative | 2 | Branch if C = 0 |
| `98` | `TYA` | Implied | 1 | Copy Y to A; update N/Z |
| `9A` | `TXS` | Implied | 1 | Copy X to SP; preserve every flag |
| `A8` | `TAY` | Implied | 1 | Copy A to Y; update N/Z |
| `AA` | `TAX` | Implied | 1 | Copy A to X; update N/Z |
| `B0` | `BCS rel` | Relative | 2 | Branch if C = 1 |
| `B8` | `CLV` | Implied | 1 | Clear overflow; preserve other flags |
| `BA` | `TSX` | Implied | 1 | Copy SP to X; update N/Z |
| `C8` | `INY` | Implied | 1 | Increment Y; update N/Z |
| `CA` | `DEX` | Implied | 1 | Decrement X; update N/Z |
| `D0` | `BNE rel` | Relative | 2 | Branch if Z = 0 |
| `D8` | `CLD` | Implied | 1 | Clear decimal mode; preserve other flags |
| `E8` | `INX` | Implied | 1 | Increment X; update N/Z |
| `EA` | `NOP` | Implied | 1 | Advance PC only |
| `F0` | `BEQ rel` | Relative | 2 | Branch if Z = 1 |
| `F8` | `SED` | Implied | 1 | Set decimal mode; preserve other flags |

BRK has a one-byte opcode and consumes a following padding byte. Its
instruction record contains both fetched bytes; the saved PC advances by two.

| Area | Current coverage |
| --- | --- |
| Stored registers | A, X, Y, SP, PC |
| Stored flags | N, V, D, I, Z, C; PHP encodes NV11DIZC and PLP restores the six flags, ignoring bits 5/4; B and the unused bit are not stored state |
| Register operations | All A/X/Y loads and stores, A↔X and A↔Y transfers, wrapping X/Y increment/decrement; loads/transfers/index changes replace N/Z, stores preserve all flags |
| Memory addressing | Zero page, absolute, zero page indexed, absolute indexed, indexed indirect `(zp,X)`, indirect indexed `(zp),Y`, and absolute indirect JMP; zero-page indexing/pointer reads wrap at 8 bits, absolute indexing at 16 bits; JMP pointer reads wrap within their page |
| Logic and comparison | All ORA/AND/EOR, CMP/CPX/CPY, and BIT forms; logic replaces A and N/Z, comparisons replace N/Z/C without changing registers; BIT copies N/V from memory and sets Z from A AND memory, preserving C/D/I |
| Memory modification | ASL/ROL/LSR/ROR replace N/Z/C; INC/DEC replace N/Z and preserve carry; all preserve V/D/I. Memory forms read once, write the original byte, then write the result. Accumulator shifts/rotates access only the opcode |
| Branches | All eight conditions; signed displacement relative to PC after the operand, with 16-bit wrapping; fetch the operand on both paths and preserve flags |
| Jumps and subroutines | Absolute/indirect JMP, absolute JSR, and RTS; JSR's final operand fetch follows its stack writes; RTS adds one to the saved pointer; preserve flags |
| Stack | PHA/PLA, PHP/PLP, and subroutine return pointers in page 01 with wrapping 8-bit SP; pulls retain stored bytes; TSX copies SP to X and updates N/Z; TXS copies X to SP without changing flags |
| Flag controls | CLC/SEC, CLI/SEI, CLV, and CLD/SED affect only their named flag; NOP changes only PC |
| Arithmetic | All ADC/SBC forms, binary and NMOS decimal, with carry/borrow propagation; replace N/V/Z/C and preserve D/I |
| Decimal mode | CLD/SED and PLP select the live mode; ADC uses NMOS intermediate N/V and binary Z, SBC uses binary N/V/Z/C; invalid BCD nibbles follow NMOS correction |
| Reset | Read `FFFC` then `FFFD` for PC, set I, subtract 3 from the 8-bit SP with wrapping; preserve other registers, flags (including D), and RAM |
| Stopping | The example caller stops at its completion address; the CPU has no synthetic halt or completion outcome |
| Interrupt entry/return | BRK plus explicit IRQ/NMI offers share page-one PC/status frames and native vectors; entry sets I and preserves NMOS D; RTI restores status and PC; ignored IRQs make no accesses |
| Recognition policy | Explicit boundary offers use current I; caller owns pending IRQs, NMI edges, and priority; cycle polling delays and in-progress entry redirection are unmodeled |
| Remaining instruction scope | None; all documented opcode forms are implemented |
| Remaining addressing scope | None; all documented addressing modes are implemented |

All supported forms work with either D value. Reset preserves D.
Interrupt tests check every entry SP/flag pattern, every RTI status byte and
return address, wrapping and code/stack overlap, exact access order, callback
failures, reentrancy, and nested IRQ/NMI with decimal continuation and snapshot
restoration. All 40,000 independent SingleStepTests cases for BRK/RTI/CLI/SEI
passed state, RAM, and modeled access comparisons; external recognition timing
is outside those vectors.
The model targets the original NMOS 6502; variant-specific behavior has not
been implemented.

Verification: [CPU tests](../../tests/components/cpus/6502.test.ts),
[arithmetic example tests](../../tests/machines/6502/example.test.ts),
[stack example tests](../../tests/machines/6502/stack-example.test.ts),
[addressing example tests](../../tests/machines/6502/addressing-example.test.ts),
[counted-loop example tests](../../tests/machines/6502/counted-loop-example.test.ts),
[subroutine example tests](../../tests/machines/6502/subroutines-example.test.ts),
[buffer example tests](../../tests/machines/6502/buffer-example.test.ts),
[shift example tests](../../tests/machines/6502/shifts-example.test.ts),
[comparison/flag example tests](../../tests/machines/6502/flags-example.test.ts),
[status/dispatch example tests](../../tests/machines/6502/status-example.test.ts),
[decimal example tests](../../tests/machines/6502/decimal-example.test.ts), and
[public type checks](../../tests/types/6502.ts). ADC/SBC checks cover every byte
operand pair and carry input in both binary and NMOS decimal modes, plus
all incoming flag patterns through every addressing form. Valid BCD inputs
also match base-100 arithmetic. Other checks cover exact accesses, wrapping, self-overwriting stores,
reset vectors and SP effects, caller completion, unsupported opcodes, input
validation, and detached records.
PHA/PLA checks cover page-one addressing, SP and PC wrapping, nested operations,
flag preservation and replacement, stack/code overlap, current RAM reads,
retained stack bytes, and reset with an occupied stack.
Zero-page LDA/STA checks cover fixed-page addressing, N/Z replacement and flag
preservation with either D value, PC and operand wrapping, code overlap,
current RAM, unchanged-value writes without destination reads, and detached records.
Register loads/transfers and index increments/decrements check every byte and
all 64 incoming flag combinations, N/Z replacement, preserved unrelated state,
and wrapping. All branch conditions are checked with every flag combination;
displacement checks cover every byte, both paths, page/address-space crossings,
and instruction-byte overlap. Further checks cover live flags after ADC and
register operations, current operands, and record ownership. The counted loop
checks nineteen complete records, actual RAM calls, both branch paths, full
memory images, bounded resumption and self-looping, reset, and fresh restart.

JMP/JSR checks cover every 16-bit target; RTS checks every stacked pointer and
its increment. All SP values and flag combinations, PC/SP wrapping, retained
stack data, unchanged-value writes, current operands, and code/stack overlap
are checked through complete records and observed RAM calls. Overlap cases
specifically check JSR's high operand after the pushes and RTS reading its own
opcode as stack data. The subroutine example checks thirteen complete records,
nested calls across page-one wrapping, a saved accumulator, the result store,
JMP completion, bounded resumption at different call depths, reset, and restart.

Logic and CMP checks exhaust every accumulator/operand pair with D clear and
set. Independent opcode matrices exercise every new form with every incoming
flag pattern; X/Y loads and all stores also cover every byte. Exact records and
observed RAM calls check indexed page/address-space wrapping, zero-page pointer
wrapping, operand fetching across FFFF, live registers and pointers, repeated
reads of overlapping pointer/data locations, self-modifying stores, and
unchanged-value writes without destination reads.

The buffer example checks 72 complete records, input/output page crossings,
a zero-page pointer crossing FF to 00, arithmetic/logic in a subroutine,
comparisons feeding both branch paths, and A/X/Y memory transfers. It verifies
the complete RAM image, bounded resumption, reset during a call, fresh restart,
and an edited self-loop. Together with the existing examples, this satisfies
the 6502's [CPU-only checkpoint](../../ROADMAP.md#cpu-only-checkpoint);
its interrupt instructions follow the [completion sequence](completion.md#completion-sequence).

Shift/rotate and memory INC/DEC checks cover all 28 forms, every operand byte,
and all 64 incoming flag patterns. They verify complete state and accesses,
including both writes when the result is unchanged, accumulator-only accesses,
PC/address wrapping, operand/data overlap, live carry and index values,
self-modifying code, complete RAM preservation outside the destination, and
retained records. The shift example checks 20 complete records, carry passed
between two bytes, INC/DEC loop counters, both branch paths, snapshot resumption,
reset, restart, and a bounded self-loop, all with D set.

CPX/CPY and BIT exhaust every register/operand pair with D clear and set.
All eight forms also check incoming flag patterns, PC wrapping, live operands,
and overlapping instruction/data reads. TSX/TXS check every byte and flag pattern;
flag controls and NOP check preservation, idempotence, and PC wrapping. SED/CLD
select live ADC/SBC modes, and reset preserves D and carry. The comparison/flag example checks 26 complete records,
selected stack addressing, both CPY loop paths, BIT/CLV branches, SEC feeding
ADC, NOP and stores after SED, snapshot resumption, reset, fresh factories,
complete memory images, and a failure branch after a host edit to the BIT operand.

PHP checks every flag pattern and SP, including unchanged writes; PLP checks
every stacked byte and incoming flag pattern, ignores bits 5/4, and restores
live D/C for ADC/SBC. Indirect JMP checks every pointer address and target, all
flag patterns, operand fetching across FFFF, and instruction/pointer overlap.
All three also match 10,000 independent reference cases each; the
[model contract](6502/model.md#status-stack) documents those supplementary checks.
The status/dispatch example checks twelve complete records, nested status and
return frames across stack wrapping, indirect dispatch across a pointer-page
boundary, flags restored independently of A, current pointers, snapshot
resumption, reset, full RAM images, and fresh factories. Editing the dispatch
pointer to skip CLD exercises NMOS correction of an invalid BCD operand.

All sixteen ADC/SBC forms also match 10,000 independent reference cases each;
the [arithmetic contract](6502/model.md#arithmetic-and-decimal-mode) describes
those supplementary checks and the NMOS flag rules. The decimal example
checks sixteen complete records for two-byte carry/borrow propagation,
including N/Z differing from the corrected accumulator, snapshot resumption
between bytes, full memory images, and fresh factories.

## 6809

[Source](../../src/components/cpus/6809.ts) ·
[Model contract](6809/model.md) ·
[Arithmetic example](6809/examples/arithmetic.md) ·
[Example definition](../../src/machines/6809/example.machine)

[Stack specification](6809/examples/stack.md) ·
[Stack definition](../../src/machines/6809/stack-example.machine)

[Addressing specification](6809/examples/addressing.md) ·
[Addressing definition](../../src/machines/6809/addressing-example.machine)

[Counted-loop specification](6809/examples/counted-loop.md) ·
[Counted-loop definition](../../src/machines/6809/counted-loop-example.machine)

[Word-addition specification](6809/examples/word-addition.md) ·
[Word-addition definition](../../src/machines/6809/word-addition-example.machine)

[Indexed-copy specification](6809/examples/indexed-copy.md) ·
[Indexed-copy definition](../../src/machines/6809/indexed-copy-example.machine)

[Sum-of-squares specification](6809/examples/sum-of-squares.md) ·
[Sum-of-squares definition](../../src/machines/6809/sum-of-squares-example.machine)

**268 / 268 forms (100%).** All documented forms are complete: 221 on the
base page, 38 on page 2 (`10`), and nine on page 3 (`11`). IRQ/FIRQ/NMI delivery
uses explicit boundary offers, with full/short frames, wait modes, and NMI arming.
There are no separate port-I/O forms. Mapped devices and timing remain outside
the model. All 56 indexed forms support every documented postbyte.

The totals comprise 86 accumulator forms, 55 unary forms, 35 word transfers,
28 word arithmetic/comparison forms, 16 short and 15 prefixed long branches,
four register-mask stack transfers, six calls/returns, three JMP forms,
LBRA, NOP, the 12 additional inherent/status/register forms below, and six
interrupt/wait forms:

| Opcode | Instruction | Behavior |
| --- | --- | --- |
| `13` | SYNC | Wait; masked IRQ/FIRQ resume without vector entry |
| `3B` | RTI | Restore CC, then the full or short frame selected by saved E |
| `3C` | CWAI #mask | Mask CC, set E, save the entire frame, and wait for acceptance |
| `3F` | SWI | Entire frame, set F/I, vector `FFFA` |
| `10 3F` | SWI2 | Entire frame, preserve masks, vector `FFF4` |
| `11 3F` | SWI3 | Entire frame, preserve masks, vector `FFF2` |

Accumulator opcodes use **`1 r mm oooo`**: `r=0` selects A, `r=1` selects B;
`mm=00/01/10/11` selects immediate/direct/indexed/extended addressing.
Each cell below lists A/B opcodes; immediate/direct instructions are two bytes,
extended instructions three, and indexed instructions two to four.
Stores have no immediate form.

| Operation | Immediate A/B | Direct A/B | Indexed A/B | Extended A/B | Flag effects |
| --- | --- | --- | --- | --- | --- |
| SUB | `80` / `C0` | `90` / `D0` | `A0` / `E0` | `B0` / `F0` | N/Z/V/C; C records borrow |
| CMP | `81` / `C1` | `91` / `D1` | `A1` / `E1` | `B1` / `F1` | Subtraction flags without changing the accumulator |
| SBC | `82` / `C2` | `92` / `D2` | `A2` / `E2` | `B2` / `F2` | N/Z/V/C; subtract incoming borrow |
| AND | `84` / `C4` | `94` / `D4` | `A4` / `E4` | `B4` / `F4` | N/Z from result; V cleared |
| BIT | `85` / `C5` | `95` / `D5` | `A5` / `E5` | `B5` / `F5` | AND flags without changing the accumulator |
| LD | `86` / `C6` | `96` / `D6` | `A6` / `E6` | `B6` / `F6` | N/Z from loaded byte; V cleared |
| ST | — | `97` / `D7` | `A7` / `E7` | `B7` / `F7` | N/Z from stored byte; V cleared |
| EOR | `88` / `C8` | `98` / `D8` | `A8` / `E8` | `B8` / `F8` | N/Z from result; V cleared |
| ADC | `89` / `C9` | `99` / `D9` | `A9` / `E9` | `B9` / `F9` | H/N/Z/V/C; include incoming carry |
| OR | `8A` / `CA` | `9A` / `DA` | `AA` / `EA` | `BA` / `FA` | N/Z from result; V cleared |
| ADD | `8B` / `CB` | `9B` / `DB` | `AB` / `EB` | `BB` / `FB` | H/N/Z/V/C; ignore incoming carry |

Unary encodings use **`0000 oooo`** (direct), **`010r oooo`** (A/B),
**`0110 oooo`** (indexed), or **`0111 oooo`** (extended). Register forms are
one byte, direct two, indexed two to four, and extended three. ASL/LSL is one
encoding per form.

| Operation | Direct | A | B | Indexed | Extended | Flag effects |
| --- | --- | --- | --- | --- | --- | --- |
| NEG | `00` | `40` | `50` | `60` | `70` | N/Z/V/C; negate modulo 256 |
| COM | `03` | `43` | `53` | `63` | `73` | N/Z; V=0, C=1 |
| LSR | `04` | `44` | `54` | `64` | `74` | N/Z/C; preserve V |
| ROR | `06` | `46` | `56` | `66` | `76` | N/Z/C; rotate through C, preserve V |
| ASR | `07` | `47` | `57` | `67` | `77` | N/Z/C; retain sign and preserve V |
| ASL / LSL | `08` | `48` | `58` | `68` | `78` | N/Z/V/C |
| ROL | `09` | `49` | `59` | `69` | `79` | N/Z/V/C; rotate through C |
| DEC | `0A` | `4A` | `5A` | `6A` | `7A` | N/Z/V; preserve C |
| INC | `0C` | `4C` | `5C` | `6C` | `7C` | N/Z/V; preserve C |
| TST | `0D` | `4D` | `5D` | `6D` | `7D` | N/Z; V=0, preserve C; no write |
| CLR | `0F` | `4F` | `5F` | `6F` | `7F` | N=0, Z=1, V=0, C=0; memory forms read then write |

E/F/I are preserved by these byte operations. H changes only for ADD/ADC;
where Motorola leaves H undefined, this model preserves it. Exact behavior
and memory-access rules are in the [model contract](6809/model.md#accumulator-operations-and-short-branches).

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `0E` / `6E` / `7E` | `JMP` | Direct / indexed / extended | 2 / 2–4 / 3 | Replace PC without reading the target |
| `12` | `NOP` | Inherent | 1 | Advance PC only |
| `16` | `LBRA rel16` | Long relative | 3 | Add signed word to PC after the operand |
| `17` | `LBSR rel16` | Long relative | 3 | Stack return PC on S and branch |
| `19` | `DAA` | Inherent | 1 | Adjust A after BCD addition; N/Z/C, preserve H, clear undefined V under model policy |
| `1A` / `1C` | `ORCC` / `ANDCC` | Immediate | 2 | Combine packed CC with the immediate byte; replace all eight flags |
| `1D` | `SEX` | Inherent | 1 | Sign-extend B into D; replace N/Z, preserve V and other flags |
| `1E` / `1F` | `EXG` / `TFR` | Register postbyte | 2 | Exchange/transfer any documented same-width pair; includes D, PC, and CC |
| `20` | `BRA rel` | Short relative | 2 | Branch always |
| `21` | `BRN rel` | Short relative | 2 | Branch never; fetch displacement and advance PC |
| `22` | `BHI rel` | Short relative | 2 | Branch if C = 0 and Z = 0 |
| `23` | `BLS rel` | Short relative | 2 | Branch if C = 1 or Z = 1 |
| `24` | `BCC rel` / `BHS rel` | Short relative | 2 | Branch if C = 0; aliases count once |
| `25` | `BCS rel` / `BLO rel` | Short relative | 2 | Branch if C = 1; aliases count once |
| `26` | `BNE rel` | Short relative | 2 | Branch if Z = 0 |
| `27` | `BEQ rel` | Short relative | 2 | Branch if Z = 1 |
| `28` | `BVC rel` | Short relative | 2 | Branch if V = 0 |
| `29` | `BVS rel` | Short relative | 2 | Branch if V = 1 |
| `2A` | `BPL rel` | Short relative | 2 | Branch if N = 0 |
| `2B` | `BMI rel` | Short relative | 2 | Branch if N = 1 |
| `2C` | `BGE rel` | Short relative | 2 | Branch if N = V |
| `2D` | `BLT rel` | Short relative | 2 | Branch if N ≠ V |
| `2E` | `BGT rel` | Short relative | 2 | Branch if Z = 0 and N = V |
| `2F` | `BLE rel` | Short relative | 2 | Branch if Z = 1 or N ≠ V |
| `30`–`33` | `LEAX` / `LEAY` / `LEAS` / `LEAU` | Indexed | 2–4 | Load resolved address; X/Y replace only Z, S/U preserve flags |
| `34` | `PSHS mask` | Immediate register mask | 2 | Push any selection of CC/A/B/DP/X/Y/U/PC onto S; preserve flags |
| `35` | `PULS mask` | Immediate register mask | 2 | Pull any selection of CC/A/B/DP/X/Y/U/PC from S; flags change only if CC is selected |
| `36` | `PSHU mask` | Immediate register mask | 2 | Push any selection of CC/A/B/DP/X/Y/S/PC onto U; preserve flags |
| `37` | `PULU mask` | Immediate register mask | 2 | Pull any selection of CC/A/B/DP/X/Y/S/PC from U; flags change only if CC is selected |
| `39` | `RTS` | Inherent | 1 | Pull PC from S, high byte then low; no adjustment |
| `3A` | `ABX` | Inherent | 1 | Add unsigned B to X, wrapping; preserve flags |
| `3D` | `MUL` | Inherent | 1 | Unsigned A × B into D; Z tests word, C copies product bit 7 |
| `8D` | `BSR rel8` | Short relative | 2 | Stack return PC on S and branch |
| `9D` / `AD` / `BD` | `JSR` | Direct / indexed / extended | 2 / 2–4 / 3 | Stack return PC on S and jump |

Page `10` supplies long counterparts of `21`–`2F` (LBRN and fourteen
conditional branches). These four-byte instructions fetch a high/low signed
word displacement on both paths, relative to PC after all four bytes. There
is no `10 20` LBRA alias. They preserve the same flags as short branches.

Word transfers use the same addressing selectors. Loads set N/Z from the full
word and clear V; stores apply the same flags to the stored value. Both preserve
E/F/H/I/C. Immediate word loads are three bytes; memory forms have the same
instruction lengths as the byte forms above. A page prefix adds one byte.
Word data is high byte first.

| Operation | Immediate | Direct | Indexed | Extended |
| --- | --- | --- | --- | --- |
| LDD | `CC` | `DC` | `EC` | `FC` |
| STD | — | `DD` | `ED` | `FD` |
| LDX | `8E` | `9E` | `AE` | `BE` |
| STX | — | `9F` | `AF` | `BF` |
| LDU | `CE` | `DE` | `EE` | `FE` |
| STU | — | `DF` | `EF` | `FF` |
| LDY | `10 8E` | `10 9E` | `10 AE` | `10 BE` |
| STY | — | `10 9F` | `10 AF` | `10 BF` |
| LDS | `10 CE` | `10 DE` | `10 EE` | `10 FE` |
| STS | — | `10 DF` | `10 EF` | `10 FF` |

Word arithmetic replaces N/Z/V/C and preserves E/F/H/I. ADDD/SUBD write D;
comparisons preserve their register apart from an indexed auto-update. C is
carry for addition and borrow for subtraction/comparison. The full-word
comparison differs from the original 6800's bytewise CPX.

| Operation | Immediate | Direct | Indexed | Extended |
| --- | --- | --- | --- | --- |
| SUBD | `83` | `93` | `A3` | `B3` |
| ADDD | `C3` | `D3` | `E3` | `F3` |
| CMPX | `8C` | `9C` | `AC` | `BC` |
| CMPD | `10 83` | `10 93` | `10 A3` | `10 B3` |
| CMPY | `10 8C` | `10 9C` | `10 AC` | `10 BC` |
| CMPU | `11 83` | `11 93` | `11 A3` | `11 B3` |
| CMPS | `11 8C` | `11 9C` | `11 AC` | `11 BC` |

| Area | Current coverage |
| --- | --- |
| Stored registers | A, B, DP, X, Y, S, U, PC |
| Stored flags | E/F/H/I/N/Z/V/C; CC packed/unpacked for stack transfers |
| Register relationships | D derives A:B; TFR/EXG support all 52 documented same-width pairs including D/PC/CC; snapshots retain detached numeric D |
| Addressing | Immediate bytes/words, direct DP:offset, extended addresses, all documented indexed modes, and signed byte/word relative offsets; 16-bit wrapping |
| Branches | All short and long conditions, BRA/BRN, LBRN, and LBRA; fetch operands on every path and preserve flags |
| Stack | Descending S/U, all register masks, wrapping pointers; calls/RTS share S word transfers |
| Reset | Read `FFFE` then `FFFF` for PC, clear DP, set F/I, release waits and disarm NMI; preserve other state and RAM |
| Prefixes | `10`/`11` select separate opcode pages; unsupported page entries read prefix and opcode, then restore PC without other effects |
| Stopping | Caller-owned completion address and budget; no synthetic halt or completion outcome |
| Word and arithmetic operations | All D/X/Y/U/S loads/stores, ADDD/SUBD and word comparisons; LEA, ABX, SEX, MUL, and DAA with explicit original-6809 flag rules |
| Status operations | ANDCC/ORCC and CC transfers replace all eight flags; later instructions use live flags |
| Wait and interrupt state | `waitMode` (none/sync/cwai), `nmiArmed`; snapshots preserve both |
| Interrupt delivery | Explicit IRQ/FIRQ/NMI offers, native masks/vectors and full/short frames; CWAI reuses its frame; masked IRQ/FIRQ release SYNC |
| Remaining scope | Mapped devices, pin sampling, interrupt scheduling, and timing |

The [reset preservation policy](6809/model.md#cpu-reset) does not claim
hardware power-on values for unspecified state. The [delivery contract](6809/model.md#waiting-and-external-interrupt-delivery)
defines boundary recognition and caller-owned pending signals. Timing and
MC6809/MC6809E clock and pin differences remain outside this model.

Verification: [CPU tests](../../tests/components/cpus/6809.test.ts) exhaust
ADD/ADC/SUB/SBC/CMP for every byte pair and carry on both accumulators; unary
operations and byte stores cover every byte and all 256 CC values in every supported
form. Literal opcode rows and independent arithmetic/bit-string expectations
check addressing, flag replacement and preservation, wrapping, real memory
accesses, code overlap, CLR's read, and TST's absence of writes. Calls, returns,
and jumps cover all CC values, stack/PC wrapping and operand overlap. Existing
checks retain all branch conditions, stack masks, state validation, snapshots,
reset and unsupported-attempt contracts. Interrupt tests cover all CC values,
wait/wake paths, edited frames, NMI arming, vector overlap, memory failures, and
reentrancy. A [runner program](../../tests/runtime/run-cpu.test.ts) combines both
waits, software entry, nested full/short frames, and snapshot resumption.

Indexed checks cover all 217 documented postbytes across signed offsets,
register selectors, auto-update and PC/pointer wrapping. All 56 indexed forms
reject all 39 undefined postbytes before effects. Word checks cover all 35
load/store forms, every CC value, every LDD result, address/source aliasing,
byte order, and loads overwriting an index auto-update. The
[indexed-copy tests](../../tests/machines/6809/indexed-copy-example.test.ts)
check sixteen exact records, complete memory images, current pointers,
snapshot resumption between load and store, reset, and fresh factories.
The [CoCo comparison](6809/reference-notes.md#indexed-and-word-transfer-comparison)
adds 21,634 reference cases.

The [word-addition tests](../../tests/machines/6809/word-addition-example.test.ts)
check carry propagation through nested calls, thirteen complete records, actual
RAM calls, full memory images, snapshot resumption inside the calls, reset,
restart, a failure path, and bounded looping. Existing
[arithmetic](../../tests/machines/6809/example.test.ts),
[stack](../../tests/machines/6809/stack-example.test.ts),
[addressing](../../tests/machines/6809/addressing-example.test.ts), and
[counted-loop](../../tests/machines/6809/counted-loop-example.test.ts) examples
and [public type checks](../../tests/types/6809.ts) remain covered. See also the
[independent CoCo comparison](6809/reference-notes.md#expanded-byte-instruction-comparison).

The [sum-of-squares tests](../../tests/machines/6809/sum-of-squares-example.test.ts)
check 48 complete records, word accumulation through stack locals, all RAM,
actual reads/writes, snapshot resumption, reset, fresh factories, and bounded
failure. New instruction tests check every word input for immediate word
operations, all forms/flags at boundaries, all indexed postbytes and register
auto-update interactions, every same-width TFR/EXG pair, and invalid selectors.
ANDCC/ORCC, SEX, and DAA exhaust bytes and CC values; MUL exhausts byte pairs.
BCD results also match base-ten addition. Long branches cover every flag
pattern and all word displacements on taken/untaken paths. Literal opcode
sets audit all 268 documented forms across all three pages and reject undefined encodings.

## Z80

[Source](../../src/components/cpus/z80.ts) ·
[Model contract](z80/model.md) ·
[Arithmetic example](z80/examples/arithmetic.md) ·
[Example definition](../../src/machines/z80/example.machine)

[Counted-loop specification](z80/examples/counted-loop.md) ·
[Counted-loop definition](../../src/machines/z80/counted-loop-example.machine)

[Transfer specification](z80/examples/transfers.md) ·
[Transfer definition](../../src/machines/z80/transfers-example.machine) ·
[Checksum specification](z80/examples/checksum.md) ·
[Checksum definition](../../src/machines/z80/checksum-example.machine) ·
[Bit-count specification](z80/examples/bit-count.md) ·
[Bit-count definition](../../src/machines/z80/bit-count-example.machine) ·
[Decimal-total specification](z80/examples/decimal-total.md) ·
[Decimal-total definition](../../src/machines/z80/decimal-total-example.machine) ·
[Indexed-buffer specification](z80/examples/indexed-buffer.md) ·
[Indexed-buffer definition](../../src/machines/z80/indexed-buffer-example.machine)

**698 of 698 documented forms are complete (100%): 252 unprefixed, 248 CB,
58 ED, 39 DD, 39 FD, 31 DD CB, and 31 FD CB forms.** This includes all port
families, DI/EI, three IM forms, RETI, and RETN, with explicit IRQ/NMI delivery.
Stack operations, calls/returns, and the bit-count example complete the Z80
[CPU-only checkpoint](../../ROADMAP.md#cpu-only-checkpoint).

| Opcode | Instruction | Addressing form | Length | Scope |
| --- | --- | --- | --- | --- |
| `01/11/21/31` | `LD dd,nn` | Immediate word | 3 | Load BC/DE/HL/SP, low byte first; preserve flags |
| `04` | `INC B` | Register | 1 | Increment B; preserve C |
| `05` | `DEC B` | Register | 1 | Decrement B; preserve C |
| `06` | `LD B,n` | Immediate | 2 | Load B; preserve flags |
| `0C` | `INC C` | Register | 1 | Increment C; preserve carry flag |
| `0D` | `DEC C` | Register | 1 | Decrement C; preserve carry flag |
| `0E` | `LD C,n` | Immediate | 2 | Load C; preserve flags |
| `10` | `DJNZ rel` | Relative | 2 | Decrement B; jump if the result is nonzero; preserve all flags |
| `14` | `INC D` | Register | 1 | Increment D; preserve C |
| `15` | `DEC D` | Register | 1 | Decrement D; preserve C |
| `16` | `LD D,n` | Immediate | 2 | Load D; preserve flags |
| `18` | `JR rel` | Relative | 2 | Jump unconditionally; preserve flags |
| `1C` | `INC E` | Register | 1 | Increment E; preserve C |
| `1D` | `DEC E` | Register | 1 | Decrement E; preserve C |
| `1E` | `LD E,n` | Immediate | 2 | Load E; preserve flags |
| `20` | `JR NZ,rel` | Relative | 2 | Jump if Z = 0; preserve flags |
| `24` | `INC H` | Register | 1 | Increment H; preserve C |
| `25` | `DEC H` | Register | 1 | Decrement H; preserve C |
| `26` | `LD H,n` | Immediate | 2 | Load H; preserve flags |
| `28` | `JR Z,rel` | Relative | 2 | Jump if Z = 1; preserve flags |
| `2C` | `INC L` | Register | 1 | Increment L; preserve C |
| `2D` | `DEC L` | Register | 1 | Decrement L; preserve C |
| `2E` | `LD L,n` | Immediate | 2 | Load L; preserve flags |
| `30` | `JR NC,rel` | Relative | 2 | Jump if C = 0; preserve flags |
| `32` | `LD (nn),A` | Absolute | 3 | Store A; address bytes low then high; preserve flags |
| `36` | `LD (HL),n` | Immediate byte to indirect memory | 2 | Fetch the byte, then write RAM at HL; preserve flags |
| `38` | `JR C,rel` | Relative | 2 | Jump if C = 1; preserve flags |
| `3C` | `INC A` | Register | 1 | Increment A; preserve C |
| `3D` | `DEC A` | Register | 1 | Decrement A; preserve C |
| `3E` | `LD A,n` | Immediate | 2 | Load A; preserve flags |
| `40`–`7F`, except `76` | `LD r,r'` / `LD r,(HL)` / `LD (HL),r` | Register or indirect memory | 1 | All 49 register transfers, seven indirect reads, and seven indirect writes; preserve flags |
| `76` | `HALT` | Implied | 1 | Advance PC, increment R, and halt; preserve flags and interrupt latches |

All eight byte ALU operations use the register/memory pattern `10 ooo rrr`
and immediate pattern `11 ooo 110`. The `ooo` selector follows the rows below;
`rrr` selects B/C/D/E/H/L/(HL)/A. Register and `(HL)` forms are one byte;
immediate forms are two bytes. Indexed ALU forms use a DD/FD prefix and signed
displacement, for three bytes total; their encodings appear below.

| Operation | B | C | D | E | H | L | `(HL)` | A | Immediate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ADD | `80` | `81` | `82` | `83` | `84` | `85` | `86` | `87` | `C6` |
| ADC | `88` | `89` | `8A` | `8B` | `8C` | `8D` | `8E` | `8F` | `CE` |
| SUB | `90` | `91` | `92` | `93` | `94` | `95` | `96` | `97` | `D6` |
| SBC | `98` | `99` | `9A` | `9B` | `9C` | `9D` | `9E` | `9F` | `DE` |
| AND | `A0` | `A1` | `A2` | `A3` | `A4` | `A5` | `A6` | `A7` | `E6` |
| XOR | `A8` | `A9` | `AA` | `AB` | `AC` | `AD` | `AE` | `AF` | `EE` |
| OR | `B0` | `B1` | `B2` | `B3` | `B4` | `B5` | `B6` | `B7` | `F6` |
| CP | `B8` | `B9` | `BA` | `BB` | `BC` | `BD` | `BE` | `BF` | `FE` |

The unprefixed stack and subroutine families add 26 forms:

| Opcode | Instruction | Length | Scope |
| --- | --- | --- | --- |
| `C5/D5/E5/F5` | `PUSH BC/DE/HL/AF` | 1 | Predecrement SP; write high then low, wrapping at 16 bits |
| `C1/D1/E1/F1` | `POP BC/DE/HL/AF` | 1 | Read low then high; increment SP after each read |
| `CD` | `CALL nn` | 3 | Fetch target; push following PC; jump |
| `C4/CC/D4/DC/E4/EC/F4/FC` | `CALL cc,nn` | 3 | NZ/Z/NC/C/PO/PE/P/M; false paths fetch target without stack accesses |
| `C9` | `RET` | 1 | Pop PC without an extra increment |
| `C0/C8/D0/D8/E0/E8/F0/F8` | `RET cc` | 1 | Same conditions; false paths perform no stack accesses |

The remaining ordinary unprefixed families supply 53 forms:

| Opcode | Instruction | Forms | Scope |
| --- | --- | ---: | --- |
| `00` | `NOP` | 1 | Advance PC and R; preserve other state |
| `08/D9/EB/E3` | `EX AF,AF′` / `EXX` / `EX DE,HL` / `EX (SP),HL` | 4 | Exchange only the named registers/flags; stack exchange leaves SP fixed |
| `09/19/29/39` | `ADD HL,BC/DE/HL/SP` | 4 | Word addition; H from bit 11, C from bit 15; clear N and preserve S/Z/PV |
| `02/12/0A/1A` | `LD (BC)/(DE),A` / `LD A,(BC)/(DE)` | 4 | Indirect byte stores/loads; preserve flags |
| `3A` | `LD A,(nn)` | 1 | Absolute byte load; preserve flags |
| `22/2A` | `LD (nn),HL` / `LD HL,(nn)` | 2 | Low-first word stores/loads; wrap at 16 bits; preserve flags |
| `F9` | `LD SP,HL` | 1 | Copy the word; preserve flags |
| `03/13/23/33/0B/1B/2B/3B` | `INC/DEC BC/DE/HL/SP` | 8 | Wrap at 16 bits; preserve all flags |
| `34/35` | `INC/DEC (HL)` | 2 | Read then write once; byte INC/DEC flags, preserving C |
| `07/0F/17/1F` | `RLCA/RRCA/RLA/RRA` | 4 | Rotate A; replace C, clear H/N, preserve S/Z/PV |
| `27/2F/37/3F` | `DAA/CPL/SCF/CCF` | 4 | Decimal correction or accumulator/carry adjustment; CPU-specific flags |
| `C2/CA/D2/DA/E2/EA/F2/FA/C3/E9` | `JP cc,nn` / `JP nn` / `JP (HL)` | 10 | All eight conditions; fetch immediate targets on both paths; no target read |
| `C7/CF/D7/DF/E7/EF/F7/FF` | `RST 00H/08H/10H/18H/20H/28H/30H/38H` | 8 | Push following PC, jump to vector; ordinary calls preserving interrupt state |

CB's second byte uses `xx yyy rrr`. The `rrr` selector is B/C/D/E/H/L/(HL)/A;
`yyy` selects the rotate/shift when `xx=00`, or bit number 0–7 otherwise.
Every form below is two bytes including the CB prefix.

| Second-byte range | Instruction family | Forms | Scope |
| --- | --- | ---: | --- |
| `00`–`07` | RLC | 8 | Rotate left, outgoing bit also enters bit 0 |
| `08`–`0F` | RRC | 8 | Rotate right, outgoing bit also enters bit 7 |
| `10`–`17` | RL | 8 | Rotate left through C |
| `18`–`1F` | RR | 8 | Rotate right through C |
| `20`–`27` | SLA | 8 | Shift left, inserting zero |
| `28`–`2F` | SRA | 8 | Shift right, preserving sign |
| `38`–`3F` | SRL | 8 | Shift right, inserting zero |
| `40`–`7F` | BIT b | 64 | Test bit; no write; preserve C |
| `80`–`BF` | RES b | 64 | Clear bit; preserve all flags |
| `C0`–`FF` | SET b | 64 | Set bit; preserve all flags |

`CB 30`–`CB 37` are undocumented SLL forms and are excluded from both counts.
AF uses the existing six-flag model: PUSH writes F bits 5/3 as zero and POP
ignores them. BIT's unspecified S/PV behavior follows the independent reference
cases. The [model contract](z80/model.md#cb-rotates-shifts-and-bit-operations)
defines these policies and the ordered memory accesses.

### Indexed and ED forms

DD and FD implement the same 39 forms with IX and IY respectively. In this
table `index` means the selected register, and `ss` selects BC/DE/index/SP.

| Opcode after DD/FD | Family | Forms per prefix | Length including prefix |
| --- | --- | ---: | --- |
| `09/19/29/39` | ADD index,ss | 4 | 2 |
| `21`, `22/2A` | LD index,nn; LD (nn),index / index,(nn) | 3 | 4 |
| `23/2B` | INC/DEC index | 2 | 2 |
| `34/35`, `36` | INC/DEC (index+d); LD (index+d),n | 3 | 3; 4 for immediate store |
| `46/4E/56/5E/66/6E/7E` | LD r,(index+d), including real H/L | 7 | 3 |
| `70/71/72/73/74/75/77` | LD (index+d),r | 7 | 3 |
| `86/8E/96/9E/A6/AE/B6/BE` | Byte ALU (index+d) | 8 | 3 |
| `E1/E5`, `E3`, `E9`, `F9` | POP/PUSH index; EX (SP),index; JP (index); LD SP,index | 5 | 2 |

Each indexed-CB page adds **31** four-byte forms, `DD/FD CB d op`: the seven
shifts/rotates and eight each of BIT/RES/SET from the CB table, with final
`rrr=110`. BIT reads without writing; other forms read then write the indexed
byte. Undocumented SLL and register destinations are excluded. Displacements
are signed bytes, fetched before the final opcode; R advances twice.

| ED opcode | Family | Forms | Length including prefix |
| --- | --- | ---: | --- |
| `42/52/62/72`, `4A/5A/6A/7A` | SBC / ADC HL,BC/DE/HL/SP | 8 | 2 |
| `43/53/63/73`, `4B/5B/6B/7B` | LD (nn),BC/DE/HL/SP and reverse | 8 | 4 |
| `44` | NEG | 1 | 2 |
| `47/4F/57/5F` | LD I,A; LD R,A; LD A,I; LD A,R | 4 | 2 |
| `67/6F` | RRD / RLD | 2 | 2 |
| `A0/A8/B0/B8` | LDI / LDD / LDIR / LDDR | 4 | 2 |
| `A1/A9/B1/B9` | CPI / CPD / CPIR / CPDR | 4 | 2 |

Repeating blocks expose one byte transfer/comparison per step, rewinding PC
two bytes while repetition continues. An initial BC of zero permits 65,536
iterations; searches stop earlier on a match. Snapshots contain all state
needed to resume. See [block stepping](z80/model.md#block-copies-and-comparisons).

The port families add **24 forms**, all two bytes long:

| Opcode | Forms | Count | Address selection |
| --- | --- | ---: | --- |
| `DB/D3` | IN A,(n) / OUT (n),A | 2 | Old A supplies the high byte; n supplies the low byte |
| `ED 40/48/50/58/60/68/78` | IN B/C/D/E/H/L/A,(C) | 7 | Old BC, including when B/C is the destination |
| `ED 41/49/51/59/61/69/79` | OUT (C),B/C/D/E/H/L/A | 7 | BC |
| `ED A2/AA/B2/BA` | INI / IND / INIR / INDR | 4 | Old BC; decrement B after input |
| `ED A3/AB/B3/BB` | OUTI / OUTD / OTIR / OTDR | 4 | New BC after decrementing B |

All pass full 16-bit port addresses through the shared byte-port connection.
Repeating block I/O exposes one transfer per step; zero B allows 256 iterations.
Memory and device accesses share one ordered log. Flag rules, including H/PV
between repeat iterations, are in the [port contract](z80/model.md#port-input-and-output).

| Opcode | Instruction | Forms | Scope |
| --- | --- | ---: | --- |
| `F3/FB` | DI / EI | 2 | Clear/set both IFFs; EI defers IRQ through the next instruction |
| `ED 46/56/5E` | IM 0/1/2 | 3 | Select externally supplied instruction, fixed restart, or indirect vector entry |
| `ED 45/4D` | RETN / RETI | 2 | Restore PC/IFF1; RETI also notifies the device after retirement |

The [interrupt contract](z80/model.md#external-interrupt-delivery) defines
acceptance, HALT release, snapshot-preserved inhibition, supplied bytes,
stack/vector order, return notification, and failures.

| Area | Current coverage |
| --- | --- |
| Stored registers | A/B/C/D/E/H/L in main and alternate banks; IX, IY, PC, SP, I, R |
| Stored flags | S/Z/H/PV/N/C in both banks; undocumented F bits 3/5 and public raw F/AF views are omitted; stack AF packs/unpacks the six flags |
| Register relationships | Snapshots derive BC, DE, and HL in both banks; EX AF,AF′ exchanges A/flags, EXX exchanges BC/DE/HL, and EX DE,HL exchanges main pairs |
| Register operations | Memory and general-register loads preserve flags; byte INC/DEC replace S/Z/H/PV/N, preserving C; word INC/DEC preserve all flags; NOP preserves state except PC/R |
| Arithmetic and logic | All byte ALU forms, including indexed operands; ADC/SBC HL update all six flags; NEG, RLD/RRD; arithmetic P/V means overflow, logic P/V means parity; ADD HL updates H/N/C only; DAA handles addition/subtraction correction; CPL/SCF/CCF and accumulator rotates preserve S/Z/PV |
| Indirect transfers | Byte transfers through HL/IX/IY, A transfers through BC/DE, absolute A and all word-pair/index transfers; H/L destinations use the original address; HALT occupies the absent memory-to-memory transfer slot |
| Stack and subroutines | PUSH/POP BC/DE/HL/AF/IX/IY; CALL/RET and all eight conditions; RST vectors; EX (SP),HL/IX/IY reads low/high then writes high/low without moving SP |
| CB operations | All documented rotates/shifts, BIT/RES/SET on registers, (HL), and (IX/IY+d); BIT preserves C, RES/SET preserve all flags |
| Relative jumps | Unconditional JR and NZ/Z/NC/C conditions; signed displacement from PC after the operand, wrapping at 16 bits; fetch operand on every path |
| Absolute jumps | JP nn and all eight conditions; JP (HL/IX/IY) takes its target directly from the register; preserve flags and make no target read |
| Counted loops | DJNZ decrements B and tests its result while preserving all flags; zero wraps to FF; BC follows the updated B |
| Special registers and interrupt state | LD I/R,A and LD A,I/R; DI/EI, IM 0/1/2, RETI/RETN; IRQ/NMI offers with native entries and snapshot-preserved inhibition |
| Block operations | LDI/LDD/CPI/CPD and repeating counterparts; one iteration per step, 16-bit count/pointer wrapping, repeat refetches current code |
| Refresh register | Unprefixed fetch increments R bits 0–6 once; all supported prefixed forms increment twice, including indexed CB; LD R,A then replaces all eight bits |
| Reset | Clear PC/I/R, IFF1/IFF2, IM, and both inhibition latches; release HALT; preserve banks, flags, IX/IY/SP, and RAM under the documented model policy |
| Prefixes | CB/ED/DD/FD decode the second byte; indexed CB decodes four bytes; unsupported forms reject atomically after the encoding, without further operand/data accesses |
| Stopping | HALT reports its instruction once; already halted steps perform no accesses or refresh updates |
| Port I/O | IN/OUT immediate and all seven registers; eight block forms with native address/count order, wrapped HL, all six flags, and one iteration per step |
| Remaining instruction scope | None for documented forms; cycle timing, undocumented forms/flags, and the LD A,I/R interrupt-time P/V quirk remain unmodeled |
| Remaining addressing scope | None for documented forms |

The model covers documented instruction semantics for the listed forms, not
undocumented flag bits or cycle activity. In particular, a physical Z80 keeps
refreshing during HALT; the instruction-level halted state does not model
those cycles. See the [model contract](z80/model.md) for unsupported-attempt and
reset-preservation policies.

Verification: [CPU tests](../../tests/components/cpus/z80),
[arithmetic example tests](../../tests/machines/z80/example.test.ts),
[counted-loop example tests](../../tests/machines/z80/counted-loop-example.test.ts),
[transfer example tests](../../tests/machines/z80/transfers-example.test.ts),
[checksum example tests](../../tests/machines/z80/checksum-example.test.ts),
[bit-count example tests](../../tests/machines/z80/bit-count-example.test.ts),
[decimal-total example tests](../../tests/machines/z80/decimal-total-example.test.ts),
[indexed-buffer example tests](../../tests/machines/z80/indexed-buffer-example.test.ts), and
[public type checks](../../tests/types/z80.ts). ALU checks exhaust every byte operand
pair and both carry inputs for all eight operations against signed/unsigned
arithmetic, low-digit carries/borrows, and binary-string parity. Boundary
programs exercise all flag patterns alongside
the 8080, independently checking parity versus overflow. Other checks cover
all immediate-load bytes and flag patterns, nested state isolation, register
views, exact accesses, PC and R wrapping, current RAM, overlapping stores,
every unsupported first byte, HALT, reset, and retained records. The generated
example and runner checks verify complete records, final RAM, and bounded
resumption with the concrete Z80 types.
The transfer matrix checks every encoding and byte while cycling through all
flag patterns, with additional code-overlap and H/L aliasing cases. Immediate
memory stores check every byte and flag combination; pair loads check all four
selectors, boundary words, flag patterns, and wrapped fetches. The buffer-fill
example combines these loads with DJNZ and verifies its 23-step trace and RAM.
Register load and INC/DEC checks cover every byte and all 64 flag patterns,
signed overflow, half carry/borrow, carry preservation, pair views, and alternate
bank isolation. JR conditions cover every flag pattern; DJNZ covers every B
value and flag pattern. Every displacement is checked on each available path,
including wrapping and instruction overlap. All supported opcodes are checked
with every R value. Further checks cover live arithmetic flags, current
operands, and detached records. The counted loop checks ten complete records,
actual RAM calls, full memory images, refresh wrapping, HALT, bounded resumption,
reset and restart, and a zero initial count producing 256 iterations.

All nine forms of each ALU operation also check every incoming flag pattern,
A/H/L source aliases, operand fetching across FFFF, overlapping opcode/data
reads, live carry and RAM, unchanged alternate state, and retained records.
Paired 8080/Z80 checks distinguish their subtraction half-carry and logical
AND rules as well as arithmetic overflow versus parity. All 72 forms match
1,000 independent reference cases each; the
[arithmetic contract](z80/model.md#arithmetic-and-logic) documents those checks.

The checksum example checks 38 complete records for two-byte addition,
carry passed through loads, CP preserving A, both comparison failure paths,
refresh wrapping, HALT, bounded failure loops, snapshot resumption, reset,
full memory images, and fresh factories.

All 248 CB forms check every byte and both carry inputs with full state/access
records, plus all byte/raw F combinations for each operation/bit through POP AF.
Further checks cover prefix/R/PC boundaries, instruction/data overlap, repeated
reads, same-value writes, current RAM, and all unsupported CB forms. Stack and
subroutine checks cover every condition and flag pattern, word boundaries,
wrapped PC/SP, and overlapping code. All **274 CB/stack forms** also passed 1,000
independent reference cases each, projecting PUSH AF to the declared flag model;
see [checks and limits](z80/model.md#checks-and-limits).

The bit-count example totals the set bits in three bytes using CB shifts and
three call levels, then restores every main register and flag. It checks 151
complete records, full RAM, guards around the stack and buffer, resumption at
every instruction boundary, reset preservation, fresh factories, and zero/full
input buffers exercising both conditional-call paths.

The 53 further unprefixed forms passed **53,000 independent reference cases**.
Repository checks exhaust accumulator/flag combinations for rotates, DAA, and
carry/complement operations; valid decimal operand pairs for ADC/SBC followed
by DAA; word values for pair operations; and stack addresses for EX (SP),HL.
They also cover bank exchanges, all jump/restart conditions, wrapped and
overlapping instruction/data/stack addresses, live RAM, and retained records.
The decimal-total example checks 46 complete records, full RAM, both decimal
carry paths, preserved caller registers/flags, and resumption at every boundary.
Alternate inputs exercise decimal totals from zero through 396.

The 171 indexed/ED additions passed **171,000 independent reference cases**,
including complete modeled state, final RAM, fetched bytes, and ordered memory
accesses. Repository checks cover all new encoding/R combinations, both index
registers and every displacement, word/stack boundaries, every NEG input/flag
combination, special-register and IFF2 behavior, every nibble-rotate byte pair,
and every block-comparison byte pair. Block tests include overlapping copies,
rewritten code, early matches, zero-count wrapping, a full 65,536-byte copy,
and snapshot resumption. The indexed-buffer example verifies 24 complete records,
all match positions and failure, guarded full memory, and bounded resumption
at every step. See [checks and limits](z80/model.md#checks-and-limits).

Port tests check all byte/flag inputs, native 16-bit addresses, block count/data
combinations, repeat-phase flags, real transfer order, wrapping, code overlap,
and device/RAM failures. Runner checks pause and reconstruct CPU, RAM, and
device state independently at every boundary of an INIR/OTDR buffer program.
A supplementary comparison passed **24,000 independent emulator cases** across
all 24 I/O forms; see [checks and limits](z80/model.md#checks-and-limits).

Interrupt tests cover all modes, IFFs, inhibition and HALT behavior, nested NMI,
all mode-2 vector bytes, wrapped/overlapping stacks and vectors, mode-0 execution
of all documented forms, callback failures, and restoration at every boundary
of nested interrupt programs. All **7,000 independent instruction cases** for
the final seven forms passed; [checks and limits](z80/model.md#checks-and-limits)
distinguish those vectors from delivery and timing verification.

## 8088

[Source](../../src/components/cpus/8088.ts) ·
[Model contract](8088/model.md) ·
[Arithmetic example](8088/examples/arithmetic.md) ·
[Transfer example](8088/examples/transfers.md) ·
[Control-flow example](8088/examples/control-flow.md) ·
[Masked word-sum example](8088/examples/word-sum.md) ·
[Signed word transformation](8088/examples/word-transform.md) ·
[Decimal buffer example](8088/examples/decimal-buffer.md) ·
[PC reference review](8088/reference-notes.md)

| Opcode pattern / bytes | Instruction | Forms | Scope |
| --- | --- | ---: | --- |
| `00 ooo 0 d w` | ADD/OR/ADC/SBB/AND/SUB/XOR/CMP r/m,r or r,r/m | 32 | Both widths and directions; every register and memory operand choice |
| `00 ooo 10 w` | ADD/OR/ADC/SBB/AND/SUB/XOR/CMP AL/AX,n | 16 | Immediate byte/word; byte writes preserve AH |
| `000 ss 11p` (`06/0E/16/1E`, `07/17/1F`) | PUSH/POP segment | 7 | ES/CS/SS/DS pushes and ES/SS/DS pops; original SS for the entire access |
| `001 u s 111` (`27/2F/37/3F`) | DAA/DAS/AAA/AAS | 4 | Packed/unpacked decimal adjustment with original-chip AF/CF and byte behavior |
| `0100 s rrr` (`40`–`4F`) | INC/DEC r16 | 16 | All eight word registers; preserve CF, update PF/AF/ZF/SF/OF |
| `0101 p rrr` (`50`–`5F`) | PUSH/POP r16 | 16 | Descending SS:SP; original-8088 PUSH SP and POP SP behavior |
| `0111 ttt p` (`70`–`7F`) | Jcc rel8 | 16 | All sixteen conditions; fetch displacement on both paths |
| `80`, `81` + `mm ooo rrr` | Immediate ALU r/m8 or r/m16 | 16 | All eight operations and every operand choice |
| `82`, `83` + `mm ooo rrr` | Immediate ADD/ADC/SBB/SUB/CMP r/m | 10 | Byte for 82; sign-extended byte to word for 83; `/1`, `/4`, `/6` remain unused |
| `84`, `85` | TEST r/m,r | 2 | AND flags without a destination write |
| `86`, `87` | XCHG r/m,r | 2 | Both widths; read both original values before writes; resolve memory once |
| `88`–`8B` | MOV r/m,r or r,r/m | 4 | Both widths and directions; no destination read; preserve every flag |
| `8C`, `8E` | MOV r/m16,Sreg or Sreg,r/m16 | 2 | Four source segments; ES/SS/DS destinations; all legal operands |
| `8D` | LEA r16,m | 1 | Compute the effective offset without reading data |
| `8F` /0 | POP r/m16 | 1 | Resolve destination before popping; SP aliases and offset wrapping |
| `90`–`97` | XCHG AX,r16 / NOP | 8 | All word registers; 90 exchanges AX with itself; preserve every flag |
| `98`, `99` | CBW / CWD | 2 | Sign-extend AL to AX or AX to DX:AX; preserve flags |
| `9A` | Far CALL ptr16:16 | 1 | Push CS then following IP; change both CS and IP |
| `9B` | WAIT | 1 | Resumable TEST sampling, interrupt/trap restart, and recognition delay on release |
| `9C`–`9F` | PUSHF/POPF/SAHF/LAHF | 4 | Word and low-byte flag transfers with original reserved-bit policy |
| `A4`–`A7`, `AA`–`AF` | MOVS/CMPS/STOS/LODS/SCAS | 10 | Byte/word strings; DF controls direction; comparisons set subtraction flags |
| `A0`–`A3` | MOV AL/AX,[offset] or [offset],AL/AX | 4 | Direct offset in DS; word offsets wrap within the segment |
| `A8`, `A9` | TEST AL/AX,n | 2 | Immediate AND flags without changing AX |
| `B0`–`BF` | MOV r8/r16,n | 16 | All byte and word registers; preserve every flag |
| `C2`, `C3` | RET n / RET | 2 | Pop IP; optionally discard an unsigned byte count from SP |
| `C4`, `C5` | LES / LDS r16,m | 2 | Read a complete far pointer before changing either destination |
| `1100 11tt` (`CC`–`CF`) | INT3 / INT n / INTO / IRET | 4 | Native software entry and IP/CS/FLAGS return |
| `CA`, `CB` | RETF n / RETF | 2 | Pop IP then CS; optional unsigned parameter-byte discard |
| `C6`, `C7` /0 | MOV r/m,n | 2 | Immediate byte/word, all operand choices, no destination read |
| `D0`–`D3` /0–5, /7 | ROL/ROR/RCL/RCR/SHL/SHR/SAR | 28 | Both widths, count one or all eight bits of CL; /6 stays unsupported |
| `D4 0A`, `D5 0A`, `D7` | AAM / AAD / XLAT | 3 | Decimal radix adjustment or byte table lookup; AH and flag rules in the contract |
| `1101 1ooo` (`D8`–`DF`) + `mm ppp rrr` | ESC | 8 | Six-bit external opcode, every source, dummy word reads, and optional external delivery |
| `E0`–`E3` | LOOPNE/LOOPE/LOOP/JCXZ | 4 | Test post-decrement CX or original zero count; preserve flags |
| `1110 r 1 d w` (`E4`–`E7`, `EC`–`EF`) | IN / OUT | 8 | Immediate-byte or DX port; AL/AX; word transfers use two ordered bytes in wrapping 16-bit port space |
| `EA` | Far JMP ptr16:16 | 1 | Replace CS:IP from the complete immediate pointer |
| `E8` | CALL rel16 | 1 | Fetch displacement, push following IP, branch within CS |
| `E9`, `EB` | JMP rel16 / rel8 | 2 | Relative branch with 16-bit IP wrapping |
| `F4`, `F5`, `F8`, `F9`, `FC`, `FD` | HLT/CMC/CLC/STC/CLD/STD | 6 | Stored halt latch or one-flag update |
| `1111 101v` (`FA`, `FB`) | CLI / STI | 2 | Clear/set IF with snapshot-preserved recognition delay |
| `F6`, `F7` /0 | TEST r/m,n | 2 | Immediate AND flags without writing the operand |
| `F6`, `F7` /2–3 | NOT / NEG r/m | 4 | Both widths and every operand; NOT preserves flags, NEG sets subtraction flags |
| `F6`, `F7` /4–7 | MUL/IMUL/DIV/IDIV | 8 | Both widths and every operand; signed/unsigned results and type-0 divide-error delivery |
| `FF` /2–6 | Indirect near/far CALL/JMP, PUSH r/m16 | 5 | Capture targets/values before stack writes; far pointers require memory |
| `FE`, `FF` /0–1 | INC / DEC r/m | 4 | Both widths and every operand; preserve CF |
| **Total** | | **291** | **291 / 291 forms (100%)** |

The ALU field `ooo` selects ADD/OR/ADC/SBB/AND/SUB/XOR/CMP in that order.
For register/memory forms, `w=0/1` selects byte/word and `d=0/1` selects the
r/m or register destination. ModR/M is **`mm ggg rrr`**: `ggg` selects a
register or, in the immediate group, the operation. `mm` and `rrr` select
registers or memory through BX/BP/SI/DI combinations, optional displacement,
or a direct offset. BP-based addresses use SS; the direct-offset exception
uses DS. See the [addressing contract](8088/model.md#modrm-operands).

ModR/M register/address choices, immediates, displacements, and stack
adjustments remain operands rather than additional coverage forms. These
291 forms include every documented operand choice. All seven prefixes are
implemented as modifiers: segment overrides, LOCK without bus arbitration,
and REP/REPE/REPNE on their documented strings. Repetition executes one element
per step; its snapshot and refetch policy is in the [model contract](8088/model.md#prefixes-and-strings).

All documented forms are implemented, including the
[ESC and TEST/WAIT connections](8088/model.md#esc-and-testwait-connections).
Software interrupts, divide errors, external INTR/NMI, single-step traps, and
IRET now use native entry/return.
The [delivery contract](8088/model.md#external-interrupt-delivery) keeps external
requests with the caller and preserves recognition state in snapshots.

| Area | Implemented scope |
| --- | --- |
| Stored registers | AX/BX/CX/DX, SP/BP/SI/DI, CS/DS/SS/ES, IP; all 16-bit |
| Stored flags | CF/PF/AF/ZF/SF/TF/IF/DF/OF; packed transfers set reserved bits 15–12 and 1, clear bits 5/3 |
| Register views | Byte halves derived from word registers; byte writes preserve the other half; physical PC derives from CS:IP |
| Memory | Exactly 1 MiB RAM; segment × 16 + offset wraps at 20 bits; unaligned words are valid |
| Instruction fetching | CS:IP with IP wrapping at 16 bits between bytes; little-endian words and offsets |
| ModR/M | All documented register and effective-address choices, including segment overrides; resolve addresses once before data accesses |
| Data words | Low byte first; wrap each successive offset to 16 bits within the selected segment, then translate to the bus |
| Port transfers | All eight IN/OUT forms through `connections.ports` (BytePorts); AL/AX, immediate or DX selection, low-first words, wrapping ports, and one ordered memory/port log |
| Arithmetic and logic | ADD/ADC/SUB/SBB/CMP and OR/AND/XOR/TEST; width-specific flags, low-byte parity, nibble carry/borrow; logic clears undefined AF as a deterministic policy |
| Multiplication/division | Full byte/word signed and unsigned arithmetic; original signed quotient limits; type-0 divide-error delivery with native vectoring |
| Decimal and address transfers | DAA/DAS/AAA/AAS/AAM/AAD, CBW/CWD, LEA/LES/LDS, XLAT, and segment moves |
| Strings | All five byte/word families, both directions, source overrides, fixed ES destinations, zero-count and comparison termination |
| Unary operations | INC/DEC/NOT/NEG on byte/word registers or memory; immediate TEST; operand reads precede writes |
| Shifts and rotates | Seven documented operations in both widths, by one or CL=0–255; rotates preserve result flags; count zero preserves every flag; undefined OF for larger counts is preserved and undefined shift AF is cleared |
| Exchanges | Register pairs, AX short encodings, and register/memory; preserve flags, byte aliases, and resolved addresses; 90 is NOP |
| Control flow | Jcc, counted loops, JCXZ, relative/indirect near and immediate/indirect far CALL/JMP, near/far RET with optional cleanup; preserve flags |
| Stack | General/segment registers, FLAGS, and near/far return addresses; descending SS:SP, offset wrapping, original PUSH SP / POP SP behavior |
| Interrupts | Software entry, divide errors, INTR/NMI offers, sampled-TF traps, IRET, and snapshot-preserved IF/recognition delays |
| External synchronization | ESC decodes and reads an operand before optional device delivery; WAIT polls TEST, preserves waiting snapshots, admits interrupt/trap restart, and inhibits recognition on release |
| Halt | HLT advances IP and sets a stored latch; accepted entry releases it; an owed trap can continue through the runner |
| Reset | CS=FFFF, IP=0000, other segments, flags, halt/wait, and recognition latches clear; preserve general registers and RAM; no vector reads |
| Unsupported encodings | Retain prefixes and bytes actually fetched, reject invalid selectors before data; preserve all state and RAM |
| Prefixes | Four local segment overrides, LOCK with no bus effect, and bounded one-element repetition; last prefix of each kind wins |
| Remaining scope | A complete coprocessor, pin sampling/scheduling, timing, bus arbitration, and prefetch |

Verification: [CPU tests](../../tests/components/cpus/8088),
[arithmetic](../../tests/machines/8088/example.test.ts),
[transfer](../../tests/machines/8088/transfers-example.test.ts),
[control-flow](../../tests/machines/8088/control-flow-example.test.ts), and
[word-sum example tests](../../tests/machines/8088/word-sum-example.test.ts),
[transformation example tests](../../tests/machines/8088/word-transform-example.test.ts),
[decimal buffer tests](../../tests/machines/8088/decimal-buffer-example.test.ts),
plus [public type checks](../../tests/types/8088.ts). Checks include exhaustive
byte arithmetic/logic pairs, word sweeps and signed boundaries, incoming flag
patterns, every register selector and alias, each effective-address mode,
displacement sign extension, BP/DS segment distinctions, segment/bus wrapping,
exact read/write records, overlapping code and data, and atomic unsupported
attempts. Existing tests retain reset, current RAM, detached records,
conditional truth tables, every PUSH SP/POP SP value, and nested calls.

Port tests cover all eight forms, every immediate address and flag combination,
word-byte order and wrapping, rejected repetition, device failures, and reentrancy.
The [ESC comparison](8088/reference-notes.md#esc-and-wait-comparison) passes all
80,000 hardware-generated D8–DF cases, checking registers/flags, fetched bytes,
fixture RAM, and ordered operand reads. Local tests cover TEST waiting/release,
interrupt/trap restart, every flag pattern, ownership, and callback failures.
A [combined program](../../tests/machines/8088/external-connections.test.ts) restores
CPU/device state, interrupts and resumes WAIT, and continues through word output.
WAIT has manual/microcode evidence; no hardware pin-transition corpus was available.

The [port comparison](8088/reference-notes.md#port-input-and-output-comparison)
passes 80,000 hardware cases with exact I/O bus transfers. A runner program
uses all eight forms and restores CPU, full RAM, and device state at every boundary.

Interrupt tests check all vectors and flag combinations, recognition delays,
priority and single stepping, halted resumption, REP/IRET, byte-level failures,
and an interrupt handler that writes a port before returning. The
[interrupt comparison](8088/reference-notes.md#interrupt-comparison) passes
42,000 control-instruction hardware cases and 24,444 divide-error deliveries.

Combined programs check complete records, actual RAM calls, full memory images,
physical completion, bounded resumption, snapshot restoration, reset, and
restart. The 76-step word-sum program adds masked words into DX:AX with carry,
restores BX through a BP frame, skips zero inputs, and conditionally marks
an odd result in memory.

Unary checks exhaust every byte/word and both incoming carries. Byte shifts
cover every operand, all 256 counts, and both carries; word shifts cover every
value at count one and boundaries at every count. All new forms have operand,
flag, wrapping, overlap, and rejection checks. The 16-step transformation
program halves and negates a signed 32-bit value, records its discarded bit,
and writes big-endian output. Tests check signed boundaries, both branch paths,
resumption between shifts, edited RAM, reset, and fresh factories.

Completion checks add exhaustive byte multiplication and valid BCD arithmetic,
word-boundary division with independent BigInt expectations, every AAD/POPF
input word, segment and flag transfers, far-frame overlap, string directions,
prefixes, halt/reset, and atomic rejection. The decimal buffer example checks
52 exact records, full guarded RAM, snapshot resumption within REP and far calls,
unsigned input boundaries, edited source data, and restored FLAGS.

The expanded [hardware comparison](8088/reference-notes.md#ordinary-instruction-completion)
passes **2,423,129 cases across 267 forms**, including **460,629 cases across
62 added forms** and **24,444 divide-error boundaries**. HLT has no fixture
in that suite and is checked locally. Segment-prefixed cases now participate
for both old and new families; undocumented forms and prefetch-dependent REP
code overlap are excluded. Defined flags, state, bytes, final RAM, and accessed
addresses are compared; local tests check exact instruction-level ordering.

## 68000

[Source](../../src/components/cpus/68000.ts) ·
[Model contract](68000/model.md) ·
[Arithmetic example](68000/examples/arithmetic.md) ·
[Example definition](../../src/machines/68000/example.machine) ·
[Mac reference review](68000/reference-notes.md) ·
[Opcode-count audit](68000/opcode-count.md)

[Transfer example](68000/examples/transfers.md) ·
[Transfer definition](../../src/machines/68000/transfers-example.machine)

[Addressing example](68000/examples/addressing.md) ·
[Addressing definition](../../src/machines/68000/addressing-example.machine)

[Immediate ALU example](68000/examples/alu.md) ·
[ALU definition](../../src/machines/68000/alu-example.machine)

[Control-flow example](68000/examples/control-flow.md) ·
[Control-flow definition](../../src/machines/68000/control-flow-example.machine)

[Word-sum example](68000/examples/word-sum.md) ·
[Word-sum definition](../../src/machines/68000/word-sum-example.machine)

[Masked-merge example](68000/examples/logic.md) ·
[Logic definition](../../src/machines/68000/logic-example.machine)

[Stack-frame example](68000/examples/stack-frame.md) ·
[Stack-frame definition](../../src/machines/68000/stack-frame-example.machine)

[Unary and quick example](68000/examples/unary.md) ·
[Unary definition](../../src/machines/68000/unary-example.machine)

[Shifts and rotates example](68000/examples/shifts.md) ·
[Shifts definition](../../src/machines/68000/shifts-example.machine)

[Bit operations example](68000/examples/bits.md) ·
[Bits definition](../../src/machines/68000/bits-example.machine)

[Extended arithmetic example](68000/examples/extended.md) ·
[Extended definition](../../src/machines/68000/extended-example.machine)

[Decimal pipeline example](68000/examples/decimal-pipeline.md) ·
[Pipeline definition](../../src/machines/68000/decimal-pipeline-example.machine)

**All 36,029 documented forms are complete (100%)** within the
[model contract](68000/model.md). The instruction-word inventory contains
45,816 supported opwords; the coverage count collapses embedded literals.
RESET uses an explicit device connection; synchronous exceptions, trace,
external interrupt offers, STOP wakeup, and RTE are included. Illegal words and
line-A/line-F patterns also deliver their native exceptions without adding
documented opcode forms. Bus errors, timing, prefetch, and complete
devices remain separate.

MOVE and MOVEA
support every original-68000 source/destination combination and documented
index extension. The operation-word patterns below are binary. In MOVE,
`ddd mmm` selects the destination register then mode, while `sss rrr` selects
the source mode then register. Mode `001` in the destination selects MOVEA.

| Operation-word pattern | Instruction | Forms | Length | Scope |
| --- | --- | --- | --- | --- |
| `0000 000 0 ss mmm rrr` | `ORI.B/W/L #n,<ea>` | 150 | 4–10 | Three sizes × 50 data-alterable destinations; set NZ, clear VC, preserve X |
| `0000 001 0 ss mmm rrr` | `ANDI.B/W/L #n,<ea>` | 150 | 4–10 | Same sizes, destinations, and flags as ORI |
| `0000 010 0 ss mmm rrr` | `SUBI.B/W/L #n,<ea>` | 150 | 4–10 | Set X/N/Z/V/C; X and C report unsigned borrow |
| `0000 011 0 ss mmm rrr` | `ADDI.B/W/L #n,<ea>` | 150 | 4–10 | Set X/N/Z/V/C; X and C report unsigned carry |
| `0000 101 0 ss mmm rrr` | `EORI.B/W/L #n,<ea>` | 150 | 4–10 | Same sizes, destinations, and flags as ORI |
| `0000 110 0 ss mmm rrr` | `CMPI.B/W/L #n,<ea>` | 150 | 4–10 | Destination minus immediate; set NZVC, preserve X, no writeback |
| `0000 ooo0 0 f 111100` | ORI/ANDI/EORI #n,CCR/SR | 6 | 4 | ooo=000/001/101; f=0 CCR, 1 SR; masked status writes; SR privileged |
| `0000 1000 00 mmm rrr` | `BTST #n,<ea>` | 52 | 4–8 | Dn, memory, and PC-relative operands; test original bit, setting only Z |
| `0000 bbb 1 00 mmm rrr` | `BTST Dn,<ea>` | 424 | 2–6 | Eight bit-number registers × 53 operands; includes an immediate byte |
| `0000 1000 01 mmm rrr` | `BCHG #n,<ea>` | 50 | 4–8 | Complement bit in a data-alterable operand; Z describes original bit |
| `0000 bbb 1 01 mmm rrr` | `BCHG Dn,<ea>` | 400 | 2–6 | Eight bit-number registers × 50 data-alterable operands |
| `0000 1000 10 mmm rrr` | `BCLR #n,<ea>` | 50 | 4–8 | Clear bit in a data-alterable operand; Z describes original bit |
| `0000 bbb 1 10 mmm rrr` | `BCLR Dn,<ea>` | 400 | 2–6 | Eight bit-number registers × 50 data-alterable operands |
| `0000 1000 11 mmm rrr` | `BSET #n,<ea>` | 50 | 4–8 | Set bit in a data-alterable operand; Z describes original bit |
| `0000 bbb 1 11 mmm rrr` | `BSET Dn,<ea>` | 400 | 2–6 | Eight bit-number registers × 50 data-alterable operands |
| `0000 ddd 1 t s 001 aaa` | MOVEP.W/L | 256 | 4 | Eight data × eight address registers × two sizes × two directions; alternate-byte transfers |
| `00 01 ddd mmm sss rrr` | `MOVE.B <ea>,<ea>` | 2,650 | 2–10 | 53 sources × 50 data-alterable destinations; neither operand may be An |
| `00 10 ddd mmm sss rrr` (`mmm ≠ 001`) | `MOVE.L <ea>,<ea>` | 3,050 | 2–10 | 61 sources × 50 data-alterable destinations |
| `00 10 ddd 001 sss rrr` | `MOVEA.L <ea>,An` | 488 | 2–6 | 61 sources × 8 address registers; no flag changes |
| `00 11 ddd mmm sss rrr` (`mmm ≠ 001`) | `MOVE.W <ea>,<ea>` | 3,050 | 2–10 | 61 sources × 50 data-alterable destinations |
| `00 11 ddd 001 sss rrr` | `MOVEA.W <ea>,An` | 488 | 2–6 | Sign-extend the word into An; no flag changes |
| `0100 0000 ss mmm rrr` | `NEGX.B/W/L <ea>` | 150 | 2–6 | Zero minus operand minus X; cumulative Z; all data-alterable EAs |
| `0100 0010 ss mmm rrr` | `CLR.B/W/L <ea>` | 150 | 2–6 | Clear operand; set Z, clear NVC, preserve X; read memory before clearing |
| `0100 0100 ss mmm rrr` | `NEG.B/W/L <ea>` | 150 | 2–6 | Zero minus operand; subtraction flags; all data-alterable EAs |
| `0100 0110 ss mmm rrr` | `NOT.B/W/L <ea>` | 150 | 2–6 | Width-limited complement; set NZ, clear VC, preserve X |
| `0100 1010 ss mmm rrr` | `TST.B/W/L <ea>` | 150 | 2–6 | Set NZ from operand, clear VC, preserve X; no writeback; original-chip data-alterable EAs only |
| `0100 0000 11 mmm rrr` | MOVE SR,<ea> | 50 | 2–6 | Word destination; user mode permitted on original 68000; memory read before write |
| `0100 0100 11 mmm rrr` | MOVE <ea>,CCR | 53 | 2–6 | Word source, low five bits stored; preserve system flags |
| `0100 0110 11 mmm rrr` | MOVE <ea>,SR | 53 | 2–6 | Word source; mask unused bits; privileged |
| `0100 ddd 110 mmm rrr` | CHK.W <ea>,Dn | 424 | 2–6 | Signed bounds test; failed checks set N and deliver vector 6 after source updates |
| `0100 1000 00 mmm rrr` | NBCD <ea> | 50 | 2–6 | Decimal zero minus byte minus X; cumulative Z; preserve undefined NV |
| `0100 1010 11 mmm rrr` | TAS <ea> | 50 | 2–6 | Test original byte, then set bit 7; set NZ, clear VC, preserve X |
| `0100 1000 01 000 rrr` | SWAP Dn | 8 | 2 | Exchange words; set NZ, clear VC, preserve X |
| `0100 1000 1 s 000 rrr` | EXT.W/L Dn | 16 | 2 | Sign-extend byte to word or word to long; result flags |
| `0100 aaa 111 mmm rrr` | `LEA <ea>,An` | 224 | 2–6 | 28 control EAs × eight address registers; compute address without reading data; preserve flags |
| `0100 1000 01 mmm rrr` | `PEA <ea>` | 28 | 2–6 | Push a computed control EA as a long; preserve flags |
| `0100 1 d 00 1 s mmm rrr` | `MOVEM.W/L <list>,<ea>` / `<ea>,<list>` | 140 | 4–8 | Two sizes × (34 store + 36 load EAs); every mask; word loads sign-extend both register banks; preserve flags |
| `0100 1110 0101 0 rrr` | `LINK An,#d16` | 8 | 4 | Save An, establish frame, apply signed word allocation; preserve flags |
| `0100 1110 0101 1 rrr` | `UNLK An` | 8 | 2 | Restore frame and active stack, including A7 alias; preserve flags |
| `0100 1110 10 mmm rrr` | `JSR <ea>` | 28 | 2–6 | All control EAs; push full address after extensions; preserve flags |
| `0100 1110 11 mmm rrr` | `JMP <ea>` | 28 | 2–6 | All control EAs; validate target without a target read; preserve flags |
| `0100 1110 0111 0101` | `RTS` | 1 | 2 | Pop the full return address through active A7; preserve flags |
| `0100 1110 0110 d rrr` | MOVE An,USP / USP,An | 16 | 2 | Privileged full-long transfer; A7 selects SSP |
| `0100 1110 0111 0000` | RESET | 1 | 2 | Privileged device-reset callback; preserve CPU registers and flags |
| `0100 1110 0111 0001` | NOP | 1 | 2 | Advance PC only |
| `0100 1110 0111 0010` | STOP #SR | 1 | 4 | Privileged status load and stop; trace, accepted interrupt, or external reset wakes it |
| `0100 1110 0100 vvvv` | TRAP #n | 1 | 2 | All sixteen vectors 32..47; stack following PC and SR through SSP |
| `0100 1010 1111 1100` | ILLEGAL | 1 | 2 | Vector 4; stack the instruction start PC |
| `0100 1110 0111 0011` | RTE | 1 | 2 | Privileged six-byte SR/PC return through SSP; restore the selected stack bank |
| `0100 1110 0111 0110` | TRAPV | 1 | 2 | Vector 7 if V is set; otherwise advance PC |
| `0100 1110 0111 0111` | RTR | 1 | 2 | Restore CCR and full PC through active stack; preserve system state |
| `0101 qqq 0 ss mmm rrr` | `ADDQ.B/W/L #n,<ea>` | 166 | 2–6 | Counts 1–8; 50 byte or 58 word/long destinations; An uses all 32 bits and preserves flags |
| `0101 qqq 1 ss mmm rrr` | `SUBQ.B/W/L #n,<ea>` | 166 | 2–6 | Same sizes, counts, and destinations as ADDQ; data subtraction flags |
| `0101 cccc 11 mmm rrr` (`mmm ≠ 001`) | `Scc <ea>` | 800 | 2–6 | Sixteen conditions × 50 byte destinations; write FF/00; read memory first; preserve flags |
| `0101 cccc 11001 rrr` | `DBcc Dn,<label>` | 128 | 4 | All conditions/registers; decrement only Dn.W when false; preserve flags |
| `0110 0000 dddddddd` | `BRA <label>` | 2 | 2/4 | Signed byte/word displacement; preserve flags |
| `0110 0001 dddddddd` | `BSR <label>` | 2 | 2/4 | Push the full address after the instruction, then branch; preserve flags |
| `0110 cccc dddddddd` (`cccc=0010`–`1111`) | `Bcc <label>` | 28 | 2/4 | All fourteen conditions and both displacement forms; preserve flags |
| `0111 rrr 0 iiiiiiii` | `MOVEQ #n,Dn` | 8 | 2 | Sign-extend the embedded byte to a long; MOVE flags |
| `1000 rrr d ss mmm eee` | `OR.B/W/L <ea>,Dn` / `Dn,<ea>` | 2,280 | 2–6 | 53 data sources or 42 memory destinations; set NZ, clear VC, preserve X |
| `1000 ddd s11 mmm rrr` | DIVU/DIVS.W <ea>,Dn | 848 | 2–6 | Divide Dn.L by EA.W; packed remainder/quotient; overflow and zero-divisor policies |
| `1000 ddd 10000 m rrr` | SBCD | 128 | 2 | Register/predecrement decimal subtraction with X and cumulative Z |
| `1001 rrr d ss mmm eee` | `SUB.B/W/L <ea>,Dn` / `Dn,<ea>` | 2,408 | 2–6 | All legal source/memory-destination forms; set XNZVC from destination minus source |
| `1001 ddd 1 ss 00 0 rrr` | `SUBX.B/W/L Dn,Dn` | 192 | 2 | Three sizes × 64 register pairs; destination minus source minus X; cumulative Z |
| `1001 ddd 1 ss 00 1 rrr` | `SUBX.B/W/L -(An),-(An)` | 192 | 2 | Same arithmetic; two predecrement operands, source before destination |
| `1001 rrr s11 mmm eee` | `SUBA.W/L <ea>,An` | 976 | 2–6 | Sign-extend word source; full 32-bit subtraction; preserve all flags |
| `1011 rrr 0 ss mmm eee` | `CMP.B/W/L <ea>,Dn` | 1,400 | 2–6 | Set NZVC from Dn minus source; preserve X; no writeback |
| `1011 rrr 1 ss mmm eee` | `EOR.B/W/L Dn,<ea>` | 1,200 | 2–6 | Eight sources × three sizes × 50 data-alterable destinations; logic flags |
| `1011 ddd 1 ss 001 rrr` | `CMPM.B/W/L (An)+,(An)+` | 192 | 2 | Three sizes × 64 pointer pairs; destination minus source; replace NZVC, preserve X, no writeback |
| `1011 rrr s11 mmm eee` | `CMPA.W/L <ea>,An` | 976 | 2–6 | Sign-extend word source; full 32-bit comparison; preserve X; no writeback |
| `1100 rrr d ss mmm eee` | `AND.B/W/L <ea>,Dn` / `Dn,<ea>` | 2,280 | 2–6 | Same sizes, sources, destinations, and flags as OR |
| `1100 ddd s11 mmm rrr` | MULU/MULS.W <ea>,Dn | 848 | 2–6 | Word operands to full-long result; signed/unsigned; preserve X |
| `1100 ddd 10000 m rrr` | ABCD | 128 | 2 | Register/predecrement decimal addition with X and cumulative Z |
| `1100 ddd 1 ooooo rrr` | EXG | 192 | 2 | ooooo=01000 Dn/Dn, 01001 An/An, 10001 Dn/An; full longs, no flags |
| `1101 rrr d ss mmm eee` | `ADD.B/W/L <ea>,Dn` / `Dn,<ea>` | 2,408 | 2–6 | All legal source/memory-destination forms; set XNZVC from addition |
| `1101 ddd 1 ss 00 0 rrr` | `ADDX.B/W/L Dn,Dn` | 192 | 2 | Three sizes × 64 register pairs; destination plus source plus X; cumulative Z |
| `1101 ddd 1 ss 00 1 rrr` | `ADDX.B/W/L -(An),-(An)` | 192 | 2 | Same arithmetic; two predecrement operands, source before destination |
| `1101 rrr s11 mmm eee` | `ADDA.W/L <ea>,An` | 976 | 2–6 | Sign-extend word source; full 32-bit addition; preserve all flags |
| `1110 ccc d ss i 00 rrr` / `1110 0 00 d 11 mmm rrr` | `ASR/ASL` | 516 | 2–6 | Byte/word/long Dn; word memory; ASL retains intermediate sign-change overflow |
| `1110 ccc d ss i 01 rrr` / `1110 0 01 d 11 mmm rrr` | `LSR/LSL` | 516 | 2–6 | Same sizes/counts; shift zeros in, last outgoing bit to XC, clear V |
| `1110 ccc d ss i 10 rrr` / `1110 0 10 d 11 mmm rrr` | `ROXR/ROXL` | 516 | 2–6 | Rotate through X; copy X into C even at count zero; clear V |
| `1110 ccc d ss i 11 rrr` / `1110 0 11 d 11 mmm rrr` | `ROR/ROL` | 516 | 2–6 | Rotate within operand width; preserve X, clear V, last outgoing bit to C |

ADD/SUB/CMP use `ss=00/01/10` for byte/word/long. Direction `d=0`
reads any EA except byte An; `d=1` permits only memory-alterable destinations.
Address arithmetic uses `s=0/1` for word/long sources and accepts all 61 EAs.
The [arithmetic contract](68000/model.md#register-and-address-arithmetic)
defines widths, flag preservation, and source/destination pointer aliases.

ADDX/SUBX each contribute `3 × 2 × 8 × 8 = 384` forms; CMPM contributes
`3 × 8 × 8 = 192`. All use one operation word. Extended arithmetic preserves
Z on a zero result and consumes X; CMPM replaces Z and preserves X. Their
[paired-operand contract](68000/model.md#extended-arithmetic-and-memory-comparison)
defines source-first auto-updates, same-register aliases, and atomic faults.

AND/OR exclude An sources in every size, with the same memory destinations as
ADD/SUB. EOR uses only direction 1 and also permits Dn destinations. All three
preserve X and control state, set NZ from the selected width, and clear VC.
The [logic contract](68000/model.md#register-and-memory-logic) defines result
preservation and read/modify/write behavior, including unchanged-value writes.

Immediate ALU size `ss` is `00` byte, `01` word, `10` long; `11` is reserved.
The destination `mmm rrr` allows Dn, indirect, postincrement, predecrement,
displacement/index, and absolute word/long addresses. An direct, PC-relative,
and immediate destinations are excluded. ORI/ANDI/EORI to CCR/SR remain
unsupported and are not included in these counts. The immediate is fetched
before address extensions; each memory operand is resolved once. CMPI still
performs address auto-updates, despite doing no writeback.

Bit operations use long Dn operands (bit number modulo 32) and byte operands
elsewhere (modulo 8). Bit-number values do not multiply the count: BTST has
`52 + 8 × 53 = 476` forms, while each modifying operation has
`50 + 8 × 50 = 450`. Only Z changes, describing the bit before modification.
The [bit-operation contract](68000/model.md#bit-operations) defines legal EAs,
extension fetching, register aliases, and address updates.

MOVE/MOVEQ set N/Z from the transferred size, clear V/C, and preserve X and
control state. Byte/word writes to Dn preserve the upper register bits.
See the [effective-address contract](68000/model.md#effective-addresses) for
mode encodings, extension words, and auto-update sequencing.

BRA/BSR/Bcc use the signed embedded byte unless it is `00`, which fetches one
signed extension word. `FF` remains byte displacement −1 on the original chip.
Branch and DBcc targets use the opcode address plus two as their base. DBcc
falls through without decrementing if its condition is true; otherwise it
decrements Dn.W and branches unless the result is `FFFF`. The
[control-flow contract](68000/model.md#control-flow-and-subroutines) defines
stack behavior and address-error delivery for unaligned taken targets.

LEA/PEA/JMP/JSR accept only control EAs. MOVEM stores also permit
predecrement, excluding PC-relative forms; loads also permit postincrement.
Its mask precedes EA extensions, reverses register numbering for predecrement,
and never multiplies the coverage count. See the
[address and register-list contract](68000/model.md#address-calculations-and-register-lists)
and [frame contract](68000/model.md#stack-frames) for base-register aliases,
word sign extension, LINK/UNLK A7 behavior, and empty-mask policy.

Quick arithmetic encodes eight as `qqq=000`; the operand choices do not
multiply completion forms. Size `ss=11` instead selects Scc/DBcc. Unary
operations and Scc share the data-alterable destination path; CLR and Scc
read memory before writing on the original 68000, while TST reads without
writing. The [quick/unary contract](68000/model.md#quick-arithmetic-unary-operations-and-condition-bytes)
defines flag preservation, full-width An arithmetic, and NEGX's cumulative Z.

Shift direction `d=0/1` means right/left. Register sizes `ss=00/01/10` mean
byte/word/long; `i=0` uses an immediate 1–8 count (`ccc=000` means eight),
while `i=1` reads the low six bits of Dccc. Memory forms always shift a word
once and permit only the 42 memory-alterable EAs. Each pair contributes
`2 × (3 × (8 + 64) + 42) = 516` forms; immediate count values do not multiply
the total. All operations set NZ, including at zero count. The
[shift contract](68000/model.md#shifts-and-rotates) defines zero-count XC,
intermediate overflow, register aliases, and memory updates.

| Area | Implemented scope |
| --- | --- |
| Stored state | D0–D7, A0–A6, USP/SSP, and PC as unsigned 32-bit values; X/N/Z/V/C/T/S and three-bit interrupt mask; IR, Boolean `halted`/`faulted`/`tracePending` latches, and pending-entry context |
| Views | A7 derived from S and USP/SSP; physical PC derived from the low 24 bits of PC |
| Transfers | Complete MOVE.B/W/L, MOVEA.W/L, and MOVEM.W/L families; MOVEQ; partial Dn writes and sign-extended address-register word writes |
| Immediate ALU | ADDI, SUBI, CMPI, ANDI, ORI, EORI in all three sizes and data-alterable modes; preserve upper Dn bits on byte/word writes |
| Bit operations | BTST, BCHG, BCLR, BSET with immediate/register bit numbers; long Dn or byte operands; only Z changes, describing the original bit |
| Register/address ALU | ADD, SUB, CMP, ADDA, SUBA, CMPA; all documented sizes and EAs, with shared destination execution and arithmetic helpers |
| Paired ALU | ADDX/SUBX in register/predecrement forms, CMPM with two postincrement operands; all sizes and register pairs; shared operand execution and extended arithmetic with NEGX |
| Quick/unary ALU | ADDQ/SUBQ, CLR, NEG, NEGX, NOT, TST; all sizes and legal EAs, with cumulative Z for NEGX and full-width flag-preserving An quick arithmetic |
| Condition bytes | All Scc conditions and data-alterable EAs; FF/00 results without flag changes |
| Shifts and rotates | ASL/ASR, LSL/LSR, ROXL/ROXR, ROL/ROR; all register sizes, immediate/register counts, and word memory forms; shared one-bit helpers with CPU-specific flags |
| Register/memory logic | AND, OR, EOR in all three sizes and legal directions/address sets; shared ALU execution and width-aware flag handling |
| Effective addresses | Dn, An, indirect, postincrement, predecrement, signed displacement/index, absolute word/long, PC displacement/index, immediate; restrictions above |
| Memory | 16 MiB address space through `MemoryConnection` (including plain RAM); mask each physical address, preserving full register values; big-endian bytes, words, and longs |
| Instruction fetching | Even PC; 16-bit operation word; word/long extensions; sequential and branch PC wrap at 32 bits; no target prefetch |
| Control flow | BRA/Bcc, DBcc, BSR/RTS, JMP/JSR; complete conditions, displacement forms, and counter registers |
| Alignment | Odd instruction/word/long accesses enter vector 3 with a seven-word frame; byte operands remain valid; [staged operand and terminal-halt policy](68000/model.md#address-errors) |
| Bus errors | Explicit failed bytes enter vector 2; shared extended frame, partial effects, first-handler-fetch context, and terminal halt on a second fault; [recovery contract](68000/model.md#bus-errors) |
| Stack and addresses | A7 selects USP/SSP from S; BSR/JSR push and RTS pops a four-byte return address; LINK/UNLK frames, LEA/PEA address calculation, MOVEM saves/restores; byte auto-updates step by two |
| Reset | Read SSP from bytes 0–3 and PC from 4–7; set S, clear T, mask interrupts, clear STOP/pending trace and release terminal halt when both vectors succeed and the PC is even; preserve other registers, condition codes, and RAM under the documented policy |
| Decimal and multiply/divide | ABCD/SBCD/NBCD, MULU/MULS/DIVU/DIVS; cumulative decimal Z, packed remainder/quotient, explicit undefined-flag policies |
| Further transfers | MOVEP alternate-byte RAM transfers, EXG, EXT, and SWAP; every documented form |
| Status and control | Packed CCR/SR moves and immediate logic, USP moves, RTR, CHK, TAS, NOP, and STOP; native privilege/bounds/divide-zero delivery |
| Stopping | STOP loads SR and sets `halted`; traced STOP permits the next trace step; accepted interrupt/trace/reset wakes it |
| Exceptions | Six-byte supervisor frames, synchronous and trace vectors, all illegal and line-A/line-F encodings, external interrupt acknowledgement, saved PC/SR, and RTE; [entry and failure contract](68000/model.md#synchronous-exception-entry-and-return) |
| External controls | [Selected level offers](68000/model.md#external-interrupt-delivery), all vector bytes, autovectors/spurious response, trace priority, STOP wakeup, and [RESET callback](68000/model.md#reset-device-connection) |
| Remaining scope | Complete devices, signal sampling, timing, prefetch, and hardware-level partial-instruction fault sequencing |

Verification: [CPU tests](../../tests/components/cpus/68000.test.ts),
[bus-error tests](../../tests/components/cpus/68000/bus-errors.test.ts),
[ROM boot and mapped memory](../../tests/machines/68000/rom-boot-example.test.ts),
[ROM output and device reset](../../tests/machines/68000/output-example.test.ts),
[polling echo and consuming reads](../../tests/machines/68000/echo-example.test.ts),
[arithmetic](../../tests/machines/68000/example.test.ts),
[register-transfer](../../tests/machines/68000/transfers-example.test.ts),
[addressing](../../tests/machines/68000/addressing-example.test.ts),
[immediate ALU](../../tests/machines/68000/alu-example.test.ts),
[control-flow](../../tests/machines/68000/control-flow-example.test.ts),
[word-sum](../../tests/machines/68000/word-sum-example.test.ts),
[masked-merge](../../tests/machines/68000/logic-example.test.ts),
[stack-frame](../../tests/machines/68000/stack-frame-example.test.ts),
[unary](../../tests/machines/68000/unary-example.test.ts),
[shifts](../../tests/machines/68000/shifts-example.test.ts),
[bit operations](../../tests/machines/68000/bits-example.test.ts), and
[extended arithmetic example tests](../../tests/machines/68000/extended-example.test.ts),
[decimal pipeline tests](../../tests/machines/68000/decimal-pipeline-example.test.ts),
plus [interrupt/trace/RESET programs](../../tests/machines/68000/interrupts.test.ts),
[illegal/emulator-line handlers](../../tests/machines/68000/emulator-lines.test.ts),
and [public type checks](../../tests/types/68000.ts).

The [ROM-boot example](68000/examples/rom-boot.md) connects separate ROM and
RAM through a fixed memory map, takes an unmapped-access bus error, records
the fault address, and resumes through RTE. Tests check all ten steps and local
component accesses, immutable ROM, full RAM contents, reset, and restoration
at every boundary.

The [ROM-output example](68000/examples/output.md) sends six bytes through a
memory-mapped device. Its 17 steps verify distinct host notifications for
repeated bytes, device RESET, inspection and restoration without replay,
and retained output before a later byte transfer faults.
The [echo example](68000/examples/echo.md) reuses the same input/output devices
as the 8080. Checks include pending input, captured D0, restoration at every
boundary, and consumption that survives a later fault during a long read.

Completion checks execute all new register/EA forms. Decimal expectations use
integer arithmetic on all valid packed operands and incoming X/Z; multiply
and divide use independent BigInt products, quotients, and remainders across
word operands and signed limits. Tests cover every status word and MOVEP
displacement, EXG aliases, EXT/SWAP word inputs, original-value TAS flags,
privilege/alignment rejection, zero-divisor retry, CHK bounds, RTR stack/target
faults, and STOP/reset/snapshot behavior. The 26-step decimal pipeline checks
complete records and resumption at every instruction boundary.

The independent transfer fixtures execute all **9,726 MOVE/MOVEA encodings**
in both user and supervisor modes, checking complete state, instruction bytes,
actual RAM accesses, and touched memory with guards. Further checks cover all
65,536 index extension words with An and PC bases and both active stacks;
every displacement/absolute-short word; size-specific flags and upper-register
preservation; source/destination aliases; unsigned register and physical-bus
wrapping; overlapping code and data; every word/long memory form's alignment
rejection; and exception delivery for every word outside the instruction
inventory. Existing tests retain independent BigInt addition expectations,
reset, live operands, and detached records.

Immediate ALU checks execute all **900 legal forms** with all 128 incoming flag
patterns, exhaust every byte operand pair for each family, and check word/long
boundaries against independent signed/unsigned ranges and logic truth tables.
They check memory read/write order, partial-register preservation, identity
writes, CMPI without writes, both stacks, ignored immediate high bytes, wrapped
addresses, overlapping code/data, staged operand updates on alignment faults, and retrying with
changed RAM. The 16-step ALU example combines all six families, all three sizes,
RAM transformations, comparison auto-updates, and bounded running/reset checks.

The 18-step addressing program copies mixed-size data through RAM, saves and
restores a word through A7, and distinguishes partial Dn writes from MOVEA's
sign extension. Tests specify literal complete traces, full memory images,
logical completion, bounded resumption, snapshot restoration, and execution
through SSP after reset without altering the inactive user stack.

Control-flow tests cover all condition codes and incoming flags, every embedded
branch byte, every word displacement for BRA/BSR/DBF, all DBcc registers, and
every low-word counter for DBT/DBF. Checks preserve upper words and flags,
exercise both stacks and wrapping, compare actual RAM accesses, and reject
unaligned targets/stack operands before committing their staged instruction changes. The 36-step
control-flow example processes a buffer through nested calls, takes both sides
of a conditional branch, completes a counted loop, and resumes from snapshots
with two live return addresses. Tests also check full RAM images, supervisor
execution after reset, corrected faults, and bounded infinite loops.

Register/address arithmetic tests execute all **9,144 added forms**, including
all register selectors, both stacks, and exact reads/writes. They exhaust every
byte operand pair and sign-extended word, check word/long boundaries with all
128 flag patterns, and exercise same-An auto-updates, wrapping, overlapping
code/data, odd bytes, and word/long address-error delivery before operand commits. The 32-step
word-sum program cross-checks register and memory sums, applies a correction,
and repositions pointers while preserving comparison flags. Tests check full
traces and RAM images, bounded running, snapshot resumption, and changed input.

Register/memory logic checks execute all **5,760 added forms** in both modes,
exhaust byte operand pairs against bit truth tables, and cover every result bit
and incoming flag pattern. They verify EOR register aliases, partial Dn writes,
high-bit long results, unchanged memory writes, wrapping, overlapping code/data,
staged operand updates on alignment faults, and excluded neighboring instructions. The 42-step
masked-merge example combines AND/OR on registers and memory, EOR mask inversion
and checksum accumulation, an OR summary, and a counted loop. Tests specify
complete records and RAM images, including unchanged writes, and check snapshot
resumption between a destination clear and merge, live masks, and reset.

Address and frame checks cover all **464 added forms**, every MOVEM mask in
both sizes/directions, every word sign extension and LINK allocation, and
flag preservation. They check original/discarded base values, both active
stacks, A7 frame aliases, empty lists, physical/logical wrapping, overlapping
code/data, and atomic faults. The sixteen-step stack-frame program combines
all seven families with a signed array sum, saved registers, and a local
result. Tests check complete records and RAM images, snapshot resumption,
live input, and reset preservation.

Quick/unary checks cover all **1,882 added forms**, all eight quick operands,
every byte and flag pattern for each unary family, and every Scc condition/EA
with every flag pattern. Independent arithmetic checks cover word/long bit
boundaries, every NEGX word with both X/Z inputs, and full-width quick An
arithmetic. Memory tests check original-chip CLR/Scc reads, unchanged writes,
TST without writes, both stacks, wrapping, code overlap, and atomic rejection.
The 56-step unary example classifies signed words and negates a two-long value,
checking complete traces and RAM, live inputs, reset, and restoration between
NEGX instructions with preserved extend and cumulative-zero state.

Shift checks cover all **2,064 added forms** (3,408 operation words with
embedded counts expanded), every byte with counts 0–63 and both X inputs,
all immediate counts and register aliases, word/long bit boundaries, and
all incoming flag patterns. Independent BigInt shifts and bit-string rotations
check results and flags, including zero/large counts and ASL's intermediate
overflow. Memory checks cover all EAs, actual read/write calls, both stacks,
wrapping, unchanged results, code overlap, and staged operand updates on alignment faults.
The 32-step shifts example combines all eight operations in packed-sample
processing and two-word shifts, with complete traces and RAM images, live
inputs, reset preservation, and restoration between carry-dependent words.

Bit checks cover all **1,826 added forms**, every byte value and bit-number
byte, every immediate bit-number extension word, and all long bit positions
and incoming flag patterns. Independent bit-string expectations check results
and Z from the original bit. Address checks cover register/index aliases,
static and dynamic PC-relative bases, the dynamic BTST immediate byte, both
stacks, wrapping, unchanged writes, overlapping code/data, and excluded modes.
The 33-step bits example builds a register bitmap, toggles byte bits, and
classifies their previous state. Tests check complete records and RAM, live
input, reset preservation, and snapshot resumption before a saved-Z condition.

Paired ALU checks cover all **960 added forms** with every incoming flag
pattern, every byte operand pair with all X/Z combinations, and word/long
boundaries against independent BigInt arithmetic. Checks verify complete state,
partial registers, source/destination access order, unchanged writes, both
stacks, same-An updates, wrapping, overlapping code/data, and alignment faults
at either operand with byte-instruction retries. The 29-step extended example
adds and restores a 64-bit memory value, adjusts its register copy, and compares
the restored buffer. Tests check complete records and RAM images in both modes,
live input, reset, and four snapshots between low/high carry or borrow steps.

## CPUs and variants not started

These targets have no implementation in this repository. The existing NMOS
6502 subset does not establish the behavior of its intended variants.
The [CPU scope document](scope.md#intended-eventual-scope) owns target selection and
machine associations.

These targets are at 0% opcode completion. Establish each denominator and
its counting rules when implementation starts.

| CPU or variant | Opcode completion | Dromaios implementation |
| --- | --- | --- |
| MOS 6507 | 0% | Not started |
| MOS 6510 | 0% | Not started |
| Ricoh 2A03 | 0% | Not started |
| Sharp SM83 | 0% | Not started |
| Intel 8086 | 0% | Not started as a separate model |
| Intel 80286 | 0% | Not started |
| Intel 80386 | 0% | Not started |
| ARM2 | 0% | Not started |
| ARM7TDMI | 0% | Not started |

## Keeping this tracker current

When support changes, update the relevant opcode rows, complete and partial
counts, percentages, restrictions, and feature status in the same change.
Refresh source-line counts whenever a CPU implementation file changes:

```sh
wc -l src/components/cpus/{8008,8080,6800,6502,z80,6809,8088,68000}.ts
```

Keep each denominator tied to its stated CPU variant and counting rules.
Link to the tests, model contracts, and example specifications that establish
the behavior. Keep current progress here; update the relevant contract or
specification when its behavior or acceptance criteria change, and update
overview documents when scope, milestones, architecture, or workflow changes.
