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

The optional [FD-502 disk profile](coco-disk.md) adds a cartridge ROM and
controller to this composition; this base map keeps the cartridge socket empty.

## Components and memory map

The connections follow the [Tandy Technical Reference Manual][technical],
especially its address and pin maps, SAM/video description, and keyboard matrix.
The [MC6821 chapter](../../components/devices/specifications/mc6821.md) owns PIA
registers and control lines. The concrete [CoCo PIA wiring](coco/pias.ts)
joins two chips to the [keyboard matrix](coco/keyboard.ts) and two
[joystick ports](../../components/devices/specifications/coco-joystick.md). Their registers
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
normal map. Unsupported display modes do not stop ordinary CPU execution.
SAM R must remain 00 for the normal-speed clock profile below; other stored
clock selections stop execution before the next CPU boundary.

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

clock cpu 894886.25 Hz
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
**CPU-only reset**, preserving RAM, SAM, PIAs, held keys, and elapsed clocks; it does not claim
to reproduce the motherboard reset-button circuitry. Fresh power-on means a
new factory instance: zero RAM, cleared SAM and PIA registers, released keys,
and input levels high, with the clock at zero. The initial register values are an emulator
convention; only the CPU chapter's reset effects are hardware reset behavior.

## Execution, keyboard, and interrupt levels

Use [stepCoco](coco/runtime.ts) for each machine boundary. It samples the
current PIA 1 FIRQ level before PIA 0 IRQ, asks the generated 6809 to accept
or mask the request, and otherwise executes one instruction. An accepted
interrupt or a SYNC release is its own returned record. Acknowledging a PIA
data register removes its request at the next boundary; there is no sticky
host-side pending flag. The board clock delivers horizontal and field sync to
PIA 0 CA1 and CB1. Rendering and browser frame rate never generate these events.
Explicit serial carrier and cartridge events reach PIA 1.

### Clock and sync schedule

The NTSC board's 14.31818 MHz crystal supplies the VDG at one quarter of that
rate, and the normal-speed SAM supplies the CPU E clock at one sixteenth:
**894,886.25 Hz**. The [VDG chapter](../../components/devices/specifications/mc6847.md#ntsc-sync-periods)
declares the line and field periods and the evidence for the 228-VDG-clock line.
Four VDG clocks occupy one CPU clock: a line is **57 CPU clocks**, a field
**14,934**, HS stays low for **4.125**, and FS for **1,824**.

Phase zero is an HS rising edge, 4.125 CPU clocks after the preceding FS rising
edge. Both inputs start high. HS first falls at 52.875 and rises at 57; FS first
falls at 13,105.875 and rises at 14,929.875. These are deterministic power-on
phase conventions, not a claim about the crystal's phase on real power-up.
Phase repeats exactly without rounding each line. There is no extra mutable
phase counter: `clock.ticks` and the PIA input levels and flags in the snapshot
are sufficient to continue an in-progress pulse.

At a boundary, `stepCoco` offers current interrupt levels, completes one timed
CPU instruction or interrupt entry, then delivers **every** sync edge crossed
during that interval. Both edges of a short pulse are delivered even if one
instruction spans them. The PIA latches its selected edge; reading its data
register acknowledges it. All instruction bus effects precede the interval's
sync edges in this model, so instruction-internal sampling and races are not
cycle accurate. Interrupt acceptance occurs at the following boundary.

Entering SYNC or CWAI pays its CPU cost once. A subsequent waiting boundary
advances to the next sync edge, rounded up to a complete CPU clock, without
fetching an instruction. The returned record keeps `clocks` as CPU work and
adds `idleClocks` for that waiting interval; their sum advances machine time.
Masked offers retain the CPU chapter's SYNC/CWAI distinction. Run continues
through waiting boundaries, even with both PIA interrupts disabled. Pause and
inspection advance no clocks. The generated factory's raw `step`/`interrupt`
methods account CPU clocks only; machine execution must use `stepCoco` for
board arbitration and sync delivery.

This schedule is independent of rendering, host timers, and batch sizes. Browser
pacing uses this clock without changing its schedule. SAM fast modes, DRAM
contention, and raster-beam rendering remain outside the profile.

`pias.setKey(key, pressed)` changes a physical switch. PIA 0 PB0–PB7 select
columns and PA0–PA6 sense rows; PA7 is the selected joystick comparator,
high when disconnected. Shift is a separate switch. Host text translation and input queues
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

PIA 1 port B has high external inputs, so direction registers determine which
output latch bits reach the video controls. Both PIAs' unconnected C2 inputs
are high. Serial transport and cartridge
hardware are absent. PIA manual C2 output modes work; strobe modes reject
writes as described in the PIA chapter.

The [cassette interface](../../components/devices/specifications/coco-cassette.md)
connects PIA 1 CA2 to the recorder's motor relay, PA7–PA2 to its recording
input, and the playback comparator to PA0. PIA 1 PA0 is therefore no longer
always high: it follows the tape input while Play and the motor are active.
The other external PIA 1 port inputs retain their released-high approximation.

## Joysticks

Two instances of the [executable joystick specification](../../components/devices/specifications/coco-joystick.md)
retain positions, connection state, and fire switches. Both start disconnected,
centred at (32,32), with buttons released. PIA 0 CB2 chooses right (low) or left
(high); CA2 chooses X (low) or Y (high). The selected potentiometer is compared
with the six-bit DAC on PIA 1 PA7–PA2. PIA 0 PA7 is high when the position is
at least the DAC value. Sound enable does not gate this comparison.

Right fire grounds PA0; left fire grounds PA1. These are also keyboard rows,
so buttons participate in the same switch-network resolution as held keys.
The model propagates their low levels through the matrix, rather than masking
bits after a keyboard read. Changes to positions, connections, buttons, port
directions, DAC data, or selector outputs update the input pins immediately.
No host conversion writes BASIC's results into RAM.

Native callers use `pias.connectJoystick("right", true)`,
`pias.setJoystickPosition("right", x, y)`, and
`pias.setJoystickButton("right", pressed)`; substitute `"left"` for the other
port. `pias.joystick(port)` returns a detached observation. Positions are 0–63,
with X increasing rightward and Y downward. The device chapter defines the
endpoint and disconnected-input approximations. CPU-only reset preserves these
physical inputs. Fresh power-on starts with disconnected joysticks again.

In the laboratory, open **Joysticks**, beside **PIAs / keyboard**. Each port has
a **Connected** switch, X/Y sliders, **Centre**, and **Hold fire**. Sliders retain
their positions; Centre sets both to 32. Hold fire keeps the switch pressed
until toggled off, disconnected, or focus leaves the window. These controls work
while paused or running, without adding keyboard characters. Checkpoints restore
the displayed controls from their physical state, including a held button.
Release fire before typing: its shared keyboard row can interfere with input.

### Check BASIC's readings

Connect both sticks and set right X/Y to (0,63) and left X/Y to (17,46), then enter:

```text
PRINT JOYSTK(0);JOYSTK(1);JOYSTK(2);JOYSTK(3)
```

The result is `0  63  17  46`. Centre both and repeat for four readings of 32.
The ROM's `JOYSTK(0)` performs a new conversion of all four axes; the other
three functions return cached results. To see that distinction, move right Y
to 0, then `PRINT JOYSTK(1)`: it still prints 32. After `PRINT JOYSTK(0)`,
`PRINT JOYSTK(1)` prints 0. [Getting Started with Color BASIC][basic-manual],
pages 76–79, explains this convention and the fire-button inputs.

### Move a dot with a joystick

Connect the right joystick, release fire, and enter each line separately:

```text
10 CLS0:X=0:Y=0
20 A=X:B=Y
30 X=JOYSTK(0):Y=INT(JOYSTK(1)/2)
40 C=3:IF (PEEK(65280) AND 1)=0 THEN C=4
50 RESET(A,B):SET(X,Y,C)
60 GOTO20
```

Type `RUN`, then move the X/Y sliders. A blue dot follows the right stick;
Hold fire changes it to red. A and B retain the previous position while BASIC
reads the joystick; the loop erases the old dot just before drawing the new one.
Dividing Y by two maps 64 joystick positions onto the 32-row
semigraphics screen. The program works in Color BASIC alone and with Extended
BASIC installed. Click the screen and press Escape or Ctrl-C to Break, releasing
fire first. Save a paused checkpoint to retain the program and joystick state.

The [hardware tests](../../../tests/machines/6809/coco/joystick.test.ts) cover
every axis/DAC comparison, selector and direction changes, fire/keyboard
interaction, and restoration. The [ROM tests](../../../tests/site/coco-joystick.test.ts)
check BASIC endpoints, centre, independent axes, cached readings, both fire
buttons, and the exact moving-dot program. They inspect actual video RAM and
rendered pixels, and replay a checkpoint taken during a conversion.

## Cassette

The [executable cassette circuit](../../components/devices/specifications/coco-cassette.md)
owns the DAC-to-recording and playback-to-comparator conversions. The concrete
recorder retains samples and transport state; `stepCoco` advances it with the
same CPU clock as video sync. The interval uses its starting motor and DAC
levels, and the next boundary sees the resulting playback sample. Waiting CPU
intervals also move an engaged recorder. Inspection, pause, browser audio,
and wall-clock time do not advance it.

Recordings export as **mono eight-bit PCM WAV at 44,100 Hz**, limited to two
minutes. This stores the signal BASIC actually generates, including its leaders
and gaps. **Load tape** also accepts ordinary byte-aligned CoCo `.cas` files;
the [CAS importer](../../components/devices/coco-tape-cas.ts) reconstructs a
waveform for the same recorder. The host neither supplies cassette bytes
directly to the ROM nor modifies its program storage.

CAS contains bytes rather than measured pulses or silence. As explained in
[MAME's format implementation](https://github.com/mamedev/mame/blob/master/src/lib/formats/coco_cas.cpp),
legacy images can omit the leaders and delays needed by the ROM. This importer
checks filename, data, and end-of-file blocks and their checksums. It supplies
one second of silence and at least 128 `$55` leader bytes before each filename,
after a filename, and before subsequent blocks in a gapped file. Other blocks
receive at least one sync byte; existing longer leaders are retained. Each bit
becomes one nominal 1200 Hz or 2400 Hz cycle, least-significant bit first.

Multiple complete files and zero padding between blocks are accepted. CAS input
is bounded to 64 KiB, and its reconstructed waveform must fit the same two-minute
limit. Corrupt checksums, incomplete files, unknown block types, bit-shifted or
copy-protected layouts are rejected before replacing the mounted tape. Other
WAV encodings, physical recorder noise, and cassette monitoring through the
television speaker remain outside this profile. Imported tapes start read-only;
export always produces WAV, including after a CAS import.

`pias.cassette` supplies `blank(name)`, `insert(name, samples)`, `play()`,
`record()`, `stop()`, `rewind()`, `writableCopy()`, and `eject()`.
`inspect()` returns small transport readouts; `samples()` returns a detached
copy for the WAV codec. Record overwrites from the current position and extends
the tape. Imported recordings are read-only until explicitly copied. Stop
preserves the position and fractional sample phase; Rewind also resets both.
Play and Record only move the tape while the ROM enables its motor relay.

### Saving the dot program on cassette

Enter the [moving-dot program](#move-a-dot-with-a-joystick), one line at a time,
but stay at BASIC's prompt. Release both fire buttons before typing.

1. Pause the computer. In **Cassette**, name the new tape `DOT.wav`, then choose
   **New blank** and **Record**. New blank replaces any currently mounted tape.
2. Run the computer and enter:

   ```text
   CSAVE "DOT"
   ```

   BASIC turns the motor on, writes the recording, and returns to `OK` with
   the motor off. Record remains engaged, just as on a real recorder.
3. Pause, choose **Stop**, then **Export WAV**. The download is `DOT-saved.wav`;
   it contains the ROM-produced waveform, not a machine checkpoint.
4. Choose **Fresh power-on**, Run until the BASIC prompt, then Pause. The
   mounted tape survives power-on, stopped at its old position, but for this
   check use **Load tape…** to select the exported file. Choose **Rewind** and
   **Play**.
5. Run and enter:

   ```text
   CLOAD "DOT"
   ```

   BASIC displays `S` while searching, `F DOT` when it finds the name, then
   `OK` after loading. `LIST` shows the six program lines.
6. Connect the right joystick again and enter `RUN`. Move its X/Y sliders;
   the blue dot follows them and Hold fire changes it to red.

For a checkpoint during either transfer, Pause while the motor is on, then
choose **Save** in **Snapshot**. The saved state includes the tape samples,
write permission, transport mode, and partially elapsed sample as well as the
CPU, RAM, clock, and keyboard queue. Restoring reinstates all of them; Run
continues the transfer. A stopped computer does not require pressing the
recorder's Stop button. CPU reset preserves the recorder; Fresh power-on
retains its medium and position but disengages Play/Record.

The [ROM acceptance test](../../../tests/site/coco-cassette.test.ts) checks
the exported waveform independently against the manual's block format and
checksums, verifies all 118 tokenized program bytes after a fresh `CLOAD`,
and checks the rendered dot and fire-button colour. Mid-record and mid-play
checkpoints reproduce the same remaining boundaries and final machine state.
The [hardware and image tests](../../../tests/machines/6809/coco/cassette.test.ts)
cover the comparator, relay, resolved DAC pins, waiting behavior, protection,
overwriting, sample phase, and malformed WAV rejection.

### Machine code on cassette

With both ROMs loaded, enter these lines one at a time. They reserve memory
above `$5FFF`, fill 300 bytes at `$6000–$612B` with a repeating byte pattern,
and place a short 6809 routine at `$6100`:

```text
10 CLEAR200,&H5FFF
20 FOR I=0 TO299:POKE &H6000+I,I AND255:NEXT
30 FOR I=0 TO11:READ B:POKE &H6100+I,B:NEXT
40 DATA134,42,183,98,0,134,77,173,159,160,2,57
RUN
```

The routine stores 42 at `$6200`, prints `M` through the ROM's character-output
vector, and returns to BASIC. Its entry point is in the second tape data block:

| Address | Bytes | Instruction |
| --- | --- | --- |
| 6100 | 86 2A | LDA #$2A |
| 6102 | B7 62 00 | STA $6200 |
| 6105 | 86 4D | LDA #$4D |
| 6107 | AD 9F A0 02 | JSR [$A002] |
| 610B | 39 | RTS |

Pause, make a blank tape named `MARKER.wav`, engage Record, then Run and enter:

```text
CSAVEM "MARKER",&H6000,&H612B,&H6100
```

The arguments are the filename, first and **inclusive last** address, and
execution address. After `OK`, Pause, Stop, and Export WAV. Fresh power-on
clears RAM; Run to the prompt, enter `CLEAR200,&H5FFF`, and Pause. Load the
exported `MARKER-saved.wav`, engage Play, Run, and enter:

```text
CLOADM "MARKER"
```

After `F MARKER` and `OK`, inspect `$6000–$612B` in Memory. Enter `EXEC`:
the ROM uses the execution address from the tape header, prints `M`, and
returns to `OK`. `PRINT PEEK(&H6200)` prints 42. No address is supplied to
`EXEC`, so this checks that the header's entry point survived loading too.

The cassette acceptance test compares every byte, checks the filename header,
255-byte and 45-byte data blocks and their checksums, then repeats loading
from a compact CAS representation. A checkpoint midway through that CAS
playback resumes to exactly the same CPU, RAM, and tape state.

### Play 3-D Brickaway

An independently produced cassette exercises these parts together: **3-D
Brickaway**, by Britt Monk, is a 1982 machine-code game controlled with the
right joystick. Its [contemporary review][brickaway-review] describes the
perspective court, transparent paddle, and sound. Avalon Hill also published
it as Breakthru; its [instruction sheet][brickaway-instructions] explains
starting with fire and steering the paddle in both directions.

The acceptance image is the CAS member of the archive's
[3D Brickaway (Avalon Hill) ZIP][brickaway-cassette]. Keep it outside version
control; neither the game nor ROM bytes ship with the site.

| Image property | Accepted value |
| --- | --- |
| Local filename | `media/coco/3d-brickaway.cas` |
| Length | 11,563 bytes |
| SHA-256 | `da1e6a1671fd66fa9a269b61d960cccba2e4368cb54bd6f284b7babfeccaa365` |
| Cassette filename | `3DBRICK ` (one trailing space) |
| Data | 11,017 bytes, loaded at `$1648–$4150` |
| Execution address | `$412B` |
| Reconstructed tape | 66.585 seconds at 44,100 samples/second |

Use Color BASIC 1.3 and Extended Color BASIC 1.1. In the laboratory:

1. Fresh power-on and Run to `OK`, then Pause. Load `3d-brickaway.cas` in
   **Cassette**, engage **Play**, then Run and type `CLOADM` followed by Enter.
   `F 3DBRICK` appears during loading; wait for `OK`. Unlimited can shorten
   the wait without changing cassette timing in emulated clocks.
2. To test recovery during loading, Pause while the motor is on and the tape
   is partway through. **Save snapshot** retains the entire mounted waveform
   and its position. Fresh power-on, then **Restore snapshot** and Run:
   loading continues from the saved point and reaches `OK`.
3. In **Joysticks**, connect the right joystick, centre it, and release fire.
   Enter `EXEC`. The tunnel screen appears and asks for the right joystick
   button. Choose **Normal** and enable **Sound** before starting play.
4. Toggle **Hold fire** on and off. After the opening sound, the ball travels
   down the court. Move both right-joystick sliders to steer the paddle.
   The first brick hit raises the score to `00100`, removes one brick,
   changes the colour set, and sounds a short burst.
5. Pause during play and Save again, replacing the loading checkpoint. Move
   the sliders or power on afresh, then Restore. The paddle, ball, score,
   joystick positions, and tape return to the saved state. Run resumes play.

The browser stores one checkpoint. A long tape makes it several megabytes;
insufficient browser storage reports a failed save and preserves the previous
checkpoint. Normal speed is required for audible output; Unlimited deliberately
mutes host audio. The game uses 256×192 one-bit graphics. Its opening green/black
scene keeps its direct colours. After the first brick hit selects black/buff,
the laboratory's **Composite** display interprets dot pairs as blue and
orange/red artifact colours. **Direct** shows the individual black/buff dots;
**Swap colours** exchanges the two artifact colours without changing the game.
This uses the VDG chapter's [two-dot approximation](../../components/devices/specifications/mc6847.md#ntsc-artifact-colours),
not a full simulation of the original television image.

The [optional game test](../../../tests/site/coco-brickaway.test.ts) takes
`COCO_ROM`, `COCO_EXTENDED_ROM`, and `COCO_BRICKAWAY_CAS`. It checks every loaded
byte against the pinned cassette payload, restores a checkpoint halfway through
the waveform, and requires the same final CPU, RAM, devices, clock, and input
state. During play, independent X and Y changes must move the rendered paddle
and leave pixels outside the old/new paddle regions unchanged. The first hit
must remove one of forty bricks and add 100 points. Restoring a play checkpoint
must reproduce that result, including the sixteen DAC pulses and identical
48 kHz audio samples with different sample-drain batch sizes. The green scene
must be identical under direct and composite display. After the hit, both
artifact colours must occur; every pair must match the declared colour table
in both phases, with CPU, RAM, devices, input, and audio state unchanged by
rendering. Restoring the checkpoint must reproduce both composite rasters too.

These addresses were identified by inspecting this exact image and observing
its execution. They are useful in Memory and **Run to address**; they are not
emulator hooks or general CoCo contracts:

| Address | Observation |
| --- | --- |
| `$2559` | Poll right fire before starting the game |
| `$2A0B` | Paddle is drawn; next ball update is about to begin |
| `$015A–$015B` | Right X/Y measurements returned by the ROM |
| `$1E18–$1E19` | Score, high byte first |
| `$1E22–$1E23` | Paddle's video RAM address |
| `$1E24` | Balls remaining |
| `$1E26–$1E2A` | Five rows of eight brick-presence bits |
| `$2440`, `$244D` | Game writes high and low DAC levels at `$FF20` |
| `$2445` | Enable the DAC sound path through PIA 1 CB2 |

This is acceptance of loading, starting, controls, the first brick collision,
and recovery. Completing all five walls and the power-hit scoring strategy
have not been verified.

[brickaway-cassette]: https://colorcomputerarchive.com/repo/Cassettes/Games/3D%20Brickaway%20%28Avalon%20Hill%29.zip
[brickaway-instructions]: https://colorcomputerarchive.com/repo/Documents/Manuals/Games/Breakthru%20Instructions.jpg
[brickaway-review]: https://colorcomputerarchive.com/repo/Documents/Magazines/Rainbow%2C%20The%20%28OCR%29/The%20Rainbow%20Vol.%2002%20No.%2005%20-%20November%201982.pdf

## Sound

The [executable sound circuit](../../components/devices/specifications/coco-sound.md)
decodes PIA 1 PA7–PA2 as a six-bit DAC. PIA 0 CA2/CB2 select its path to the
television, and PIA 1 CB2 enables that path. PIA 1 PB1 is an independent
one-bit output. The board's `pias.soundLevel` observes the resolved pins without
reading guest registers or acknowledging interrupts. All retained sound state
already belongs to the PIAs; restoring them and the CPU clock restores the
guest's waveform generation. No new checkpoint fields are needed.

In the laboratory's **Execution** panel, click **Sound**, select **Normal**,
and **Run**. Sound starts off on every page load. **Unlimited**, manual Step,
Pause, debugger stops, and hidden pages are silent. Reset, fresh power-on,
media replacement, and checkpoint restore discard queued audio. Playback
resumes from the current output, without replaying old samples.

### Try Color BASIC SOUND

With `bas13.rom` loaded, paste this line into the screen:

```text
SOUND 128,2
```

The first argument controls pitch, not frequency in hertz; the second controls
duration. Both take values 1–255. This produces a short tone and returns to
`OK`. Try `SOUND 176,2` for a higher pitch or `SOUND 128,8` for a longer tone.
[Getting Started with Color BASIC][basic-manual], page 11, introduces the
command. The ROM computes and writes the waveform; the host does not interpret
SOUND or substitute a synthesizer.

### Try Extended BASIC PLAY

With both `bas13.rom` and `extbas11.rom` loaded, enter:

```text
PLAY "T4O3L8V15CEGP8V7C"
```

This plays C, E, and G, pauses, then plays a quieter C and returns to `OK`.
`T4` sets tempo, `O3` the octave, `L8` the note length, and `V15` the initial
volume. `P8` inserts a rest of that length; `V7` reduces the final note's
volume. These are the ROM's PLAY conventions, described in
[Getting Started with Extended Color BASIC][extended-manual], pages 133–138.
The same PIA/DAC path produces both examples.

### Clocked playback and acceptance

Apple II and CoCo share the sample averaging, browser audio transport, and
Sound controls. The Apple II supplies a Boolean latch converted to 0 or 1;
the CoCo supplies a normalized amplitude. Each completed CPU or waiting
boundary timestamps the final output with the machine clock. Samples average
the held amplitude across their intervals, independently of host batch size.
Within-instruction pulses are outside this model.

The browser uses modest gain, an 80 Hz high-pass filter to remove DC, and at
most 120 ms of queued audio. These are listening approximations, not the
television's analogue electronics. A slow host can leave gaps in playback;
it does not change guest timing to conceal them. Audio errors never stop the
CPU. Toggle Sound off and on to retry a browser audio interruption.

The [hardware tests](../../../tests/machines/6809/coco/sound.test.ts) check
every DAC value, multiplexer selection, the independent one-bit path, port
directions, and an independently timed 6809 waveform loop. The
[ROM acceptance tests](../../../tests/site/coco-sound.test.ts) enter the two
examples through the keyboard, measure their output, and replay sound from a
mid-note checkpoint. They require caller-supplied verified ROMs; no ROM bytes
or prerecorded audio are committed.

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

The native renderer defaults to direct colours. Its optional `composite` and
`composite-reversed` interpretations use the VDG chapter's artifact-mode and
pair-colour views, keeping the same physical RAM reads. They affect only RG6
black/buff graphics; other modes retain their direct colours. The laboratory
defaults to **Composite** and offers **Direct**, **Swap colours**, and a
scanline overlay. Swap is available only in the modeled artifact mode. Changing
these controls redraws a paused screen even with Live off and never executes
an instruction. Display choices survive power-on and checkpoint restoration
within the page, but are not machine state; reloading starts with Composite
and the unswapped phase.

The rendered frame has no scan position and does not advance elapsed time.
The board's sync schedule runs independently. The pair approximation, fixed
RGB palette, and scanline overlay are presentation choices. Full analogue
composite decoding, CRT simulation, dynamic RAM refresh, and instruction-internal
cycle accuracy remain outside the model.

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

**Normal**, selected on page load, limits Run to the chapter's 894,886.25 CPU
clocks per second; busy inspectors or a slow browser may make it slower.
**Unlimited** removes that limit. Both yield after at most 10,000 boundaries
or an 8 ms host-time slice. Switching speed leaves the machine, debugger
request, and input queue intact. Pausing, resuming, restoring, and switching
speed discard accumulated host-time budgets; a delayed callback retains at
most 16 ms of work. Time spent paused never becomes a catch-up burst.

Execution shows elapsed CPU clocks, including waiting intervals. **Mark clock**
sets an independent reference while paused; **Clear marker** removes it. Step,
Step over, and Step out each measure their own elapsed clocks. A breakpoint,
watchpoint, Pause, boundary limit, or execution error reports a stopped or
failed interval rather than completion. Errors include clocks from earlier
completed boundaries, not an invented duration for a failed instruction.
CPU reset preserves the clock and marker but clears the last step measurement.
Fresh power-on, ROM replacement, and checkpoint restoration replace the clock
and clear both measurements, even if the restored clock value is later.
Measurements and speed selection are laboratory controls, not checkpoint state.

Click the screen to type. Letters become uppercase; Enter submits a line,
Backspace sends the CoCo's left arrow, Home sends Clear, and Escape or Ctrl-C
sends Break. Paste accepts one ASCII line, with an optional trailing newline.
Unsupported characters and multiline pastes are rejected before anything is
queued. Text becomes physical keyboard chords, including Shift where needed.
Browser key repeat is ignored.

The host holds each queued chord for at least **50 ms of emulated time**, then
releases it for another 50 ms before the next chord. Each phase uses the declared
clock frequency, rounded up to 44,745 CPU clocks. The transition occurs before
the next CPU boundary after that duration; an instruction or wait can extend
it slightly. The next phase receives its own full duration. Ordinary execution,
interrupt entry, and idle waits all consume the saved `remainingClocks` budget;
zero-clock offers and inspection do not. This is a host typing convention, not
a hardware key-repeat model. Up to 1,024 chords
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
queued chords, current press/release phase, and remaining input clocks.
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
address is not reached. Run, Step, Step over/out, Pause, a machine replacement/reset, and loss
of window focus cancel the target. An error or an unserviceable wait also ends
the request. A matching PC is not a promise that an ordinary instruction will
run next: Instruction still explains any pending interrupt or wait boundary.

**Debugger** provides persistent PC breakpoints and RAM write watchpoints.
Breakpoints cover `$0000–$FFFF` and stop before the next CPU boundary, including
before interrupt arbitration or consumption of queued keyboard input. The
circles in Disassembly toggle the same breakpoints as the address list. Run
crosses the breakpoint that just stopped execution once; a later visit stops
again. Step crosses the current breakpoint and completes one native boundary.
Breakpoints added at the current PC stop the next Run immediately.

Write watchpoints cover physical RAM `$0000–$7FFF`. They observe completed
stores, including stores that leave the byte unchanged, without another CPU
bus read. ROM writes, device writes, reads, instruction previews, and host
snapshot restoration cannot trigger them. A match stops **after the complete
instruction or interrupt entry**: a word store or stacked frame is never left
half-executed. If several watched bytes are written in that boundary, the report
identifies the first matching store in execution order, with its before/after
values. It names the instruction address or interrupt source, distinguishing
interrupt entry from executing an opcode at the interrupted PC. **View writer**
and **View written RAM** browse the captured addresses without executing.

Both kinds of stop interrupt Run to address, guided checkpoints, and Step
over/out, cancelling the temporary request. Execution and Debugger show the reason. A failed boundary
reports its error rather than claiming a successfully completed watchpoint;
any partial machine effects remain visible. Configure at most 64 addresses in
each list. Enable/disable and remove controls work independently of the panel's
visibility. Preferences are remembered locally, separately from snapshots and
Apple II debugger settings. Reset, fresh power-on, ROM changes, and successful
snapshot restoration clear the current stop report but preserve those lists.
Existing layouts gain Debugger once as a tab beside Execution, preserving the
selected tab, collapsed state, and deliberately hidden tools.

**Step over** follows an ordinary call until its observed return; other
instructions and pending interrupt boundaries take one step. **Step out** follows
the most recently observed call or interrupt frame. Both use the same shared
policy and controls as the Apple II laboratory, retain the 2,000,000-boundary
limit, and can be interrupted by breakpoints, watchpoints, Pause, or errors.
Neither changes the PC or inserts a return.

**Call stack**, initially a tab beside System Stack, lists only observed calls
and interrupt entries, with entry, caller, continuation, and saved S values.
Its links browse Disassembly and show ROM labels when applicable. Capture
continues while the panel is hidden or Live is off. The raw S/U windows retain
their independent byte views; arbitrary words in RAM are never guessed to be
callers. Reset, restoration, fresh power-on, and ROM changes clear observed
frames. Existing arrangements gain the new tab once without reopening hidden
tools or changing their active/collapsed state.

Call/return metadata comes from the CPU chapter's effects, including BSR/LBSR,
indexed JSR, RTS, RTI, and PULS/PULU with PC selected. A return must match both
the observed stack register/position and continuation. Replacing S or returning
through altered bytes clears uncertain history and stops an active Step over/out
with an explanation. Arithmetic stack adjustments remain observable; a later
return must still match. The 6809's interrupt records distinguish external entry
from the instruction at PC. CWAI's previously observed saved frame is reused;
restoring a machine already waiting in CWAI cannot recreate its lost caller
history. Later calls can build a new partial history, retaining the loss notice.

**Changes**, initially a tab beside Disassembly, uses the same recorder,
controls, and view as the Apple II laboratory. It retains the latest 500 CPU
boundaries, newest first, with fetched instructions and register, flag, PC,
and actual RAM changes in store order. Field widths and flags come from the
CPU state description; A/B are recorded without duplicating their D alias.
External interrupt entry is labelled by source and interrupted PC, never as
an instruction fetched at that PC. Unchanged stores, ROM, and device writes
are not RAM changes. Completed effects of a failed boundary remain visible,
marked incomplete. Control latches and device state remain in their own
inspectors; this log is not a complete machine-state delta.

**Record changes** can be paused while execution continues. Filters and Live
change only the display; hidden panels still capture. **Clear log** empties
this log and restarts its event numbering. Reset, fresh power-on, restoration,
and successful ROM replacement clear history and stale last-step observations.
Saved arrangements gain Changes once without changing selected/collapsed tabs
or reopening hidden tools.

Every configured RAM write watch now has **History**, using the shared history
recorder and view. It retains the latest 256 completed physical writes per
address, oldest first, including unchanged stores and interrupt stack writes.
History captures even when that watch's stop toggle, Live, or Changes recording
is off. Each transfer retains its writer/interrupt identity, fetched bytes,
and before/after values; links browse code and RAM without executing or
repeating a device access. Clearing Changes does not clear watch history.
**Clear all** clears all watched histories; removing a watch clears its own
capture. Reset, fresh power-on, restoration, and ROM replacement clear every
capture. Addresses and stop choices remain saved separately from machine state.
These CoCo watches cover physical RAM writes only; Apple II's read/bus-write
watch modes retain their existing semantics in the same shared presentation.

The screen footer and SAM / video panel show the selected resolution, colour
count, CSS, and start address. The SAM panel also exposes GM beside V, making
the two chips' separate responsibilities visible. Broader ROM annotations,
extended semigraphics, and raster-position rendering remain subsequent work.

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

To try the shared debugger, save a snapshot at `$A07D` before its JSR. **Step
over** should stop at `$A080`, with S back at `$03D7` and every text cell cleared
to `$60`. Restore the snapshot, Step into the call, then open **Call stack**:
its entry is `$A928` and its continuation is `$A080`. **Step out** reaches the
same complete machine state as Step over. Disable unrelated breakpoints and
watchpoints for this exercise; either can deliberately stop the run earlier.
Add a RAM write watch at `$0400`, turn its stop toggle off, and repeat the call.
Its History should retain the store at `$A92F` from `$00` to `$60`, even with
Changes recording paused. The code and RAM links browse `$A92F` and `$0400`.


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
the ROMs but clears the program. The [cassette walkthrough](#saving-the-dot-program-on-cassette)
shows how to preserve a program across power-on. Programs requiring
instruction-internal video or peripheral timing remain outside this profile.

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
Disable unrelated breakpoints and RAM write watchpoints before following the
seven checkpoints in order; an enabled stop can interrupt the tour earlier.

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

To discover the pixel writer yourself, repeat the program with no write
watchpoints enabled during PCLS. Add a breakpoint at `$9361` in Debugger, then
queue `RUN` as above and choose Run. It stops at the PSET entry after PCLS has
cleared the bitmap. Now add a RAM write watchpoint at `$1210` and choose Run
again. Execution crosses the entry breakpoint once and stops after the pixel
store: **Instruction `$9386` wrote RAM `$1210`: `$00 → $20`**, with PC at `$9388`.
View writer shows the instruction in Disassembly; View written RAM shows the
stored byte. The write watchpoint would also stop PCLS or another routine that
stores the same value, which is why it is armed only after the clear. Save before
the store and restore to repeat it; configured stops remain in place, while the
previous stop report is cleared.

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
history, pressed keys, joystick positions/connections/buttons, cassette media
and transport, the SAM control word, elapsed CPU clocks (including idle
intervals), and both ROM identities (or explicit absence). The stateless VDG contributes an empty snapshot. Restoring
requires matching verified media in both sockets; it does not reapply power-on or CPU reset.
Taking a snapshot or rendering a frame must neither acknowledge a pending
interrupt nor release a held key. Browser checkpoints use version 6. Versions
1 and 2 predate the clock: migration starts the schedule at zero and preserves
old PIA levels and pending flags until the next edge. Version 1 also acquires
an empty extension socket. Versions 1–3 used a 12,000-boundary keyboard phase:
migration preserves the fraction remaining as part of the new 50 ms phase,
rounded up to a whole clock. The old phase's actual elapsed time cannot be
reconstructed. Queued chords, held switches, and version-3 clocks are retained.
Versions 1–4 acquire two disconnected joysticks, preserving their former high
comparator and released fire inputs. Versions 1–5 acquire an empty, stopped
cassette recorder, preserving their former high PA0 input. Current browser
checkpoints pack tape samples as base64; native snapshots use detached byte
arrays. Missing clock, joystick, cassette, or input fields in current
checkpoints are rejected. Reading an older checkpoint does not overwrite it;
saving writes version 6. Storage errors preserve the previous checkpoint.

The [laboratory execution tests](../../../tests/site/coco-execution.test.ts)
compare Normal, Unlimited, and single stepping with queued repeated keys;
measure nested calls, stopped requests, and waits; and check restoration and
stale host callbacks. The [keyboard tests](../../../tests/site/coco-input.test.ts)
check exact phase boundaries, zero-clock offers, and independent press/release
durations. The real-ROM sessions below verify typing and graphics with this
clock-based transport.

### Waiting for a video interrupt

The [clock acceptance test](../../../tests/machines/6809/coco/timing.test.ts)
uses a synthetic ROM with an IRQ handler at A100. Its program sets S to 7FFF,
selects PIA 0's data registers, disables HS IRQ, enables falling-edge FS IRQ,
and reads FF02 to acknowledge an old flag. It configures PIA 1's video outputs
for internal text, selects the SAM page at 0400, and writes
40 (inverse `@`) there, then clears I and repeats SYNC followed by a branch
back to SYNC. The handler reads FF02, increments 0400, and returns with RTI.
A second run substitutes CWAI #EF for SYNC.

Before the first FS falling edge, the character stays 40. At clock 13,106 the
PIA requests IRQ. The next boundary enters the handler, which acknowledges the
request and changes the character to 41 (inverse `A`). Subsequent fields advance
the character once each. CWAI reuses its saved stack frame and pays four entry
clocks; SYNC requires the ordinary 19-clock IRQ entry. Restoring a checkpoint
at the pending edge must reproduce all subsequent records, RAM, PIA state,
clocks, and pixels. Single steps and batches of 7 or 137 boundaries, with or
without drawing, must give identical results. Additional checks cover both
edges of a short HS pulse, multiple fields, masked waits, and phase near the
clock counter's safe-integer limit. No private firmware is needed.

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
The board sync schedule runs throughout, but this polling transcript does not
exercise accepted video interrupts. The counter example above verifies those
separately.

The optional [browser-session test](../../../tests/site/coco-rom.test.ts) repeats
the conversation through the same queued matrix transport used by the page,
including editing and Break. It also restores mid-key and compares subsequent
execution records and complete state. [Host tests](../../../tests/site/coco-input.test.ts)
check repeated chords, release gaps, bounded queues, invalid continuation state,
and explicit release without firmware.

[rom-catalogue]: https://github.com/mamedev/mame/blob/master/src/mame/trs/coco12.cpp
[technical]: https://colorcomputerarchive.com/repo/Documents/Manuals/Hardware/Color%20Computer%20Technical%20Reference%20Manual%20%28Tandy%29.pdf
[basic-manual]: https://colorcomputerarchive.com/repo/Documents/Manuals/Hardware/Getting%20Started%20With%20Color%20Basic%20%281984%20Edition%29%20%28Tandy%29.pdf
[extended-manual]: https://colorcomputerarchive.com/repo/Documents/Manuals/Hardware/Getting%20Started%20With%20Extended%20Color%20Basic%20%28Tandy%29.pdf

[extended-manual]: https://colorcomputerarchive.com/repo/Documents/Manuals/Hardware/Getting%20Started%20With%20Extended%20Color%20Basic%20%28Tandy%29.pdf

[extended-unravelled]: https://colorcomputerarchive.com/repo/Documents/Books/Unravelled%20Series/extended-basic-unravelled.pdf
