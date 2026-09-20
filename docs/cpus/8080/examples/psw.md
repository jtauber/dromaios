# 8080 PSW save/restore example

This example saves A and the five flags together on the stack, changes them,
then restores them. A subsequent addition uses the restored carry. The stack
crosses the `FFFF`/`0000` boundary; NOP occupies a step between the change
and the restore without changing that state.

[Model contract](../../../../src/components/cpus/specifications/8080.md#packed-status-and-the-ram-stack) ·
[Coverage](../../coverage.md#8080) ·
[Machine definition](../../../../src/machines/8080/psw-example.machine) ·
[Example tests](../../../../tests/machines/8080/psw-example.test.ts) ·
[CPU tests](../../../../tests/components/cpus/8080.test.ts)

## Initial state and memory

Numbers are hexadecimal except step counts and flag values. RAM has 64 KiB,
initially zero-filled with the code below loaded at `0200`. Stack bytes
`0000` and `FFFF` and output bytes `0080`–`0081` start at zero.

| State | Value |
| --- | --- |
| A, B, C, D, E, H, L | `81`, `22`, `33`, `44`, `55`, `66`, `77` |
| PC, SP | `0200`, `ABCD` |
| S, Z, AC, P, CY | `1`, `0`, `1`, `0`, `1` |
| Interrupt enabled, halted | true, false |

Initial snapshots derive BC = `2233`, DE = `4455`, HL = `6677`. The flags
are explicit stored state; they are not calculated from the initial A.

## Program and expected execution

Each row specifies one complete step; its `before` is the previous row's
resulting state. Flags are in S/Z/AC/P/CY order. Unlisted registers and
interrupt enable remain unchanged. HLT sets halted; it is false before then.

| Step | Address | Bytes | Instruction | PC after | SP after | A after | Flags after |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `31 01 00` | LXI SP,0001H | `0203` | `0001` | `81` | `1/0/1/0/1` |
| 2 | `0203` | `F5` | PUSH PSW | `0204` | `FFFF` | `81` | `1/0/1/0/1` |
| 3 | `0204` | `AF` | XRA A | `0205` | `FFFF` | `00` | `0/1/0/1/0` |
| 4 | `0205` | `00` | NOP | `0206` | `FFFF` | `00` | `0/1/0/1/0` |
| 5 | `0206` | `F1` | POP PSW | `0207` | `0001` | `81` | `1/0/1/0/1` |
| 6 | `0207` | `32 80 00` | STA 0080H | `020A` | `0001` | `81` | `1/0/1/0/1` |
| 7 | `020A` | `CE 00` | ACI 00H | `020C` | `0001` | `82` | `1/0/0/1/0` |
| 8 | `020C` | `32 81 00` | STA 0081H | `020F` | `0001` | `82` | `1/0/0/1/0` |
| 9 | `020F` | `76` | HLT | `0210` | `0001` | `82` | `1/0/0/1/0` |

The saved flags encode as `93`. XRA A changes all five flags, and NOP
preserves that changed state. POP restores A and flags independently: A = `81`
has even parity, but the restored P is zero because that was its saved value.
ACI then computes `81 + 00 + 1 = 82` using restored CY and replaces the
arithmetic flags. The two stores distinguish the restored byte from the
subsequent result.

Each step first fetches its listed bytes, consecutively. The only additional
accesses are:

| Step | Ordered data accesses |
| --- | --- |
| 2 | Write `81` at `0000`, then `93` at `FFFF` |
| 5 | Read `93` at `FFFF`, then `81` at `0000` |
| 6 | Write `81` at `0080` |
| 8 | Write `82` at `0081` |

Stack reads appear only in `accesses`, not in `instruction.bytes`. POP
preserves the saved RAM. Steps 1–8 report `executed`, including NOP; HLT
reports `halted`. A subsequent step has no instruction and no accesses.

Final A = `82`, BC = `2233`, DE = `4455`, HL = `6677`, PC = `0210`, SP = `0001`,
with S/Z/AC/P/CY = `1/0/0/1/0` and interrupt enable still true. RAM contains
`81` at `0000`, `93` at `FFFF`, and `81 82` at `0080`–`0081`; code and other
memory remain unchanged.

## Acceptance checks and references

`create8080PswExample()` creates fresh CPU and RAM instances. With nine steps,
the [runner](../../../runtime/runner.md) returns every specified record and
`stopReason: "halted"`. Tests check both full memory images, all records, and
actual RAM calls. A run paused after step 4 stops with `step-limit`; resuming
for five steps restores the saved state and produces the same remaining records.

Reset sets PC to `0000` and clears halt and interrupt enable while preserving
A, registers, SP, flags, and RAM. It does not restore this example's entry
point or clear the saved stack byte at `0000`. Restart instead creates fresh
components with PC = `0200`, SP = `ABCD`, interrupt enable true, and the original
memory image. Retained records survive execution, reset, RAM edits, and restart.

CPU checks independently verify every accumulator/flag combination for PUSH
and every possible saved word for POP, including all reserved-bit values and
both interrupt-enable states. Other checks cover PC/SP wrapping, opcode/stack
overlap, mixed pair/PSW stacks, edited stack RAM, fixed bits on a later PUSH,
detached records, and NOP's preservation and single-fetch behavior.

The [Intel 8080 Assembly Language Programming Manual][intel], printed pages
16 and 22–23, describes NOP and the PSW stack forms. The
[model contract](../../../../src/components/cpus/specifications/8080.md#packed-status-and-the-ram-stack) defines the flag layout
and access ordering. Intel's page 23 examples save A = `1F` with flags = `47`
and restore A = `FF` with flags = `C3`; CPU checks cover those values as well.

[intel]: https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf
