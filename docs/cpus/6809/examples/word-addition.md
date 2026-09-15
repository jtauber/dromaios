# 6809 example: word addition through nested calls

Add `00FF + 0001` using byte operations on A and B, storing `0100` in RAM.
The low-byte addition produces a carry; a nested call preserves it for the
high-byte ADC. Both returns restore S, while U remains untouched.

[Model contract](../model.md#jumps-and-subroutines) ·
[Example definition](../../../../src/machines/6809/word-addition-example.machine) ·
[Example tests](../../../../tests/machines/6809/word-addition-example.test.ts) ·
[CPU coverage](../../coverage.md#6809)

## Definition and initial state

Initial control state is `waitMode = none` and `nmiArmed = false`. Neither
changes during this program.

Addresses, bytes, register values, and packed CC values are hexadecimal;
step numbers are decimal. Begin with zero-filled 64 KiB RAM and load:

| Address | Bytes | Instruction or data |
| --- | --- | --- |
| `0200` | `D6 11` | LDB `<$11`: first word's low byte through DP |
| `0202` | `96 10` | LDA `<$10`: first word's high byte |
| `0204` | `BD 02 20` | JSR `$0220` |
| `0207` | `97 14` | STA `<$14`: high result byte |
| `0209` | `D7 15` | STB `<$15`: low result byte |
| `020B` | `7F 12 16` | CLR `>$1216`: read and clear failure marker |
| `020E` | `7D 12 14` | TST `>$1214`: test high result byte without writing it |
| `0211` | `26 03` | BNE `$0216`: skip failure path |
| `0213` | `0C 16` | INC `<$16`: record failure |
| `0215` | `12` | NOP |
| `0220` | `DB 13` | ADDB `<$13`: add low byte |
| `0222` | `8D 0C` | BSR `$0230`: nested call with carry preserved |
| `0224` | `39` | RTS: return to `0207` |
| `0230` | `B9 12 12` | ADCA `>$1212`: add high byte with carry |
| `0233` | `39` | RTS: return to `0224` |
| `1210` | `00 FF 00 01 00 00 A5` | Two input words, result word, failure marker |
| `FFFE` | `02 00` | Reset vector, high byte first |

Initial state: A=`11`, B=`34`, DP=`12`, X=`2345`, Y=`4567`, S=`8000`,
U=`4000`, PC=`0200`. Flags E/F/H/I/N/Z/V/C are `1/0/1/0/1/1/1/1`
(packed CC=`AF`). D is derived as `1134`.

`create6809WordAdditionExample()` returns fresh `{ cpu, ram, endAddress }`,
with `endAddress = 0216`. `create6809WordAdditionExampleMemory()` creates the
same memory image without a CPU. Neither factory resets or executes the CPU.
The endpoint is a caller convention, not a halt instruction.

## Expected execution

All thirteen steps return `executed`. DP, X, Y, U, E, F, and I remain unchanged.
D is always A:B. The table shows state after each step; data accesses follow
that step's opcode and operand reads. `R` means read, `W` means write.

| Step | PC before | PC after | A | B | S | CC | Data accesses in order |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `0202` | `11` | `FF` | `8000` | `A9` | R `1211:FF` |
| 2 | `0202` | `0204` | `00` | `FF` | `8000` | `A5` | R `1210:00` |
| 3 | `0204` | `0220` | `00` | `FF` | `7FFE` | `A5` | W `7FFF:07`, W `7FFE:02` |
| 4 | `0220` | `0222` | `00` | `00` | `7FFE` | `A5` | R `1213:01` |
| 5 | `0222` | `0230` | `00` | `00` | `7FFC` | `A5` | W `7FFD:24`, W `7FFC:02` |
| 6 | `0230` | `0233` | `01` | `00` | `7FFC` | `80` | R `1212:00` |
| 7 | `0233` | `0224` | `01` | `00` | `7FFE` | `80` | R `7FFC:02`, R `7FFD:24` |
| 8 | `0224` | `0207` | `01` | `00` | `8000` | `80` | R `7FFE:02`, R `7FFF:07` |
| 9 | `0207` | `0209` | `01` | `00` | `8000` | `80` | W `1214:01` |
| 10 | `0209` | `020B` | `01` | `00` | `8000` | `84` | W `1215:00` |
| 11 | `020B` | `020E` | `01` | `00` | `8000` | `84` | R `1216:A5`, W `1216:00` |
| 12 | `020E` | `0211` | `01` | `00` | `8000` | `80` | R `1214:01` |
| 13 | `0211` | `0216` | `01` | `00` | `8000` | `80` | — |

The final result is `1214:01 1215:00`, D=`0100`, and the failure marker is zero.
Return-address bytes remain at `7FFC`–`7FFF` after the stack pointer returns to
`8000`. The zero stored at `1215` is still an actual write. No other RAM changes.
No call, return, or branch prefetches its target.

Flag and stack behavior follows [Motorola's instruction definitions](https://www.maddes.net/m6809pm/appendix_a.htm).
These are instruction-level data accesses; cycles and dummy bus activity are
outside the model.

## Acceptance checks

- Check complete initial and final memory images, independent factories, and
  all thirteen records, including actual RAM calls and derived D.
- Pause after the nested call, at `0230` with S=`7FFC`. Construct a CPU from
  the snapshot and the same RAM; eight more steps must finish with the same
  records as uninterrupted execution.
- Reset reads the current vector, sets PC=`0200`, DP=`00`, and F/I. It preserves
  result bytes, return-address bytes, registers, and other flags. A fresh factory
  restores the initial state and image; reset alone does not restore DP=`12`.
- Change the second low byte at `1213` to zero. The result becomes `00FF`;
  the branch falls through, INC records failure, and NOP completes the
  fifteen-step run with marker `01`.
- Change the branch displacement to `FE`. A bounded run stops at its budget
  with PC=`0211`; no hidden completion or halt latch is introduced.
- Retain earlier records across resumption, reset, and host edits to stacked RAM.
