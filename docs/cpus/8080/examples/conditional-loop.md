# 8080 lesson: knowing when to stop

This follows the [unconditional loop lesson](loop.md), replacing JMP with JNC
so a recorded carry flag determines whether execution repeats or falls through.

[Machine definition](../../../../src/machines/8080/conditional-loop-lesson.machine) ·
[Machine tests](../../../../tests/machines/8080/conditional-loop-lesson.test.ts) ·
[Lesson template](../../../../site/templates/conditional-loop.html) ·
[Program descriptions](../../../../site/interactive/register-programs.ts) ·
[Shared controller](../../../../site/interactive/register-explorer.ts) ·
[Presentation tests](../../../../tests/site/conditional-loop.test.ts)

## Program and learning question

How can the same instruction choose different paths on successive executions?
ADI updates carry, STA preserves it, and JNC tests it. The jump neither repeats
the calculation nor examines the stored result.

| Address | Bytes | Instruction | Role |
| --- | --- | --- | --- |
| `0100` | `3A 03 00` | `LDA 0003H` | Load the starting byte once. |
| `0103` | `C6 01` | `ADI 1` | Add one to A and update flags. |
| `0105` | `32 04 00` | `STA 0004H` | Store A, preserving carry. |
| `0108` | `D2 03 01` | `JNC 0103H` | Return to the addition if CY = 0; otherwise continue at `010B`. |

Addresses and instruction bytes are hexadecimal. The machine owns the initial
state: 64 KiB RAM, A = 0, PC = `0100`, clear flags, 254 at address 3, and zero
at address 4. Unspecified memory is zero. The completion address is `010B`.

The default program runs seven instructions. Its PC path is
`0100 → 0103 → 0105 → 0108 → 0103 → 0105 → 0108 → 010B`.
The first addition produces 255 with CY = 0, so the first JNC jumps backward.
The next addition wraps to 0 with CY = 1, so the second JNC falls through.
Both executions fetch all three jump bytes, preserve registers other than PC,
preserve flags, and leave RAM unchanged. Final A and address 4 are zero, with
CY still set. The CPU is not halted: the lesson stops offering steps at its
declared boundary, without executing the byte at `010B`.

Starting from another byte gives `256 - source` trips through add/store/JNC.
255 needs one trip, 254 needs two, and 253 needs three. Starting at zero still
performs an addition; it completes after 256 trips. The test is on carry,
not whether A or memory contains zero.

## Presentation and edits

Each learner press executes the real CPU once. The shared program view shows
PC, fetched bytes, run counts, and bounded recent history. The last-instruction
explanation quotes CY from the jump's **before** snapshot and describes its
actual **after** PC as taken or not taken. Even when not taken, JNC has executed:
its bytes remain highlighted and its run count increases. The controller has
no lesson-specific execution path or simulated flag calculation.

Instruction bytes are read-only. The data editor exposes addresses 0–7;
editing a byte changes neither CPU state nor the last instruction record.
Changing address 3 after the load cannot alter the remaining trip count.
Changing address 4 before JNC cannot change its decision; an untaken final
jump leaves that edit intact. Invalid drafts block Step without adding history.

Start again constructs a fresh machine and clears records, counts, history,
fetch highlighting, and invalid drafts. It restores source 254 and clear flags.
Without JavaScript, the lesson text remains readable and controls are disabled.

## Acceptance checks

Machine tests check the complete initial image and state, all seven default
execution records, both jump fetch paths, flag preservation across store and
jump, varied trip counts, memory edits independent of the condition, unchanged
program bytes, retained records, and fresh-machine isolation. Presentation
tests connect the lesson descriptions and history to both real jump outcomes.

Browser checks cover the seven-step path; taken and not-taken explanations;
completion at `010B` with counts 1/2/2/2; fetch highlighting on both jumps;
starts of 253 and 255; edits before a decision; invalid drafts; restart after
carry and completion; keyboard focus; narrow layouts; and regression checks
of the existing jump and loop lessons.
