# 68000 ROM output

[Model contract](../../../../src/components/cpus/specifications/68000.md) ·
[Machine composition](../../../../src/machines/68000/output-example.machine) ·
[Example tests](../../../../tests/machines/68000/output-example.test.ts) ·
[Byte-output contract](../../../devices/byte-output.md)

This synthetic machine boots from ROM and writes `HELLO\n` through a
memory-mapped byte-output device. It connects the 68000's existing memory and
RESET interfaces to a reusable component, with the host receiving the bytes.

## Construction and memory

```typescript
const bytes: number[] = [];
const machine = create68000OutputExample({ output: value => { bytes.push(value); } });
machine.cpu.reset();
const run = runCpu(machine.cpu, { maxSteps: 17 });
// bytes: [0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x0a]
```

The factory returns concrete `cpu`, `memory`, `rom`, `ram`, and `output`
components. Construction allocates independent state without executing,
resetting, or notifying the host. All initial CPU registers and the interrupt
mask are zero; flags and latches are false; `entry` is `none`. RAM starts at
zero and the device latch at `null`. These are deterministic example values.

| Physical addresses | Component | Behavior |
| --- | --- | --- |
| `000000`–`0003FF` | 1 KiB ROM | Vectors, program, and message; writes report bus errors |
| `010000`–`010FFF` | 4 KiB RAM | Supervisor stack space |
| `020000` | Byte output | Write emits a byte; read reports a bus error |
| All other addresses through `FFFFFF` | Unmapped | Reads and writes report bus errors |

ROM bytes not listed below are zero. The map translates `020000` to device
address zero. CPU records retain the physical address.

## Vectors and program

| ROM address | Bytes | Meaning |
| --- | --- | --- |
| `000000` | `00 01 10 00` | Initial SSP `00011000`, immediately above RAM |
| `000004` | `00 00 01 00` | Initial PC `00000100` |
| `000008` | `00 00 02 00` | Bus-error vector 2 targets `00000200` |

CPU reset reads the first eight bytes, selects supervisor mode, clears T,
and sets the interrupt mask to 7. It leaves the device alone. The program's
first instruction then calls the machine's `resetDevices` connection, which
clears the output latch without emitting a byte or clearing RAM.

| PC | Bytes | Instruction |
| --- | --- | --- |
| `000100` | `4E 70` | `RESET` |
| `000102` | `41 F9 00 00 01 80` | `LEA (000180).L,A0` — message |
| `000108` | `43 F9 00 02 00 00` | `LEA (020000).L,A1` — output register |
| `00010E` | `70 05` | `MOVEQ #5,D0` — six iterations |
| `000110` | `12 98` | `MOVE.B (A0)+,(A1)` |
| `000112` | `51 C8 FF FC` | `DBF D0,0110` |
| `000116` | `4E 72 27 00` | `STOP #2700` |
| `000180` | `48 45 4C 4C 4F 0A` | Message bytes: `HELLO\n` |
| `000200` | `4E 72 27 00` | Stop after an unexpected bus error |

DBF decrements D0's low word after each byte and branches until it becomes
`FFFF`. Each MOVE fetches its operation word, reads one message byte, and
writes the device once. The repeated `L` bytes deliberately produce two
separate notifications. Normal execution never reads the device register.

## Result, pausing, and restart

The run takes 17 steps and returns `stopReason: "halted"`. Final state has
PC `0000011A`, D0 `0000FFFF`, A0 `00000186`, A1 `00020000`, SSP/A7 `00011000`,
and SR `2700`. Other data and address registers remain zero. `halted` is true,
`faulted` and `tracePending` are false, and `entry` is `none`. The output latch
contains `0A`. RAM remains entirely zero and ROM is unchanged.

The RESET record includes one `{ kind: "reset" }` event. The six MOVE records
each include a write to physical address `020000`; the host receives the same
six bytes in order. Inspecting these retained records or component snapshots
causes no new output. Stepping after STOP also produces no output.

Execution can pause at every instruction boundary. Reconstructing the CPU
and device from their snapshots, reconnecting ROM/RAM, and keeping the same
host stream resumes without replaying completed writes. This is explicit
component reconstruction, not a whole-machine save-state format.

Calling `cpu.reset()` after STOP reloads the vectors and preserves the output
latch. Running the program again clears that latch via RESET and appends
another message to the host stream. Creating a new factory result allocates
fresh components; choosing a fresh host transcript remains the caller's job.

## Failure checks

Alongside all complete records and memory images, tests check a read from the
write-only register and a word write spanning `020000`–`020001`. For the word
write, the high byte reaches the device before the unmapped low byte faults.
Vector-2 delivery retains that output and records only the successful byte.

A throwing host callback instead propagates as a host failure. The device
latch, host effects, and completed source postincrement remain visible;
there is no bus-error conversion or automatic retry. The
[device contract](../../../devices/byte-output.md#reads-and-failures) defines
this boundary independently of the CPU.
