# Apple II Plus: BASIC, graphics, and DOS

The Apple II Plus pairs a MOS 6502 with memory-mapped input and display hardware.
Unlike the Altair's serial terminal, its text output lives in RAM, where video
hardware fetches character codes. Applesoft and the Autostart Monitor occupy
the upper 12 KiB of the address space.

This is the first native composition in the [Apple II Plus plan](../../../docs/machines/apple2.md):
48 KiB of main RAM, caller-supplied firmware, the keyboard latch, and text and
graphics displays, plus a 16 KiB Language Card and an optional slot-6 Disk II.
It runs BASIC and boots the selected DOS 3.3 System Master from a local,
read-only disk image. Disk writes and sound remain future work.
The main reference is the pinned [dromaios-apple2 implementation][reference];
Apple's [Reference Manual][manual] supplies the hardware background.

## Components and address decoding

Main RAM fills 0000–BFFF; page-one text uses 0400–07FF within that same storage.
The [keyboard chapter](../../components/devices/specifications/apple2-keyboard.md)
owns character/strobe state and all C000–C01F aliases. The
[video chapter](../../components/devices/specifications/apple2-video.md) owns
C050–C057 display switches, interleaved display addresses, character attributes,
and low- and high-resolution colour decoding.
The [Language Card chapter](../../components/devices/specifications/apple2-language-card.md)
owns C080–C08F selection and write-protection latches. Two 4 KiB RAM banks
share D000–DFFF, followed by 8 KiB of common RAM at E000–FFFF. ROM supplies
reads at power-on; RAM can receive writes behind it. The windows below select
the first matching rule independently for reads and writes. The common upper
window includes interrupt and reset vectors, so enabling RAM reads also selects
the vectors stored in RAM. Disk II uses C0E0–C0EF for control and C600–C6FF
for its bootstrap. The device starts uninstalled: without a host-supplied
bootstrap, both windows are unanswered and the Monitor falls through to Applesoft.

```machine
components {
    ram = ram C000
    keyboard = apple2-keyboard
    video = apple2-video
    firmware = rom 3000
    language = apple2-language-card
    bank1 = ram 1000
    bank2 = ram 1000
    upper = ram 2000
    disk = apple2-disk-ii
}

map 10000 {
    0000 = ram
    C000 = keyboard
    C050 = video
    C080 = language
    C0E0 = window 10 {
        read = disk
        write = disk
    }
    C600 = window 100 {
        read = disk offset 100
        write = discard
    }
    D000 = window 1000 {
        read = bank2 when language.ramRead and language.bank2
        read = bank1 when language.ramRead
        read = firmware
        write = bank2 when language.ramWrite and language.bank2
        write = bank1 when language.ramWrite
        write = discard
    }
    E000 = window 2000 {
        read = upper when language.ramRead
        read = firmware offset 1000
        write = upper when language.ramWrite
        write = discard
    }
    unmapped = 00
}
```

Unanswered reads return 00 and unanswered writes are discarded. Protected
Language Card writes are discarded; enabled writes change the selected RAM
even while reads still see ROM. Firmware bytes never change. This explicit byte-bus policy is an approximation, not a model
of the Apple II video scanner's floating bus. Unimplemented soft switches have
no effect. Programs that depend on them are outside this initial composition.

## Firmware supplied by the caller

The executable declaration identifies the exact 12,288 bytes mapped at D000.
No firmware bytes are downloaded, generated, or committed here.

```machine
image firmware external sha256 378ba00c86a64cca49cedaca7de8d5d351983ebc295d9d11e0752febfc346249
```

The generated module exports `romImages.firmware` (size and SHA-256). The host
uses `RomImage.verify` with its SHA-256 implementation before calling
`create6502Apple2({ firmware })`. To allocate hardware before firmware is
available, use `create6502Apple2({ firmware: null })`. RAM and devices exist
immediately; `machine.firmware.loaded` is false. The empty ROM connection
returns an unanswered transfer, which the declared bus resolves to 00. This is
absence of firmware, not a stored zero-filled ROM image.

After verification, `machine.firmware.install(firmware)` installs an owned,
immutable image without replacing RAM, resetting the CPU, or changing devices.
Call `machine.reset()` separately to read the reset vector and prepare to boot.
Factories remain synchronous. These operations are also described in the
[external ROM contract](../../../docs/machines/definitions.md#external-rom-images).

The reference's `roms/apple2p.rom` is a container. This record gives its byte
count, SHA-256, and the decimal offset of the mapped ROM, followed by the
Disk II bootstrap slice and selected DOS disk identity. The browser uses this
record directly; none of these files is bundled with the site:

```json
{
  "bytes": 20480,
  "sha256": "92c4bef609920842ea472d21b661a0d35dbda6cd90963b8b734a205e22d84108",
  "offset": 8192,
  "bootstrap": {
    "bytes": 256,
    "sha256": "de1e3e035878bab43d0af8fe38f5839c527e9548647036598ee6fe7ec74d2a7d",
    "offset": 1536
  },
  "disk": {
    "bytes": 143360,
    "sha256": "06075b2b73922cfa292c5c36de5a27b17f9fbf21ef0450a3dc00b53a6bf55d17"
  }
}
```

A host accepting that file must validate the **whole file** before extracting
hexadecimal offsets 2000–4FFF, then verify the normalized image above. The exact 12 KiB image
is also accepted directly. Other sizes or altered files are rejected before
replacing an existing machine.

Disk boot also extracts the 256-byte P5 bootstrap at container offsets
0600–06FF and verifies its separate digest. The browser's disk option requires
this container; a bare 12 KiB motherboard image still supports ROM-only use.
The selected disk is the reference's `disks/dos33-master.dsk`. Its size and
whole-file digest above are checked before insertion. The host calls
`disk.install(bootstrap)` and `disk.insert(new Dos33Disk(bytes))`; those focused
device methods own copies of their inputs. The generated machine needs no
Disk II-specific construction code.

## Construction, reset, and restoration

Construction provides zero-filled RAM and deterministic CPU, keyboard, display,
Language Card, and disk-controller state.
It does not execute or reset the CPU. Call `reset()` to perform the processor's
real reset-vector reads at FFFC and FFFD; at power-on these read ROM, which
points to FA62. Later resets follow the card's current RAM/ROM selection.
The initial PC below is not a shortcut into the ROM.

```machine
cpu 6502 {
    A = 00  X = 00  Y = 00
    PC = 0000  SP = FF
    flags { N = 0  V = 0  D = 0  I = 0  Z = 0  C = 0 }
}

reset { cpu }
```

CPU reset preserves RAM, firmware, the keyboard latch, display switches, all
Language Card latches, and the disk controller, head, and stream position. It follows the
[6502 reset contract](../../components/cpus/specifications/6502.md#reset-and-instruction-boundaries),
including its stack-pointer and interrupt-mask changes. Firmware may then
clear the strobe and initialize its own workspace. Fresh construction, followed
by reset, represents power-on in this deterministic model.

`snapshot()` captures CPU, all four RAM components, keyboard, display and Language Card latches,
the disk controller with its bootstrap and media bytes, and the firmware digest
(or `null` when not installed). Restoration requires a matching binding: the
same verified image for a digest, or `null` for absence. It creates independent
hardware without resetting or executing. Snapshot inspection performs no
guest device reads. There is no generic safe preview of mapped I/O: inspect
device snapshots and read-only views, and read RAM or ROM directly instead.

## Using the browser machine

The **classroom** presents this guide alongside an embedded machine. Its
**laboratory** link opens a separate dark workspace with the screen, CPU and
instruction preview, execution history, memory, stack, and Disassembly/Changes/ROM/System/Disk tools.
Panels can be moved, resized, grouped into tabs, or collapsed to their headers.
Moving a standalone panel within a row or column reorders it without changing
the panels' sizes. Drop between panels at the insertion line, or use **Arrange
panels** with **Above**, **Below**, **Left of**, or **Right of**. Each divider
resizes only its two neighbours.
Closing a panel hides its tool; it does not stop the machine or its capture.
**Reset layout** restores the arrangement while preserving the current experiment.
Each inspector header has a **Live** toggle: a green square enables automatic
updates during Run; an empty square holds that view. Pause, Step, and opening a panel
refresh it regardless of Live. Its own navigation and filtering controls also
refresh on demand. These switches never stop execution or history capture, and
are remembered separately from the layout. All inspectors start Live except Memory.
The screen and machine/media controls always stay current.
The **Execution** panel contains Run, Pause, Step, Reset CPU, Fresh power-on,
the instruction count, and status messages. Below Screen, it shares a narrow
column with MOS 6502 and Instruction; Disassembly spans the height beside them.
It can be moved, collapsed, or reopened through **Panels**, like the other tools.
The screen accepts typing and pasting
directly, including Enter and Ctrl-C; the classroom also has an explicit keyboard
field. Disassembly owns run-to-address and run-to-routine controls; ROM owns firmware
selection and its searchable Monitor reference, with PC/Memory following and
navigation to the other inspectors. Browsing a reference entry never executes it;
the [ROM guide](../../../docs/software/apple2p-rom.md#exploring-the-rom-reference)
owns the annotation and mapping contracts.
Both use the same machine implementation, but each page starts its own session.
Hardware is created immediately, before any ROM selection. RAM, stack memory,
registers, and device state are inspectable in their deterministic initial state:
RAM is zero, PC is 0000, and SP is FF; no reset has occurred. The screen also
reflects this uninitialized text RAM: zero is an inverse `@` character, until
firmware fills the display. The browser's Run, Step, keyboard, and Reset CPU
controls wait for verified firmware; Fresh power-on is available without it.
This is a host boot workflow, not a hardware requirement for executing code in RAM.
The laboratory's memory and **Disassembly** views read mapped storage without operating
devices; `--` denotes unavailable bytes, including soft switches. Disassembly's
**PC / MEM** header toggle selects the next instruction or Memory's selected
address, while **Execution history** preserves the
bytes actually fetched. The [live disassembly guide](../../../docs/software/apple2p-rom.md#live-disassembly)
explains navigation and address stops.

Memory's **FIX / PC / CHG** header toggle controls its position. **FIX** starts
at a fixed address. **PC** keeps the next instruction's address visible;
**CHG** follows the last byte of visible RAM actually
changed by an executed instruction, including earlier instructions in a running
batch and writes captured while Changes recording is off. Hidden Language Card
writes, unchanged stores, and device accesses do not move it. A later bank switch
can hide its last target; the inspector waits for a visible changed byte.
Zero page, Memory, and the full stack page each have a compact **8 / 16**
header toggle for bytes per row, remembered separately. Reformatting preserves
held values and change highlights. Memory scrolls through the complete 64K
address space, rendering only the visible rows and a small margin. Its header
address field selects a byte on Enter; scrolling selects the first visible row.
Both return to Fixed. With Live off, even newly scrolled rows come from the
same captured storage image; scrolling does not read newer machine values.

Following moves the viewport only when the target leaves it, aligning the
new start to the selected row width and stopping at FFFF. Following controls
position independently of Live: with Live off, the viewport catches up when
paused, stepped, or explicitly refreshed. Reset, fresh power-on, and successful
media replacement forget the last change target but keep the following mode;
fixed views retain their address. Position and mode last for this visit.

**Stack** shows one byte per line from SP+1 through 01FF, with the next pull
marked. This is a conventional view above SP, not a claim that the 6502 tracks
stack depth: wrapping and software writes can use any byte in page 01. **PAGE**
shows all 256 bytes, including the next push slot. The status gives both push
and pull addresses, wrapping the pull within page 01.

**Instruction** previews the next instruction's register and flag changes,
write requests, destination PC, and ordered memory accesses. For conditional
branches it names the flag and required value, shows the current value, and
explains whether the branch is taken. Conditions come from the CPU chapter;
BEQ tests Z, without assuming which earlier instruction set it.
It runs a copy of
the generated CPU against storage observations and private RAM writes; it never
executes on the guest machine. Device or unavailable reads stop the preview
with an explicit explanation. Writes to mapped devices are shown as requests,
without predicting peripheral effects. This keeps instruction behavior owned
by the CPU specification while **Execution history** describes actual execution.

Execution history lists the latest twelve captured instructions, newest first,
and shows the selected instruction's register/flag changes and ordered memory
accesses. **Follow latest** initially selects the newest step. Selecting an entry
pins its record, including when it leaves the recent twelve; the view labels
that case and retains only that one extra record. Follow latest resumes tracking.
Selection never executes an instruction or changes the live inspectors. Reset,
fresh power-on, and successful media replacement clear this selection and history;
failed replacements leave them intact. Execution history and Changes start in one
tab group, but either can be docked separately.

Register and flag highlights compare the last completed instruction's recorded
before-and-after values, including flags cleared to zero. They remain visible
while paused, with the old value on hover, until the next instruction replaces
them. While running, only the latest completed instruction is represented.
Reset, fresh power-on, and an execution error clear the highlights; the values
themselves always show the current processor state.

The laboratory's zero page, stack page, and memory window use the same
last-instruction highlight and previous-value tooltip for changed RAM bytes.
Overlapping windows highlight the same byte consistently. The highlights
remain when browsing memory or clearing or pausing the log, and are replaced
by the next instruction. They reflect actual stores to the visible RAM bank;
a bank switch alone does not highlight newly visible bytes, and writes behind
ROM do not highlight the ROM. Multiple stores to one byte compare its first
before-value with its final value, so a byte restored by the instruction is
not highlighted. Reset, fresh power-on, and execution errors clear these
highlights along with those on the processor.

The laboratory's **Changes** records every instruction while **Record changes** is
enabled, including steps between display refreshes and while another tab is
selected. It retains the latest 500 recorded instructions, newest first, and
reports how many older instructions were discarded. Each group identifies the
instruction's starting address and fetched bytes decoded as assembly. Register,
flag, and PC changes compare instruction boundaries; memory changes preserve
the order of actual stores. Values are hexadecimal, with flags shown as 0 or 1.
RAM observation captures the old byte at the store itself, without a guest
read. Language Card bank 1, bank 2, and common upper RAM are labeled separately,
even when writes occur behind mapped ROM. Unchanged stores, ignored ROM writes,
and device accesses are not RAM changes; device state remains in **System**.
Filters change only the display, not capture. Pausing recording preserves the
history while execution continues; instruction numbers leave gaps for unrecorded
steps. **Clear log** restarts numbering. Reset, fresh power-on, and successful
ROM or disk replacement clear the history. A failed replacement preserves it.
Execution errors retain completed effects, marked as interrupted if no complete
CPU record was returned; they are not presented as successful instructions.

The browser also provides **Explore the ROM**, with recorded instructions,
register and flag changes, memory accesses, and one-shot address or ROM routine
stops. Follow the [ROM walkthrough](../../../docs/software/apple2p-rom.md#rom-walkthrough)
from reset to the Applesoft prompt, then trace a keypress to its screen write.
The software guide owns the versioned labels and walkthrough; these do not
change the machine's wiring or firmware execution.

Use **Load ROM…** to choose the matching local file, then **Run**. The file
picker stays hidden behind the button; the separate loaded-file status identifies
the installed ROM, including one restored from browser storage. Once loaded,
the button becomes **Replace ROM…**. Disk selection uses the same Load/Replace
pattern. Canceling a picker or rejecting an invalid file retains the loaded media.
Nothing is uploaded or fetched.
The browser remembers the verified file in local storage, including the Disk II
bootstrap when the selected file is the 20 KiB container. On later visits, both
the classroom and laboratory reverify that saved copy and prepare a fresh,
paused machine automatically. This is shared within the same browser and site;
the local preview and public site have separate storage. **Forget saved ROM**
removes that copy without unloading firmware from an already open machine.
If storage is unavailable or the saved copy fails verification, a message explains
the failure and you can still choose a local file. A rejected file selection does
not replace the saved ROM.

Wait for the `APPLE ][` banner and Applesoft's `]` prompt, click the keyboard
field, and type `PRINT 2+3`, then Enter. The reply is `5`. The display reads the
same RAM the CPU writes; output does not pass through a host BASIC interpreter.

Try a stored program, entering one line at a time and waiting for the next prompt:

```text
20 END
10 PRINT 2+3
LIST
RUN
```

LIST puts line 10 before line 20; RUN prints 5. Lowercase letters become uppercase
before delivery to the original seven-bit keyboard. Backspace or Left Arrow
backs up over a character; Right Arrow reuses the character under the cursor.
Enter and Control-C have buttons as well as keyboard shortcuts. Escape is passed
to the firmware. Paste accepts one ASCII line with an optional final newline;
multiple lines and non-ASCII text are rejected as a whole. There is no local echo:
the ROM decides how keys affect the screen.

The host queues at most 4,096 characters and offers them through the hardware
latch. Queued keys are delivered only during execution. **Pause** freezes the CPU
and flashing phase; **Step** executes one instruction. **Run** resumes in bounded
batches, with no claim of original-machine speed. Hiding the page pauses it;
returning requires Run. Inspection reads CPU records, snapshots, and RAM without
acknowledging keys or changing display switches.

**Reset CPU** discards the host input queue and performs the reset-vector reads,
preserving RAM and device latches immediately. The firmware's subsequent actions
are separate from that reset. **Fresh power-on** replaces the machine with empty
RAM and fresh devices using the retained verified ROM and selected disk; the old program is lost.
A failed ROM selection preserves the previous machine, paused. A successful
first selection installs firmware into the existing hardware, then resets the
CPU without changing RAM or devices. Selecting a ROM again prepares a fresh,
paused machine, as does disk selection. Refreshing or leaving the page loses
the current experiment unless you explicitly save it in the laboratory. The ROM
is remembered independently; saved states never resume automatically.

For DOS, open **Boot DOS 3.3 from disk** and choose the matching local image.
A successful selection replaces the running machine with a fresh, paused disk
configuration. A rejected file preserves the previous machine, paused. **Run**
then boots DOS; **Fresh power-on** retains the selected disk and starts it again.
**Eject disk** pauses and removes the medium while preserving RAM and controller
latches. Run can continue resident software, but disk reads cannot complete
without media. Fresh power-on after eject returns to ROM-only Applesoft.
Replacing the ROM clears the disk selection. All media stays on your computer.

Both text pages support normal, inverse, and flashing characters, using the
same bitmap character set as dromaios-apple2. Text remains selectable. The
**Scanlines** control toggles the display effect, including while paused.
**Monochrome** switches text and graphics to a green display; both controls work
independently, redraw while paused, and leave the machine state unchanged.
Low-resolution graphics draws coloured blocks; high-resolution graphics uses
the reference's approximate colour pairs. Mixed mode keeps four text rows. The
video chapter defines those choices, the RGB palettes, and host flashing.

### Saving and comparing an experiment

The laboratory's **Saved states** panel stores named experiments in this
browser and site origin. Pause, give the state a name, and choose **Save new
state**. Each state includes the complete hardware snapshot, the host keyboard
queue, selected disk name, and paused flashing phase. Main RAM, both Language
Card banks and common upper RAM are included even when hidden by the current
mapping. Panel arrangement, watches, breakpoints, and display preferences belong
to the workspace and are not part of the saved machine.

**Restore** checks the saved machine version, complete component state, firmware
identity, and any stored bootstrap/disk identities before replacing the current
experiment. Load the matching verified ROM first; its bytes are not duplicated
inside a saved state. Restoration executes no instruction or reset and always
leaves the machine paused. It clears executed-instruction history, the Changes
log, observed calls, device activity, last-writer attribution, and temporary
run-to requests. The instruction counter restarts at zero. Layout and saved
breakpoint/watchpoint preferences remain; Fresh power-on uses the restored
experiment's media selection. Invalid data or failed verification leaves the
current machine and its queued input untouched.

**Compare** captures saved → current differences while paused: registers,
flags, physical RAM bytes, device fields, and the host input queue. It does not
change either machine. This is a net comparison, so a byte changed and then
restored to its saved value is absent. Memory links browse the current mapped
bank; a link to hidden Language Card RAM explains the mismatch without changing
mapping. Large differences show 128 RAM bytes at a time, with **Show more** for
the rest. The result stays a captured comparison until Compare is pressed
again; replacing the machine clears it. Use the Changes log for instruction
attribution.

Saved states survive reloads but do not replace the machine until Restore is
pressed. Names must be unique. **Delete saved state** removes only the selected
saved copy; it does not affect the current machine. A failed save reports the
storage problem and retains existing states. Browser storage limits apply,
especially to states containing disk images. Clearing this site's browser data
removes the states. Incompatible future machine versions are rejected rather
than partially restored.

A repeatable ROM experiment: stop at KEYIN2 (`FD21`), type A while paused, and
save before executing BIT. Step twice, then Compare: the queue has delivered
its character, the keyboard strobe is set, flags reflect BIT, and PC has passed
the branch. Restore, then repeat those steps; the same results should appear.
A reload followed by Restore must reproduce the same continuation.

## Drawing with Applesoft

At the Applesoft prompt, type `NEW` to clear the earlier program, then enter
these lines one at a time. `RUN` draws sixteen horizontal colour bands, a white
vertical line at the lower left, and a white block at the lower right:

```basic
10 GR
20 FOR C=0 TO 15
30 COLOR=C
40 HLIN 0,39 AT C*2
50 HLIN 0,39 AT C*2+1
60 NEXT C
70 COLOR=15
80 VLIN 32,39 AT 0
90 PLOT 39,39
100 PRINT "16 COLOURS"
110 END
```

`GR` selects the primary page in mixed low-resolution mode and clears its
40-by-40 graphics area. Each byte holds two blocks, so the two HLIN commands
fill one complete byte row with the chosen colour. VLIN and PLOT alter only
the selected blocks. The bottom four text rows show the caption and prompt.
The acceptance test enters this exact fenced program into the real interpreter
and checks every graphics block, with no drawing commands executed by the host.

`TEXT` returns to text mode. Switching does not erase graphics memory: its bytes
can become unusual characters until the firmware overwrites them. Pause and
Step work in graphics as in text; observing a frame changes no guest state.

The hardware supports a second page and full-screen low-resolution graphics.
BASIC's ordinary drawing routines still use the primary page; changing the
PAGE2 display switch alone does not redirect their writes. **Page two overlaps
Applesoft program storage**, so arbitrary POKEs there can damage the program.
The checks temporarily change 0800 (the leading zero byte required by Applesoft)
and 0BF7 (beyond this short program), select the second page through C055, and
verify the upper and lower nibbles. C052 then reveals the bottom eight block
rows; C054 and C053 restore page one and mixed mode. The check restores 0800
to zero before running the program again. All of these changes pass through real CPU accesses.
The video chapter owns the addresses, mode rules, and colour interpretation.

## Drawing at high resolution

Type `TEXT`, then `NEW`, and enter this program one line at a time. `RUN` draws
five narrow bands: green, violet, white, orange, and blue. The gap between white
and orange is a sixth, black band against the black background.

```basic
10 HGR
20 FOR C=1 TO 6
30 HCOLOR=C
40 FOR Y=C*20 TO C*20+7
50 HPLOT 14,Y TO 265,Y
60 NEXT Y
70 NEXT C
80 PRINT "HIGH RESOLUTION"
90 END
```

`HGR` clears the first high-resolution buffer and selects mixed mode. `HPLOT`
draws a dot or a line between coordinates; here it draws horizontal lines.
`HCOLOR` uses a different numbering from low-resolution `COLOR`: 0 and 4 are
black, 1 green, 2 violet, 3 and 7 white, 5 orange, and 6 blue. The two groups
differ in the byte's phase bit. The [video chapter](../../components/devices/specifications/apple2-video.md#colour-hardware-and-the-chosen-approximation)
explains how dots become colour and the renderer's approximation.

Now type `HGR2`, then `HCOLOR=3`, then `HPLOT 0,191 TO 279,191`. These clear the
second high-resolution buffer, select full-screen graphics, and draw a white
line at its bottom edge. Full-screen graphics hides the prompt; the keyboard
still accepts commands. `POKE 49235,0` selects mixed mode and hides those last
32 graphics lines. `POKE 49236,0` switches back to page one, revealing the
earlier bands. Neither switch clears a buffer or redirects subsequent HPLOT
drawing: Applesoft's drawing-page choice is separate from the display switch.
`TEXT` restores the text display, and `RUN` draws the first program again.

Both graphics buffers occupy main RAM. This short program stays below 2000;
larger programs and variables need a memory plan to avoid overwriting graphics
or being overwritten by them. The [graphics acceptance test](../../../tests/site/apple2-graphics.test.ts)
runs the exact published program through Applesoft, checks independently
specified byte patterns and every displayed colour pair, and exercises page
and mode changes without modifying the firmware.

## Booting DOS 3.3

The Disk II controller leaves much of the work to software. Its small slot ROM
finds and reads the first disk sectors; code loaded from those sectors loads
DOS; DOS runs the disk's HELLO program. In this machine the same 6502 executes
every stage. No host routine intercepts a ROM call or supplies a DOS command.

Select the ROM container and System Master, then Run. Wait for
`DOS VERSION 3.3` and the System Master banner. HELLO detects the Language Card
and loads Integer BASIC into it before returning to the Applesoft `]` prompt.
This takes substantially longer than a ROM-only boot; the browser yields
between bounded instruction batches so Pause remains available.

Enter `CATALOG`. DOS shows `DISK VOLUME 254` and entries including
`*A 006 HELLO` and `*A 009 COLOR DEMOSOFT`. A full screen pauses the catalogue:
press Enter to continue until `]` returns. Then enter these commands separately:

```text
NEW
LOAD HELLO
LIST
```

LIST displays the program from disk, including the Language Card detection
and `BLOAD INTBASIC,A$D000` command. Next use `NEW`, enter the earlier two-line
arithmetic program, and try LIST and RUN again. DOS and Applesoft work together;
RUN still prints 5. `SAVE TEST` must instead report `WRITE PROTECTED`. This
milestone cannot save or export disk changes, and never alters the selected file.

## Disk II controller and media profile

The machine fence above owns slot placement. A focused
[TypeScript controller](../../components/devices/apple2-disk-ii.ts) owns the
switch effects; [DOS-order media](../../components/devices/dos33-disk.ts) owns
sector encoding. These remain ordinary device implementations while we gather
more peripheral examples. The machine description does not require a new
general language for rotating media.

Each access first selects its switch, whether the CPU reads or writes:

| Slot-6 address | Effect |
| --- | --- |
| C0E0–C0E7 | Four pairs: phase 0 off/on, phase 1 off/on, phase 2 off/on, phase 3 off/on. |
| C0E8 / C0E9 | Motor off / on. |
| C0EA / C0EB | Select drive 1 / drive 2. Only drive 1 exists in this profile. |
| C0EC / C0ED | Q6 low / high. |
| C0EE / C0EF | Q7 low / high. |

Q7 selects read or write operation; Q6 selects shifting or loading/sensing:

| Q7 | Q6 | Modeled result |
| ---: | ---: | --- |
| 0 | 0 | Reading C0EC consumes one disk byte. Other even-address reads sample the current latch. |
| 0 | 1 | Even-address reads return 80: the medium is write protected. |
| 1 | 0 | The latch is retained; no bytes are written to the medium. |
| 1 | 1 | CPU writes load the latch, but the protected medium still cannot change. |

Odd addresses do not drive the data bus; this model returns 00. In particular,
DOS senses protection by reading C0ED and then C0EE: the first access selects
Q6 high, and the second supplies bit 7. Reporting protection only on C0ED would
miss DOS's actual test. This follows Sather's controller explanation and RWTS
listing in [Understanding the Apple II][disk-hardware], rather than the
reference emulator's writable indication.

The controller stores the selected drive (initially 1), motor/Q6/Q7 booleans
(all initially false), phase (0), half-track position (0), byte-stream position
(0), and data latch (00). Bootstrap and media start absent. CPU reset preserves
all of these. Snapshot restoration validates the fields, owns the bootstrap
and disk data, and resumes at the same byte without executing a guest access.
`inspect()` reveals control state without copying the medium or advancing it.
Insertion and eject reset the byte position and latch, preserving head and controls.

The selected image has 35 tracks of sixteen 256-byte sectors in DOS file order.
The encoder builds address fields containing volume 254, track, physical sector,
and XOR checksum using four-and-four encoding. Physical sectors 0–15 draw from
file sectors 0, 7, 14, 6, 13, 5, 12, 4, 11, 3, 10, 2, 9, 1, 8, 15. Each data
field separates the high six bits of every byte from its reversed low-bit pair.
Three groups of low pairs pack into 86 auxiliary values; those precede the 256
high-bit values. An XOR chain and the 64-entry disk-byte translation table
produce 343 encoded bytes, including the checksum. Address and data prologues,
epilogues, and fixed FF gaps make a circular 6,162-byte track stream.

This is deliberately an **access-driven byte model**. With motor on, drive 1
selected, and media present, C0EC reads advance that stream. Pausing or
inspecting never advances it. Reading without those conditions returns 00
without consuming data; absent drive 2 cannot borrow drive 1's stream or move
its head. Selecting a drive clears the data latch. Motor-off is immediate,
without the real drive's delay or the reference's browser-frame countdown.

Head movement follows the reference's simplified phase sequence: energizing
an adjacent phase moves one half track; the phase-difference table resolves
opposite phases. Phase-off accesses do not move the head. The range is clamped
to tracks 0–34; odd half tracks read the lower whole track. This is not a model
of simultaneous phase currents, head settling, rotational speed, bit timing,
the sequencer, or flux transitions. Custom formats, copy protection, other disk
sizes, disk writes, and drive 2 are outside this profile. Successful DOS reads
establish the stated software checkpoint, not those stronger hardware claims.

## Headless acceptance

[Synthetic tests](../../../tests/machines/6502/apple2.test.ts) exercise the
generated map using independently supplied ROM code: real reset-vector reads,
keyboard polling and acknowledgement through CPU instructions, recorded bus
accesses, ROM immutability, reset preservation, and snapshot continuation.
The [Language Card checks](../../../tests/machines/6502/apple2-language-card.test.ts)
exercise bank isolation, shared upper RAM, protection, writes behind ROM,
restoration between enable reads, and RAM-selected reset vectors. A short
6502 program probes and copies banks while executing from main RAM.
The synthetic definition uses its own declared digest; it cannot impersonate
this firmware binding.

The [external-ROM test](../../../tests/machines/6502/apple2-rom.test.ts) boots
the selected firmware without the reference emulator's devices or routine traps.
It checks the APPLE ][ banner and Applesoft prompt, enters a stored two-line
program out of order, checks ordered LIST output, and executes RUN to print 5.
It also checks a line-editing backspace, Control-C from a loop, and independent
continuation from a hardware snapshot. A CPU copy loop then reads all 12 KiB
of firmware into RAM behind ROM, selects the protected RAM copy, and returns
to Applesoft there. `PRINT 6*7` must still print 42; a subsequent reset must
fetch the copied reset vector. This exercises real code in banked RAM, beyond
latch inspection. Characters pass through the generated
keyboard; output is decoded from RAM, not intercepted at a ROM routine.

```sh
APPLE2_ROM=/path/to/apple2p.rom node --test dist/tests/machines/6502/apple2-rom.test.js
```

Set the same variable for `npm test` to include the real-ROM acceptance run.
Without it, that test is explicitly skipped; synthetic machine, device, and
media-verification checks still run. No test downloads firmware.

The [disk acceptance test](../../../tests/site/apple2-disk.test.ts) uses the
same host media verification and keyboard queue as the browser. It cold-boots
DOS, restores and compares instruction records while the bootstrap is reading,
finishes CATALOG pagination, clears BASIC before LOAD/LIST HELLO, and runs the
arithmetic program under DOS. SAVE must report protection and leave every media
byte unchanged. Reset, eject, and fresh power-on check media retention separately.

```sh
APPLE2_ROM=/path/to/apple2p.rom APPLE2_DISK=/path/to/dos33-master.dsk npm test
```

This test requires the 20 KiB ROM container and is explicitly skipped when either
variable is absent. The [encoding vectors](../../../tests/components/devices/dos33-disk.test.ts)
independently specify sector order, address fields, low-pair packing, shortened
auxiliary groups, and checksums. [Controller checks](../../../tests/components/devices/apple2-disk-ii.test.ts)
cover switch direction, circular reads, head bounds, sense/write modes, missing
media/drive, snapshot continuation, and invalid input without depending on firmware.

For these checks, text rows use the independently transcribed page-one base
addresses 0400, 0480, …, 0780; 0428, 04A8, …, 07A8; then 0450, 04D0, …, 07D0.
Each row contains forty characters. Low six bits select the original uppercase
character set; inverse/flashing attributes are retained in RAM but not rendered
by this test. The independent [video tests](../../../tests/components/devices/apple2-video.test.ts)
check both pages and all attributes. The [browser-session tests](../../../tests/site/apple2.test.ts)
use the production file verifier, keyboard queue, scheduler, and frame decoder
with the real ROM, including paste, editing, stored programs, pause/resume, and
Control-C. Manual browser checks also cover file selection, keyboard focus,
reset/power-on, failed replacement, page hiding, and wide/narrow layouts.

[manual]: https://www.applelogic.org/files/AIIREF.pdf
[reference]: https://github.com/jtauber/dromaios-apple2/tree/569baf98006f61e80ed93c36aa4f8d9ae23011d3
[disk-hardware]: https://archive.org/details/understanding_the_apple_ii
