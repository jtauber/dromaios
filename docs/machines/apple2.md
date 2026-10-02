# Apple II Plus: target and acceptance plan

The next historical machine is an **Apple II Plus**, using
[dromaios-apple2][reference] as the primary reference for behavior, devices,
browser interaction, and software targets. The initial
[executable chapter](../../src/machines/6502/apple2.md) now boots ROM and runs
BASIC programs with browser text and both graphics resolutions; the full configuration below remains the target.
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
| Inspection | Memory, disassembly, instruction explanations, stack, switches, and disk views. Applesoft listing, variables, execution state, stepping, breakpoints, history, and profiling hooks. | Useful later instruments; inspection must not perform guest device accesses. ROM-specific interpretation belongs to a software guide. |
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
bytes are embedded in Dromaios. The disk audit used:

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| Reference `disks/dos33-master.dsk` | 143,360 | `06075b2b73922cfa292c5c36de5a27b17f9fbf21ef0450a3dc00b53a6bf55d17` |

The reference accepts several ROM lengths permissively. Dromaios verifies the
declared image instead. Browser loading should stay local, as with Altair BASIC;
a rejected selection must preserve the current machine.

## Literate implementation boundaries

The executable machine chapter owns the implemented components, ROM requirements, the
memory map, reset wiring, selected device profiles, and acceptance conversations.
Device chapters will own keyboard, soft-switch, Language Card, and Disk II
state transitions. Shared runtimes should implement reusable operations such
as banked storage or timed transitions; the chapter must supply each machine's
hardware rules. Browser code owns file selection, keyboard events, canvas/audio
delivery, and scheduling host work.

| Need | Existing support and concrete gap |
| --- | --- |
| 6502 with ROM and mapped devices | Implemented through the existing byte bus, with an explicit unanswered-bus policy in the chapter. |
| Caller-supplied ROM | External image declarations require verified bindings before synchronous construction/restoration; snapshots retain ROM identity. Browser selection verifies the complete file before replacement. |
| Keyboard and display switches | Keyboard and display switches generate from device chapters, with state, offers, effects, reset, and snapshots. |
| Banked memory | Fixed maps cover whole components and reject overlap. Language Card read/write routing needs explicit bank/window selection and storage ownership. Develop it when the card is introduced. |
| Video | Read-only generated views own text and graphics addresses, character attributes, colour decoding, and visible rows. The host reads RAM and draws decoded cells; the chapter declares its high-resolution colour-pair approximation. |
| Disk and speaker time | No current machine clock or device scheduler. Define emulated elapsed time and observable transitions before claiming timed disk behavior or producing audio. |
| Inspection | Use captured CPU records and device snapshots. A future mapped-memory preview must have an explicit side-effect-free path; unavailable device bytes must not masquerade as read results. |

Do not copy the reference's CPU, DOM-dependent device logging, or global
instrument registry into the simulation. Keep the existing generated 6502.
Use [machine](definitions.md) and [device](../devices/literate-specifications.md)
generation throughout, choosing new syntax from the smallest concrete need.

Primary hardware references are Apple's [Apple II Reference Manual][hardware],
especially memory/I/O and display descriptions, the [Language Card manual][language-card]
Appendix D, and [The DOS Manual][dos-manual] for software-visible commands.
The reference emulator is evidence to compare, not the authority for unresolved
hardware behavior. In particular, verify Language Card read/write sequences,
power-on state, and decoded address aliases before declaring their contracts.

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

Test both Language Card banks and their shared upper RAM, read/write selection,
write protection, access-direction-sensitive enable sequences, reset, and
snapshot continuation. Match the hardware contract even where it differs from
the reference. Unanswered/floating-bus behavior must have an explicit model and
limitation; the reference's constant zero is not a hardware-accuracy claim.

### 3. Read-only DOS 3.3

Attach slot-6 Disk II and its bootstrap. Cold-boot the pinned System Master
through the controller and on-disk loader, reach its banner/prompt, display the
catalogue through pagination, and `LOAD`/`LIST` the on-disk `HELLO` program.
Then create and run the small arithmetic program again under DOS.

Validate sector order and 6-and-2 encoding with independent known sectors;
an encoder/decoder round trip alone is insufficient. Test head movement,
motor and Q6/Q7 behavior, no media, absent drive 2, and clean media replacement.
Expose write protection until writes are implemented. The browser must remain
responsive during boot and disk polling, and pausing/inspection must not advance
the disk or consume a byte. Any access-driven disk approximation is declared
as such and is not proof of rotational or copy-protection compatibility.

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

These four checkpoints define the first usable Apple II Plus release. The
reference's BASIC-analysis instruments and an Ultima IV boot/play/save session
can follow, with separately selected acceptance criteria. They do not postpone
the basic emulator's completion.

## Next implementation slice

Continue checkpoint 2 with **Language Card banking**: an executable device
chapter for its selection and write-enable latches, plus declarative routing
between ROM and the two lower RAM banks and shared upper RAM. Verify the
access-direction-sensitive enable sequence against hardware sources and test
independent read/write routing, reset, and snapshot continuation before Disk II.

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
