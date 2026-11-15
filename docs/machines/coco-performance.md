# CoCo laboratory performance workloads

Fahrfall and 3-D Brickaway exercise different display and timing paths. Their
[machine-chapter acceptances](../../src/machines/6809/coco.md#fahrfall-sg12-and-changing-cpu-speed)
remain the authority for loading, controls, sound and checkpoint recovery.
Performance measurements start from those acceptances' first playable states;
they do not inject game code or replace guest loading routines.

| Workload | Starting observation | Work exercised |
| --- | --- | --- |
| Fahrfall beta 3 | First return to SAM R=01 after starting play, left joystick centred and fire released | SG12, vertical-sync waits, address-dependent clocks and fully fast drawing bursts |
| 3-D Brickaway | PC `$2A0B`, right joystick centred and fire released, score zero | Bitmap drawing, ROM joystick measurement, brick collision and DAC sound |

## Native measurements

Use Node 24, build the repository, and supply the locally held media described
in the chapter. The game tests can save their verified starting states:

```sh
set -a
source media/paths.env
set +a
export COCO_BRICKAWAY_CAS="$PWD/media/coco/3d-brickaway.cas"
COCO_PERFORMANCE_CHECKPOINTS=media/benchmarks/coco \
  node --test dist/tests/site/coco-fahrfall.test.js dist/tests/site/coco-brickaway.test.js
node dist/scripts/benchmark-coco.js media/benchmarks/coco 3
```

The checkpoint files contain RAM and mounted media and belong under ignored
`media/`, never in version control. Regenerate them when the snapshot contract
or workload setup changes. `media/paths.env` is a local convenience; otherwise
set `COCO_ROM`, `COCO_EXTENDED_ROM`, `COCO_DISK_ROM`, and `COCO_FAHRFALL_DISK`
explicitly before running the tests.

The [benchmark](../../scripts/benchmark-coco.ts) restores each start before
500,000 CPU boundaries. It reports the host, Node version, each elapsed time,
and the median of three samples. The configurations add debugger observation,
RAM-write observation, change recording, 48 kHz sound sampling, then memory capture, instruction
preview and composite raster rendering every 5,000 boundaries. The latter
interval is fixed guest work for comparison, not the browser's refresh policy.
Every configuration must finish with identical complete hardware/input/media
state and pixels; sound and inspection must also produce identical PCM bytes.
Each JSON result includes state, frame and PCM checksums so runs from separate
implementations can be compared as well.

These are native costs. They exclude browser layout, canvas transfer, timer
scheduling and audio-device playback. Run benchmarks without concurrent builds,
tests or running laboratories. Elapsed time is evidence for comparison on that
host, not an acceptance threshold or a promise of real-time emulation.

## Browser measurements

Use the real laboratory, a fixed viewport and layout, and a saved play
checkpoint. Restore before every sample; leave joystick controls on Sliders
with centred axes and released fire. Select Normal speed, choose the same
display signal, and use **Run to address** `$FFFF`. Neither workload executes
that address: the existing debugger limit stops after 2,000,000 boundaries.
Confirm the limit, final PC and elapsed board ticks agree between samples.

Compare these cases separately:

- Visible live inspectors, screen live, Sound on.
- Inspector Live switches off, screen live, Sound on.
- The same held inspectors with Screen collapsed, Sound on.
- Held inspectors and a live screen, Sound off.

Changes recording stays on in all four cases. Timed instrumentation around
execution batches and refresh sections can separate host scheduling,
observation, rendering and sound. Exclude checkpoint decoding from the timed
interval; remove instrumentation before delivering the site.

The laboratory samples live inspectors at most ten times per host second and
the screen at most sixty. Pausing, stepping, restoring, revealing a panel or
changing its controls refreshes it immediately. Memory, Direct Page, S and U
share one detached address-space image when refreshed together, but retain
independent pointers, previous images and highlights. Held tools continue to
show their own captured state. These display choices never skip CPU boundaries,
debugger checks, physical input polling, sound edges or history collection.

### Inspector refresh pass: 2026-11-15

On an Apple M5 Max, in the in-app browser at 1280 × 720, two samples per game
compared `2e6603a` with this pass. Normal speed, composite display, Sound and
Changes recording were on; Screen, Registers, Instruction, Disassembly,
Memory, Direct Page, both stacks and SAM were visible and live. Each row used
one unchanged browser checkpoint across both implementations.

| Game | Before | After | Same completed guest work |
| --- | --- | --- | --- |
| Brickaway | 26.4–27.0 s | 12.9–13.3 s | 2,000,000 boundaries; 14,472,868 board ticks; PC `$2BBA` |
| Fahrfall | 26.77–26.78 s | 12.75–12.81 s | 2,000,000 boundaries; 12,946,104 board ticks; PC `$4F43` |

Refresh work fell from about 11.5 seconds to 1.1–1.5 seconds per sample.
Before the change, holding Brickaway's inspectors reduced its sample to
15.3 seconds; collapsing Screen reduced that to 14.1 seconds. Holding the
inspectors with Screen live and Sound off took 14.5 seconds. Those single
diagnostic samples identified inspection as the main avoidable cost, rather
than sound synthesis or the VDG raster alone.

The changes share a captured memory image, limit live redraws independently
of execution batches, and use the completed boundary's PC for debugger
observation instead of copying the CPU state again. The browser remains
slower than the declared hardware rate in these fully instrumented workloads;
this pass roughly halves host time, without claiming cycle accuracy or
real-time performance on every host.

### Debugger observation pass: 2026-11-15

The laboratory now reuses the preceding execution record's detached CPU state
for breakpoint checks, caller locations and change recording. Reset, power-on
and machine replacement clear execution history, so the next boundary takes a
fresh snapshot. Address mapping is still observed each time: reused CPU state
must not retain an old SAM bank or cartridge mapping. A failed step still logs
its completed effects from the actual machine state and stops execution.

Call tracking selects chapter-derived effects directly from the captured opcode
and postbyte. It shares that selection with disassembly, without formatting
operands or descriptions on every executed instruction. Interrupt entry and
waiting-frame tracking retain their existing behavior.

The following native medians compare `5e24e2d` with this pass on the same
Apple M5 Max and Node 24.20.0. Each configuration ran three restored samples of
500,000 boundaries, with Node CPU profiling enabled on both implementations.

| Observation | Fahrfall before | Fahrfall after | Brickaway before | Brickaway after |
| --- | --- | --- | --- | --- |
| Machine alone | 610.7 ms | 602.0 ms | 660.5 ms | 612.8 ms |
| Debugger and RAM writes | 1,471.6 ms | 701.7 ms | 1,516.4 ms | 727.1 ms |
| Also change recording | 1,794.8 ms | 830.5 ms | 1,880.0 ms | 876.1 ms |
| Also sound sampling | 1,808.6 ms | 855.4 ms | 1,920.2 ms | 879.4 ms |
| Also periodic inspection | 1,943.5 ms | 945.9 ms | 2,467.6 ms | 1,048.6 ms |

All 30 before/after pairs matched complete hardware/input/media state, final
pixels and board ticks exactly; all sound-enabled pairs also matched every PCM
byte. Variation in the machine-only baseline is host noise: this pass changes
observers, not machine execution. Debugger-enabled workloads took roughly half
the host time. A focused test confirms that continuous observation adds no CPU
snapshots beyond the execution record's own before/after copies.

Repeating the browser protocol above with Fahrfall, Normal speed, Sound and all
visible inspectors live took 14.33–14.72 seconds before and 7.73–7.79 seconds
after, across two samples of each implementation. Every sample finished at PC
`$4F43` after 2,000,000 boundaries and 12,946,104 board ticks; the visible register
and memory results also agreed. This is close to the workload's declared
7.23 seconds of guest time, while remaining a measurement of this host and
layout. Reset and checkpoint restore were checked separately for fresh caller
locations and change-log values.
