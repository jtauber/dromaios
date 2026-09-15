# 6800 example: addressing, carry, and borrow

This program adds one to `12FF` using A as the low byte and B as the high byte,
then subtracts one again. Loads preserve the carry between arithmetic steps.
It combines immediate, direct, indexed, and extended operands, then tests and
masks the results. X remains `FF80`, so unsigned indexed offsets `FF` and `FE`
wrap to `007F` and `007E`.

[Model contract](../model.md#addressing) ·
[Example definition](../../../../src/machines/6800/addressing-example.machine) ·
[Example tests](../../../../tests/machines/6800/addressing-example.test.ts) ·
[CPU coverage](../../coverage.md#6800)

## Definition and initial state

`waiting` starts false and remains false throughout this example.

Addresses, bytes, and register values are hexadecimal. Step counts are decimal.
RAM starts as 64 KiB of zeros with these bytes loaded:

| Address | Bytes | Instruction or data |
| --- | --- | --- |
| `0200` | `96 80` | `LDAA $80`: low input `FF` |
| `0202` | `8B 01` | `ADDA #$01`: low sum `00`, carry set |
| `0204` | `F6 03 00` | `LDAB $0300`: high input `12`, preserving carry |
| `0207` | `C9 00` | `ADCB #$00`: high sum `13` |
| `0209` | `97 82` | `STAA $82`: low sum |
| `020B` | `D7 83` | `STAB $83`: high sum |
| `020D` | `C1 13` | `CMPB #$13`: equality, preserving B |
| `020F` | `80 01` | `SUBA #$01`: low difference `FF`, borrow set |
| `0211` | `C2 00` | `SBCB #$00`: high difference `12` |
| `0213` | `A7 FF` | `STAA $FF,X`: write low difference to `007F` |
| `0215` | `F7 03 01` | `STAB $0301`: high difference |
| `0218` | `84 0F` | `ANDA #$0F`: `FF → 0F` |
| `021A` | `DA 80` | `ORAB $80`: `12 → FF` |
| `021C` | `A8 FF` | `EORA $FF,X`: `0F XOR FF = F0` |
| `021E` | `E5 FF` | `BITB $FF,X`: test `FF`, preserving B |
| `0220` | `B1 03 02` | `CMPA $0302`: equality, preserving A |
| `0223` | `27 02` | `BEQ $0227`: skip the fallback |
| `0225` | `86 00` | `LDAA #$00`: fallback, normally skipped |
| `0227` | `B7 03 03` | `STAA $0303`: masked result `F0` |
| `022A` | `E7 FE` | `STAB $FE,X`: write `FF` to `007E` |
| `007D` | `AA CC 00 FF 55 CC CC AA` | Guards, low input, and direct/indexed outputs |
| `0300` | `12 CC F0 CC 55` | High input, output, comparison value, output, guard |
| `FFFE` | `02 00` | Reset vector |

Initial state is A=`81`, B=`22`, X=`FF80`, SP=`0101`, PC=`0200`, with
H/I/N/Z/V/C=`1/0/1/1/1/0`. These are explicit example choices.

`create6800AddressingExample()` returns fresh `{ cpu, ram, endAddress }`, with
`endAddress = 022C`. `create6800AddressingExampleMemory()` creates the same RAM
image without a CPU. The factories perform neither reset nor execution.

## Expected execution

The normal path executes 19 instructions. X and SP are preserved; I remains
zero, and V clears on the first load and stays clear. Each row gives after-state
values. `HINZVC` lists the six flags in that order. The next row's PC is the
current row's PC after execution; the last step ends at `022C`.

| Step | PC | A | B | HINZVC | Data access after instruction fetches |
| --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `FF` | `22` | `101000` | Read `0080=FF` |
| 2 | `0202` | `00` | `22` | `100101` | — |
| 3 | `0204` | `00` | `12` | `100001` | Read `0300=12` |
| 4 | `0207` | `00` | `13` | `000000` | — |
| 5 | `0209` | `00` | `13` | `000100` | Write `0082=00` |
| 6 | `020B` | `00` | `13` | `000000` | Write `0083=13` |
| 7 | `020D` | `00` | `13` | `000100` | — |
| 8 | `020F` | `FF` | `13` | `001001` | — |
| 9 | `0211` | `FF` | `12` | `000000` | — |
| 10 | `0213` | `FF` | `12` | `001000` | Write `007F=FF` |
| 11 | `0215` | `FF` | `12` | `000000` | Write `0301=12` |
| 12 | `0218` | `0F` | `12` | `000000` | — |
| 13 | `021A` | `0F` | `FF` | `001000` | Read `0080=FF` |
| 14 | `021C` | `F0` | `FF` | `001000` | Read `007F=FF` |
| 15 | `021E` | `F0` | `FF` | `001000` | Read `007F=FF` |
| 16 | `0220` | `F0` | `FF` | `000100` | Read `0302=F0` |
| 17 | `0223` | `F0` | `FF` | `000100` | — |
| 18 | `0227` | `F0` | `FF` | `001000` | Write `0303=F0` |
| 19 | `022A` | `F0` | `FF` | `001000` | Write `007E=FF` |

Every step reports `executed`. Instruction bytes are those in the definition
table; data accesses do not enter the instruction-byte list. The final RAM
contains `1300` as high/low bytes at `0083`/`0082` and `12FF` at `0301`/`007F`.
The other two outputs are `0303=F0` and `007E=FF`. All other memory, including
guards, code, stack, and vectors, is unchanged.

The runner completes at `022C` without fetching that byte. A direct CPU step
there rejects the zero opcode without changing state.

## Resumption, reset, and edited operands

The run can pause after the carry addition, borrow subtraction, or memory
comparison (steps 4, 9, or 16). Constructing a CPU from that snapshot and the
same RAM reproduces the remaining records and final memory. Later RAM edits
and resets cannot alter the already returned records.

Reset rereads `FFFE`/`FFFF`, restores PC to `0200`, and sets I. It preserves the
computed RAM results and other registers and flags. A fresh factory restores
the original program and input state.

Changing the addition operand at `0203` from `01` to `02` produces `1301` and
then `1300`; the low subtraction no longer borrows. The final comparison fails,
so the fallback at `0225` executes and the run takes 20 steps. Final A/B are
`00`/`FF`, HINZVC is `001001`, and the output writes are `0082=01`, `0083=13`,
`007F=00`, `0301=13`, `0303=00`, and `007E=FF`.

Instruction semantics follow the Motorola references in the
[model contract](../model.md); the values and complete trace above are
independent acceptance expectations for this example.
