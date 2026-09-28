# 8080 lesson: counting down

This follows the [carry-controlled loop](conditional-loop.md). Subtracting one
updates the zero flag, and JNZ uses that flag to repeat a chosen number of times.

[Machine definition](../../../../src/machines/8080/countdown-lesson.machine) ·
[Machine tests](../../../../tests/machines/8080/countdown-lesson.test.ts) ·
[Lesson template](../../../../site/templates/countdown.html) ·
[Program descriptions](../../../../site/interactive/register-programs.ts) ·
[Shared controller](../../../../site/interactive/register-explorer.ts) ·
[Presentation tests](../../../../tests/site/countdown.test.ts)

## Program and learning question

How can a small number control how many times a loop runs? A holds the remaining
count. SUI subtracts one, STA stores the result, and JNZ repeats while Z is clear.

| Address | Bytes | Instruction | Role |
| --- | --- | --- | --- |
| `0100` | `3A 03 00` | `LDA 0003H` | Load the starting count once. |
| `0103` | `D6 01` | `SUI 1` | Subtract one from A and update flags. |
| `0105` | `32 04 00` | `STA 0004H` | Store A, preserving flags. |
| `0108` | `C2 03 01` | `JNZ 0103H` | Return to the subtraction if Z = 0; otherwise continue at `010B`. |

Addresses and instruction bytes are hexadecimal. The machine owns the initial
state: 64 KiB RAM, A = 0, PC = `0100`, clear flags, 3 at address 3, and zero
at address 4. Unspecified memory is zero. The completion address is `010B`.

The default program runs ten instructions, storing 2, 1, and 0 in that order.
The load runs once; subtraction, store, and jump each run three times. Its PC
path is `0100 → 0103 → 0105 → 0108 → 0103 → 0105 → 0108 → 0103 → 0105 → 0108 → 010B`.
The first two subtractions clear Z; the final subtraction sets it. STA and JNZ
preserve all flags. All three jump executions fetch all three bytes; the first
two jump backward and the last falls through. Final A and address 4 are zero,
Z is set, and CY is clear. The lesson ends without fetching at `010B` or halting
the CPU.

The chosen starting values of A = 0 and Z = 0 are independent. LDA does not
update flags even when loading zero. In this program only SUI changes Z: it
records whether the subtraction's byte result was zero. The display must read
the CPU flag, never infer it from A or RAM.

For source bytes 1–255, the loop runs `source` trips, or `1 + 3 × source`
instructions including the load. Starting at zero performs the subtraction
before testing, wraps to 255 with Z clear, then counts down for 256 trips
(769 instructions total). SUI ignores incoming carry; CY records borrow and
the remaining flags follow the [8080 contract](../../../../src/components/cpus/specifications/8080.md#arithmetic-and-logical-flags).

## Presentation and edits

The lesson selects Z for the shared flag display; the preceding arithmetic
lessons continue to display CY. JNC and JNZ share a description helper for a
flag-clear condition. It reads the tested flag from the before snapshot and
reports the actual after-PC; it never executes or chooses a CPU path.
Subtraction explanations use the fetched operand and recorded result.

Each learner press executes one instruction. The program view retains the
existing fetched-byte highlights, lifetime run counts, bounded recent path,
and declared completion marker. Nothing runs between presses.

The data editor exposes addresses 0–7; program bytes remain read-only. A source
edit before loading chooses the count; after loading it does not change A or
the remaining trips. Editing address 4 cannot change Z or the jump decision.
On the final trip, such an edit survives completion because no later store runs.
Edits preserve the last instruction record, and invalid drafts block Step
without adding history. Restart creates a fresh machine and clears records,
counts, history, fetch highlights, and invalid drafts, restoring source 3 and Z = 0.
Without JavaScript, explanatory text remains readable and controls are disabled.

## Acceptance checks

Machine tests check the complete initial state and memory, all ten default
records, independently expected flags, both jump paths and their fetches,
unchanged code, retained records, varied counts including zero's wraparound,
memory edits that contradict the zero flag, and fresh-machine isolation.
Presentation tests check the selected flag, subtraction and jump descriptions,
and run counts using real CPU records; the existing JNC test covers the shared
conditional description's carry case.

Browser checks cover the default ten-step sequence and counts 1/3/3/3; Z changing
only on subtraction; starts of 1, 5, and 0; edits before loading and before a
jump; invalid drafts and recovery; restart after completion; keyboard focus;
narrow layouts; and carry-display regression checks on preceding lessons.
