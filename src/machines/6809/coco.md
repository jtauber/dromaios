# TRS-80 Color Computer: Color BASIC on native Dromaios hardware

Tandy introduced the Color Computer in 1980. Its 6809, television display,
and built-in BASIC offered a very different starting point from the Altair's
front panel or the Apple II's 6502 and expansion slots. This chapter describes
a **CoCo 1 NTSC profile with 32 KiB RAM and a Color BASIC 1.3 ROM upgrade**.
The later ROM is deliberate: [MAME's ROM catalogue][rom-catalogue] associates
it with the CoCo 2B, rather than this original factory configuration.

The native machine boots the supplied ROM, scans physical keyboard switches,
and produces text and semigraphics-4. Its [reference audit](../../../docs/machines/coco.md)
records comparisons with dromaios-coco; this implementation runs entirely on
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
    pias = coco-pias
    sam = mc6883
    vdg = mc6847
}

map 10000 {
    0000 = ram
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
vector at FFFE–FFFF. ROM writes leave it unchanged. The Extended BASIC socket
at 8000–9FFF, cartridge region C000–FEFF, and peripheral region FF40–FFBF
are empty. Unanswered reads return FF and writes are ignored: this is an
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

Only this exact 8,192-byte image is accepted. Combined images, Extended BASIC,
and cartridges are outside the profile. No firmware bytes are tracked or
published. The SHA-1 cross-check in MAME is
`28b92bebe35fa4f026a084416d6ea3b1552b63d3` (`bas13.rom`).

```machine
image firmware external sha256 5375b1caef9df815b781d9cd6df81ecdaddd2642b06a01adac521e40f1329751

cpu 6809 {
    A = 00  B = 00  DP = 00
    X = 0000  Y = 0000  S = 0000  U = 0000  PC = 0000
    waitMode = none  nmiArmed = false
    flags { E = 0  F = 1  H = 0  I = 1  N = 0  Z = 0  V = 0  C = 0 }
}

reset { cpu }
```

`create6809Coco({ firmware: null })` allocates inspectable hardware before
firmware is available. Verify media with `RomImage.verify` and the generated
`romImages.firmware` identity, then install it with `firmware.install(image)`.
Installation preserves the machine. The separate `reset()` reads FFFE and
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
SAM page. With V=000 and A/G=0, it decodes 512 physical RAM bytes into
256-by-192 colour indices. It never calls the CPU memory connection or reads
PIA registers. Even F=7F reads physical 7E00–7FFF rather than FF00 I/O.
Inverse characters include their blank margins; semigraphics blocks use all
eight colours independently of CSS. The font bitmap and palette-index contract
are linked from the VDG chapter. Unsupported SAM/VDG combinations report an
error instead of displaying a plausible but incorrect text screen.

The frame has no scan position or elapsed time. There is no automatic field
interrupt, CRT/composite simulation, dynamic RAM refresh, or cycle accuracy.
The laboratory maps these indices to fixed RGB colours and offers a scanline
overlay. Both are presentation approximations, not composite video or hardware time.

## Using the laboratory

The [CoCo laboratory](https://microcomputer.world/machines/color-computer/laboratory/)
uses the shared docking workspace with its own saved layout and Live preferences.
Load the Color BASIC image identified above, then choose **Run**. The ROM is
verified before installation and remembered locally when browser storage is
available. It is never uploaded. Reload verifies the remembered bytes again and
opens a fresh, paused machine; it does not automatically execute or restore a
saved program. **Forget remembered ROM** removes the saved file while keeping
the current machine's verified ROM.

RAM and device inspectors work before firmware is loaded. Loading the first ROM
preserves that hardware and resets the CPU; replacing a loaded ROM starts a fresh
machine. A rejected file leaves CPU, RAM, and device state intact and execution
paused. **Step** advances one native machine boundary, which may be an instruction,
interrupt entry, or wait result. **Pause** finishes the current batch and stops
before another. **Reset CPU** preserves RAM and devices; the host also cancels queued
input and releases keyboard switches. **Fresh power-on** constructs new hardware,
clears RAM and input, and retains the verified ROM.

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
state and matching ROM before replacing the session, stays paused, and clears
the recent-step display. It does not issue a reset or inject another key.
The checkpoint contains the ROM identity, not its bytes; the ROM must be loaded
separately. Failed restoration preserves the current session, and failed saving
preserves the previous checkpoint. Layout and Live choices are not machine state.

Specialized stack/direct-page views remain subsequent work. S, U, and DP are
visible and their memory can be inspected by address. ROM annotations, graphics
modes, and an independently checked timing model also remain subsequent work.

## Snapshots and acceptance

`snapshot()` owns copies of CPU and RAM state, both PIAs' latches and edge
history, pressed keys, the SAM control word, and the firmware identity (or
explicit absence). The stateless VDG contributes an empty snapshot. Restoring
requires matching verified media; it does not reapply power-on or CPU reset.
Taking a snapshot or rendering a frame must neither acknowledge a pending
interrupt nor release a held key.

The [synthetic tests](../../../tests/machines/6809/coco/machine.test.ts) run
without private media. They cover the full vector alias, ROM protection and
empty sockets, generated CPU transfers, live IRQ/FIRQ levels, snapshots with
held keys, frame decoding, page changes, and refusal of unsupported modes.
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
