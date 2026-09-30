# Serial sessions

[`SerialSession`](../../src/runtime/serial-session.ts) connects a generated
machine to host tape input, keyboard bytes, and captured output. The factory
owns the hardware; the session contains no CPU registers, port addresses,
bootstrap bytes, BASIC commands, or terminal character rules. It has no timers
or browser dependencies.

```ts
const session = new SerialSession(
  output => create8080AltairBasic({ serial: output }),
  tapeBytes,
);
session.machine.sense.offer(0x0c); // Operator selects the chapter's loading setup.
session.start();
const batch = session.run(1000);
const output = session.drainOutput();
```

The factory must return `cpu.step()`, `serial.offer(byte)`, and `reset()`.
Additional components remain available through the concretely typed `machine`
getter. Step and reset results retain the generated CPU's types and readonly
snapshots. Inspection uses those component snapshots; the session does not read
device registers to guess whether input is ready.

## Transport

Construction copies and validates the optional tape. `send(bytes)` appends copied
keyboard bytes, after validating the entire input. Invalid bytes, including
array holes, cannot partially change a queue. Values are integers from 0 to 255;
zero and high-bit bytes are preserved. Strings need explicit encoding by the
caller. Sending input produces no local echo.

Before each CPU step, the session offers at most one byte. Tape takes priority
over keyboard input. Rejected offers retain the byte for a later step; accepted
offers advance that queue exactly once. An accepted byte belongs to the device,
even if the following step throws. Software may consume or reset that receive
register; the host never replays the byte to compensate.

`tapePosition` counts accepted tape bytes, not guest reads. `tapeLength` is the
owned tape length. `pendingInput` counts keyboard bytes still with the host,
excluding an already accepted byte. An empty host queue therefore does not prove
that the device is empty or BASIC is ready for another command.

`drainOutput()` returns all raw output captured since the previous drain and
empties that capture. Equal consecutive bytes remain distinct. Seven-bit ASCII,
carriage returns, cursor movement, and display limits belong to the terminal
presentation. Callers should drain after each batch and bound their own display
history. The session does not retain already drained output or previous batches.

## Execution and lifecycle

| Operation | Effect |
| --- | --- |
| Construction | Fresh generated machine, copied tape, empty keyboard/output queues, stopped |
| `start()` | Permit subsequent batches; no instruction or input transfer yet |
| `run(maxSteps)` | If running, execute up to the nonnegative safe-integer budget; otherwise return `paused` with no effects |
| `stop()` | Prevent subsequent batches; preserve CPU, RAM, devices, queues, and output |
| `step()` | Execute one instruction and its input offer while stopped; remain stopped |
| `reset()` | Stop, call the existing machine's declared reset, then discard tape and keyboard queues; retain captured output |
| `reload(tape?)` | Construct a fresh stopped machine and transport; discard old queues/output, restore factory RAM/device state, copy the supplied tape |

A zero budget does not offer input or step. A completed batch returns original
CPU records and `step-limit`; the session remains running. A CPU outcome of
`halted`, `waiting`, or `unsupported` ends the batch and stops the session,
retaining that final record. Each result contains only the current batch,
bounded by the requested step count. There is no automatic prompt detector,
completion address, or emulated clock. A browser schedules batches and receives
STOP between them; the synchronous batch cannot process browser events midway.

All mutating operations reject reentry from guest/factory callbacks. A throwing
step stops the session and propagates the error, preserving committed hardware
effects, accepted input positions, and captured output. A failed reset leaves
host input intact and the session stopped; any completed machine effects remain.
A failed reload leaves the old machine and transport unchanged. Output callbacks
from retired machine references cannot contaminate the new capture.

Reset and reload are different operations: the machine chapter defines what
reset preserves. Reload invokes the factory, so operator-selected switches must
be set again. Omitted reload media means an empty tape; retaining a selected file
for another reload is the caller's responsibility. Neither operation downloads
or validates a specific software image; the [Altair chapter](../../src/machines/8080/altair-basic.md#media-and-host-delivery)
owns its tape identity and prerequisites.

[Session tests](../../tests/runtime/serial-session.test.ts) check transport,
pause/resume, lifecycle, validation, failure handling, and independent captures.
[Type checks](../../tests/types/serial-session.ts) preserve the concrete machine
API and CPU records. The [real-tape test](../../tests/machines/8080/altair-basic-tape.test.ts)
uses this same session for loading, editing and running BASIC programs, guest
Control-C, host STOP/resume, and a fresh reload.
