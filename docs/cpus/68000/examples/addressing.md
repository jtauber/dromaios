# 68000 mixed-size transfers and effective addresses

[Model contract](../model.md) ·
[Machine definition](../../../../src/machines/68000/addressing-example.machine) ·
[Example tests](../../../../tests/machines/68000/addressing-example.test.ts)

This program copies bytes, a word, and a long through RAM, temporarily saves
a word on the active stack, and distinguishes partial data-register writes
from sign-extended address-register writes. It also combines absolute,
displacement, indexed, and PC-relative reads. All values below are hexadecimal;
addresses in the program table are physical. PC retains its high byte `AB`.

## Initial state and memory

| Registers | Initial values |
| --- | --- |
| D0, D1, D2, D3 | `11223344`, `55667788`, `99AABBCC`, `DDEEFF00` |
| D4, D5, D6, D7 | `01234567`, `FFFFFFFF`, `FEDCBA98`, `76543210` |
| A0, A1, A2, A3 | `10000000`, `20000000`, `30000000`, `40000000` |
| A4, A5, A6 | `50000000`, `60000000`, `70000000` |
| USP, SSP, PC | `34008000`, `56009000`, `AB002000` |
| interruptMask | `2` |
| X, N, Z, V, C, T, S | `1`, `0`, `1`, `1`, `1`, `0`, `0` |

A7 initially exposes USP. The 16 MiB image starts zero-filled, with these
blocks in addition to the program:

| Address | Initial bytes | Purpose |
| --- | --- | --- |
| `000000` | `56 00 90 00 AB 00 20 00` | External-reset SSP and PC |
| `0020A0` | `F0 0D` | PC-relative constant |
| `002FFE` | `DE AD 80 7F 12 34 89 AB CD EF BE EF` | Source buffer with guards |
| `003FFE` | `DE AD`, twelve `CC` bytes, `BE EF` | Destination buffer with guards |
| `007FFC` | `AA BB CC DD EE FF` | User-stack slot and guards |
| `008FFC` | `AA BB CC DD EE FF` | Supervisor-stack slot and guards |
| `FF8000` | `DE AD CC CC CC CC BE EF` | Destination reached through signed A3 |
| `FFFF80` | `80 02 55 AA` | Signed address word and byte constant |

## Program

| Address | Bytes | Instruction |
| --- | --- | --- |
| `002000` | `20 7C AB 00 30 00` | `MOVEA.L #AB003000,A0` |
| `002006` | `22 7C CD 00 40 00` | `MOVEA.L #CD004000,A1` |
| `00200C` | `34 7C FF 80` | `MOVEA.W #FF80,A2` |
| `002010` | `10 18` | `MOVE.B (A0)+,D0` |
| `002012` | `12 D8` | `MOVE.B (A0)+,(A1)+` |
| `002014` | `12 C0` | `MOVE.B D0,(A1)+` |
| `002016` | `32 D8` | `MOVE.W (A0)+,(A1)+` |
| `002018` | `22 D8` | `MOVE.L (A0)+,(A1)+` |
| `00201A` | `22 20` | `MOVE.L -(A0),D1` |
| `00201C` | `3F 01` | `MOVE.W D1,-(A7)` |
| `00201E` | `34 1F` | `MOVE.W (A7)+,D2` |
| `002020` | `36 52` | `MOVEA.W (A2),A3` |
| `002022` | `16 2A 00 02` | `MOVE.B (2,A2),D3` |
| `002026` | `38 3A 00 78` | `MOVE.W (0078,PC),D4` |
| `00202A` | `3C 31 50 FD` | `MOVE.W (-3,A1,D5.W),D6` |
| `00202E` | `26 81` | `MOVE.L D1,(A3)` |
| `002030` | `1E 38 FF 82` | `MOVE.B (FF82).W,D7` |
| `002034` | `23 C6 CD 00 40 08` | `MOVE.L D6,(CD004008).L` |

Caller completion is `AB00203A`, after exactly eighteen instructions. The two
initial source bytes are exchanged in the destination; the word and long
retain their order. D0 retains its upper three bytes, and D2/D4/D6 retain their
upper words. MOVEA sign-extends `FF80` to `FFFFFF80` and `8002` to `FFFF8002`.

The PC-relative word uses extension address `AB002028`, plus `0078`, to read
physical `0020A0`. The indexed word uses A1=`CD004008`, D5.W=`FFFF` (−1), and
displacement −3 to read physical `004004`. Absolute word `FF82` denotes
logical `FFFFFF82`, physical `FFFF82`.

## Expected execution

The flag column is X/N/Z/V/C. The first three MOVEA instructions preserve
`10111`; all subsequent ordinary moves clear V/C and set N/Z from their own
operand size. The later MOVEA preserves `11000`. X remains set throughout.
Unlisted registers retain their previous values, as do T/S and interruptMask.

| After instruction at | Register changes | Data reads / writes (physical) | XNZVC |
| --- | --- | --- | --- |
| `002000` | A0=`AB003000` | None | `10111` |
| `002006` | A1=`CD004000` | None | `10111` |
| `00200C` | A2=`FFFFFF80` | None | `10111` |
| `002010` | A0=`AB003001`, D0=`11223380` | Read `3000`: `80` | `11000` |
| `002012` | A0=`AB003002`, A1=`CD004001` | Read `3001`: `7F`; write `4000`: `7F` | `10000` |
| `002014` | A1=`CD004002` | Write `4001`: `80` | `11000` |
| `002016` | A0=`AB003004`, A1=`CD004004` | Read `3002`: `12 34`; write `4002`: `12 34` | `10000` |
| `002018` | A0=`AB003008`, A1=`CD004008` | Read `3004`: `89 AB CD EF`; write `4004`: same | `11000` |
| `00201A` | A0=`AB003004`, D1=`89ABCDEF` | Read `3004`: `89 AB CD EF` | `11000` |
| `00201C` | USP/A7=`34007FFE` | Write `7FFE`: `CD EF` | `11000` |
| `00201E` | USP/A7=`34008000`, D2=`99AACDEF` | Read `7FFE`: `CD EF` | `11000` |
| `002020` | A3=`FFFF8002` | Read `FFFF80`: `80 02` | `11000` |
| `002022` | D3=`DDEEFF55` | Read `FFFF82`: `55` | `10000` |
| `002026` | D4=`0123F00D` | Read `20A0`: `F0 0D` | `11000` |
| `00202A` | D6=`FEDC89AB` | Read `4004`: `89 AB` | `11000` |
| `00202E` | None | Write `FF8002`: `89 AB CD EF` | `11000` |
| `002030` | D7=`76543255` | Read `FFFF82`: `55` | `10000` |
| `002034` | None | Write `4008`: `FE DC 89 AB` | `11000` |

Each instruction also fetches exactly the bytes in the program table. The
model records source data reads before destination writes, using ascending
byte addresses. No synthetic destination reads occur. Every access is an
actual RAM call; these records do not describe bus cycles or prefetch.

Final PC is `AB00203A`, A0=`AB003004`, A1=`CD004008`, A2=`FFFFFF80`,
A3=`FFFF8002`. Both stack pointers return to their initial values. Memory changes
are limited to:

- `004000–00400B`: `7F 80 12 34 89 AB CD EF FE DC 89 AB`.
- `007FFE–007FFF`: `CD EF`, the saved stack word left in RAM after popping.
- `FF8002–FF8005`: `89 AB CD EF`.

Source data, code, constants, vectors, guards, and the supervisor-stack slot
remain unchanged.

## Bounded running, reset, and checks

A ten-step budget pauses with the word on the user stack. Resuming for eight
steps, or restoring that snapshot into another CPU and resuming, reaches the
same final state and RAM. Previously captured records remain detached.

Resetting a fresh example first selects SSP=`56009000`, leaves USP unchanged,
sets S, clears T, and sets interruptMask=`7`. The same eighteen instructions
then save/pop through `008FFE` instead of `007FFE`; the user-stack slot stays
unchanged. All data-register results and other memory outputs agree. Creating
a fresh factory instance restores the original state and RAM.

Tests specify the complete records independently, compare actual RAM calls,
and inspect entire initial/final images. They also check factory independence,
logical completion, pause/resume, snapshot restoration, reset, and record
ownership. The [CPU tests](../../../../tests/components/cpus/68000.test.ts)
separately cover all legal transfer forms, index/displacement choices,
aliasing, wrapping, and alignment rejection.
