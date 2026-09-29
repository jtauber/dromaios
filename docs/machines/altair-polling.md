# Altair lesson: waiting for a byte

This follows [receiving a byte](altair-input.md). The program now checks
readiness itself, echoes each arriving byte, and returns to check again.
Waiting means executing a polling loop; it is not a stopped or halted CPU.

[Lesson](../../site/templates/altair-polling.html) ·
[Machine](../../src/machines/8080/altair-polling-lesson.machine) ·
[Session](../../site/interactive/altair-program.ts) ·
[Machine tests](../../tests/machines/8080/altair-polling-lesson.test.ts) ·
[Session tests](../../tests/site/altair-program.test.ts) ·
[Pacing tests](../../tests/site/execution-controller.test.ts)

## Machine and program

The `.machine` source connects an 8080 and 64 KiB of RAM to the existing
[byte-input](../devices/byte-input.md) and
[byte-output](../devices/byte-output.md) teaching devices. Input port 0 reads
readiness (0 empty, 1 pending); input port 1 consumes data. Output port 1 writes
the separate lamp device. All other ports are unconnected. RAM address 1 is
independent of both devices.

PC starts at 0100; all other stored CPU state starts zero/clear. Both devices
are empty. RAM is zero outside these fourteen bytes. There is no `end` boundary
or halt instruction. Machine reset resets the CPU and devices, preserving RAM;
lesson restart constructs a fresh machine.

| PC (hex) | Bytes (hex) | Instruction | Effect |
| --- | --- | --- | --- |
| 0100 | DB 00 | IN 00H | Read readiness into A without consuming data or changing flags. |
| 0102 | FE 00 | CPI 0 | Compare A with zero, changing flags and preserving A. |
| 0104 | CA 00 01 | JZ 0100H | If Z = 1, return to the readiness check; otherwise continue at 0107. |
| 0107 | DB 01 | IN 01H | Consume the pending byte into A, preserving flags. |
| 0109 | D3 01 | OUT 01H | Echo A to the lamp device. |
| 010B | C3 00 01 | JMP 0100H | Return to checking readiness. |

No instruction writes RAM. An empty trip executes three instructions and no
output transfer. A ready trip executes six and outputs exactly one byte.
After receiving zero, Z remains clear from comparing readiness 1 with zero;
IN does not recalculate it. A later status read replaces A while output retains
its last byte.

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

- Initial state, every RAM byte, and all port connections match the source.
- Empty polling repeats IN/CPI/JZ with captured fetches and status reads in
  order. It keeps running and emits no output, without growing history past 12.
- Each possible data byte, including zero, produces readiness 1, survives
  status reads, passes through an actual data read and output transfer, and
  returns PC to 0100. Flags, PC, and untouched RAM are checked independently.
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
