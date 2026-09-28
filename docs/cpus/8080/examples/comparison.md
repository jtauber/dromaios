# 8080 lesson: choosing a stopping point

This follows the [countdown](countdown.md). CPI compares A with an editable
target without changing A; the familiar JNZ repeats until the values match.

[Machine definition](../../../../src/machines/8080/comparison-lesson.machine) ·
[Machine tests](../../../../tests/machines/8080/comparison-lesson.test.ts) ·
[Lesson template](../../../../site/templates/comparison.html) ·
[Program descriptions](../../../../site/interactive/register-programs.ts) ·
[Shared controller](../../../../site/interactive/register-explorer.ts) ·
[Presentation tests](../../../../tests/site/comparison.test.ts)

## Program and learning question

How can a loop finish at a chosen value while keeping that value in A?

| Address | Bytes | Instruction | Role |
| --- | --- | --- | --- |
| `0100` | `3A 03 00` | `LDA 0003H` | Load the starting value once. |
| `0103` | `C6 01` | `ADI 1` | Add one to A and update flags. |
| `0105` | `32 04 00` | `STA 0004H` | Store A, preserving flags. |
| `0108` | `FE 2C` | `CPI 44` | Compare A with the target, updating flags but preserving A. |
| `010A` | `C2 03 01` | `JNZ 0103H` | Repeat if Z = 0; otherwise continue at `010D`. |

Addresses and bytes are hexadecimal; operands in ADI/CPI labels are decimal.
The machine owns the initial state: 64 KiB RAM, A = 0, PC = `0100`, clear flags,
41 at address 3, zero at address 4, and target 44 at `0109`. Unspecified memory
is zero. The completion address is `010D`.

The default run executes thirteen instructions and stores 42, 43, then 44.
The load runs once; add, store, compare, and jump each run three times.
CPI calculates A minus the target to update flags but discards the difference.
The comparisons with 42 and 43 clear Z; the comparison with 44 sets it.
A remains 44 at completion, even though Z is 1. Both jump paths fetch all three
bytes and preserve A, flags, and RAM. No instruction is fetched at `010D`, and
the CPU is not halted.

ADI also changes Z: on the final trip its result 44 clears Z before CPI sets it.
The flag display reads CPU state rather than deriving equality from A or RAM.
All five arithmetic flags follow the
[8080 contract](../../../../src/components/cpus/specifications/8080.md#arithmetic-and-logical-flags);
the lesson focuses on Z.

For starting byte `source` and target byte `target`, the number of trips is
`(target - source + 256) % 256`, except that zero means 256 trips. The program
adds before testing, so a target equal to the starting value requires a full
wraparound. Total instructions are `1 + 4 × trips`. Starting at 254 with
target 0 demonstrates wraparound in two trips.

## Presentation and edits

The target editor reuses the existing immediate-operand control. A valid decimal
edit from 0 through 255 writes only `0109`, updating the displayed bytes and
comparison label without executing an instruction. It locks after the first
step. The addition remains fixed at one. Explanations of completed comparisons
use the fetched operand and CPU snapshots, independently of later RAM edits.

The data editor exposes addresses 0–7. Editing address 3 before the load changes
the starting value; editing it afterward cannot change A. Editing address 4
after a comparison cannot change Z or the jump's decision. Load, store, and
jump preserve flags. Edits preserve the last instruction record and history.
Invalid drafts in either editor block Step without changing the stored byte;
fixing one editor must not conceal an invalid draft in the other.

Each press executes one instruction. The view retains fetched-byte highlights,
lifetime run counts, and the last twelve PC transitions. The default thirteen-step
run therefore truncates the recent path but retains every instruction count.
Restart creates a fresh machine and clears records, history, counts, highlights,
and invalid drafts. It restores source 41, destination 0, target 44, and Z = 0,
and unlocks the target. Without JavaScript, controls remain disabled and the
explanations remain readable.

## Acceptance checks

Machine tests check the complete initial state and memory, all thirteen default
records and independently expected flags, comparison preserving A and RAM,
both jump paths, unchanged code, varied targets including equality and wraparound,
memory edits contradicting the flag, retained records, and fresh-machine isolation.
Presentation tests use real records to check labels, explanations, counts,
bounded history, and the distinction between an edited label and a past operand.

Browser checks cover the default run and counts 1/3/3/3/3; the Z change from
addition to comparison at A = 44; targets 42 and 43; 254 → 255 → 0; data edits
before loading and before the final jump; both editors' invalid drafts and
recovery; locking and restart; keyboard operation; narrow layouts; and regression
checks for the preceding countdown and editable-addition lessons.
