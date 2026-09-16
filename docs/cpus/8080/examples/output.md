# 8080 port output

[Model contract](../model.md#port-io) ·
[Machine composition](../../../../src/machines/8080/output-example.machine) ·
[Example tests](../../../../tests/machines/8080/output-example.test.ts) ·
[Byte-output contract](../../../devices/byte-output.md)

This synthetic machine sends `HELLO\n` through output port `01`. It uses the
same byte-output device as the [68000 ROM-output example](../../68000/examples/output.md).
The machine supplies port routing and reset; the CPU and device models are
unchanged. Numbers below are hexadecimal except step counts and flag values.

## Construction and connections

```typescript
const bytes: number[] = [];
const machine = create8080OutputExample({ output: value => { bytes.push(value); } });
machine.reset();
const run = runCpu(machine.cpu, { maxSteps: 33 });
// bytes: [0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x0a]
```

The factory returns `cpu`, `ram`, `output`, `ports`, and `reset`. It creates
independent state without resetting, executing, or notifying the host. All
CPU registers, flags, and control latches start at zero/false. The output
latch starts at `null`. The 64 KiB RAM contains the program and message below;
all other bytes are zero. These are deterministic example values.

The port connection routes `writePort(01, value)` to `output.write(0, value)`.
Port addresses are separate from RAM addresses: sending output through port
`01` does not change RAM byte `0001`. Every input and every other output port
throws a host error before contacting the device. This is the example's
explicit connection policy; it does not synthesize a CPU exception or supply
a default input value.

The host owns the transcript and interprets the bytes. The device owns only
its last byte and emits one notification per write, including equal values.

## Program and execution

| Address | Bytes | Instruction or data |
| --- | --- | --- |
| `0000` | `21 00 01` | `LXI H,0100` — message pointer |
| `0003` | `06 06` | `MVI B,06` — byte count |
| `0005` | `7E` | `MOV A,M` — read through HL |
| `0006` | `D3 01` | `OUT 01` — send A |
| `0008` | `23` | `INX H` |
| `0009` | `05` | `DCR B` |
| `000A` | `C2 05 00` | `JNZ 0005` |
| `000D` | `76` | `HLT` |
| `0100` | `48 45 4C 4C 4F 0A` | Message: `HELLO\n` |

Two setup instructions precede six iterations of the five-instruction loop,
then HLT: 33 steps altogether. DCR produces B values `05`, `04`, `03`, `02`,
`01`, `00`. It keeps S/CY clear, sets AC, sets Z only on the last iteration,
and gives P values `1`, `0`, `1`, `0`, `0`, `1`. Other instructions preserve
those flags. The final JNZ falls through to HLT.

Each MOV reads its opcode and the byte at current HL. Each OUT reads its
opcode and port operand, then produces one `{ kind: "output", port: 1, value }`
access. There is no device read or RAM write. Both `L` bytes appear separately
in the host transcript and access records.

The run returns `stopReason: "halted"`. Final state has A `0A`, B `00`, HL
`0106` (H `01`, L `06`), PC `000E`, and flags S/Z/AC/P/CY `0/1/1/1/0`.
C/D/E/SP remain zero, interrupts remain disabled with no deferral, and
`halted` is true. RAM is unchanged; the device latch holds `0A`. Further
halted steps have no accesses and emit nothing.

## Reset, pausing, and failures

`cpu.reset()` sets PC to zero and clears CPU control latches while preserving
data registers, SP, flags, RAM, and the device. `machine.reset()` performs
that CPU reset and then clears the device latch. Neither emits output or
erases the host transcript. The returned record describes the CPU reset
only, with no accesses; clearing the device is a separate machine action.
Reset attempted from an active CPU callback fails before either component
changes. Resetting after HLT allows another run that appends another message.

Pausing and reconstructing `Cpu8080` from its snapshot with the same RAM and
port connection preserves device state and does not replay output. Inspection
and zero-step runs are also silent. CPU snapshots contain neither the device
nor the transcript; their ownership remains separate.

A thrown host output callback propagates without returning a completed step.
For this OUT, both instruction bytes have already been fetched, so PC is
`0008`; A and flags are unchanged. The device latch and any host effects
remain visible. Nothing retries or rolls back the callback. Tests let the
host capture the first byte and then throw, verifying that explicitly
continuing from `0008` sends the remaining bytes once. This is evidence for
this instruction's effects, not a general recovery rule for host failures.

Tests independently specify all 33 state transitions and ordered accesses,
observe actual RAM and device calls, and check the complete memory image.
They resume at every instruction boundary, check all rejected port selectors,
reset from HALT, and compare the 8080 and 68000 output byte for byte.
