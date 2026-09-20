# 8080 accumulator arithmetic and logic example

This example adds `0020` to `01F0` to produce `0210`, then subtracts `0020`
to recover `01F0`. Each calculation propagates carry or borrow between two
byte operations. It then masks and combines bits and branches on a comparison
that preserves the accumulator.

[Model contract](../../../../src/components/cpus/specifications/8080.md#arithmetic-and-logical-flags) ·
[Coverage](../../coverage.md#8080) ·
[Machine definition](../../../../src/machines/8080/alu-example.machine) ·
[Example tests](../../../../tests/machines/8080/alu-example.test.ts) ·
[CPU tests](../../../../tests/components/cpus/8080.test.ts)

## Initial state and memory

Numbers are hexadecimal except step counts and flag values. The machine has
flat, zero-filled 64 KiB RAM, with the code below at `0000` and byte `20` at
`0080`. Output bytes `0082`–`0086` start at zero.

| State | Value |
| --- | --- |
| A, B, C, D, E, H, L | `11`, `22`, `33`, `44`, `55`, `66`, `77` |
| PC, SP | `0000`, `ABCD` |
| S, Z, AC, P, CY | `1`, `0`, `1`, `0`, `1` |
| Interrupt enabled, halted | false, false |

Initial snapshots derive BC = `2233`, DE = `4455`, HL = `6677`.

## Program and expected execution

Each numbered row is one CPU step; the unnumbered MVI is skipped. Every record's
`before` is the preceding step's resulting state. Apart from PC and the changes
listed below, state remains unchanged. Flags change only on the eight ALU steps,
whose complete values are listed in the following table.

| Step | Address | Bytes | Instruction | PC after | Other register changes |
| --- | --- | --- | --- | --- | --- |
| 1 | `0000` | `21 80 00` | LXI H,0080H | `0003` | H = `00`, L = `80`, HL = `0080` |
| 2 | `0003` | `3E F0` | MVI A,F0H | `0005` | A = `F0` |
| 3 | `0005` | `86` | ADD M | `0006` | A = `10` |
| 4 | `0006` | `47` | MOV B,A | `0007` | B = `10`, BC = `1033` |
| 5 | `0007` | `32 82 00` | STA 0082H | `000A` | — |
| 6 | `000A` | `3E 01` | MVI A,01H | `000C` | A = `01` |
| 7 | `000C` | `CE 00` | ACI 00H | `000E` | A = `02` |
| 8 | `000E` | `32 83 00` | STA 0083H | `0011` | — |
| 9 | `0011` | `78` | MOV A,B | `0012` | A = `10` |
| 10 | `0012` | `96` | SUB M | `0013` | A = `F0` |
| 11 | `0013` | `4F` | MOV C,A | `0014` | C = `F0`, BC = `10F0` |
| 12 | `0014` | `32 84 00` | STA 0084H | `0017` | — |
| 13 | `0017` | `3A 83 00` | LDA 0083H | `001A` | A = `02` |
| 14 | `001A` | `DE 00` | SBI 00H | `001C` | A = `01` |
| 15 | `001C` | `32 85 00` | STA 0085H | `001F` | — |
| 16 | `001F` | `79` | MOV A,C | `0020` | A = `F0` |
| 17 | `0020` | `E6 3F` | ANI 3FH | `0022` | A = `30` |
| 18 | `0022` | `EE 55` | XRI 55H | `0024` | A = `65` |
| 19 | `0024` | `B0` | ORA B | `0025` | A = `75` |
| 20 | `0025` | `FE 75` | CPI 75H | `0027` | A stays `75` |
| 21 | `0027` | `CA 2C 00` | JZ 002CH | `002C` | — |
| — | `002A` | `3E FF` | MVI A,FFH | — | Skipped |
| 22 | `002C` | `32 86 00` | STA 0086H | `002F` | — |
| 23 | `002F` | `76` | HLT | `0030` | halted = true |

| Step | Operation | S | Z | AC | P | CY |
| --- | --- | --- | --- | --- | --- | --- |
| 3 | `F0 + 20 = 110` | 0 | 0 | 0 | 0 | 1 |
| 7 | `01 + 00 + carry = 02` | 0 | 0 | 0 | 0 | 0 |
| 10 | `10 - 20 = F0`, with borrow | 1 | 0 | 1 | 1 | 1 |
| 14 | `02 - 00 - borrow = 01` | 0 | 0 | 1 | 0 | 0 |
| 17 | `F0 AND 3F = 30` | 0 | 0 | 1 | 1 | 0 |
| 18 | `30 XOR 55 = 65` | 0 | 0 | 0 | 1 | 0 |
| 19 | `65 OR 10 = 75` | 0 | 0 | 0 | 0 | 0 |
| 20 | `75 - 75 = 00`, result discarded | 0 | 1 | 1 | 1 | 0 |

MOV, MVI, LDA, and STA preserve the carry/borrow between low-byte and high-byte
operations. ADD ignores the initially set CY. CPI sets Z from the comparison
result while retaining A, so JZ skips the replacement value `FF` and STA stores
`75`.

Each step fetches exactly its listed instruction bytes, in order. The skipped
MVI is never fetched. Only instruction fetches enter `instruction.bytes`.
Additional data accesses, after instruction fetching, are exactly:

| Step | Data access |
| --- | --- |
| 3 | Read `20` at `0080` |
| 5 | Write `10` at `0082` |
| 8 | Write `02` at `0083` |
| 10 | Read `20` at `0080` |
| 12 | Write `F0` at `0084` |
| 13 | Read `02` at `0083` |
| 15 | Write `01` at `0085` |
| 22 | Write `75` at `0086` |

Steps 1–22 report `executed`; HLT reports `halted`. A subsequent step returns
no instruction and no accesses. The final state is A = `75`, BC = `10F0`,
DE = `4455`, HL = `0080`, SP = `ABCD`, PC = `0030`, with the flags from step 20
and interrupt enable still false. Only output memory changes: `0082`–`0086`
contains `10 02 F0 01 75`. Code, input, and all other RAM remain unchanged.

## Instruction scope and references

The [Intel 8080 Assembly Language Programming Manual][intel], Chapter 2 and
Appendix B, defines the accumulator arithmetic/logic families and their
register, memory, and immediate forms. The
[model contract](../../../../src/components/cpus/specifications/8080.md#arithmetic-and-logical-flags) specifies exact
flag rules, including the 8080-specific auxiliary carry behavior, and access
and preservation guarantees. The introductory
[arithmetic example](arithmetic.md) remains a smaller starting program.

## Acceptance checks

`create8080AluExample()` produces fresh CPU and RAM instances. With a budget
of 23 steps, the [runner](../../../runtime/runner.md) returns 23 complete records
and `stopReason: "halted"`. Tests check the complete initial and final memory
images, every record, actual RAM calls, and the skipped instruction. A bounded
run ending after step 5 resumes with its carry intact and produces the same
remaining records.

Reset clears halt and interrupt enable and sets PC to `0000`, preserving the
calculated values, flags, and RAM. Restart creates fresh CPU/RAM instances and
restores the specified initial state and image. Retained records survive later
execution, reset, RAM edits, and restart.

CPU tests exhaust all byte pairs and both incoming carry values for each ALU
operation. Separate checks cover every encoding, all 32 flag combinations,
register aliases, comparisons that preserve A, PC wrapping, memory/code overlap,
current HL and RAM, and independently observed accesses.

[intel]: https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf
