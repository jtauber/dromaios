# Z80 decimal-total example

This program sums four packed-decimal amounts, stores the total, and restores
the caller's main registers and flags. EX AF,AF′ and EXX provide working
registers; DAA corrects each sum, RST calls a small accumulation routine, and
ADD HL advances the input pointer while preserving the loop condition.

[Machine definition](../../../../src/machines/z80/decimal-total-example.machine) ·
[Example tests](../../../../tests/machines/z80/decimal-total-example.test.ts) ·
[Model contract](../model.md) ·
[Coverage inventory](../../coverage.md#z80)

## Initial state and memory

The machine has 64 KiB of RAM. Main A/B/C/D/E/H/L are `11/22/33/44/55/66/77`,
with S/Z/H/PV/N/C = `1/0/1/0/1/0`. Alternate A/B/C/D/E/H/L are
`88/99/AA/BB/CC/DD/EE`, with S/Z/H/PV/N/C = `0/1/0/1/0/1`.
IX/IY/PC/SP are `1234/5678/0200/9000`, I = `42`, R = `FE`, IM = 2,
IFF1 is true, IFF2 is false, and the CPU is running. These are explicit
example choices.

| Addresses | Initial bytes | Purpose |
| --- | --- | --- |
| `00FF` | `DE` | Guard before input |
| `0100–0107` | `45 AA 67 BB 89 CC 72 DD` | Amounts 45, 67, 89, 72, interleaved with untouched tags |
| `0108` | `AD` | Guard after input |
| `03FF` | `DE` | Guard before output |
| `0400–0401` | `AA BB` | Output: low two decimal digits, then hundreds |
| `0402` | `AD` | Guard after output |
| `8FFB` | `DE` | Guard below the deepest return address |
| `9000` | `AD` | Guard above the stack |

All other RAM outside the program is zero. Setup creates fresh CPU/RAM
components without resetting or executing them, following the
[machine definition guide](../../../machines/definitions.md).

## Program

| Address | Bytes | Instruction |
| --- | --- | --- |
| `0200` | `CD 20 02` | `CALL 0220H` |
| `0203` | `76` | `HALT` |
| `0220` | `08` | `EX AF,AF′` — save caller A and flags |
| `0221` | `D9` | `EXX` — save caller BC, DE, HL |
| `0222` | `21 00 01` | `LD HL,0100H` — first amount |
| `0225` | `01 02 00` | `LD BC,0002H` — stride over tags |
| `0228` | `11 00 04` | `LD DE,0400H` — D counts amounts, E counts hundreds |
| `022B` | `3E 00` | `LD A,00H` — low decimal total |
| `022D` | `EF` | `RST 28H` — accumulate one amount |
| `022E` | `15` | `DEC D` |
| `022F` | `09` | `ADD HL,BC` — advance pointer, preserve Z |
| `0230` | `C2 2D 02` | `JP NZ,022DH` |
| `0233` | `32 00 04` | `LD (0400H),A` |
| `0236` | `7B` | `LD A,E` |
| `0237` | `32 01 04` | `LD (0401H),A` |
| `023A` | `D9` | `EXX` — restore caller BC, DE, HL |
| `023B` | `08` | `EX AF,AF′` — restore caller A and flags |
| `023C` | `C9` | `RET` |
| `0028` | `86` | `ADD A,(HL)` |
| `0029` | `27` | `DAA` |
| `002A` | `D0` | `RET NC` — return if no decimal carry |
| `002B` | `1C` | `INC E` — count a new hundred |
| `002C` | `C9` | `RET` |

## Expected execution

The bank exchanges move the caller's A, flags, and general registers into
the alternate bank. The routine initializes the newly active main registers,
then reads every other input byte. Each RST is an ordinary subroutine call
to `0028`, pushing `022E`; it does not change interrupt state.

ADD calculates a binary sum. DAA converts that result to packed decimal and
sets C for a decimal carry. RET NC returns immediately when C is clear;
otherwise INC E counts the new hundred before RET. DEC D counts the input
records, and ADD HL,BC preserves its Z flag for JP NZ.

| Amount address | Amount (decimal) | Binary A after ADD | A after DAA | Decimal carry | E (hundreds) | Running total (decimal) |
| --- | ---: | --- | --- | ---: | --- | ---: |
| `0100` | 45 | `45` | `45` | 0 | `00` | 45 |
| `0102` | 67 | `AC` | `12` | 1 | `01` | 112 |
| `0104` | 89 | `9B` | `01` | 1 | `02` | 201 |
| `0106` | 72 | `73` | `73` | 0 | `02` | 273 |

The normal run halts after **46 instructions**. Output `0400–0401` becomes
`73 02`, representing 273. The two final exchanges restore every main byte
register and all six main flags. Alternate A/B/C/D/E/H/L are then
`02/00/02/00/02/01/08`, with S/Z/H/PV/N/C = `0/1/0/0/0/0`.
PC = `0204`, SP = `9000`, R = `AC`, and `halted` is true. IX/IY/I, IM,
and both interrupt-enable latches retain their initial values.

The stack retains `2E 02 03 02` at `8FFC–8FFF`: the inner and outer return
addresses, each stored low byte first in memory. Calls write high then low;
returns read low then high. Only these four stack bytes and the two output
bytes change. Inputs, tags, guards, and code remain intact.

Every instruction increments R once, wrapping its low seven bits while
preserving bit 7. Already halted steps perform no accesses or R updates.
Timing and dummy bus activity remain outside the
[instruction-step contract](../model.md#instruction-steps).

## Acceptance checks

Tests compare all 46 complete records and actual RAM calls against an
independently written trace, including both decimal-carry paths. They check
full initial/final memory images, preserved caller state, fresh factories,
retained records, and snapshot resumption at every boundary from 0 through 46.
Reset releases HALT and clears the documented control fields while preserving
both banks, output, and other RAM.

Alternative inputs cover totals 0, 10, 100, and 396. For four valid amounts,
the instruction count is 42 plus two per decimal carry (the number of hundreds).
Editing the first input to zero after setup produces 228, demonstrating that
execution reads current RAM. Changing JP NZ to unconditional JP prevents
normal completion; the runner still stops when its instruction budget expires.
