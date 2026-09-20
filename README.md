# Dromaios

An in-browser emulation platform for exploring how computers work.

The platform lives at [jtauber/dromaios](https://github.com/jtauber/dromaios).

Dromaios brings together the existing Altair, TRS-80 Color Computer, Game Boy,
Apple II, Macintosh, IBM PC, and microcomputer tutorial projects. Each machine
will be built primarily by configuring and connecting reusable components.
The eventual aim is for this platform to replace the separate emulators.

The intended machine scope also includes the BBC Micro. See
[CPU and machine scope](docs/cpus/scope.md#intended-eventual-scope) for the
full target list and selected software targets.

The purpose is primarily pedagogical. Users should be able to follow an
instruction, inspect registers and memory, understand a device, and explore how
the parts of a machine interact. Running software gives those explorations a
concrete setting.

An eventual goal is detailed software guides that connect program architecture
and line-by-line analysis to interactive demonstrations and live execution.
The [pedagogical roadmap](docs/pedagogy.md#pedagogical-roadmap) develops this
path from individual calculations to understanding substantial programs.

## The name

**emulator → emu → Dromaius → Greek δρομαῖος (dromaios)**

An emu pun with a Greek connection. Dromaius is the emu's genus; its name derives
from δρομαῖος, meaning swift-running.

## How we will build it

This is a fresh start, developed slowly in small, reviewable pieces. Design,
implementation, and explanation are part of the same work. Each change should
be small enough to understand before we build on it.

- **Compose machines from components.** Reuse CPU, memory, and device models
  where the hardware permits it, with explicit machine wiring and configuration.
- **Make execution observable.** State changes and interactions should support
  inspection and teaching from the beginning.
- **Keep hardware distinctions visible.** Shared conventions should preserve
  the differences between CPUs, devices, and machines.
- **Separate simulation from the browser interface.** The same models should
  support automated checks, interactive lessons, and a complete machine UI.
- **Develop abstractions through concrete examples.** Exercise shared CPU and
  inspection interfaces across distinct architectures. Use a rule of three to
  judge generalizations, including examples that expose hardware differences.
- **Explain the model's limits.** Teaching views should make clear what is
  simulated, simplified, or still missing.

## AI declaration

Dromaios is being agentically coded with close human review. AI agents help
write code, tests, and documentation; the human maintainer directs the design,
reviews changes, and makes the final decisions. Development proceeds in small
steps so that understanding the implementation remains central to the process.

Every commit waits for the maintainer's review and explicit go-ahead. Coding
agents follow this rule in [AGENTS.md](AGENTS.md).

## Status

The platform has instruction-level models with complete documented opcode coverage
for the 8008, 8080, 6800, 6502, Z80, 6809, 8088, and 68000. Small examples cover
CPU-and-RAM programs, ROM boot, mapped memory, and shared byte-input and
byte-output devices. They run through a shared CPU runner and are tested
independently of the browser. The [example catalog](docs/README.md#cpu-examples)
links to their specifications. A browser interface and complete historical
machines are still planned.

All eight documented instruction sets now use shared definitions that generate
execution and explanations. [CPU implementation coverage](docs/cpus/coverage.md)
tracks literate authoring, source footprint, supported features, and remaining
gaps, including timing. An executable [literate CPU chapter](docs/cpus/literate-specifications.md)
now feeds the same definition pipeline. The [roadmap](ROADMAP.md) describes the
development stages.

The implementation uses **TypeScript**, compiled to JavaScript ES modules,
with **Node.js 24 LTS** and its built-in test runner for development.

Each example has a deliberately small scope: a short program, the components
it needs, and a way to step through it and inspect what changes.

## Development

Use Node.js 24 and its bundled npm. With nvm, run `nvm install` and `nvm use`
from this directory; [.nvmrc](.nvmrc) selects the major version. Other Node
version managers work too. For a Homebrew `node@24` installation, select it
for the current shell with `export PATH="$(brew --prefix node@24)/bin:$PATH"`.

```sh
npm ci
npm test
```

`npm ci` installs the locked development dependencies. `npm test` cleans generated
code, generates instruction bodies from the [CPU definitions](docs/cpus/instruction-semantics.md)
and factories from the [machine definitions](docs/machines/definitions.md),
checks the simulation without Node or browser ambient types, compiles the source,
scripts, and tests, and runs the compiled tests.
`npm run build` performs the same checks and compilation without running tests.
`npm run check:src` regenerates both outputs and runs the simulation check
using [tsconfig.src.json](tsconfig.src.json), without emitting JavaScript.
`npm run generate:cpus` compiles literate chapters and refreshes generated state schemas and instruction bodies.
`npm run generate:machines` refreshes just the generated TypeScript factories.
Run CPU generation first after a clean or a change to chapter-owned state.

The tracked [expanded instruction listing](docs/cpus/semantic-examples.md) is
generated separately. After changing definitions or their descriptions, run
`node scripts/describe-cpu-semantics.ts` and review the resulting documentation.
Add `--check` to check freshness without writing; the full test suite also
checks this listing, but the build does not refresh it.

Optional [Zed language support](editors/zed/README.md) adds syntax highlighting
and bracket matching for `.machine` files. Its build and tests use a separate,
locked editor toolchain; the simulation workflow above stays independent.

For focused checks, select a CPU and optionally filter test names:

```sh
npm test -- z80
npm test -- 8008 --test-name-pattern=interrupt
npm run test:built -- z80 --test-name-pattern=interrupt
```

A CPU selection includes its component tests and machine examples, but omits
shared-helper and semantics tests. `test:built` skips the build; use it only
while the compiled output is current. With no CPU, name, or shard selection,
either command runs the whole suite, including shared helpers, semantics,
the parser, generators, and runner. Keep `npm test` as the final regression
check; focused runs retain the selected tests' exhaustive cases and assertions.

CPU tests can use topic files under `tests/components/cpus/<cpu>/`, as the Z80
does for arithmetic, transfers, control flow, prefixes, ports, and interrupts.
This lets Node run independent topics in separate processes. Shared fixtures
and independent expected-value calculations belong in `helpers.ts`, which
registers no tests. Smaller CPU suites can keep their existing single file.

Generated TypeScript, compiled output, and `node_modules/` are ignored by Git;
the generated instruction listing is tracked. There are no runtime dependencies;
machine parsing happens during the build. The simulation source uses no Node or
browser APIs.

The [GitHub Actions workflow](.github/workflows/ci.yml) runs `npm ci` and
`npm test` on pushes and pull requests, using the Node version in `.nvmrc`.
Four parallel jobs use Node's `--test-shard` option to divide the complete test
file list, including shared-helper and semantics tests. Each file runs in one
job; newly added tests are included automatically. Each job has a 30-minute
limit, and a failure leaves the other jobs running so their results are available.
To reproduce one job locally, use `npm test -- --test-shard=1/4` (or `2/4`,
`3/4`, `4/4`); run all four shards or plain `npm test` for the full suite.
A separate job installs and tests the Zed editor tooling.

Runtime imports along the generator's native TypeScript path use `.ts`
extensions: the build script, parser, CPU modules, and their shared helpers.
TypeScript rewrites those extensions to `.js` when compiling. Other imports
use `.js`, resolving to the same compiled ES modules.
Tests live under `tests/` and state expected behavior independently of the code
they exercise. Files under `tests/types/` check public TypeScript contracts
during compilation; they are not executed as runtime tests.

## License

Released under the [MIT license](LICENSE).

## Repository guide

- [ROADMAP.md](ROADMAP.md) describes the stages and review points.
- [Web design and site structure](docs/web-design.md) proposes the sitemap,
  exploration workspace, detailed software-guide layouts, visual direction,
  and steps toward the website.
- [Documentation](docs/README.md) is the entry point for architecture, CPU
  scope, model contracts and coverage, example specifications, machine
  definitions, and reference notes.
- [src/components/memory/](src/components/memory/) contains RAM, ROM, memory
  connections, and fixed memory maps.
- [src/components/cpus/](src/components/cpus/) contains the CPU models,
  stored-state descriptions, authored instruction definitions, shared helpers,
  detached snapshots, and step records.
- [src/components/devices/](src/components/devices/) contains the shared byte-input
  and byte-output devices.
- [src/machines/](src/machines/) contains `.machine` definitions, their parser,
  and example setup support for CPU, memory, and device compositions.
- [src/runtime/](src/runtime/) provides bounded CPU execution with retained
  step records.
- [tests/](tests/) checks component behavior, instruction definitions and
  generation, machine parsing and examples, execution support, and public types.

## Existing work

These projects are our primary references for behavior, teaching ideas,
inspection tools, and examples:

| Project | Reference repository |
| --- | --- |
| Altair 8800 | `dromaios-altair` |
| TRS-80 Color Computer (CoCo) | `dromaios-coco` |
| Game Boy and Game Boy Color | `dromaios-gameboy` |
| Apple II | `dromaios-apple2` |
| Macintosh 128K | `dromaios-mac` |
| IBM PC XT, with an AT scaffold | `dromaios-pc` |
| Microcomputer tutorial | `microcomputer-tutorial` |

CPUjs and applepy are historical references only. The new platform's design
will develop from the small examples we build here; existing implementations
are evidence to examine, including their assumptions and limitations.
