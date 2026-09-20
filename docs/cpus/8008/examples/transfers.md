# 8008 transfer example

This program follows a byte from E into RAM, reads it into A, and copies it
to a second address. It then replaces that byte with an immediate and loads
it into H, changing the address used by the next memory read. Every instruction
preserves the four flags.

[Machine definition](../../../../src/machines/8008/transfers-example.machine) ·
[Tests](../../../../tests/machines/8008/transfers-example.test.ts) ·
[Model contract](../../../../src/components/cpus/specifications/8008.md#register-and-memory-transfers) ·
[Coverage](../../coverage.md#8008) ·
[Nested-call example](stack.md)

## Setup

The machine has flat 16 KiB RAM. Initial A/B/C/D/E/H/L are
`11/22/33/44/55/66/77`, and S/Z/P/C are `1/0/1/1`. The address registers are
`[1111 1222 1333 1444 1555 1666 1777 0200]`, with slot 7 selected and
`halted = false`. PC therefore starts at `0200`; raw HL starts at `6677`.

RAM at `0080` and `0081` starts at zero, with `CC` guards at `007F` and `0082`.
RAM at `2581` contains `3C`, with `CC` guards at `2580` and `2582`.
All memory outside these bytes and the program starts at zero.

The generated module exports `create8008TransfersExampleMemory(): Ram` and
`create8008TransfersExample(): { cpu: Cpu8008; ram: Ram }`. Each call creates
fresh components without executing. HLT stops the program; the factory has
no caller completion address.

## Program and trace

All numeric values below are hexadecimal. The numbered steps are decimal.
Each instruction advances address slot 7 to the listed next PC. The other
seven slots, the selector, and S/Z/P/C retain their initial values throughout.

| Step | Address | Bytes | Instruction | Register or RAM change | Next PC |
| --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `0E C0` | `LBI C0H` | B = `C0` | `0202` |
| 2 | `0202` | `16 80` | `LCI 80H` | C = `80` | `0204` |
| 3 | `0204` | `1E 81` | `LDI 81H` | D = `81` | `0206` |
| 4 | `0206` | `26 5A` | `LEI 5AH` | E = `5A` | `0208` |
| 5 | `0208` | `E9` | `LHB` | H = `C0`; raw HL = `C077` | `0209` |
| 6 | `0209` | `F2` | `LLC` | L = `80`; raw HL = `C080` | `020A` |
| 7 | `020A` | `FC` | `LME` | `[0080] = 5A` | `020B` |
| 8 | `020B` | `C7` | `LAM` | A = `[0080]` = `5A` | `020C` |
| 9 | `020C` | `F3` | `LLD` | L = `81`; raw HL = `C081` | `020D` |
| 10 | `020D` | `F8` | `LMA` | `[0081] = 5A` | `020E` |
| 11 | `020E` | `3E A5` | `LMI A5H` | `[0081] = A5` | `0210` |
| 12 | `0210` | `EF` | `LHM` | H = `[0081]` = `A5`; raw HL = `A581` | `0211` |
| 13 | `0211` | `E7` | `LEM` | E = `[2581]` = `3C` | `0212` |
| 14 | `0212` | `FF` | `HLT` | `halted = true`; no data access | `0213` |

H is an eight-bit register even though its top two bits do not participate in
memory addressing. H:L values `C080` and `C081` address `0080` and `0081`.
LHM reads through the original pair before replacing H; the subsequent LEM
uses the new raw pair `A581` and accesses `2581`.

The three writes are `[0080] = 5A`, `[0081] = 5A`, and `[0081] = A5`, in that
order. The three data reads are `[0080] = 5A`, `[0081] = A5`, and `[2581] = 3C`.
They appear in the access records separately from the 19 instruction bytes.
There are no destination reads for stores and no data access for HLT's M,M slot.

## Final state

After fourteen instructions, A/B/C/D/E/H/L are `5A/C0/80/81/3C/A5/81`, raw
HL = `A581`, PC = `0213`, and `halted = true`. Address slot 7 is `0213`;
the other seven slots and `stackIndex = 7` are unchanged. S/Z/P/C remain
`1/0/1/1`, including S staying set after loading positive byte `3C` into E.

RAM at `0080` and `0081` contains `5A A5`. The byte at `2581`, all guards,
the program, and every other memory byte retain their original values.

## Acceptance checks

- A fourteen-step runner budget halts exactly, with complete snapshots,
  instruction bytes, and accesses checked against an independent literal trace.
- Observed RAM calls match the 22 reads and three writes in that trace.
  A full RAM comparison verifies the result, guards, program, and unused memory.
- An eight-step budget pauses after LAM with only `[0080]` changed. A CPU
  reconstructed from the snapshot and the same RAM finishes in six more steps
  with the same records.
- Already halted steps make no accesses. Reset clears data and address
  registers, selects slot zero, preserves flags and RAM, and stays stopped
  according to the model contract.
- Later execution, reset, memory edits, and caller edits leave earlier
  records detached. Fresh factories restore the initial registers and RAM.
