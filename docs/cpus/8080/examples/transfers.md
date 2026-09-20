# 8080 transfers example

This example moves a byte through registers and memory, transfers words between
HL and RAM, and exchanges register pairs and stack data. Every arithmetic flag
keeps its initial value throughout the program.

[Model contract](../../../../src/components/cpus/specifications/8080.md) ·
[Coverage](../../coverage.md#8080) ·
[Machine definition](../../../../src/machines/8080/transfers-example.machine) ·
[Example tests](../../../../tests/machines/8080/transfers-example.test.ts) ·
[CPU tests](../../../../tests/components/cpus/8080.test.ts)

## Initial state and memory

All numbers below are hexadecimal except the step column. The machine has flat,
zero-filled 64 KiB RAM, with the code below at `0000` and bytes `34 12` at `2000`.
The destination area `0080`–`0083` starts at zero.

| State | Value |
| --- | --- |
| A, B, C, D, E, H, L | `11`, `22`, `33`, `44`, `55`, `66`, `77` |
| PC, SP | `0000`, `ABCD` |
| S, Z, AC, P, CY | `1`, `0`, `1`, `0`, `1` |
| Interrupt enabled, halted | false, false |

Initial snapshots derive BC = `2233`, DE = `4455`, HL = `6677`.

## Program and expected execution

Each row is one CPU step. The state-change column gives every change apart
from PC; values not listed remain unchanged. Each record's `before` is the
previous row's resulting state, starting from the initial state above.

| Step | Address | Bytes | Instruction | PC after | Other state changes |
| --- | --- | --- | --- | --- | --- |
| 1 | `0000` | `06 A5` | MVI B,A5H | `0002` | B = `A5`, BC = `A533` |
| 2 | `0002` | `48` | MOV C,B | `0003` | C = `A5`, BC = `A5A5` |
| 3 | `0003` | `21 80 00` | LXI H,0080H | `0006` | H = `00`, L = `80`, HL = `0080` |
| 4 | `0006` | `71` | MOV M,C | `0007` | — |
| 5 | `0007` | `56` | MOV D,M | `0008` | D = `A5`, DE = `A555` |
| 6 | `0008` | `36 5A` | MVI M,5AH | `000A` | — |
| 7 | `000A` | `7A` | MOV A,D | `000B` | A = `A5` |
| 8 | `000B` | `32 81 00` | STA 0081H | `000E` | — |
| 9 | `000E` | `2A 80 00` | LHLD 0080H | `0011` | H = `A5`, L = `5A`, HL = `A55A` |
| 10 | `0011` | `EB` | XCHG | `0012` | E = `5A`, DE = `A55A`, L = `55`, HL = `A555` |
| 11 | `0012` | `22 82 00` | SHLD 0082H | `0015` | — |
| 12 | `0015` | `21 00 20` | LXI H,2000H | `0018` | H = `20`, L = `00`, HL = `2000` |
| 13 | `0018` | `F9` | SPHL | `0019` | SP = `2000` |
| 14 | `0019` | `E3` | XTHL | `001A` | H = `12`, L = `34`, HL = `1234` |
| 15 | `001A` | `76` | HLT | `001B` | halted = true |

Each instruction fetches the listed bytes consecutively at the listed address.
Only those fetches populate `instruction.bytes`. Additional data accesses,
after all instruction fetches in the step, are exactly:

| Step | Ordered data accesses |
| --- | --- |
| 4 | Write `A5` at `0080` |
| 5 | Read `A5` at `0080` |
| 6 | Write `5A` at `0080` |
| 8 | Write `A5` at `0081` |
| 9 | Read `5A` at `0080`, then `A5` at `0081` |
| 11 | Write `55` at `0082`, then `A5` at `0083` |
| 14 | Read `34` at `2000`, then `12` at `2001`; write `20` at `2001`, then `00` at `2000` |

The memory byte at `0080` changes twice. D retains the first value, so A later
receives `A5` even though RAM already contains `5A`. XTHL exchanges the current
HL with the word at SP without changing SP or performing a push/pop.

Steps 1–14 report `executed`. HLT reports `halted`; a subsequent step has
`instruction: null` and no accesses. No caller completion address is needed.

The final state is A = `A5`, BC = `A5A5`, DE = `A55A`, HL = `1234`, SP = `2000`,
PC = `001B`, with the initial flags and interrupt-enable value preserved.
The final RAM image differs only at `0080`–`0083` (bytes `5A A5 55 A5`) and
`2000`–`2001` (bytes `00 20`). All code and all other RAM remain unchanged.

## Instruction scope and references

The [Intel 8080 Assembly Language Programming Manual][intel] defines MOV,
MVI, LDAX/STAX, LDA/STA, LHLD/SHLD, XCHG, XTHL, and SPHL in Chapter 2 and
Appendix B. All transfer forms preserve arithmetic flags. MOV supports all
register/memory combinations except M,M; MVI supports all eight destinations.
LDAX/STAX select BC or DE; direct forms encode a little-endian address.

The [model's data-transfer access contract](../../../../src/components/cpus/specifications/8080.md#word-operands-and-transfers)
specifies memory order, wrapped addresses, and overlapping code/data behavior.
The implementation builds MOV/MVI handlers from the CPU's operand table;
the tests use separately authored opcode rows and expected state changes.

## Acceptance checks

`create8080TransfersExample()` produces fresh CPU and RAM instances.
The [runner](../../../runtime/runner.md), given a budget of fifteen steps,
returns fifteen complete records and `stopReason: "halted"`. Tests check the
initial image, each complete record, actual RAM calls, and the full final image.

CPU reset clears halt and interrupt enable and sets PC to `0000`, preserving
the final registers, flags, SP, and RAM. A fresh factory call restores the
specified starting state and original memory. Retained records remain unchanged
across reset, RAM edits, and execution in another instance.

CPU tests cover every MOV combination, every MVI destination and byte value,
flag preservation, PC and data-address wrapping, source/destination aliases,
overlapping instruction bytes, current RAM, two-byte order, and unchanged-value
writes. They independently check pair views and preserve HLT at opcode `76`.

[intel]: https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf
