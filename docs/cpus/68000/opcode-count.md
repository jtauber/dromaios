# 68000 documented opcode count

The coverage denominator is **36,029 forms** for the original Motorola 68000.
It expands register and effective-address selectors in the operation word,
while treating literal operand values as operands. It follows the shared
[coverage rules](../coverage.md#how-the-percentages-are-counted).

The basis is Motorola's [M68000 Family Programmer's Reference Manual](https://www.nxp.com/docs/en/reference-manual/M68000PRM.pdf),
chapter 4 instruction formats and permitted addressing tables, chapter 8's
format summary, and appendix A's original MC68000/MC68008 instruction summary.
Later-family forms are excluded, including long branch displacements, MOVE
from CCR, MOVEC, MOVES, RTD, BKPT, and later effective-address extensions.

## Counting conventions

- Byte, word, and long operations count separately where separately encoded.
- Register selectors in the operation word expand to all eight registers.
  Address-register selectors within effective addresses also expand.
- MOVE's source and destination fields expand independently. MOVEA is counted
  separately from MOVE, with no overlap.
- Immediate data, addresses, displacements, bit numbers, TRAP vectors, and
  quick counts do not multiply forms, even when embedded in the operation word.
- Thus MOVEQ has eight forms, one per destination register. ADDQ/SUBQ counts
  1–8 are one operand range; immediate shift counts are likewise one range.
  Register-supplied shift counts expand the source register selector.
- Branch byte displacement and extension-word displacement count separately.
  On the original 68000, embedded `FF` still means byte displacement −1;
  it does not introduce a long extension.
- Extension-word choices do not add forms. This includes index registers and
  sizes, and MOVEM register masks. A form needs all documented choices before
  receiving completion credit.
- Mnemonic aliases count once. Reserved words, line-A/line-F emulator traps,
  and undocumented encodings are excluded. The explicit ILLEGAL instruction
  counts once. Privileged instructions remain in the total.

## Effective-address sets

These counts include register selectors but exclude extension-word operands:

| Set | Calculation | Count |
| --- | --- | --- |
| All addressing forms | Modes 0–6: 7 × 8; mode 7: absolute word/long, PC displacement/index, immediate | 61 |
| Data addressing | All except address-register direct | 53 |
| Data addressing without immediate | Data addressing minus immediate | 52 |
| Memory alterable | Indirect, postincrement, predecrement, displacement, index: 5 × 8; absolute word/long | 42 |
| Data alterable | Dn: 8; memory alterable: 42 | 50 |
| Alterable | Data alterable plus An: 8 | 58 |
| Control | Indirect, displacement, index: 3 × 8; absolute word/long and PC displacement/index | 28 |
| Control alterable | Control minus the two PC-relative forms | 26 |

The original-68000 restrictions matter: MOVE.B cannot read An; ADD/SUB/CMP
word and long sources can. AND/OR sources cannot read An. Dynamic BTST accepts
immediate as its tested operand, while static BTST does not. TST and CMPI lack
the later-family additional addressing forms.

## Family audit

All numbers and arithmetic below are decimal. A grouped row gives the total
for every named instruction, not the count for each one.

| Instruction family | Calculation | Forms |
| --- | --- | --- |
| MOVE | Byte: 53 × 50; word/long: 2 × 61 × 50 | 8,750 |
| MOVEA | 2 sizes × 61 sources × 8 destinations | 976 |
| MOVEQ | 8 destinations | 8 |
| MOVE to CCR/SR, from SR, and USP transfers | 2 × 53 + 50 + 2 × 8 | 172 |
| MOVEM | 2 sizes × (34 stores + 36 loads) | 140 |
| MOVEP | 2 sizes × 2 directions × 8 × 8 registers | 256 |
| EXG | 3 register-bank combinations × 8 × 8 | 192 |
| LEA | 28 sources × 8 destinations | 224 |
| PEA | 28 control addresses | 28 |
| LINK, UNLK | 2 × 8 address registers | 16 |
| EXT, SWAP | 2 EXT sizes × 8 + 8 SWAP | 24 |
| ADD, SUB | 2 × (8 × (53 + 61 + 61) + 3 × 8 × 42) | 4,816 |
| ADDA, SUBA | 2 × 2 sizes × 8 destinations × 61 sources | 1,952 |
| ADDI, SUBI | 2 × 3 sizes × 50 destinations | 300 |
| ADDQ, SUBQ | 2 × (50 byte + 58 word + 58 long) | 332 |
| ADDX, SUBX | 2 × 3 sizes × 2 addressing forms × 8 × 8 | 768 |
| CMP | 8 destinations × (53 byte + 61 word + 61 long) | 1,400 |
| CMPA | 2 sizes × 8 destinations × 61 sources | 976 |
| CMPI | 3 sizes × 50 destinations | 150 |
| CMPM | 3 sizes × 8 × 8 address registers | 192 |
| AND, OR | 2 × 3 sizes × 8 registers × (53 sources + 42 destinations) | 4,560 |
| EOR | 3 sizes × 8 sources × 50 destinations | 1,200 |
| ANDI, ORI, EORI, including CCR/SR | 3 × (3 sizes × 50 destinations + 2 status forms) | 456 |
| CLR, NEG, NEGX, NOT, TST | 5 × 3 sizes × 50 addresses | 750 |
| ABCD, SBCD | 2 × 2 addressing forms × 8 × 8 registers | 256 |
| NBCD | 50 data-alterable addresses | 50 |
| MULS, MULU, DIVS, DIVU | 4 × 8 registers × 53 sources | 1,696 |
| BCHG, BCLR, BSET | 3 × (8 dynamic sources + 1 immediate form) × 50 destinations | 1,350 |
| BTST | 8 dynamic sources × 53 destinations + 52 immediate forms | 476 |
| ASL/ASR, LSL/LSR, ROL/ROR, ROXL/ROXR | 8 × (3 sizes × (8 immediate + 64 register forms) + 42 memory forms) | 2,064 |
| BRA, BSR, Bcc | (BRA + BSR + 14 conditions) × 2 displacement forms | 32 |
| DBcc | 16 conditions × 8 registers | 128 |
| Scc | 16 conditions × 50 destinations | 800 |
| JMP, JSR | 2 × 28 control addresses | 56 |
| CHK | 8 registers × 53 sources | 424 |
| TAS | 50 data-alterable addresses | 50 |
| ILLEGAL, NOP, RESET, RTE, RTR, RTS, STOP, TRAP, TRAPV | 9 single forms | 9 |
| **Total** | | **36,029** |

MOVEM's stores allow control-alterable addresses plus eight predecrement
registers (26 + 8); loads allow control addresses plus eight postincrement
registers (28 + 8). Register-mask values do not multiply either count.

As an independent implementation cross-check, expanding
[Musashi's opcode definitions](https://github.com/kstenerud/Musashi/blob/313ebf1bd9f4d0d93341eb5ce21fd8a119e9dbdd/m68k_in.c)
for its original-68000 column, deduplicating specialized handlers and applying
the operand rules above gives the same family totals. Before collapsing embedded
operand values, that enumeration has 45,816 operation words. The difference is
4,064 branch displacements, 2,040 MOVEQ immediates, 2,324 quick-add/subtract
counts, 1,344 immediate-shift counts, and 15 TRAP vectors: 9,787 fewer forms.
The manual-derived family audit above owns the denominator; emulator output
alone does not define documented support.

## Documented-instruction completion

The implementation covers **all 36,029 forms** (45,816 expanded operation words).
RESET completes the final form through its explicit device-reset connection.
Native synchronous exceptions, trace, external interrupt offers, STOP wakeup,
and RTE are implemented within the [model contract](model.md). Illegal encodings
and line-A/line-F words also deliver their exceptions, without adding opcode forms.
Bus-error delivery, timing, prefetch, and complete
machine/device models remain separate accuracy work. Documented opcode coverage
does not measure those capabilities. The [coverage tracker](../coverage.md#68000)
lists the implemented families and remaining model limits.
