# Literate device specifications

Device chapters under `src/components/devices/specifications/` combine hardware
explanations, modeled limitations, and executable `device` fences. The
[MC6850 polling profile](../../src/components/devices/specifications/mc6850-polling.md)
is the first example. Its generated public class, state schema, effects, and
machine-wiring metadata all come from that chapter.

## Language

Fence extraction follows the [machine chapter rules](../machines/definitions.md#literate-machine-chapters):
unindented fences, exact language tag, document order, and Markdown diagnostics.
Declarations do not cross fence boundaries; several complete declarations may
share a fence. The first declaration is `device "model-name"`. Model names use lowercase
letters, digits, and hyphens; RAM, ROM, and the existing teaching-device names
are reserved.

A `state` block declares uppercase registers with widths and Boolean latches.
It uses the [CPU state syntax](../cpus/literate-specifications.md#state-ownership),
currently limited to registers and latches. `source` and `action` declarations
reuse the CPU language's typed captures, expressions, and ordered state effects.
Sources return a typed value; actions have no result. Declare referenced sources
and actions before using them. Device behavior cannot fetch instructions, access
memory/ports, or invoke CPU execution boundaries.

The final `interface ClassName` block selects public operations:

| Binding | Required definition | Generated behavior |
| --- | --- | --- |
| `size n` | A decimal size from 1 to 256 | Local register address space; declare before register bindings. |
| `initialize action` | An action without inputs | Called on fresh construction after fields are zero/clear. |
| `reset action` | An action without inputs | Called by the device's `reset()` method. |
| `validate source` | A read-only flag source without inputs | Checks initialized or restored state; false rejects construction. |
| `view source` | A read-only source, with optional typed inputs | Public method with the source's name, input types, and result type. |
| `offer source` | A flag source with one eight-bit input | Optional host `offer(value)` operation; returns acceptance. |
| `read address source` | An eight-bit source without inputs | Read the selected local register. |
| `write address source` | A flag source with one eight-bit input | Write the register; false throws `RangeError`. |
| `read * source` | An eight-bit source with one eight-bit address input | Bind every local address, passing its offset. |
| `write * source` | A flag source with two eight-bit inputs: address, byte | Bind every local address; supports `notify` too. |
| `write address source notify` | As above | After acceptance, call the host output callback with the written byte. |

Initialization, reset, validation, and size are required. Register addresses
cannot repeat within a direction, including overlaps with `*`; read and write may select different behavior
at the same address. The chapter owns the effects of rejection; it must preserve
state when its contract promises that. Host values and addresses are validated
before any declared effect. Unbound addresses within the device return
`bus-error`; machine port validation rejects bindings to unimplemented directions.

Views may read fields and call other read-only sources, but cannot mutate state,
including through nested calls. Their names cannot replace built-in device
methods. Zero-input flag views also become named selectors for
[machine memory windows](../machines/language.md#memory-windows). Numeric views
and views requiring inputs cannot be routing conditions. Inputs are checked before evaluation: unsigned values must fit their
declared widths and flags must be Boolean. The
[Apple II video chapter](../../src/components/devices/specifications/apple2-video.md)
uses views for text addresses and character attributes, keeping hardware decoding
in the specification without exposing guest register reads to inspection.

Construction takes an output callback when any write binding uses `notify`,
followed by an optional snapshot. Other devices take only the optional snapshot.
Restoration copies and validates stored fields and calls the read-only validator;
it does not initialize or reset them. Snapshots are detached, readonly views.
Notification follows the declared effects. A throwing callback propagates without
undoing effects or retrying the notification. Host queues, clocks, and output
history are not implicit device state.

## Generation and validation

`npm run generate:devices` reads all chapters before replacing
`src/components/devices/generated/`. It emits state, effects, and public modules
plus a small catalogue containing class/module names, size, readable/writable
registers, zero-input flag selectors, and output-callback requirements. The machine language uses this
catalogue through `devices/models.ts`, alongside the two teaching devices.
Registering a generated device does not require handwritten constructor or
port-routing cases.

The parser and generator reuse the state/effect machinery currently under
`cpus/semantics/`; there is no device opcode table or CPU execution loop. This is
a bounded first extension of that language, not a separate host-code evaluator.
Additional device capabilities should follow concrete hardware requirements.

The normal build generates CPUs, then devices, then machines. Generated sources
are ignored and cleaned by the build. `npm test` checks the full pipeline,
including a chapter edit reaching the generated public API and failed generation
preserving previous output. Device tests supply independent expected register
results; machine tests exercise the CPU-to-device connections.
