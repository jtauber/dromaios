# Dromaios

An in-browser emulation platform for exploring how computers work.

The platform lives at [jtauber/dromaios](https://github.com/jtauber/dromaios).

Dromaios brings together the existing Altair, TRS-80 Color Computer, Game Boy,
Apple II, Macintosh, IBM PC, and microcomputer tutorial projects. Each machine
will be built primarily by configuring and connecting reusable components.
The eventual aim is for this platform to replace the separate emulators.

The purpose is primarily pedagogical. Users should be able to follow an
instruction, inspect registers and memory, understand a device, and explore how
the parts of a machine interact. Running software gives those explorations a
concrete setting.

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
- **Develop abstractions through concrete examples.** Start with a small working
  case, then exercise three distinct CPUs before settling shared CPU and
  inspection interfaces. Use a rule of three to judge generalizations.
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

The [first 8080 example](docs/first-example.md) can execute `MVI A,2` and `ADI 3`,
returning records of state changes and memory reads. RAM, CPU state, reset,
lesson setup, and both instructions have automated tests, including exhaustive
addition checks. `STA`, `HLT`, and a browser application are still to come.
Small 6502 and 6809 examples will follow the 8080 to test our generalizations.

The implementation uses **TypeScript**, compiled to JavaScript ES modules,
with **Node.js 24 LTS** and its built-in test runner for development.

The first implementation milestone is deliberately small: one CPU, a little
RAM, a tiny program, and a way to step through it and see what changes.

## Development

Use Node.js 24 and its bundled npm. With nvm, run `nvm install` and `nvm use`
from this directory; [.nvmrc](.nvmrc) selects the major version. Other Node
version managers work too. For a Homebrew `node@24` installation, select it
for the current shell with `export PATH="$(brew --prefix node@24)/bin:$PATH"`.

```sh
npm ci
npm test
```

`npm ci` installs the locked development dependencies. `npm test` cleans the
generated `dist/` directory, type-checks and compiles the source and tests, and
runs the compiled tests. `npm run build` performs just the clean build.
Generated output and `node_modules/` are ignored by Git. There are no runtime
dependencies, and the simulation source uses no Node or browser APIs.

Source imports use `.js` extensions so they resolve in the compiled ES modules.
Tests live under `tests/` and state expected behavior independently of the code
they exercise. Files under `tests/types/` check public TypeScript contracts
during compilation; they are not executed as runtime tests.

## License

Released under the [MIT license](LICENSE).

## Repository guide

- [ROADMAP.md](ROADMAP.md) describes the stages and review points.
- [docs/architecture.md](docs/architecture.md) sketches the component boundaries
  and proposed source layout.
- [docs/cpu-roadmap.md](docs/cpu-roadmap.md) records the intended CPU scope,
  existing reference coverage, and the three-CPU approach to generalization.
- [docs/first-example.md](docs/first-example.md) specifies the first 8080 program,
  initial state, step records, and acceptance checks.
- [src/components/memory/ram.ts](src/components/memory/ram.ts) owns byte storage
  and validates reads and writes.
- [src/components/cpus/8080.ts](src/components/cpus/8080.ts) owns 8080 state,
  executes `MVI A,n` and `ADI n`, and returns detached state snapshots and step
  records.
- [src/machines/first-example.ts](src/machines/first-example.ts) prepares fresh
  RAM and CPU state for starting or restarting the example.
- [tests/](tests/) checks RAM, the supported CPU behavior, and the example.

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
