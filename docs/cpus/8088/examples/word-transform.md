# 8088 example: signed word transformation

Halve a signed 32-bit integer, negate it, and write the result in big-endian
byte order. The initial input `FFFFFF81` (−127) becomes `FFFFFFC0` (−64),
then `00000040` (+64). A separate byte records the bit discarded by halving.
The operation is `−floor(input / 2)`, including for positive inputs.

[Model contract](../model.md#shifts-and-rotates) ·
[Example definition](../../../../src/machines/8088/word-transform-example.machine) ·
[Example tests](../../../../tests/machines/8088/word-transform-example.test.ts) ·
[CPU coverage](../../coverage.md#8088)

## Definition and initial state

Addresses, bytes, and registers below are hexadecimal; instruction counts are
decimal. RAM is one MiB, zero-filled outside the declared regions.

| Physical address | Bytes | Purpose |
| --- | --- | --- |
| `0FFEC` | `DE 81 FF FF` | Guard at DS:FFFC, followed by the input's low three bytes |
| `FFFF0` | `FF AD` | Input high byte at DS:0000, followed by a guard |
| `000EF` | `DE AA BB CC DD 7F AD` | Guards surrounding four output bytes and a marker |
| `12540` | Program below | CS:0200 |

Initial AX=`1122`, BX=`3344`, CX=`5566`, DX=`7788`, SP=`8000`, BP=`9000`,
SI=`0010`, DI=`0020`, CS=`1234`, DS=`FFFF`, SS=`3000`, ES=`4000`, IP=`0200`.
AF/ZF/IF/DF/OF are 1; CF/PF/SF/TF are 0. `halted`, `interruptDeferred`, `segmentDeferred`, and `trapPending` are false.

The input begins at DS:FFFD. Its high word straddles DS:FFFF and DS:0000,
at physical addresses `0FFEF` and `FFFF0`. Output DS:0100 maps to physical
`000F0`, wrapping on the twenty-bit bus. The program stays in its separate
code segment throughout.

## Program

| IP | Bytes | Instruction |
| --- | --- | --- |
| `0200` | `C6 06 04 01 00` | MOV byte [0104],0: clear marker without reading it |
| `0205` | `A1 FD FF` | MOV AX,[FFFD]: low input word |
| `0208` | `8B 16 FF FF` | MOV DX,[FFFF]: high input word |
| `020C` | `D1 FA` | SAR DX,1: halve high word, preserving sign |
| `020E` | `D1 D8` | RCR AX,1: propagate the high word's outgoing bit into the low word |
| `0210` | `73 04` | JNC 0216: skip marker update for even input |
| `0212` | `FE 06 04 01` | INC byte [0104]: record discarded bit, preserving CF |
| `0216` | `F7 DA` | NEG DX |
| `0218` | `F7 D8` | NEG AX: report borrow from low-word negation |
| `021A` | `83 DA 00` | SBB DX,0: propagate that borrow to the high word |
| `021D` | `86 C4` | XCHG AL,AH: reverse low word's byte order |
| `021F` | `86 D6` | XCHG DL,DH: reverse high word's byte order |
| `0221` | `89 16 00 01` | MOV [0100],DX: store most significant word first |
| `0225` | `A3 02 01` | MOV [0102],AX: store least significant word next |
| `0228` | `F6 06 04 01 01` | TEST byte [0104],1: inspect marker without writing it |
| `022D` | `90` | NOP |

The caller stops before IP=`022E`, physical address `1256E`.

## Expected execution

The default path takes 16 instructions. After the loads, DX:AX=`FFFF:FF81`.
SAR leaves DX=`FFFF` and sets CF=1; RCR uses that carry to produce AX=`FFC0`
and reports the input's discarded low bit in CF. JNC is untaken, and the
marker becomes `01`.

NEG DX produces `0001`. NEG AX produces `0040` with CF=1; SBB then changes
DX from `0001` to `0000`, completing the 32-bit negation. Byte exchanges leave
DX:AX=`0000:4000`. Little-endian word stores consequently write the desired
big-endian byte sequence **`00 00 00 40`** at physical `000F0–000F3`.
The marker at `000F4` is `01`.

Final AX=`4000`, DX=`0000`, IP=`022E`; other registers retain their initial
values. IF/DF remain 1. After TEST and NOP, CF/PF/AF/ZF/SF/TF/OF are 0.
Only the five output/marker bytes change. Input, guards, program, and stack
memory remain intact.

All instruction bytes precede data accesses in the records. The wrapped high
word is read low byte then high byte. INC reads then writes the marker; MOV
does not read its destination; TEST does not write its operand. XCHG captures
both byte halves before replacing either, so AL/AH sharing AX is safe. NOP
only fetches its opcode.

## Acceptance and alternate paths

Tests compare all 16 records and observed RAM calls with independent expected
values, plus the complete initial/final RAM images. They pause after SAR and
resume from a snapshot before RCR, checking the carry linking both words.
Reset clears the modeled reset registers/flags without touching the output;
fresh CPU and memory factories restore the original lesson.

Input `FFFFFE00` (−512) becomes −256, then +256, producing `00 00 01 00`.
Its low bit is zero: JNC skips INC, execution takes 15 instructions, the
marker remains zero, and final ZF is 1. Further cases include zero, odd and
even positive inputs, word boundaries, and both signed 32-bit extremes.
These cases check the full expression using ordinary integer arithmetic.

Editing input RAM after the marker initialization changes the next load.
Replacing JNC with `EB FE` loops at IP=`0210`; the shared runner must stop
at its requested instruction budget.
