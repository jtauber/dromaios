# TRS-80 Color Computer: target and acceptance plan

The next machine is a **CoCo 1 hardware profile with 32 KiB RAM and Color BASIC 1.3**,
using the existing generated 6809. The first milestone is native ROM boot, keyboard input,
text and semigraphics, a small stored BASIC program, and a usable laboratory.
This broadens the platform before further Apple II DOS exploration.

This document is the acceptance specification, not a claim of implemented CoCo
support. As implementation proceeds, move implemented contracts and acceptance
examples into the executable machine and device chapters; retain the reference
audit here. Do not keep two copies of those contracts.

## Selected first configuration

| Part | Target |
| --- | --- |
| Processor | Existing [6809 model](../../src/components/cpus/specifications/6809.md), used in the MC6809E system context. No second CPU implementation. |
| Machine | NTSC CoCo 1, 32 KiB RAM profile, normal ROM-based address map. |
| Firmware | The audited caller-supplied 8 KiB Color BASIC 1.3 ROM at `A000–BFFF`; identity below. No Extended Color BASIC. |
| RAM | `0000–7FFF`; deterministic zero fill on fresh power-on is an emulator convention. |
| I/O | Two MC6821 PIAs, including the port directions, control lines, and interrupt behavior required by the selected configuration. |
| Address/video control | MC6883 SAM register state, normal-map decoding, and text display address generation. |
| Display | MC6847 internal characters, inverse characters, both text colour sets, and semigraphics-4. The ordinary text page has 32 columns and 16 rows. |
| Keyboard | The CoCo matrix, with distinct press/release events, Shift, Enter, editing keys, and Break. |
| Unattached hardware | No cartridge, disk controller, cassette transport, printer, or joystick. Their disconnected input levels must be specified. |

Color BASIC 1.3 is a later ROM revision: [MAME identifies this image][mame-roms]
with its CoCo 2B configuration. Here it is a specified ROM upgrade on the
CoCo 1 hardware profile, not a claim about an original factory combination.
The [Tandy technical reference][technical] describes the system memory map,
video connections, and keyboard interface. The first profile is deliberately
smaller than the reference emulator's collection of modes. Extended BASIC,
full graphics, other RAM configurations, all-RAM operation, cartridges, storage,
audio, and CoCo 2/3 variants are later milestones. Unsupported modes must remain
visible as limitations rather than silently presenting an invented result.

### Memory and connections

The executable chapter should declare these regions and aliases explicitly:

| Addresses | First-profile connection |
| --- | --- |
| `0000–7FFF` | RAM. The ROM normally places the text screen at `0400–05FF`; the renderer follows SAM state instead of hard-coding that page. |
| `8000–9FFF` | Unpopulated Extended BASIC socket. |
| `A000–BFFF` | Verified Color BASIC ROM. Writes do not alter it. |
| `C000–FEFF` | Unpopulated cartridge region. |
| `FF00–FF1F` | PIA 0; its four registers repeat every four addresses. |
| `FF20–FF3F` | PIA 1, with the same register mirroring. |
| `FF40–FFBF` | Unpopulated peripheral space. |
| `FFC0–FFDF` | SAM control writes: paired addresses clear/set individual bits, independently of the written byte. |
| `FFE0–FFFF` | Color BASIC ROM tail, including the big-endian CPU vectors; `FFFE–FFFF` selects ROM offsets `1FFE–1FFF`. |

The [SAM allocation table][sam] selects the BASIC ROM for `FFE0–FFFF`, even
though only `FFF2–FFFF` contains the documented CPU vectors. Unanswered guest
reads return `FF` and writes are ignored in this initial model; that is an
explicit undriven-bus approximation. Inspectors show absent storage as
unavailable rather than presenting the guest fallback as stored ROM data.

Name matrix connections by pins: PIA 0 PB0–PB7 select the eight keyboard
columns; PA0–PA6 sense seven rows. PA7 is a joystick-comparator input, not an
eighth keyboard row. PIA 1 PB3 controls CSS, PB4–PB6 control GM0–GM2, and PB7
controls A/G. These assignments follow the Tandy map (printed pages 6–7 and 33).
Device chapters must distinguish output latches, direction registers, and
resolved pin levels.

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

The full conversation in checkpoint 2 ran headlessly with the reference CPU
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
shared reference peripherals. A native Dromaios CoCo, browser input/rendering,
and snapshot continuation still need the acceptance checks below.

Only this exact 8 KiB image is selected. If later accepting combined images,
identify and hash their constituent ROMs and document normalization explicitly;
do not silently enable Extended BASIC or a cartridge from extra bytes.

## Literate implementation boundaries

The machine chapter will own component selection, RAM and ROM requirements,
memory routing, pin connections, reset wiring, and acceptance examples. Device
chapters will own PIA register behavior, SAM state/addressing, and selected VDG
decoding. Use [existing device declarations](../devices/literate-specifications.md)
where they express the behavior clearly. Concrete support code is appropriate
where new connections or event handling are needed; do not design a universal
peripheral language before implementing these cases.

Browser code owns file selection, host-key translation, drawing, and scheduling
work. It does not patch firmware, inject BASIC tokens into RAM, or supply ROM
routine traps. Pure device views supply inspection; execution records supply
observed accesses. Software workspace names belong to a versioned ROM guide.

### Timing and interrupt boundary

The selected BASIC transcript works with sync events absent, despite the
reference's comment that BASIC requires its browser-frame interrupt. The first
milestone therefore uses an explicit **untimed functional profile**: no automatic
horizontal/field-sync events, audio, or claim of a MHz rate. Keyboard input is
an ordered sequence of physical matrix changes. Host batching controls response
and presentation speed, not emulated hardware time. This profile does not claim
to run software that depends on video interrupts or real-time delays correctly.

PIA edge detection, masking, flag latching, acknowledgement, and current IRQ/FIRQ
levels still need independent checks with explicit input edges. PIA 0 connects
to IRQ and PIA 1 to FIRQ. Use the CPU's existing interrupt interface at instruction
boundaries, including its masked and waiting outcomes; no stale latched request
should survive device acknowledgement. Rendering must never inject an event.

Before enabling periodic sync or timing-dependent software, add a separately
reviewed emulated-time contract: independently checked 6809 instruction and
interrupt costs, variable costs, waiting, and an NTSC line/field schedule with
saved phase. Fixed instruction counts or browser frames are not hardware time.
That later work need not model complete DRAM contention or analogue video.

For the first profile, the same instruction-boundary input schedule must give
the same CPU/device results with single steps, small or large batches, and no
rendering. A paused machine consumes neither queued input nor execution steps.
Browser focus-loss release handling must not leave a key stuck on resume.

## Acceptance checkpoints

### 1. Components and native reset

Use independent literal expectations for the memory map, vector byte order,
PIA aliases, DDR/data selection, pin levels, edge polarity, and acknowledgement.
Check data-latch and direction changes in either order. Verify SAM address-pair
writes with different data bytes and an explicitly documented reset state.
Unsupported map/display choices must be reported as such.

With the pinned ROM, reset must fetch `FFFE–FFFF` and execute the firmware
without patching PC or RAM to skip initialization. Within a one-million-instruction
boot budget, the ROM must reach its keyboard scan and display the audited banner
and `OK`. Check actual screen RAM as well
as the wait location; an arbitrary PC or a hard-coded screen string is not
evidence of boot. Without firmware, the machine remains stopped and inspectable;
a rejected replacement preserves the existing session.

### 2. Keyboard and a stored program

Drive physical matrix press/release events, including the modifiers needed to
type punctuation. Use this acceptance conversation; numeric output occupies a
row as ` 5 ` or ` 6 `, with the arithmetic values checked independently:

```text
PRINT 2+3
    -> 5, then OK
10 A=2
20 PRINT A+3
30 END
LIST
    -> those three lines, in order
RUN
    -> 5, then OK
20 PRINT A+4
RUN
    -> 6, then OK
NEW
LIST
    -> no program lines, then OK
```

Also enter `PRINT 2+4`, erase the final `4` with the editing key, type `3`,
and submit: it must print `5`. Enter and run `10 GOTO 10`; Break must return
control with the ROM's break indication, after which another immediate command
works. Test Shift, Enter, repeated keys separated by releases, and release on
browser focus loss. Host key repeat must not be confused with the ROM's own
held-key behavior. Pasting, if offered, must use the same matrix path.

No cassette or disk is needed to meet this checkpoint. Saving a named emulator
state is not a claim of implementing BASIC's external-media SAVE command.

### 3. Display and observation

Check every cell in the 512-byte text page, selected glyph shapes, inverse
polarity, colour-set selection, and all SG4 block/color combinations against
independent expectations. Test a different SAM page with a known RAM pattern.
The decoder must read physical video storage; CPU ROM/I/O mapping must not
change the bytes it sees or cause device effects. Fixed RGB colours and absent
composite artifacts must be declared as presentation approximations.

Repaint, inspect registers, preview memory, and browse code with a PIA interrupt
pending and keys held. These operations must leave CPU, RAM, PIA/SAM state and
keyboard matrix unchanged. Repeat with panels hidden and Live
disabled; the execution result must be identical.

### 4. Laboratory and repeatable sessions

Provide Screen, Execution, Registers, Instruction, Disassembly, Memory, Stack,
and device-state views within the existing docking workspace. Both S and U
must be inspectable; direct-page browsing follows DP rather than assuming page
zero. A/B and derived D must agree, and word views must use 6809 byte order.
The first workspace need not duplicate every Apple II specialist tool.

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

## First implementation sequence

1. Retain the audited ROM identity and transcript as integration fixtures,
   without treating reference shortcuts as hardware requirements.
2. Implement and independently test the PIA behavior and concrete CoCo wiring,
   then the selected SAM/video profile in literate chapters.
3. Bring up the native composition under the declared untimed profile and
   verify repeatable ROM, keyboard, and explicit-interrupt behavior.
4. Connect the shared workspace, complete the browser acceptance checks, and
   publish the executable machine chapter beside it.

The first milestone is complete only when the selected ROM runs the conversation
headlessly and in the laboratory, the observation checks pass, and the remaining
fidelity limits are explicit. A screenshot of `OK`, a passing CPU comparison, or
a reference emulator feature list alone is insufficient.

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
