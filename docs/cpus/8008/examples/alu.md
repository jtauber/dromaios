# 8008 accumulator arithmetic and logic example

This program adds `0020` to `01F0` to produce `0210`, then subtracts `0020`
to recover `01F0`. It propagates carry and borrow between byte operations,
then masks and combines bits and compares the result without replacing A.
It stores five output bytes and halts with the comparison flags intact.

[Model contract](../../../../src/components/cpus/specifications/8008.md#eight-accumulator-operations) ·
[Coverage](../../coverage.md#8008) ·
[Machine definition](../../../../src/machines/8008/alu-example.machine) ·
[Example tests](../../../../tests/machines/8008/alu-example.test.ts) ·
[CPU tests](../../../../tests/components/cpus/8008.test.ts)

## Initial state and memory

All numbers are hexadecimal except step counts and flag values. The machine
has flat 16 KiB RAM. A/B/C/D/E/H/L start at `11/22/33/44/55/C0/80` and S/Z/P/C
at `1/0/1/1`. The address registers are
`[1111 1222 1333 1444 1555 1666 1777 0200]`, with slot 7 selected and
`halted = false`. PC starts at `0200`. Raw HL is `C080`, addressing RAM at
`0080` because H's top two bits do not participate in addressing.

RAM at `0080` contains input byte `20`. Output bytes `0081`–`0085` start at
zero, with `CC` guards at `007F` and `0086`. Apart from this region and the
program below, RAM starts at zero.

The generated module exports `create8008AluExampleMemory(): Ram` and
`create8008AluExample(): { cpu: Cpu8008; ram: Ram }`. Each call constructs
fresh components without executing. The factory has no completion address;
the program stops with HLT.

## Program and expected execution

Each row is one instruction. The selected address slot advances to the listed
PC. The other seven slots and `stackIndex = 7` remain unchanged. H remains
`C0`; after each LLI, raw HL becomes `C000 + L`. Apart from the listed changes,
state remains unchanged. The eight ALU steps replace flags as shown below;
every other step preserves them.

| Step | Address | Bytes | Instruction | PC after | Register or RAM change |
| --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `06 F0` | LAI F0H | `0202` | A = `F0` |
| 2 | `0202` | `87` | ADM | `0203` | A = `10` |
| 3 | `0203` | `C8` | LBA | `0204` | B = `10` |
| 4 | `0204` | `06 01` | LAI 01H | `0206` | A = `01` |
| 5 | `0206` | `0C 00` | ACI 00H | `0208` | A = `02` |
| 6 | `0208` | `D0` | LCA | `0209` | C = `02` |
| 7 | `0209` | `C1` | LAB | `020A` | A = `10` |
| 8 | `020A` | `97` | SUM | `020B` | A = `F0` |
| 9 | `020B` | `D8` | LDA | `020C` | D = `F0` |
| 10 | `020C` | `C2` | LAC | `020D` | A = `02` |
| 11 | `020D` | `1C 00` | SBI 00H | `020F` | A = `01` |
| 12 | `020F` | `E0` | LEA | `0210` | E = `01` |
| 13 | `0210` | `C3` | LAD | `0211` | A = `F0` |
| 14 | `0211` | `24 3F` | NDI 3FH | `0213` | A = `30` |
| 15 | `0213` | `2C 55` | XRI 55H | `0215` | A = `65` |
| 16 | `0215` | `B1` | ORB | `0216` | A = `75` |
| 17 | `0216` | `3C 75` | CPI 75H | `0218` | A stays `75` |
| 18 | `0218` | `36 81` | LLI 81H | `021A` | L = `81` |
| 19 | `021A` | `F9` | LMB | `021B` | `[0081] = 10` |
| 20 | `021B` | `36 82` | LLI 82H | `021D` | L = `82` |
| 21 | `021D` | `FA` | LMC | `021E` | `[0082] = 02` |
| 22 | `021E` | `36 83` | LLI 83H | `0220` | L = `83` |
| 23 | `0220` | `FB` | LMD | `0221` | `[0083] = F0` |
| 24 | `0221` | `36 84` | LLI 84H | `0223` | L = `84` |
| 25 | `0223` | `FC` | LME | `0224` | `[0084] = 01` |
| 26 | `0224` | `36 85` | LLI 85H | `0226` | L = `85` |
| 27 | `0226` | `F8` | LMA | `0227` | `[0085] = 75` |
| 28 | `0227` | `FF` | HLT | `0228` | `halted = true` |

| Step | Calculation | S | Z | P | C |
| --- | --- | --- | --- | --- | --- |
| 2 | `F0 + 20 = 110`; incoming C ignored | 0 | 0 | 0 | 1 |
| 5 | `01 + 00 + carry = 02` | 0 | 0 | 0 | 0 |
| 8 | `10 − 20 = F0`, with borrow | 1 | 0 | 1 | 1 |
| 11 | `02 − 00 − borrow = 01` | 0 | 0 | 0 | 0 |
| 14 | `F0 AND 3F = 30` | 0 | 0 | 1 | 0 |
| 15 | `30 XOR 55 = 65` | 0 | 0 | 1 | 0 |
| 16 | `65 OR 10 = 75` | 0 | 0 | 0 | 0 |
| 17 | `75 − 75 = 00`; retain A | 0 | 1 | 1 | 0 |

Steps 2 and 8 each read `20` at `0080`, after fetching the opcode. Steps
19, 21, 23, 25, and 27 make the five listed writes, without destination reads.
All other accesses fetch instruction bytes. There are **40 instruction-byte
reads, two data reads, and five writes**. Data accesses do not enter
`instruction.bytes`. No instruction writes to its arithmetic operand.

## Final state and acceptance checks

After 28 steps, A/B/C/D/E/H/L are `75/10/02/F0/01/C0/85`, raw HL is `C085`,
PC and address slot 7 are `0228`, and `halted = true`. S/Z/P/C remain `0/1/1/0`
from CPI. The other address slots and the selector retain their initial values.

RAM at `0081`–`0085` contains `10 02 F0 01 75`: the sum and difference in
low-byte-first order, followed by the logical result. Input, guards, program,
and all other RAM remain unchanged.

- A 28-step budget halts exactly. Each complete record and actual RAM call
  matches the independent trace, including the preserved accumulator after CPI.
- A nine-step budget pauses with borrow set after LDA and no RAM writes.
  Reconstructing the CPU from its snapshot and RAM finishes in 19 steps with
  the same records, despite later caller edits to that snapshot.
- Already halted steps make no accesses. Reset clears registers and address
  slots, preserves the comparison flags and RAM, and leaves execution stopped.
- Records survive later execution, reset, memory edits, and caller edits.
  Fresh factories restore the complete initial state and memory image.

Intel's [8008 User's Manual, November 1973](https://deramp.com/downloads/mfe_archive/050-Component%20Specifications/Intel/Microprocessors%20and%20Support/8008%20Family/i8008UM%20Nov%2073.pdf),
printed pages 11–12, defines the ALU encodings and flag effects. The
[introductory arithmetic example](arithmetic.md) remains the smaller starting
program. The [8080 ALU example](../../8080/examples/alu.md) performs the same
calculations with that processor's encodings and additional auxiliary carry flag.
