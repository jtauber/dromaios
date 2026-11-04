# Apple II Plus: BASIC, graphics, and DOS

The Apple II Plus pairs a MOS 6502 with memory-mapped input and display hardware.
Unlike the Altair's serial terminal, its text output lives in RAM, where video
hardware fetches character codes. Applesoft and the Autostart Monitor occupy
the upper 12 KiB of the address space.

This is the first native composition in the [Apple II Plus plan](../../../docs/machines/apple2.md):
48 KiB of main RAM, caller-supplied firmware, the keyboard latch, and text and
graphics displays, plus a 16 KiB Language Card and an optional slot-6 Disk II.
It runs BASIC and boots the selected DOS 3.3 System Master. The laboratory
mounts local DOS-order images read-only or as writable copies. DOS can save an
Applesoft program and load it after a fresh boot from the exported disk.
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
The classroom verifies the size and whole-file digest of the reference's
`disks/dos33-master.dsk`. The laboratory also accepts other 143,360-byte
DOS-order images, including its own exports. It identifies the verified
System Master when the bytes match the declared digest. The host calls
`disk.install(bootstrap)` and `disk.insert(new Dos33Disk(bytes))` for protected
media. Passing `{ writable: true }` to the disk constructor creates a writable
copy. `disk.exportImage()` returns an independent DOS-order byte image of the
mounted disk.

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
selected. It retains the latest 500 events (instructions or explicit RAM edits),
newest first, and reports how many older events were discarded. Each CPU group identifies the
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

### Editing RAM

In the laboratory, **EDIT** in Memory, Zero page, or Stack enables byte editing
while paused. Select a byte, enter a hexadecimal value from `00` to `FF`
(an optional `$` is accepted), and choose **Apply** or press Enter. Cancel or
Escape discards the draft. In named Zero page, **Bytes** exposes each byte of a
workspace value, low byte first. Outside Edit mode, byte clicks retain their
usual watch action; the explicit **Watch** links also remain available in Names.

Edits write the physical RAM currently displayed: main RAM, the selected
Language Card bank, or its common upper RAM. ROM, bootstrap, and device addresses
are read-only. A debugger edit can change visible Language Card RAM even when
CPU writes are protected; it neither changes that protection nor operates the
guest bus. The editor rejects a draft whose byte, mapped bank, or machine has
changed. Starting Run or selecting media leaves Edit mode and cancels its draft.
RAM editing is available even without firmware.

A changed byte clears execution history, observed calls, device activity,
temporary execution targets, and screen-writer attribution, and restarts the
instruction count. Changes starts a new history with **User RAM edit**, naming
the physical bank and before/after values without inventing an instruction
address. This explicit action is recorded even with instruction recording off.
An unchanged value has no effect on history. Other RAM, registers, device
latches, queued keyboard input, and saved states are preserved. Save an
experiment first to restore it after editing; the
[cursor walkthrough](../../../docs/software/apple2p-rom.md#rom-walkthrough)
demonstrates this with the Monitor's `CH` workspace byte.

### Saving and comparing an experiment

The laboratory's **Saved states** panel stores named experiments in this
browser and site origin. Pause, give the state a name, and choose **Save new
state**. Each state includes the complete hardware snapshot, the host keyboard
queue, mounted disk bytes, filename, write permission, and paused flashing phase. Main RAM, both Language
Card banks and common upper RAM are included even when hidden by the current
mapping. Panel arrangement, watches, breakpoints, and display preferences belong
to the workspace and are not part of the saved machine.

**Restore** checks the saved machine version, complete component state, firmware
identity, and any stored bootstrap/disk identities before replacing the current
experiment. Version 2 saves the SHA-256 of the disk at capture time, so a
file written by DOS survives restoration. Version 1 states still verify their
disk against the original System Master digest. Load the matching verified ROM first; its bytes are not duplicated
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
restored to its saved value is absent. For mounted disks, Compare shows a
change in write permission and the first file byte that differs. Memory links browse the current mapped
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
and [loads Integer BASIC into it](#how-hello-loads-integer-basic) before returning to the Applesoft `]` prompt.
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
RUN still prints 5. On the protected System Master, `SAVE TEST` reports
`WRITE PROTECTED`.

### From slot 6 to the first instruction on disk

In the laboratory, load the 20 KiB Apple II Plus ROM container and insert
the DOS 3.3 System Master read-only. Choose **Fresh power-on** and leave
the CPU paused. In **Walkthrough**, select **Booting from slot 6** and choose
**Run to checkpoint**. Use **Next** and **Run to checkpoint** to follow
the boot from the Monitor through the DOS loader's 27 reads. No keystrokes are needed.

| Disk | Command | Stop | PC | Last observation | Inspect RAM | What to look for |
| --- | --- | --- | --- | --- | --- | --- |
| Disk II | Boot | The Monitor enters slot 6 | $C600 in slot 6 | JMP ($0000) at $FAD2 | $0000 | The pointer contains 00 C6. Browse code to see LDX #$20, the first instruction in the Disk II card's ROM. |
| Disk II | Boot | The first sector is in RAM | $C6F8 in slot 6 | T0 S0 in RAM at $0800 after $C6F6 | $0800 | All 256 bytes at $0800–$08FF match the disk. The next instruction, JMP $0801, is still in the card's ROM. |
| Disk II | Boot | Disk code takes control | $0801 | JMP $0801 at $C6F8 | $0801 | The jump has completed. Step once to execute LDA $27 from disk. A becomes $09 and PC advances to $0803. |

At the first stop the Monitor has found the card during its slot scan. The
card's ROM reads encoded disk bytes through the slot-6 data latch at `$C0EC`.
Its store at `$C6C6` fills a page starting at `$0800` with six bits per byte.
The store at `$C6E6` writes each byte again after rotating in the other two
bits. These latch reads happen before DOS has installed its sector-read routine.

At the second stop, open **Disk → Volume and catalogue → Boot sector** to
see track 0, sector 0. Compare its opening bytes, `01 A5 27 C9 09`, with
**Inspect RAM $0800** in the walkthrough. The first byte tells the card
how many sectors to load. On this disk it is `01`, so the branch at `$C6F6`
falls through to the jump. Select the third stop to cross that jump. The
first opcode is the second byte of the sector, `A5`. Its operand, `27`,
addresses the high byte of the loader's destination pointer, which has
advanced from page `$08` to page `$09`.

#### How the first sector loads the next ten

The code at `$0801` uses the card again. It puts a destination address in
`$26–$27` and a sector ID in `$3D`, then jumps through `$3E–$3F` into the
card's reader at `$C65C`. Each time the card finishes, its familiar
`JMP $0801` gives control back to the boot sector to set up another read.

| Disk | Command | Stop | PC | Last observation | Inspect RAM | What to look for |
| --- | --- | --- | --- | --- | --- | --- |
| Disk II | Boot | The boot sector calls the card back | $C65C in slot 6 | JMP ($003E) at $0836 for sector ID 12 into $3F00 | $0026 | The pointer at $26–$27 contains 00 3F. At $3D the requested ID is $0C. The card will read track 0 into page $3F. |
| Disk II | Boot | Ten sectors form the next loader | $084A | T0 S0–S9 in RAM at $3600 after $0848 | $3600 | All 2,560 bytes at $3600–$3FFF match the disk. The first page is another copy of sector zero. The pointer at $08FD–$08FE now contains 00 37. |
| Disk II | Boot | The next loader takes control | $3700 | JMP ($08FD) at $084A | $37E9 | Browse code to see STX $37E9, the first instruction from image sector 1. Step once to store X ($60) there and advance to $3703. |

The card recognizes the sector ID recorded in each address field on the
track. The `.dsk` file stores the same sectors in DOS order. For the first
read, the boot sector indexes its table at `$084D` with 9 and finds
`$0C`. The card therefore looks for ID 12, and the bytes it reads are at
image offset `$0900`. Both sector columns below use decimal numbers.

| Read | Sector ID on track 0 | DOS-order image sector | RAM destination |
| ---: | ---: | ---: | --- |
| 1 | 12 | 9 | `$3F00–$3FFF` |
| 2 | 14 | 8 | `$3E00–$3EFF` |
| 3 | 1 | 7 | `$3D00–$3DFF` |
| 4 | 3 | 6 | `$3C00–$3CFF` |
| 5 | 5 | 5 | `$3B00–$3BFF` |
| 6 | 7 | 4 | `$3A00–$3AFF` |
| 7 | 9 | 3 | `$3900–$39FF` |
| 8 | 11 | 2 | `$3800–$38FF` |
| 9 | 13 | 1 | `$3700–$37FF` |
| 10 | 0 | 0 | `$3600–$36FF` |

Both the image-sector number and the destination page count down, so
ascending RAM addresses hold the sectors in image order. The last read
puts a fresh copy of sector zero at `$3600`, while the boot code still
executes at `$0801`. Its jump at `$084A` selects the next page, `$3700`,
where sector 1 begins.

#### How the DOS loader reads the next 27 sectors

At `$3700` the loader already has a copy of DOS's Read/Write Track/Sector
routine (RWTS) in RAM. It describes one read in an I/O block at `$37E8`
and passes the block's address in A (high byte) and Y (low byte). In this
block `$37E9` holds the slot (`60` for slot 6), `$37EA` the drive,
`$37EC–$37ED` the track and DOS-order sector, `$37F0–$37F1` the destination
(low byte first), and `$37F4` the command (`01` for read).

| Disk | Command | Stop | PC | Last observation | Inspect RAM | What to look for |
| --- | --- | --- | --- | --- | --- | --- |
| Disk II | Boot | The loader requests its first sector | $37B5 | request at $37E8 for T2 S4 → $3500 | $37E8 | JSR at $3799 has entered RWTS. A=$37 and Y=$E8 point to the request. Find 02 04 for the track and sector, then 00 35 for the destination. |
| Disk II | Boot | The first read returns | $379C | T2 S4 → $3500 | $3500 | Carry is clear. The 256 bytes now at $3500–$35FF came from disk image offset $02400. Open Disk → DOS sector read trace to inspect the captured bytes. |
| Disk II | Boot | All 27 reads are complete | $3741 | T0 S10–T2 S4 in RAM at $1B00 after $373E | $1B00 | The last read put track 0, sector 10 at $1B00. All 6,912 bytes in the loaded block match the disk. Step once to execute JMP $3FC8. |

Every successful read returns to `$379C`. The loader moves the destination
down one page and requests the preceding sector. After sector 0 it continues
at sector 15 of the previous track. The Disk panel keeps each completed
read with its track, sector and destination, so you can inspect the three
parts of the transfer even after the loader has reused the I/O block.

| Reads | Track | DOS-order sectors, in read order | Destination pages, in read order |
| --- | ---: | --- | --- |
| 1–5 | 2 | 4 down to 0 | `$3500` down to `$3100` |
| 6–21 | 1 | 15 down to 0 | `$3000` down to `$2100` |
| 22–27 | 0 | 15 down to 10 | `$2000` down to `$1B00` |

The result occupies `$1B00–$35FF`, immediately below the ten pages the
boot sector loaded earlier. The jump to `$3FC8` takes execution into
those earlier pages while the new block is still intact.

### Saving ANSWER across a fresh boot

In the laboratory’s **Disk** panel, choose **Insert writable copy…** and
select `dos33-master.dsk`. Choose **Run** and wait for the Applesoft prompt.
The native acceptance test uses the same media and commands.

```text
NEW
10 PRINT 6*7
SAVE ANSWER
CATALOG
```

Page through the catalogue to `A 002 ANSWER`. The `A` identifies an
Applesoft program. The two sectors belonging to the file are its track/sector
list and its program data. In the exported image from this run, the catalogue
entry on track 17, sector 12 points to track 12, sector 6. That sector lists
track 12, sector 5 as the location of the program. Those three sectors and
the volume allocation map on track 17, sector 0 are the only sectors that
changed (track and sector numbers here are decimal).

Enter `NEW`, then `LOAD ANSWER` and `RUN`. Applesoft prints `42`.
When drive 1 shows **motor off**, choose **Export disk image**. The browser
downloads `dos33-master-saved.dsk`, the 143,360-byte result of
`disk.exportImage()`. Choose **Insert read-only…** and select that download.
Press **Run** to cold-boot the newly constructed Apple II. After the DOS 3.3
banner and Applesoft prompt appear, repeat `NEW` and `LOAD ANSWER`. `LIST`
shows `10 PRINT 6 * 7`, and `RUN` prints `42` again.

To continue editing, pause with the writable copy mounted and use **Saved
states → Save new state**. Eject the disk or reload the page, then restore
that state. Drive 1 shows the original filename and **writable copy**. Run,
load `ANSWER`, and enter `SAVE RESTORED`. The catalogue now lists both files.

### Following the sector writes

In the **Disk** panel, select **Sector write trace** under **File or trace**.
Each row represents one accepted data field. Selecting it shows the 256 bytes
committed at that moment. The inspector keeps the last 64 writes since the
disk was mounted, including repeated writes to the same sector. **Clear
write trace** starts a new recording. Fresh power-on or restoring a checkpoint
starts a new trace with the mounted medium.

On the verified System Master, `SAVE ANSWER` writes four distinct sectors
in seven operations. All track and sector numbers in this table are decimal.

| Write | Track | DOS sector | What changed |
| ---: | ---: | ---: | --- |
| 1 | 17 | 0 | DOS updates the allocation map and selects track 12. |
| 2 | 17 | 12 | The catalogue now names `ANSWER`, points to its list at T12 S6, and counts one sector. |
| 3 | 12 | 6 | DOS initializes the empty track/sector list. |
| 4 | 12 | 5 | DOS writes the Applesoft program data. |
| 5 | 12 | 6 | The pair at +$0C changes from `00 00` to `0C 05`, linking the program data. |
| 6 | 17 | 0 | DOS records the remaining free sectors on track 12. |
| 7 | 17 | 12 | The catalogue entry’s sector count changes from one to two. |

To follow the finished file, choose **A 002 ANSWER** instead of the trace.
Select its catalogue entry, T/S list, and file sector 0 in turn. At image
offset `$0C500`, the bytes `0C 00` give the 12-byte Applesoft program
length. The following bytes include line number 10 and the tokenized
expression. These views use an immutable image of the committed sectors.
Opening a file or selecting a write never steps the CPU, moves the head,
or consumes the next disk byte. The linked sector layouts are described
in [Beneath Apple DOS, chapter 4][beneath-dos].

### Interrupting SAVE ANSWER

The [disk acceptance test](../../../tests/site/apple2-disk.test.ts) pauses
after 100 bytes have shifted into the fifth write, while Q7 is still high.
The program-data sector is already on disk. The previously committed list
still has `00 00` where its pointer to that data will go.

* **Restore and continue.** The checkpoint includes the partially shifted
  field. DOS finishes writes 5–7, and every byte of the exported disk matches
  the uninterrupted save.
* **Cut power there.** Fresh power-on retains the four completed writes
  and discards the pending field. After a cold boot, `CATALOG` shows
  `A 001 ANSWER`. `NEW` followed by `LOAD ANSWER` returns to the prompt
  without an error. `LIST` shows no lines, and `RUN` prints nothing. The
  data is present at T12 S5, but the file’s list does not point to it.

This result describes this interruption point and the Disk II model’s
whole-sector commit rule. A physical drive interrupted mid-write can also
leave a damaged data field.

## Following LOAD ANSWER

Boot the [completed or interrupted export](#interrupting-save-answer) made
above as a read-only disk. Run `NEW` at the Applesoft prompt. Pause, open
**Walkthrough**, and choose **LOAD ANSWER · completed disk** or **LOAD ANSWER ·
interrupted disk**. In **Disk → DOS sector read trace**, clear any boot reads.
With the CPU paused, type `LOAD ANSWER` and press Return on the Apple II screen.
Choose **Run to checkpoint** for each named stop in turn. For the final stop,
queue `LIST` and press Return while still paused. Then resume and enter `RUN`.

Here is the whole read sequence on these two System Master exports. Sector
numbers are decimal. Addresses and bytes are hexadecimal. Each row is a
successful DOS RWTS read of 256 bytes into main RAM. The file manager resumes
at `$B093` after every read.

| Read | DOS sector | RAM destination | What arrives |
| ---: | --- | --- | --- |
| 1 | T17 S0 | `$B3BB–$B4BA` | Volume table. The first catalogue sector is T17 S15. |
| 2 | T17 S15 | `$B4BB–$B5BA` | First catalogue sector. |
| 3 | T17 S14 | `$B4BB–$B5BA` | Next catalogue sector overwrites the same buffer. |
| 4 | T17 S13 | `$B4BB–$B5BA` | Search continues. |
| 5 | T17 S12 | `$B4BB–$B5BA` | The ANSWER entry starts at offset $DD, now in RAM at $B598. |
| 6 | T12 S6 | `$9700–$97FF` | The first data pointer at $970C is `0C 05` on the completed disk and `00 00` on the interrupted disk. |
| 7 | T12 S5 | `$9600–$96FF` | Completed disk only. The first two bytes, `0C 00`, give the file's 12-byte payload length. |

DOS strips that two-byte length and copies `$9602–$960D` into
`$0801–$080C`, one byte at a time with the store at `$ACA3`.
The first BASIC line starts with its link to `$080A` and the line number
10. The expression is `BA 36 CA 37` (`PRINT`, `6`, `*`, `7`), followed
by a zero terminator. The zero link at `$080A–$080B` ends the program;
the twelfth byte `0A` is beyond that link. During `LIST`, Applesoft reads
the token at `$0805` and prints `10 PRINT 6 * 7`. `RUN` prints `42`.

On the interrupted disk, the data at T12 S5 is identical. DOS finds no
pointer to it, so it never reads that sector or copies its payload.
After `NEW` the zero link at `$0801–$0802` still ends the program. `LIST`
tests its high byte and prints no line. `RUN` returns to the prompt.

### Laboratory stops

The laboratory uses this table to build both tours. Each stop is immediately
*after* the indicated read or write, at the next instruction's PC. **Inspect
RAM** opens the live bytes at the selected address. The Disk panel retains
the last 64 successful reads with the bytes as they were on return, even
when DOS has since reused the buffer. The trace recognizes the loader and
resident copies of RWTS in this System Master for slot 6, drive 1 reads into main RAM. The
slot bootstrap's direct nibble reads are outside that interface.

| Disk | Command | Stop | PC | Last observation | Inspect RAM | What to look for |
| --- | --- | --- | --- | --- | --- | --- |
| Both | LOAD ANSWER | Find ANSWER in the catalogue | $B093 | T17 S12 → $B4BB | $B598 | The first two entry bytes, 0C 06, point to the list at T12 S6. The high-bit filename starts three bytes later. |
| Completed | LOAD ANSWER | Follow the data pointer | $B093 | T12 S6 → $9700 | $970C | The pair 0C 05 names the sector allocated to file position zero. |
| Interrupted | LOAD ANSWER | Find the missing pointer | $B093 | T12 S6 → $9700 | $970C | Both bytes are zero. This is the last disk read of LOAD. |
| Completed | LOAD ANSWER | Read the program sector | $B093 | T12 S5 → $9600 | $9600 | The length is 0C 00. The line link, line number and PRINT token follow it. |
| Completed | LOAD ANSWER | Finish copying to Applesoft | $ACA5 | write $080C | $0801 | Twelve bytes have moved from the file buffer into Applesoft's program area. Compare them with the captured read. |
| Completed | LIST | LIST reads the PRINT token | $D715 | read $0805 = $BA | $0805 | Applesoft has read the PRINT token in line 10. Resume to see LIST expand it. |
| Interrupted | LIST | LIST finds the empty program | $D6DE | read $0802 = $00 | $0801 | The high byte of the first link is zero. Resume to see LIST return to the prompt without a line. |

## Following a DOS binary into execution

`BEACON` is a 300-byte machine-language program. Its first instruction reads
the **last** byte of the file, so the star it draws depends on both data sectors
having made it into RAM. To make the disk, boot a writable copy of the selected
System Master. At the Applesoft prompt, enter these lines one at a time:

```text
NEW
10 FOR I=0 TO 299:POKE 24576+I,I-256*INT(I/256):NEXT
20 FOR I=0 TO 6:READ B:POKE 24576+I,B:NEXT
30 DATA 173,43,97,141,148,7,96
40 POKE 24875,170
RUN
BSAVE BEACON,A$6000,L$012C
```

Line 10 fills the range with each offset's low byte, which makes a skipped
or transposed byte visible in a comparison. Lines 20–30 install three
instructions at `$6000`. Line 40 puts `$AA`, the Apple II text code for
`*`, at `$612B`.

| Address | Bytes | Instruction | Effect |
| --- | --- | --- | --- |
| $6000 | AD 2B 61 | LDA $612B | Read the marker from byte 300. |
| $6003 | 8D 94 07 | STA $0794 | Put the star on text page one, row 8, column 21 (counting from one). |
| $6006 | 60 | RTS | Return to DOS. |

When the motor stops, **Export disk image**, then **Insert read-only** and
select the export. This starts a fresh machine. Run until DOS reaches the
Applesoft prompt, then pause. Select **BLOAD and BRUN BEACON** in **Walkthrough**.
Clear the **DOS sector read trace** in **Disk** to separate the load from the
boot reads. Queue `BLOAD BEACON` with Return on the screen while paused.

On this export the catalogue entry is `B 003 BEACON`: one T/S list and
two data sectors. Both `BLOAD` and `BRUN` made two passes through T17 S0,
T17 S15, S14, S13, S12, and T12 S6 before reading the data. The trace
keeps each return, even when DOS reuses the same buffer.

| File sector | DOS read on this disk | Bytes in the $9600 buffer | Bytes DOS copies into RAM |
| --- | --- | --- | --- |
| 0 | T12 S5 | `00 60 2C 01` gives address $6000 and length $012C, followed by 252 payload bytes | $9604–$96FF → $6000–$60FB |
| 1 | T12 S4 | The remaining 48 bytes start at offset zero and end with AA at $962F | $9600–$962F → $60FC–$612B |

The [native acceptance test](../../../tests/site/apple2-disk.test.ts) replaces
all 300 destination bytes with their complements before `BLOAD`. It compares
the restored bytes with the original program, checks the adjacent bytes, and
observes each store in order across the sector boundary. `BLOAD` returns to
the prompt without entering the program.

Use **Run to checkpoint** for each stop. At the second stop, queue `BRUN BEACON`
with Return. DOS reads the file again, places `00 60` at `$AA72–$AA73`, and
executes `JMP ($AA72)` at `$A394`. The last stop is **before** the instruction
at `$6000`. Step twice to see the accumulator receive `$AA` and the star
appear on the screen. Resume to return to the Applesoft prompt.

| Disk | Command | Stop | PC | Last observation | Inspect RAM | What to look for |
| --- | --- | --- | --- | --- | --- | --- |
| BEACON | BLOAD BEACON | Finish the first data sector | $ACA5 | write $60FB = $FB | $60FB | DOS has copied 252 bytes from the first sector. The second sector continues at $60FC. |
| BEACON | BLOAD BEACON | Finish loading all 300 bytes | $ACA5 | write $612B = $AA | $612B | The star byte has arrived from the second sector. BLOAD will return without executing the program. |
| BEACON | BRUN BEACON | DOS hands control to BEACON | $6000 | JMP ($AA72) at $A394 | $6000 | The DOS jump has completed. The next instruction is LDA $612B, and the program has yet to draw the star. |

## How HELLO loads Integer BASIC

On the DOS 3.3 System Master, the `HELLO` startup program prints
`(LOADING INTEGER INTO LANGUAGE CARD)` and sends DOS the command
`BLOAD INTBASIC,A$D000`. To follow it, insert the System Master read-only
in the laboratory. Leave the CPU paused at fresh power-on, select
**HELLO, INT and FP** in **Walkthrough**, and choose **Run to checkpoint**.
No keyboard input is needed for the first two stops.

At the first stop DOS has reached its binary-load handler. The buffer at
`$0200` holds Ctrl-D, the command, and Return, all with the high bit set.
In **Disk**, select **B 050 INTBASIC** (locked) and **File sector 0**.
The first four bytes at T15 S14 are `00 10 00 30`: a load address of
`$1000` and a length of `$3000` (12,288 bytes). The address in HELLO's
command overrides the one in the file. The 50 sectors comprise a
track/sector list and 49 data sectors.

At the second stop, the store at `$ACA3` has copied the first payload byte
to `$D000`. HELLO's setup code read `$C081` twice to select bank 2 and
enable RAM writes with ROM still supplying reads. The walkthrough shows
the physical byte in bank 2 alongside the ROM byte. Browsing the ordinary
Memory panel at this stop shows `6F` from ROM.

| Payload offsets | CPU addresses DOS writes | Physical destination |
| --- | --- | --- |
| $0000–$0FFF | $D000–$DFFF | Language Card bank 2, starting with `A9 20` |
| $1000–$2FFF | $E000–$FFFF | Shared upper RAM, starting with `20 00 F0` |

Resume with **Run**. When the Applesoft `]` prompt appears, DOS has
finished the load and the card is write-protected. Pause and follow the
`INT` stop. DOS writes to `$C080` to select RAM for reads, then jumps
through the word at `$9D5C`. At `$E000` the 6502 is about to fetch
`20 00 F0` (`JSR $F000`) from the freshly loaded upper RAM. Resume,
wait for Integer BASIC's `>` prompt, and enter `PRINT 6*7` to print `42`.

For the final stop, pause and queue `FP` with Return. DOS now selects ROM
for reads with a write to `$C081`. The same jump at `$9DE7` reaches the
same address, `$E000`, where the first three ROM bytes are `4C 28 F1`
(`JMP $F128`). Resume and enter `PRINT 3/2` at the Applesoft `]` prompt.
It prints `1.5`. Switching back to ROM leaves the loaded RAM bytes intact.

| Disk | Command | Stop | PC | Last observation | Inspect RAM | What to look for |
| --- | --- | --- | --- | --- | --- | --- |
| System Master | Boot | HELLO requests Integer BASIC | $A35D | DOS command `BLOAD INTBASIC,A$D000` | $0200 | Ctrl-D starts the DOS command. Compare its destination with the address in the disk header. |
| System Master | Boot | First byte lands in bank 2 | $ACA5 | write bank 2 $D000 = $A9 | $D000 | The physical store put A9 in bank 2 while reads at D000 still return 6F from ROM. |
| System Master | INT | Enter Integer BASIC in upper RAM | $E000 in LC upper | JMP ($9D5C) at $9DE7 | $E000 | The loaded bytes 20 00 F0 are now visible. Step to execute JSR $F000. |
| System Master | FP | Return to Applesoft ROM | $E000 in ROM | JMP ($9D5C) at $9DE7 | $E000 | At the same address the processor now sees 4C 28 F1. Step to execute JMP $F128. |

The [disk acceptance test](../../../tests/site/apple2-disk.test.ts) follows the
catalogue pointer and the 49 sector pointers in the System Master
image, removes the four-byte header, and compares every payload byte with
its physical bank. It checks the first instruction fetch and the prompt in
each interpreter. The [Language Card chapter](../../components/devices/specifications/apple2-language-card.md)
describes the independent read and write controls.

## Running COLOR DEMO from disk

Boot the DOS 3.3 System Master read-only. At the first Applesoft `]` prompt,
pause with `DOS VERSION` still in the top-left corner. Choose **RUN COLOR DEMO**
in **Walkthrough**, type `RUN COLOR DEMO` on the Apple II screen, and press
Return. Use **Run to checkpoint** for the first stop, then **Next** and
**Run to checkpoint** for each of the other two. This is the Integer BASIC
program `COLOR DEMO`. The disk also carries an Applesoft program named
`COLOR DEMOSOFT`.

| Disk | Command | Stop | PC | Last observation | Inspect RAM | What to look for |
| --- | --- | --- | --- | --- | --- | --- |
| COLOR DEMO | RUN COLOR DEMO | DOS recognizes COLOR DEMO | $ABB5 | read $B50E = $81 for `COLOR DEMO` | $B50C | DOS has matched the filename. The entry starts with 1C 0F (track 28, sector 15), then 81 (locked Integer BASIC), then the name. |
| COLOR DEMO | RUN COLOR DEMO | Integer BASIC reads line 30's DIM token | $E686 in LC upper | read $8E82 = $4E | $8E7F | The first line begins 47 1E 00 4E. Its length is 71 bytes, its number is 30, and the interpreter has just read DIM. |
| COLOR DEMO | RUN COLOR DEMO | HOME erases the D in DOS VERSION | $FCA2 in LC upper | page 1 text (0,0) $C4 → $A0 | $0400 | Look at the top-left cell. D has become a space. OS VERSION is still visible to its right. |

In **Disk**, select **\*I 009 COLOR DEMO**. Its catalogue entry is at offset
`$51` in T17 S14. DOS reads that sector into `$B4BB`, placing the entry at
`$B50C`. It opens the file, switches from Applesoft to the Integer BASIC that
[HELLO loaded](#how-hello-loads-integer-basic), then looks up the file again.
The brief `>` on screen comes from starting the interpreter.

T28 S15 lists eight data sectors on the same track, S14 down to S7. In
**File sector 0**, the first two bytes, `81 07`, give the length of the
tokenized program. DOS copies the following 1,921 bytes into main RAM at
`$8E7F–$95FF`. At the second stop the 6502 is running the interpreter
in upper RAM. Its `LDA ($E0),Y` at `$E684` reads the token at `$8E82` for
the first statement, `DIM A$(40)`. The 6502 executes the interpreter's
instructions while Integer BASIC reads the program as data.

Line 30 also sets `C=-936`, the signed address of the Monitor's HOME routine
(`$FC58`). Line 200 starts with `TEXT : CALL C`. The display is already in
text mode. HOME's store at `$FCA0` changes the first character on page one,
which is the program's first visible effect. Resume with **Run** to see
`APPLE DEMONSTRATION PROGRAMS` and the prompt `WHICH WOULD YOU LIKE?`.
Choose `5` to exit, then try `LIST 30` and `LIST 200` at the `>` prompt
to read the two lines you followed.

### Kaleidoscope draws its first pair

At `WHICH WOULD YOU LIKE?`, pause, turn Screen **Inspect** off for typing,
and enter `3` with Return. Continue the **RUN COLOR DEMO** walkthrough.
The menu dispatches with `GOTO 400+N*100`, so choice 3 starts at line 700.

| Disk | Command | Stop | PC | Last observation | Inspect RAM | What to look for |
| --- | --- | --- | --- | --- | --- | --- |
| COLOR DEMO | 3 | Enter Kaleidoscope on line 700 | $E686 in LC upper | read $92C4 = $4C | $92C1 | Integer BASIC has fetched GR. The menu is still visible. Continuing switches the display to mixed low-resolution graphics and clears the drawing area. |
| COLOR DEMO | 3 | PLOT draws the first coloured point | $F818 in LC upper | page 1 lores (1,3) $0 → $1 | $0481 | Line 760's PLOT I,K changes bits 7–4 of $0481. The point at (1,3) is magenta and its neighbour at (1,2) is still black. |
| COLOR DEMO | 3 | PLOT draws the mirror across the diagonal | $F818 in LC upper | page 1 lores (3,1) $0 → $1 | $0403 | The next statement on line 760 is PLOT K,I. It swaps the coordinates, colouring (3,1) while (1,3) stays visible. |

Line 700 starts the loops with `W=3` and `I=1`, and sets `K=I+J`. Line 750
chooses the colour with `COLOR=J*3/(I+3)+I*W/12`. Integer division gives
zero on the first two passes (`J=0` and `J=1`). Each pass plots eight points
in black on a black background. At `J=2`, the colour is 1 and `K=3`.
The first two statements on line 760 draw `(1,3)` and `(3,1)`.

At either pixel stop, choose **Inspect pixel** in the walkthrough, or turn
on **Inspect** beside the screen and click the coloured square.
Coordinates count from zero at the top left. Two vertically adjacent squares
share a byte. The even row uses bits 3–0 and the odd row uses bits 7–4.
Both points in this pair are on odd rows, so the store changes `$00` to
`$10`. Use the arrow keys to inspect the other half of the byte.

**Last colour change** links to the 6502 store that changed the selected
four bits. At both stops it is `STA ($26),Y` at `$F816`. The **PLOT**
token link distinguishes the BASIC statements behind that same instruction.
Integer BASIC fetched the first token at `$9319` and the second at `$931E`.
Its handler at `$EE4B` jumped to the Monitor's plotting routine at `$F800`
in each case. The inspector retains these observed origins even as later
instructions update other points. Press **Escape** to return to typing. Run
to watch the pattern grow, then press Return to go back to the menu.

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
| 0 | 1 | An even-address read returns 00 for writable media in drive 1, otherwise 80. |
| 1 | 0 | Lowering Q6 shifts one latch byte on writable drive 1 with its motor on. |
| 1 | 1 | A CPU write loads the latch for the next shift. |

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
It preserves write permission and bytes already shifted during an open write.
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

### Writing a DOS sector

DOS's Read/Write Track/Sector routine (RWTS) first reads the address field
to find its sector. On the selected System Master it reads through DE AA of
the address epilogue, senses write protection, then raises Q7. It loads a
byte with Q6 high and lowers Q6 to shift it. Sync bytes precede the data
prologue D5 AA AD. Lowering Q7 ends the write.

The controller uses the starting position on the track to identify which
existing sector follows that address field. The media model decodes the
342 values, checks the chained checksum and the DE AA EB epilogue, and
replaces the sector in the DOS-order image. The next read sees its newly
encoded track. An incomplete or malformed field leaves the previous sector
intact. This is the unit of write supported by a sector image.

The [native check](../../../tests/site/apple2-disk.test.ts) uses the
[DOS Manual’s RWTS interface][dos-manual]. A 6502 caller enters DOS at
03D9 with an I/O block for slot 6, drive 1, track 18, logical sector 6
(decimal). DOS finds physical address field 3 and writes 256 bytes from
2000. A second call reads them into 2100. Both return with carry clear.
In the exported 143,360-byte image the payload occupies **12600–126FF**
(hexadecimal), because `(18 × 16 + 6) × 256 = 12600h`. Every other byte
matches the System Master. Remounting the export as a protected disk and
reading the sector into 2200 recovers the same payload.

### Timing and format limits

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
the sequencer, or flux transitions. Formatting tracks, custom formats, copy
protection, other disk sizes, and drive 2 are outside this profile.

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
arithmetic program under DOS. SAVE must report protection on the original
disk. On a writable copy, the test checks the ANSWER catalogue entry and
boots another Apple II from the export to load and run it. Reset, eject, and
fresh power-on check media retention separately.

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
[dos-manual]: https://www.applelogic.org/files/AIIDOS.pdf
[beneath-dos]: https://archive.org/details/Beneath_Apple_DOS_alt/
