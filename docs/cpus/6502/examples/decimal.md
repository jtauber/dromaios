# MOS 6502 decimal arithmetic example

This program adds `9999 + 0001` in packed decimal, then subtracts `0001`
from the wrapped result. Each number occupies two bytes, low byte first.
It demonstrates carry and borrow propagation and the NMOS distinction
between the corrected accumulator and its N/Z flags.

[Machine definition](../../../../src/machines/6502/decimal-example.machine) ·
[Example tests](../../../../tests/machines/6502/decimal-example.test.ts) ·
[Arithmetic contract](../../../../src/components/cpus/specifications/6502.md#arithmetic-in-binary-and-decimal)

## Initial state and memory

The machine has 64 KiB of RAM, PC = `0200`, SP = `FF`, and A/X/Y =
`11/22/33`. Initial N/V/D/I/Z/C are `0/1/0/0/1/1`. These are explicit
example choices; SED and CLC select decimal addition at program entry.

| Addresses | Initial bytes | Purpose |
| --- | --- | --- |
| `007F` | `AA` | Guard before the input |
| `0080–0081` | `99 99` | First number: 9999 |
| `0082–0083` | `01 00` | Second number: 0001 |
| `0084–0085` | `CC CC` | Sum destination |
| `0086–0087` | `CC CC` | Difference destination |
| `0088` | `55` | Guard after the output |
| `FFFC–FFFD` | `00 02` | Reset vector |

All other RAM outside the program is zero. Generated factories return fresh
CPU/RAM components as described in the [machine guide](../../../machines/definitions.md).

## Program

| Address | Bytes | Instruction |
| --- | --- | --- |
| `0200` | `F8` | `SED` |
| `0201` | `18` | `CLC` |
| `0202` | `A5 80` | `LDA $80` |
| `0204` | `65 82` | `ADC $82` |
| `0206` | `85 84` | `STA $84` |
| `0208` | `A5 81` | `LDA $81` |
| `020A` | `65 83` | `ADC $83` |
| `020C` | `85 85` | `STA $85` |
| `020E` | `38` | `SEC` |
| `020F` | `A5 84` | `LDA $84` |
| `0211` | `E5 82` | `SBC $82` |
| `0213` | `85 86` | `STA $86` |
| `0215` | `A5 85` | `LDA $85` |
| `0217` | `E5 83` | `SBC $83` |
| `0219` | `85 87` | `STA $87` |
| `021B` | `D8` | `CLD` |

## Expected execution

The caller completes after sixteen instructions at `021C`, without fetching
that address. The CPU has no synthetic halt or completion opcode.

| Arithmetic step | Inputs | A afterward | N/V/Z/C afterward |
| --- | --- | --- | --- |
| ADC at `0204` | `99 + 01`, C = 0 | `00` | `1/0/0/1` |
| ADC at `020A` | `99 + 00`, C = 1 | `00` | `1/0/0/1` |
| SBC at `0211` | `00 - 01`, C = 1 (no incoming borrow) | `99` | `1/0/0/0` |
| SBC at `0217` | `00 - 00`, C = 0 (incoming borrow) | `99` | `1/0/0/0` |

LDA and STA between the low/high operations preserve C. The sum is `0000`
with carry out; subtracting one yields `9999` with borrow out. SEC starts
that subtraction independently of the preceding addition's carry.

Both decimal ADC results are zero, but Z remains clear and N remains set:
NMOS flags follow the intermediate results described in the
[arithmetic contract](../../../../src/components/cpus/specifications/6502.md#arithmetic-in-binary-and-decimal). The final CLD
returns to binary mode. Final A = `99`, PC = `021C`, N/V/D/I/Z/C =
`1/0/0/0/0/0`; X/Y/SP retain their initial values.

Only `0084–0087` change, to `00 00 99 99`. Arithmetic reads its opcode,
zero-page operand address, and current data byte; STA writes once without
reading the destination. SED/CLC/SEC/CLD read only their opcode. The model
omits dummy bus reads and does not claim cycle accuracy.

## Acceptance checks

Tests compare all sixteen complete records and actual RAM calls, the full
initial/final memory image, and fresh independent factories. Pausing after
steps 1, 4, 6, 8, 11, 13, or 15 and rebuilding the CPU from its snapshot
with current RAM preserves D and carry/borrow through the remaining trace.
Recorded snapshots survive later execution, reset, and host memory edits.
