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
with the board wiring. A future host queue must be saved separately.

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
The laboratory and host drawing/keyboard controls are subsequent work.

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

[rom-catalogue]: https://github.com/mamedev/mame/blob/master/src/mame/trs/coco12.cpp
[technical]: https://colorcomputerarchive.com/repo/Documents/Manuals/Hardware/Color%20Computer%20Technical%20Reference%20Manual%20%28Tandy%29.pdf
