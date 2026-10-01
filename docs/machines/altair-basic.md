# Altair 8800 with BASIC

The first historical-machine milestone is complete: a usable Altair with BASIC
at the declared modeling fidelity. Its introductory programming path is also
complete. The next machine target is the [Apple II Plus](apple2.md).

The [executable machine chapter](../../src/machines/8080/altair-basic.md) owns
the selected hardware, bus responses, serial and panel connections, bootstrap,
media identity, loading procedure, reset contract, and implemented acceptance
checks. It generates the factory used by the tests. The headless machine now
loads the original 4K BASIC 3.2 tape through both historical loaders, discovers
its RAM limit, and runs a checked BASIC editing/program transcript. A shared
[serial session](../runtime/serial-session.md) now supplies transport and execution
controls for both headless acceptance and the browser terminal. The site
publishes the same executable chapter beside the working machine, with memory
controls and live sense switches connected to its CPU and declared memory map.

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

## Review point

The integrated loading/program workflow has been exercised in the browser,
including editing, execution, the Break button, memory inspection, reset, and
reload. Keyboard Control-C still needs manual browser confirmation; its mapping
and serial byte are covered separately by automated tests. The chapter owns its PC effects, memory boundary,
switch sharing, and reset/reload contract; the introductory lessons continue to
use their deliberately simplified teaching devices.

## Completion criteria

The completed first milestone is this declared configuration operating both headlessly
and in the browser: authentic loading, the chapter's BASIC acceptance transcript,
responsive execution controls, and documented reset/reload effects. Tests must
use independent expected results, not only generated descriptions of generated
behavior. Importing a prepared RAM snapshot does not prove loading works.

Cycle-level panel signals, electrical serial timing, disk/cassette peripherals,
and other BASIC versions are later extensions unless the selected software
requires them. Keep each device's timing assumptions explicit when using it to
explain hardware operation.
