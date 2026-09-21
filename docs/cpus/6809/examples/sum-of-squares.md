# 6809 sum of squares with stack locals

This program computes decimal **3² + 4² + 5² = 50**, using indexed input,
unsigned multiplication, word accumulation, and a subroutine with a word
local on the stack. It finishes with D and U equal to `0032`.

[Model contract](../../../../src/components/cpus/specifications/6809.md) ·
[Coverage](../../coverage.md#6809) ·
[Machine definition](../../../../src/machines/6809/sum-of-squares-example.machine) ·
[Example tests](../../../../tests/machines/6809/sum-of-squares-example.test.ts)

## Initial state and memory

Initial control state is `waitMode = none` and `nmiArmed = false`. The opening
LDS arms NMI; reset disarms it.

Numbers below are hexadecimal except step/access counts and explicitly decimal
quantities. A/B/D/DP start at `11/34/1134/20`, X/Y/S/U at
`2345/4567/8888/5555`, PC at `0200`, and CC at `AB`
(E/F/H/I/N/Z/V/C = 1/0/1/0/1/0/1/1). D is derived from A:B.

The machine has 64 KiB RAM. Main code occupies `0200`–`0221`; the subroutine
occupies `0300`–`030F`. Input bytes `03 04 05` are at `30FF`–`3101`, with
`CC` guards at `30FE` and `3102`. The six result bytes at `2022`–`2027`
and four stack bytes at `07FC`–`07FF` start at zero, each block surrounded by
`CC` guards. The reset vector is `02 00` at `FFFE`–`FFFF`; other RAM is zero.

`create6809SumOfSquaresExample()` returns fresh CPU/RAM components and caller
completion address `0222`. `create6809SumOfSquaresExampleMemory()` returns the
same initial memory independently. Neither factory runs or resets the CPU.

## Program

| Address | Bytes | Instruction | Purpose |
| --- | --- | --- | --- |
| `0200` | `10 CE 08 00` | LDS #$0800 | Select hardware stack |
| `0204` | `10 8E 30 FF` | LDY #$30FF | Select input |
| `0208` | `CE 00 00` | LDU #$0000 | Clear running total |
| `020B` | `A6 A0` | LDA ,Y+ | Read input, advance Y |
| `020D` | `1F 89` | TFR A,B | Supply equal multiply operands |
| `020F` | `BD 03 00` | JSR $0300 | Accumulate the square |
| `0212` | `10 8C 31 02` | CMPY #$3102 | Check end of input |
| `0216` | `10 26 FF F1` | LBNE $020B | Loop unless Y equals the end pointer |
| `021A` | `DD 22` | STD <$22 | Save sum at `2022` |
| `021C` | `10 9F 24` | STY <$24 | Save final input pointer |
| `021F` | `10 DF 26` | STS <$26 | Save restored stack pointer |

The four-byte LBNE takes its displacement relative to `021A`: `FFF1` is
−15, giving target `020B`. It fetches both displacement bytes on the final,
untaken iteration too. The caller stops before fetching at `0222`.

| Address | Bytes | Instruction | Purpose |
| --- | --- | --- | --- |
| `0300` | `32 7E` | LEAS -2,S | Allocate a word below the return address |
| `0302` | `3D` | MUL | Compute A × B into D |
| `0303` | `1E 03` | EXG D,U | Put previous total in D, product in U |
| `0305` | `ED E4` | STD ,S | Save previous total in the local |
| `0307` | `1F 30` | TFR U,D | Retrieve product |
| `0309` | `E3 E4` | ADDD ,S | Add previous total |
| `030B` | `1F 03` | TFR D,U | Retain new total |
| `030D` | `32 62` | LEAS 2,S | Discard local |
| `030F` | `39` | RTS | Restore return PC and S |

JSR decrements S before each write, saving low `12` at `07FF` and high `02`
at `07FE`. LEAS then selects `07FC` for the local. STD and ADDD access its
high byte at `07FC`, then low byte at `07FD`. LEAS restores S to `07FE`;
RTS reads the return word and restores S to `0800`. Popped bytes remain in RAM.

## Expected execution

There are three setup steps, three iterations of fourteen steps each, and
three final stores: **48 steps**. Each iteration has five caller instructions
and nine subroutine instructions.

| Input (decimal) | Square | Previous total | New total | Y after read | CMPY CC | Long branch |
| --- | --- | --- | --- | --- | --- | --- |
| 3 | `0009` | `0000` | `0009` | `3100` | `A9` | Taken |
| 4 | `0010` | `0009` | `0019` | `3101` | `A9` | Taken |
| 5 | `0019` | `0019` | `0032` | `3102` | `A4` | Untaken |

LEAS and register transfers preserve flags. MUL replaces only Z/C; these
products are nonzero and have bit 7 clear, leaving CC=`A0`. The first STD of
a zero previous total sets Z (CC=`A4`); TFR retains that flag until ADDD
replaces N/Z/V/C. ADDD leaves CC=`A0` in each iteration. CMPY compares full
words, setting N/C for the first two differences and Z for final equality.
The result stores set N/Z from their words and clear V, ending at CC=`A0`.
E and H stay set throughout; F and I stay clear.

There are **112 instruction-byte reads, 15 data reads, and 18 writes**.
Data reads comprise three input bytes, six local bytes, and six return bytes.
Writes comprise six return bytes, six local bytes, and six final result bytes.
No branch or call prefetches its target; word stores do not read destinations.

## Final state and acceptance checks

Final A/B/D/DP = `00/32/0032/20`, X/Y/S/U = `2345/3102/0800/0032`,
PC = `0222`, and CC = `A0`. Results at `2022`–`2027` are
`00 32 31 02 08 00`. Stack bytes at `07FC`–`07FF` retain `00 19 02 12`.
Code, input, guards, vectors, and all other RAM remain unchanged.

- The tests compare every complete record, actual RAM call, and final RAM byte.
- An eight-step budget pauses after the first MUL inside the allocated frame.
  A fresh CPU resumes from that snapshot and completes the remaining 40 steps;
  editing the caller's snapshot cannot change the restored CPU or old records.
- Reset preserves RAM and other registers while loading PC=`0200`, clearing
  DP, and setting F/I. A fresh factory restores the complete initial lesson.
- Changing LBNE's offset to `FFFC` produces a bounded loop at `0216` after
  the first square. Changing LDY to a prefixed indexed form with reserved
  postbyte `90` rejects the instruction after its three encoding bytes,
  leaving state and RAM unchanged for that attempt.
