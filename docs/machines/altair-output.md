# Altair lesson: sending a byte out

This follows [letting the computer run](altair-running.md). It reuses the load
and addition from the earlier lessons, replacing the memory store with OUT.
The learner watches three separate states: A, RAM, and a device's stored byte.
The eight-lamp device is a teaching illustration, not a particular historical
Altair peripheral or part of the original front panel.

[Lesson](../../site/templates/altair-output.html) ·
[Machine](../../src/machines/8080/altair-output-lesson.machine) ·
[Session](../../site/interactive/altair-program.ts) ·
[Device view](../../site/interactive/byte-output-view.ts) ·
[Machine tests](../../tests/machines/8080/altair-output-lesson.test.ts) ·
[Session tests](../../tests/site/altair-program.test.ts) ·
[Pacing tests](../../tests/site/execution-controller.test.ts)

## Machine and program

The machine has an 8080, 64 KiB of RAM, and a
[byte output](../devices/byte-output.md) connected to output port 01. All other
output ports and every input port are unconnected. The `.machine` definition
owns the initial state, program image, wiring, completion address, and composed
reset. Device latching, notification, and failure semantics follow the linked
device contract.

Initially A and the remaining data registers, SP, flags, and control latches
are zero/clear, while PC is 0100. RAM[3] holds 41 decimal; the seven program
bytes are loaded at 0100. All other RAM, including RAM[1], is zero. The device
has received no byte (`lastByte: null`), and the host's write count is zero.
Construction sends nothing.

| PC (hex) | Bytes (hex) | Instruction | Result |
| --- | --- | --- | --- |
| 0100 | 3A 03 00 | LDA 0003H | A = 41; device remains empty. |
| 0103 | C6 01 | ADI 1 | A = 42; device remains empty. |
| 0105 | D3 01 | OUT 01H | Device stores 42; A, flags, and RAM stay unchanged. |

The caller stops at 0107; no halt instruction runs. OUT fetches D3 and 01
from memory, then records one output transfer to port 1 with value 42. RAM
address 1 is a separate destination and remains zero. Only PC advances in the
CPU's stored state during OUT.

## Interaction and ownership

The session uses the same PC-backed memory panel and guarded execution as
[manual program entry](altair-program.md). All seven program bytes are fixed
and checked before stepping; source data can be edited. Known instruction
starts are 0100, 0103, and 0105. RUN, STOP, history retention, page visibility,
keyboard focus, and error handling follow the
[paced-execution contract](altair-running.md#controls-and-state).

EXAMINE and both NEXT operations reconstruct the CPU with its snapshot and
**the same port connection**. They preserve the device and its host callback;
no output is replayed. DEPOSIT changes RAM without invoking a port. The lamp
view reads the device's detached snapshot and never reads a port or derives
its value from A. The host callback counts actual writes, including repeated
values. Instruction descriptions and traces retain the executed records, so
later RAM edits and sends do not change earlier explanations.

An empty device shows “No byte sent yet” with dashes in its dark lamps. A
transmitted zero shows eight zero bits, a zero readout, and an increased write
count. Rendering, switch changes, STOP, and snapshot reads emit no output.
The device status is announced while stopped, with live announcements turned
off during continuous running, matching the instruction status.

Restart cancels pending execution before creating fresh CPU, RAM, panel, and
device state. It restores source 41, PC 0100, and the original program; clears
instruction history and both counts; and remains stopped. Pace and guide
preferences are preserved. This is lesson restart, not a CPU or hardware reset.
The machine's separately declared reset clears the CPU and device according to
their contracts, preserving RAM; the browser restart does not call it.

## Acceptance

- Three steps send 42 once, yielding the lamp pattern 00101010, PC 0107,
  A = 42, and RAM[1] = 0. All RAM is unchanged by execution.
- After that send, DEPOSIT 99 at address 3 and EXAMINE 0100. The load and
  addition produce A = 99 then 100 while the device still holds 42. OUT changes
  it to 100. Another OUT of 100 increases the count without changing the lamps.
- Editing RAM[1] leaves the device unchanged; OUT leaves the edited RAM[1]
  unchanged. EXAMINE and NEXT retain the port connection and device state.
- Source 255 produces A = 0 and carry set, then sends a real zero. Restart
  returns to the distinct empty-device state without altering the old session.
- Invalid program bytes, invalid instruction starts, and the endpoint block
  execution without emitting output.
- STOP before OUT sends nothing; resuming sends once. A cancelled callback
  stays harmless after a new RUN or restart, for both old and new devices.
- The trace preserves fetch order and labels the port transfer separately from
  RAM accesses. Repeated snapshot reads or panel edits do not rewrite it.

Browser checks cover the three-step sequence, changed source data, repeated
sends, zero, RAM/port separation, restart while running, keyboard operation,
narrow screens, and the earlier shared panel modes. Site builds check links at
both the domain root and a project path prefix.
