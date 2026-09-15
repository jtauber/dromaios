# 8088 example: a masked 32-bit word sum

Mask four input words with F0FF, add them into DX:AX, and mark an odd result
in RAM. A subroutine preserves BX and BP in a stack frame, loads each input
through DS:[BX+SI], and restores the array base through SS:[BP-2].

[Model contract](../model.md#modrm-operands) ·
[Machine definition](../../../../src/machines/8088/word-sum-example.machine) ·
[Example tests](../../../../tests/machines/8088/word-sum-example.test.ts) ·
[CPU coverage](../../coverage.md#8088) ·
[Reference comparison](../reference-notes.md#arithmetic-logic-and-modrm-comparison)

All addresses and data below are hexadecimal; instruction counts are decimal.
The program completes in **76 instructions**, at CS:IP=`1234:022A`, physical
`1256A`. The result is **DX:AX=`0001:71FF`**, or `000171FF` as a 32-bit value.

## Initial state and memory

| Registers | Values |
| --- | --- |
| AX, BX, CX, DX | `1122`, `3344`, `5566`, `7788` |
| SP, BP, SI, DI | `8000`, `9000`, `0010`, `0020` |
| CS, DS, SS, ES, IP | `1234`, `2000`, `3000`, `4000`, `0200` |
| CF, PF, AF, ZF, SF, TF, IF, DF, OF | `1`, `0`, `1`, `1`, `1`, `0`, `1`, `1`, `1` |
| `halted` | `false` |

Begin with zero-filled 1 MiB RAM and the program blocks below. The input
block at physical `200FF` is `DE FF FF 01 80 FF 00 00 00 AD`: four words
`FFFF`, `8001`, `00FF`, `0000` at DS:0100, surrounded by DE/AD sentinels.
The output block at physical `201FF` is `DE 00 00 00 00 01 AD`: space for a
32-bit sum at DS:0200, a marker byte at DS:0204, and sentinels.

`create8088WordSumExample()` returns independent `{ cpu, ram, endAddress }`.
`create8088WordSumExampleMemory()` creates the same full image without a CPU.
Factories perform neither reset nor execution.

## Program

| IP | Bytes | Instruction |
| --- | --- | --- |
| `0200` | `B8 00 00` | MOV AX,0000h: low sum |
| `0203` | `BA 00 00` | MOV DX,0000h: high sum |
| `0206` | `B9 04 00` | MOV CX,0004h: count |
| `0209` | `BE 00 00` | MOV SI,0000h: byte index |
| `020C` | `BB 00 01` | MOV BX,0100h: array base |
| `020F` | `E8 2E 00` | CALL 0240h |
| `0212` | `83 C6 02` | ADD SI,+2 |
| `0215` | `49` | DEC CX |
| `0216` | `75 F7` | JNE 020Fh |
| `0218` | `89 06 00 02` | MOV [0200h],AX |
| `021C` | `89 16 02 02` | MOV [0202h],DX |
| `0220` | `A9 01 00` | TEST AX,0001h |
| `0223` | `74 05` | JE 022Ah: skip marker for an even sum |
| `0225` | `80 0E 04 02 80` | OR byte [0204h],80h |
| `0240` | `55` | PUSH BP |
| `0241` | `89 E5` | MOV BP,SP |
| `0243` | `53` | PUSH BX |
| `0244` | `8B 18` | MOV BX,[BX+SI] |
| `0246` | `81 E3 FF F0` | AND BX,F0FFh |
| `024A` | `85 DB` | TEST BX,BX |
| `024C` | `74 05` | JE 0253h: skip zero |
| `024E` | `01 D8` | ADD AX,BX |
| `0250` | `83 D2 00` | ADC DX,+0 |
| `0253` | `8B 5E FE` | MOV BX,[BP-2] |
| `0256` | `89 EC` | MOV SP,BP |
| `0258` | `5D` | POP BP |
| `0259` | `C3` | RET |

Main starts at physical `12540`; the subroutine starts at `12580`. Every
instruction fetch uses CS:IP. The load at 0244 resolves its address using the
old BX before replacing BX; the caller's SI remains unchanged in the subroutine.

## Expected execution

| Iteration | Input | Masked | DX:AX after call | ADD CF / OF | SI after advance | CX after DEC | JNE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `FFFF` | `F0FF` | `0000:F0FF` | `0 / 0` | `0002` | `0003` | Taken |
| 2 | `8001` | `8001` | `0001:7100` | `1 / 1` | `0004` | `0002` | Taken |
| 3 | `00FF` | `00FF` | `0001:71FF` | `0 / 0` | `0006` | `0001` | Taken |
| 4 | `0000` | `0000` | `0001:71FF` | ADD/ADC skipped | `0008` | `0000` | Untaken |

The first three iterations take 17 instructions each: CALL, thirteen subroutine
instructions, and ADD/DEC/JNE. The zero iteration skips ADD/ADC and takes 15.
Five setup instructions and five final instructions bring the total to 76.

Each step fetches all of its instruction bytes before any data access. This
table lists additional physical accesses, in order; R means read and W means
write. The input address advances by two for each iteration.

| IP | Ordered data accesses | State after |
| --- | --- | --- |
| `020F` | W `37FFE:12`, W `37FFF:02` | IP=0240, SP=7FFE |
| `0240` | W `37FFC:00`, W `37FFD:90` | SP=7FFC |
| `0241` | — | BP=7FFC |
| `0243` | W `37FFA:00`, W `37FFB:01` | SP=7FFA |
| `0244` | R input low at `20100+SI`, R input high at `20101+SI` | BX=input |
| `0253` | R `37FFA:00`, R `37FFB:01` | BX=0100 |
| `0256` | — | SP=7FFC |
| `0258` | R `37FFC:00`, R `37FFD:90` | BP=9000, SP=7FFE |
| `0259` | R `37FFE:12`, R `37FFF:02` | IP=0212, SP=8000 |
| `0218` | W `20200:FF`, W `20201:71` | Low result stored |
| `021C` | W `20202:01`, W `20203:00` | High result stored |
| `0225` | R `20204:01`, W `20204:81` | Odd marker set |

MOV, stack operations, calls, returns, and branches preserve all flags.
AND/TEST clear CF/OF and the model's undefined-AF value, then set SF/ZF/PF
from the masked result. Their `(SF,ZF,PF)` values are `(1,0,1)`, `(1,0,0)`,
`(0,0,1)`, `(0,1,1)` for the four inputs. The second ADD sets CF/AF/OF,
and its following ADC consumes CF to increase DX from zero to one. ADC leaves
PF/ZF as `1/1`, `0/0`, `0/0` in the first three iterations. All ADD/ADC
flag results are listed independently in the example tests.

ADD SI produces PF=`0,0,1,0`; DEC CX produces PF=`1,0,0,1` and sets ZF only
on the fourth iteration. CF remains zero through these advances and DEC
preserves it. The final TEST sees a low bit of one, so JE is untaken and OR
changes the marker from 01 to 81. Final SF/PF are set, CF/AF/ZF/OF are clear,
and TF/IF/DF retain `0/1/1` throughout.

Final AX=71FF, DX=0001, BX=0100, CX=0000, SI=0008, BP=9000, SP=8000,
DI=0020, and IP=022A; all segments retain their initial values. The output
block is `DE FF 71 01 00 81 AD`. The stack retains `00 01 00 90 12 02` at
37FFA. Inputs, code, sentinels, and every other byte remain unchanged.

## Pause, reset, and acceptance checks

A ten-step budget pauses after the first indexed load, with IP=0246, BX=FFFF,
BP=7FFC, and SP=7FFA. A new CPU constructed from that snapshot and the same
RAM completes in 66 more steps; the combined records match uninterrupted execution.

Reset preserves general registers and all RAM, sets CS:IP to FFFF:0000, clears
other segments and flags, and performs no memory access. A fresh factory
restores the complete initial state and image. Completion is supplied to the
runner; the CPU itself has no halt at the end address.

Tests independently check all 76 records and actual RAM calls, full images,
factory isolation, snapshot resumption inside the frame, detached earlier
records, reset, and restart. Changing the first input to zero just before its
load yields DX:AX=0000:8100 and leaves the odd marker at 01. Editing JNE to
branch to itself makes a bounded run stop at its budget after one input.
