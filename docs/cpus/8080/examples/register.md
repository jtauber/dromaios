# 8080 lesson: a place to work

The first CPU-backed browser lesson copies a byte from memory into A, then
from A into a different memory location. Its learning question is whether a
copy remains independent when the original changes.

[Machine definition](../../../../src/machines/8080/register-lesson.machine) ·
[Machine tests](../../../../tests/machines/8080/register-lesson.test.ts) ·
[Lesson template](../../../../site/templates/register.html) ·
[Browser controller](../../../../site/interactive/register-explorer.ts)

The [8080 specification](../../../../src/components/cpus/specifications/8080.md)
owns instruction behavior, state and record contracts, and hardware references.
The lesson uses the same generated processor as the other machine examples.

## Setup and program

The machine has one 8080 and 65,536 bytes of RAM. A, B, C, D, E, H, L and SP
start at zero, all flags are clear, both interrupt latches are false, and the
CPU is running. PC starts at hexadecimal `0100`. These are chosen lesson
values, not hardware power-on guarantees.

RAM is zero-filled except for these images. Addresses and bytes in this table
are hexadecimal:

| Address | Bytes | Meaning |
| --- | --- | --- |
| `0003` | `C8 2A` | Source 200 and destination 42, in decimal |
| `0100` | `3A 03 00` | `LDA 0003H`: load A from address 3 |
| `0103` | `32 04 00` | `STA 0004H`: store A at address 4 |

The browser shows addresses 0–7, with decimal contents. Its editor can change
only those eight bytes, leaving the instructions outside the editable range.
A is read-only in the interface and always comes from a CPU snapshot.

## Expected execution

| Action | PC before → after (hex) | A before → after (decimal) | Memory effect |
| --- | --- | --- | --- |
| Read address 3 into A | `0100` → `0103` | 0 → 200 | Read address 3; no writes |
| Write A to address 4 | `0103` → `0106` | 200 → 200 | Replace 42 at address 4 with 200 |

Each action calls `cpu.step()` exactly once. Both records have outcome
`executed`, preserve every flag and unrelated register/latch, and retain the
three fetched instruction bytes. Their complete access lists, in hexadecimal,
are:

- Load: `R 0100:3A`, `R 0101:03`, `R 0102:00`, `R 0003:C8`.
- Store: `R 0103:32`, `R 0104:04`, `R 0105:00`, `W 0004:C8`.

The caller stops at the declared `endAddress` (`0106`). There is no HLT and
no additional CPU step after the store. This does not imply the processor is
halted; the two-step experiment is complete.

## Editing and restarting

Editing memory does not execute instructions or modify A. A valid edit writes
only the selected byte; an invalid draft preserves RAM and disables execution.
Selecting another address reloads its stored byte and discards an invalid draft.
Selection never changes the instruction's source or destination address.

If the learner loads 200, then changes address 3 to 17, A retains 200 and the
store still writes 200 to address 4. Editing address 4 before storing changes
what is overwritten, not the value taken from A. The last-instruction display
retains the completed record through subsequent memory edits and selections;
setup, editing, and inspection are not CPU accesses in that record.

Starting again constructs a fresh machine with the original state and images,
selects address 3, clears the last-instruction display and invalid drafts, and
re-enables only the load action. It does not call `cpu.reset()`.

## Acceptance checks

Headless tests verify the entire initial RAM image and state, both complete
instruction records, and independent copies for every byte value 0–255 while
memory changes between the load and store. A fresh factory call restores the
setup without changing the prior run or its records.

Browser checks additionally cover ordered controls, no third step, read-only A,
changes before and between instructions, invalid drafts, keyboard progression,
restart, and the recorded bytes/accesses in the optional instruction disclosure.
The page remains readable with disabled controls when JavaScript is unavailable.
