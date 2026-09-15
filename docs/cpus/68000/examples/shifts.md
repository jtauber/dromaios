# 68000 shifts and rotates example

[Model contract](../model.md#shifts-and-rotates) ·
[Machine definition](../../../../src/machines/68000/shifts-example.machine) ·
[Example tests](../../../../tests/machines/68000/shifts-example.test.ts)

This 32-instruction program unpacks two tagged signed samples, doubles each
sample, and removes each tag's low bit. It then shifts a two-word value left
and right through X. All eight shift and rotate operations participate.

## Initial state and memory

| Registers | Values |
| --- | --- |
| D0, D1, D2, D3 | `11223344`, `55667788`, `99AABBCC`, `DDEEFF00` |
| D4, D5, D6, D7 | `01234567`, `89ABCDEF`, `FEDCBA98`, `76543210` |
| A0, A1, A2, A3 | `10000000`, `20000000`, `30000000`, `40000000` |
| A4, A5, A6 | `50000000`, `60000000`, `70000000` |
| USP, SSP, PC | `34008000`, `56009000`, `AB002000` |
| interruptMask | `2` |
| halted, tracePending | `false`, `false` |
| X, N, Z, V, C, T, S | `1`, `0`, `1`, `1`, `1`, `0`, `0` |

Zero-filled 16 MiB RAM contains reset vectors `56 00 90 00 AB 00 20 00`
at `000000` and the 54-byte program at `002000`. The packed input words
at `003000` are `8180 1234`: tags `81` and `12`, samples −128 and +52.
Eight output bytes at `004000` start filled with `CC`. The two-word value
at `006000` is `4001 8001`. Each data block has `DE AD` before it and
`BE EF` after it. Construction does not reset or execute the CPU.

## Program and expected execution

Instruction addresses below have logical prefix `AB00`; values are hexadecimal.
The machine definition supplies the exact bytes.

| PC | Instruction | Effect |
| --- | --- | --- |
| `2000` | `LEA (AB003000).L,A0` | Select packed input |
| `2006` | `LEA (CD004000).L,A1` | Select output |
| `200C` | `MOVEQ #1,D7` | Two DBF iterations |
| `200E` | `MOVE.W (A0)+,D0` | Read tag/sample pair |
| `2010` | `ROL.W #8,D0` | Exchange the two bytes |
| `2012` | `MOVEQ #0,D1` | Clear the tag register |
| `2014` | `MOVE.B D0,D1` | Extract the tag |
| `2016` | `ROR.W #8,D0` | Restore the packed word |
| `2018` | `LSL.W #8,D0` | Discard tag; put sample sign at bit 15 |
| `201A` | `ASR.W #8,D0` | Sign-extend sample to a word |
| `201C` | `ASL.W #1,D0` | Double the signed sample |
| `201E` | `MOVE.W D0,(A1)+` | Store scaled sample |
| `2020` | `LSR.B #1,D1` | Discard tag's low bit |
| `2022` | `MOVE.W D1,(A1)+` | Store shifted tag |
| `2024` | `DBF D7,200E` | Repeat until D7.W becomes `FFFF` |
| `2028` | `LEA (EF006002).L,A2` | Select low word of wide value |
| `202E` | `LSL.W (A2)` | Low word `8001` → `0002`, X=1 |
| `2030` | `ROXL.W -(A2)` | High word `4001` → `8003`, consuming X |
| `2032` | `LSR.W (A2)+` | High word `8003` → `4001`, X=1 |
| `2034` | `ROXR.W (A2)` | Low word `0002` → `8001`, consuming X |

Output words are `FF00 0040 0068 0009`: scaled samples −256 and +104,
each followed by its shifted tag. The wide value temporarily becomes
`8003 0002`, then returns to `4001 8001`. Its original top bit is clear,
so the left shift loses no set bit. Each memory instruction records one
word read and one word write at the resolved address, high byte first.

Final D0=`11220068`, D1=`00000009`, D7=`0000FFFF`, A0=`AB003004`,
A1=`CD004008`, A2=`EF006002`, and PC=`AB002036`; XNZVC=`01000`.
All other registers and control state retain their initial values. Only
the output block differs from its initial memory image after completion.

## Running and acceptance checks

`runCpu(cpu, { maxSteps: 32, endAddress: 0xAB002036 })` completes in 32
records: three setup instructions, two twelve-instruction iterations,
and five final instructions. A budget of 29 pauses after shifting the
low word. Restoring that snapshot and current RAM must retain X=1 for
the next ROXL, reproducing the final three records exactly.

Tests check the complete records against actual RAM calls and complete
initial/final memory images in both processor modes. They also check factory
isolation, logical endpoints, detached records, live input changes, and reset
preservation. Changing the first sample to +127 produces `00FE`; replacing
the wide value with zero leaves it zero, with final X clear and Z set.
