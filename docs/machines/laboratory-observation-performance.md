# Apple II and XT debugger observation workloads

The laboratories reuse detached CPU state from the preceding execution record
when identifying callers, checking stops and recording changes. CPU reset,
power-on, checkpoint restore and Apple II register edits clear execution
history, so the next boundary observes fresh state. Apple II Language Card
mapping is still read at each observation; a captured PC does not capture its
bank. The XT retains both physical addresses and the exact CS:IP pair.

Manual Step uses the completed record's state before it has entered the trace.
Failed instructions still record their completed effects from the live machine
and stop execution. With recording disabled, the XT avoids preparing an
observation solely for the change log. The shared stopping policy keeps its
lazy location lookup when no stop needs checking.

## Repeatable native comparison

The [benchmark](../../scripts/benchmark-laboratory-observation.ts) uses checkpoints
from the existing [Mystery House acceptance](../software/mystery-house.md) and
[Ultima V acceptance](pc-xt-ultima-v.md). Loading and input use the normal
machine/session paths; the benchmark does not inject game code or patch RAM.

| Workload | Input | Measured boundaries | Expected behavior |
| --- | --- | --- | --- |
| Mystery House title | `G` + Return | 2,000,000 | A fixed sample of loading the game through DOS |
| Mystery House yard | `GO STAIRS` + Return | 224,100 | The closed porch, room 2, at the next command prompt `$63DF` |
| Ultima V, CGA | One Down press and release | 500,000 | Party moves from hut `(15,15)` to `(15,16)` |

The Ultima acceptance captures the first visible party names. Before timing,
the benchmark finishes the map redraw through the game's keyboard poll at
`0C6F:1D6C`; sending Down earlier can lose it during initialization. It installs
the declared CGA character ROM before constructing the laboratory's start state.

Use Node 24, build the repository and supply the local media paths. The optional
acceptances can export their verified checkpoints:

```sh
source media/paths.env
APPLE2_MYSTERY_HOUSE_CHECKPOINTS=media/benchmarks/mystery-house \
  node --test dist/tests/site/apple2-mystery-house.test.js
XT_ULTIMA_PERFORMANCE_CHECKPOINTS=media/benchmarks/xt \
  node --test dist/tests/machines/8088/pc-xt/rom-ultima-v.test.js
node dist/scripts/benchmark-laboratory-observation.js media/benchmarks 3 fresh
node dist/scripts/benchmark-laboratory-observation.js media/benchmarks 3 captured
```

`media/paths.env` is a local convenience: otherwise set `APPLE2_ROM`,
`APPLE2_MYSTERY_HOUSE_DISK`, `XT_BIOS_ROM`, `XT_BASIC_ROM`, `XT_CGA_ROM`,
`XT_ULTIMA_PROGRAM` and `XT_ULTIMA_PLAYER`. Checkpoints contain RAM and media;
keep them under ignored `media/`, never in version control.

The `fresh` strategy reproduces the previous observers' CPU snapshot requests.
The `captured` strategy supplies execution-record state through the same public
observer APIs. Each strategy restores the same start for three samples per
configuration, alternating configuration order:

- Machine execution without debugger or RAM-write observation.
- Debugger observation with change recording off.
- Debugger and change recording on.
- Recording plus an active Run-to request for an address the workload never reaches.

All configurations capture display output every 10,000 boundaries and at the
end. Apple II configurations also sample speaker audio at 48 kHz. The XT has
no browser audio output in this model. Checksums cover the complete final
hardware, input and media state; the sequence of sampled frames; retained
change history; and Apple II PCM bytes. Compare corresponding JSON rows across
strategies as well as the automatic within-run equality checks.

This measures native debugger/change-log work, not the entire browser laboratory.
DOM rendering, host scheduling, pacing, other Apple II inspectors and physical
audio playback are excluded. Run without concurrent builds, tests or running
laboratories. Timing is a comparison on one host, not an acceptance threshold.

## Measured pass: 2026-11-15

Apple M5 Max, Node 24.20.0; median of three restored samples per configuration.

| Workload | Recording: fresh → captured | Run-to: fresh → captured |
| --- | --- | --- |
| Mystery House title | 3,272.0 → 2,238.3 ms | 3,787.3 → 2,241.4 ms |
| Mystery House yard | 387.6 → 256.9 ms | 452.0 → 261.7 ms |
| Ultima V, CGA | 1,902.2 → 1,578.3 ms | 2,270.8 → 1,616.5 ms |

Recording took 32–34% less host time on the Apple II workloads and 17% less on
the XT. Run-to took 29–42% less. Machine-only results were within 2%; the XT's
recording-disabled debugger results were within 3%. Those unchanged paths
provide a check on host variation.

All 36 paired samples had identical state, clocks, sampled display output and
retained histories. All Apple II pairs also had identical PCM bytes. Focused
tests cover snapshot counts, Language Card remapping, segmented aliases, REP,
interrupts, manual completion, host edits, reset, restore and partial failures.
