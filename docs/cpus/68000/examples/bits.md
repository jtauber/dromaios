# 68000 bit operations example

[Model contract](../model.md#bit-operations) ·
[Machine definition](../../../../src/machines/68000/bits-example.machine) ·
[Example tests](../../../../tests/machines/68000/bits-example.test.ts)

This 33-step program records four requested bits in a 32-bit register
while toggling their modulo-eight positions in a memory byte. It classifies
each memory bit's old value, then exercises static and dynamic tests and
modifications. BTST, BCHG, BCLR, and BSET each appear with both number sources.

## Initial state and memory

| Registers | Values |
| --- | --- |
| D0, D1, D2, D3 | `11223344`, `55667788`, `99AABBCC`, `DDEEFF00` |
| D4, D5, D6, D7 | `01234567`, `89ABCDEF`, `FEDCBA98`, `76543210` |
| A0, A1, A2, A3 | `10000000`, `20000000`, `30000000`, `40000000` |
| A4, A5, A6 | `50000000`, `60000000`, `70000000` |
| USP, SSP, PC | `34008000`, `56009000`, `AB002000` |
| interruptMask | `2` |
| halted | `false` |
| X, N, Z, V, C, T, S | `1`, `0`, `1`, `1`, `1`, `0`, `0` |

Zero-filled 16 MiB RAM contains reset vectors `56 00 90 00 AB 00 20 00`
at `000000`, the 62-byte program at `002000`, and constant `80` at `002080`.
Requested bit numbers at `003000` are `00 07 08 1F` (0, 7, 8, 31).
The toggle byte at `004000` starts at zero; four classification bytes at
`005000` start at `CC`. Each data block has `DE AD` before it and `BE EF`
after it. Construction does not reset or execute the CPU.

## Program and expected execution

Instruction addresses below have logical prefix `AB00`. Bit numbers are
decimal; addresses and data values are hexadecimal. The machine definition
supplies the exact bytes.

| PC | Instruction | Effect |
| --- | --- | --- |
| `2000` | `LEA (AB003000).L,A0` | Select requested bit numbers |
| `2006` | `LEA (CD004000).L,A1` | Select toggle byte |
| `200C` | `LEA (EF005000).L,A2` | Select classification output |
| `2012` | `CLR.L D0` | Empty the long bitmap |
| `2014` | `MOVEQ #0,D1` | Clear the bit-number register |
| `2016` | `MOVEQ #3,D7` | Four DBF iterations |
| `2018` | `MOVE.B (A0)+,D1` | Read next requested bit |
| `201A` | `BSET D1,D0` | Record it modulo 32 |
| `201C` | `BCHG D1,(A1)` | Toggle memory bit modulo 8; Z describes its old value |
| `201E` | `SEQ (A2)+` | Store `FF` if that old bit was zero, otherwise `00` |
| `2020` | `DBF D7,2018` | Repeat until D7.W becomes `FFFF` |
| `2024` | `BTST #31,D0` | Test the long bitmap's high bit |
| `2028` | `BCLR #31,D0` | Clear it; Z remains clear from the original one |
| `202C` | `BSET #7,(A1)` | Set memory bit 7; Z becomes set from its original zero |
| `2030` | `BTST D1,(A1)` | D1 contains bit number 31, which tests memory bit 7 |
| `2032` | `BCLR D1,(A1)` | Clear memory bit 7 |
| `2034` | `BCHG #0,D0` | Clear the bitmap's originally set low bit |
| `2038` | `BTST #7,(0044,PC)` | Test constant `80` at `2080`; EA extension base is `203C` |

The long bitmap accumulates `00000001`, `00000081`, `00000181`, then
`80000181`. The byte instead passes through `01`, `81`, `80`, and `00`,
because requests 8 and 31 reuse memory bits 0 and 7. Classification output
is `FF FF 00 00`. Setting the register's high bit does not set N; clearing
the byte's last set bit does not set Z. These instructions preserve N and
derive Z from the original selected bit.

After the final operations, D0=`00000180`, D1=`0000001F`, D7=`0000FFFF`,
A0=`AB003004`, A1=`CD004000`, A2=`EF005004`, and PC=`AB00203E`;
XNZVC=`10000`. Other registers and control state retain their initial values.
Only the four output bytes differ from their initial memory image.

## Running and acceptance checks

`runCpu(cpu, { maxSteps: 33, endAddress: 0xAB00203E })` completes in 33
records: six setup instructions, four five-instruction iterations, and
seven final instructions. A budget of 19 pauses after the third BCHG,
with Z clear because the original bit was one. Restoring the snapshot
and current RAM must reproduce the remaining fourteen records, starting
with a zero classification byte.

Tests compare complete records with actual RAM calls and complete initial/
final memory images in both processor modes. They also check factory isolation,
logical endpoints, detached records, and reset preservation. Replacing request
8 with request 1 produces final D0=`00000082`, toggle byte `03`, and a third
classification of `FF`. Changing the constant at `2080` to zero sets the final
Z, demonstrating a live PC-relative read.
