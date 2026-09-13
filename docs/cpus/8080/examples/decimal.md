# 8080 packed-decimal addition example

This example adds decimal **999 + 199 = 1198**, using two packed-decimal bytes
per operand. Each byte holds two decimal digits, one in each nibble. Ordinary
binary addition produces an intermediate result; DAA adjusts it, and carry
passes to the next pair of digits.

[Model contract](../model.md#decimal-adjustment) ·
[Coverage](../../coverage.md#8080) ·
[Machine definition](../../../../src/machines/8080/decimal-example.machine) ·
[Example tests](../../../../tests/machines/8080/decimal-example.test.ts) ·
[CPU tests](../../../../tests/components/cpus/8080.test.ts)

## Initial state and memory

Register values, instruction bytes, and addresses below are hexadecimal;
step counts and the stated decimal calculation are decimal. Flag values are
bits. RAM has 64 KiB, initially zero-filled with the code below at `0200`.
Output bytes `0080`–`0081` start at zero.

| State | Value |
| --- | --- |
| A, B, C, D, E, H, L | `11`, `22`, `33`, `44`, `55`, `66`, `77` |
| PC, SP | `0200`, `ABCD` |
| S, Z, AC, P, CY | `1`, `0`, `1`, `0`, `1` |
| Interrupt enabled, halted | true, false |

Initial snapshots derive BC = `2233`, DE = `4455`, HL = `6677`.

## Program and expected execution

Each row specifies one complete step; its `before` is the previous row's
resulting state. Flags are in S/Z/AC/P/CY order. Unlisted registers and
interrupt enable remain unchanged. HLT sets halted; it is false before then.

| Step | Address | Bytes | Instruction | PC after | A after | Flags after |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `3E 99` | MVI A,99H | `0202` | `99` | `1/0/1/0/1` |
| 2 | `0202` | `C6 99` | ADI 99H | `0204` | `32` | `0/0/1/0/1` |
| 3 | `0204` | `27` | DAA | `0205` | `98` | `1/0/0/0/1` |
| 4 | `0205` | `32 80 00` | STA 0080H | `0208` | `98` | `1/0/0/0/1` |
| 5 | `0208` | `3E 09` | MVI A,09H | `020A` | `09` | `1/0/0/0/1` |
| 6 | `020A` | `CE 01` | ACI 01H | `020C` | `0B` | `0/0/0/0/0` |
| 7 | `020C` | `27` | DAA | `020D` | `11` | `0/0/1/1/0` |
| 8 | `020D` | `32 81 00` | STA 0081H | `0210` | `11` | `0/0/1/1/0` |
| 9 | `0210` | `76` | HLT | `0211` | `11` | `0/0/1/1/0` |

ADI ignores the initial CY. Its binary sum `99 + 99 = 132` leaves A = `32`
and both carry flags set. DAA adds `66`, producing `98`. The low correction
does not carry out of bit 3, so AC clears; CY stays set even though `32 + 66`
does not overflow a byte. This represents decimal 99 + 99 = 198: the low
two digits are 98, with a carry to the next byte.

STA and MVI preserve that carry. ACI includes it when adding the high digits:
`09 + 01 + 1 = 0B`. DAA adds `06`, giving `11`, with AC set and CY clear.
The output bytes `98 11`, low pair of decimal digits first, represent 1198.
S and P describe each adjusted byte's bit pattern; a set S for `98` does
not indicate a negative decimal result.

Each step first fetches exactly its listed bytes, consecutively. The only
additional accesses are a write of `98` at `0080` in step 4 and a write of
`11` at `0081` in step 8. There are no data reads. Steps 1–8 report `executed`;
HLT reports `halted`. A subsequent step has no instruction and no accesses.

Final A = `11`, BC = `2233`, DE = `4455`, HL = `6677`, PC = `0211`, SP = `ABCD`,
with S/Z/AC/P/CY = `0/0/1/1/0` and interrupt enable still true. Only `0080`–`0081`
change in RAM, to `98 11`; code and other memory remain unchanged.

## Acceptance checks and references

`create8080DecimalExample()` creates fresh CPU and RAM instances. A budget
of nine steps gives the [runner](../../../runtime/runner.md) every specified
record and `stopReason: "halted"`. Tests check both full memory images,
every record, and actual RAM calls. Pausing after step 2 preserves the binary
result and both carry flags; resuming for seven steps performs both decimal
adjustments and produces the same remaining records.

Reset sets PC to `0000` and clears halt and interrupt enable, preserving
registers, flags, and modified RAM. Restart creates fresh components with
PC = `0200`, interrupt enable true, and the original memory image. Retained
records survive execution, reset, RAM edits, and restart.

CPU checks compare DAA with independent digit-wise correction for every A
value and all 32 incoming flag combinations, with both interrupt-enable
values and ordinary/wrapped PC. Literal regressions cover no correction,
each correction, carries, and non-BCD states. Decimal arithmetic independently
checks ADI/ACI followed by DAA for all 100 × 100 two-digit operand pairs and
both incoming carries. Successive DAA calls verify use of current A/AC/CY,
and records remain independent of later execution and caller edits.

The [Intel 8080 Assembly Language Programming Manual][intel], printed pages
15–16, specifies the correction and carry rules. Its pages 56–57 illustrate
multi-byte decimal addition. The [8080/8085 manual][intel-later], pages
3-18–3-19, also works through DAA. The [model contract](../model.md#decimal-adjustment)
defines the exact flags, wrapping, and access behavior.

[intel]: https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf
[intel-later]: https://device.report/m/8985a7044b63dafadf8a713690af2e4d2ef632c256d27343044e212ceaa86a3c
