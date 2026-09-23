# 68000 masked buffer merge example

[Model contract](../../../../src/components/cpus/specifications/68000.md#logical-operations-and-readmodifywrite) ·
[Machine definition](../../../../src/machines/68000/logic-example.machine) ·
[Example tests](../../../../tests/machines/68000/logic-example.test.ts)

This program merges selected bytes from four source longs into an existing
destination buffer. AND keeps the selected source bits and complementary
destination bits; OR joins them. EOR accumulates a checksum of the merged
longs, while a second accumulator records every bit present anywhere in the
result. All values below are hexadecimal.

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
| entry.kind, entry.vector | `none`, `00` |
| halted, faulted, tracePending | `false`, `false`, `false` |
| X, N, Z, V, C, T, S | `1`, `0`, `1`, `1`, `1`, `0`, `0` |

The zero-filled 16 MiB image contains reset vectors `56 00 90 00 AB 00 20 00`
at `000000` and the 58-byte program at `002000`. Source longs occupy
`003000`–`00300F`, destination longs occupy `004000`–`00400F`, and the
checksum/summary occupy `005000`–`005007`, initially eight `CC` bytes.
Each data block has `DE AD` immediately before it and `BE EF` immediately
after it. Construction does not reset or execute the CPU.

## Program

PC values in this table have logical prefix `AB00`. The machine definition
gives every instruction's literal bytes.

| PC | Instruction | Effect |
| --- | --- | --- |
| `2000` | `MOVEA.L #AB003000,A0` | Select source buffer |
| `2006` | `MOVEA.L #CD004000,A1` | Select destination buffer |
| `200C` | `MOVE.L #00FF00FF,D2` | Select replacement bits |
| `2012` | `MOVEQ #-1,D3` | Set all preservation-mask bits |
| `2014` | `EOR.L D2,D3` | Complement the mask: D3 = `FF00FF00` |
| `2016` | `MOVEQ #0,D4` | Clear XOR checksum |
| `2018` | `MOVEQ #0,D5` | Clear OR summary |
| `201A` | `MOVEQ #3,D7` | Four loop iterations |
| `201C` | `MOVE.L (A0)+,D0` | Read the next source long |
| `201E` | `AND.L D2,D0` | Keep selected source bits |
| `2020` | `AND.L D3,(A1)` | Keep complementary destination bits |
| `2022` | `OR.L D0,(A1)` | Merge selected source bits into destination |
| `2024` | `MOVE.L (A1)+,D1` | Read back the merged long |
| `2026` | `EOR.L D1,D4` | Accumulate XOR checksum |
| `2028` | `OR.L D1,D5` | Accumulate OR summary |
| `202A` | `DBF D7,201C` | Repeat until D7.W becomes `FFFF` |
| `202E` | `MOVE.L D4,(CD005000).L` | Store checksum |
| `2034` | `MOVE.L D5,(CD005004).L` | Store OR summary |

The replacement mask is `00FF00FF`, so each destination receives the second
and fourth bytes of its corresponding source long, retaining its first and
third bytes. The loop results are:

| Source | Original destination | Merged destination | Running XOR | Running OR |
| --- | --- | --- | --- | --- |
| `11223344` | `AABBCCDD` | `AA22CC44` | `AA22CC44` | `AA22CC44` |
| `89ABCDEF` | `12345678` | `12AB56EF` | `B8899AAB` | `BAABDEEF` |
| `FFFF0000` | `FF00FF00` | `FFFFFF00` | `477665AB` | `FFFFFFEF` |
| `0000FFFF` | `00000000` | `000000FF` | `47766554` | `FFFFFFFF` |

The memory AND still writes every byte for the third and fourth destinations,
whose retained bits were already correct. Each memory AND/OR resolves its
operand once, reads four bytes, then writes four bytes high first. EOR's
register forms perform no data-memory accesses. Postincrement advances each
buffer pointer by four exactly once per iteration.

All instructions preserve X = 1. Logic replaces N/Z and clears V/C. The
fourth iteration's memory AND produces zero and sets Z; its subsequent OR
clears Z. DBF preserves the flags from the OR summary. No instruction in this
program changes the control flags or interrupt mask.

## Completion and acceptance checks

`runCpu(cpu, { maxSteps: 42, endAddress: 0xAB00203A })` completes with 42
executed records. Final registers are:

| Registers | Values |
| --- | --- |
| D0, D1, D2, D3 | `000000FF`, `000000FF`, `00FF00FF`, `FF00FF00` |
| D4, D5, D7 | `47766554`, `FFFFFFFF`, `0000FFFF` |
| A0, A1, PC | `AB003010`, `CD004010`, `AB00203A` |
| XNZVC | `11000` |

All other registers retain their initial values. The destination contains
the four merged longs; `005000`–`005007` contains `47 76 65 54 FF FF FF FF`.
The source, guards, code, vectors, stacks, and other memory remain unchanged.

A budget of eleven pauses after clearing the first destination's replaceable
bits. Resuming for 31 instructions completes the merge. A CPU restored from
that snapshot with current RAM produces the same remaining records.

Tests specify all records independently, compare traces with actual RAM calls,
and check complete initial/final memory images. They cover factory isolation,
logical completion, bounded resumption, snapshot restoration, retained traces,
both processor modes, and reset preservation. Changing the loaded mask to
`000000FF` replaces only the fourth byte of each destination. CPU tests cover
the other sizes, addressing forms, aliases, flag inputs, and alignment faults.

The [model references](../../../../src/components/cpus/specifications/68000.md#hardware-references) identify the original
68000 instruction formats and flag rules used here.
