# 8008 conditional control-flow example

This program sums `3 + 2 + 1` in a subroutine, counts down to zero, masks and
checks the result, and stores `06` in RAM. It exercises taken and untaken
conditional jumps, calls, and returns while using the 8008's circular address
registers. A comparison selects the success path and preserves the result.

[Model contract](../../../../src/components/cpus/specifications/8008.md#eight-address-registers) ·
[Coverage](../../coverage.md#8008) ·
[Machine definition](../../../../src/machines/8008/control-flow-example.machine) ·
[Example tests](../../../../tests/machines/8008/control-flow-example.test.ts) ·
[CPU tests](../../../../tests/components/cpus/8008.test.ts)

## Initial state and memory

Numbers are hexadecimal except step counts and flag values. The machine has
flat 16 KiB RAM. Initial A/B/C/D/E/H/L are `11/22/33/44/55/C0/80` and S/Z/P/C
are `1/0/1/1`. Its address registers are
`[1111 1222 1333 1444 1555 1666 1777 0200]`, with slot 7 selected and
`halted = false`. PC starts at `0200`, and raw HL = `C080` addresses `0080`.

RAM at `0080` starts at zero, with `CC` guards at `007F` and `0081`. The main
program occupies `0200`–`021C`; the subroutine and its guard occupy
`0300`–`030A`. All other RAM starts at zero.

The generated module exports `create8008ControlFlowExampleMemory(): Ram` and
`create8008ControlFlowExample(): { cpu: Cpu8008; ram: Ram }`. Each call creates
fresh components without executing. There is no factory completion address;
HLT stops the program.

## Main program

Repeated step numbers and values correspond to the three iterations in order.
Every record's `before` is the preceding step's resulting state. Only the
listed registers, selected PC, and flags described below change.

| Steps | Address | Bytes | Instruction | PC after | Other effect |
| --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `16 03` | LCI 03H | `0202` | C = `03` |
| 2 | `0202` | `0E 00` | LBI 00H | `0204` | B = `00` |
| 3, 15, 27 | `0204` | `C2` | LAC | `0205` | A = `03`, `02`, `01` |
| 4, 16, 28 | `0205` | `3C 00` | CPI 00H | `0207` | Test the count without changing A |
| 5, 17, 29 | `0207` | `4A 00 83` | CFZ 0300H | `0300` | Taken; save `020A` in slot 7, select slot 0 |
| 14, 26, 39 | `020A` | `48 04 C2` | JFZ 0204H | `0204`, `0204`, `020D` | Repeat twice, then fall through |
| 40 | `020D` | `4A 00 83` | CFZ 0300H | `0210` | Untaken; retain selector 7 and slot 0 |
| 41 | `0210` | `C1` | LAB | `0211` | A = `06` |
| 42 | `0211` | `24 0F` | NDI 0FH | `0213` | A remains `06`; update flags |
| 43 | `0213` | `3C 06` | CPI 06H | `0215` | Equality sets Z; retain A |
| 44 | `0215` | `68 1B C2` | JTZ 021BH | `021B` | Taken; skip the failure path |
| — | `0218` | `06 FF` | LAI FFH | — | Failure path, never fetched |
| — | `021A` | `00` | HLT | — | Failure stop, never fetched |
| 45 | `021B` | `F8` | LMA | `021C` | Write `06` at `0080` |
| 46 | `021C` | `FF` | HLT | `021D` | `halted = true` |

Each jump or call fetches both address bytes, including the untaken final CFZ
and JFZ. The encoded high bytes `83` and `C2` retain their top bits in the
instruction records but address `0300` and `02xx` respectively. No target
instruction is prefetched by a jump or call.

## Subroutine

In the native 8008 mnemonics, `ADC` here means **add register C to A**, opcode
`82`. Addition with carry belongs to the separate ACr/ACI family.

| Steps | Address | Bytes | Instruction | PC after | Other effect |
| --- | --- | --- | --- | --- | --- |
| 6, 18, 30 | `0300` | `2B` | RTZ | `0301` | Untaken; Z was false for the call |
| 7, 19, 31 | `0301` | `C1` | LAB | `0302` | A = previous sum: `00`, `03`, `05` |
| 8, 20, 32 | `0302` | `82` | ADC | `0303` | A = new sum: `03`, `05`, `06` |
| 9, 21, 33 | `0303` | `C8` | LBA | `0304` | B = `03`, `05`, `06` |
| 10, 22, 34 | `0304` | `C2` | LAC | `0305` | A = count: `03`, `02`, `01` |
| 11, 23, 35 | `0305` | `14 01` | SUI 01H | `0307` | A = decremented count: `02`, `01`, `00` |
| 12, 24, 36 | `0307` | `D0` | LCA | `0308` | C = `02`, `01`, `00`; preserve flags |
| 13, 25 | `0308` | `0B` | RFZ | `020A` | Taken; select slot 7, retain `0309` in slot 0 |
| 37 | `0308` | `0B` | RFZ | `0309` | Untaken; stay in slot 0 |
| 38 | `0309` | `2B` | RTZ | `020A` | Taken; select slot 7, retain `030A` in slot 0 |
| — | `030A` | `22` | Unsupported guard | — | Never fetched |

Every call wraps the selector from slot 7 to slot 0. Slot 7 retains `020A`
throughout the subroutine, while slot 0 follows its instruction addresses.
Each taken return advances slot 0 before selecting slot 7. Slots 1–6 retain
`1222/1333/1444/1555/1666/1777` throughout. No call or return accesses a RAM
stack, and the untaken call at step 40 preserves the completed slot 0 value.

## Flags, accesses, and final state

The initial flags persist through step 3. Only the following steps replace
flags; all loads, transfers, control flow, the store, and HLT preserve them.

| Steps | Operation/result | S | Z | P | C |
| --- | --- | --- | --- | --- | --- |
| 4 | Compare `03` with zero | 0 | 0 | 1 | 0 |
| 16, 28 | Compare `02`, `01` with zero | 0 | 0 | 0 | 0 |
| 8, 20, 32 | Add to produce `03`, `05`, `06` | 0 | 0 | 1 | 0 |
| 11, 23 | Subtract one to produce `02`, `01` | 0 | 0 | 0 | 0 |
| 35 | Subtract one to produce `00` | 0 | 1 | 1 | 0 |
| 42 | `06 AND 0F = 06` | 0 | 0 | 1 | 0 |
| 43 | Compare `06` with `06` | 0 | 1 | 1 | 0 |

The complete run makes **72 instruction-byte reads and one write**. The write
is `[0080] = 06` at step 45. There are no data reads; stores do not read their
destination. The failure path and unsupported guard are never fetched.
Steps 1–45 report `executed`; step 46 reports `halted`.

Final A/B/C/D/E/H/L are `06/06/00/44/55/C0/80`, raw HL = `C080`, and
S/Z/P/C = `0/1/1/0`. PC = `021D`, selector = 7, and `halted = true`.
The address registers are `[030A 1222 1333 1444 1555 1666 1777 021D]`.
Only RAM byte `0080` changes; guards, program, and all other RAM are preserved.

## Acceptance checks

- A 46-step budget halts exactly with the complete literal trace: every PC,
  physical address slot, register, flag, instruction byte, and actual RAM call.
- A 37-step budget pauses after the untaken RFZ at `0308`, with PC = `0309`,
  selector = 0, Z = 1, and no RAM writes. A CPU reconstructed from the snapshot
  and RAM finishes in nine more steps, despite later caller edits to that snapshot.
- Already halted steps make no accesses. Reset clears registers and address
  slots, preserves the final flags and RAM, and leaves execution stopped.
- Earlier records survive later execution, reset, memory edits, and caller
  edits. Fresh factories restore the complete initial state and RAM.

Intel's [8008 User's Manual, November 1973](https://deramp.com/downloads/mfe_archive/050-Component%20Specifications/Intel/Microprocessors%20and%20Support/8008%20Family/i8008UM%20Nov%2073.pdf),
printed pages 13–14, defines conditional control flow. The
[stack example](stack.md) separately explores nested calls and retained
address slots; the [ALU example](alu.md) explores carry, borrow, and logic.
