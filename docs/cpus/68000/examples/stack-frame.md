# 68000 stack-frame and register-list example

[Model contract](../../../../src/components/cpus/specifications/68000.md#control-addresses-and-frames) ·
[Machine definition](../../../../src/machines/68000/stack-frame-example.machine) ·
[Example tests](../../../../tests/machines/68000/stack-frame-example.test.ts)

A caller passes an array pointer on the stack. Its subroutine establishes a
frame, saves working registers, loads two signed words, and returns their sum
in D0. LEA, PEA, JSR, JMP, LINK, UNLK, and MOVEM work together in sixteen steps.

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

The zero-filled 16 MiB RAM contains reset vectors `56 00 90 00 AB 00 20 00`
at `000000`, a 20-byte caller at `002000`, and a 34-byte subroutine at `002040`.
The input words `7FFF 8000` at `003000` represent 32767 and −32768; `DE AD`
and `BE EF` guard them. Construction does not reset or execute the CPU.

## Program and expected execution

Instruction addresses below have logical prefix `AB00`. Values are hexadecimal.
Let SP₀ be the caller's initial active stack pointer: `34008000` in user mode
or `56009000` after external reset selects supervisor mode.

| PC | Instruction | Effect |
| --- | --- | --- |
| `2000` | `LEA (0FFE,PC),A0` | A0 = `AB003000`; no data read |
| `2004` | `PEA (A0)` | Push the array pointer; SP = SP₀ − 4 |
| `2006` | `JSR (0038,PC)` | Push `AB00200A`; call `AB002040` |
| `2040` | `LINK A6,#-8` | Save A6; frame at SP₀ − 12; SP = SP₀ − 20 |
| `2044` | `MOVEM.L D1-D2/A0,-(A7)` | Save A0, D2, D1 in that order; SP = SP₀ − 32 |
| `2048` | `MOVEA.L (8,A6),A0` | Read the caller's argument |
| `204C` | `MOVEM.W (A0)+,D1-D2` | D1 = `00007FFF`, D2 = `FFFF8000`; A0 = `AB003004` |
| `2050` | `ADD.L D1,D2` | Sum = `FFFFFFFF`; XNZVC = `01000` |
| `2052` | `MOVE.L D2,(-4,A6)` | Save the result in a local slot |
| `2056` | `MOVE.L (-4,A6),D0` | Read the return value into D0 |
| `205A` | `MOVEM.L (A7)+,D1-D2/A0` | Restore D1, D2, A0; SP = SP₀ − 20 |
| `205E` | `UNLK A6` | Restore A6; SP = SP₀ − 8 |
| `2060` | `RTS` | Return to `AB00200A`; SP = SP₀ − 4 |
| `200A` | `ADDA.W #4,A7` | Discard argument; SP = SP₀ |
| `200E` | `LEA (0010,PC),A1` | A1 = `AB002020` |
| `2012` | `JMP (A1)` | Reach endpoint `AB002020` |

MOVEM's save mask is `6080`, with reversed predecrement register numbering;
its restore mask is `0106`, with normal numbering. The word-load mask `0006`
selects D1 and D2. MOVEM preserves flags while sign-extending both words,
so the incoming condition flags survive until ADD. The later moves preserve
ADD's XNZVC result; the remaining frame, address, and control instructions
preserve all flags.

Final D0 = `FFFFFFFF`, A0 = `AB003000`, A1 = `AB002020`, and PC = `AB002020`.
D1–D7, A2–A6, both stack pointers, and control state retain their initial values.
The stack memory remains after deallocation:

| Relative address | Remaining long value |
| --- | --- |
| SP₀ − 32 | `55667788` (saved D1) |
| SP₀ − 28 | `99AABBCC` (saved D2) |
| SP₀ − 24 | `AB003000` (saved A0) |
| SP₀ − 20 | `00000000` (unused local slot) |
| SP₀ − 16 | `FFFFFFFF` (local result) |
| SP₀ − 12 | `70000000` (saved A6) |
| SP₀ − 8 | `AB00200A` (return address) |
| SP₀ − 4 | `AB003000` (argument) |

Code, vectors, input, guards, the inactive stack, and all other memory remain
unchanged. Each transfer records high-first bytes at ascending addresses;
predecrement MOVEM visits its long slots in descending order.

## Running and acceptance checks

`runCpu(cpu, { maxSteps: 16, endAddress: 0xAB002020 })` completes with sixteen
executed records. Seven steps pause after loading the input words; nine more
finish. A restored CPU snapshot and current RAM reproduce the remaining records.
The endpoint retains all 32 logical address bits.

Tests specify full records independently and compare them with actual RAM
calls and complete initial/final memory images in both modes. They also check
factory isolation, bounded resumption, retained records, snapshot restoration,
and reset preservation. Replacing the first input word with zero produces
`FFFF8000` in D0 and the local slot, while restoring the caller's stack.
