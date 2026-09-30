# Machine definitions

Examples use the same [machine language](language.md) for the CPU model, all
initial state, addressed byte images, and an optional caller completion address.
Composed definitions also name RAM, ROM, and byte devices and declare their
memory, port, and reset connections. Component-only lessons can omit the CPU. The
[example catalog](../README.md#cpu-examples) links to specifications, each with
its source definition and tests.

Flat-RAM files explicitly declare their CPU's RAM size: 16 KiB for the 8008,
1 MiB for the 8088, 16 MiB for the 68000, and 64 KiB for the other current models. Unspecified memory
is zero; blocks load in source order, with later bytes overwriting earlier ones where they
overlap. Reset vectors are ordinary byte blocks. Initial state includes every
stored field for that CPU. The optional `end` declaration supplies a completion
address for the caller; it does not make the CPU stop there automatically.
Flat-RAM images use physical RAM addresses; named `image` blocks use local
component offsets. Completion compares `snapshot().pc`: a
physical address for the [8088](../../src/components/cpus/specifications/8088.md#logical-and-physical-addresses),
but the full 32-bit register for the [68000](../../src/components/cpus/specifications/68000.md#logical-and-physical-addresses).

## RAM and CPU ownership

The CPU owns its registers, flags, and any control latches. RAM owns the bytes.
Example setup owns allocation, program loading, and deterministic
initialization; these setup accesses do not appear in CPU execution records.
The CPU accesses memory through byte reads and writes and does not own example
restart. A machine may explicitly compose CPU and device resets.

The [memory API](../../src/components/memory/ram.ts) is `new Ram(size)`, with
a readonly `size` getter, `read(address)`, and `write(address, value)`.
Storage is private and initially zeroed. Size must be a positive safe integer;
addresses must be integers within the allocated memory, and byte values must
be integers from `00` through `FF`. Invalid arguments throw `RangeError`.
RAM rejects invalid host values instead of wrapping them to hardware widths.
The [RAM tests](../../tests/components/memory/ram.test.ts) check these bounds.

## Composed machines

The [68000 ROM-boot example](../cpus/68000/examples/rom-boot.md) names separate
ROM and RAM and connects them through a fixed map in its `.machine` definition.
The [memory-map contract](memory-map.md) defines region bounds, ownership, ROM
protection, and unmapped-access behavior.
The [Altair BASIC chapter](../../src/machines/8080/altair-basic.md) maps 4 KiB of
RAM into the 8080 address space and declares the response to unused memory and
ports. Its bootstrap and sense-switch wiring are part of the same executable source.

The [68000 ROM-output example](../cpus/68000/examples/output.md) also maps a
byte-output register and connects device reset to the CPU's RESET instruction.
The [8080 output example](../cpus/8080/examples/output.md) connects one output
port to the same device and declares a machine reset. Generated factories accept
named host callbacks and expose the concrete components and CPU connections.
Device behavior stays in the [device](../devices/byte-output.md). The
[serial example](../../src/machines/8080/altair-serial.md) connects the generated
MC6850 polling profile; its chapter supplies register capabilities and factory metadata.

The [8080 echo](../cpus/8080/examples/echo.md) and
[68000 echo](../cpus/68000/examples/echo.md) declare both input and output devices.
Their machine reset clears device latches as well as resetting the CPU;
CPU-only reset preserves the devices. Host input offers and output history
remain outside the machine definitions. The
[language reference](language.md#named-components-and-wiring) specifies the
supported connections and distinguishes machine reset from guest RESET.

## Directory organization

CPU machine definitions live under `src/machines/<cpu>/`, with matching tests
under `tests/machines/<cpu>/`. For example, `8080/stack-example.machine`
has a corresponding `8080/stack-example.test.ts`.

The parser entry point and RAM setup helper stay at the `machines/` root;
`machines/language/` contains token reading and composition validation. Their
tests live at the `tests/machines/` root. Additional subfolders can group examples
as needed; the build discovers definitions recursively. Folder names organize the files; each
definition's `cpu` declaration still selects its processor model.

## Literate machine chapters

A `.md` source can combine explanations and executable `machine` fences. The
[polling lesson](../../src/machines/8080/altair-polling-lesson.md) keeps its
components, CPU state, connections, program, and reset declarations alongside
the explanation and acceptance criteria. Its generated factory has the same
name and behavior as the former standalone definition.

Use unindented backtick or tilde fences with exactly `machine` as the language
tag. Their contents form one definition in document order, using the unchanged
[machine language](language.md). Prose and fence delimiters are blanked before
parsing, so diagnostics retain the Markdown filename, line, column, and code
text. Declarations can refer to earlier fences just as they can to earlier
lines in a standalone file.

Other fences, quoted or indented fences, and examples nested inside longer
fences are not executable. An unclosed executable fence is an error at its
opening line. Every `.md` file under `src/machines/` is a machine chapter and
must contain at least one executable fence; keep other documentation in `docs/`.
Put complete declarations in each fence so readers and editor highlighting
can follow them independently.

## Component-only lessons

A definition can contain named components and images without a CPU. The
[eight-byte memory lesson](../../src/machines/lessons/eight-byte-memory.machine)
needs only:

```text
components {
    ram = ram 08
}
```

Its generated `createLessonsEightByteMemory()` factory returns `{ ram }`, with a
fresh eight-byte `Ram` on every call. These definitions live under
`src/machines/lessons/`; CPU examples keep their processor directories.
Components own their state. The lesson owns its selected address, controls,
number representations, and prompts; those do not belong in the machine file.

## Generated factories

The [build script](../../scripts/generate-machines.ts) discovers `.machine` and
`.md` sources recursively under `src/machines/`,
excluding the generated output directory, and mirrors their relative paths under
`src/machines/generated/`. For example, `8080/stack-example.machine` generates
`generated/8080/stack-example.ts`, exporting `create8080StackExample()` and
`create8080StackExampleMemory()`. No per-example TypeScript wrapper or registration
entry is needed.

Use lowercase letters, digits, and single hyphens between words in both folder
and file names. Factory names combine the relative path segments and filename
words, capitalizing each part after `create`. Definitions in different folders
can share a filename because their generated modules preserve those folders.
Two definitions with the same path stem, such as `lesson.machine` and
`lesson.md`, are rejected before replacing any generated output.

The [parser](../../src/machines/machine-language.ts) checks syntax, complete CPU
state, numeric ranges, image bounds, and connection targets, reporting errors
with source locations.
It imports [stored-state descriptions](../cpus/implementation.md#stored-state-descriptions)
from the CPU modules, which also use them for constructor validation and
snapshot copying. The parser owns the text syntax and source diagnostics.
Flat-RAM code calls [defineRamExample](../../src/machines/ram-example.ts) with the
selected CPU and a numeric definition. Composed machines generate direct component
construction, image loading, port routing, and reset closures. TypeScript checks
each generated call against its actual constructor.
The example tests independently check full memory images, initial state, and
execution.

The helper accepts `ramSize`, defaulting to 64 KiB for direct TypeScript
callers. Generated factories always supply the parsed size.

Factories remain synchronous. Every call creates fresh components in their
declared initial state, without CPU reset, execution, or host notification;
the flat-RAM memory-only factory does not
construct a CPU. Return types retain the concrete CPU and component types and
include `endAddress` only when declared. Generated modules require no parser or
file access when imported or used.

A composed definition generates one factory, with no memory-only counterpart.
It returns every component under its declared name and `cpu` when declared, plus `memory` for
a map, `ports` for an explicit port block, and `reset` for a machine-reset list.
These connection objects can also be used when reconstructing a CPU from a
snapshot. If host controls replace `machine.cpu` with a restored CPU, the
generated `machine.reset()` follows that current CPU before resetting the
declared devices. Reuse the existing connections when restoring state.

Every component with an output callback requires a named binding in the factory argument.
A machine with no outputs takes no argument. For example:

```typescript
const bytes: number[] = [];
const machine = create8080EchoExample({ output: value => { bytes.push(value); } });
machine.reset();
machine.input.offer(0x41);
```

With multiple outputs, each callback is keyed by its component name. There are
no host expressions or callbacks inside a `.machine` file; host code supplies
functions and decides when to offer input, reset, or execute.

## Editing and building

Edit the `.machine` source or `.md` chapter and run `npm test`, `npm run build`, or
`npm run check:src`; each regenerates factories before type checking.
`npm run generate:machines` only regenerates them. It parses every definition
before replacing the generated directory and removes outputs for deleted or
renamed definitions, including obsolete subdirectories. Both
`src/machines/generated/` and compiled `dist/` output are ignored by Git and
removed by `npm run clean`.

After a clean or a change to chapter-owned contracts, run `npm run generate:cpus`
and `npm run generate:devices` first so the parser has current schemas and device
capabilities. The full build and checks
already run these stages in order.

The generator runs directly as TypeScript under Node.js 24. Its runtime import
path includes the parser, CPU descriptions, and shared helpers; importing these
modules performs no CPU construction or execution. The parser and CPU modules
use no external runtime dependencies or host APIs and pass the simulation's
check without Node or browser ambient types.
