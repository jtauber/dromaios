# Machine definitions

The flat-RAM examples use the same [machine language](language.md) and setup
code. Their `.machine` files supply the CPU model, all initial state, addressed
byte images, and an optional caller completion address. The
[example catalog](../README.md#cpu-examples) links to specifications, each with
its source definition and tests.

Each file explicitly declares its CPU's RAM size: 16 KiB for the 8008,
1 MiB for the 8088, 16 MiB for the 68000, and 64 KiB for the other current models. Unspecified memory
is zero; blocks load in source order, with later bytes overwriting earlier ones where they
overlap. Reset vectors are ordinary byte blocks. Initial state includes every
stored field for that CPU. The optional `end` declaration supplies a completion
address for the caller; it does not make the CPU stop there automatically.
Memory images use physical RAM addresses. Completion compares `snapshot().pc`: a
physical address for the [8088](../cpus/8088/model.md#logical-and-physical-addresses),
but the full 32-bit register for the [68000](../cpus/68000/model.md#logical-and-physical-addresses).

## RAM and CPU ownership

The CPU owns its registers, flags, and any control latches. RAM owns the bytes.
Example setup owns allocation, program loading, and deterministic
initialization; these setup accesses do not appear in CPU execution records.
The CPU accesses RAM through byte reads and writes and does not own example
restart.

The [memory API](../../src/components/memory/ram.ts) is `new Ram(size)`, with
a readonly `size` getter, `read(address)`, and `write(address, value)`.
Storage is private and initially zeroed. Size must be a positive safe integer;
addresses must be integers within the allocated memory, and byte values must
be integers from `00` through `FF`. Invalid arguments throw `RangeError`.
RAM rejects invalid host values instead of wrapping them to hardware widths.
The [RAM tests](../../tests/components/memory/ram.test.ts) check these bounds.

## Mapped compositions

The [68000 ROM-boot example](../cpus/68000/examples/rom-boot.md) uses ordinary
TypeScript to connect separate ROM and RAM through a fixed memory map. Its
factory exposes those components without resetting or executing the CPU.
It is not generated from a flat-RAM definition. The
[memory-map contract](memory-map.md) defines region bounds, ownership, ROM
protection, and unmapped-access behavior. More elaborate machine syntax can
follow when concrete compositions establish what it needs to express.

The [68000 ROM-output example](../cpus/68000/examples/output.md) also maps a
byte-output register. Its factory takes the host output callback and wires
device reset to the CPU's RESET connection; component behavior stays in the
[device](../devices/byte-output.md).

## Compositions with ports

The [8080 output example](../cpus/8080/examples/output.md) uses TypeScript to
load flat RAM and connect one output port to the same byte-output device.
Its factory accepts the host callback and exposes the port connection for
CPU reconstruction. Its explicit machine reset resets the CPU and clears
the device latch while retaining RAM and the host's transcript. Device
connections and reset wiring remain ordinary composition code.

## Directory organization

Machine definitions live under `src/machines/<cpu>/`, with matching tests
under `tests/machines/<cpu>/`. For example, `8080/stack-example.machine`
has a corresponding `8080/stack-example.test.ts`.

The shared parser and RAM setup helper, and their tests, stay at the respective
`machines/` roots. Additional subfolders can group examples as needed; the build
discovers definitions recursively. Folder names organize the files; each
definition's `cpu` declaration still selects its processor model.

## Generated factories

The [build script](../../scripts/generate-machines.ts) discovers `src/machines/**/*.machine`,
excluding the generated output directory, and mirrors their relative paths under
`src/machines/generated/`. For example, `8080/stack-example.machine` generates
`generated/8080/stack-example.ts`, exporting `create8080StackExample()` and
`create8080StackExampleMemory()`. No per-example TypeScript wrapper or registration
entry is needed.

Use lowercase letters, digits, and single hyphens between words in both folder
and file names. Factory names combine the relative path segments and filename
words, capitalizing each part after `create`. Definitions in different folders
can share a filename because their generated modules preserve those folders.

The [parser](../../src/machines/machine-language.ts) checks syntax, complete CPU
state, numeric ranges, and memory bounds, reporting errors with source locations.
It imports [stored-state descriptions](../cpus/implementation.md#stored-state-descriptions)
from the CPU modules, which also use them for constructor validation and
snapshot copying. The parser owns the text syntax and source diagnostics.
The generated code calls [defineRamExample](../../src/machines/ram-example.ts)
with the selected CPU and a numeric definition; TypeScript also checks each
generated call against the actual constructor.
The example tests independently check full memory images, initial state, and
execution.

The helper accepts `ramSize`, defaulting to 64 KiB for direct TypeScript
callers. Generated factories always supply the parsed size.

Factories remain synchronous. Every call creates fresh RAM and CPU components
without reset or execution; the memory-only factory does not construct a CPU.
Factory return types retain the concrete CPU type and include `endAddress` only
when the definition supplies it. Generated modules require no parser or file
access when imported or used.

## Editing and building

Edit the `.machine` source and run `npm test`, `npm run build`, or
`npm run check:src`; each regenerates factories before type checking.
`npm run generate:machines` only regenerates them. It parses every definition
before replacing the generated directory and removes outputs for deleted or
renamed definitions, including obsolete subdirectories. Both
`src/machines/generated/` and compiled `dist/` output are ignored by Git and
removed by `npm run clean`.

The generator runs directly as TypeScript under Node.js 24. Its runtime import
path includes the parser, CPU descriptions, and shared helpers; importing these
modules performs no CPU construction or execution. The parser and CPU modules
use no external runtime dependencies or host APIs and pass the simulation's
check without Node or browser ambient types.
