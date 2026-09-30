# Altair lesson: waiting for a byte

This follows [receiving a byte](altair-input.md). The program now checks
readiness itself, echoes each arriving byte, and returns to check again.
Waiting means executing a polling loop; it is not a stopped or halted CPU.

[Lesson](../../site/templates/altair-polling.html) ·
[Executable machine chapter](../../src/machines/8080/altair-polling-lesson.md) ·
[Session](../../site/interactive/altair-program.ts) ·
[Machine tests](../../tests/machines/8080/altair-polling-lesson.test.ts) ·
[Session tests](../../tests/site/altair-program.test.ts) ·
[Pacing tests](../../tests/site/execution-controller.test.ts)

## Machine and program

The [executable chapter](../../src/machines/8080/altair-polling-lesson.md) owns the
components, initial state, connections, program, reset behavior, and machine
acceptance criteria. The generator reads its `machine` fences to build the same
factory used by this lesson and its tests.

## Interaction and ownership

Reuse the previous lesson's [input ownership](altair-input.md#interaction-and-ownership)
and [paced controls](altair-running.md#controls-and-state), with two differences:
there is no empty-input guard and no end-of-program stop. The program bytes
and instruction starts are still checked. EXAMINE 0107 deliberately bypasses
the readiness check; an empty data read really returns zero and can be echoed.

The view adds a live readiness readout from the device snapshot, not a port
read. This must remain distinct from A's last sampled answer and Z's last
comparison. Neither rendering nor execution guards consume data. Input switches
and Send remain usable during RUN; memory editing is locked. STOP preserves
all machine state. Input offered while stopped never resumes execution.
History retains the last twelve records while its total continues increasing.

Input arriving after a zero status read cannot change that captured result.
The comparison and branch still use zero, and the next trip detects the byte.
Another byte can also arrive after a data read and before OUT without replacing
the value already in A. All instruction descriptions use their captured records.

Restart cancels pending execution before replacing the machine, clears history
and output counts, empties devices, resets input switches to 42 and memory-panel
switches to zero, and stays stopped at 0100. Pace and guide preferences survive.
Callbacks from the previous run remain harmless even after a new RUN.

## Acceptance

The chapter defines machine-level acceptance. The lesson additionally checks:

- Empty polling keeps running without growing visible history past 12 records.
- Input arriving between status, comparison, and branch waits safely for the
  next trip. Input arriving between data read and echo remains pending.
- Repeated equal data counts as separate output writes; subsequent empty loops
  leave the lamp byte and count alone. Descriptions remain true after arrivals.
- Invalid code or PC blocks execution without consuming input; valid direct
  entry at the data read performs an empty read rather than a teaching pause.
- STOP and restart before status, data, and output leave no stale transfers.
  Fresh sessions preserve old sessions and captured records.

Browser checks cover empty RUN, keyboard Send, zero and repeated values,
sampled versus current readiness, STOP/restart, retained traces, narrow layouts,
and the earlier shared-panel lessons.
