# Apple II Plus: target and acceptance plan

The current historical-machine target is an **Apple II Plus**, using
[dromaios-apple2][reference] as the primary reference for behavior, devices,
browser interaction, and software targets. The initial
[executable chapter](../../src/machines/6502/apple2.md) now boots ROM and runs
BASIC programs with browser text and both graphics resolutions, Language Card
banking, and read-only DOS 3.3. Writable disks and sound complete the target below.
ApplePy remains a
historical reference; it is not the migration baseline.

The first interactive checkpoint is ROM boot, keyboard input, and a text screen.
The selected machine then grows through graphics and DOS 3.3 to writable disks
and sound. This gives “fully working” a concrete scope beyond reaching a prompt.

## Selected configuration

| Part | Target |
| --- | --- |
| Processor | Existing generated MOS 6502 model. |
| Main memory | 48 KiB RAM at `0000`–`BFFF`. |
| Firmware | Apple II Plus Applesoft/Autostart ROM, 12 KiB at `D000`–`FFFF`; exact media identity below. |
| Language Card | 16 KiB expansion: two 4 KiB banks at `D000`–`DFFF`, with 8 KiB shared at `E000`–`FFFF`. Independent read selection and write protection. |
| Keyboard | Seven-bit character latch and strobe; host delivery is separate from the emulated latch. |
| Display | 40-column text, normal/inverse/flashing characters, both pages, low- and high-resolution graphics, and mixed text/graphics. |
| Storage | Slot-6 Disk II with the 16-sector bootstrap and one attached drive; standard 143,360-byte DOS-order `.dsk` images. |
| Sound | Built-in speaker transitions, with host audio driven by emulated time. |
| Initial software | Applesoft programs and the pinned DOS 3.3 System Master below. |

ROM-only bring-up omits the Disk II card, rather than leaving its bootstrap
waiting for an absent disk. Language Card and disk support enter at their
own checkpoints. The full configuration above is the target of the sequence.

This first target excludes IIe features, additional cards or drives, cassette
loading, game-controller input, protected/custom disk formats, and electrical
or complete video-signal simulation. Ultima IV is a subsequent software target
after its exact media set, disk changes, controls, and save workflow are selected.
It is not evidence that the initial DOS configuration is complete.

## Reference audit

The audit used dromaios-apple2 v0.2.0, commit
[`569baf98006f61e80ed93c36aa4f8d9ae23011d3`][reference], on 2026-10-01.
Its [architecture document][reference-architecture] describes the intent;
the implementation and the probes below distinguish that intent from behavior.
The reference repository requires access for its private source links.

| Area | Present in the pinned reference | Migration consequence |
| --- | --- | --- |
| Memory and firmware | RAM, ROM selection, Language Card latches and banks, mapped keyboard/display/disk switches. | Separate storage, address routing, and device effects into executable descriptions. |
| Display and keyboard | Canvas text/graphics renderer; uppercase keyboard translation and strobe acknowledgement. | Preserve the useful interaction, with independently checked address/character decoding. |
| Disk boot | Slot-6 bootstrap, DOS-order sector encoding into nibble streams, head/phase and Q6/Q7 state. DOS 3.3 boots. | Preserve execution through the controller and real boot software; do not substitute a DOS routine trap. |
| Disk writes and drives | Write mode has no media-writing implementation. Drive 2 selects a label but continues using the same stream. Write-protect sense reports writable. | A read-only milestone must report write protection honestly. Saving and media export are separate required work. An absent drive must not alias drive 1. |
| Sound and paddles | Speaker state toggles, but no audio output is connected. Two paddle values use a CPU counter. | Audible sound is new work; paddle support is outside the first configuration. |
| Time | CPU adds static instruction costs; disk advances on reads, and motor spin-down counts browser frames. | These are approximations, not an accurate clock contract. Keep device time independent of browser refresh. |
| Inspection | Memory, disassembly, instruction explanations, stack, switches, and disk views. Applesoft listing, variables, execution state, stepping, breakpoints, history, and profiling hooks. | Use these as references for the current ROM/DOS understanding work. Inspection must not perform guest device accesses; software-specific interpretation belongs to a versioned guide. |
| Software evidence | ROM and DOS 3.3 System Master are tracked. Ultima IV and Akalabeth names occur in the startup choices, but their images are absent from this revision. | Use the checked DOS fixture for the first disk acceptance. A named game is not a demonstrated working session. |

Sources: [memory/I/O][reference-memory], [video][reference-video],
[keyboard][reference-keyboard], [disk controller][reference-disk],
[sector encoding][reference-nibble], [browser controller][reference-main],
and [Applesoft instrumentation][reference-applesoft].

### Executed checks

A temporary headless adapter exercised the reference's unchanged memory,
Language Card, disk controller, and media with each of two CPUs: its original
CPU and Dromaios's generated 6502. For the adapter's motor countdown only, both
runs used the reference's static opcode costs and 17,050-cost frame budget.
That compatibility scaffold does not add timing support to Dromaios.

Four sessions covered both CPU choices in each configuration:

- ROM-only boot, followed by `NEW`, `10 PRINT 2+3`, `20 END`, `LIST`, and
  `RUN`: the program was stored/listed and printed `5`.
- ROM plus disk boot to the DOS 3.3 System Master banner, `CATALOG`, then
  the same stored-program check. Catalogue pagination required a key to
  continue before the next command could be entered.

The no-disk and disk boots took 52,032 and 7,574,808 instructions respectively
under the probe's keyboard-wait stopping condition, identically with either
CPU. These are audit observations, not timing guarantees or future test limits.
The checks establish a useful CPU compatibility baseline; they do not validate
every opcode, independently validate the shared reference hardware, test canvas
rendering, or constitute a native Dromaios Apple II composition.

Focused probes also confirmed:

- Calling the reference explainer for `STA $C010` at `0200` clears an offered
  `41` key's strobe (`C1` becomes `41`) without stepping the CPU. This reproduces
  the [existing inspection concern](../pedagogy.md#inspection-without-side-effects).
- Two **writes** to `C081` enable Language Card writes. Its handler treats
  reads and writes alike, despite its comment describing successive reads.
  Check the access-direction and reset rules against hardware sources when
  implementing the card; do not inherit this shared handler unexamined.
- Selecting drive 2 still advances the loaded drive-1 stream. Entering write
  mode and offering write data leaves the track bytes unchanged, while the
  controller reports no write protection.

### Audit media

The [machine chapter](../../src/machines/6502/apple2.md#firmware-supplied-by-the-caller)
owns the audited ROM identities and normalization contract. Neither ROM nor disk
bytes are embedded in Dromaios. The same chapter now owns the selected DOS disk
and bootstrap identities, as well as the browser's local-media verification contract.

The reference accepts several ROM lengths permissively. Dromaios verifies the
declared image instead. Browser loading should stay local, as with Altair BASIC;
a rejected selection must preserve the current machine.

## Literate implementation boundaries

The executable machine chapter owns the implemented components, ROM requirements, the
memory map, reset wiring, selected device profiles, and acceptance conversations.
Device chapters own keyboard, display-switch, and Language Card state
transitions. Disk II uses focused TypeScript controller and media classes, with
wiring, contracts, and limitations in the machine chapter. Keep this concrete
until more peripheral examples justify shared representations; do not extend
the device language solely to make this one implementation declarative.
Browser code owns file selection, keyboard events, canvas/audio
delivery, and scheduling host work.

| Need | Existing support and concrete gap |
| --- | --- |
| 6502 with ROM and mapped devices | Implemented through the existing byte bus, with an explicit unanswered-bus policy in the chapter. |
| Caller-supplied ROM | External image declarations accept a verified binding or explicit absence. Hardware can be inspected before firmware installation; snapshots retain ROM identity or absence. Browser selection verifies the complete file before installation. |
| Keyboard and display switches | Keyboard and display switches generate from device chapters, with state, offers, effects, reset, and snapshots. |
| Banked memory | Conditional windows now select independent read/write destinations through pure device views. The machine chapter names both lower banks and common upper storage. |
| Video | Read-only generated views own text and graphics addresses, character attributes, colour decoding, and visible rows. The host reads RAM and draws decoded cells; the chapter declares its high-resolution colour-pair approximation. |
| Disk and speaker time | No current machine clock or device scheduler. Define emulated elapsed time and observable transitions before claiming timed disk behavior or producing audio. |
| Inspection | Use captured CPU records and device snapshots. The laboratory previews mapped storage directly; unavailable device bytes are marked explicitly instead of masquerading as read results. |

Do not copy the reference's CPU, DOM-dependent device logging, or global
instrument registry into the simulation. Keep the existing generated 6502.
Use [machine](definitions.md) declarations for composition and existing
[device](../devices/literate-specifications.md) generation where it fits. Choose
new shared syntax from repeated concrete needs, rather than requiring every
peripheral to fit a declarative framework immediately.

Primary hardware references are Apple's [Apple II Reference Manual][hardware],
especially memory/I/O and display descriptions, the [Language Card manual][language-card]
Appendix D, and [The DOS Manual][dos-manual] for software-visible commands.
The reference emulator is evidence to compare, not the authority for unresolved
hardware behavior. The Language Card chapter records the hardware checks and
differences from the reference; apply the same scrutiny to the disk controller.

## Acceptance checkpoints

### 1. ROM, keyboard, and text

The [chapter's acceptance checks](../../src/machines/6502/apple2.md#headless-acceptance)
now cover native ROM boot, keyboard input, stored BASIC programs, editing,
Control-C, and snapshot continuation. Its declarations own the implemented
memory, media, and reset contracts.

The production display decoder has independent checks for every text cell on
both pages and all normal/inverse/flashing character codes. Browser-session
acceptance covers file verification, queued input, stored programs, editing,
pause/resume, Step, reset, and power-on. The chapter describes the visible
controls and remaining presentation approximations. Inspection preserves the
keyboard and execution state.

### 2. Graphics and Language Card

Both graphics resolutions now have generated decoding for both pages and
full/mixed modes, independent address and colour expectations, and real Applesoft
drawing programs. The chapters own the examples and rendering limitations:
fixed RGB palettes and high-resolution even/odd colour pairs, without a scanner
or composite-signal model.

The [Language Card chapter](../../src/components/devices/specifications/apple2-language-card.md)
and machine windows now cover both banks, shared upper RAM, independent reads
and writes, protection, reset, and restoration. Hardware-based tests distinguish
control reads from writes. A real-ROM check copies Applesoft into card RAM and
continues executing there. The chapters own the transfer-level and undriven-bus
limitations.

### 3. Read-only DOS 3.3

The [machine chapter](../../src/machines/6502/apple2.md#booting-dos-33) now owns
this completed checkpoint: native boot through slot-6 Disk II, CATALOG
pagination, LOAD/LIST HELLO, and a stored BASIC program under DOS. SAVE reports
write protection. Its controller and encoding checks cover independent known
vectors, stream restoration, head movement, missing media, and absent drive 2.

The browser accepts the selected local media, remains schedulable during disk
polling, and preserves controller state during pause and inspection. The chapter
explicitly declares the access-driven stream, simplified head, and immediate
motor-off behavior; these are not rotational or copy-protection compatibility.

### 4. Writable disks and sound

Saving is part of the usable-machine target. On a disposable working copy of
a selected DOS disk: enter a BASIC program, `SAVE`, confirm its catalogue entry,
`NEW`, `LOAD`, and `RUN`. Export the changed image, start a fresh machine,
re-import it, and repeat `LOAD`/`RUN`. Also test write protection and an attempted
save that cannot complete without falsely reporting success or corrupting media.

Speaker transitions must be timestamped in emulated time. Check a known
software-driven tone, browser audio enablement, pause/resume, and silence on
stop/reset according to the declared contracts. Device results must be
independent of browser frame rate and host scheduling. Address the necessary
6502 timing and bus-access fidelity explicitly; static opcode costs alone
cannot establish those properties.

These four checkpoints define the first usable Apple II Plus release. Writable
disks and sound remain unfinished. The current priority is to make the working
ROM and read-only DOS configuration understandable before moving on to games
such as Mystery House and Ultima IV. Playing a game and explaining its software
remain separate acceptance targets.

## Software exploration

The **ROM execution explorer** and its
[versioned walkthrough](../software/apple2p-rom.md#rom-walkthrough) now provide
the first observation tools. The software guide owns its routine annotations,
stops, and acceptance path. Captured CPU records explain completed instructions;
the laboratory's Disassembly panel also decodes current mapped storage, follows PC or Memory, and
browses addresses without guest device reads. Run-to-address and ROM routine stops
are bounded, one-shot requests. The laboratory also has saved instruction
breakpoints and Step over / Step out, with explicit stop reasons and caller
tracking from completed execution records. The tested path follows reset to the Applesoft prompt, then a keypress
through acknowledgement and echo.

## Classroom and laboratory

The goal is to replace dromaios-apple2 with the new Dromaios implementation,
then extend it to other Apple II software and other machines. The two views
serve different purposes:

- **Classroom:** a guided explanation with embedded experiments and executable
  machine and software descriptions.
- **Laboratory:** a separate, dark workspace for running the machine and inspecting
  its screen, processor, memory, and devices together.

Both use the same generated machine, host session, execution controller, and
ROM exploration controls. They currently start independent sessions; opening
the classroom from the laboratory preserves the laboratory tab, but does not
transfer its machine state. Both views share the remembered ROM file in browser
local storage, reverified on each visit. RAM, programs, and disk selections are
not saved across reloads.

The laboratory starts with the reference's three-column layout: screen and CPU
instruments on the left, memory instruments in the middle, and tabbed tools on
the right. It is designed for a large screen; smaller windows scroll across the
workspace. Panels can be rearranged into split areas and tab groups, or collapsed
to their headers, with the layout remembered independently of the machine. The
[workspace guide](../../site/README.md#apple-ii-plus) describes pointer and
keyboard controls. The Apple II storage inspector is deliberately concrete:
it follows the chapter's RAM/ROM/Language Card mapping, reads the installed card
ROM from a snapshot, and marks other device-space bytes unavailable. It never
uses the guest bus. Additional machines should supply their own observation
paths before a shared peripheral-inspection abstraction is designed.

### Replacement progress

| Capability | Current Dromaios laboratory | Remaining reference parity |
| --- | --- | --- |
| Workspace | Dark workspace with draggable panels, resizable splits, tab groups, collapse/expand and close/reopen controls, keyboard arrangement, saved layout, and per-inspector Live toggles. | — |
| Execution and display | Reference bitmap characters, shared text/graphics raster, colour/green monochrome and scanline toggles, direct screen typing, local media selection, a dockable Execution panel below Screen by default. | Reference speed controls require an explicit timing model; do not label instruction batching as a hardware clock. |
| CPU inspection | Registers and flags with last-instruction change highlights and previous values; paused register editing; next-instruction preview with branch tests, address calculations, declared assignments, and chapter-derived explanations; disassembly with PC/MEM selection, address browsing, run-to stops and saved mapping-aware breakpoints; Step over / Step out with bounded observed caller tracking, a dockable Call stack with address links and ROM labels, and explicit stop reasons; captured disassembly of the last twelve instructions, selectable captured changes and ordered accesses for each retained step. | — |
| Memory | Zero page, full-address-space scrolling memory with a header address field and fixed/PC/changed-RAM following, stack entries/full-page toggle and push/pull addresses; per-panel 8/16-byte rows with optional Apple II characters; last-instruction changes and next-instruction fetch/read/write marks across all three views, including named workspace words and pending stack accesses; clickable operand addresses and saved byte watches with data-read, bus-write, and changed-RAM stops, independent of display refresh and log recording. | — |
| Change history | Instruction-attributed before/after values for registers, flags, PC, and physical RAM, including Language Card banks; bounded history with recording and display filters. | — |
| ROM and system | Searchable Monitor reference with PC/Memory following, mapping-aware context, and navigation to Disassembly and Memory; versioned routine stops; live read/write memory map and structured keyboard, display, and Language Card state with change highlights; bounded instruction-linked device-access history with specification descriptions; disk snapshots. | Further annotations driven by walkthroughs. |
| Applesoft tools | BASIC runs on the machine; ROM walkthrough reaches input and echo. | Listing, variables, interpreter state, source stepping, breakpoints, execution history, and profiling. |
| Disk tools | Verified DOS disk boot, read-only drive/eject controls, controller state. | Nibble stream, sector map, and observed disk-access history with copying. |
| Software selection | Verified Applesoft ROM and pinned DOS System Master. | Explicit software/media profiles and acceptance for additional disks and programs. |

Layout parity is the first replacement slice, not a claim of complete tool
parity. The reference's absent audio and incorrect writable/drive-2 behavior
remain governed by the hardware acceptance checkpoints above.

## Next implementation slices

Continue deepening the ROM and existing inspectors: extend annotations where
a walkthrough needs them. Keep these observations
linked to their software identity and avoid inferring routine boundaries from
sparse labels. This takes priority over new BASIC and disk tools.

After those foundations, add Applesoft listing, variables, and interpreter
state from the pinned reference, owned by the versioned software guide, then
source stepping and breakpoints. The later disk and classroom work includes:


1. **Disk boot:** follow the handoffs from motherboard ROM to slot-6 bootstrap,
   disk-loaded code, DOS, and HELLO. Show where bytes arrive in RAM and when
   execution moves into them. Report observed handoffs rather than assuming a
   fixed boot sequence from instruction counts or elapsed time.
2. **Disk reads:** connect controller switches and the byte stream to address
   fields, sector decoding, checksums, and destination buffers. Distinguish
   bytes consumed by the CPU from a read-only view of the stored image.
3. **DOS commands and files:** trace CATALOG and LOAD HELLO through routines,
   catalogue entries, track/sector lists, and memory. Connect the visible
   result to the disk structures and code responsible for it.
4. **Applesoft in ROM:** use a small program to connect its listing and tokens
   to interpreter routines, variables, and execution state, drawing on the
   reference's existing BASIC instruments.

Keep the CPU's encoding knowledge in its executable specification; avoid a
second handwritten opcode table for the explorer. ROM/DOS symbols, comments,
data interpretations, and walkthrough stops belong to guides tied to the exact
software identities, not to the CPU or peripheral models. DOS labels must
account for the loaded image and its location; an address alone does not prove
which software occupies RAM. The [pedagogy plan](../pedagogy.md#inspection-without-side-effects)
owns the observation boundary: completed-step explanations use captured records,
and live previews require explicit side-effect-free inspection. Tests must show
that opening a view cannot acknowledge a key, consume a disk byte, or change a bank.

Use these concrete examples to discover shared instruments. Keep machine wiring
and hardware contracts in the executable machine chapter, with software
walkthroughs linking to them. Do not introduce a general plugin framework or
extend the peripheral language merely to host these first tools.

When writable disks resume, implement them on a disposable in-memory copy and
prove SAVE/NEW/LOAD/RUN plus export/re-import with the selected System Master.
Keep malformed/incomplete writes from silently corrupting sectors and retain
an explicit protected mode. This goes beyond the reference's unfinished write
path and needs independent evidence.

As implementation lands, move hardware/reset/media contracts and acceptance
details into the executable chapter alongside their declarations. Keep this
document as the migration plan and pinned audit; avoid maintaining duplicate
implemented contracts here.

[reference]: https://github.com/jtauber/dromaios-apple2/tree/569baf98006f61e80ed93c36aa4f8d9ae23011d3
[reference-architecture]: https://github.com/jtauber/dromaios-apple2/blob/569baf98006f61e80ed93c36aa4f8d9ae23011d3/ARCHITECTURE.md
[reference-memory]: https://github.com/jtauber/dromaios-apple2/blob/569baf98006f61e80ed93c36aa4f8d9ae23011d3/js/apple2.js
[reference-video]: https://github.com/jtauber/dromaios-apple2/blob/569baf98006f61e80ed93c36aa4f8d9ae23011d3/js/video.js
[reference-keyboard]: https://github.com/jtauber/dromaios-apple2/blob/569baf98006f61e80ed93c36aa4f8d9ae23011d3/js/keyboard.js
[reference-disk]: https://github.com/jtauber/dromaios-apple2/blob/569baf98006f61e80ed93c36aa4f8d9ae23011d3/js/disk.js
[reference-nibble]: https://github.com/jtauber/dromaios-apple2/blob/569baf98006f61e80ed93c36aa4f8d9ae23011d3/js/nibble.js
[reference-main]: https://github.com/jtauber/dromaios-apple2/blob/569baf98006f61e80ed93c36aa4f8d9ae23011d3/js/main.js
[reference-applesoft]: https://github.com/jtauber/dromaios-apple2/blob/569baf98006f61e80ed93c36aa4f8d9ae23011d3/instruments/applesoft.js
[hardware]: https://www.applelogic.org/files/AIIREF.pdf
[language-card]: https://www.applelogic.org/files/LANGCARDMAN.pdf
[dos-manual]: https://www.applelogic.org/files/AIIDOS.pdf
