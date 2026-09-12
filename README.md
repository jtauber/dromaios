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

## Status

Initial design. There is no runnable application yet. The first CPU is the
Intel 8080, followed by small 6502 and 6809 examples to test our generalizations.
The implementation language is **TypeScript**. Tooling, the exact first program,
and the initial execution interface remain to be decided.

The first implementation milestone is deliberately small: one CPU, a little
RAM, a tiny program, and a way to step through it and see what changes.

## License

We have chosen the MIT license. The license file will be added alongside the
first code; it has not been added yet.

## Repository guide

- [ROADMAP.md](ROADMAP.md) describes the stages and review points.
- [docs/architecture.md](docs/architecture.md) sketches the component boundaries
  and proposed source layout.
- [docs/cpu-roadmap.md](docs/cpu-roadmap.md) records the intended CPU scope,
  existing reference coverage, and the three-CPU approach to generalization.

Source and test directories will be added as their first pieces are implemented.

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
