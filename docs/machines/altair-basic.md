# Altair 8800 with BASIC

The current historical-machine target is a usable Altair with BASIC, before
the 8080/6502 comparison and later move toward the Apple II. Other historical
machines may come between them.

The [executable machine chapter](../../src/machines/8080/altair-basic.md) owns
the selected hardware, bus responses, serial and panel connections, bootstrap,
media identity, loading procedure, reset contract, and implemented acceptance
checks. It generates the factory used by the tests. The headless machine now
loads the original 4K BASIC 3.2 tape through both historical loaders, discovers
its RAM limit, and runs a checked BASIC editing/program transcript. A shared
[serial session](../runtime/serial-session.md) now supplies transport and execution
controls for both headless acceptance and the browser terminal. The site
publishes the same executable chapter beside the working machine.

## Executable descriptions

Hardware-specific behavior belongs in readable executable chapters. The
[MC6850 polling profile](../../src/components/devices/specifications/mc6850-polling.md)
and [sense switches](../../src/components/devices/specifications/altair-sense-switches.md)
use the shared state/effect language. The machine chapter owns composition.
The [machine](definitions.md#literate-machine-chapters) and
[device](../devices/literate-specifications.md) guides explain those boundaries.

Browser code owns keyboard events, tape selection and delivery, drawing, and
execution scheduling. Host buffering remains distinct from a device's receive
register. The executable machine chapter is also the published machine guide.

## Work required

Connect panel examination/deposit and fuller sense-switch controls to this
same generated machine. Preserve live RAM and CPU state across panel actions,
without the teaching lessons' restrictions to known bytes or instruction starts.
Review the complete loading/program workflow with the integrated panel.

## Completion criteria

The first milestone is this declared configuration operating both headlessly
and in the browser: authentic loading, the chapter's BASIC acceptance transcript,
responsive execution controls, and documented reset/reload effects. Tests must
use independent expected results, not only generated descriptions of generated
behavior. Importing a prepared RAM snapshot does not prove loading works.

Cycle-level panel signals, electrical serial timing, disk/cassette peripherals,
and other BASIC versions are later extensions unless the selected software
requires them. Keep each device's timing assumptions explicit when using it to
explain hardware operation.
