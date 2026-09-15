# Z80 checksum example

This program sums three unsigned bytes into a two-byte checksum, stores it,
and checks both result bytes before halting. ADD accumulates the low byte;
ADC carries into the high byte through intervening loads that preserve flags.

[Machine definition](../../../../src/machines/z80/checksum-example.machine) ·
[Example tests](../../../../tests/machines/z80/checksum-example.test.ts) ·
[Arithmetic and logic contract](../model.md#arithmetic-and-logic)

The explicit initial state sets `interruptDeferred` and `nmiDeferred` to false.

## Initial state and memory

The machine has 64 KiB of RAM. Main A/B/C/D/E/H/L are `11/22/33/44/55/66/77`,
with all six flags set. Alternate A/B/C/D/E/H/L are `88/99/AA/BB/CC/DD/EE`,
with S/Z/H/PV/N/C = `0/1/0/1/0/1`. IX/IY/SP are `1234/5678/ABCD`, PC =
`0200`, I = `42`, R = `FE`, IM = 2, IFF1 is true, IFF2 is false, and the
CPU is running. These are explicit example choices.

| Addresses | Initial bytes | Purpose |
| --- | --- | --- |
| `007F` | `AA` | Guard before input |
| `0080–0082` | `FF 02 FF` | Three-byte input |
| `0083` | `BB` | Guard between input and output |
| `0084–0085` | `CC CC` | Checksum, low byte first |
| `0086` | `55` | Guard after output |

All other RAM outside the program is zero. Setup constructs fresh CPU/RAM
components without resetting or executing them, following the
[machine definition guide](../../../machines/definitions.md).

## Program

| Address | Bytes | Instruction |
| --- | --- | --- |
| `0200` | `21 80 00` | `LD HL,0080H` |
| `0203` | `06 03` | `LD B,03H` |
| `0205` | `16 00` | `LD D,00H` |
| `0207` | `AF` | `XOR A` |
| `0208` | `86` | `ADD A,(HL)` — loop entry |
| `0209` | `5F` | `LD E,A` |
| `020A` | `7A` | `LD A,D` |
| `020B` | `CE 00` | `ADC A,00H` |
| `020D` | `57` | `LD D,A` |
| `020E` | `7B` | `LD A,E` |
| `020F` | `2C` | `INC L` |
| `0210` | `10 F6` | `DJNZ 0208H` |
| `0212` | `21 84 00` | `LD HL,0084H` |
| `0215` | `77` | `LD (HL),A` |
| `0216` | `2C` | `INC L` |
| `0217` | `72` | `LD (HL),D` |
| `0218` | `FE 00` | `CP 00H` |
| `021A` | `20 08` | `JR NZ,0224H` |
| `021C` | `7A` | `LD A,D` |
| `021D` | `FE 02` | `CP 02H` |
| `021F` | `20 03` | `JR NZ,0224H` |
| `0221` | `76` | `HALT` |
| `0224` | `18 FE` | `JR 0224H` — failure loop |

## Expected execution

XOR A clears A and carry, setting Z and even parity. Each loop iteration
adds one input to A, saves the low result in E, and adds the resulting carry
to D using `ADC A,00H`. Loads preserve the carry between ADD and ADC. The low
byte is restored to A for the next iteration. INC L stays within this page;
DJNZ counts iterations independently of Z.

| Input address | Byte | Low result | Carry into ADC | High result | Partial checksum |
| --- | --- | --- | --- | --- | --- |
| `0080` | `FF` | `FF` | 0 | `00` | `00FF` |
| `0081` | `02` | `01` | 1 | `01` | `0101` |
| `0082` | `FF` | `00` | 1 | `02` | `0200` |

ADD/ADC set P/V for overflow, not parity; it is clear throughout these
additions. CP compares each checksum byte without replacing A. Both
comparisons set Z and N, so neither JR NZ takes the failure path.

The normal run halts after **38 instructions**: four setup instructions,
eight instructions for each of three iterations, and ten instructions to
store and check the result. Final A/B/C/D/E/H/L are `02/00/33/02/00/00/85`;
BC/DE/HL are `0033/0200/0085`. S/Z/H/PV/N/C are `0/1/0/0/1/0`. PC = `0222`,
R = `A4`, and `halted` is true. The alternate bank, IX/IY/SP/I, and interrupt
state retain their initial values. Only `0084–0085` change, to `00 02`.

Every instruction increments R once, wrapping its low seven bits while
preserving bit 7. ADD `(HL)` reads its data once; ADC immediate reads its
operand once. Stores write once without reading the destination. Already
halted steps perform no accesses or refresh updates. Timing and dummy bus
activity remain outside the [model contract](../model.md#instruction-steps).

## Acceptance checks

Tests compare all 38 complete records and actual RAM calls, full initial/final
memory images, and fresh factories. Snapshot resumption is checked after
steps 4, 5, 7, 13, 15, 21, 23, 28, 33, 36, and 37, including between the
low-byte addition and ADC. Reset clears control state and releases HALT while
preserving RAM and both banks. Captured records survive later execution,
reset, and host edits.

Changing input `0082` from `FF` to `FE` produces `01FF`; the low comparison
takes its failure branch after 34 instructions. Changing the high comparison
operand at `021E` to `03` instead makes the second comparison fail after 37
instructions, with the original `0200` checksum still stored. Both paths
reach `0224` without halting. Further running stays in that loop until the
runner's instruction budget is exhausted.
