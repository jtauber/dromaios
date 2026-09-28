# 8080 lesson: going around again

This follows the [forward-jump lesson](jump.md). A backward jump repeats an
addition and store, preserving the state left by the previous iteration.

[Machine definition](../../../../src/machines/8080/loop-lesson.machine) ·
[Machine tests](../../../../tests/machines/8080/loop-lesson.test.ts) ·
[Lesson template](../../../../site/templates/loop.html) ·
[Program descriptions](../../../../site/interactive/register-programs.ts) ·
[Shared controller](../../../../site/interactive/register-explorer.ts) ·
[Execution history](../../../../site/interactive/program-history.ts)

## Program and learning question

Why do the same instructions produce a different result each time? The load
runs once; the loop then operates on the value still in A. A jump changes PC
without restoring registers, flags, or memory.

| Address | Bytes | Instruction | Role |
| --- | --- | --- | --- |
| `0100` | `3A 03 00` | `LDA 0003H` | Load the starting byte once. |
| `0103` | `C6 01` | `ADI 1` | Add one to the current A, updating flags. |
| `0105` | `32 04 00` | `STA 0004H` | Store A at address 4, preserving flags. |
| `0108` | `C3 03 01` | `JMP 0103H` | Return to the addition, preserving A and flags. |

Addresses and instruction bytes are hexadecimal. The machine definition owns
the complete initial state: 64 KiB RAM, A = 0, PC = `0100`, clear flags, 41 at
address 3, and zero at address 4. Unspecified memory is zero.

The first load puts 41 into A. The first addition/store pair produces 42.
Subsequent iterations produce 43, 44, and so on. Between an addition and its
store, A has the new value while address 4 still holds the previous result.
After loading, edits to address 3 do not affect the loop. Edits to address 4
remain until the next store, without changing A or the next addition.

Setting the source to 254 before loading gives stored values 255, 0, and 1.
The addition producing zero sets CY; store and jump preserve it. The next
addition clears it. The jump is unconditional and never tests carry.

## Manual execution and history

There is no `end` declaration or HLT instruction. Every Step calls the real CPU
exactly once; no timer, background runner, or automatic iteration exists. The
learner can stop pressing at any point and continue from the same state later.
Step stays available at every instruction unless a data draft is invalid.

The program view marks the next instruction from PC and the last fetched bytes
from the CPU record. Per-instruction run counts accumulate for the whole run:
the load remains at one, while add/store/jump counts increase. Counts update
only when an instruction executes, not when memory is edited or views rerender.
Backward jumps never turn previously visited rows into skipped instructions.

The PC history retains at most thirteen addresses (twelve transitions). Once
older entries are discarded, its label explicitly says “Recent PC path (last
12 steps)” and shows a leading ellipsis. Lifetime visit counts remain intact.
The loop has no end-of-program marker. Program byte lengths belong to the
known instruction descriptions and do not imply a completion address.

Starting again creates a fresh machine, restoring the load, data, CPU state,
and program. It clears history, counts, fetch highlighting, last record, and
invalid drafts. It differs from the jump, which preserves those CPU values.
Instruction bytes are read-only in this lesson; the existing data editor
continues to expose addresses 0–7.

## Acceptance checks

Machine tests check the full initial image, absence of a completion address,
exact load/add/store/jump records through 258 iterations, all result/flag
combinations encountered over byte wraparound, independent data edits, retained
records, and fresh-machine isolation. [History tests](../../../../tests/site/program-history.test.ts)
check bounded recent paths, lifetime counts, and forward versus backward transfers.

Browser checks cover several iterations; load count remaining one; correct
revisit and last-fetch markers; recent-history truncation; independent memory
edits; invalid drafts without phantom executions; the 254 → 255 → 0 → 1 case;
restart while inside the loop; keyboard focus; narrow and wide layouts; and all
earlier lessons after the shared controller refactor.

Without JavaScript, explanatory text stays readable and execution controls
remain disabled.
