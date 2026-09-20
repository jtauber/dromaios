# 8008 arithmetic example

Load 2, add 3, store 5 at RAM address `0080`, and halt. The 8008 builds the
store address in H and L, using its own instruction encodings. This complements
the [8080 arithmetic example](../../8080/examples/arithmetic.md).

[Model contract](../../../../src/components/cpus/specifications/8008.md) ·
[Machine definition](../../../../src/machines/8008/example.machine) ·
[Example tests](../../../../tests/machines/8008/example.test.ts) ·
[CPU tests](../../../../tests/components/cpus/8008.test.ts)

## Initial state and program

Addresses, byte values, and registers below are hexadecimal; step counts are
decimal. Both factories create 16 KiB of zero-filled RAM and load:

| Address | Bytes | Instruction |
| --- | --- | --- |
| `0000` | `2E 00` | LHI 00H: load the upper address bits |
| `0002` | `36 80` | LLI 80H: load the lower address bits |
| `0004` | `06 02` | LAI 02H: load A |
| `0006` | `04 03` | ADI 03H: add to A |
| `0008` | `F8` | LMA: store A at memory[H:L] |
| `0009` | `00` | HLT |

A/B/C/D/E/H/L, all eight address-stack slots, and the selector start at zero.
All four flags S/Z/P/C are clear and `halted` is false. PC therefore starts at
zero in slot zero. These are explicit example values. A physical power-on
sequence would leave the CPU stopped; construction does not perform it.
There is no caller `end` address.

`create8008Example()` returns fresh `{ cpu, ram }`.
`create8008ExampleMemory()` creates the same image without a CPU. Neither
factory resets or executes the processor.

## Expected execution

Each before-state equals the previous after-state, starting from the explicit
initial state. The table describes after-state; the fetched bytes match the
program table above. Slot zero always equals PC. Slots one through seven,
the selector, and B/C/D/E remain zero throughout.

| Step | Instruction | PC / slot 0 | A | H | L / HL | S Z P C | Halted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | LHI | `0002` | `00` | `00` | `00` / `0000` | `0 0 0 0` | false |
| 2 | LLI | `0004` | `00` | `00` | `80` / `0080` | `0 0 0 0` | false |
| 3 | LAI | `0006` | `02` | `00` | `80` / `0080` | `0 0 0 0` | false |
| 4 | ADI | `0008` | `05` | `00` | `80` / `0080` | `0 0 1 0` | false |
| 5 | LMA | `0009` | `05` | `00` | `80` / `0080` | `0 0 1 0` | false |
| 6 | HLT | `000A` | `05` | `00` | `80` / `0080` | `0 0 1 0` | true |

ADI sets even parity because `05` has two set bits; loads, store, and HLT
preserve flags. Each step reads exactly its instruction bytes from consecutive
addresses. LMA then writes `05` to `0080` without reading the destination.
There are ten reads and one write across the whole run. No other RAM changes.
The first five steps report `executed`; HLT reports `halted`.

An already stopped step returns a null instruction, no accesses, and unchanged
state. Running through `runCpu(cpu, { maxSteps: 6 })` returns these six records
and `stopReason: "halted"`.

## Pause, reset, and restart

A three-step budget pauses at `0006` with A = `02`. Another two steps with
`endAddress: 9` stop at `0009` before HLT and report `completed`. Resuming for
one step executes HLT. Together the three runs match uninterrupted execution;
HALT takes precedence over reaching an endpoint at `000A`.

Reset follows the [8008 reset contract](../../../../src/components/cpus/specifications/8008.md#reset): data and address
registers clear, selector zero is chosen, and the CPU stays stopped. Flags
retain their values, including P = 1. RAM retains the stored five and any host
edits to code. Reset alone does not restart this example; an externally supplied
instruction can resume execution. A new factory restores the original RAM image
and runnable initial state in independent components.

## Acceptance checks

- Verify complete initial state and every byte of both factory memory images.
- Check all six complete records, including selected PC and inactive slots,
  against the specified trace; observe actual RAM calls independently.
- Verify final RAM and that further halted steps do not read or write memory.
- Pause and resume through the shared runner, preserving the concrete 8008
  record type and stopping before HLT when the caller specifies that endpoint.
- Check reset clearing, preserved flags and RAM, the stopped state, and fresh
  factory restart. Retained records must survive all later execution and edits.
