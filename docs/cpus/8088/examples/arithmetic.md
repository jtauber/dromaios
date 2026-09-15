# 8088 arithmetic example

Load `12FF`, add `0002`, and store `1301` through the data segment. The program
exposes a carry between AL and AH, little-endian words at an odd address, and
the distinction between a logical address and its physical RAM location.

[Model contract](../model.md) ·
[Machine definition](../../../../src/machines/8088/example.machine) ·
[Example tests](../../../../tests/machines/8088/example.test.ts) ·
[CPU tests](../../../../tests/components/cpus/8088.test.ts) ·
[Coverage](../../coverage.md#8088)

## Initial state and program

Addresses, byte values, and register values are hexadecimal; step counts are
decimal. Begin with zero-filled 1 MiB RAM and load these nine bytes:

| CS:IP | Physical address | Bytes | Instruction |
| --- | --- | --- | --- |
| `1234:0100` | `12440` | `B8 FF 12` | `MOV AX,12FFh` |
| `1234:0103` | `12443` | `05 02 00` | `ADD AX,0002h` |
| `1234:0106` | `12446` | `A3 81 00` | `MOV [0081h],AX` |

The store uses DS, so its destination is `2000:0081`, physical `20081`.
The destination and completion address `12449` initially contain zero.

| State | Initial value |
| --- | --- |
| AX, BX, CX, DX | `1122`, `3344`, `5566`, `7788` |
| SP, BP, SI, DI | `8000`, `9000`, `0010`, `0020` |
| CS, DS, SS, ES, IP | `1234`, `2000`, `3000`, `4000`, `0100` |
| CF, PF, AF, ZF, SF, TF, IF, DF, OF | `1`, `0`, `1`, `1`, `1`, `0`, `1`, `1`, `1` |
| `halted`, `interruptDeferred`, `segmentDeferred`, `trapPending` | `false` |

These are explicit example choices. AL/AH initially show `22`/`11`; the other
byte views similarly come from their word registers. Physical PC is `12440`.
Instruction semantics follow the [model contract](../model.md#instruction-steps)
and its Intel manual references. No external interrupt is offered in this example.

`create8088Example()` returns fresh `{ cpu, ram, endAddress }` with physical
`endAddress = 12449`. `create8088ExampleMemory()` creates the same image without
a CPU. Neither factory resets or executes the CPU. No reset-vector bytes are
needed for this example.

## Expected execution

All three steps return `executed`. Registers other than AX and IP retain their
initial values. The first record starts with the explicit state above; later
before-states equal the preceding after-states.

| Step | Instruction | IP after | PC after | AX | AH | AL | CF PF AF ZF SF TF IF DF OF |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | MOV immediate | `0103` | `12443` | `12FF` | `12` | `FF` | `1 0 1 1 1 0 1 1 1` |
| 2 | ADD immediate | `0106` | `12446` | `1301` | `13` | `01` | `0 0 1 0 0 0 1 1 0` |
| 3 | MOV to memory | `0109` | `12449` | `1301` | `13` | `01` | `0 0 1 0 0 0 1 1 0` |

MOV preserves flags. ADD ignores incoming CF, carries from the low byte into
the high byte, and sets AF because `F + 2` carries from bit 3. PF is clear
because the low byte `01` has odd parity, even though the whole word `1301`
has even parity. CF, ZF, SF, and OF are clear; TF/IF/DF retain their values.
The final MOV preserves these results.

Each instruction reads its three listed bytes from consecutive physical
addresses. The final instruction then writes `01` to `20081` and `13` to
`20082`, without reading either destination. There are nine reads and two
writes. No other RAM bytes change, including physical `00081` and the
corresponding addresses in the code, stack, and extra segments.

`runCpu(cpu, { maxSteps: 3, endAddress })` returns the three records and
`stopReason: "completed"`, before fetching at `12449`. The completion address
is physical `12449`, not the logical offset `0109`. Repeating the completed
run performs no fetch. A direct CPU step at the endpoint now decodes its zero
bytes as `ADD [BX+SI],AL`. Completion belongs to the runner; it does not halt
the CPU or turn the endpoint into an unsupported instruction.

## Pause, reset, and restart

A one-step budget pauses at `1234:0103`. A further two steps complete the
program; their combined records match an uninterrupted run. Without an
endpoint, the three-step run stops at its budget.

CPU reset preserves AX = `1301`, the other general registers, and all RAM.
It sets CS:IP to `FFFF:0000`, clears DS/SS/ES, and clears every flag. There are
no vector reads; the next instruction address is physical `FFFF0`. This
example leaves that memory zero, which decodes as ADD. Tests place an explicitly
unsupported `0F` byte there, verify rejection without advancing IP, then replace
it with a supported instruction that executes from the same address.

A fresh factory restores the original logical state and memory image in
independent components. This is lesson restart, distinct from CPU reset.

## Acceptance checks

- Verify both factories and all bytes of their initial and final RAM images.
- Compare all three complete records against the trace, including both logical
  and physical instruction addresses, word/byte register views, and flags.
- Observe actual RAM calls; require nine fetches and the two ordered data writes.
- Verify physical completion before an extra fetch, direct stepping at the
  endpoint, pause/resume, reset with no vector reads, and fresh restart.
- Keep records detached across later execution, memory edits, and reset.

The separate CPU tests cover signed arithmetic boundaries, parity, every word
load/store value, segment and address-space wrapping, all flag patterns, and
unsupported opcodes and prefixes.
