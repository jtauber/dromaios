# 6502 example: comparisons, bit tests, and flag controls

**Status: implemented and tested.**
Select a stack slot, verify its position after a push, count to a memory limit,
and branch on a masked status byte. Clear overflow explicitly, restore A,
and supply carry to binary ADC before storing the result with D set.

[Model contract](../model.md#flag-controls-and-nop) ·
[Example definition](../../../../src/machines/6502/flags-example.machine) ·
[Example tests](../../../../tests/machines/6502/flags-example.test.ts) ·
[CPU coverage](../../coverage.md#6502)

## Definition and initial state

Addresses and byte values are hexadecimal; step counts are decimal.
The definition initializes zero-filled 64 KiB RAM with the following data
and program. The status byte is ordinary RAM, with no device behavior.

| Address | Bytes | Instruction or data |
| --- | --- | --- |
| `007F` | `AA C0 02 55` | Sentinels around status byte `C0` and loop limit `02` |
| `008F` | `AA CC 55` | Sentinels around result at `0090` |
| `017F` | `AA CC 55` | Sentinels around stack slot at `0180` |
| `0200` | `D8` | `CLD` |
| `0201` | `A2 80` | `LDX #$80` |
| `0203` | `9A` | `TXS` |
| `0204` | `A9 01` | `LDA #$01` |
| `0206` | `48` | `PHA` |
| `0207` | `BA` | `TSX` |
| `0208` | `E0 7F` | `CPX #$7F` |
| `020A` | `D0 24` | `BNE $0230` (failure) |
| `020C` | `A0 00` | `LDY #$00` |
| `020E` | `C8` | Loop: `INY` |
| `020F` | `C4 81` | `CPY $81` |
| `0211` | `90 FB` | `BCC $020E` |
| `0213` | `24 80` | `BIT $80` |
| `0215` | `F0 03` | `BEQ $021A` |
| `0217` | `4C 30 02` | `JMP $0230` (failure) |
| `021A` | `B8` | `CLV` |
| `021B` | `50 03` | `BVC $0220` |
| `021D` | `4C 30 02` | `JMP $0230` (failure) |
| `0220` | `68` | `PLA` |
| `0221` | `38` | `SEC` |
| `0222` | `69 01` | `ADC #$01` |
| `0224` | `F8` | `SED` |
| `0225` | `EA` | `NOP` |
| `0226` | `8D 90 00` | `STA $0090` |
| `0229` | `4C 40 02` | `JMP $0240` (completion) |
| `FFFC` | `00 02` | Reset vector: `0200` |

Initial A/X/Y = `11/22/33`, PC/SP = `0200/AB`, and all six flags are set.
These are explicit example choices. `create6502FlagsExample()` supplies fresh
`{ cpu, ram, endAddress }` with `endAddress = 0240`;
`create6502FlagsExampleMemory()` supplies the same image without a CPU.
Neither factory resets or steps the CPU.

## Expected execution

The normal path executes 26 instructions. Each before-state is the preceding
after-state or the initial state. Registers and flags not mentioned below
retain their values; I remains set throughout.

| Step | PC before → after | Changes |
| --- | --- | --- |
| 1 | `0200 → 0201` | D = 0 |
| 2 | `0201 → 0203` | X = `80`; N/Z = 1/0 |
| 3 | `0203 → 0204` | SP = `80`; flags preserved |
| 4 | `0204 → 0206` | A = `01`; N/Z = 0/0 |
| 5 | `0206 → 0207` | Write `01` at `0180`; SP = `7F` |
| 6 | `0207 → 0208` | X = `7F`; N/Z = 0/0 |
| 7 | `0208 → 020A` | N/Z/C = 0/1/1 |
| 8 | `020A → 020C` | BNE untaken |
| 9 | `020C → 020E` | Y = `00`; N/Z = 0/1 |
| 10 | `020E → 020F` | Y = `01`; N/Z = 0/0 |
| 11 | `020F → 0211` | `01 < 02`: N/Z/C = 1/0/0 |
| 12 | `0211 → 020E` | BCC taken |
| 13 | `020E → 020F` | Y = `02`; N/Z = 0/0 |
| 14 | `020F → 0211` | Equal: N/Z/C = 0/1/1 |
| 15 | `0211 → 0213` | BCC untaken |
| 16 | `0213 → 0215` | N/V/Z = 1/1/1: memory is `C0`, A AND memory is zero |
| 17 | `0215 → 021A` | BEQ taken |
| 18 | `021A → 021B` | V = 0 |
| 19 | `021B → 0220` | BVC taken |
| 20 | `0220 → 0221` | SP = `80`; read A = `01` at `0180`; N/Z = 0/0 |
| 21 | `0221 → 0222` | C = 1 |
| 22 | `0222 → 0224` | A = `03`; N/V/Z/C = 0/0/0/0 |
| 23 | `0224 → 0225` | D = 1 |
| 24 | `0225 → 0226` | NOP preserves registers and flags |
| 25 | `0226 → 0229` | Write `03` at `0090` |
| 26 | `0229 → 0240` | Jump to caller's completion address |

Final A/X/Y = `03/7F/02`, SP/PC = `80/0240`, and N/V/D/I/Z/C = 0/0/1/1/0/0.
Only RAM `0180` and `0090` differ from their initial values. The pull retains
the saved byte. Completion stops before fetching `0240`. Failure paths target
`0230`, where BRK follows the unused IRQ/BRK vector to `0000`. The failure
path test stops after that entry using its instruction budget and reports
`step-limit`; the success endpoint remains `0240`.

## Records and acceptance checks

Each step records opcode/operand reads in order at PC. CPY additionally reads
`0081:02` on both iterations; BIT reads `0080:C0`; PHA writes `0180:01`;
PLA reads that byte; STA writes `0090:03`. No other data accesses occur.
TXS and TSX access only their opcodes. No dummy reads or cycle counts are modeled.

The tests specify every state, byte, and access independently and compare
actual RAM calls, complete memory images, and fresh factory instances.
They pause and resume from snapshots at nine boundaries, including after TXS,
PHA, BIT, SEC, and SED, and require the same remaining trace. Reset after
completion reads the vector, sets PC/SP to `0200/7D`, and preserves other
state and all RAM. Captured records survive reset and subsequent host writes.

Changing the status byte to `C1` just before BIT leaves N/V set but clears Z,
so BEQ falls through to the failure jump. The result slot remains `CC` and
the stack byte remains saved. CPU tests separately check that SED selects decimal
ADC/SBC, reset preserves D, and CLD restores binary arithmetic.

Instruction rules follow the [manufacturer manual](https://syncopate.us/books/Synertek6502ProgrammingManual.html),
chapters 3–4 and sections 7.8–7.9, 8.8–8.9. The
[model contract](../model.md) defines arithmetic modes and the recorded access boundary.
