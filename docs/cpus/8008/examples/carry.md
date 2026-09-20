# 8008 carry and restart example

This program rotates the little-endian word `4081H` left through an incoming
carry of one, producing `8103H` and clearing carry. Two calls to a byte routine
use RST's fixed vector. Register adjustments preserve carry while advancing
the pointer across a page boundary and counting the bytes.

[Model contract](../../../../src/components/cpus/specifications/8008.md#accumulator-rotations) ·
[Coverage](../../coverage.md#8008) ·
[Machine definition](../../../../src/machines/8008/carry-example.machine) ·
[Example tests](../../../../tests/machines/8008/carry-example.test.ts) ·
[CPU tests](../../../../tests/components/cpus/8008.test.ts)

## Initial state and memory

All numbers are hexadecimal except step counts and flag values. The machine
has 16 KiB RAM. A/B/C/D/E/H/L start at `11/22/33/44/55/C0/FF`, S/Z/P/C at
`1/0/1/1`, and the address slots at
`[1111 1222 1333 1444 1555 1666 1777 0200]`. Slot 7 is selected and
`halted = false`. Raw HL is `C0FF`, addressing RAM at `00FF`.

RAM contains `CC 81 40 CC` at `00FE`–`0101`: the word lies between two guards.
The byte routine is at `0008`–`000E` and the main program at `0200`–`0207`.
All other RAM starts at zero. Generated factories
`create8008CarryExampleMemory()` and `create8008CarryExample()` provide fresh
RAM and CPU state without executing. There is no factory completion address;
the program stops with HLT.

## Program and expected execution

RST `0008H` saves `0203` in slot 7 and selects slot 0. The routine rotates and
stores a byte, increments L, and returns immediately if L did not wrap. When L
wraps, it increments H first. DCC counts bytes independently of carry. The
register C and carry flag C are distinct.

| Step | Address | Bytes | Instruction | PC after | Register or RAM change |
| --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `16 02` | LCI 02H | `0202` | C = `02` |
| 2 | `0202` | `0D` | RST 0008H | `0008` | Select slot 0; slot 7 = `0203` |
| 3 | `0008` | `C7` | LAM | `0009` | A = `81` from `[00FF]` |
| 4 | `0009` | `12` | RAL | `000A` | A = `03`, carry = 1 |
| 5 | `000A` | `F8` | LMA | `000B` | `[00FF] = 03` |
| 6 | `000B` | `30` | INL | `000C` | L = `00`, HL = `C000` |
| 7 | `000C` | `0B` | RFZ | `000D` | Not taken: L wrapped to zero |
| 8 | `000D` | `28` | INH | `000E` | H = `C1`, HL = `C100` |
| 9 | `000E` | `07` | RET | `0203` | Select slot 7; slot 0 retains `000F` |
| 10 | `0203` | `11` | DCC | `0204` | C = `01` |
| 11 | `0204` | `48 02 02` | JFZ 0202H | `0202` | Taken: one byte remains |
| 12 | `0202` | `0D` | RST 0008H | `0008` | Select slot 0; slot 7 = `0203` |
| 13 | `0008` | `C7` | LAM | `0009` | A = `40` from `[0100]` |
| 14 | `0009` | `12` | RAL | `000A` | A = `81`, carry = 0 |
| 15 | `000A` | `F8` | LMA | `000B` | `[0100] = 81` |
| 16 | `000B` | `30` | INL | `000C` | L = `01`, HL = `C101` |
| 17 | `000C` | `0B` | RFZ | `0203` | Taken; slot 0 retains `000D` |
| 18 | `0203` | `11` | DCC | `0204` | C = `00` |
| 19 | `0204` | `48 02 02` | JFZ 0202H | `0207` | Not taken |
| 20 | `0207` | `FF` | HLT | `0208` | `halted = true` |

Only the following steps write flags. Other instructions preserve all four.
Rotations preserve S/Z/P even when those flags differ from the accumulator's
new value; adjustments preserve carry even when the byte wraps.

| Step | S | Z | P | C |
| --- | --- | --- | --- | --- |
| 4 | 1 | 0 | 1 | 1 |
| 6 | 0 | 1 | 1 | 1 |
| 8 | 1 | 0 | 0 | 1 |
| 10 | 0 | 0 | 0 | 1 |
| 14 | 0 | 0 | 0 | 0 |
| 16 | 0 | 0 | 0 | 0 |
| 18 | 0 | 1 | 1 | 0 |

There are **25 instruction-byte reads, two data reads, and two writes**.
RST, RET, and RFZ make no RAM stack accesses or destination prefetches.
Loads read their data after the opcode; stores never read their destination.
The result follows `4081H × 2 + 1 = 8103H`, with no outgoing word carry.

## Final state and acceptance checks

After 20 steps, A/B/C/D/E/H/L are `81/22/00/44/55/C1/01`, HL is `C101`,
S/Z/P/C are `0/1/1/0`, and `halted = true`. Slot 7 contains PC `0208`; slot 0
retains `000D`. Slots 1–6 are unchanged. Only RAM at `00FF` and `0100` changes,
to `03 81`; the guards and program remain intact.

- A 20-step budget halts with the complete expected records and actual RAM calls.
- A ten-step budget pauses between bytes with carry still set. A CPU restored
  from that snapshot continues correctly even after the caller edits its copy.
- Caller completion at `0207` stops before HLT; one more step halts.
- Reset clears registers and address slots and leaves the CPU stopped, preserving
  flags and RAM under the model's policy. Earlier records remain detached.
- A fresh factory call restores the original state and whole memory image.
