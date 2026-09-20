# 6502 example: shifts and memory counters

**Status: implemented and tested.**
Shift a two-byte word left twice, passing carry between its halves, then
shift it right once. Count loop iterations directly in memory and exercise
all four accumulator shift/rotate operations. D stays set throughout.

[Model contract](../../../../src/components/cpus/specifications/6502.md#shifts-rotates-and-byte-adjustments) ·
[Example definition](../../../../src/machines/6502/shifts-example.machine) ·
[Example tests](../../../../tests/machines/6502/shifts-example.test.ts) ·
[CPU coverage](../../coverage.md#6502)

## Definition and initial state

Addresses and byte values are hexadecimal; step counts are decimal.
Initialize zero-filled 64 KiB RAM with:

| Address | Bytes | Instruction or data |
| --- | --- | --- |
| `007F` | `AA FF 80 02 00 55` | Sentinels around word `80FF` (low byte first), remaining count `02`, and completed count `00` |
| `008F` | `AA CC 55` | Sentinels around the accumulator result at `0090` |
| `0200` | `A2 01` | `LDX #$01` |
| `0202` | `16 7F` | Loop: `ASL $7F,X` (low byte at `0080`) |
| `0204` | `3E 80 00` | `ROL $0080,X` (high byte at `0081`) |
| `0207` | `E6 83` | `INC $83` (completed count) |
| `0209` | `C6 82` | `DEC $82` (remaining count) |
| `020B` | `D0 F5` | `BNE $0202` |
| `020D` | `46 81` | `LSR $81` (high byte) |
| `020F` | `66 80` | `ROR $80` (low byte) |
| `0211` | `A5 80` | `LDA $80` |
| `0213` | `0A` | `ASL A` |
| `0214` | `6A` | `ROR A` |
| `0215` | `2A` | `ROL A` |
| `0216` | `4A` | `LSR A` |
| `0217` | `8D 90 00` | `STA $0090` |
| `021A` | `4C 20 02` | `JMP $0220` |
| `FFFC` | `00 02` | Reset vector: `0200` |

Initial A/X/Y = `11/22/33`, PC/SP = `0200/AB`, and all six flags
N/V/D/I/Z/C are set. These are explicit example choices, not reset defaults.
`create6502ShiftsExample()` supplies fresh `{ cpu, ram, endAddress }` with
`endAddress = 0220`. `create6502ShiftsExampleMemory()` supplies the same image
without a CPU. Neither factory resets or executes instructions.

## Expected execution

The first ASL/ROL pair changes `80FF` to `01FE`, with the original top bit
leaving through C. The second changes `01FE` to `03FC`. LSR of the high byte
followed by ROR of the low byte then yields `01FE`. Bits shifted out of the
word are lost; this is not a reversible round trip.

All twenty steps execute. X becomes `01` at step 1 and stays there; Y/SP
stay `33/AB`. V/D/I stay set. Each before-state is the preceding after-state
or the initial state. The table gives the changed memory byte and result
flags; A stays `11` until step 14.

| Step | PC before | PC after | Memory change | A after | N | Z | C |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `0202` | — | `11` | 0 | 0 | 1 |
| 2 | `0202` | `0204` | `0080: FF → FE` | `11` | 1 | 0 | 1 |
| 3 | `0204` | `0207` | `0081: 80 → 01` | `11` | 0 | 0 | 1 |
| 4 | `0207` | `0209` | `0083: 00 → 01` | `11` | 0 | 0 | 1 |
| 5 | `0209` | `020B` | `0082: 02 → 01` | `11` | 0 | 0 | 1 |
| 6 | `020B` | `0202` | — | `11` | 0 | 0 | 1 |
| 7 | `0202` | `0204` | `0080: FE → FC` | `11` | 1 | 0 | 1 |
| 8 | `0204` | `0207` | `0081: 01 → 03` | `11` | 0 | 0 | 0 |
| 9 | `0207` | `0209` | `0083: 01 → 02` | `11` | 0 | 0 | 0 |
| 10 | `0209` | `020B` | `0082: 01 → 00` | `11` | 0 | 1 | 0 |
| 11 | `020B` | `020D` | — | `11` | 0 | 1 | 0 |
| 12 | `020D` | `020F` | `0081: 03 → 01` | `11` | 0 | 0 | 1 |
| 13 | `020F` | `0211` | `0080: FC → FE` | `11` | 1 | 0 | 0 |
| 14 | `0211` | `0213` | — | `FE` | 1 | 0 | 0 |
| 15 | `0213` | `0214` | — | `FC` | 1 | 0 | 1 |
| 16 | `0214` | `0215` | — | `FE` | 1 | 0 | 0 |
| 17 | `0215` | `0216` | — | `FC` | 1 | 0 | 1 |
| 18 | `0216` | `0217` | — | `7E` | 0 | 0 | 0 |
| 19 | `0217` | `021A` | `0090: CC → 7E` | `7E` | 0 | 0 | 0 |
| 20 | `021A` | `0220` | — | `7E` | 0 | 0 | 0 |

Final RAM differs only at `0080:FE`, `0081:01`, `0082:00`, `0083:02`, and
`0090:7E`. The caller stops before fetching `0220`; stepping directly there
executes BRK and follows the unused IRQ/BRK vector to `0000`.

## Records and acceptance checks

Instruction bytes are the opcode and operands listed above, read in order
at PC. Each memory modification then records a read of the original byte,
a write of that same byte, and a write of the result, all at one address.
For example, step 2 records `R 0202:16`, `R 0203:7F`, `R 0080:FF`,
`W 0080:FF`, `W 0080:FE`. Step 14 additionally reads `0080:FE`; step 19
writes `0090:7E` once. Accumulator shifts read only their opcode. No dummy
reads, prefetches, or cycle counts are included.

The [tests](../../../../tests/machines/6502/shifts-example.test.ts) independently
specify every state and access in the twenty records and check:

- Actual RAM calls, complete initial/final images, all six instruction
  families, both branch paths, and independent factories.
- Resumption from snapshots and current RAM between shifted bytes, counters,
  and accumulator operations. Carry and the remaining trace must survive.
- Reset after completion reads the vector, changes PC/SP to `0200/A8`, and
  preserves other state, D, and all RAM. Fresh factories restore the original
  image; captured records survive reset and host writes.
- Changing the loop displacement to `FE` while Z is clear creates a self-loop;
  the runner reaches its instruction budget and the branch preserves carry.

Instruction behavior and encodings follow the
[Synertek/MOS programming manual](https://syncopate.us/books/Synertek6502ProgrammingManual.html),
sections 10.1–10.8 and Appendix B. The [model contract](../../../../src/components/cpus/specifications/6502.md#shifts-rotates-and-byte-adjustments)
defines the recorded NMOS write sequence and the omitted bus activity.
