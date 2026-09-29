# Altair lesson: receiving a byte

This follows [sending a byte out](altair-output.md), introducing one instruction:
IN. The learner prepares a byte, offers it to an input device, receives it into
A, and echoes it to the existing lamp device. The input switches, pending input,
A, and output latch are separate states. Both peripherals are teaching devices,
not particular historical Altair boards or parts of its front panel.

[Lesson](../../site/templates/altair-input.html) ·
[Machine](../../src/machines/8080/altair-input-lesson.machine) ·
[Session](../../site/interactive/altair-program.ts) ·
[Input view](../../site/interactive/byte-input-view.ts) ·
[Machine tests](../../tests/machines/8080/altair-input-lesson.test.ts) ·
[Session tests](../../tests/site/altair-program.test.ts) ·
[Pacing tests](../../tests/site/execution-controller.test.ts)

## Machine and program

The `.machine` source defines an 8080, 64 KiB of RAM, and separate
[byte-input](../devices/byte-input.md) and
[byte-output](../devices/byte-output.md) devices. Input port 01 connects to the
input device's data register; output port 01 connects to the output latch.
All other ports are unconnected, including the input status register, which
this program does not use. RAM address 1 is independent of both connections.

PC starts at 0100. A, the remaining data registers, SP, flags, and control
latches start zero/clear. Both devices are empty. RAM is zero outside the four
program bytes. The view prepares 42 on its input switches without offering it.

| PC (hex) | Bytes (hex) | Instruction | Effect |
| --- | --- | --- | --- |
| 0100 | DB 01 | IN 01H | Consume the pending byte into A; the input device becomes empty. |
| 0102 | D3 01 | OUT 01H | Send A to the lamp device, preserving A. |

Each instruction fetches its two bytes from RAM, then records one port
transfer. Both preserve flags and RAM. The caller stops at 0104 without
executing HLT. The machine reset list resets the CPU and both devices,
preserving RAM; CPU-only reset leaves devices alone. Lesson restart creates a
fresh machine instead of invoking either reset.

## Interaction and ownership

The input view owns its prepared eight-bit value. Moving a switch changes
only that value. Send calls `ByteInput.offer`; the device owns pending input.
A full device rejects any further offer without replacing its byte, including
an identical offer. The view disables Send while full but leaves the switches
available to prepare the next byte. Reading a snapshot, rendering, and checking
readiness consume no input. A successful Send focuses the device status because
the sending button becomes disabled.

IN consumes the pending byte once and updates A; it changes neither prepared
switches nor output. Send becomes available immediately. A second byte may be
offered before OUT and remains pending while OUT sends the earlier value in A.
The device's snapshots, rather than A or the latest transfer record, supply its
current readout. Captured instruction descriptions and traces remain unchanged
when later input arrives. Pending zero is shown as a waiting byte, distinct from
the empty state; output zero uses the existing output view's zero display.

All four program bytes are fixed and checked before each instruction, and PC
must be at 0100 or 0102. In addition, **this lesson pauses before IN when the
input device is empty**. This is a caller guard: it performs no CPU step, fetch,
port read, latch change, or history update. The UI and prose say that the raw
device would return zero on an empty read. The guard is not modeled CPU waiting,
polling, or a halt. Offering input enables the controls but never resumes or
starts execution automatically. The learner must request RUN or STEP.

The shared [paced-execution contract](altair-running.md#controls-and-state)
governs RUN, STOP, cancellation, memory editing locks, and history. Input switches
and Send remain usable during execution because host input is independent of
CPU progress. Status updates remain visible but suppress live announcements
while running. Panel PC changes retain the same port connections and both
devices. EXAMINE 0100 permits another pair of instructions without clearing
pending input or output. DEPOSIT writes RAM without affecting either device.

Restart first cancels queued work, then restores the original machine, lowers
the memory-panel switches, prepares 42 on the input switches, clears history and
counts, and stays stopped. It preserves pace and number-guide preferences. Old
callbacks must neither consume input from the new session nor emit old output.

## Acceptance

- Construction and switch changes send nothing. Offering 42 leaves A and RAM
  unchanged; a second offer is rejected while it waits.
- With no input, RUN and STEP perform no work. Offering zero enables a real IN
  which consumes it; a subsequent OUT sends zero and increments the write count.
- Every byte from 00 through FF passes through actual IN and OUT records in
  fetch/transfer order, with the expected PC, flags, and unchanged RAM.
- After receiving 42, offering 99 leaves A = 42. OUT sends 42 and leaves 99
  pending. EXAMINE 0100 and a second pair receive and echo 99.
- RAM[1] edits do not affect input or output. EXAMINE and both NEXT operations
  preserve pending input and the connected devices. Invalid code and PC block
  execution without consuming input.
- STOP before IN retains pending input; STOP before OUT retains A and empty
  output. Resume completes the same transfers once. Restart before either
  instruction invalidates queued callbacks, including after a new RUN.
- Fresh sessions restore empty devices and do not modify old pending input,
  output, or captured records. Raw machine tests separately demonstrate that an
  unguarded empty IN returns zero instead of waiting.

Browser checks cover keyboard switch entry and Send, pending versus prepared
values, full-device rejection, two arrivals around IN/OUT, zero, pacing and
restart, trace retention, narrow layouts, and the shared earlier lessons.
