# 68000 polling echo

[Model contract](../model.md) ·
[Machine composition](../../../../src/machines/68000/echo-example.machine) ·
[Example tests](../../../../tests/machines/68000/echo-example.test.ts) ·
[Byte input](../../../devices/byte-input.md) ·
[Byte output](../../../devices/byte-output.md)

This synthetic ROM machine polls a memory-mapped input latch, echoes each
received byte, and stops after echoing newline (`0A`). It uses the same device
implementations as the [8080 echo example](../../8080/examples/echo.md).
Numbers below are hexadecimal except step counts and flag values.

## Construction and map

`create68000EchoExample({ output: onWrite })` returns `cpu`, `memory`, `rom`, `ram`,
`input`, `output`, and `reset`. Construction creates independent components
without resetting, executing, or notifying the host. CPU registers and the
interrupt mask start at zero, flags and latches at false, and `entry` at
`none`. RAM is zero; both devices are empty. Call `machine.reset()` to boot,
then offer input and run.

| Physical addresses | Component |
| --- | --- |
| `000000`–`0003FF` | 1 KiB ROM: vectors and code; writes report bus errors |
| `010000`–`010FFF` | 4 KiB RAM for the supervisor stack |
| `020000` | Output register: writes notify the host; reads report bus errors |
| `030000` | Input status: `01` if ready, `00` if empty; non-consuming |
| `030001` | Input data: consume the byte, or return `00` if empty |
| All other addresses through `FFFFFF` | Unmapped: report bus errors |

Writes to either input register report bus errors without changing input.
The map translates `030000`/`030001` to local device addresses `0`/`1`.

## Vectors and program

| ROM address | Bytes | Meaning |
| --- | --- | --- |
| `000000` | `00 01 10 00` | Initial SSP `00011000` |
| `000004` | `00 00 01 00` | Initial PC `00000100` |
| `000008` | `00 00 02 00` | Bus-error vector 2 targets `00000200` |

| PC | Bytes | Instruction |
| --- | --- | --- |
| `000100` | `41 F9 00 03 00 00` | `LEA (030000).L,A0` — input |
| `000106` | `43 F9 00 02 00 00` | `LEA (020000).L,A1` — output |
| `00010C` | `4A 10` | `TST.B (A0)` — ready? |
| `00010E` | `67 FC` | `BEQ 010C` — poll while empty |
| `000110` | `10 28 00 01` | `MOVE.B 1(A0),D0` — consume data |
| `000114` | `12 80` | `MOVE.B D0,(A1)` — echo it |
| `000116` | `0C 00 00 0A` | `CMPI.B #0A,D0` |
| `00011A` | `66 F0` | `BNE 010C` |
| `00011C` | `4E 72 27 00` | `STOP #2700` |
| `000200` | `4E 72 27 00` | Stop after an unexpected bus error |

All unlisted ROM bytes are zero. Two LEAs set up the pointers. An empty poll
takes two steps; a ready byte takes six steps to echo and return to polling,
or seven for newline including STOP. The input MOVE reads the data register
once and captures its value in D0. The output MOVE writes that captured byte
once. The normal program performs no RAM writes.

```typescript
const bytes: number[] = [];
const machine = create68000EchoExample({ output: value => { bytes.push(value); } });
machine.reset();
machine.input.offer(0x48);
runCpu(machine.cpu, { maxSteps: 8 }); // Set up pointers, echo H, return to polling.
machine.input.offer(0x0a);
runCpu(machine.cpu, { maxSteps: 7 }); // Echo newline and stop.
```

After newline, PC is `00000120`, D0 `0000000A`, A0 `00030000`, A1 `00020000`,
SSP/A7 `00011000`, and SR `2700`. Other data/address registers remain zero;
`halted` is true, `faulted` and `tracePending` are false, and `entry` is `none`.
Input is empty and output holds `0A`. ROM and RAM remain unchanged.

## Reset and resumption

CPU-only reset reads the vectors, enters supervisor mode, masks interrupts,
and preserves device state. `machine.reset()` performs CPU reset, then clears
both device latches; it preserves RAM and host output history. The returned
record describes CPU reset only. The machine also connects the CPU's RESET
instruction to the same device-reset operation. The echo program begins with
LEA, so a byte offered after machine reset remains available during setup.

Status reads and snapshots do not consume data. If input arrives after an
empty status read, the next poll sees it. After the data read, the host can
offer another byte before output: D0 still holds the earlier byte. Tests
reconstruct CPU and both devices from their snapshots at every instruction
boundary, reconnecting the same ROM/RAM and host sink, without replay or
extra consumption. There is no implicit whole-machine save-state format.

## Failures and checks

Writes to either input register enter vector 2 with pending data unchanged.
A long read from `030000` reads status, consumes data at `030001`, then faults
at unmapped `030002`. D0 is not updated with a partial longword, but the input
read remains consumed and appears in the access record. The handler stops.

A throwing output callback is a host failure, preserving consumed input,
captured D0, and the written output latch. The 68000 has fetched IR `1280`
but has not retired the instruction, so PC remains `00000114`; no completed
step record is returned. Replaying that step can emit the byte again. The
model neither rolls back nor automatically retries such effects.

Tests check full state and access records, actual component calls, complete
memory images, failed writes, consumption before a later fault, reset,
and input timing around instruction boundaries. The 8080 and 68000 programs
echo the same host-supplied `HELLO\n` message and stop after its newline.
