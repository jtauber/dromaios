# IBM PC/XT: native firmware startup

This executable chapter assembles the selected IBM 5160 board around the
[8088](../../components/cpus/specifications/8088.md). The current acceptance target
is **reset through ROM BASIC and native keyboard input**, using the original
11/08/82 BIOS. The CPU tests itself, tests DMA and the first 16 KiB of RAM,
discovers 640 KiB, initializes its interrupt vectors, and resets the XT keyboard.
It then programs CGA, tests video RAM and retrace status, and clears the display.
The continuation tests RAM and the empty diskette drive's reset and seeks,
passes the second keyboard reset, and attempts a disk boot. With no disk
inserted, the BIOS's own timeout leads to ROM BASIC C1.10. BASIC prints its
prompt and evaluates `PRINT 2+2` entered through the keyboard receiver and IRQ1.
No BIOS service is replaced by host code and no BIOS data area is preloaded.
Stored-program editing, Ctrl-Break, firmware warm boot, a browser laboratory,
and disk-image transfers remain subsequent acceptance work.

## Physical storage and firmware

The board has 640 KiB of conventional RAM, separate 16 KiB CGA backing storage,
and externally supplied BIOS, BASIC, and character ROM images. The CGA storage
aliases at `B8000` and `BC000`; the character ROM connects only to the display
and is not visible on the CPU bus. Missing memory
reads as `FF`, and writes to missing memory or ROM are ignored. This fixed
unanswered-bus value is a model convention, not an electrical floating-bus model.

The original XT's decoder repeats the first 8 KiB of BASIC at `F0000`, `F2000`,
and `F4000`; BASIC's full image occupies `F6000–FDFFF`, and BIOS occupies
`FE000–FFFFF`. Windows below express those aliases without copying ROM bytes.
[IBM's Technical Reference][ibm] and the [ROM layout notes][rom-layout] describe
the selected board and sockets. The [target audit](../../../docs/machines/pc-xt.md)
records the pinned reference emulator and later acceptance milestones.

```machine
components {
    ram = ram A0000
    video = ram 4000
    cga = ibm-cga
    font = rom 2000
    bios = rom 2000
    basic = rom 8000
    io = xt-io
}

map 100000 {
    00000 = ram
    B8000 = video
    BC000 = video
    F0000 = window 2000 {
        read = basic
        write = discard
    }
    F2000 = window 2000 {
        read = basic
        write = discard
    }
    F4000 = window 2000 {
        read = basic
        write = discard
    }
    F6000 = basic
    FE000 = bios
    unmapped = FF
}

image bios external sha256 2798f8a9a7dcab651ede40373d35269ad573b75acf811115c263e034ef80a1f2
image basic external sha256 3033d1a54c99d7e2aa1fc7c8c2e51a56ae1b61bf4e70e8aa580f43c43e37a63e
image font external sha256 37527f661580e5a09710051cec67422abfadf31c61b841537a91e7f27be19304
```

The generated `create8088PcXt({ bios, basic, font })` accepts independently verified
`RomImage` bindings or explicit `null` for absent firmware. Installation does
not reset or execute the machine. Snapshots store ROM identities, not ROM bytes;
restoration requires the same bindings. The optional ROM-backed test uses
`XT_BIOS_ROM` and `XT_BASIC_ROM`; `XT_CGA_ROM` additionally checks the rendered
firmware test bar. Firmware stays external to the repository. The selected
8 KiB [IBM MDA/CGA character ROM][font-image] uses its default double-dot CGA
bank at offset `1800`; the font is unnecessary for CPU execution but required
for visible text rendering. Missing bindings are not replaced with a host font.

## Power-on and reset

Construction allocates zeroed RAM and deterministic inactive CPU/device state.
Call `reset()` to reset CPU and board, then `stepTimedXtCpu()` to execute from
`FFFF:0000` (physical `FFFF0`). The BIOS far jump enters `F000:E05B`.
RAM and installed ROMs survive reset. `cpu.reset()` alone preserves the board;
fresh construction supplies fresh RAM and device state. Hardware leaves some
register/RAM power-on values unspecified; this model chooses zero explicitly.

```machine
cpu 8088 {
    AX = 0000  BX = 0000  CX = 0000  DX = 0000
    SP = 0000  BP = 0000  SI = 0000  DI = 0000
    CS = 0000  DS = 0000  SS = 0000  ES = 0000  IP = 0000
    halted = false waiting = false interruptDeferred = false recognitionDeferred = false trapPending = false
    flags { CF = 0  PF = 0  AF = 0  ZF = 0  SF = 0  TF = 0  IF = 0  DF = 0  OF = 0 }
}
reset { cpu io cga }
```

## Board ports, checks, and interrupts

The port map connects DMA, PIC, PIT, PPI, CGA, the diskette adapter, and the
write-only NMI-enable latch.
Unpopulated ports return `FF` and ignore output, including the absent expansion
box at `0213`. CGA's index/data aliases are declared; extra system-board port
aliases are not yet decoded. The selected switch byte is `2D`: 256 KiB planar
RAM, no 8087, 80-column colour, one drive, and no manufacturing loop.

```machine
ports {
    in 00 = io 00
    out 00 = io 00
    in 01 = io 01
    out 01 = io 01
    in 02 = io 02
    out 02 = io 02
    in 03 = io 03
    out 03 = io 03
    in 04 = io 04
    out 04 = io 04
    in 05 = io 05
    out 05 = io 05
    in 06 = io 06
    out 06 = io 06
    in 07 = io 07
    out 07 = io 07
    in 08 = io 08
    out 08 = io 08
    out 09 = io 09
    out 0A = io 0A
    out 0B = io 0B
    out 0C = io 0C
    in 0D = io 0D
    out 0D = io 0D
    out 0E = io 0E
    out 0F = io 0F
    in 20 = io 20
    out 20 = io 20
    in 21 = io 21
    out 21 = io 21
    in 40 = io 40
    out 40 = io 40
    in 41 = io 41
    out 41 = io 41
    in 42 = io 42
    out 42 = io 42
    out 43 = io 43
    in 60 = io 60
    out 60 = io 60
    in 61 = io 61
    out 61 = io 61
    in 62 = io 62
    out 62 = io 62
    out 63 = io 63
    out A0 = io A0
    out 3D0 = cga 0
    in 3D1 = cga 1
    out 3D1 = cga 1
    out 3D2 = cga 2
    in 3D3 = cga 3
    out 3D3 = cga 3
    out 3D4 = cga 4
    in 3D5 = cga 5
    out 3D5 = cga 5
    out 3D6 = cga 6
    in 3D7 = cga 7
    out 3D7 = cga 7
    out 3D8 = cga 8
    out 3D9 = cga 9
    in 3DA = cga A
    out 3F2 = io F2
    in 3F4 = io F4
    in 3F5 = io F5
    out 3F5 = io F5
    unmapped = FF
}
```

The [system-control specification](../../components/devices/specifications/ibm-xt-system-control.md)
owns NMI enable and parity/channel-check latch behavior. PPI PB4/PB5 clear and
disable the corresponding checks; PC7/PC6 report them. Normal RAM has no parity
storage, so inputs remain inactive unless diagnostics explicitly call
`io.setCheckErrors(parity, channel)`. A pending NMI is offered before INTR and
consumed after successful CPU entry; a held error does not retrigger it. CPU
recognition delays remain CPU decisions. Port `A0` writes use only bit 7 and
have no guest readback.

The [timer](xt-timer.md) and [refresh](xt-refresh.md) chapters own oscillator,
device ordering, and DMA grants. The same execution helper services this board
and the small examples. It grants refresh, offers interrupts, executes one CPU
boundary, and advances devices using declared instruction clocks. Repeated
strings use the CPU chapter's explicitly bounded **one-element re-entry timing**;
this does not reproduce an uninterrupted hardware REP's throughput.
Timing covers POST, empty-drive bootstrap, the BASIC prompt and immediate
arithmetic, and the BIOS services below. Unsigned multiplication and division use the CPU chapter's documented
**published-range ceilings**, including memory and word-transfer costs;
operand-dependent arithmetic microcode remains unmodeled.

## Empty diskette drive

The [diskette chapter](../../components/devices/specifications/ibm-xt-diskette.md)
owns the adapter latch, µPD765 command/result phases, one-drive scope, mechanical
head position, and explicit timing limits. Board ports `3F2`, `3F4`, and `3F5`
route to local `XtIo` offsets `F2`, `F4`, and `F5`. The controller advances from
the same elapsed microseconds as the keyboard, including refresh grants and
halted CPU intervals. IRQ6 is a settled device output, alongside timer IRQ0
and keyboard IRQ1; callers cannot independently drive those three lines.
PIC acknowledgement/EOI does not acknowledge the diskette controller.

There is one empty 40-cylinder drive. Reset, recalibration, and seeks can
complete without media. Reads wait for absent index/data pulses, with no
controller result, IRQ, or DREQ2; the original BIOS's own loop times out.
The DMA register file accepts the BIOS's single-write setup for channel 2,
but its address and count do not advance. Channel-2 bus transfers, DMA page
latches, mounted media, and DOS boot remain unimplemented. In particular,
port `81` is still unanswered; accepting an empty read is not a working disk
transfer implementation.

Snapshots retain partial commands/results, reset and seek timing, physical
head position, and the controller's cylinder estimate. CPU reset preserves
them. Board reset clears the adapter/controller and cancels in-flight work;
it preserves the mechanical position and Specify timing registers.

The [board tests](../../../tests/machines/8088/pc-xt/diskette.test.ts) check port
routing, fractional clock continuation, native IRQ6 entry from HLT, separate
controller/PIC acknowledgement, and absence of DMA or memory side effects.
The [original-ROM boot tests](../../../tests/machines/8088/pc-xt/rom-boot.test.ts)
start at reset and require the exact reset/Specify/recalibrate/seek sequence,
four IRQ6 entries, seeks to cylinders 1 and 34, and `F000:E597` without entering
the `601` diskette-error path at `F000:E58A`.

After that native setup, small RAM callers invoke original INT 13h. Reset must
return success and reprogram Specify. A one-sector read must enter the no-index
wait, return carry set and AH=`80` through the BIOS timeout, and leave the
sector buffer and channel-2 address/count unchanged. A snapshot taken inside
that wait must resume to identical complete state. These callers change their
own code and entry registers; they never patch BIOS, its vectors, or its data.

## CGA text output

The [CGA device chapter](../../components/devices/specifications/ibm-cga.md)
owns the 6845 register masks, scan/status signals, display-start latch, cursor,
and attribute/blink rules. This board selects 40/80-column, 25-row RGBI text
with eight-line characters. Graphics, composite colour, and the CRTC's internal
cursor-blink modes are outside this first profile.

`stepTimedXtCpu()` advances CGA and the system board from the same oscillator:
refresh grants advance both before CPU accesses, and instruction/interrupt
clocks advance both after the CPU boundary. An idle halt advances both to the
next PIT pulse. For explicit device-only advancement, call
`advanceXtOscillatorTicks(machine, ticks)`; calling `io.advanceOscillatorTicks()`
alone advances only the system-board devices. Snapshots retain CGA's divider,
scan and blink phase alongside the board clock, so inspection and restoration
do not restart the display.

The pure [text renderer](pc-xt/video.ts), `renderXtTextFrame(machine)`, returns
a detached 320×200 or 640×200 array of RGBI colour indices. It reads physical
video RAM and the character ROM without CPU bus accesses or elapsed time.
`cgaColours` supplies the 16-colour monitor palette. Presentation code can scale
40-column pixels to the same physical screen width; a browser display is not
part of this slice. The renderer rejects unsupported profiles and a missing
font when video is enabled, and returns black when configured video is disabled.

### Original BIOS text services

The ROM's `INT 10h` handler is ordinary 8088 code. It converts row/column
positions to video-memory offsets, polls CGA status, writes characters and
attributes, and programs the CRTC cursor and display start. The BIOS data area
stores the active page, page size, and each page's cursor. IBM describes the
interface on printed pages A-46–A-48 of the [Technical Reference][ibm]; the
teletype routine is on A-68–A-69.

The [original-ROM text tests](../../../tests/machines/8088/pc-xt/rom-video.test.ts)
establish these cases through timed execution:

| BIOS service (`AH`, hexadecimal) | Acceptance |
| --- | --- |
| `00`, `0F`: set/read mode | Modes 0–3 initialize 40/80-column text, report the correct geometry, and retain the RGBI text profile. |
| `01`–`03`: cursor shape, position, and query | Cursor registers and per-page BIOS positions agree; a programmed shape and hidden cursor reach the rendered pixels. |
| `05`: select active page | All eight 40-column pages and four 80-column pages retain independent text/cursors; hidden-page writes survive selection. Display start takes effect at the next frame boundary. |
| `06`, `07`: scroll up/down | A bounded window copies rows in the correct direction, leaves its border and cursor untouched, and fills vacated cells with the supplied attribute. A zero count clears the window. |
| `08`–`0A`: read/write character and attribute | Repeated writes preserve cursor position; character-only writes retain the existing attribute, and reads return both bytes. |
| `0E`: teletype | Ordinary characters retain cell attributes; carriage return, line feed, and backspace update the active page's cursor. Backspace at column zero stays there; wrapping at the bottom right scrolls the screen. |

These tests first run reset through `F000:E30A`, then start small RAM callers
of the installed BIOS handler. The original POST supplies their IVT, BIOS data
area, and display state. This is a service-level acceptance fixture, not a claim
that later POST or disk boot has completed. It adds no host BIOS services or
firmware patches. The same suite saves a scroll during a `REP MOVSW` element
sequence and requires restored execution to reproduce RAM, CPU, device state,
clock phase, and pixels. `XT_CGA_ROM` enables the original-font pixel checks.

## Acceptance boundary

The [machine tests](../../../tests/machines/8088/pc-xt/machine.test.ts) check
storage bounds, ROM identities/aliases, protection, unanswered ports, reset,
and detached restoration. Synthetic firmware tests exercise the same map and
CPU path without distributing historical ROM bytes.

With the selected external ROMs, the [startup test](../../../tests/machines/8088/pc-xt/startup.test.ts)
begins at reset, checks `F000:E242` before video initialization, and continues to
`F000:E30A` after the video tests and immediately before the option-ROM scan.
It requires 640 KiB in the BIOS data area, the selected equipment switches,
firmware-owned interrupt vectors, successful DMA refresh, and the keyboard's
native `AA` self-test response through IRQ1. The video continuation requires
the ROM's temporary test bar, successful retrace polling and video-memory tests,
the mode-3 BIOS data area and CRTC values, and cleared video RAM. With the font
installed, it checks the bar's pixels without changing machine state.
It rejects unsupported execution, failure halts, and unexpected diagnostics.
A saved continuation must reach the same boundary with identical CPU, RAM,
devices, and oscillator time. Independent [rendering tests](../../../tests/machines/8088/pc-xt/video.test.ts)
cover text pixels, attributes, cursor, wrapping, and saved blink phase.
The test never patches firmware, seeds RAM, or shortcuts a BIOS routine.

### ROM BASIC boot and input

The [boot tests](../../../tests/machines/8088/pc-xt/rom-boot.test.ts) continue
from reset through the remaining POST and empty-drive bootstrap. Both keyboard
resets must deliver `AA` through IRQ1, with a nonzero timeout counter after the
second reset at `F000:E3B7`. Neither the keyboard `301` path nor diskette `601`
path may be entered. The keyboard chapter owns the response delay; it allows
the original ROM to clear its interrupt flag before the response arrives.

Without any host input, the BIOS must exhaust its disk boot attempt, retain
the disk timeout status `80`, and enter BASIC at `F600:0000`. The selected ROM
then displays these first four rows and waits in the original INT 16h input loop:

```text
The IBM Personal Computer Basic
Version C1.10 Copyright IBM Corp 1981
62940 Bytes free
Ok
```

BASIC uses the CGA character `FF` as a blank in some text; screen assertions
treat it as a space, retaining the original video-memory bytes. Host make/break
codes type `PRINT 2+2`, including Shift and its release. The command must echo,
print ` 4`, and return to `Ok`; every supplied byte must traverse native IRQ1.
The host retains rejected offers rather than overwriting an unconsumed byte.

A snapshot taken with the first key pending in the receiver/PIC, together with
the remaining host input queue, must resume identically with execution batches
of 1, 37, or 4096 boundaries. The test compares complete CPU, RAM/video memory,
device state, and oscillator phase. It never supplies F1 to bypass POST, changes
the CPU entry registers, seeds BIOS RAM, or replaces a firmware routine.
This establishes a first interactive ROM BASIC session, not the later stored-program,
editing, warm-boot, or DOS milestones in the target audit.

[ibm]: https://minuszerodegrees.net/manuals/IBM_5160_Technical_Reference_APR83.pdf
[rom-layout]: https://www.pcjs.org/machines/pcx86/ibm/5160/rom/
[font-image]: https://www.pcjs.org/machines/pcx86/ibm/video/cga/
