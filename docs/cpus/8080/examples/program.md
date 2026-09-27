# 8080 lesson: what comes next?

This lesson reveals the stored instructions behind the [add-one lesson](add-one.md).
It reuses that machine, initial state, program, completion boundary, and tested
execution behavior. There is no additional machine definition or CPU behavior.

[Machine definition](../../../../src/machines/8080/add-one-lesson.machine) ·
[Machine tests](../../../../tests/machines/8080/add-one-lesson.test.ts) ·
[Lesson template](../../../../site/templates/program.html) ·
[Shared controller](../../../../site/interactive/register-explorer.ts) ·
[Program view](../../../../site/interactive/program-view.ts)

## Learning question

How does one Step button know which instruction to run? The learner follows
PC as an address in RAM, distinguishes addresses from contents, and sees why
instruction lengths affect the next address. The hexadecimal program view
and the decimal data editor show two regions of the same RAM.

The three instructions begin at hexadecimal `0100`, `0103`, and `0105` and
occupy three, two, and three bytes respectively. The CPU's actual PC selects
the enabled step and the next-instruction marker; no separate step counter
advances the display. One press executes one whole instruction, without
pausing or animating individual memory accesses or clock cycles.

## Display and interaction

The program view reads the instruction bytes from the machine's RAM
when rendered. Group boundaries and plain-language labels describe this known
program; they are not a disassembler. Program bytes are read-only and restart
restores the identical program. Only data at addresses 0–7 can be edited.

After each step, shading marks the byte addresses in the CPU record's
`instruction` field, and a summary shows the fetched bytes and the PC movement.
The full access list remains in the optional trace. In particular, the load's
three instruction fetches are highlighted, while its separate data read at
address 3 is not. The next marker belongs to the following instruction, not
to the instruction that just ran. Text labels accompany the visual states.

After the store, PC is `0108`: the end marker becomes current, Step is disabled,
and focus moves to Start again. No fourth instruction runs. The page explains
that this is a lesson boundary, not a CPU halt. Invalid memory drafts also
disable Step, with no change to PC, CPU state, or the last record.

Valid data edits and address selection leave the program display, PC, and last
fetch record intact. Restart clears the last fetch, restores PC to `0100`, and
marks only the first instruction as next. It restores the full machine setup
as in the add-one lesson and returns keyboard focus to Step.

## Acceptance checks

The shared machine tests already check all three complete execution records,
the instruction bytes, PC transitions, and behavior for every input byte.
Browser checks additionally cover:

- Initial bytes and labels, PC = `0100`, and no fetch highlighting before stepping.
- Three steps with fetched bytes `3A 03 00`, `C6 01`, and `32 04 00`, and
  next addresses `0103`, `0105`, and `0108`.
- A single current marker, last-step shading independent of the next marker,
  and no extra fetched byte for the load's data access.
- Final result and carry, disabled completion, restart, invalid drafts and
  recovery, and edits between instructions without changing their fetch record.
- The 255 + 1 case following the same PC path as the default 41 + 1 case.
- Keyboard progression, narrow layouts, navigation, and both preceding
  register lessons after their shared controller/template changes.

Without JavaScript, the explanations remain readable and execution controls
remain disabled; the dynamic program view prompts the learner to enable it.
