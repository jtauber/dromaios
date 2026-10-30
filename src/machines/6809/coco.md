# TRS-80 Color Computer: Color BASIC on native Dromaios hardware

Tandy introduced the Color Computer in 1980. Its 6809, television display,
and built-in BASIC offered a very different starting point from the Altair's
front panel or the Apple II's 6502 and expansion slots. This chapter describes
a **CoCo 1 NTSC profile with 32 KiB RAM, Color BASIC 1.3, and optional
Extended Color BASIC 1.1**.
The later ROMs are deliberate: [MAME's ROM catalogue][rom-catalogue] pairs
these versions for the CoCo 2B. This is a firmware upgrade on the selected
CoCo 1 hardware profile, not a claim about its original factory configuration.

The native machine boots the supplied ROM, scans physical keyboard switches,
and produces text, semigraphics-4, and all eight standard bitmap graphics modes.
Its [reference audit](../../../docs/machines/coco.md) records comparisons with dromaios-coco; this implementation runs entirely on
Dromaios components. No ROM traps, injected BASIC tokens, browser callbacks,
or reference-emulator devices are needed.

## Components and memory map

The connections follow the [Tandy Technical Reference Manual][technical],
especially its address and pin maps, SAM/video description, and keyboard matrix.
The [MC6821 chapter](../../components/devices/specifications/mc6821.md) owns PIA
registers and control lines. The concrete [CoCo PIA wiring](coco/pias.ts)
joins two chips to the [keyboard matrix](coco/keyboard.ts). Their registers
repeat across FF00–FF1F and FF20–FF3F. The
[SAM chapter](../../components/devices/specifications/mc6883.md) owns paired
control writes and display addresses; the
[VDG chapter](../../components/devices/specifications/mc6847.md) owns pixel
and colour decoding. The VDG has no CPU-addressable registers.

```machine
components {
    ram = ram 8000
    firmware = rom 2000
    extended = rom 2000
    pias = coco-pias
    sam = mc6883
    vdg = mc6847
}

map 10000 {
    0000 = ram
    8000 = extended
    A000 = firmware
    FF00 = pias
    FFC0 = sam
    FFE0 = window 20 {
        read = firmware offset 1FE0
        write = discard
    }
    unmapped = FF
}
```

The entire FFE0–FFFF window aliases the BASIC ROM tail, not just the reset
vector at FFFE–FFFF. ROM writes leave both images unchanged. The extension
socket at 8000–9FFF is either empty or contains the selected Extended Color
BASIC image; it does not replace Color BASIC at A000–BFFF. The cartridge region
C000–FEFF and peripheral region FF40–FFBF are empty. Unanswered reads return FF and writes are ignored: this is an
undriven-bus approximation. It does not turn an empty socket into stored ROM.
SAM reads likewise return FF without changing its control word.

RAM is a zero-filled **logical** 32 KiB store in this functional model.
SAM M=00 at reset is retained, but its physical DRAM row/column mapping and
aliases are not reproduced. Color BASIC selects M=01 before its RAM test.
P1 does not select another bank in this capacity. The native execution helper
rejects M=1x and TY=1 before the next CPU boundary; those stored configurations
are inspectable, but neither create extra RAM nor silently run through the
normal map. V and R remain independent: unsupported display modes do not stop
ordinary CPU execution, and clock selection does not imply timing accuracy.

## External firmware and reset

Each socket accepts one exact, separate 8,192-byte image. Combined dumps,
other versions, and cartridges are outside the profile. Color BASIC is required
to boot; the extension alone has no reset vector. With the extension absent,
the same machine runs Color BASIC alone. The ROM's own initialization detects
and enters the extension; the host does not patch vectors, BASIC tokens, or RAM.
No firmware bytes are tracked or published.

| Socket | Image | MAME SHA-1 cross-check |
| --- | --- | --- |
| A000–BFFF | Color BASIC 1.3 (`bas13.rom`) | `28b92bebe35fa4f026a084416d6ea3b1552b63d3` |
| 8000–9FFF | Extended Color BASIC 1.1 (`extbas11.rom`) | `ad927fb4f30746d820cb8b860ebb585e7f095dea` |

The extension was checked against MAME's SHA-1 and CRC32 (`a82a6254`);
the SHA-256 below was calculated from those verified bytes.

```machine
image firmware external sha256 5375b1caef9df815b781d9cd6df81ecdaddd2642b06a01adac521e40f1329751
image extended external sha256 a18f270d3495d82b9f515de049f46253a623a2d9b1bb226c9ad338508344c5ee

cpu 6809 {
    A = 00  B = 00  DP = 00
    X = 0000  Y = 0000  S = 0000  U = 0000  PC = 0000
    waitMode = none  nmiArmed = false
    flags { E = 0  F = 1  H = 0  I = 1  N = 0  Z = 0  V = 0  C = 0 }
}

reset { cpu }
```

`create6809Coco({ firmware: null, extended: null })` allocates inspectable hardware before
firmware is available. Verify media with `RomImage.verify` and the generated
`romImages.firmware` identity, then install it with `firmware.install(image)`.
Verify the optional extension against `romImages.extended` and bind it under
`extended`, or explicitly bind `null` for an empty socket. Native installation
preserves the machine; changing ROMs underneath a running interpreter is not
a supported session transition. The laboratory starts fresh hardware when the
extension changes. The separate `reset()` reads FFFE and
FFFF through the declared map and enters at A027 for this ROM. It is a
**CPU-only reset**, preserving RAM, SAM, PIAs, and held keys; it does not claim
to reproduce the motherboard reset-button circuitry. Fresh power-on means a
new factory instance: zero RAM, cleared SAM and PIA registers, released keys,
and disconnected input levels high. The initial register values are an emulator
convention; only the CPU chapter's reset effects are hardware reset behavior.

## Execution, keyboard, and interrupt levels

Use [stepCoco](coco/runtime.ts) for each machine boundary. It samples the
current PIA 1 FIRQ level before PIA 0 IRQ, asks the generated 6809 to accept
or mask the request, and otherwise executes one instruction. An accepted
interrupt or a SYNC release is its own returned record. Acknowledging a PIA
data register removes its request at the next boundary; there is no sticky
host-side pending flag. Explicit `setHorizontalSync` and `setFieldSync` events
reach PIA 0 CA1 and CB1. They are never synthesized by rendering or by a
browser frame rate. Serial carrier and cartridge events similarly reach PIA 1.

`pias.setKey(key, pressed)` changes a physical switch. PIA 0 PB0–PB7 select
columns and PA0–PA6 sense rows; PA7 is the disconnected joystick comparator,
held high. Shift is a separate switch. Host text translation and input queues
belong outside the machine. The native acceptance test presses and releases
keys, including Shift for `+` and `=`, rather than writing text into RAM.

The 52-switch matrix resolves low levels through connected switches in either
direction, including multi-key ghost paths. Undriven lines are high; low wins
if connected outputs disagree. This is a digital approximation, not an electrical
contention model. Repeated presses are idempotent, and `pias.releaseKeys()` releases
all switches. Every key change and guest PIA write recomputes the resolved inputs.
Snapshot restoration rejects impossible switches and PIA inputs inconsistent
with the board wiring. The browser saves its host queue separately, alongside
the native snapshot.

PIA 1 ports have high external inputs, so direction registers determine which
output latch bits reach the video controls. Both PIAs' unconnected C2 inputs
are high. Joystick conversion, serial transport, cassette, audio, and cartridge
hardware are absent. PIA manual C2 output modes work; strobe modes reject
writes as described in the PIA chapter.

## An instantaneous screen

[renderCocoFrame](coco/runtime.ts) reads the resolved PIA video pins and current
SAM page. With V=000, A/G=0, and INT/EXT=0, it decodes 512 physical RAM
bytes into 256-by-192 colour indices. With A/G=1, the VDG chapter defines
the eight bitmap formats and palettes; the SAM chapter defines their matching
byte-row strides and raster repetitions. The renderer expands logical pixels
to the same 256-by-192 raster, reading each bitmap byte once. It never calls
the CPU memory connection or reads PIA registers. Even F=7F reads physical 7E00–7FFF rather than FF00 I/O.
Inverse characters include their blank margins; semigraphics blocks use all
eight colours independently of CSS. The font bitmap and palette-index contract
are linked from the VDG chapter. Unsupported SAM/VDG combinations report an
error before reading screen data. These include V=111 DMA, external
characters/SG6, extended semigraphics, and mismatched bitmap settings. Graphics
can wrap through physical $7FFF to $0000 without visiting CPU I/O or ROM.

The frame has no scan position or elapsed time. There is no automatic field
interrupt, CRT/composite simulation, dynamic RAM refresh, or cycle accuracy.
The laboratory maps these indices to fixed RGB colours and offers a scanline
overlay. Both are presentation approximations, not composite video or hardware time.

## Using the laboratory

The [CoCo laboratory](https://microcomputer.world/machines/color-computer/laboratory/)
uses the shared docking workspace with its own saved layout and Live preferences.
Load the Color BASIC image identified above and, optionally, the separate
Extended BASIC image, then choose **Run**. The ROM panel has one load control
and status per socket. Each image is verified independently and remembered
locally when browser storage is available. Files are never uploaded. Reload
verifies both remembered images independently and
opens a fresh, paused machine; it does not automatically execute or restore a
saved program. **Forget remembered Color BASIC** and **Forget remembered Extended BASIC**
remove only the corresponding saved file, keeping the current loaded image.

RAM and device inspectors work before firmware is loaded. Loading Color BASIC for the first time
preserves that hardware and resets the CPU; replacing the base ROM or loading
the extension starts fresh hardware with the selected ROM pair. The extension
may be loaded first, but execution waits for Color BASIC. **Use Color BASIC only**
removes and forgets the extension and starts a fresh BASIC-only machine. If
forgetting fails, the current configuration is preserved. A rejected file leaves
CPU, RAM, and device state intact and execution
paused. **Step** advances one native machine boundary, which may be an instruction,
interrupt entry, or wait result. **Pause** finishes the current batch and stops
before another. **Reset CPU** preserves RAM and devices; the host also cancels queued
input and releases keyboard switches. **Fresh power-on** constructs new hardware,
clears RAM and input, and retains the installed ROM pair.

Click the screen to type. Letters become uppercase; Enter submits a line,
Backspace sends the CoCo's left arrow, Home sends Clear, and Escape or Ctrl-C
sends Break. Paste accepts one ASCII line, with an optional trailing newline.
Unsupported characters and multiline pastes are rejected before anything is
queued. Text becomes physical keyboard chords, including Shift where needed.
Browser key repeat is ignored.

The host holds each queued chord for 12,000 execution boundaries and releases it
for another 12,000 before the next chord. These generous budgets serve this
untimed ROM profile; they do not claim real keyboard timing. Up to 1,024 chords
may be queued. Pausing consumes no input. Losing window focus or hiding the
page pauses execution, releases switches, and clears the queue, preventing a
stuck key or unattended continuation. Moving between panels in the same window
does not discard input.

The 6809 panel shows A, B, their combined D, X, Y, DP, S, U, PC, and all eight
condition-code flags. Changed displayed values are highlighted. Memory offers
8/16-byte rows, an address field, and FIX/PC/CHG following; CHG follows the first
changed byte since the previous observation. RAM and loaded ROM are observed
directly. Empty regions and I/O show `--`; drawing never reads PIA data registers
or acknowledges interrupts. The PIA and SAM panels likewise use observations.
Turning off a panel's Live square holds its display during Run. Pause, Step,
and showing the panel refresh it. Scrolling or changing row width uses the held
memory image.

**Direct Page** follows DP: a value of `$30` selects `$3000–$30FF`, not page
zero. FIX holds the currently displayed page while DP changes; DP resumes
following. The 8/16 toggle changes bytes per row. **System Stack · S** and
**User Stack · U** are independent dockable tools. Each shows two bytes below
its pointer and 32 bytes beginning there, wrapping at `$FFFF`. BYTE shows
individual bytes; WORD groups pairs starting at the pointer, high byte first,
even when the pointer is odd. The arrow marks the observed pointer. Push
decrements before storing; pull reads before incrementing. The views do not
infer frames, stack bounds, or an empty stack from arbitrary memory. In
particular, software can use U as an ordinary index register.

All three tools highlight changed bytes by address since their last observation;
moving a pointer alone does not mark different bytes as changed. Their controls
redraw the held observations when Live is off. Address links browse Memory
without execution. Missing storage remains `--`, and a word with either byte
missing remains `----`. Reset, fresh power-on, and snapshot restoration establish
a new comparison baseline. Existing saved layouts gain these tools once as
tabs alongside Memory, preserving its size and selected tab. The default layout
shows them separately; drag or use Arrange panels to give each its own space.
Subsequent choices to hide them are retained.

**Disassembly** follows PC or the Memory panel's selected address (PC/MEM).
PC mode includes the last three instructions actually executed, decoded from
their captured bytes even if memory has since changed. A solid separator marks
unconditional transfers and intervening external CPU boundaries; a dotted one
marks conditional branches, whether taken or not. Address and destination links
browse Memory without executing. Instruction lengths, supported postbytes, and
control flow come from the executable 6809 chapter; the display supplies
Motorola assembly notation. Unknown bytes and unavailable storage stay explicit.

**Instruction** explains the next CPU boundary: the authored description,
branch flag test and outcome, effective-address formation, and predicted changes
to registers, flags, and memory. A copied CPU uses storage observations and
private RAM writes, including native IRQ/FIRQ arbitration. Device reads and
writes stop the preview, and ignored ROM writes are identified. An interrupt or
wait boundary is shown instead of the opcode at PC when applicable. Expanding
the storage-access list shows predictions, not another execution trace. Neither
panel acknowledges a PIA interrupt, consumes queued keys, or changes hardware.
Disassembly navigation uses its held storage image while Live is off; Pause,
Step, and showing either panel refresh its observations.

**Snapshot** saves one explicit browser checkpoint: native hardware plus the
queued chords, current press/release phase, and remaining input budget.
Save and Restore require a paused machine. Restoring validates the complete
state and matching ROM pair before replacing the session, stays paused, and clears
the recent-step display. It does not issue a reset or inject another key.
The checkpoint contains both ROM identities or explicit absence, not their
bytes. Restoration requires the same pair: a BASIC-only checkpoint cannot
silently acquire an extension, and an Extended BASIC checkpoint cannot lose it.
Version-1 browser checkpoints predate the extension socket; their exact former
hardware shape is upgraded to an empty socket before normal validation. New
version-2 checkpoints must supply the field explicitly. Failed restoration
preserves the current session, and failed saving preserves the previous checkpoint.
Layout and Live choices are not machine state.

**Run to address**, in Execution, accepts a hexadecimal PC and runs normal
machine boundaries until that PC is reached. It pauses **before** the next
boundary, including when PC already matches. It does not change PC, inject a
return, or bypass devices. A request stops after 2,000,000 boundaries if the
address is not reached. Run, Step, Pause, a machine replacement/reset, and loss
of window focus cancel the target. An error or an unserviceable wait also ends
the request. A matching PC is not a promise that an ordinary instruction will
run next: Instruction still explains any pending interrupt or wait boundary.

The screen footer and SAM / video panel show the selected resolution, colour
count, CSS, and start address. The SAM panel also exposes GM beside V, making
the two chips' separate responsibilities visible. Broader ROM annotations,
extended semigraphics, and an independently checked timing model remain
subsequent work.

## Following Color BASIC

This short walkthrough uses the exact Color BASIC 1.3 image identified above,
with the extension socket empty (**Use Color BASIC only**).
Keep **Execution**, **Disassembly** in PC mode, **Instruction**, **Direct Page**,
both stack panels, and **PIAs / keyboard** visible. Open this guide beside the
laboratory: moving focus to another window pauses it, so return before choosing
Run to address. The addresses below are observations of this ROM, not names
or locations shared by every BASIC version.

1. **Start with Fresh power-on.** PC is `$A027`, fetched from `$FFFE–$FFFF`.
   Step the `LEAY -28,PCR` and watch Y become `$A00E`. The ROM saves a later
   continuation address while it initializes the hardware. S and U begin at
   zero by this model's power-on convention; the stack tools correctly show
   memory around zero rather than claiming that either stack is empty.
2. **Run to `$A051`.** Earlier stores have configured the PIAs. Step
   `LDU #$FFC0`: the U view moves to the SAM control area and shows `--`.
   U is an index here, not a stack. At `$A056`, `STA ,U++` writes a paired
   SAM control address and advances U by two. The Instruction preview stops
   at hardware writes; only Step or Run performs them. Run to `$A05E`, then
   Step `TFR B,DP`. B is now zero, and Direct Page selects `$0000–$00FF`.
3. **Run to `$A00E`.** Step `LDS #$03D7`. The system-stack arrow moves to
   `$03D7`; nothing has been pushed merely by assigning the pointer. Run to
   `$A07D`, skipping the RAM-clearing loop. Instruction now predicts the
   `JSR $A928`, including its stack writes.
4. **Step into the call.** PC becomes `$A928`, S becomes `$03D5`, and the
   word at S is `$A080`: the return address, stored as `A0 80`. Switch
   BYTE/WORD to see the same held bytes in both presentations. Step three more
   times through `LDB #$60`, `LDX #$0400`, and `STX <$88`. Direct Page now
   shows `04 00` at `$0088–$0089`, a high-byte-first screen pointer. The
   following loop fills `$0400–$05FF` with `$60`, the VDG's blank character.
5. **Run to `$A936`, then Step the RTS.** PC returns to `$A080` and S to
   `$03D7`. The old `A0 80` bytes still exist below S; pulling does not erase
   RAM. This is why the stack window does not present every word as a caller.
6. **Run to `$A1D9` to inspect keyboard polling.** U is now `$FF00`.
   Step `ROL 2,U`: the column output becomes `$FE`, selecting the first column
   with a low bit. Run to `$A23A`, then Step `LDA ,U` to sense the keyboard
   rows. With no keys queued or held, A is `$FF`. The PIAs panel shows the
   resolved inputs; inspecting it did not itself perform the read. Resume with
   Run and type `PRINT 2+3` followed by Enter to finish at BASIC's `5` and `OK`.

The [walkthrough test](../../../tests/site/coco-walkthrough.test.ts) follows
these stops through the real ROM and independently checks the pointers, return
bytes, direct-page store, screen fill, and keyboard read. It requires `COCO_ROM`;
the ROM is never part of the published guide.

## Try bitmap graphics

Color BASIC lacks Extended BASIC's high-resolution drawing commands, but
`POKE` can still operate the hardware. This experiment uses ordinary interpreted
BASIC and physical keyboard input. No graphics helper paints RAM on its behalf.
Use **Color BASIC only**, start with **Fresh power-on**, choose **Run**, and
wait for `OK`. Open the
SAM / video and Memory panels; browse Memory at `$6000`. Paste each line into
the screen separately, including Enter, and let it finish before sending the
next. Moving focus to the guide pauses execution; resume Run after returning.

First fill `$6000–$63FF` (1 KiB) with decimal 27, or binary `00011011`.
Each two-bit pair describes one of the four colours. This address range is free
in this freshly started session; the demonstration does not reserve it against
an existing BASIC program or its variables. The loop takes a few seconds; wait
for `OK` before continuing.

```text
FOR I=24576 TO 25599:POKE I,27:NEXT
```

Move the SAM's start from `$0400` to `$6000`: clear F1, then set F4 and F5.
The addresses, rather than the written zero, select those bits. The text screen
will change because the VDG still interprets these bytes as characters.

```text
POKE65480,0:POKE65487,0:POKE65489,0
```

Select V=001, then A/G=1 and GM=000: CG1, a 64 × 64 four-colour bitmap.
Preserve the unrelated low three PIA output bits. The screen becomes repeating
green, yellow, blue, and red stripes, each four raster pixels wide. The SAM
panel shows V=001, GM=000; the screen footer shows the geometry and `$6000`.

```text
POKE65473,0:POKE65314,(PEEK(65314)AND7)OR128
```

CSS selects the second palette without touching the bitmap. With graphics
showing, the BASIC prompt still exists at `$0400` but is not visible; click the
screen, paste the following line, and press Enter as before.

```text
POKE65314,PEEK(65314)OR8
```

The same stripes are now buff, cyan, magenta, and orange. Set GM0 to reinterpret
each byte as **eight one-bit pixels**, still using SAM V=001. RG1 shows 128 × 64
black/buff pixels, each two raster pixels wide. `00011011` now means three black,
two buff, one black, two buff pixels, repeated across the screen. Pause and save
a snapshot if you want to return to this exact display and interpreter state.

```text
POKE65314,PEEK(65314)OR16
```

Return to text by clearing V0 and F4/F5, restoring F1, and clearing the video
control outputs. This preserves the other SAM fields and PIA bits. The text
screen and prompt reappear; `PRINT 2+3` should still produce `5` and `OK`.
Fresh power-on is also available, but clears the RAM you just filled.

```text
POKE65472,0:POKE65486,0:POKE65488,0:POKE65481,0:POKE65314,PEEK(65314)AND7
```

Between writes the SAM and VDG can briefly disagree. The laboratory reports
that unsupported intermediate configuration while the CPU continues executing;
it does not invent a hardware picture for it. The [graphics acceptance test](../../../tests/site/coco-graphics.test.ts)
types these exact guide lines through the real ROM, checks the bitmap and colour
changes, restores a graphics snapshot, and returns to working BASIC text.

## Draw with Extended Color BASIC

Load both ROMs above and choose **Run**. The banner should identify
`EXTENDED COLOR BASIC 1.1` and finish at `OK`. This experiment uses the drawing
commands documented in Tandy's [Getting Started with Extended Color BASIC][extended-manual],
chapters 14–19. It needs no `POKE` commands or host drawing routines.

Enter the following program **one line at a time**, then enter `RUN`. The screen
shows an orange box around a cyan circle, with a magenta centre point on buff.
It remains visible until you press a key; Space returns to the text prompt.
The laboratory's **Pause** stops execution without consuming a key.

```text
10 PMODE3,1
20 PCLS5
30 COLOR8,5
40 LINE(16,16)-(239,175),PSET,B
50 CIRCLE(128,96),48,6,1
60 PSET(128,96,7)
70 SCREEN1,1
80 IFINKEY$=""THEN80
90 SCREEN0,0
100 END
```

`PMODE3,1` selects a 128 × 192 four-colour bitmap beginning at graphics page 1.
BASIC graphics page numbers are 1,536-byte units; page 1 starts at `$0600`.
This mode uses four pages, or 6,144 bytes. BASIC still accepts x coordinates
0–255: neighbouring x positions share a pixel in this mode. Inspect Memory at
`$0600` and the SAM / video panel: V=110, GM=110, CSS=1. The interpreter, not
the host, performs the RAM and device writes that produce that selection.

`PCLS5` fills the bitmap. `COLOR8,5` selects the box colours, and `LINE` with
`,B` draws its outline. `CIRCLE` specifies colour 6 and a height/width ratio
of 1; `PSET` specifies colour 7. BASIC colour numbers 5–8 name buff, cyan,
magenta, and orange; these are one greater than the renderer's palette indices.
`SCREEN1,1` displays the bitmap with that colour set. The `INKEY$` loop keeps
the program running so the graphics stay visible; `SCREEN0,0` returns to text.
The bitmap remains in RAM after returning to the prompt.

While the picture is displayed, pause and save a snapshot. Run and press Space,
then restore the snapshot while paused: the same picture and key-waiting program
return. Run again and press Space to finish, then try `PRINT 2+3` or `LIST`.
**Reset CPU** retains the installed ROM pair and RAM; **Fresh power-on** retains
the ROMs but clears the program. Sound, cassette commands, and timing-dependent
programs remain outside this untimed profile even though the ROM recognizes
their BASIC keywords.

The optional [Extended BASIC test](../../../tests/site/coco-extended.test.ts)
uses these exact program lines, independently checks the bitmap, exercises all
five `PMODE` settings, and compares restored continuation through the native
keyboard path. Set `COCO_ROM` and `COCO_EXTENDED_ROM` to the separate images.

## Follow PSET into graphics RAM

The laboratory's **Walkthrough** panel now offers the reset-to-text path and
**Extended BASIC: PSET to a pixel**. Routine names appear before addresses in
Disassembly; referenced addresses appear beside operands, and **Notes** toggles
instruction comments. These annotations describe the exact ROM versions above.
Labels are landmarks, not inferred routine boundaries. Clicking a label browses
memory without executing; selecting a checkpoint changes only the guide.
**Run to checkpoint** uses the same bounded execution as Run to address.
Reaching an address does not establish that the setup was followed.

For the pixel walkthrough, load both ROMs and enter this program one line at a
time at the BASIC prompt. It deliberately draws only one pixel, so the byte
calculation can be followed without the many calls made by LINE or CIRCLE.

```text
10 PMODE3,1:PCLS5
20 PSET(130,96,7)
30 SCREEN1,1
40 IFINKEY$=""THEN40
50 SCREEN0,0
60 END
```

Wait until all input is accepted, then **Pause**. Click the screen and paste
`RUN` with a trailing newline while paused. Input is queued, so the ROM has not
yet seen the command. Select **Extended BASIC: PSET to a pixel** and its first
checkpoint, then choose **Run to checkpoint**. Keep Disassembly, Instruction,
Direct Page, System Stack, and Memory visible. Each checkpoint explains what
to do before running and what to observe after it stops. Step and Run remain
in Execution. A snapshot at a checkpoint preserves the queued keyboard phase.

The seven stops are `$9361`, `$9374`, `$92C2`, `$92D9`, `$9377`, `$9386`, and
`$9388`. At `$9374`, the interpreter has normalized BASIC x=130 to logical x=65:
a PMODE 3 pixel spans two raster columns. The row has 32 bytes, and four logical
pixels fit in each byte. The address is therefore
`$0600 + 96 × 32 + floor(65 / 4) = $1210`. The remainder, 1, selects mask `$30`
from `$92E5`. Colour 7 becomes two-bit value `10`, repeated as `$AA` in ALLCOL.

At `$9377`, X points to `$1210` and A holds `$30`. The ROM preserves the other
pixels and combines the selected colour:
`($00 & ~$30) | ($AA & $30) = $20`. At `$9386`, **Instruction** predicts the
store without performing it. **Step** changes RAM from `$00` to `$20` and stops
at `$9388`. Run normally to reach SCREEN and the key-waiting loop. The small
magenta mark occupies raster columns 130–131 on row 96; Space returns to text.

The names for the graphics workspace and entry addresses were cross-checked
with [Extended BASIC Unravelled II][extended-unravelled], Appendix A and Appendix B
pages B26–B27. The comments and numerical observations here are checked against
our selected ROMs and the native execution trace. They describe this experiment,
not all possible inputs to the routines. No ROM is distributed with the guide.
Direct-page operands are labelled only when DP is known: at the current PC or
from a captured executed instruction. Indexed operands are not guessed from the
current registers; Instruction explains their effective addresses separately.
Empty sockets and unsupported memory mappings do not acquire ROM annotations.
Held Disassembly observations retain their labels and bytes together.

<details>
<summary>Versioned ROM annotations used by the laboratory</summary>

```json
{
  "firmware": {
    "sha256": "5375b1caef9df815b781d9cd6df81ecdaddd2642b06a01adac521e40f1329751",
    "regions": [
      {
        "start": "A000",
        "end": "BFFF",
        "name": "Color BASIC 1.3"
      },
      {
        "start": "FFE0",
        "end": "FFFF",
        "name": "Color BASIC vector alias"
      }
    ],
    "routines": [
      {
        "address": "A027",
        "name": "RESET",
        "description": "Entry selected by the reset vector. Initializes the board before returning through Y."
      },
      {
        "address": "A00E",
        "name": "BASIC_START",
        "description": "Establishes the initial stack and chooses warm or cold BASIC startup."
      },
      {
        "address": "A928",
        "name": "CLEAR_TEXT",
        "description": "Fills the text screen with blank characters and initializes the cursor pointer."
      },
      {
        "address": "B267",
        "name": "CLOSE_PAREN",
        "description": "Checks the closing parenthesis in a BASIC expression."
      },
      {
        "address": "B26A",
        "name": "OPEN_PAREN",
        "description": "Checks the opening parenthesis in a BASIC expression."
      }
    ],
    "labels": [
      {
        "address": "0088",
        "name": "CURSOR",
        "description": "Address of the next text screen cell, high byte first.",
        "scope": "workspace",
        "bytes": 2
      },
      {
        "address": "009F",
        "name": "GETNCH",
        "description": "Executable RAM helper that advances the BASIC text pointer.",
        "scope": "workspace"
      },
      {
        "address": "00A5",
        "name": "GETCCH",
        "description": "Executable RAM helper that fetches the current BASIC character.",
        "scope": "workspace"
      },
      {
        "address": "00A6",
        "name": "CHARAD",
        "description": "Operand of the RAM character-fetch instruction; the current BASIC text address, high byte first.",
        "scope": "workspace",
        "bytes": 2
      },
      {
        "address": "FF00",
        "name": "PIA0_A",
        "description": "Keyboard rows or direction register, selected by control bit 2.",
        "scope": "hardware"
      },
      {
        "address": "FF02",
        "name": "PIA0_B",
        "description": "Keyboard columns or direction register, selected by control bit 2.",
        "scope": "hardware"
      },
      {
        "address": "FF22",
        "name": "PIA1_B",
        "description": "Video control outputs or direction register, selected by control bit 2.",
        "scope": "hardware"
      },
      {
        "address": "FFC0",
        "name": "SAM_V0_CLEAR",
        "description": "Writing clears the low video-mode bit; the written byte is ignored.",
        "scope": "hardware"
      },
      {
        "address": "FFC1",
        "name": "SAM_V0_SET",
        "description": "Writing sets the low video-mode bit; the written byte is ignored.",
        "scope": "hardware"
      },
      {
        "address": "FFFE",
        "name": "RESET_VECTOR",
        "description": "High byte of the reset destination; the following byte supplies its low byte.",
        "scope": "rom"
      }
    ],
    "notes": [
      {
        "address": "A027",
        "bytes": "31 8C E4",
        "text": "Save $A00E in Y as the continuation after board initialization."
      },
      {
        "address": "A00E",
        "bytes": "10 CE 03 D7",
        "text": "Initialize S to $03D7 before BASIC chooses a startup path."
      },
      {
        "address": "A051",
        "bytes": "CE FF C0",
        "text": "Point U at the first SAM control address."
      },
      {
        "address": "A056",
        "bytes": "A7 C1",
        "text": "Write a SAM clear address, then advance U by two to the next clear address."
      },
      {
        "address": "A05E",
        "bytes": "1F 9B",
        "text": "Set DP from B. The following direct operands use page $00."
      },
      {
        "address": "A07D",
        "bytes": "BD A9 28",
        "text": "Call CLEAR_TEXT; the return address $A080 is pushed on S."
      },
      {
        "address": "A928",
        "bytes": "C6 60",
        "text": "Choose the blank character used to clear text RAM."
      },
      {
        "address": "A92D",
        "bytes": "9F 88",
        "text": "Store the text cursor pointer in RAM at $0088\u2013$0089 when DP is zero."
      },
      {
        "address": "A936",
        "bytes": "39",
        "text": "Return to the caller by pulling its address from the system stack."
      }
    ],
    "walkthroughs": [
      {
        "id": "reset-text",
        "title": "Color BASIC: reset to text",
        "setup": "Use Color BASIC only, then Fresh power-on. Keep Execution, Disassembly, Instruction, Direct Page, and System Stack visible.",
        "steps": [
          {
            "title": "Reset entry",
            "address": "A027",
            "prepare": "Choose Fresh power-on with the extension removed.",
            "observe": "Step: Y becomes $A00E. The reset vector supplied $A027; the host did not jump to a prompt.",
            "routine": "RESET"
          },
          {
            "title": "Call the text clear routine",
            "address": "A07D",
            "prepare": "Run to this checkpoint after reset.",
            "observe": "Step: PC becomes $A928; S becomes $03D5 and the stored return address is $A080.",
            "routine": "CLEAR_TEXT"
          },
          {
            "title": "Establish the cursor",
            "address": "A92D",
            "prepare": "Continue from the call; run to this checkpoint.",
            "observe": "X is $0400. Step stores 04 00 at $0088\u2013$0089, the big-endian cursor pointer.",
            "routine": "CLEAR_TEXT"
          },
          {
            "title": "Return to initialization",
            "address": "A936",
            "prepare": "Run to this checkpoint.",
            "observe": "All text bytes $0400\u2013$05FF are $60. Step pulls $A080 from S and resumes the caller.",
            "routine": "CLEAR_TEXT"
          }
        ]
      }
    ]
  },
  "extended": {
    "sha256": "a18f270d3495d82b9f515de049f46253a623a2d9b1bb226c9ad338508344c5ee",
    "regions": [
      {
        "start": "8000",
        "end": "9FFF",
        "name": "Extended Color BASIC 1.1"
      }
    ],
    "routines": [
      {
        "address": "9361",
        "name": "PSET",
        "description": "Parses coordinates and colour, then changes one graphics pixel."
      },
      {
        "address": "9365",
        "name": "PRESET",
        "description": "Uses the same pixel path with the erase selection."
      },
      {
        "address": "931A",
        "name": "READ_COORDINATES",
        "description": "Evaluates coordinates and scales them to the current graphics mode."
      },
      {
        "address": "9581",
        "name": "READ_COLOUR",
        "description": "Converts the BASIC colour argument into the working colour and repeated pixel pattern."
      },
      {
        "address": "9298",
        "name": "PIXEL_ADDRESS",
        "description": "Selects the coordinate-to-byte calculation for the current PMODE."
      },
      {
        "address": "92C2",
        "name": "FOUR_COLOUR_ADDRESS",
        "description": "Calculates X and the two-bit pixel mask for a four-colour bitmap."
      },
      {
        "address": "9377",
        "name": "WRITE_PIXEL",
        "description": "Merges the selected colour with the other pixels in the byte at X."
      },
      {
        "address": "93BB",
        "name": "LINE",
        "description": "Handles LINE, including its drawing and LINE INPUT forms."
      }
    ],
    "labels": [
      {
        "address": "00B5",
        "name": "ALLCOL",
        "description": "The selected two-bit colour repeated across one byte.",
        "scope": "workspace"
      },
      {
        "address": "00B6",
        "name": "PMODE",
        "description": "The graphics mode chosen by BASIC.",
        "scope": "workspace"
      },
      {
        "address": "00B9",
        "name": "HORBYT",
        "description": "Bytes per logical graphics row.",
        "scope": "workspace"
      },
      {
        "address": "00BA",
        "name": "BEGGRP",
        "description": "Start of the current graphics page, high byte first.",
        "scope": "workspace",
        "bytes": 2
      },
      {
        "address": "00BD",
        "name": "HORBEG",
        "description": "Current horizontal coordinate; normalized before byte addressing, high byte first.",
        "scope": "workspace",
        "bytes": 2
      },
      {
        "address": "00BF",
        "name": "VERBEG",
        "description": "Current vertical coordinate, high byte first.",
        "scope": "workspace",
        "bytes": 2
      },
      {
        "address": "00C2",
        "name": "SETFLG",
        "description": "Pixel operation: 1 for PSET, 0 for PRESET.",
        "scope": "workspace"
      },
      {
        "address": "00DB",
        "name": "CHGFLG",
        "description": "Accumulates whether a graphics byte changed.",
        "scope": "workspace"
      },
      {
        "address": "92E5",
        "name": "FOUR_COLOUR_MASKS",
        "description": "Masks C0, 30, 0C, 03 select successive pixels within a byte.",
        "scope": "rom"
      }
    ],
    "notes": [
      {
        "address": "9361",
        "bytes": "86 01",
        "text": "Select the PSET operation before parsing its arguments."
      },
      {
        "address": "9366",
        "bytes": "97 C2",
        "text": "Record the set/erase selection in SETFLG when DP is zero."
      },
      {
        "address": "9368",
        "bytes": "BD B2 6A",
        "text": "Call the base ROM to check the opening parenthesis."
      },
      {
        "address": "936B",
        "bytes": "BD 93 1A",
        "text": "Read and normalize the coordinates for this PMODE."
      },
      {
        "address": "936E",
        "bytes": "BD 95 81",
        "text": "Evaluate the colour and prepare ALLCOL."
      },
      {
        "address": "9374",
        "bytes": "BD 92 98",
        "text": "Convert normalized coordinates into the byte address X and pixel mask A."
      },
      {
        "address": "9298",
        "bytes": "8D F5",
        "text": "Ask the PMODE dispatch table which address calculation to use."
      },
      {
        "address": "929A",
        "bytes": "6E C4",
        "text": "Transfer to the calculation selected in U."
      },
      {
        "address": "92C2",
        "bytes": "34 44",
        "text": "Preserve B and U while calculating a four-colour pixel address."
      },
      {
        "address": "92C4",
        "bytes": "D6 B9",
        "text": "Load the byte width of one graphics row."
      },
      {
        "address": "92C6",
        "bytes": "96 C0",
        "text": "Load the low byte of the normalized vertical coordinate."
      },
      {
        "address": "92C8",
        "bytes": "3D",
        "text": "Multiply row width by vertical coordinate to get the row offset."
      },
      {
        "address": "92C9",
        "bytes": "D3 BA",
        "text": "Add the start of the graphics page to the row offset."
      },
      {
        "address": "92CB",
        "bytes": "1F 01",
        "text": "Place the row address in X."
      },
      {
        "address": "92D1",
        "bytes": "3A",
        "text": "Add the byte offset within the row to X."
      },
      {
        "address": "92D6",
        "bytes": "CE 92 E5",
        "text": "Select the table of four two-bit masks."
      },
      {
        "address": "92D9",
        "bytes": "A6 C6",
        "text": "Use A as the mask-table index; the walkthrough selects $30."
      },
      {
        "address": "9377",
        "bytes": "E6 84",
        "text": "Read the old screen byte at X before changing one pixel."
      },
      {
        "address": "937D",
        "bytes": "43",
        "text": "Invert the pixel mask so the other three pixels can be preserved."
      },
      {
        "address": "937E",
        "bytes": "A4 84",
        "text": "Keep the old byte except for the selected pixel bits."
      },
      {
        "address": "9380",
        "bytes": "D4 B5",
        "text": "Keep the selected colour only in the pixel-mask positions."
      },
      {
        "address": "9384",
        "bytes": "AA E0",
        "text": "Combine the new pixel with the preserved pixels."
      },
      {
        "address": "9386",
        "bytes": "A7 84",
        "text": "Write the merged byte to graphics RAM. In this experiment, $1210 changes from $00 to $20."
      },
      {
        "address": "9388",
        "bytes": "A0 E0",
        "text": "Compare the new byte with the saved old byte; the screen write has already happened."
      }
    ],
    "walkthroughs": [
      {
        "id": "pset-pixel",
        "title": "Extended BASIC: PSET to a pixel",
        "setup": "Load both ROMs. Enter the six-line program in the machine guide and wait for the prompt. Pause, click the screen, and paste RUN followed by Enter while paused. Select the first checkpoint and choose Run to checkpoint.",
        "steps": [
          {
            "title": "Enter PSET",
            "address": "9361",
            "prepare": "Queue RUN while paused, then run to this checkpoint.",
            "observe": "Line 10 has selected PMODE 3 and cleared the bitmap. The pixel byte $1210 is still $00.",
            "routine": "PSET"
          },
          {
            "title": "Coordinates and colour are ready",
            "address": "9374",
            "prepare": "Continue from PSET to this checkpoint.",
            "observe": "DP=$00; HORBEG at $00BD is $0041 (65), VERBEG at $00BF is $0060 (96), BEGGRP is $0600, HORBYT is $20, and ALLCOL is $AA.",
            "routine": "PIXEL_ADDRESS"
          },
          {
            "title": "Select the four-colour calculation",
            "address": "92C2",
            "prepare": "Continue into the coordinate calculation.",
            "observe": "U=$92C2: PMODE 3 selected this path. The saved return address leads back to the pixel merge.",
            "routine": "FOUR_COLOUR_ADDRESS"
          },
          {
            "title": "Select the pixel mask",
            "address": "92D9",
            "prepare": "Run through the row and column arithmetic to this checkpoint.",
            "observe": "X=$1210, A=$01, U=$92E5. Step LDA A,U: A becomes $30, the second two-bit field in a byte.",
            "routine": "FOUR_COLOUR_ADDRESS"
          },
          {
            "title": "Merge with the old byte",
            "address": "9377",
            "prepare": "Run to this checkpoint after loading the mask.",
            "observe": "X=$1210 and A=$30. The byte is still $00. The next instructions preserve other pixels and select colour bits from ALLCOL=$AA.",
            "routine": "WRITE_PIXEL"
          },
          {
            "title": "Write the graphics byte",
            "address": "9386",
            "prepare": "Run to this checkpoint; do not Step until you have inspected Memory and Instruction.",
            "observe": "A=$20 and X=$1210. Instruction predicts Write $1210 \u2190 $20. Step performs that single graphics write; Memory changes from $00 to $20.",
            "routine": "WRITE_PIXEL"
          },
          {
            "title": "After the write",
            "address": "9388",
            "prepare": "If you stepped the previous instruction, you are already here.",
            "observe": "The byte is $20 (00 10 00 00). Run normally to display the magenta pixel at x=130\u2013131, y=96. Press Space to return to BASIC.",
            "routine": "WRITE_PIXEL"
          }
        ]
      }
    ]
  }
}
```

</details>

## Snapshots and acceptance

`snapshot()` owns copies of CPU and RAM state, both PIAs' latches and edge
history, pressed keys, the SAM control word, and both ROM identities (or
explicit absence). The stateless VDG contributes an empty snapshot. Restoring
requires matching verified media in both sockets; it does not reapply power-on or CPU reset.
Taking a snapshot or rendering a frame must neither acknowledge a pending
interrupt nor release a held key.

The [synthetic tests](../../../tests/machines/6809/coco/machine.test.ts) run
without private media. They cover the full vector alias, ROM protection and
empty sockets, generated CPU transfers, live IRQ/FIRQ levels, snapshots with
held keys, frame decoding, page changes, and refusal of unsupported modes.
The [extension tests](../../../tests/machines/6809/coco/extended.test.ts) use a
synthetic ROM to check the second socket's mapping, write protection, native
calls and returns, independent inspection, and snapshot identity requirements.
The [bitmap tests](../../../tests/machines/6809/coco/video.test.ts) compare all
eight formats and both colour sets with independent complete rasters, including
physical RAM wrapping, all SAM/VDG mode pairings, and changes made by 6809 stores.
The optional [real-ROM test](../../../tests/machines/6809/coco/rom.test.ts),
enabled with `COCO_ROM`, verifies the exact digest and exercises this transcript:

```text
COLOR BASIC 1.3
(C) 1982 TANDY
OK
PRINT 2+3                 -> 5, OK
10 A=2
20 PRINT A+3
30 END
LIST                      -> the three stored lines, OK
RUN                       -> 5, OK
20 PRINT A+4
RUN                       -> 6, OK
NEW
LIST                      -> no stored lines, OK
PRINT 2+4 [Left] 3         -> edited PRINT 2+3, then 5, OK
10 GOTO 10
RUN
[Break]                   -> BREAK IN 10, OK
PRINT 2+3                 -> 5, OK
```

The deterministic schedule runs 720,000 instructions before the boot sample,
12,000 with each key held, 12,000 released, and 20,000 after each submitted
line. These are generous instruction budgets for a reproducible acceptance
check, **not** clock cycles, key-repeat timing, or the earliest prompt time.
No sync events are required for this transcript. Separate synthetic tests
cover the interrupt wiring, which the polling transcript alone cannot verify.

The optional [browser-session test](../../../tests/site/coco-rom.test.ts) repeats
the conversation through the same queued matrix transport used by the page,
including editing and Break. It also restores mid-key and compares subsequent
execution records and complete state. [Host tests](../../../tests/site/coco-input.test.ts)
check repeated chords, release gaps, bounded queues, invalid continuation state,
and explicit release without firmware.

[rom-catalogue]: https://github.com/mamedev/mame/blob/master/src/mame/trs/coco12.cpp
[technical]: https://colorcomputerarchive.com/repo/Documents/Manuals/Hardware/Color%20Computer%20Technical%20Reference%20Manual%20%28Tandy%29.pdf

[extended-manual]: https://colorcomputerarchive.com/repo/Documents/Manuals/Hardware/Getting%20Started%20With%20Extended%20Color%20Basic%20%28Tandy%29.pdf

[extended-unravelled]: https://colorcomputerarchive.com/repo/Documents/Books/Unravelled%20Series/extended-basic-unravelled.pdf
