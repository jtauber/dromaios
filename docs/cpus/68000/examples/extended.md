# 68000 extended arithmetic and memory comparison example

[Model contract](../../../../src/components/cpus/specifications/68000.md#addition-subtraction-and-comparison) ·
[Machine definition](../../../../src/machines/68000/extended-example.machine) ·
[Example tests](../../../../tests/machines/68000/extended-example.test.ts)

This 29-step program adds two 64-bit memory values with ADDX, retains the sum
in registers, and restores the destination with SUBX. It then subtracts and
adds one through the register forms and uses CMPM to compare the restored
memory with a reference. Each 64-bit value is a high long followed by a low
long; extended arithmetic starts with the low part.

## Initial state and memory

| Registers | Values |
| --- | --- |
| D0, D1, D2, D3 | `11223344`, `55667788`, `99AABBCC`, `DDEEFF00` |
| D4, D5, D6, D7 | `01234567`, `89ABCDEF`, `FEDCBA98`, `76543210` |
| A0, A1, A2, A3 | `10000000`, `20000000`, `30000000`, `40000000` |
| A4, A5, A6 | `50000000`, `60000000`, `70000000` |
| USP, SSP, PC | `34008000`, `56009000`, `AB002000` |
| interruptMask | `2` |
| IR | `0000` |
| entry.kind, entry.vector | `none`, `00` |
| halted, faulted, tracePending | `false`, `false`, `false` |
| X, N, Z, V, C, T, S | `1`, `0`, `1`, `1`, `1`, `0`, `0` |

Zero-filled 16 MiB RAM contains reset vectors `56 00 90 00 AB 00 20 00`
at `000000` and the 74-byte program at `002000`. The data blocks are:

| Address | Initial bytes | Purpose |
| --- | --- | --- |
| `003000` | `00 00 00 00 00 00 00 01` | Addend: one |
| `004000` | `7F FF FF FF FF FF FF FF` | Destination: largest signed 64-bit integer |
| `005000` | `7F FF FF FF FF FF FF FF` | Reference copy of the destination |
| `006000` | `CC CC` | One equality byte per compared long |

Each block has `DE AD` immediately before it and `BE EF` after it.
Construction does not reset or execute the CPU.

## Program and expected execution

Instruction addresses below have logical prefix `AB00`; values are hexadecimal.
The machine definition supplies the exact instruction bytes.

| PC | Instruction | Effect |
| --- | --- | --- |
| `2000` | `LEA (AB003008).L,A0` | Point just past the addend |
| `2006` | `LEA (CD004008).L,A1` | Point just past the destination |
| `200C` | `SUB.L D0,D0` | Initialize X=0, Z=1 |
| `200E` | `ADDX.L -(A0),-(A1)` | Low long becomes zero; X=1, Z=1 |
| `2010` | `ADDX.L -(A0),-(A1)` | High long becomes `80000000`; X=0, N=1, Z=0, V=1 |
| `2012` | `SVS D4` | Save overflow as `FF` in D4.B |
| `2014` | `MOVE.L (A1)+,D2` | Retain high long of sum |
| `2016` | `MOVE.L (A1)+,D3` | Retain low long; A1 returns to buffer end |
| `2018` | `LEA (AB003008).L,A0` | Return A0 to the addend's end |
| `201E` | `SUB.L D0,D0` | Initialize X=0, Z=1 |
| `2020` | `SUBX.L -(A0),-(A1)` | Restore low long to `FFFFFFFF`; borrow into X |
| `2022` | `SUBX.L -(A0),-(A1)` | Restore high long to `7FFFFFFF`, consuming borrow |
| `2024` | `MOVEQ #1,D0` | Low long of register adjustment |
| `2026` | `MOVEQ #0,D1` | High long of register adjustment |
| `2028` | `SUB.L D5,D5` | Initialize X=0, Z=1 |
| `202A` | `SUBX.L D0,D3` | Subtract low adjustment; borrow into X |
| `202C` | `SUBX.L D1,D2` | Subtract high adjustment and borrow |
| `202E` | `SUB.L D5,D5` | Initialize X=0, Z=1 |
| `2030` | `ADDX.L D0,D3` | Add low adjustment back; carry into X |
| `2032` | `ADDX.L D1,D2` | Add high adjustment and carry; restore the sum |
| `2034` | `LEA (EF005000).L,A2` | Select reference buffer |
| `203A` | `LEA (56006000).L,A3` | Select equality output |
| `2040` | `MOVEQ #1,D7` | Two comparison iterations |
| `2042` | `CMPM.L (A2)+,(A1)+` | Compare reference and restored destination longs |
| `2044` | `SEQ (A3)+` | Write `FF` for equality, otherwise `00` |
| `2046` | `DBF D7,2042` | Repeat, ending with D7.W=`FFFF` |

The memory sum is `80000000:00000000`. Subtraction restores
`7FFFFFFF:FFFFFFFF`, and the register adjustment leaves D2:D3 holding the
sum. The two comparison results are `FF FF`. CMPM's Z describes each long
separately; the output preserves both results.

Final state is D0=`00000001`, D1=`00000000`, D2=`80000000`, D3=`00000000`,
D4=`012345FF`, D5=`00000000`, D7=`0000FFFF`, A0=`AB003000`, A1=`CD004008`,
A2=`EF005008`, A3=`56006002`, PC=`AB00204A`, and XNZVC=`00100`.
Other registers and control state retain their initial values. Only the two
equality bytes differ from their initial memory image.

## Running and acceptance checks

`runCpu(cpu, { maxSteps: 29, endAddress: 0xAB00204A })` completes in
29 records: 23 setup/arithmetic instructions and two three-instruction
comparison iterations. Tests check literal complete records, actual RAM calls,
full initial/final RAM, factory isolation, logical endpoints, and both modes.

Budgets of 4, 11, 16, and 19 stop after the low part of memory addition,
memory subtraction, register subtraction, and register addition respectively.
X is set at every boundary. Z is set after the low additions and clear after
the low subtractions. Reconstructing RAM from prior writes and restoring the
snapshot must reproduce every remaining record with those saved flags.

Changing the addend to two produces register sum `80000000:00000001` while
memory still returns to its original value. Changing the reference's last
byte from `FF` to `FE` produces equality bytes `FF 00` and a clear final Z.
Reset preserves computed registers and RAM, and retained records stay detached.
