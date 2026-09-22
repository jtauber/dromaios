# 8088 byte and word transfers

[Model contract](../../../../src/components/cpus/specifications/8088.md) ·
[Machine definition](../../../../src/machines/8088/transfers-example.machine) ·
[Example tests](../../../../tests/machines/8088/transfers-example.test.ts)

This program combines immediate register loads, byte and word accumulator
addition, and direct memory transfers through DS. AL and AH share AX; BL
and BH share BX. Byte writes preserve the other half, and byte arithmetic
sets flags from the byte result even when the full word remains nonzero.

## Program and memory

CS:IP starts at `1234:0200`, physical `12540`. Caller completion is physical
`12560`, reached at `1234:0220`. All addresses and values below are hexadecimal.

| Physical address | Bytes | Instruction |
| --- | --- | --- |
| `12540` | `BB 34 12` | `MOV BX,1234h` |
| `12543` | `B8 FF 7F` | `MOV AX,7FFFh` |
| `12546` | `04 01` | `ADD AL,01h` |
| `12548` | `B4 80` | `MOV AH,80h` |
| `1254A` | `05 FF FF` | `ADD AX,FFFFh` |
| `1254D` | `A3 81 00` | `MOV [0081h],AX` |
| `12550` | `B0 12` | `MOV AL,12h` |
| `12552` | `A2 83 00` | `MOV [0083h],AL` |
| `12555` | `B8 00 00` | `MOV AX,0000h` |
| `12558` | `A0 83 00` | `MOV AL,[0083h]` |
| `1255B` | `A1 81 00` | `MOV AX,[0081h]` |
| `1255E` | `B7 AB` | `MOV BH,ABh` |

The one-MiB RAM image starts zero-filled, with two blocks: the 32 program
bytes at `12540`, and `DE 11 22 33 AD` at `20080`. With DS=`2000`, offsets
`0081` and `0083` address physical `20081` and `20083`. The final block is
`DE FF 7F 12 AD`; both sentinels remain intact. The word slot starts at an
odd address, which is valid on the 8088.

## Initial state

| Registers | Values |
| --- | --- |
| AX, BX, CX, DX | `1122`, `3344`, `5566`, `7788` |
| SP, BP, SI, DI | `8000`, `9000`, `0010`, `0020` |
| CS, DS, SS, ES, IP | `1234`, `2000`, `3000`, `4000`, `0200` |
| CF, PF, AF, ZF, SF, TF, IF, DF, OF | `1`, `0`, `1`, `1`, `1`, `0`, `1`, `1`, `1` |
| `halted`, `waiting`, `interruptDeferred`, `recognitionDeferred`, `trapPending` | `false` |

Construction neither resets nor executes. Byte-register views derive from
their stored words; PC derives from CS:IP.

## Expected execution

| After instruction | IP | Register change | CF | PF | AF | ZF | SF | OF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MOV BX immediate | `0203` | BX=`1234` | 1 | 0 | 1 | 1 | 1 | 1 |
| MOV AX immediate | `0206` | AX=`7FFF` | 1 | 0 | 1 | 1 | 1 | 1 |
| ADD AL | `0208` | AX=`7F00` | 1 | 1 | 1 | 1 | 0 | 0 |
| MOV AH immediate | `020A` | AX=`8000` | 1 | 1 | 1 | 1 | 0 | 0 |
| ADD AX | `020D` | AX=`7FFF` | 1 | 1 | 0 | 0 | 0 | 1 |
| Store AX | `0210` | None | 1 | 1 | 0 | 0 | 0 | 1 |
| MOV AL immediate | `0212` | AX=`7F12` | 1 | 1 | 0 | 0 | 0 | 1 |
| Store AL | `0215` | None | 1 | 1 | 0 | 0 | 0 | 1 |
| Clear AX with MOV | `0218` | AX=`0000` | 1 | 1 | 0 | 0 | 0 | 1 |
| Load AL | `021B` | AX=`0012` | 1 | 1 | 0 | 0 | 0 | 1 |
| Load AX | `021E` | AX=`7FFF` | 1 | 1 | 0 | 0 | 0 | 1 |
| MOV BH immediate | `0220` | BX=`AB34` | 1 | 1 | 0 | 0 | 0 | 1 |

All unspecified registers retain their values; TF/IF/DF remain `0/1/1`.
MOV preserves all flags, including when it sets AX to zero. Both ADD forms
ignore incoming CF. The byte addition produces unsigned carry and a zero
byte while preserving AH; the word addition produces both unsigned carry
and signed overflow (`-32768 + -1` cannot fit in a signed word). PF always
depends on the low byte's parity.

Each step fetches its complete encoding through CS:IP before any data access.
Store AX writes `FF` then `7F`; store AL writes only `12`. Load AL reads only
`12`; load AX reads `FF` then `7F`. The trace contains 32 instruction reads,
three data reads, and three writes, with data accesses attached to their
respective instructions. No store reads its destination.

The runner completes after twelve steps. A three-step budget pauses after
the byte addition; resuming or restoring that snapshot executes the remaining
nine instructions. Completion uses the physical address, including CS:IP
aliases, rather than the logical offset alone.

Reset preserves the general registers and RAM, sets CS:IP=`FFFF:0000`, clears
DS/SS/ES and all flags, and makes no memory accesses. The next byte at physical
`FFFF0` contains zero, which now decodes as ADD; the rejection test explicitly
places an unsupported `0F` there. Creating a fresh example restores the initial
registers, program, result slots, and sentinels.

## Acceptance checks

Tests specify complete records independently of the generated machine, compare
actual RAM calls, and check full initial/final images. They cover factory
isolation, byte ownership, arithmetic flags, memory widths and ordering,
physical completion, bounded resumption, snapshot restoration, reset, restart,
and detached earlier records. CPU tests additionally check every register
selector, byte value, byte-add operand pair, incoming flag pattern, and
instruction/data boundary case.

Hardware behavior follows Intel's
[8086 Family User's Manual, October 1979](https://www.ardent-tool.com/CPU/docs/Intel/808x/manuals/9800722-03_alt.pdf),
sections 2.2–2.3 and 2.7 and tables 4-12–4-14, restricted to documented original
8088 behavior.
