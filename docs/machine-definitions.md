# Machine definitions

The examples use the same [machine language](machine-language.md) and setup
code. Their `.machine` files supply the CPU model, all initial state, addressed
byte images, and an optional caller completion address:

- [8080 arithmetic](../src/machines/8080-example.machine)
- [8080 register pairs](../src/machines/8080-register-pairs-example.machine)
- [8080 stack](../src/machines/8080-stack-example.machine)
- [6502 arithmetic](../src/machines/6502-example.machine)
- [6502 stack](../src/machines/6502-stack-example.machine)
- [6809 arithmetic](../src/machines/6809-example.machine)

Each file explicitly declares 64 KiB RAM. Unspecified memory is zero; blocks
load in source order, with later bytes overwriting earlier ones where they
overlap. Reset vectors are ordinary byte blocks. Initial state includes every
stored field for that CPU. The optional `end` declaration supplies a completion
address for the caller; it does not make the CPU stop there automatically.

## Generated factories

The [build script](../scripts/generate-machines.ts) discovers `src/machines/*.machine`
and generates one TypeScript module per definition under `src/machines/generated/`.
Use lowercase letters, digits, and single hyphens between filename segments.
For example, `8080-stack-example.machine` generates `8080-stack-example.ts` with
exports `create8080StackExample()` and `create8080StackExampleMemory()`.
No per-example TypeScript wrapper or registration entry is needed.

The [parser](../src/machines/machine-language.ts) checks syntax, complete CPU
state, numeric ranges, and memory bounds, reporting errors with source locations.
Its field schemas are checked against the CPU state interfaces. The generated
code calls [defineRamExample](../src/machines/ram-example.ts) with the selected
CPU and a numeric definition; TypeScript also checks each generated call against
the actual constructor. CPU constructors retain their own state validation.
The example tests independently check full memory images, initial state, and
execution.

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
renamed definitions. Both `src/machines/generated/` and compiled `dist/` output
are ignored by Git and removed by `npm run clean`.

The generator runs directly as TypeScript under Node.js 24. The parser is pure
TypeScript with no runtime dependencies or host APIs; it also passes the
simulation's check without Node or browser ambient types.
