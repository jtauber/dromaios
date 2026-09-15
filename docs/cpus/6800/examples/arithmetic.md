# 6800 arithmetic example

Load 2, add 3, and store 5 at RAM address `0080`. This first 6800 example uses
the shared runner and a caller completion address. Its expected result and
access records can be compared with the [6809 example](../../6809/examples/arithmetic.md).

[Model contract](../model.md) ·
[Machine definition](../../../../src/machines/6800/example.machine) ·
[Example tests](../../../../tests/machines/6800/example.test.ts) ·
[CPU tests](../../../../tests/components/cpus/6800.test.ts)

## Initial state and program

`waiting` starts false and remains false throughout this example.

Addresses, byte values, and registers below are hexadecimal; step counts are
decimal. Both factories create 64 KiB of zero-filled RAM and load:

| Address | Bytes | Meaning |
| --- | --- | --- |
| `0200` | `86 02` | LDAA #2 |
| `0202` | `8B 03` | ADDA #3 |
| `0204` | `B7 00 80` | STAA $0080 |
| `FFFE` | `02 00` | Reset vector: `0200`, high byte first |

Initial registers are A = `11`, B = `22`, X = `3456`, SP = `7FFF`, and
PC = `0200`. H/I/N/Z/V/C start as `1 0 1 1 1 1`. The nonzero registers and
set flags make preservation and replacement visible. These are explicit
example values, and construction performs no reset.

`create6800Example()` returns fresh `{ cpu, ram, endAddress }`, with
`endAddress = 0x0207`. `create6800ExampleMemory()` creates the same RAM image
without constructing a CPU. Neither factory executes instructions.

## Expected execution

Each before-state equals the preceding after-state, beginning with the initial
state above. B, X, and SP keep their initial values throughout. The instruction
address and fetched bytes match the program table.

| Step | Instruction | PC after | A after | H I N Z V C after | Outcome |
| --- | --- | --- | --- | --- | --- |
| 1 | LDAA #2 | `0202` | `02` | `1 0 0 0 0 1` | executed |
| 2 | ADDA #3 | `0204` | `05` | `0 0 0 0 0 0` | executed |
| 3 | STAA $0080 | `0207` | `05` | `0 0 0 0 0 0` | executed |

LDAA preserves H/I/C, sets N/Z from `02`, and clears V. ADDA ignores the
incoming C, adds 3, and replaces H/N/Z/V/C. STAA preserves H/I/C and sets
N/Z/V for the stored value. I stays clear throughout all three steps.

LDAA reads `0200` and `0201`; ADDA reads `0202` and `0203`. STAA reads
`0204`, `0205`, and `0206`, then writes `05` to `0080` without reading it.
There are seven reads and one write. All other memory bytes, including the
reset vector, stay unchanged.

`runCpu(cpu, { maxSteps: 3, endAddress })` returns these three complete records
and `stopReason: "completed"`, before reading `0207`. Repeating that run
returns no records and still reports completion. A direct CPU step at `0207`
attempts the zero byte there, reports `unsupported` with `reason: "opcode"`,
and preserves state. Without an endpoint, a three-step budget reports
`step-limit`; one further attempt reports `unsupported`.

## Pause, reset, and restart

A one-step budget pauses at `0202` with A = `02`. Resuming for two steps with
the completion address returns the remaining records and reports `completed`.
Previously returned records remain unchanged.

After the complete run, reset reads `02` from `FFFE` and `00` from `FFFF`,
sets PC to `0200` and I to 1, and preserves A = `05`, B/X/SP, the other flags,
and the stored result. Running again executes the same program with I set.
Editing the reset vector changes the destination of the next reset; host
edits to code and data also survive reset.

A new factory restores the original image and explicit state in independent
CPU and RAM instances. This is the lesson restart described in the
[reset contract](../model.md#cpu-reset).

## Acceptance checks

- Check the explicit initial state, completion address, and every byte of both
  factory memory images, including the reset vector.
- Compare all three complete records and independently observed RAM calls
  against the trace above; verify the final RAM image.
- Verify caller completion without an extra fetch, direct stepping beyond the
  endpoint, and pause/resume through the shared runner.
- Check vector reads and I on reset, preserved state and RAM, current vector
  contents, fresh factory restart, and detached records after later edits.
