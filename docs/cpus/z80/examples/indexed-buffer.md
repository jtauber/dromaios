# Z80 indexed buffer and block search

This example copies four bytes, transforms two bytes using IX/IY, then searches
for the marked byte. LDIR and CPIR each expose four iterations, so the runner
can stop and resume in the middle of either operation.

[Machine definition](../../../../src/machines/z80/indexed-buffer-example.machine) ·
[Tests](../../../../tests/machines/z80/indexed-buffer-example.test.ts) ·
[Model contract](../../../../src/components/cpus/specifications/z80.md) ·
[Coverage](../../coverage.md#z80)

The explicit initial state sets `interruptDeferred` and `nmiDeferred` to false.

## Initial setup

The machine uses flat 64 KiB RAM. PC is `0200`, SP is `9000`, IX/IY are
`1234/5678`, I is `42`, and R is `FE`. IM is 2, IFF1 is true, IFF2 is false,
and the CPU is running. Main A/B/C/D/E/H/L are `11/22/33/44/55/66/77`;
S/H/N are set and Z/PV/C are clear. Alternate A/B/C/D/E/H/L are
`88/99/AA/BB/CC/DD/EE`; alternate Z/PV/C are set and S/H/N are clear.

All numbers in the program and state tables are hexadecimal.

| Address | Initial bytes | Purpose |
| --- | --- | --- |
| `00FD` | `DE 12 34 56 78 AD` | Source at `00FE`–`0101` with guards |
| `03FF` | `DE AA BB CC DD 80 AD` | Destination at `0400`–`0403`, status at `0404`, guards |
| `04FF` | `DE AA BB AD` | Result pointer at `0500`–`0501`, guards |

Other RAM is zero except for the program. Factories create fresh CPU and RAM
objects; the memory-only factory initializes the same bytes without execution.

## Program

| Address | Bytes | Instruction |
| --- | --- | --- |
| `0200` | `21 FE 00` | LD HL,00FEH |
| `0203` | `11 00 04` | LD DE,0400H |
| `0206` | `01 04 00` | LD BC,0004H |
| `0209` | `ED B0` | LDIR |
| `020B` | `DD 21 01 04` | LD IX,0401H |
| `020F` | `FD 21 04 04` | LD IY,0404H |
| `0213` | `DD 7E FF` | LD A,(IX−1) |
| `0216` | `FD 77 FF` | LD (IY−1),A |
| `0219` | `DD CB FF 0E` | RRC (IX−1) |
| `021D` | `FD CB FF C6` | SET 0,(IY−1) |
| `0221` | `3E 13` | LD A,13H |
| `0223` | `21 00 04` | LD HL,0400H |
| `0226` | `01 04 00` | LD BC,0004H |
| `0229` | `ED B1` | CPIR |
| `022B` | `C2 40 02` | JP NZ,0240H |
| `022E` | `ED 63 00 05` | LD (0500H),HL |
| `0232` | `FD CB 00 C6` | SET 0,(IY+0) |
| `0236` | `76` | HALT |
| `0240` | `3E 00` | LD A,00H — failure |
| `0242` | `FD 77 00` | LD (IY+0),A |
| `0245` | `76` | HALT |

LDIR copies the source across a page boundary without changing it. Each
iteration decrements BC and advances HL/DE. PC remains `0209` for the first
three iterations, then advances to `020B` when BC reaches zero.

IX−1 selects the first destination byte and IY−1 the last. The program mirrors
`12` into the last byte, rotates the first byte to `09`, and marks the last
with bit 0, producing `09 34 56 13`. The displacement `FF` means −1.
RRC sets even parity for `09` and clears S/Z/H/N/C; SET preserves those flags.

CPIR searches for `13`. PC remains `0229` until the fourth comparison. The
subtraction results used for S/Z/H are `0A`, `DF`, `BD`, and `00`; P/V reports
remaining BC, independently of parity or arithmetic overflow. C remains clear.
On the final match, Z is set and P/V clear. The branch falls through, stores
the following address `0404` at `0500` low byte first, and sets status bit 0.

## Final state and records

The default run takes **24 steps**, including HALT. Eight are block iterations.
Eight steps have one opcode fetch and sixteen have two: R advances 40 times,
from `FE` to `A6`, preserving bit 7. Indexed-CB instructions contribute two R
increments despite fetching four encoding bytes.

| State | Final value |
| --- | --- |
| A | `13` |
| BC / DE / HL | `0000` / `0404` / `0404` |
| IX / IY | `0401` / `0404` |
| PC / SP | `0237` / `9000` |
| R | `A6` |
| S / Z / H / PV / N / C | `0 / 1 / 0 / 0 / 1 / 0` |
| Destination | `09 34 56 13` |
| Status | `81` |
| Result pointer bytes | `04 04` |

The alternate bank, I, interrupt latches/mode, source, and all guards remain
unchanged. Each record contains actual instruction reads followed by data
accesses: LDIR reads then writes one byte; CPIR only reads; RRC and SET read
then write, even for an unchanged result. HALT records its opcode once;
subsequent halted steps have no instruction or accesses.

## Acceptance checks

The tests independently specify all 24 before/after snapshots, instruction
bytes, ordered memory accesses, and complete initial/final RAM images. They
also observe the actual RAM calls and compare them with the records.

Changing the search immediate at `0222` exercises a match in every position.
Earlier matches leave BC nonzero and P/V set, store the corresponding following
address, and still set status to `81`. Searching for absent `99` exhausts BC,
leaves Z/PV clear, branches to the failure path, writes status `00`, preserves
the result bytes `AA BB`, and halts in 24 steps.

Every boundary is checked with a runner budget and reconstruction from a
snapshot, including partial copies and searches. A budget ending before HALT
reports `step-limit`; resumption yields the same remaining records and RAM as
an uninterrupted run. Retained records stay detached. Reset preserves final
RAM and data registers while applying the model's reset effects; fresh
factories restore the initial setup.
