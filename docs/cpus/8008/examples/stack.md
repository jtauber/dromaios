# 8008 nested-call example

Load 2, call an outer subroutine that adds 3, call an inner subroutine that adds
4, return and add 1, then return to store `0A` at `0080`. A jump skips an
unsupported byte before HLT. The two nested calls cross the address-register
boundary from slot 7 to slot 0 and then slot 1.

[Model contract](../../../../src/components/cpus/specifications/8008.md#eight-address-registers) ·
[Machine definition](../../../../src/machines/8008/stack-example.machine) ·
[Example tests](../../../../tests/machines/8008/stack-example.test.ts) ·
[CPU tests](../../../../tests/components/cpus/8008.test.ts)

## Initial state and program

Addresses, bytes, registers, and slot contents below are hexadecimal; step
counts are decimal. Both factories create 16 KiB of zero-filled RAM and load:

| Address | Bytes | Instruction |
| --- | --- | --- |
| `0200` | `06 02` | LAI 02H |
| `0202` | `46 00 03` | CAL 0300H |
| `0205` | `F8` | LMA |
| `0206` | `7C 0A C2` | JMP 020AH |
| `0209` | `22` | Unsupported byte; never fetched |
| `020A` | `00` | HLT |
| `0300` | `04 03` | ADI 03H |
| `0302` | `7E 00 84` | CAL 0400H |
| `0305` | `04 01` | ADI 01H |
| `0307` | `3F` | RET |
| `0400` | `04 04` | ADI 04H |
| `0402` | `07` | RET |

The initial byte registers are A = `11`, B = `22`, C = `33`, D = `44`, E = `55`,
H = `C0`, and L = `80`. S/Z/P/C = `1 0 1 1`; `halted` is false.
The eight address slots are `[1111 1222 1333 1444 1555 1666 1777 0200]`.
Selector 7 makes PC = `0200`. These are explicit runnable values; construction
does not perform physical power-on clearing. There is no caller `end` address.

`create8008StackExample()` returns fresh `{ cpu, ram }`.
`create8008StackExampleMemory()` creates the same memory image without a CPU.
Neither factory resets or executes anything.

The program uses alternate documented opcodes `7C`, `7E`, and `3F`. Address
bytes `C2` and `84` retain their full values in records; their ignored top two
bits do not contribute to the jump or call destination. H:L remains `C080`,
whose low 14 bits address `0080` for LMA.

## Expected execution

Each before-state equals the preceding after-state, starting from the initial
state above. This table gives every changing state field. B/C/D/E/H/L and HL
retain their initial values. Slots 2–6 remain `[1333 1444 1555 1666 1777]`.

| Step | Instruction at | PC after | Selector | Slot 0 | Slot 1 | Slot 7 | A | S Z P C | Halted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | LAI `0200` | `0202` | 7 | `1111` | `1222` | `0202` | `02` | `1 0 1 1` | false |
| 2 | CAL `0202` | `0300` | 0 | `0300` | `1222` | `0205` | `02` | `1 0 1 1` | false |
| 3 | ADI `0300` | `0302` | 0 | `0302` | `1222` | `0205` | `05` | `0 0 1 0` | false |
| 4 | CAL `0302` | `0400` | 1 | `0305` | `0400` | `0205` | `05` | `0 0 1 0` | false |
| 5 | ADI `0400` | `0402` | 1 | `0305` | `0402` | `0205` | `09` | `0 0 1 0` | false |
| 6 | RET `0402` | `0305` | 0 | `0305` | `0403` | `0205` | `09` | `0 0 1 0` | false |
| 7 | ADI `0305` | `0307` | 0 | `0307` | `0403` | `0205` | `0A` | `0 0 1 0` | false |
| 8 | RET `0307` | `0205` | 7 | `0308` | `0403` | `0205` | `0A` | `0 0 1 0` | false |
| 9 | LMA `0205` | `0206` | 7 | `0308` | `0403` | `0206` | `0A` | `0 0 1 0` | false |
| 10 | JMP `0206` | `020A` | 7 | `0308` | `0403` | `020A` | `0A` | `0 0 1 0` | false |
| 11 | HLT `020A` | `020B` | 7 | `0308` | `0403` | `020B` | `0A` | `0 0 1 0` | true |

Each instruction reads its listed bytes in address order. LMA then writes `0A`
to `0080`, without reading that location. Calls and returns make no RAM stack
accesses. There are 21 reads and one write; `0209` is never read. All other RAM
bytes retain their initial values. Steps 1–10 report `executed`; HLT reports
`halted`. Further stopped steps have a null instruction, no accesses, and
unchanged state.

The returns leave `0403` in slot 1 and `0308` in slot 0 because opcode fetch
increments the outgoing PC before selecting the caller's slot. Both saved
caller addresses already point past all three bytes of their CAL instructions.
The example crosses the selector boundary without exceeding seven nested calls;
CPU tests separately exercise overflow and unbalanced returns.

## Pause, reset, and restart

`runCpu(cpu, { maxSteps: 11 })` returns the complete trace and
`stopReason: "halted"`. A four-step budget instead pauses at `0400`, with selector 1 and
return addresses in slots 0 and 7. Resuming for six steps with
`endAddress: 0x020a` returns steps 5–10 and `completed`, before fetching HLT.
One more step halts; that outcome takes precedence over an endpoint at `020B`.

Reset during the nested call follows the [reset contract](../../../../src/components/cpus/specifications/8008.md#reset):
clear all data and address registers, choose selector zero, preserve flags and
RAM, and stay stopped. A fresh factory restores the program and original state
in independent components. Retained records survive later execution, reset,
and host edits; their nested arrays and flags remain detached.

## Acceptance checks

- Verify the complete initial state and every byte of both factory images.
- Compare all eleven complete records and independently observed RAM calls
  against this trace, including alternate encodings and inactive slots.
- Check final RAM, the skipped byte, and the absence of further halted accesses.
- Pause inside the inner subroutine and resume through both returns; caller
  completion uses the currently selected PC.
- Check reset with occupied return slots, preserved RAM and flags, fresh
  factory restart, and detached records across all subsequent activity.
