# 68000 unary and quick arithmetic example

[Model contract](../model.md#quick-arithmetic-unary-operations-and-condition-bytes) ·
[Machine definition](../../../../src/machines/68000/unary-example.machine) ·
[Example tests](../../../../tests/machines/68000/unary-example.test.ts)

This program classifies four signed words, stores their unsigned magnitudes,
and counts the nonnegative inputs. It then negates a two-long value using
NEGX and records whether the complete result is zero. ADDQ, SUBQ, CLR, NEG,
NEGX, NOT, TST, and Scc work together in 56 instructions.

## Initial state and memory

| Registers | Values |
| --- | --- |
| D0, D1, D2, D3 | `11223344`, `55667788`, `99AABBCC`, `DDEEFF00` |
| D4, D5, D6, D7 | `01234567`, `89ABCDEF`, `FEDCBA98`, `76543210` |
| A0, A1, A2, A3 | `10000000`, `20000000`, `30000000`, `40000000` |
| A4, A5, A6 | `50000000`, `60000000`, `70000000` |
| USP, SSP, PC | `34008000`, `56009000`, `AB002000` |
| interruptMask | `2` |
| IR | `0000` |
| halted, faulted, tracePending | `false`, `false`, `false` |
| X, N, Z, V, C, T, S | `1`, `0`, `1`, `1`, `1`, `0`, `0` |

Zero-filled 16 MiB RAM contains reset vectors `56 00 90 00 AB 00 20 00` at
`000000` and the 64-byte program at `002000`. The input words at `003000`
are `0000 0001 FFFF 8000` (0, 1, −1, −32768). Four classification bytes
at `004000` and four output words at `005000` start filled with `CC`.
The two-long value at `006000` is `FFFFFFFF 00000001`. Each data block
has `DE AD` before it and `BE EF` after it. Construction does not reset
or execute the CPU.

## Program and expected execution

Instruction addresses below have logical prefix `AB00`; values are hexadecimal.
The machine definition supplies the exact bytes.

| PC | Instruction | Effect |
| --- | --- | --- |
| `2000` | `LEA (AB003000).L,A0` | Select input |
| `2006` | `LEA (CD004000).L,A1` | Select classification output |
| `200C` | `LEA (EF005000).L,A2` | Select magnitude output |
| `2012` | `CLR.L D2` | Clear nonnegative count |
| `2014` | `MOVEQ #4,D3` | Four iterations |
| `2016` | `MOVEM.W (A0)+,D0` | Load and sign-extend one word, preserving flags |
| `201A` | `TST.W D0` | Set flags from the input word |
| `201C` | `SMI (A1)` | Write `FF` for a negative input, otherwise `00`; preserve flags |
| `201E` | `BPL.B 2022` | Skip negation for nonnegative inputs |
| `2020` | `NEG.W D0` | Negate a negative word |
| `2022` | `MOVE.W D0,(A2)` | Store unsigned magnitude |
| `2024` | `ADDQ.W #2,A2` | Advance the full 32-bit pointer; preserve flags |
| `2026` | `NOT.B (A1)` | Invert the negative-input mask |
| `2028` | `NEG.B (A1)+` | Convert `FF/00` into `1/0`; advance once |
| `202A` | `ADD.B (-1,A1),D2` | Count nonnegative inputs |
| `202E` | `SUBQ.W #1,D3` | Decrement the remaining count |
| `2030` | `BNE.B 2016` | Repeat until zero |
| `2032` | `LEA (12006008).L,A3` | Select one past the two-long input |
| `2038` | `TST.L D3` | Seed Z; the final SUBQ left X clear |
| `203A` | `NEGX.L -(A3)` | Low long: `00000001` becomes `FFFFFFFF`; X set, Z clear |
| `203C` | `NEGX.L -(A3)` | High long: `FFFFFFFF` with X becomes zero; Z remains clear |
| `203E` | `SEQ D4` | Clear D4's low byte because the whole result is nonzero |

The output words are `0000 0001 0001 8000`; `8000` represents unsigned
32768. Negating the signed minimum overflows, which is visible in that NEG's
record even though later instructions replace V. Classification bytes are
`01 01 00 00`, and D2 is two. The wide result is `00000000 FFFFFFFF`.
NEGX's final result long is zero, yet its cumulative Z remains clear.

Final D0 = `FFFF8000`, D2 = `00000002`, D3 = `00000000`, D4 = `01234500`,
A0 = `AB003008`, A1 = `CD004004`, A2 = `EF005008`, A3 = `12006000`, and
PC = `AB002040`. XNZVC = `10001`. All other registers and control state
retain their initial values. Code, vectors, input, guards, both stacks, and
all memory outside the three output blocks remain unchanged.

SMI reads the destination byte before writing it, as required by the original
68000. NOT/NEG read and write that byte at the same resolved address; TST
changes no data. All word/long transfers record high-first ascending bytes.

## Running and acceptance checks

`runCpu(cpu, { maxSteps: 56, endAddress: 0xAB002040 })` completes with 56
records: five setup instructions, 46 loop instructions, and five final
instructions. A budget of 54 pauses between the NEGX operations. Restoring
that snapshot and current RAM reproduces the last two records, including
the incoming extend and cumulative-zero state.

Tests check complete records against actual RAM calls and complete initial/final
memory images in both processor modes. They cover factory isolation, bounded
execution, snapshot restoration, detached records, live inputs, and reset
preservation. Replacing −1 with +2 changes the count to three and removes one
NEG from the trace. A zero wide input remains zero, sets the final SEQ byte
to `FF`, and leaves X clear and Z set.
