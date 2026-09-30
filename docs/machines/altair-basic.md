# Altair 8800 with BASIC

The current historical-machine target is a usable Altair with BASIC, before
the 8080/6502 comparison and later move toward the Apple II. Other historical
machines may come between them.

The [executable machine chapter](../../src/machines/8080/altair-basic.md) owns
the selected hardware, bus responses, serial and panel connections, bootstrap,
media identity, loading procedure, reset contract, and implemented acceptance
checks. It generates the factory used by the tests. The headless machine now
loads the original 4K BASIC 3.2 tape through both historical loaders, discovers
its RAM limit, reaches OK, and evaluates direct arithmetic. The browser machine
and wider console transcript remain to be completed.

## Executable descriptions

Hardware-specific behavior belongs in readable executable chapters. The
[MC6850 polling profile](../../src/components/devices/specifications/mc6850-polling.md)
and [sense switches](../../src/components/devices/specifications/altair-sense-switches.md)
use the shared state/effect language. The machine chapter owns composition.
The [machine](definitions.md#literate-machine-chapters) and
[device](../devices/literate-specifications.md) guides explain those boundaries.

Browser code owns keyboard events, tape selection and delivery, drawing, and
execution scheduling. Host buffering remains distinct from a device's receive
register. Publish the executable machine chapter as the machine guide rather
than maintaining a separate description of the same configuration.

## Work required

1. **Broader headless acceptance.** Extend the real-tape transcript to cover
   numbered lines, LIST, replacement/deletion, and a RUN containing a loop,
   numeric INPUT, and a subroutine. Check line editing and Control-C separately
   from host STOP/resume. Preserve the external-media identity check.
2. **A usable browser machine.** Support tape selection, ordinary typing,
   carriage return, terminal control behavior, and responsive continuous
   execution. Batch instructions between display updates while retaining
   bounded traces, STOP/resume, and side-effect-free inspection. Remove the
   teaching lesson's restrictions to known program bytes and addresses.
3. **Integration and presentation.** Connect panel examination/deposit and
   reset/reload controls to this same generated machine, publish its chapter,
   and repeat the acceptance transcript interactively.

## Completion criteria

The first milestone is this declared configuration operating both headlessly
and in the browser: authentic loading, the wider BASIC transcript above,
responsive execution controls, and documented reset/reload effects. Tests must
use independent expected results, not only generated descriptions of generated
behavior. Importing a prepared RAM snapshot does not prove loading works.

Cycle-level panel signals, electrical serial timing, disk/cassette peripherals,
and other BASIC versions are later extensions unless the selected software
requires them. Keep each device's timing assumptions explicit when using it to
explain hardware operation.
