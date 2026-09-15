# 68000 word-buffer sum example

[Model contract](../model.md#register-and-address-arithmetic) ·
[Machine definition](../../../../src/machines/68000/word-sum-example.machine) ·
[Example tests](../../../../tests/machines/68000/word-sum-example.test.ts)

This program sums four words independently in D0 and RAM, subtracts one from
both totals, and compares the results. It combines ADD, SUB, CMP, ADDA, SUBA,
and CMPA with a pointer-controlled loop. The inputs distinguish word carry
from signed overflow; pointer adjustments preserve the final comparison flags.

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

The zero-filled 16 MiB RAM image has reset vectors `56 00 90 00 AB 00 20 00`
at `000000`, the 48-byte program at `002000`, and the four big-endian words
`7FFF 0001 FFFF 0002` at `003000`. `DE AD` and `BE EF` guard that eight-byte
input block. The output at `004000` starts as `CC CC`, with the same guards.
Construction does not reset or execute the CPU.

## Program and expected execution

Addresses in the table have logical prefix `AB00`. Values are hexadecimal.
The machine definition gives the exact bytes for every instruction.

| PC | Instruction | Effect |
| --- | --- | --- |
| `2000` | `MOVEA.L #AB003000,A0` | Select input |
| `2006` | `MOVEA.L A0,A1` | Copy input pointer |
| `2008` | `ADDA.W #8,A1` | A1 = `AB003008`, one past the input |
| `200C` | `MOVEA.L #CD004000,A2` | Select memory accumulator |
| `2012` | `MOVEQ #0,D0` | Clear register accumulator |
| `2014` | `MOVE.W D0,(A2)` | Clear memory accumulator |
| `2016` | `MOVE.W (A0)+,D1` | Load next word; retain D1's upper word |
| `2018` | `ADD.W D1,D0` | Add to register total |
| `201A` | `ADD.W D1,(A2)` | Read, add, and write memory total |
| `201C` | `CMPA.L A1,A0` | Compare full pointers; preserve X |
| `201E` | `BCS.B 2016` | Repeat while unsigned A0 < A1 |
| `2020` | `MOVEQ #1,D2` | Select correction |
| `2022` | `SUB.W D2,D0` | Correct register total |
| `2024` | `SUB.W D2,(A2)` | Correct memory total |
| `2026` | `CMP.W (A2),D0` | Equal totals set Z; no writeback |
| `2028` | `SUBA.W #8,A0` | Rewind input, preserving comparison flags |
| `202C` | `ADDA.W #-2,A1` | Sign-extend `FFFE`; point to last input word |

The loop executes four times. The totals and flags after each ADD are:

| Input word | Word total | XNZVC |
| --- | --- | --- |
| `7FFF` | `7FFF` | `00000` |
| `0001` | `8000` | `01010` |
| `FFFF` | `7FFF` | `10011` |
| `0002` | `8001` | `01010` |

The corrected total is `8000`. Final D0 = `00008000`, D1 = `55660002`,
D2 = `00000001`, A0 = `AB003000`, A1 = `AB003006`, A2 = `CD004000`,
and PC = `AB002030`. XNZVC = `00100`; control flags and all other registers
remain unchanged. Physical `004000`–`004001` contains `80 00`. The input,
guards, code, vectors, stacks, and all other RAM remain unchanged.

Every memory arithmetic instruction resolves its destination once, then reads
and writes the word high byte first. CMP reads without writing. CMPA reads
only its operation word here because both operands are registers.

## Running and acceptance checks

`runCpu(cpu, { maxSteps: 32, endAddress: 0xAB002030 })` completes with 32
executed records. A budget of 21 pauses after the third iteration; eleven more
instructions finish. Restoring the CPU snapshot and current RAM reproduces the
remaining records. The endpoint retains all 32 logical address bits.

Tests specify complete records independently, compare logged accesses with
actual RAM calls, and check complete initial/final memory images. They cover
factory isolation, bounded resumption, snapshot restoration, retained traces,
both processor modes, and reset preservation. Replacing the first input with
zero changes both corrected totals to `0001` and still leaves Z set.

The [arithmetic contract](../model.md#references-and-checks) links Motorola's
encoding and flag references. CPU tests supply the broader operand, addressing,
flag, alias, wrapping, and alignment checks.
