# 8080 polling echo

[CPU port contract](../model.md#port-io) ·
[Machine composition](../../../../src/machines/8080/echo-example.machine) ·
[Example tests](../../../../tests/machines/8080/echo-example.test.ts) ·
[Byte input](../../../devices/byte-input.md) ·
[Byte output](../../../devices/byte-output.md)

This synthetic machine polls for input, echoes each received byte, and halts
after echoing newline (`0A`). An empty input latch keeps it polling. Zero and
repeated bytes are ordinary data. Numbers below are hexadecimal except step
counts and flag values.

## Construction and ports

`create8080EchoExample({ output: onWrite })` returns `cpu`, `ram`, `input`, `output`,
`ports`, and `reset`. Construction allocates independent components without
reset, execution, or host notification. CPU registers, flags, and control
latches start at zero/false; input is empty and output has no last byte.

| Direction and port | Device operation |
| --- | --- |
| `IN 00` | Read input status without consuming |
| `IN 01` | Consume input data, or return zero if empty |
| `OUT 01` | Write the output register and notify the host |
| All other ports | Throw a host connection error before contacting a device |

Input and output at port `01` select different devices. Port addresses are
separate from RAM addresses. The host offers one byte through `input.offer()`;
a `false` result means the earlier pending byte remains in the device.

## Program

The program occupies `0000`–`000F` in 64 KiB RAM. All other RAM is zero.

| Address | Bytes | Instruction |
| --- | --- | --- |
| `0000` | `DB 00` | `IN 00` — ready? |
| `0002` | `B7` | `ORA A` — set Z from status |
| `0003` | `CA 00 00` | `JZ 0000` — keep polling if empty |
| `0006` | `DB 01` | `IN 01` — consume one byte into A |
| `0008` | `D3 01` | `OUT 01` — echo A |
| `000A` | `FE 0A` | `CPI 0A` — compare with newline |
| `000C` | `C2 00 00` | `JNZ 0000` |
| `000F` | `76` | `HLT` |

An empty poll takes three steps and returns to `0000`. A ready byte takes
seven steps to echo and return; newline takes eight steps including HLT.
IN/OUT each fetch two instruction bytes, then perform one recorded port
transfer. The program never writes RAM. ORA sets status flags; CPI replaces
them from the comparison while preserving A.

One possible host schedule is:

```typescript
const bytes: number[] = [];
const machine = create8080EchoExample({ output: value => { bytes.push(value); } });
machine.reset();
machine.input.offer(0x48);
runCpu(machine.cpu, { maxSteps: 7 }); // Echo H and return to polling.
machine.input.offer(0x0a);
runCpu(machine.cpu, { maxSteps: 8 }); // Echo newline and halt.
```

After newline, PC is `0010`, A is `0A`, flags S/Z/AC/P/CY are `0/1/1/1/0`,
and `halted` is true. Other registers remain zero and interrupts stay disabled.
Input is empty, output holds `0A`, and RAM is unchanged. Further halted steps
have no accesses or output.

## Pausing, reset, and failure

An input offered after an empty status read waits through that poll's branch
and is seen by the next status read. After `IN 01`, A owns the captured byte;
the host may offer the next byte before OUT without changing what is echoed.
Inspection and CPU reconstruction from a snapshot with the same RAM/ports
neither consume pending input nor replay output.

`cpu.reset()` resets CPU control state and PC without resetting devices.
`machine.reset()` resets the CPU first, then clears both device latches. It
preserves RAM, data registers, flags, and the host transcript. Its returned
record describes the CPU reset only. Reentrant reset from a CPU callback fails
before clearing either device. Restarting the example from initial state
means constructing fresh components and choosing a host input/output history.

If the host output callback throws, input remains consumed and the output
latch retains the byte. OUT's fetched PC is already `000A`; no completed step
record is returned. Nothing retries or rolls back the host call. Tests check
this specific failure boundary, without promising general recovery from host
errors.

Tests specify complete states and actual access sequences, check the full
memory image, reconstruct the CPU at every boundary, and distinguish pending
device input from a byte already captured in A. The paired 68000 example
echoes the same host message through mapped memory.
