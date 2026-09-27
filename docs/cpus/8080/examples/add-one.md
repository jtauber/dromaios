# 8080 lesson: doing something with a byte

The lesson adds a calculation to the [register lesson](register.md): load from
memory, add one inside A, then store the result. Learners first try 41 → 42,
then 255 → 0 and 127 → 128, connecting the earlier byte-wraparound exploration
to the 8080's carry flag.

[Machine definition](../../../../src/machines/8080/add-one-lesson.machine) ·
[Machine tests](../../../../tests/machines/8080/add-one-lesson.test.ts) ·
[Lesson template](../../../../site/templates/add-one.html) ·
[Shared browser controller](../../../../site/interactive/register-explorer.ts)

The [8080 specification](../../../../src/components/cpus/specifications/8080.md)
owns instruction behavior, state/record contracts, and hardware references.
The lesson runs the same generated CPU as the other examples.

## Setup and program

The machine has one 8080 and 65,536 bytes of RAM. All registers except PC start
at zero, all flags are clear, both interrupt latches are false, and the CPU is
running. PC starts at hexadecimal `0100`. These are chosen lesson values, not
hardware power-on guarantees. RAM is zero-filled except for these images;
addresses and bytes below are hexadecimal:

| Address | Bytes | Meaning |
| --- | --- | --- |
| `0003` | `29 00` | Source 41 and destination 0, in decimal |
| `0100` | `3A 03 00` | `LDA 0003H`: copy address 3 into A |
| `0103` | `C6 01` | `ADI 1`: add one to A and update arithmetic flags |
| `0105` | `32 04 00` | `STA 0004H`: store A at address 4 |

The browser exposes only addresses 0–7 for editing. Instruction bytes remain
outside that range. A and CY are read-only views of CPU snapshots. Each action
executes one instruction, with the next enabled action selected by PC. The
caller stops at the declared `endAddress` (`0108`); no HLT or fourth step runs.

## Expected execution

With the default byte, the load sets A to 41, the addition sets it to 42, and
the store writes 42 at address 4. PC moves `0100` → `0103` → `0105` → `0108`.
The addition changes no RAM; the original source remains 41 throughout.

The complete memory access records, in hexadecimal, are:

- Load: `R 0100:3A`, `R 0101:03`, `R 0102:00`, `R 0003:29`.
- Add: `R 0103:C6`, `R 0104:01` (instruction and immediate operand only).
- Store: `R 0105:32`, `R 0106:04`, `R 0107:00`, `W 0004:2A`.

All three preserve unrelated registers and latches. Load and store preserve
flags; `ADI 1` updates S, Z, AC, P, and CY without adding the incoming carry.
All five remain clear for 41 + 1. Representative arithmetic results are:

| Input A (decimal) | Full sum | Result A | S | Z | AC | P | CY |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 41 | 42 | 42 | 0 | 0 | 0 | 0 | 0 |
| 127 | 128 | 128 | 1 | 0 | 1 | 0 | 0 |
| 254 | 255 | 255 | 1 | 0 | 0 | 1 | 0 |
| 255 | 256 | 0 | 0 | 1 | 1 | 1 | 1 |

The lesson uses `ADI 1` because it updates carry. `INR A` would preserve CY and
therefore would not connect this addition to the visible carry bit.

## Editing and restarting

The shared memory editor retains the register lesson's rules: edits affect
only the selected RAM byte, never CPU state. Selection does not change an
instruction's source or destination. Invalid drafts preserve memory and block
all instruction buttons until corrected or discarded by selection/restart.

Changing address 3 after loading does not change A or the subsequent addition.
Changing address 4 before storing changes what is overwritten. After adding,
the last-addition explanation retains the full sum, result, and carry from
that execution through memory edits and the store. The full sum is explanatory
arithmetic from the record's input; the displayed result and carry come from
the CPU record. The last-instruction trace always describes the most recent
instruction, including all flags and memory accesses.

Starting again constructs a fresh machine, restores source 41/destination 0,
A = 0 and CY = 0, selects address 3, clears both records and invalid drafts,
and enables only the load action. It does not call CPU reset.

## Acceptance checks

Headless tests check the full initial image/state, all three default records,
and every input byte 0–255 against independently calculated flags. They also
check memory independence, store preservation of flags, stable instruction
bytes and records, and fresh construction after a carry-producing run.

Browser checks cover 41 → 42, 255 → 0, and 127 → 128; edits between each step;
invalid drafts and restart; keyboard focus; no repeated/out-of-order steps;
and preservation of the last addition through storing and memory edits. The
shared controller and template must retain the original two-step register
lesson's behavior. Both pages remain readable with disabled execution controls
when JavaScript is unavailable.
