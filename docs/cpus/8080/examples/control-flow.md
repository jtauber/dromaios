# 8080 control-flow example

This example repeatedly calls an increment subroutine until A wraps to zero,
then stores the result and halts. It exercises a backward conditional jump,
subroutine return addresses, and the shared runner's step budget.

[Model contract](../../../../src/components/cpus/specifications/8080.md) ·
[Coverage](../../coverage.md#8080) ·
[Machine definition](../../../../src/machines/8080/control-flow-example.machine) ·
[Example tests](../../../../tests/machines/8080/control-flow-example.test.ts) ·
[CPU tests](../../../../tests/components/cpus/8080.test.ts)

## Initial state and memory

The machine has flat, zero-filled 64 KiB RAM with the three blocks below.
All addresses and values in this specification are hexadecimal unless stated
otherwise. Flags are explicit bits, independent of the initial A value.

| State | Value |
| --- | --- |
| A, B, C, D, E, H, L | `11`, `22`, `33`, `44`, `55`, `66`, `77` |
| PC, SP | `0000`, `2000` |
| S, Z, AC, P, CY | `1`, `0`, `1`, `0`, `1` |
| Interrupt enabled, halted | false, false |

| Address | Bytes | Instruction or data |
| --- | --- | --- |
| `0000` | `3E FE` | MVI A,FEH |
| `0002` | `CD 10 00` | CALL 0010H |
| `0005` | `C2 02 00` | JNZ 0002H |
| `0008` | `32 80 00` | STA 0080H |
| `000B` | `76` | HLT |
| `0010` | `C6 01` | ADI 01H |
| `0012` | `C9` | RET |
| `0080` | `A5` | Initial destination byte |

No completion address is needed: HLT ends execution. Unlisted RAM bytes,
including the stack area and gaps between code blocks, start at zero.
Derived snapshots initially expose BC = `2233`, DE = `4455`, and HL = `6677`.

## Instruction behavior

Jumps, calls, and returns preserve registers other than PC/SP, all arithmetic
flags, and the interrupt-enable latch. Immediate targets are little-endian.
CALL saves the address following its operands on the descending stack;
RET restores that address. JNZ tests the stored Z flag.

The complete control-flow family also supports JMP, all eight conditions for
jumps/calls/returns, PCHL, and the eight RST forms. Conditions test Z, CY, P,
or S, with a form for each polarity; AC is never a branch condition. PCHL
uses current HL. RST is a one-byte call to the selected vector from `0000`
through `0038`, in increments of eight. Executing RST from program memory
does not require or deliver an interrupt.

These behaviors follow Intel's [8080 Assembly Language Programming Manual][intel],
Chapter 2, printed pages 31–37 and Appendix B. The model's
[access-record rules](../../../../src/components/cpus/specifications/8080.md#jumps-calls-and-returns) define fetching and
stack ordering, including untaken conditions.

## Expected execution

The step column is decimal. Unlisted state is preserved at every step.
Only ADI changes flags; the initial flags persist through MVI and the first CALL.

| Step | Instruction at | A after | PC after | SP after | Effect |
| --- | --- | --- | --- | --- | --- |
| 1 | `0000` MVI | `FE` | `0002` | `2000` | Load starting value |
| 2 | `0002` CALL | `FE` | `0010` | `1FFE` | Save return address `0005` |
| 3 | `0010` ADI | `FF` | `0012` | `1FFE` | S/Z/AC/P/CY = `1/0/0/1/0` |
| 4 | `0012` RET | `FF` | `0005` | `2000` | Restore return address |
| 5 | `0005` JNZ | `FF` | `0002` | `2000` | Z = 0: repeat |
| 6 | `0002` CALL | `FF` | `0010` | `1FFE` | Save return address `0005` again |
| 7 | `0010` ADI | `00` | `0012` | `1FFE` | S/Z/AC/P/CY = `0/1/1/1/1` |
| 8 | `0012` RET | `00` | `0005` | `2000` | Restore return address |
| 9 | `0005` JNZ | `00` | `0008` | `2000` | Z = 1: continue after operands |
| 10 | `0008` STA | `00` | `000B` | `2000` | Store zero at `0080` |
| 11 | `000B` HLT | `00` | `000C` | `2000` | Enter halted state |

Every record includes the instruction bytes listed above and full before/after
snapshots. Each first fetch is at the listed instruction address; operand
fetches follow in address order. Additional accesses are exactly:

- Each CALL writes `00` to `1FFF`, then `05` to `1FFE`, after its three fetches.
- Each RET reads `05` from `1FFE`, then `00` from `1FFF`, after its opcode fetch.
- STA writes `00` to `0080`, after its three fetches.

JNZ fetches all three instruction bytes on both passes. No step fetches the
instruction at its new target until the next step. Steps 1–10 report `executed`;
step 11 reports `halted`. A subsequent step has no instruction or accesses.

The complete final RAM image equals the initial image with `1FFE` set to `05`
and `0080` set to `00`. `1FFF` stays zero but receives two writes. RET leaves
the saved bytes in RAM. All data registers except A and all register-pair views
retain their initial values; interrupt enable stays false.

## Acceptance checks

The generated factory is `create8080ControlFlowExample()`. With `maxSteps: 11`,
the [runner](../../../runtime/runner.md) returns exactly eleven records and
`stopReason: "halted"`. Tests compare every record to independently authored
expectations and check actual RAM calls and the entire final memory image.

A five-step budget stops after the first taken JNZ, with A = `FF`, PC = `0002`,
SP = `2000`, and destination `0080` still `A5`. A second call with a six-step
budget completes the same execution. Earlier records remain unchanged.

CPU reset returns PC to `0000` and clears halt/interrupt enable while retaining
the final arithmetic state and RAM. Restarting through the factory restores
the original registers, destination byte, code, and zero-filled stack in fresh
components.

The CPU tests additionally cover every conditional form against all 32 flag
combinations with either interrupt-enable value, unconditional transfers,
all RST vectors, PC/SP wrapping, code/stack overlap, nested calls and RST,
current RAM and HL, preserved state, and retained records.

[intel]: https://altairclone.com/downloads/manuals/8080%20Programmers%20Manual.pdf
