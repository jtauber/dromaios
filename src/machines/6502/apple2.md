# Apple II Plus: BASIC and graphics

The Apple II Plus pairs a MOS 6502 with memory-mapped input and display hardware.
Unlike the Altair's serial terminal, its text output lives in RAM, where video
hardware fetches character codes. Applesoft and the Autostart Monitor occupy
the upper 12 KiB of the address space.

This is the first native composition in the [Apple II Plus plan](../../../docs/machines/apple2.md):
48 KiB of main RAM, caller-supplied firmware, the keyboard latch, and text and
graphics displays, plus a 16 KiB Language Card. It boots the selected ROM and runs BASIC programs in the
browser. Disk II and sound remain future work.
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
the vectors stored in RAM. There is no Disk II bootstrap in an
empty slot, so the Autostart Monitor falls through to Applesoft.

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
}

map 10000 {
    0000 = ram
    C000 = keyboard
    C050 = video
    C080 = language
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
`create6502Apple2({ firmware })`. The verified image owns its bytes. Factories
remain synchronous and copy ROM into fresh components.

The reference's `roms/apple2p.rom` is a container. This record gives its byte
count, SHA-256, and the decimal offset of the mapped ROM. The browser uses this
record directly:

```json
{
  "bytes": 20480,
  "sha256": "92c4bef609920842ea472d21b661a0d35dbda6cd90963b8b734a205e22d84108",
  "offset": 8192
}
```

A host accepting that file must validate the **whole file** before extracting
hexadecimal offsets 2000–4FFF, then verify the normalized image above. The exact 12 KiB image
is also accepted directly. Other sizes or altered files are rejected before
replacing an existing machine.

## Construction, reset, and restoration

Construction provides zero-filled RAM and deterministic CPU, keyboard, display, and Language Card state.
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

CPU reset preserves RAM, firmware, the keyboard latch, display switches, and all Language Card latches. It follows the
[6502 reset contract](../../components/cpus/specifications/6502.md#reset-and-instruction-boundaries),
including its stack-pointer and interrupt-mask changes. Firmware may then
clear the strobe and initialize its own workspace. Fresh construction, followed
by reset, represents power-on in this deterministic model.

`snapshot()` captures CPU, all four RAM components, keyboard, display and Language Card latches,
and the firmware digest. Restoration
requires that digest and the same verified ROM binding; it creates independent
hardware without resetting or executing. Snapshot inspection performs no
guest device reads. There is no generic safe preview of mapped I/O: inspect
device snapshots and read-only views, and read RAM or ROM directly instead.

## Using the browser machine

Choose the matching local ROM file, then **Run**. Nothing is uploaded or fetched.
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
RAM and fresh devices using the retained verified ROM; the old program is lost.
A failed ROM selection preserves the previous machine, paused. A successful
selection replaces it with a fresh paused machine. Refreshing or leaving the
page loses the session; there is no saved browser checkpoint yet.

Both text pages support normal, inverse, and flashing characters. The browser
uses a selectable monospace font, not the character ROM's exact pixels.
Low-resolution graphics draws coloured blocks; high-resolution graphics uses
the reference's approximate colour pairs. Mixed mode keeps four text rows. The
video chapter defines those choices, the RGB palettes, and host flashing.

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
