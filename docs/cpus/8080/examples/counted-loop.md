# 8080 counted-loop example

This example increments three memory bytes across the `FFFF` → `0000` boundary.
INR changes each byte, DAD advances the address, and DCR/JNZ count down the
remaining bytes. DCX then points HL back to the last byte changed and SHLD
stores that address.

[Model contract](../model.md#increment-decrement-and-word-arithmetic) ·
[Coverage](../../coverage.md#8080) ·
[Machine definition](../../../../src/machines/8080/counted-loop-example.machine) ·
[Example tests](../../../../tests/machines/8080/counted-loop-example.test.ts) ·
[CPU tests](../../../../tests/components/cpus/8080.test.ts)

## Initial state and memory

Numbers are hexadecimal except step counts and flag values. The machine has
flat, zero-filled 64 KiB RAM, with the code below at `0200`. The three data
bytes are `FF` at `FFFF`, `0F` at `0000`, and `7F` at `0001`. Output bytes
`0080`–`0081` start at zero.

| State | Value |
| --- | --- |
| A, B, C, D, E, H, L | `11`, `22`, `33`, `44`, `55`, `66`, `77` |
| PC, SP | `0200`, `ABCD` |
| S, Z, AC, P, CY | `1`, `0`, `1`, `0`, `1` |
| Interrupt enabled, halted | false, false |

Initial snapshots derive BC = `2233`, DE = `4455`, HL = `6677`.

## Program and expected execution

Each row is one executed instruction. Each record's `before` is the previous
row's resulting state. The last column lists changes apart from PC and flags;
the following table specifies flags. State not listed remains unchanged.

| Step | Address | Bytes | Instruction | PC after | Other state changes |
| --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `21 FF FF` | LXI H,FFFFH | `0203` | H = `FF`, L = `FF`, HL = `FFFF` |
| 2 | `0203` | `11 01 00` | LXI D,0001H | `0206` | D = `00`, E = `01`, DE = `0001` |
| 3 | `0206` | `06 03` | MVI B,03H | `0208` | B = `03`, BC = `0333` |
| 4 | `0208` | `34` | INR M | `0209` | — |
| 5 | `0209` | `19` | DAD D | `020A` | H = `00`, L = `00`, HL = `0000` |
| 6 | `020A` | `05` | DCR B | `020B` | B = `02`, BC = `0233` |
| 7 | `020B` | `C2 08 02` | JNZ 0208H | `0208` | — |
| 8 | `0208` | `34` | INR M | `0209` | — |
| 9 | `0209` | `19` | DAD D | `020A` | L = `01`, HL = `0001` |
| 10 | `020A` | `05` | DCR B | `020B` | B = `01`, BC = `0133` |
| 11 | `020B` | `C2 08 02` | JNZ 0208H | `0208` | — |
| 12 | `0208` | `34` | INR M | `0209` | — |
| 13 | `0209` | `19` | DAD D | `020A` | L = `02`, HL = `0002` |
| 14 | `020A` | `05` | DCR B | `020B` | B = `00`, BC = `0033` |
| 15 | `020B` | `C2 08 02` | JNZ 0208H | `020E` | — |
| 16 | `020E` | `2B` | DCX H | `020F` | L = `01`, HL = `0001` |
| 17 | `020F` | `22 80 00` | SHLD 0080H | `0212` | — |
| 18 | `0212` | `76` | HLT | `0213` | halted = true |

Flags are listed in S/Z/AC/P/CY order. Other instructions preserve the flags
from the preceding row or the specified initial state.

| Step | Operation | Flags after |
| --- | --- | --- |
| 4 | Increment `FF` to `00`, preserving carry | `0/1/1/1/1` |
| 5 | Add `0001` to `FFFF`, wrapping HL and setting carry | `0/1/1/1/1` |
| 6 | Decrement B from `03` to `02`, preserving carry | `0/0/1/0/1` |
| 8 | Increment `0F` to `10`, preserving carry | `0/0/1/0/1` |
| 9 | Add `0001` to `0000`, clearing carry | `0/0/1/0/0` |
| 10 | Decrement B from `02` to `01`, preserving carry | `0/0/1/0/0` |
| 12 | Increment `7F` to `80`, preserving carry | `1/0/1/0/0` |
| 13 | Add `0001` to `0001`, preserving S/Z/AC/P | `1/0/1/0/0` |
| 14 | Decrement B from `01` to `00`, preserving carry | `0/1/1/1/0` |

INR M sets Z on the first iteration, but DCR B replaces Z before the branch.
The third DCR sets Z because the counter reaches zero, so JNZ falls through.
DAD ignores incoming CY and changes only CY; DCX preserves all five flags,
including the final Z even though HL becomes nonzero.

Each step fetches exactly its listed bytes, consecutively. Additional data
accesses, after the instruction fetches, are exactly:

| Step | Ordered data accesses |
| --- | --- |
| 4 | Read `FF` at `FFFF`, then write `00` there |
| 8 | Read `0F` at `0000`, then write `10` there |
| 12 | Read `7F` at `0001`, then write `80` there |
| 17 | Write `01` at `0080`, then `00` at `0081` |

Data reads do not enter `instruction.bytes`. The unchanged-value write at
`0081` is still performed and recorded. Steps 1–17 report `executed`; HLT
reports `halted`. A subsequent step has no instruction and no accesses.

The final state is A = `11`, BC = `0033`, DE = `0001`, HL = `0001`, SP = `ABCD`,
PC = `0213`, with the flags from step 14 and interrupt enable still false.
The final data is `00` at `FFFF`, `10 80` at `0000`–`0001`, and `01 00` at
`0080`–`0081`. All code and other RAM remain unchanged.

## Acceptance checks and references

`create8080CountedLoopExample()` produces fresh CPU and RAM instances. With a
budget of 18 steps, the [runner](../../../runtime/runner.md) returns 18 complete
records and `stopReason: "halted"`. Tests check both full memory images,
every record, and the actual RAM calls. A run paused after step 5 resumes from
its wrapped address with carry intact and produces the same remaining records.

Reset clears halt and interrupt enable and sets PC to `0000`, preserving
registers, flags, and modified RAM. That is the CPU reset address; restarting
the example instead restores its entry point `0200` and original data in fresh
components. Retained records survive later execution, reset, RAM edits, and
restart.

CPU checks cover all byte values and flag combinations for every INR/DCR
destination, all word values for every DCX target, DAD source selection,
byte and word carries, DAD H aliasing, flag preservation, PC wrapping, and
memory/code overlap. Word-addition expectations propagate carry between two
independent byte calculations.

The [Intel 8080 Assembly Language Programming Manual][intel], pages 15 and 24,
defines INR/DCR, DAD, and DCX. The
[model contract](../model.md#increment-decrement-and-word-arithmetic) records
their exact flags, access ordering, and preservation rules.

[intel]: https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf
