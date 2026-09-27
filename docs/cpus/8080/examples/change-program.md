# 8080 lesson: change one byte, change the program

This follows the [stored-program lesson](program.md), reusing its load–add–store
machine and PC path. It introduces an editable immediate operand, rather than
a new machine definition or CPU instruction.

[Machine definition](../../../../src/machines/8080/add-one-lesson.machine) ·
[Machine tests](../../../../tests/machines/8080/add-one-lesson.test.ts) ·
[Lesson template](../../../../site/templates/change-program.html) ·
[Shared controller](../../../../site/interactive/register-explorer.ts) ·
[Program view](../../../../site/interactive/program-view.ts)

## Learning question

Can changing a byte in memory change a program? Change the immediate operand
at hexadecimal `0104` from `01` to `02`, turning `C6 01` into `C6 02`.
The load still puts 41 into A, but the addition now produces 43 and the store
writes 43 to address 4. PC still follows `0100 → 0103 → 0105 → 0108`.

The lesson distinguishes an opcode from an operand, explains immediate
addressing, and compares changing starting data with changing a program.
Zero, decimal 10 (`0A`), and 255 (`FF`) extend the experiment without changing
its instruction layout. The last case gives A = 40 and CY = 1 from 41 + 255.

## Editing and execution

The new field accepts a whole decimal byte, 0–255. Valid input immediately
writes RAM at `0104`; the program view rereads RAM and its addition labels
reflect the current operand. No CPU step occurs during an edit. The opcode,
load/store addresses, and instruction lengths remain fixed. This display
describes a known program; it does not decode arbitrary instructions.

The field is editable only before the first step. Once PC leaves `0100`, it
locks until Start again constructs a fresh machine, restoring operand `01`
along with the original data and CPU state. This is a lesson rule, not memory
protection in the emulated machine. The data editor retains its existing rules.

Invalid operand drafts preserve the last valid RAM byte, labels, and CPU state,
display an error, and block Step. Editing or selecting data cannot clear that
error. A valid operand or Start again recovers. Invalid data drafts independently
block Step even when the operand is valid. Restart clears both editors' drafts.

Each press still calls the real CPU once. The last addition's explanation uses
the operand in the fetched instruction record; A, CY, and PC come from CPU state.
Fetch highlighting and completion follow the stored-program lesson. Data edits
preserve the last execution record. There is no separate arithmetic simulation.

## Acceptance checks

Machine tests cover operands 0, 2, 10, 214, 215, and 255, including exact operand
fetches, unchanged PC transitions, result/carry boundaries, preserved source
data and program bytes, and the original operand in a fresh machine.
Browser checks cover:

- Changing 1 to 2 updates only `0104`, the addition label, and mnemonic before
  execution; three steps give 43 with the original PC path and a `C6 02` fetch.
- Decimal 10 displays `0A`; zero still executes; 255 produces A = 40 and CY = 1.
- The field locks after the load, stays locked through completion, and resets
  to 1 on restart, including after carry and invalid drafts.
- Empty, fractional, negative, nonnumeric, and out-of-range input leave the
  last valid byte intact. Data selection does not bypass an invalid operand,
  and valid operand edits do not bypass an invalid data draft.
- Keyboard progression, desktop/mobile layouts, navigation, and the earlier
  register, add-one, and stored-program lessons after shared view changes.

Without JavaScript the prose remains readable and the operand/step controls
remain disabled, as in the preceding lesson.
