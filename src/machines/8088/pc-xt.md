# IBM PC/XT: native firmware startup

This executable chapter assembles the selected IBM 5160 board around the
[8088](../../components/cpus/specifications/8088.md). The current acceptance target
is **a repeatable ROM BASIC programming session**, using the original
11/08/82 BIOS. The CPU tests itself, tests DMA and the first 16 KiB of RAM,
discovers 640 KiB, initializes its interrupt vectors, and resets the XT keyboard.
It then programs CGA, tests video RAM and retrace status, and clears the display.
The continuation tests RAM and the empty diskette drive's reset and seeks,
passes the second keyboard reset, and attempts a disk boot. With no disk
inserted, the BIOS's own timeout leads to ROM BASIC C1.10. BASIC prints its
prompt and accepts immediate commands and stored programs through the keyboard receiver and IRQ1.
No BIOS service is replaced by host code and no BIOS data area is preloaded.
The [session checks](#rom-basic-sessions) cover editing, Ctrl-Break, warm boot, and saved input.
The [browser laboratory](#using-the-laboratory) runs this machine with locally supplied ROMs.

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
Timing covers POST, empty-drive bootstrap, the BASIC sessions below, and the
selected BIOS services. Unsigned multiplication and division use the CPU chapter's documented
**published-range ceilings**, including memory and word-transfer costs;
operand-dependent arithmetic microcode remains unmodeled.

### When does the 8088 see INTR?

The PIC can have a timer request pending while its mask keeps INT low. Suppose
the CPU unmasks that request with `OUT 21h,AL` and the next instruction reads
the mask. Does the read happen before the timer handler can change it?

Intel describes INTR as sampled in the clock preceding the end of the current
instruction ([8086 Family User's Manual][intel], figure 4-19 and accompanying text).
Our board approximates this ordering at instruction boundaries: a PIC output
that goes high *because of the current CPU bus access* misses that instruction's
sample. The following instruction can run, then the CPU can accept INTR. The
PIC pin itself changes immediately; the board saves the missed sample separately.
An IRQ already asserted before the instruction, or one raised by a later timer
tick or host key between steps, follows the normal interrupt-offer path.
This is a board timing convention, not a new interrupt shadow on every `OUT`;
it does not simulate propagation delays or individual bus clocks.

The distinction matters on warm boot: timer 0 is still running when POST tests
the PIC mask (`F000:E331`). If IRQ0 is accepted before the following `IN`, the
diagnostic handler masks it and the BIOS reads back the handler's mask instead
of the one it wrote. The [board timing test](../../../tests/machines/8088/pc-xt/timed-execution.test.ts)
checks the same ordering with an independent IRQ and a save immediately after `OUT`.

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
`cgaColours` supplies the 16-colour monitor palette. The laboratory fits both
widths to a 4:3 monitor. The renderer rejects unsupported profiles and a missing
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

### ROM BASIC sessions

The [session tests](../../../tests/machines/8088/pc-xt/rom-boot.test.ts) continue
from that authentic prompt. The host supplies one line at a time, as XT scan
codes, and waits for BASIC to consume it. The assertions read CGA character
cells; they never inspect or modify BASIC's internal program representation.

| At the keyboard | What the ROM displays |
| --- | --- |
| Type `PRINT 2+3`. Type `PRINT 77`, Backspace twice, type `12`, and press Enter. | The first answer is 5; the edited line reads `PRINT 12` and produces 12. The repeated digits and Backspaces have separate makes and breaks. |
| Enter the three lines below, then `LIST` and `RUN`. | The listing reproduces the three lines in order. The run prints 5 and returns to `Ok`. |
| Replace line 20 with `20 A=A+4`, list, and run again. | Only line 20 changes; the run prints 6. `NEW` followed by `LIST` returns straight to `Ok` with no program lines. |
| Run `10 GOTO 10` and press Ctrl-Break (Ctrl + the XT's Scroll Lock/Break key). | BASIC prints `^C`, `Break in 10`, and `Ok`. After the releases, `PRINT 2+3` still produces 5. |

```basic
10 A=2
20 A=A+3
30 PRINT A
```

While typing `RUN` for the edited program, save after R has been entered, Shift
is held, and U's make is pending in the receiver and PIC. The machine snapshot
owns the accepted byte and the emulated hardware; the host saves the unaccepted
suffix separately. A mismatched BASIC ROM must not restore that session.
Resuming from serialized data with batches of 37 or 4096 boundaries must match
single stepping: the same interrupt and boundary counts, output, CPU, RAM,
video, devices, and oscillator phase.

**Restarting a session.** Ctrl-Alt-Del is firmware behavior on the XT. Its IRQ1
handler writes `1234` to `0040:0072` and jumps to `F000:E05B` without resetting
the board clock. The test holds the chord through POST and releases it at the
new BASIC prompt. POST reaches BASIC again through the empty-drive bootstrap;
the banner and free space match cold boot, `LIST` is empty, and an immediate
command works. This schedule matters: the BIOS checks the keyboard for stuck
keys during POST. Break bytes offered during that check can produce a `301`
diagnostic. This byte-level fixture does not model the keyboard's internal
pre-reset queue or a browser's key-release policy.

By contrast, CPU-only reset returns to physical `FFFF0` and clears IF, preserving
the general registers, RAM, video, devices, pending key, and clock. Fresh power-on starts at the
same vector with zeroed RAM/video, inactive devices, and oscillator time zero.

## Using the laboratory

In **Firmware**, choose the 8 KiB XT BIOS dated 11/08/82, the 32 KiB IBM BASIC
C1.10 ROM, and the 8 KiB IBM MDA/CGA character ROM. Each file is checked against
the identity in this chapter and remembered locally. Press **Run**. The first
part of POST runs with video disabled, so the screen takes time to appear.
The address and emulated seconds in **Execution** show the board advancing.
With its drive empty the XT boots into BASIC.

Click the screen at `Ok`. Paste the three-line [program above](#rom-basic-sessions),
including a final Enter, then type `LIST` and `RUN`. To resume later, pause and
choose **Save snapshot**. The checkpoint includes RAM, CGA storage, CPU, board
devices, and any undelivered keyboard input. On a later visit, restore it with
the same three ROMs loaded. **Step** advances one timed CPU boundary.

From fresh power-on, **Disassembly** shows `EA 5B E0 00 F0` at `FFFF:0000`
(physical `FFFF0`). The far jump takes its offset from the first word and its
segment from the second. Step once. **Registers** highlights CS changing to
`F000` and IP to `E05B`. The current disassembly row moves to physical `FE05B`,
with the jump above it. Recent rows use the bytes the CPU fetched. The current
row and the rows below it read the instruction stream from RAM or loaded ROM.
Fetching across `IP=FFFF` wraps the offset within CS. A missing byte, unsupported
encoding, or the inspector's 32-byte preview limit ends the forward listing.

**Memory** scrolls through physical addresses `00000–FFFFF`. Enter a hexadecimal
address or `segment:offset` in its header. `FFFF:0000` and `F000:FFF0` both
select `FFFF0`, showing the same `EA 5B E0 00 F0` bytes. The field normalizes
the entry to its physical address. A projected address wraps at 1 MiB, so
`FFFF:0010` selects `00000`. Each segment and offset must fit sixteen bits.

Select **CS:IP**, then Step from fresh power-on. Memory and Disassembly both
move to `FE05B`. **SS:SP** follows the physical stack pointer. **FIX**, entering
an address, or scrolling keeps the position fixed. The **8 / 16** buttons
change bytes per row. The listing stays in physical address order across
`0FFFF–10000` and ends at `FFFFF`. RAM is visible before firmware is loaded.
Missing ROM sockets and unmapped ranges show `--`, and CGA's two ranges show
the same backing storage. Changed bytes compare successive observations.

Each inspector has its own **Live** switch during Run. Pause or Step refreshes
the visible panels. A frozen Memory panel retains its full captured image
when scrolled, resized, or switched between eight and sixteen bytes per row.
Reset, fresh power-on, and restoration clear its change comparison.
Register and flag highlights compare the two snapshots
from the latest CPU boundary. Inspection leaves the board clock and devices alone.

### Debugging execution

In **Debugger**, enter `F000:E05B` under **Run to** from fresh power-on.
Execution stops at that exact CS:IP after the reset jump and before CLI.
Entering `FE05B` matches any segment alias of the same physical byte.
The same notation applies to persistent **Breakpoints**. At reset, `FFFF0`
and `FFFF:0000` both match. `F000:FFF0` names the same bytes but a different
CS:IP, so it does not match the reset state. Both stop reports include logical
and physical addresses. Breakpoint checks observe CPU state before the next
timed boundary, preserving pending input, interrupt requests, and board time.

**Run** after a breakpoint crosses its current encounter once. A loop back
stops again. **Step** crosses the current breakpoint and completes one native
CPU boundary. An unfinished REP keeps CS:IP at its first prefix, so continuing
from a breakpoint there executes one more element before the next encounter.
**Run to** is a temporary request with a limit of 2,000,000 boundaries.
Breakpoints, watchpoints, Pause, and execution errors end that request early.
An already-reached target stops immediately, and an unreachable target reports
the limit. Halted or waiting boundaries also count toward it.

**RAM write watchpoints** select physical bytes in `00000–9FFFF`. An entry such
as `0040:0017` selects physical `00417`, through any segment alias. A watch
reports the first watched store with its before/after byte and originating
CS:IP, including a store of the same value. It stops after the complete CPU
boundary, so both bytes of a word store or all six bytes of an interrupt frame
are complete. REP stops after the watched element. External interrupt writes
are identified as interrupt entry. **Show written byte in Memory** selects the
captured address. These watches observe conventional RAM stores during CPU
execution. Video, ROM, I/O, reads, and host edits are outside their scope.

Each list holds up to 64 enabled or disabled stops and is remembered separately
from machine checkpoints. Reset, fresh power-on, and checkpoint restoration
clear the stop report and any temporary request while retaining these lists.
Check a RAM watch after restoration to verify that it follows the restored
hardware. Panel updates and navigation use observed state and perform no guest
bus or port accesses.

### Changes and watched RAM history

**Changes** uses the shared laboratory log. Each retained event identifies its
original CS:IP and 20-bit physical address, fetched instruction bytes, and
register, flag, and stored-byte changes. Relative branch targets are decoded
from that captured segment pair. The **CS:IP** filter covers both fields of the
logical instruction pointer. External interrupts, pending traps, and halted
boundaries retain their own identity rather than borrowing the instruction at
that address. Each REP iteration is a separate native boundary.

Memory changes come from storage observers, including conventional RAM and CGA
RAM. The two CGA windows share storage, so changes name its first physical
window at `B8000`, including writes made through the `BC000` alias. Unchanged
stores, ROM writes, and port I/O do not appear as memory changes. Reading or
repainting the log does not read devices. A failed boundary keeps its completed
changes and is marked interrupted.

The log retains the newest 500 boundaries. **Record changes** pauses capture;
**Live** pauses rendering during Run. Closing the panel does not stop capture.
Filters affect presentation only. Clear log restarts its numbering without
clearing watched-memory history.

In **Debugger**, each configured RAM write watch has a **History** button. Its
checkbox controls stopping; both enabled and disabled watches retain their last
256 writes, including unchanged values and interrupt stack writes. History
continues with Changes recording paused, Live off, or the panel hidden. It
excludes reads, CGA RAM, ROM, port I/O, and host edits. A failed boundary does
not append a completed watch event. Removing a watch clears that watch's
history. Clear all clears all retained watch events, leaving the watches set.

A history entry links the written physical byte to Memory and the writer's
captured CS:IP to Disassembly. Disassembly then browses current storage at that
logical location; **Follow CS:IP** returns to the running CPU. The history's
instruction text continues to use the original fetched bytes even if the
program has since changed them.

The **BIOS data byte** selector uses the chapter's workspace labels below.
These follow the original listing's keyboard and timer data area at segment
`0040` (appendix A, pages A-3–A-4). Word labels offer their low and high bytes
separately, with `+1` identifying the high byte. The addresses describe the
selected firmware's layout; POST and its interrupt handlers initialize and
maintain the values. For example, after booting, watch `KB_FLAG`, `BUFFER_TAIL`,
and `TIMER_LOW`, disable stopping, then type while running. Their histories
show the BIOS's keyboard and timer stores. [IBM Technical Reference][ibm]

Reset CPU, fresh power-on, restoration, and successful ROM replacement clear
both histories while preserving stop preferences and recording controls.
These debugging observations are not part of a saved hardware checkpoint.

### Following reset and early POST

The **Instruction** panel previews the next native CPU boundary on private CPU,
board-I/O, and keyboard copies. Its purpose and conditional-branch tests come
from the 8088 chapter. It explains explicit memory operands as an effective
offset, selected segment, and physical address, then shows predicted register,
flag, and memory effects. Port I/O, TEST, and ESC stop the preview with an
explanation. Unavailable storage and long prefix sequences also stop it. When a boundary
has no modeled timing, the panel reports that the XT cannot yet execute it.
**Step** executes the real boundary. The panel's **Live** switch controls updates
during Run, and the previewed physical addresses link to Memory.

Choose **Fresh power-on**, then open **Walkthrough**. Read each checkpoint's
preparation and expected observations, and choose **Run to checkpoint**. Next
and Previous select the guide without executing. Breakpoints and watchpoints
can stop the run earlier. The current address alone does not verify the setup.
The final checkpoint completes the BIOS checksum and leaves the machine ready
for its DMA and timer tests. The screen is still dark during these early tests.

These labels and comments follow the selected 11/08/82 listing in IBM's
Technical Reference, appendix A, pages A-6–A-7 and A-73. `RESET`, `C8`, `C10`,
`ERR01`, `C11`, `C1`, and `ROS_CHECKSUM` retain IBM's names. `RESET_VECTOR` is
our label for the hardware entry. The instruction comments additionally check
the fetched bytes, including retained disassembly history. The ROM identity
below ties the guide to this chapter's BIOS socket. [IBM Technical Reference][ibm]

Follow the first `SAHF` and `JAE` to see CF set and the error branch declined.
The register test then passes an all-ones pattern and a zero pattern through
the general and segment registers. After its first device writes, the BIOS
sets DS and SS to `F000`, BX to `E000`, and SP to `E016`. `ROS_CHECKSUM` adds
the 8,192 BIOS bytes modulo 256. Its `RET` reads `D7 E0` from physical `FE016`,
returning to `F000:E0D7` through an existing ROM word. That lets this test use
a return instruction before establishing a working RAM stack.

```json
{
  "sha256": "2798f8a9a7dcab651ede40373d35269ad573b75acf811115c263e034ef80a1f2",
  "regions": [
    {"start": "FE000", "end": "FFFFF", "name": "IBM XT BIOS · 11/08/82"}
  ],
  "routines": [
    {"address": "FFFF0", "name": "RESET_VECTOR", "description": "Hardware entry at FFFF:0000. Its far jump selects the BIOS code segment and RESET offset."},
    {"address": "FE05B", "name": "RESET", "description": "Start of the 8088 flag, branch, and register tests. Maskable interrupts are disabled first."},
    {"address": "FE08C", "name": "C8", "description": "Pass the current AX pattern through DS, BX, ES, CX, SS, DX, SP, BP, SI, and DI."},
    {"address": "FE0AD", "name": "ERR01", "description": "HLT on an early processor or BIOS-checksum failure."},
    {"address": "FE0AE", "name": "C10", "description": "Disable NMI and video, initialize board ports, and prepare the BIOS checksum."},
    {"address": "FF8F2", "name": "ROS_CHECKSUM", "description": "Add the 8,192 bytes starting at DS:BX into AL. OR AL,AL sets ZF from the checksum before RET."},
    {"address": "FE0D7", "name": "C11", "description": "Check the BIOS checksum result and continue to DMA/timer initialization when ZF is set."}
  ],
  "labels": [
    {"address": "00417", "name": "KB_FLAG", "scope": "workspace", "description": "0040:0017. Keyboard shift and toggle flags, maintained by the BIOS IRQ1 routine."},
    {"address": "00418", "name": "KB_FLAG_1", "scope": "workspace", "description": "0040:0018. Secondary keyboard status, including held toggle keys and the suspend state."},
    {"address": "0041A", "name": "BUFFER_HEAD", "scope": "workspace", "bytes": 2, "description": "0040:001A. Little-endian offset of the next keyboard entry to read, relative to segment 0040."},
    {"address": "0041C", "name": "BUFFER_TAIL", "scope": "workspace", "bytes": 2, "description": "0040:001C. Little-endian offset of the next free keyboard entry. Equal head and tail offsets mean an empty buffer."},
    {"address": "0041E", "name": "KB_BUFFER", "scope": "workspace", "bytes": 2, "description": "0040:001E. First word of the 16-word keyboard ring. The low byte is the character code and the high byte is its scan code; one slot remains empty."},
    {"address": "0046C", "name": "TIMER_LOW", "scope": "workspace", "bytes": 2, "description": "0040:006C. Low little-endian word of the BIOS tick count, updated by IRQ0."},
    {"address": "0046E", "name": "TIMER_HIGH", "scope": "workspace", "bytes": 2, "description": "0040:006E. High little-endian word of the BIOS tick count. TIMER_HIGH:TIMER_LOW forms one 32-bit counter."},
    {"address": "00470", "name": "TIMER_OFL", "scope": "workspace", "description": "0040:0070. BIOS midnight rollover flag, reported and cleared when the clock is read through INT 1Ah."},
    {"address": "FE016", "name": "C1", "scope": "rom", "description": "ROM word D7 E0 used as the return address for the first checksum. SS:SP points here before the jump."}
  ],
  "notes": [
    {"address": "FFFF0", "bytes": "EA 5B E0 00 F0", "text": "RESET_VECTOR selects CS=F000 and IP=E05B. The physical destination is FE05B."},
    {"address": "FE05B", "bytes": "FA", "text": "Disable maskable interrupts before testing the CPU and initializing board devices."},
    {"address": "FE05C", "bytes": "B4 D5", "text": "Prepare AH=D5 so SAHF sets SF, ZF, AF, PF, and CF."},
    {"address": "FE05E", "bytes": "9E", "text": "Copy the five selected AH bits into FLAGS. OF, IF, DF, and TF retain their existing values."},
    {"address": "FE05F", "bytes": "73 4C", "text": "JAE is IBM's JNC spelling here. CF should be 1, so continue to E061 instead of ERR01."},
    {"address": "FE061", "bytes": "75 4A", "text": "ZF should also be 1. JNE must decline the error branch."},
    {"address": "FE088", "bytes": "B8 FF FF", "text": "Begin the all-ones register pattern. A second pass checks zeroes."},
    {"address": "FE08C", "bytes": "8E D8", "text": "Start passing the AX pattern through the data and segment registers."},
    {"address": "FE0AD", "bytes": "F4", "text": "An early self-test failed. The expected walkthrough path does not reach this HLT."},
    {"address": "FE0AE", "bytes": "E6 A0", "text": "AL is zero after the successful register test. Writing it to A0 disables the NMI latch."},
    {"address": "FE0CB", "bytes": "8E D8", "text": "Set DS=F000 so the checksum reads the BIOS through DS:BX."},
    {"address": "FE0CD", "bytes": "FC", "text": "Clear the direction flag for subsequent forward string operations."},
    {"address": "FE0D1", "bytes": "BC 16 E0", "text": "Point SP at ROM word C1. With SS=F000, RET will read D7 E0 at FE016."},
    {"address": "FE0D4", "bytes": "E9 1B 18", "text": "Jump to ROS_CHECKSUM. The return word is already in ROM at SS:SP."},
    {"address": "FF8F2", "bytes": "B9 00 20", "text": "Count all 2000h bytes of the 8 KiB BIOS image."},
    {"address": "FF8F7", "bytes": "02 07", "text": "Add the byte at DS:BX into AL. Incrementing BX and LOOP visit each BIOS byte."},
    {"address": "FF8FE", "bytes": "C3", "text": "Pop the existing ROM word E0D7 into IP. SP advances from E016 to E018."},
    {"address": "FE0D7", "bytes": "75 D4", "text": "The byte sum is zero, so ZF=1 and JNE declines ERR01. DMA and timer tests follow."}
  ],
  "walkthroughs": [{
    "id": "reset-post", "title": "From reset to the BIOS checksum",
    "setup": "Load the three verified ROMs and choose Fresh power-on. Follow checkpoints in order. Disassembly, Instruction, Registers, and Memory explain each stop. Existing debugger stops may interrupt a run earlier.",
    "steps": [
      {"title": "The hardware entry", "address": "FFFF0", "execution": "FFFF:0000", "routine": "RESET_VECTOR",
       "prepare": "Choose Fresh power-on. Run to checkpoint is immediate at the reset address.",
       "observe": "The five bytes are EA 5B E0 00 F0. Instruction predicts CS:IP F000:E05B and physical FE05B. Step once to take the far jump."},
      {"title": "A pattern for the flags", "address": "FE05E", "execution": "F000:E05E", "routine": "RESET",
       "prepare": "Run from the reset jump through CLI and MOV AH,D5.",
       "observe": "AH is D5. Instruction predicts SF, ZF, AF, PF, and CF becoming 1. Step SAHF and watch the flag highlights."},
      {"title": "A branch that should be declined", "address": "FE05F", "execution": "F000:E05F", "routine": "RESET",
       "prepare": "Continue from SAHF. If you already stepped it, this checkpoint is immediate.",
       "observe": "JAE tests CF=0. CF is 1, so the branch is not taken. ERR01 labels its destination. Step to E061, where JNE tests ZF."},
      {"title": "Testing the registers", "address": "FE088", "execution": "F000:E088", "routine": "C8",
       "prepare": "Run through the remaining flag and branch tests.",
       "observe": "MOV AX,FFFF prepares the ones pattern. C8 passes it through the registers, then checks zeroes on a second pass. Follow a few Steps or continue to the next checkpoint."},
      {"title": "The first board output", "address": "FE0AE", "execution": "F000:E0AE", "routine": "C10",
       "prepare": "Run until both register patterns have passed.",
       "observe": "AX is zero. OUT A0h,AL will disable NMI. Instruction shows the output and stops its preview at the port. Step performs the actual device write."},
      {"title": "A return address in ROM", "address": "FE0D4", "execution": "F000:E0D4", "routine": "ROS_CHECKSUM",
       "prepare": "Run through the initial board outputs and checksum setup.",
       "observe": "DS=SS=F000, BX=E000, and SP=E016. Select SS:SP in Memory to see D7 E0 at FE016. JMP enters ROS_CHECKSUM without writing a return word."},
      {"title": "Read the first BIOS byte", "address": "FF8F7", "execution": "F000:F8F7", "routine": "ROS_CHECKSUM",
       "prepare": "Run through MOV CX,2000h and XOR AL,AL.",
       "observe": "Instruction resolves DS:BX to F000:E000, physical FE000. CX counts 8192 bytes. The ADD, INC, and LOOP sequence accumulates an eight-bit sum."},
      {"title": "Return through the ROM word", "address": "FF8FE", "execution": "F000:F8FE", "routine": "ROS_CHECKSUM",
       "prepare": "Run through the checksum loop and OR AL,AL.",
       "observe": "AL=00 and ZF=1. RET reads D7 E0 from SS:SP and predicts F000:E0D7. Its two reads are visible under Previewed storage accesses. Step to return."},
      {"title": "Checksum passed", "address": "FE0D7", "execution": "F000:E0D7", "routine": "C11",
       "prepare": "Continue from RET. This checkpoint is immediate if you already stepped it.",
       "observe": "SP is E018. JNE tests ZF=0 and is not taken. Step reaches E0D9, ready for the DMA and timer tests. This completes the initial walkthrough."}
    ]
  }]
}
```

### Keyboard and restart controls

The browser maps US physical keys to XT makes and breaks. Tab moves focus out
of the screen. Leaving the screen releases held keys, and leaving the window
also pauses execution. Pasting supports US keyboard text and line breaks.
It paces characters by the emulated oscillator and allows extra time after
Enter for BASIC to scroll. The paste position and delay survive a checkpoint.

**Ctrl-Break** and **Ctrl-Alt-Del** send the corresponding XT key chords through
the receiver. When the BIOS resets the keyboard, its self-test takes precedence
and the host discards typing and releases queued before that reset. This keeps
a stale release from reaching POST's stuck-key check. **Reset CPU** preserves
RAM and devices. **Fresh power-on** starts a new machine with the loaded ROMs.

[intel]: https://www.ardent-tool.com/CPU/docs/Intel/808x/manuals/9800722-03_alt.pdf
[ibm]: https://minuszerodegrees.net/manuals/IBM_5160_Technical_Reference_APR83.pdf
[rom-layout]: https://www.pcjs.org/machines/pcx86/ibm/5160/rom/
[font-image]: https://www.pcjs.org/machines/pcx86/ibm/video/cga/
