# Altair lesson: a different reply

This follows [Typing to the computer](terminal-lesson.md). The input device,
output device, terminal views, and host interaction follow that contract.
The new program replaces lowercase a with uppercase A and echoes every other
byte unchanged. The CPU performs the comparison, branch, and replacement;
neither the character input nor the display transforms the reply.

[Machine definition](../../src/machines/8080/altair-reply-lesson.machine) ·
[Machine tests](../../tests/machines/8080/altair-reply-lesson.test.ts) ·
[Lesson](../../site/templates/a-different-reply.html) ·
[Program descriptions](../../site/interactive/altair-program.ts) ·
[Session tests](../../tests/site/reply-lesson.test.ts) ·
[Pacing tests](../../tests/site/execution-controller.test.ts)

## Machine and program

The composition and initial stored state match the
[polling lesson](altair-polling.md#machine-and-program): an 8080 at PC `0100`,
64 KiB of RAM, input readiness at port 0, input data at port 1, and output at
port 1. Both devices start empty; there is no completion address. RAM is zero
outside the following twenty-one bytes. Addresses and bytes in this table
are hexadecimal.

| Address | Bytes | Instruction | Purpose |
| --- | --- | --- | --- |
| 0100 | DB 00 | IN 00H | Sample readiness into A without consuming input. |
| 0102 | FE 00 | CPI 00H | Compare readiness with zero. |
| 0104 | CA 00 01 | JZ 0100H | Repeat while the device is empty. |
| 0107 | DB 01 | IN 01H | Receive the pending byte into A. |
| 0109 | FE 61 | CPI 61H | Compare A with lowercase a, 97 decimal. |
| 010B | C2 10 01 | JNZ 0110H | Skip replacement when the byte differs. |
| 010E | 3E 41 | MVI A,41H | Replace A with uppercase A, 65 decimal. |
| 0110 | D3 01 | OUT 01H | Send the selected reply. |
| 0112 | C3 00 01 | JMP 0100H | Return to checking readiness. |

The empty path remains `0100 → 0102 → 0104 → 0100` without any output.
Starting at `0100` with lowercase a ready, four instructions receive 97,
the fifth compares it, the sixth declines the jump, the seventh loads 65,
and the eighth sends it. The ninth returns to `0100`.
Every other byte takes the forward jump, reaches OUT in seven instructions,
and returns in eight. This includes zero, space, LF, and bytes outside ASCII;
only the host character field restricts which bytes a learner can offer there.

CPI preserves A and sets the comparison flags. For 97 versus 97, Z is 1;
for every other byte versus 97, Z is 0. JNZ, MVI, OUT, and JMP preserve
those flags. MVI changes only A, and OUT produces the sole device write.
Neither path writes RAM. A later input offer cannot affect the byte already
in A or its comparison. Subsequent readiness checks replace A and flags,
so the captured records retain the earlier decision for inspection.

## Interaction and acceptance

The shared terminal session selects the `reply` program. The field initially
prepares lowercase a, and restart restores that draft along with a fresh
machine, empty devices and output, cleared counts/history, and stopped PC
`0100`. Pace and guide preferences survive. As with the other lessons, this
restart reconstructs the example; machine reset follows the CPU's hardware
reset contract and does not reload RAM or clear host history.

The lesson checks all twenty-one program bytes before execution and permits
stepping only at the nine instruction starts listed above. Panel edits and
EXAMINE remain available while stopped; they preserve captured explanations
and produce no output. Manually selecting a later instruction can bypass the
earlier checks in the guest program. The fixed-image guard is a teaching aid,
not a general validator of arbitrary 8080 programs.

- Check the complete image and initial state independently of the factory.
- Check exact before/after states and ordered accesses for empty polling,
  matching a, and nonmatching b. Only the matching path fetches MVI's bytes.
- Exercise all 256 input bytes; only 97 becomes 65, with one output per trip
  and no RAM writes. Verify device reset clears latches without notifying output.
- Keep a second byte pending through comparison, replacement, and OUT. It
  must not affect the first reply.
- Check both branch explanations, including the forward jump and the MVI
  description retained after editing its operand in RAM.
- Verify repeated characters, spaces, and LF through the shared output view;
  idle polling and snapshots must not append text.
- Corrupt each program byte and select operand addresses: the guard must
  refuse execution without changing CPU state or output.
- STOP after either comparison result and resume the same choice. Restart
  before comparison, branch, replacement, or OUT must invalidate queued work
  for both the old and new session.

Browser checks follow a and b one instruction at a time, distinguish the two
questions answered by Z, send a second byte before the first reply, run
“a cat” to produce “A cAt”, restart with an invalid draft, and check the
reference card, captured trace, keyboard controls, narrow layout, and earlier
echo lesson.
