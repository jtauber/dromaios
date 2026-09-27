# 8080 lesson: taking a different path

This follows [editing an operand](change-program.md). It adds an unconditional
jump between the familiar load and addition, with two destinations to compare.

[Machine definition](../../../../src/machines/8080/jump-lesson.machine) ·
[Machine tests](../../../../tests/machines/8080/jump-lesson.test.ts) ·
[Lesson template](../../../../site/templates/jump.html) ·
[Shared controller](../../../../site/interactive/register-explorer.ts) ·
[Program view](../../../../site/interactive/program-view.ts)

## Learning question

Does every instruction present in memory have to run? A jump replaces PC with
its encoded destination. The processor fetches the next instruction there,
leaving A, flags, and memory unchanged. Skipped bytes remain in RAM.

The lesson uses four instructions, with hexadecimal addresses:

| Address | Default bytes | Instruction | Effect |
| --- | --- | --- | --- |
| `0100` | `3A 03 00` | `LDA 0003H` | Load the byte at address 3 into A. |
| `0103` | `C3 08 01` | `JMP 0108H` | Continue at the store, skipping the addition. |
| `0106` | `C6 01` | `ADI 1` | Add one to A and update the arithmetic flags, if reached. |
| `0108` | `32 04 00` | `STA 0004H` | Store A at address 4. |

The definition owns the complete initial state: 64 KiB RAM, A = 0, PC = `0100`,
all flags clear, data 41 at address 3, and zero at address 4. The default path
executes three instructions and stores 41, with PC following
`0100 → 0103 → 0108 → 010B`.

Choosing destination `0106` writes `06 01` into the jump's address operand.
The program then executes four instructions, stores 42, and follows
`0100 → 0103 → 0106 → 0108 → 010B`. The jump executes on both paths. The choice
edits its destination before execution; it is not a conditional CPU branch.
Both paths stop offering steps at the declared end, `010B`, without HLT.

## Interaction and records

The destination selector offers only the addition and store addresses. It
writes the low and high destination bytes at `0104` and `0105`, preserving
the opcode and all other program/data bytes. It does not change CPU state or
execute an instruction. Both the program bytes and the jump label reflect RAM.
The choice locks after the first step until restart restores the default skip
path and full initial machine state.

The data editor retains the [register lesson's](register.md) selection and
validation rules. Invalid drafts block Step; changing the destination does not
discard them or make them valid. Valid data edits preserve A, flags, PC, and
the last execution record. The operand of `ADI 1` is fixed in this lesson.

Each Step calls the CPU once. The controller retains PC transitions from those
records, showing the path separately from the program's layout in memory.
The program view uses the current PC for the next marker and the last record's
instruction bytes for fetch highlighting. Previously executed rows say
“Ran earlier.” In this forward-only program, unvisited instructions behind PC
are marked “Skipped · not fetched” with a dashed border. Those labels remain
after completion; restarting clears the path and all execution markers.

The full jump record shows three instruction fetches, no data reads or writes,
and only PC changing. The addition's bytes are neither fetched nor executed on
the skip path. This is an instruction-level view, not a clock-cycle simulation.

## Acceptance checks

Machine tests check the full initial RAM image and CPU state, exact records on
the default skip path, and both destinations with starting bytes 0, 41, and
255. They verify independent data edits after loading, carry only when the
addition executes, immutable jump records, and fresh-machine isolation.

Browser checks cover:

- Both destinations, their byte/label changes before stepping, and unchanged
  CPU/data state while choosing a path.
- Default result 41 in three steps; alternate result 42 in four steps.
- Actual PC paths, jump fetches, skipped versus executed addition markers,
  and no fetch highlight on the skipped bytes.
- Destination locking, end boundary, and restart after either path, including
  a carried result and an invalid data draft.
- Data changes before and after loading, invalid drafts while changing the
  destination, keyboard progression, and preserved records during data edits.
- Desktop/mobile layouts, navigation, and the preceding shared-controller lessons.

Without scripting, the prose and the two destination options remain readable;
selection and execution controls stay disabled.
