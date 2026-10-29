# TRS-80 Color Computer: target and acceptance plan

The selected machine is a **CoCo 1 hardware profile with 32 KiB RAM and Color BASIC 1.3**,
using the existing generated 6809. The first milestone is native ROM boot, keyboard input,
text and semigraphics, a small stored BASIC program, and a usable laboratory.
This broadens the platform before further Apple II DOS exploration.

The [native executable chapter](../../src/machines/6809/coco.md) now owns the
implemented component, memory, reset, firmware, display, and snapshot contracts.
It passes the full Color BASIC conversation headlessly on native Dromaios
hardware. The laboratory now connects this machine to the shared docking
workspace, with local verified ROM storage, matrix input, CPU/memory/device
inspection, and a saved checkpoint. The chapter also owns the optional
Extended Color BASIC 1.1 ROM upgrade and its native graphics acceptance tests.
This document retains the reference audit and acceptance plan, rather
than duplicating the executable chapter's contracts.

## Reference audit

Audited on **2026-10-28**, at dromaios-coco commit
[`099aeb7c54f0a3d27299bcad490ad883ead9fa6f`][reference]. This is the same
revision used by the earlier CPU comparisons. Its architecture prose describes
intent; its JavaScript and the executed probes below establish actual behavior.
The source links require access to the private reference repository.

| Area | Evidence in the pinned source | Consequence for Dromaios |
| --- | --- | --- |
| CPU | 6809 core, opcode tables, interrupt entry, and embedded instruction assertions. | Retain the generated CPU. The [earlier comparisons](../../src/components/cpus/specifications/6809.md#reference-comparisons) already record undefined encodings, omitted CLR reads, and reset differences. |
| Memory | 64 KiB allocated backing storage, nominal 32 KiB RAM, ROM sockets, PIA mirrors, SAM switches. | Separate physical storage from address routing. Do not let a mode switch manufacture extra installed RAM. |
| Firmware | Local file selection and browser storage; several length-based loading paths. No ROM bytes, version identity, or checksum manifest are tracked. | Verify exact media before installation. A maintainer-supplied ROM was subsequently found and exercised as described below. |
| PIA/keyboard | Direction/data selection, matrix input, flag acknowledgement, and output callbacks. | Useful starting cases, but direction changes, pin resolution, and control-line behavior need independent checks. |
| SAM/video | Register bits, page offset, text/SG4 raster, and eight graphics cases. | The renderer does not use SAM's display-mode bits; page and RAM selection are incomplete. Audit each selected mode rather than declaring full MC6847/SAM support. |
| Interrupts/time | Run asserts field sync once per browser animation frame, then spends a static CPU-cycle budget. Frame and Step use different paths. | Make events deterministic and independent of browser rendering; use the CPU's explicit interrupt interface. |
| Presentation | Canvas display, registers/flags, SAM and execution counters, Run/Stop/Step/Frame, local ROM/cartridge loading. | Reuse the new laboratory workspace. This reference has no equivalent of the Apple II lab's memory, disassembly, watch-history, or saved-state tools. |
| Other peripherals | Disk reads return `FF`; writes do nothing. No host audio, cassette transport, or joystick model. Cartridge-only loading invents vectors. | Those are not demonstrated working peripherals and are outside the first milestone. |

Sources: [memory][ref-memory], [PIA and keyboard][ref-pia], [SAM][ref-sam],
[VDG][ref-vdg], [application and embedded tests][ref-main].

### Executed checks

Temporary Node.js 24 harnesses loaded the unmodified reference classes in an
isolated context. The browser startup callback was not invoked; these are
headless code probes. Real-ROM checks are recorded separately below; no browser
interaction was exercised in this audit.

- The reference's embedded CPU suite reported **49 assertions passed, zero
  failed**. It does not test the complete machine or establish hardware fidelity.
- A synthetic 8 KiB ROM supplied a reset vector and an 18-instruction program:
  initialize S, configure PIA 0, scan an offered key, store a word in screen RAM,
  call a routine that increments RAM, and return. The original CPU and Dromaios's
  generated 6809 agreed on **all 66 ordered bus transfers**, all RAM bytes, and
  A/B/S/U/PC. Both left `FE 41 42 01` at `0400–0403`, with S restored to `7FFF`
  and PC at `A030`. The reference devices were shared between the two cases;
  agreement demonstrates integration feasibility, not their correctness.
- Sixteen focused probes reproduced the following behaviors. Synthetic ROMs
  were byte arrays made for the audit, not copies of Color BASIC.

| Probe | Observed result | Required treatment |
| --- | --- | --- |
| Basic map and aliases | Reset reads the supplied BASIC tail; PIA writes at `FF1F/FF1E` reach CRB/DRB. `FFE0` instead returns `FF`, even with `55` at ROM offset `1FE0`. | Test the complete selected ROM alias window, not just reset. |
| Short direct ROM | A one-byte image is marked loaded; reading `BFFF` returns JavaScript `undefined`. | Every successful guest read must remain a byte; reject invalid images. |
| Oversized combined ROM | A 16,385-byte image is accepted and silently sliced into two 8 KiB images. | No length guessing or ignored trailing bytes. |
| Replacing a combined image | Loading 8 KiB after 32 KiB retains the old extension and cartridge. | Replacing firmware must install exactly the selected configuration. |
| Invalid subsequent selection | A one-byte combined image silently leaves the old image active. | Preserve the machine but report rejection explicitly. |
| PIA acknowledgement | Control and DDR reads preserve a pending CB1 flag; a data-register read clears it. | Preserve this useful distinction; inspection must use a separate observation path. |
| Keyboard with PB configured as input | With DDRB zero, a pressed key still produces PA=`FE`: the scan uses `DRB & DDRB`, treating undriven select lines as low. | Resolve board pin levels instead of treating every input pin as a driven zero. |
| Output-direction change | Writing latch `80` while DDRB is zero, then changing DDRB to `80`, leaves the VDG in text mode. | Recompute connected outputs on direction changes as well as data writes. |
| CA2 becomes an output | A pre-set IRQ-A2 flag plus CRA=`28` still reports control=`68` and an active IRQ. | Follow the PIA's mode-dependent flag behavior. |
| IRQ deassertion | After a data read clears the PIA source, the application's interrupt bridge leaves `cpu.irqPending` true. | Sample the current level at instruction boundaries; do not retain a stale request after acknowledgement. |
| SAM startup | Construction selects offset `0000`; `powerOn()` forces `0400`. | Define power-on/reset from hardware and let firmware configure the screen. Do not preset a successful boot's state. |
| Physical RAM | Setting all-RAM mode permits storage at `9000` despite nominal 32 KiB RAM. | Declare physical capacity and supported map modes separately. |
| Rendering a high page | With SAM F=`7F`, rendering through `memory.read` reaches `FF00–FFFF` and clears PIA 0's pending CB1 flag. | Video reads physical RAM through its own addressing path, never CPU I/O registers. |
| SAM display mode | Changing V from 0 to 7 produces identical raster data with the same PIA mode/page. | Implement the selected SAM/VDG combination explicitly; do not imply all combinations work. |
| Cartridge without BASIC | Bytes `55 C1 23` cause synthesized reset and IRQ vectors to `C123`. | Do not inherit this invented boot path. No cartridge support in the first profile. |
| Shift mapping | The handler uses PB7/PA6, while its preceding matrix comment places Shift on PA7. | Check the matrix against the schematic; do not copy the comment. |

The [Motorola PIA control-word specification][pia] distinguishes data and DDR
access, edge selection, interrupt enables, and input/output control-line modes.
It states that an IRQ2 flag is zero when its control pin is an output. A generic
"set interrupt flag" helper is insufficient to describe those transitions.

Two other prose errors matter for teaching: the architecture note assigns
BSR/JSR to U although the implementation uses S; the VDG's `updateMode` comment
lists different bit assignments from its implementation. Use CPU documentation
and the Tandy wiring, not those comments, as the authority.

### Audited media and real-ROM checks

The maintainer supplied `Color Basic v1.3 (1982) (Tandy).rom` from the backed-up
`dromaios-coco/roms` directory. No firmware bytes are added to Dromaios or the
published site.

| Identity | Value |
| --- | --- |
| Length | 8,192 bytes |
| SHA-256 | `5375b1caef9df815b781d9cd6df81ecdaddd2642b06a01adac521e40f1329751` |
| SHA-1 cross-check | `28b92bebe35fa4f026a084416d6ea3b1552b63d3` (MAME's `bas13.rom`) |
| Mapping | `A000–BFFF`, with the vector alias described above |
| Reset vector | `A0 27`, entering at `A027` |
| Observed banner | `COLOR BASIC 1.3`, `(C) 1982 TANDY`, then `OK` |

The full conversation now recorded in the native chapter ran headlessly with the reference CPU
and with Dromaios's generated 6809, each connected to fresh copies of the
unchanged reference memory/devices. It covered arithmetic, stored lines, LIST,
RUN, replacing line 20, NEW, editing with the left-arrow key, an infinite loop,
Break (`BREAK IN 10`), and another successful immediate command. Numeric output
was ` 5 ` or ` 6 ` on its own row before `OK`.

The harness used the reference's 14,917-cost-unit batches solely as an audit
scaffold: 180 batches before the boot sample, three batches with each key held,
three released, and five after a submitted line. Shift was pressed with the
required base key. This reproduces a concrete input schedule without claiming
that the reference's costs are accurate hardware time. The boot sample followed
668,035 instructions, inside the keyboard scan; it is not the earliest possible
prompt time. Each complete run executed 3,389,371 instructions across 915 batches.

Two paired runs tested the same key schedule: one asserted the reference's
CB1 field-sync flag at each batch, and the other supplied no sync events. CPU
registers/flags agreed after every instruction between the two CPUs, and all RAM
and text decoded from screen RAM agreed at the checkpoints. Both schedules
produced identical CPU/RAM checkpoints and accepted **zero IRQs**. With sync
disabled, the compared PIA, SAM, and VDG state also agreed at every checkpoint.

With sync enabled, one checkpoint retained a CB1 flag in the reference but not
in Dromaios. At `A1C1`, `CLR $FF02` reads and acknowledges the PIA in Dromaios;
the reference only writes. The same missing read also occurs during the indexed
CLR at `A062`, which reaches the `FF1E` mirror. The earlier CPU comparison had
already identified the omitted CLR access. Do not suppress that documented read
to force device-state parity.

The comparison does not establish full bus-trace equivalence or validate the
shared reference peripherals. Native behavior is checked separately in the
executable chapter. Browser input/rendering and laboratory checks are a
separate layer, described below.

Only this exact 8 KiB image is selected. If later accepting combined images,
identify and hash their constituent ROMs and document normalization explicitly;
do not silently enable Extended BASIC or a cartridge from extra bytes.

## Native implementation and remaining acceptance

On **2026-10-29**, a temporary integration harness replaced the reference's PIAs
and keyboard with the generated MC6821 and native CoCo wiring while retaining
its RAM/ROM/SAM scaffold. The generated 6809 completed the pinned Color BASIC
transcript now recorded in the native chapter, including
line editing and Break, in **3,660,000 instructions**, with no automatic sync
events. Each batch contained 4,000 instructions, with the same 180-batch boot
sample, three-batch key holds/releases, and five-batch post-command waits as
the earlier audit. Literal screen-RAM expectations were checked after each
relevant command. This verified the input path with firmware; it did not
establish native SAM/video support or browser acceptance. No ROM bytes are tracked.

The subsequent native implementation replaced the remaining reference RAM,
ROM, and SAM scaffold. Its optional ROM test uses the same instruction
schedule and passes the transcript with native PIAs, keyboard, SAM, VDG, and
machine composition. The native chapter records the functional model's limits,
including fixed logical RAM rather than physical DRAM multiplexing. Synthetic
tests independently cover explicit interrupts, restoration, and video reads.
The ROM remains caller-supplied; no firmware bytes are tracked.

The laboratory repeats that conversation through browser paste and physical
editing keys, including a stored program, line replacement, NEW, and Break from
an infinite loop. Restoring a saved program after NEW recovers its previous
output and execution. Focus loss pauses and clears the host queue. The optional
browser-session ROM test additionally compares execution after restoration in
the middle of a key press; hermetic tests check queue bounds, release phases,
invalid snapshots, and observation with a pending PIA interrupt.

These checks establish the first untimed BASIC laboratory, not a complete
hardware emulator. The executable chapter owns the current browser contract;
the following criteria remain the guide when adding inspectors or timing.

### Before adding hardware time

Before enabling periodic sync or timing-dependent software, add a separately
reviewed emulated-time contract: independently checked 6809 instruction and
interrupt costs, variable costs, waiting, and an NTSC line/field schedule with
saved phase. Fixed instruction counts or browser frames are not hardware time.
That later work need not model complete DRAM contention or analogue video.

For the first profile, the same instruction-boundary input schedule must give
the same CPU/device results with single steps, small or large batches, and no
rendering. A paused machine consumes neither queued input nor execution steps.
Browser focus-loss release handling must not leave a key stuck on resume.

### Browser input and observation

Repeat the native chapter's BASIC conversation through host key handling,
including Shift, Enter, editing, Break, repeated keys separated by releases,
and focus-loss release. Pasting, if offered, must use the matrix path. Host
key repeat is distinct from the ROM's held-key behavior.

Repaint, inspect registers, preview memory, and browse code with a PIA interrupt
pending and keys held. These operations must leave CPU, RAM, PIA/SAM state,
and keyboard matrix unchanged. Repeat with panels hidden and Live disabled.
Fixed RGB colours and absent composite artifacts must be declared as
presentation approximations. Invalid media must preserve the session; hardware
remains stopped and inspectable until the host has a valid boot configuration.

### Laboratory and repeatable sessions

The workspace's tools and behavior are defined in the
[executable machine chapter](../../src/machines/6809/coco.md#using-the-laboratory).
Both S and U must be independently inspectable; direct-page browsing follows
DP rather than assuming page zero. A/B and derived D must agree, and word
views must use 6809 byte order. Stack inspection must not infer frames or
empty-stack bounds from arbitrary bytes. The workspace need not duplicate
every Apple II specialist tool.

Run, Pause, Step, reset, and fresh power-on must have explicit effects. CPU-only
reset preserves RAM and peripherals according to the CPU contract; fresh
power-on resets the complete machine and host input queue while retaining the
verified ROM binding. Label a physical machine-reset action separately if it
also resets device pins. Do not copy the reference's RAM-clearing Reset label.

Snapshot/restore must include CPU execution state, RAM, both PIAs, SAM, keyboard
state, and queued host input. A future timed profile must also retain pending
events and clock phase. Save with a program stored and while input or an interrupt
is pending; after restoration the same remaining inputs must yield the same
execution and display. Snapshots must validate ROM identity and own their data.
Invalid media or state selections preserve the running session. Host-held keys
must be reconciled explicitly when restoring or losing focus.

Keep workspace layout separate from machine state and keep machine-specific
preferences distinct from the Apple II's. Changes to shared tools must retain
existing Apple II behavior. Use the CoCo to identify small shared tool contracts;
do not make its devices imitate the Apple II's keyboard latch or memory banks.

## Next implementation sequence

Use the chapter's Color BASIC walkthrough to review the inspection tools as
a coherent laboratory. Then review the untimed profile's remaining limitations
before broadening software support or adding a timed SAM/VDG/CPU schedule.

Keep the selected conversation working headlessly and in the laboratory as
the model expands. New inspectors must retain the observation guarantees and
new hardware behavior must declare its fidelity limits.

## Hardware references

- [Tandy Color Computer Technical Reference Manual (1981)][technical]: printed
  pages 4–10 for address/pin maps, 19–21 for SAM and ROM, 21–27 for video,
  29 for the PIAs, and 33 for keyboard scanning. PDF page numbers are seven
  greater than printed page numbers in this scan.
- [Motorola MC6821 datasheet excerpt][pia]: expanded block diagram and Figure 18
  control-word format, including mode-dependent interrupt acknowledgement.
- [Motorola SN74LS783/MC6883 datasheet][sam]: register controls, address generation,
  and memory allocation. Use the MC6883 behavior rather than silently adopting
  later chip variants described in the same document.

[reference]: https://github.com/jtauber/dromaios-coco/tree/099aeb7c54f0a3d27299bcad490ad883ead9fa6f
[ref-memory]: https://github.com/jtauber/dromaios-coco/blob/099aeb7c54f0a3d27299bcad490ad883ead9fa6f/js/mem.js
[ref-pia]: https://github.com/jtauber/dromaios-coco/blob/099aeb7c54f0a3d27299bcad490ad883ead9fa6f/js/pia.js
[ref-sam]: https://github.com/jtauber/dromaios-coco/blob/099aeb7c54f0a3d27299bcad490ad883ead9fa6f/js/sam.js
[ref-vdg]: https://github.com/jtauber/dromaios-coco/blob/099aeb7c54f0a3d27299bcad490ad883ead9fa6f/js/vdg.js
[ref-main]: https://github.com/jtauber/dromaios-coco/blob/099aeb7c54f0a3d27299bcad490ad883ead9fa6f/js/main.js
[technical]: https://colorcomputerarchive.com/repo/Documents/Manuals/Hardware/Color%20Computer%20Technical%20Reference%20Manual%20%28Tandy%29.pdf
[pia]: https://www.komponenten.es.aau.dk/fileadmin/komponenten/Data_Sheet/Microprossor/MC6821.pdf
[sam]: https://colorcomputerarchive.com/repo/Documents/Datasheets/MC6883%20Synchronous%20Address%20Multiplexer%20%28Motorola%29.pdf

[mame-roms]: https://github.com/mamedev/mame/blob/master/src/mame/trs/coco12.cpp#L697-L700
