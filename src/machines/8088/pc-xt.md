# IBM PC/XT: native firmware startup

This executable chapter assembles the selected IBM 5160 board around the
[8088](../../components/cpus/specifications/8088.md). The original 11/08/82 BIOS can start
ROM BASIC or boot MS-DOS 3.30 from drive A. During POST, the CPU tests itself,
DMA and the first 16 KiB of RAM. It discovers 640 KiB, initializes its interrupt
vectors, and resets the XT keyboard.
It then programs CGA, tests video RAM and retrace status, and clears the display.
The BIOS tests the remaining RAM, resets and seeks the diskette drive, resets
the keyboard a second time, and attempts a disk boot. With no disk
inserted, the BIOS's own timeout leads to ROM BASIC C1.10. BASIC prints its
prompt and accepts immediate commands and stored programs through the keyboard receiver and IRQ1.
No BIOS service is replaced by host code and no BIOS data area is preloaded.
The [session checks](#rom-basic-sessions) cover editing, Ctrl-Break, warm boot, and saved input.
With the DOS disk inserted before power-on, the BIOS loads the boot sector through DMA
and [starts the command interpreter](#cold-booting-ms-dos-330).
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
    out 81 = io 81
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
and the small examples. It grants one pending DMA transfer, offers interrupts, executes one CPU
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

The drive starts empty. Reset, recalibration, and seeks can complete without
media. Reads wait for index/data pulses. The original BIOS times out while
the controller waits and the channel-2 address and count remain unchanged.

Snapshots retain partial commands/results, reset and seek timing, physical
head position, and the controller's cylinder estimate. CPU reset preserves
them. Board reset cancels in-flight work and retains the disk, head position,
and Specify timing registers.

The [board tests](../../../tests/machines/8088/pc-xt/diskette.test.ts) check port
routing, fractional clock continuation, native IRQ6 entry from HLT, separate
controller/PIC acknowledgement, and the empty drive’s absence of DMA or memory side effects.
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

## Reading a diskette through INT 13h

Insert a raw, write-protected 360 KiB image with `io.setDiskette(bytes)`.
The drive keeps its own copy. Eject it with `io.setDiskette(null)`. The
controller matches the sector ID on the selected track and side. It requests
channel 2 for each byte and the 8237A arbitrates between disk and refresh.

The BIOS writes the upper four physical address bits to port `81`. Each
channel-2 grant combines this page with the current 16-bit DMA address,
writes one byte through the board's memory map, and takes five CPU clocks
(15 oscillator ticks). The 16-bit address can wrap without changing the page.
On the final grant the 8237A signals terminal count. The controller raises
IRQ6 and makes seven result bytes available. The PIC accepts IRQ6 separately
from the BIOS reading the controller results. [IBM Technical Reference][ibm]

The [ROM acceptance](../../../tests/machines/8088/pc-xt/rom-boot.test.ts)
starts after the original POST. A RAM caller requests cylinder 2, side 1,
sector 3 into `2000:7C00` through INT 13h. The check follows all 512 DMA writes,
checks the neighboring RAM bytes, and requires carry clear and AH zero on
return. In the 11/08/82 ROM, `NUM_TRANS` computes one sector in AL at
`F000:EFC4`. The final call to `GET_PARM` at `F000:EC6C` looks up the motor
timeout and clears AX in the process. The caller therefore sees AL zero even
after a successful read. [IBM BIOS listing, appendix A][ibm]

Restoring after byte 256 must reproduce the remaining
transfer and the final machine state. The checkpoint includes the disk bytes,
DMA page, controller byte position, and delay until its next request.

A second check inserts a synthetic boot disk after POST and lets the BIOS
continue unaided. Its INT 19h bootstrap calls INT 13h for sector one, jumps
to `0000:7C00`, and executes the first instruction from the sector. The ROM’s
default diskette parameter table at `F000:EFC7` sets EOT to eight. The disk
image has nine sectors per track. The controller uses the EOT supplied in each
command, which matters when following a DOS loader beyond the boot sector.

## Writing a diskette through INT 13h

Insert a disposable data disk with `io.setDiskette(bytes, { writable: true })`.
The drive writes to its own copy. The original bytes and earlier checkpoints
keep their contents. Disks inserted without that option are write-protected.

For a one-sector write, the caller sets AH to `03`, AL to one, and ES:BX to
the source buffer. The original BIOS programs channel 2 with mode byte `4A`
(single DMA **read** from memory) and sends Write Data (`C5`) to the controller.
Each DREQ2/DACK2 exchange moves one byte from RAM onto disk. Terminal count on
the 512th byte completes the sector. IRQ6 wakes the BIOS to collect the seven
result bytes. [IBM BIOS listing, appendix A][ibm]

The [ROM acceptance test](../../../tests/machines/8088/pc-xt/rom-boot.test.ts)
writes from `2000:7C00` to cylinder 2, head 1, sector 3, then uses INT 13h
function `02` to read that sector back into `2000:8000`. It checks every DMA
address and byte, compares the whole disk against the expected image, and
resumes a checkpoint after byte 256 to the same final state. With protection
enabled, Write Data reports Not Writable before requesting any bytes. The
BIOS returns carry set and AH=`03`, and the disk stays intact.

## Cold-booting MS-DOS 3.30

Drive A takes Microsoft MS-DOS 3.30 Disk 1, volume `MS330PP01`. This
write-protected 360 KiB FAT12 image has 40 cylinders, two heads and nine
512-byte sectors per track. The root directory contains the hidden system
files `IO.SYS` and `MSDOS.SYS`, and the command interpreter `COMMAND.COM`.
The [media identity table](../../../docs/machines/pc-xt.md#firmware-and-media-identity)
gives the SHA-256 for this edition.

The [cold-boot test](../../../tests/machines/8088/pc-xt/rom-dos.test.ts)
inserts the disk before power-on and runs the original BIOS from reset. All
512 bytes transferred by DMA channel 2 must match sector one at physical
`07C00`. The PIC delivers IRQ6 and the BIOS jumps to `0000:7C00`.

The boot sector asks the BIOS for cylinder 0, head 0, sector 6. That read
places the first root directory sector at physical `00500`, with the entry
for `IO.SYS` first. The next read starts at cylinder 0, head 1, sector 4.
It puts the first six sectors of `IO.SYS` at `00700`. DOS continues loading
from disk until its command interpreter takes input. Enter a date and time, or
press Enter at each prompt to accept the defaults. To read a two-digit field,
DOS uses the 8088's `AAD` instruction to combine the tens and units.

| At the keyboard | What appears on the CGA display |
| --- | --- |
| `VER` at the first `A>` prompt | `MS-DOS Version 3.30`, followed by another `A>`. |
| `DIR` | Volume `MS330PP01`, directory `A:\`, 34 files, 5,120 bytes free, then `A>`. |

The test sends make and break codes through the XT keyboard. It reads completed
lines from CGA memory before they scroll away and compares every listed name
and size, in order, with the image's root directory. To run it, set
`XT_BIOS_ROM`, `XT_BASIC_ROM` and `XT_DOS_DISK` to the three local files,
then use `npm test`. With current compiled output, the focused check is
`node --test dist/tests/machines/8088/pc-xt/rom-dos.test.js`.

### Changing disks at the DOS prompt

After listing the system disk, leave DOS running and wait for the drive light
to go out before exchanging disks. The original drive has no disk-change line.
An immediate exchange in this session gave the new filenames but the old disk's
5,120 bytes free. The test lets the BIOS timer interrupt clear the drive A motor
bit at port `3F2h` before exchanging disks. DOS then reports the new disk's free
space. [Microsoft's account of the floppy disk cache](https://devblogs.microsoft.com/oldnewthing/20191001-00/?p=102946)

Insert the `DROMAIOS` data disk. The [disk builder](../../../scripts/make-xt-data-disk.ts)
creates this 360 KiB FAT12 image from scratch. To make a local copy, run
`node scripts/make-xt-data-disk.ts dromaios-data.img` from the repository root.

```text
A>TYPE README.TXT
Dromaios XT data disk.
DOS read this file from drive A.

A>HELLO.COM
Hello from HELLO.COM on drive A.

A>
```

`TYPE` is built into the command interpreter. It opens the new disk's
`README.TXT` and displays its two lines. `HELLO.COM` exercises the DOS program
loader. DOS starts its 12 bytes of code at offset `0100h`. The program calls
`INT 21h` with `AH=09h` to print the string immediately after its code, then
with `AX=4C00h` to exit with status zero. [The MS-DOS Encyclopedia, section II](https://www.pcjs.org/documents/books/mspl13/msdos/encyclopedia/section2/)

The acceptance test issues one more `DIR` after the program exits. The
interpreter must list volume `DROMAIOS`, its two files and 360,448 bytes free.
Both disks stay write-protected for these commands.

### Following HELLO.COM from disk to execution

In the laboratory's **Walkthrough** panel, choose **HELLO.COM: from disk to
execution**. Start at the DOS prompt with the data disk mounted, select the
first checkpoint, choose **Run to checkpoint**, then type `HELLO.COM` and
Enter in the screen. Disable unrelated debugger stops. **Browse code** opens
Disassembly at the selected instruction; the other links open **Files**,
**Memory**, and **Instruction**. Disk activity recording must be enabled to
retain the transfer links, but recording is not required for stopping.

This is an audited path through the MS-DOS 3.30 image identified above on the
CGA XT. The loader addresses and RAM allocations are observations of that
configuration, not DOS interface guarantees. Other DOS versions, resident
programs, or the EGA configuration may use different addresses. Byte and
register guards prevent a matching address alone from claiming success.
Selecting a stop never rewinds the machine; restore a snapshot or repeat
the command when returning to an earlier stage.

| Named stop | What crosses the boundary |
| --- | --- |
| HELLO.COM sector in DOS's buffer | DMA2 finishes image sector 14 into `$0B3D0–0B5CF`. The file uses its first 47 bytes. |
| DOS copies the file into the program area | `MOVSB` and `REP MOVSW` copy those bytes to `$0C6B0–0C6DE`. |
| DOS hands control to HELLO.COM | The loader's `RETF` selects `0C5B:0100` from its prepared stack. |
| First program instruction | Execution starts after the 256-byte Program Segment Prefix. |
| Ask DOS to print the message | `INT 21h`, `AH=09h`, reads the dollar-terminated string at `DS:DX`. |
| The print call has returned | The message is visible and execution resumes at `0C5B:0107`. |
| Return control to DOS | `INT 21h`, `AX=4C00h`, terminates with status zero. |
| Back at the DOS prompt | The command interpreter polls for input beneath the message and a new `A>`. |

The **Files** inspector connects the directory entry, cluster 3 and image
offset `$01C00` to the DMA destination. That destination is DOS's sector buffer,
**not** the final program address. The second stop exposes the CPU copy that
bridges them: one byte followed by 23 words. The other 465 bytes of the
512-byte sector are not part of `HELLO.COM`. Save a snapshot at the first stop
to repeat the loader, print, and termination path. The optional
[walkthrough acceptance](../../../tests/site/xt-hello-com.test.ts) also saves
halfway through the sector and verifies identical state after replay, checks
all 47 copied bytes, compares the printed message, and rejects a return into
the message bytes after termination.

### Understanding DOS calls in Instruction

The **Instruction** panel's **DOS services** section interprets the chapter's
declared `INT 21h` services. It explains the next call from a private CPU
preview and keeps a separate list of calls actually observed. Choose a past
call to hold its captured arguments and result, or **Latest observed call**
to follow execution. The service names, argument labels, buffer rules, return
contracts, and error descriptions come from the `dos` catalogue below; the
8088 decoder remains independent of DOS. The reference is Microsoft's
[system-call documentation](https://www.pcjs.org/documents/books/mspl13/msdos/encyclopedia/section5/).

Input strings and write buffers are sampled after interrupt entry. A read
request identifies its destination without treating the old RAM contents as
the result. A matching `IRET` or far return must restore the captured caller's
exact `CS:IP` and `SS:SP` before the inspector records a result. It samples read
data using the original pointer and the smaller of returned `AX` and requested
`CX`, retaining at most 256 bytes. Samples indicate unavailable storage or
truncation, escape non-ASCII bytes, and wrap both the offset and physical
address. The Memory links always browse **current** storage; the displayed
samples preserve the observed bytes.

This is a bounded observation of DOS conventions, not an implementation of
DOS services or a simulation of their results. A prospective call does not
count as execution, a failed read does not supply a successful buffer, and a
termination request is not labelled completed. The service with `AH=4D` can
separately report the child's status to its parent. Unsupported services and
nonstandard unwinds are not interpreted. The history retains 128 calls and
tracks at most 16 pending calls. Process changes, unmodeled handle-creation services, or an observation limit
mark unfinished calls untracked and discard known handle names. Reset, restoring a checkpoint, and
**Clear DOS calls** discard history, pending pairs, and known filenames; an uncaptured
call's later return cannot manufacture a result.

In **Debugger → Event stops**, choose **DOS service**, a call, return, or
error return, and a described service (or all described services). The buttons
beside an observed call in Instruction add the same conditions, matching its
`AH` for any caller. Add an optional **Filename** in Debugger, or keep
**Only this filename** checked beside an identified call. Matching uses the
exact captured path, ignoring ASCII case: `README.TXT` matches `readme.txt`,
but not `A:\README.TXT`. There are no wildcards or inferred current directories.
Unknown filenames never match a filename condition. Adding an existing condition
enables it again.
Conditions can be disabled or removed and are remembered separately from the
machine checkpoint. They work with Live updates and trace recording off.

A call stop follows the complete `INT 21h` entry, with the saved interrupt
frame already on the stack and DOS ready to execute. A return stop follows
the matched return to the caller, including an error return. An error stop
requires returned `CF=1` on a service whose declared result kind is `status`,
`handle`, `count`, or `position`; raw carry on print or child-status calls is not an error
indication. Termination supports call stops only. These conditions can
interrupt Run, Step over, and Step out. Resume advances from the stopped
boundary without matching the same event again. RAM write watches take
priority over raw I/O/interrupt events, which take priority over DOS stops;
DOS observations are still captured when another condition wins.

When a DOS condition stops execution, Instruction selects that observed call
so its arguments, result, and buffer links can be inspected. Reset and
checkpoint restoration keep the conditions but clear the captured pairs.
Restoring inside a service therefore cannot stop on that service's later
return; its call was not observed in the restored session. The next captured
call can stop normally. Filename conditions remain set, but require a new
observed open or create before identifying reads and writes again. Restoring
before the open reproduces its name and subsequent filename-aware stops.

The original-DOS acceptance checks these observations alongside the existing
HELLO.COM walkthrough:

| Command | Captured call and result |
| --- | --- |
| `HELLO.COM` | The `09` request identifies the message. Its observed return has raw `AX=0924`; the declared contract does not interpret CF as success. `4C` requests exit status zero, and the parent's `4D` reports normal termination with status zero. |
| `TYPE README.TXT` | `3D` opens the name and returns handle 5. Two `3F` calls request 65,024 bytes each; the first returns exactly the 58 README bytes, the second returns zero without displaying stale buffer contents. |
| `ECHO HELLO>SAVE.TXT` | `3C` creates the file and returns handle 5. Writes through redirected handle 1 supply `HELLO` and CR/LF, returning counts 5 and 2. The exported FAT12 file contains those seven bytes. |

The command interpreter also attempts to close unused handles. Their
observed `CF=1, AX=0006` results appear as invalid-handle errors, distinct from
the successful reads and writes. Handle 1 can refer to a file after
[output redirection](https://www.pcjs.org/documents/books/mspl13/msdos/encyclopedia/section2/);
the inspector shows `SAVE.TXT` beside its captured handle 1 writes and keeps
that name with the call after the handle changes again.

The same checks enable service entry/return stops for opening and reading
README.TXT, creating SAVE.TXT, and writing through its redirected handle.
The read stops expose 58 bytes followed by zero at EOF; the write stops expose
5 bytes followed by 2. Error stops catch the command interpreter's invalid
handle closes. Checkpoints taken inside the first read and write reproduce
the complete guest state, clocks, and writable disk image: the uncaptured
return is skipped. Unfiltered conditions still stop on the subsequent EOF
read or CR/LF write; filename-filtered conditions do not, because restoration
cleared their opening-name evidence.

#### From handles to filenames

DOS gives a process a small integer **handle**, not a permanent file number.
The inspector associates the name sampled by `3C` or `3D` with the handle
returned on success. The complete zero-terminated name must fit the sample
and contain printable ASCII. A failed open still has a requested filename for
error stops, but does not create an association. Missing, truncated, and
non-ASCII names remain unknown. Names are the paths used at open time; the
inspector does not resolve them to absolute paths or follow later renames.

`45` creates another handle for the same open file. `46` makes a chosen target
handle refer to the source, replacing the target's former association. These
aliases share DOS's file position; closing one leaves the others usable.
Only successful returns change observed associations. Redirecting from an
unidentified source removes the target's old name. Closing and reusing handle
5 cannot relabel earlier captured reads. These rules follow the duplicate and
force-duplicate services in the [MS-DOS reference](https://www.pcjs.org/documents/books/mspl13/msdos/encyclopedia/section5/).

The selected MS-DOS 3.30 `COMMAND.COM` redirects its output by changing its
**job file table** directly, rather than calling `45` or `46`. That table maps
process handles to system-file-table entries. The inspector therefore also
checks the chapter's `handleTable` profile against declared RAM at DOS call
and return boundaries. The INT 21h vector must have offset `1460`, and both
code guards must match in its segment. Our trace of `AH=51` on the selected
DOS image reads the current PSP from offset `02DE` in that segment. The PSP
starts with `CD 20`, stores the table count at `0032`, and its far pointer at
`0034`. The acceptance test checks this layout against the original DOS image;
these are observations of that binary, not universal kernel addresses.

Names are attached to observed local system-file entries, letting handle 1
inherit the known name when COMMAND.COM redirects it to the same entry as
handle 5. Entries no longer referenced by the process are forgotten. The
reader accepts 5–256 table entries, requires available storage, and treats
`FF` as closed and `80–FE` as unidentified network entries. A changed PSP or
lost code guard discards names and pending pairs. Without a matching profile,
only the declared service effects are tracked; direct table edits cannot be
identified. Standard handles are never assumed to mean the console.

The `forgetHandles` declarations also discard associations at process
creation, switching, and termination, and at unmodeled handle-creation or
resize services. This deliberately does not reconstruct inherited handles,
previous opens, or network state. No guest code is called and no memory is
written by inspection. Checkpoints store the real DOS tables as RAM, but
captured names remain debugger observations and are cleared on restoration.

The acceptance checks additionally call the real `45` and `46` services:
open README, read its first byte, duplicate its handle, close the original,
and reuse handle 5 for SAVE. Reading the duplicate yields the next two README
bytes. Redirecting handle 1 to SAVE writes `DUP`; restoring the saved console
handle removes that filename association. The exported file contains exactly
those three bytes. The [handle tests](../../../tests/site/xt-dos-handles.test.ts)
cover failures, malformed tables, process changes, immutable history, and
case-insensitive filename conditions without requiring external media.

#### File positions, seeks, and byte ranges

An open disk file has a **position**: the byte offset where its next read or
write begins. The first byte is offset zero. Successful reads and writes
advance by the actual returned count, which can be smaller than the request.
Two handles created by duplication share this position. Opening the same
filename twice creates independent positions; the filename alone cannot
identify the open file.

`AH=42` changes that position without transferring bytes. `AL=0` selects an
unsigned absolute offset in `CX:DX`. `AL=1` and `AL=2` select a signed 32-bit
displacement from the current position or end. For example, `CX:DX=FFFF:FFFE`
means two bytes backwards for a relative seek. On success, `DX:AX` returns
the new absolute position; on failure, CF is set and AX is an error code.
Seeking beyond EOF does not extend a file. A later write can extend it, and a
zero-length write sets its length to the current position.
[Microsoft's seek and write contracts](https://www.pcjs.org/documents/books/mspl13/msdos/encyclopedia/section5/)
define these behaviors.

Instruction captures **File position before call** and **File position after
call** from DOS's system file table (SFT). Completed reads and writes also
show the inclusive **File bytes** range, provided the same open-file record
remains selected and its position change agrees with returned AX. These are
offsets within the file, not disk-image offsets or RAM addresses. The range
covers the entire transfer even when the displayed buffer sample is limited
to 256 bytes. EOF and zero-length writes have no byte span; errors or
inconsistent observations supply no claimed range. The known-handle list
shows current positions, while past calls keep their captured values.

The chapter's guarded DOS 3.30 profile supplies `systemFiles`: the far pointer
at kernel offset `002A`, record size `0035`, device-information word at `0005`,
and 32-bit position at `0015`. Our trace of the selected DOS's `AH=52` returns
its list of lists at kernel offset `0026`; the SFT pointer is four bytes
later. Each SFT block starts with its next far pointer and a word-sized record
count. The reader follows bounded, non-cyclic blocks and accepts only
allocated local disk-file records. Character devices, remote files, FCB
records, missing storage, and an unrecognized kernel leave positions unknown.
This layout agrees with the DOS 3.1–3.3 SFT in
[Ralf Brown's table 01641](https://fd.lod.bz/rbil/interrup/dos_kernel/2152.html).
The lab reads declared storage without invoking DOS or estimating positions
from earlier byte counts.

This makes duplicate and redirected handles share the position DOS actually
uses. Restoring a checkpoint restores those tables with RAM. Captured calls
and names are still cleared, but the next observed call can read its restored
position even before its filename is known. Restoring *inside* a call cannot
invent its missing entry or range; the following call starts a new observation.

The [original-DOS acceptance](../../../tests/site/xt-hello-com.test.ts) checks:

| Sequence | Required observation |
| --- | --- |
| Read–seek–read | Read `Dromaios` at offsets 0–7 of README, duplicate the handle, seek the duplicate to 1, then read `rom` through the original at 1–3. |
| Relative and end seeks | Seek back two bytes through the duplicate and read `om`; seek two bytes before EOF and read only CR/LF. A further read returns zero. |
| Full 32-bit positions | Seek to `00010002h`; returned DX is 1, and an EOF read through the duplicate retains that position. |
| Write–seek–overwrite | Write `ABCDEF` to SAVE, seek its duplicate to 2, overwrite with `xy` through the original, then read back and independently inspect exported FAT12 bytes `ABxyEF`. |
| Checkpoint recovery | Restore before and inside a read, relative seek, and overwrite. Replay must reproduce complete machine state and disk bytes; only a captured entry can reproduce a paired result and range. |
| Device handles | Open `NUL` and write to it without claiming disk-file positions or byte ranges. |

### Saving a DOS file across a fresh boot

At the `A>` prompt, wait for **Motor off**. Choose **Insert writable copy…**
in Drive A and select the [`DROMAIOS` data disk](#changing-disks-at-the-dos-prompt).
DOS can now change the copy in the drive. The file you selected keeps its
original bytes. If the file picker paused the XT, choose **Run**. Click the
screen and type these commands.

```text
A>ECHO HELLO>SAVE.TXT
A>TYPE SAVE.TXT
HELLO
```

The `>` sends the output of `ECHO` to a file. DOS creates a directory entry
for `SAVE.TXT` and allocates one 1,024-byte cluster. The file's seven bytes
are `HELLO` followed by carriage return and line feed. Both copies of the FAT
mark that cluster as the end of the file.

1. Leave the XT running until **Motor off**, then choose **Export disk image**.
   This downloads a raw 360 KiB `.img` containing the current sectors.
2. Pause the XT. Choose **Insert…** and select the MS-DOS **system** disk.
   Choose **Fresh power-on**, then **Run**. Press Enter at the date and time prompts.
3. At `A>`, wait for **Motor off**, then use **Insert writable copy…** to
   mount the **exported data disk**. `DIR` shows three files and 359,424 bytes
   free. `TYPE SAVE.TXT` prints `HELLO` from the exported sectors.
4. Type `DEL SAVE.TXT`, then `DIR`. The two original files remain and free
   space returns to 360,448 bytes. The download still contains `SAVE.TXT`.

The [DOS acceptance test](../../../tests/machines/8088/pc-xt/rom-dos.test.ts)
boots the original BIOS and MS-DOS twice. Between boots it independently
checks the directory entry's date, hour and minute against the values typed
at startup, reads the allocated cluster in both FATs, and verifies the seven
data bytes. After deletion it checks that DOS marked the entry deleted and
freed the cluster.

## CGA text output

The [CGA device chapter](../../components/devices/specifications/ibm-cga.md)
owns the 6845 register masks, scan/status signals, display-start latch, cursor,
and attribute/blink rules. This board selects 40/80-column, 25-row RGBI text
with eight-line characters. The same adapter also displays
[four-colour graphics](#cga-four-colour-graphics).

`stepTimedXtCpu()` advances CGA and the system board from the same oscillator:
DMA grants advance both before CPU accesses, and instruction/interrupt
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

## CGA four-colour graphics

When the BIOS selects mode `04h`, the Screen panel switches to a 320 × 200
bitmap. The [graphics renderer](pc-xt/video.ts) reads the packed pixels from
video RAM and maps them to RGBI using the adapter's current palette. The
character ROM is used only for text. The original-ROM tests set mode `04h`
with `INT 10h`, change the palette, write pixels on odd and even lines, read
one back, and return to 80-column text.

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

Choose **CGA** or **EGA** in the Firmware panel to open that adapter’s laboratory.
Both use the same system BIOS, BASIC ROM and drive. Their checkpoints are separate.

For **EGA**, load the 16 KiB IBM 6277356 option ROM dated 09/13/84 in the third
socket. Mount MS-DOS 3.30 Disk 1 in **Drive A**, choose **Fresh power-on**,
then **Run**. The adapter tests its video signals before the XT counts RAM.
Press Enter at the date and time prompts. At `A>`, type `VER` and press Enter.
To try graphics, boot the [sixteen-colour exercise](pc-xt-ega.md#try-the-colour-bars)
or the [EGA-capable Ultima V Program disk](../../../docs/machines/pc-xt-ultima-v.md#native-ega-title-menu).
Press Space during the Origin logo to reach the title menu.

For **CGA**, choose the 8 KiB XT BIOS dated 11/08/82, the 32 KiB IBM BASIC
C1.10 ROM, and the 8 KiB IBM MDA/CGA character ROM. Each file is checked against
the identity in this chapter and remembered locally. The disk in drive A
determines what boots.

- **ROM BASIC.** Leave **Drive A** empty and press **Run**. At `Ok`, click the
  screen, paste the [three-line program](#rom-basic-sessions) with a final Enter,
  then type `LIST` and `RUN`.
- **DOS.** In **Drive A**, choose **Insert…** and select the raw 360 KiB
  [MS-DOS 3.30 system disk](#cold-booting-ms-dos-330). Its filename appears in
  the panel. Choose **Fresh power-on**, then **Run**. Click the screen and press
  Enter at each date and time prompt. At `A>`, try `VER` and `DIR`.
- **Ultima V.** Insert the [bootable `ULTIMA-BOOT.IMG`](../../../docs/machines/pc-xt-ultima-v.md#media)
  and choose **Quick boot**. Press Space while the Origin Systems logo is
  visible. The game draws its four-colour title menu with **Journey Onward** selected.
  To resume a party and walk outdoors, use the [Program and Player disks](../../../docs/machines/pc-xt-ultima-v.md#journey-onward).
  The [save and resume walkthrough](../../../docs/machines/pc-xt-ultima-v.md#save-export-and-resume)
  shows when to export the Player disk and how to use it after booting the Program disk again.

The first part of POST runs with video disabled. The address and emulated
seconds in **Execution** show the board advancing. **Step** advances one timed
CPU boundary.

### Speed, clock measurements and the speaker

**Normal** paces Run against the nominal **14,318,180 Hz** board oscillator.
CPU CLK divides that frequency by three, while the PIT divides it by twelve.
The display and devices advance only through the machine's timed execution
path. Slow inspectors can make Run fall behind; resuming after a pause does
not accumulate a backlog of host time. **Unlimited** removes the speed limit
while retaining bounded batches so Pause and other controls remain responsive.

**Mark clock** measures an interval in oscillator ticks. **Step**, **Step over**
and **Step out** report their
completed interval separately, including any DMA grant or halted-time advance.
These are elapsed board ticks, not a claim that the CPU executed that many
clocks. CPU reset preserves the marker and elapsed time. Fresh power-on and
checkpoint restoration replace the clock and clear inspector measurements;
restoration still preserves the saved hardware time and timer phase.

**Sound** enables the PC speaker during Normal Run. The
[timer chapter](xt-timer.md#board-connections) defines the PB1/OUT2 signal.
The observer samples every transition, including several PIT edges inside one
instruction, and averages the held signal into audio samples. It reuses the
Apple II and CoCo playback path, with bounded buffering, modest gain and DC
removal. Pause, focus loss and Unlimited silence queued playback. Restoring a
checkpoint starts a fresh playback buffer from the restored signal and phase;
browser audio buffers and permission are not hardware snapshot state.
This models the digital waveform, not the physical speaker's frequency response.

With Drive A empty, use **Quick boot** to reach the original BASIC `Ok` prompt,
enable Sound, select Normal and enter:

```text
SOUND 440,9:SOUND 880,9:PRINT 42
```

The selected BASIC plays two pitches an octave apart for about half a second
each, prints `42` and returns to `Ok`. Its final tone can continue after the
prompt appears; leave Run active until it finishes. `BEEP` exercises BASIC's
standard beep. A longer `SOUND 440,91` is useful for pausing and saving a
checkpoint mid-note, then restoring it and resuming.

[Acceptance tests](../../../tests/site/xt-sound.test.ts) run the original ROM
and keyboard path, check the pitches and duration, and compare the exact
remaining speaker edges, 48 kHz samples and complete session state after
restoring a mid-note checkpoint. [Pacing tests](../../../tests/site/xt-clock.test.ts)
compare Normal, Unlimited and Step through native interrupt entry, halted
time and DMA refresh. No host oscillator substitutes for the guest PIT.

### Startup and saved sessions

For a shorter startup, choose **Quick boot** in Execution. It starts fresh RAM
and devices, keeps the mounted disk, and sets the BIOS warm-start word at
`0040:0072` to `1234h` before running from the reset vector. The original
BIOS then takes its own warm POST path, skipping the long RAM pattern test.
**Fresh power-on** and **Run** perform the full diagnostic.

To [exchange disks at the DOS prompt](#changing-disks-at-the-dos-prompt), let
the XT run until Drive A shows **Motor off**, then choose **Insert…** again.
The motor light follows the XT's drive control register. Selecting a file of
the wrong size leaves the current disk in place. **Insert…** mounts the file
write-protected. Use **Insert writable copy…** and **Export disk image** to
[save files from DOS](#saving-a-dos-file-across-a-fresh-boot).
**Eject** leaves the drive empty. **Fresh power-on** clears RAM and resets the
controller while leaving the current disk in the drive.

To resume later, pause and choose **Save snapshot**. The browser compresses the
checkpoint before storing it so RAM and a mounted disk do not crowd out other
laboratories’ saves. Older plain JSON checkpoints remain readable. Wait for
“XT checkpoint saved in this browser”; a failed save leaves the previous
checkpoint intact and reports the failure in Session. On a later visit, choose
**Restore snapshot** with the same three ROMs loaded. The checkpoint restores
the CPU, RAM, screen, board devices, and pending keyboard input. It also
restores the saved disk's name, contents, and write permission, even if you have since ejected it
or inserted another disk. A checkpoint saved with an empty drive restores it empty.

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

**Step over** follows the actual next boundary. A near or far CALL runs to its
matching RET/RETF; interrupt entry runs to its matching IRET. If a pending
hardware interrupt or trap preempts a call, stepping stops when that handler
returns to the still-unexecuted call. Other boundaries advance once. **Step out**
returns from the innermost observed call or interrupt. Both commands use the
shared debugger's breakpoint, watchpoint, cancellation and boundary-limit rules.

**Call stack**, initially a tab beside Registers, shows observed caller, entry
and return CS:IP pairs, with the caller's SS:SP. Address links browse that exact
logical pair in Disassembly, even when another segment currently aliases it.
Tracking checks the return kind, logical address and restored stack; `RET n`
also accounts for the discarded arguments. Nested interrupts remain separate
from calls. The observer uses captured instruction bytes and interrupt-frame
writes, so tracking never rereads guest memory or devices.

This is an observed history, not an unwinder. Reset, power-on and checkpoint
restore clear it. Replacing SS, loading SP outside the active frame, a mismatched
return, an execution error or the 128-frame limit invalidate earlier callers.
Restoring SP within a frame to discard locals is supported. Hand-built frames,
nonlocal returns and calls already active at restoration are not inferred;
Step out becomes available after observing a new call or interrupt.

The [debugger tests](../../../tests/site/xt-debugger.test.ts) cover direct and
indirect near/far calls, prefixes, stack wrapping, local frames, argument cleanup,
software interrupts, traps, faults, changed return addresses and early stops.
The [original-software checks](../../../tests/site/xt-calls.test.ts) compare
Step over, Step out and ordinary execution from the same checkpoint, including
CPU, memory, devices, keyboard, disk, clocks and displayed pixels. With the
three XT firmware paths set, they exercise BIOS calls, keyboard IRQs, BASIC
calls and INT 10h while `PRINT 2+3` produces `5`. Set
`XT_ULTIMA_DEBUGGER_CHECKPOINT` to the `ultima-v.json` emitted by the
[CGA game acceptance](../../../tests/machines/8088/pc-xt/rom-ultima-v.test.ts)
with `XT_ULTIMA_PERFORMANCE_CHECKPOINTS` to repeat the same checks on Ultima V's
near calls, far graphics-driver calls and IRQs, then move the party Down to
`(15,16)`.

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

### DMA and diskette inspection

**DMA / diskette**, initially beside Drive A, opens with **Activity**: a bounded
history of the most recent 64 controller commands, independent of Port trace.
Each command shows its name, parameters, issuing CS:IP, observed byte count and
decoded result. Read and write commands group contiguous DMA grants by disk
sector, showing C/H/R, raw image offset, RAM range and terminal count. RAM and
code links open the corresponding inspectors. A DMA address wrap splits the RAM
spans even within a single sector. Each command retains at most 128 spans;
discarded commands and spans are counted explicitly.

The decoder names the commands and status flags implemented by this controller
profile; other status bits remain visible in hexadecimal. Controller result
availability, software consuming the result, and IRQ6 entry are separate
observations. A normal result can contain the *next* sector ID, rather than the
last sector transferred. Seek and recalibrate are marked **issued** when their
parameters have been accepted; a later Sense Interrupt result reports their
completion. CPU-boundary tick values include device advancement; they are not
individual bus timestamps.

**Record disk activity** controls capture; **Live** controls drawing. Pausing
capture interrupts the current observation. Re-enabling it, clearing activity,
or restoring a checkpoint starts a **continued** entry when the controller is
busy. That entry counts only subsequent observed bytes, never reconstructing
earlier transfers. Reset, restore and media exchange clear the history; it is
an inspection aid, not part of the hardware checkpoint. An uncaptured controller
access also ends continuity. The board observer snapshots only controller
data/control accesses while enabled; status polling does not allocate history
or consume device state.

The **Registers** view shows channel 2's current and
base address/count, page register, mode, mask, request and terminal-count latch.
RAM links open Memory. The controller view shows command phase, C/H/R/N,
physical cylinder, byte position and delay, motor, IRQ6 and unread result bytes.
These are detached observations: displaying them does not read the status port
(which would clear DMA terminal counts), drain a result or copy the disk image.

**Port trace** retains each channel-2 grant before its associated CPU boundary:
RAM address, byte, direction, image offset and terminal-count indication.
It omits channel-0 refresh. A DMA row links to RAM; its CS:IP is the CPU's next
boundary, not an instruction that performed the store. Changes marks DMA stores
explicitly, and RAM-watch history separates them from CPU writes. Recording is
optional and independent of DMA event stops. A **DMA channel 2** stop can match
any byte or one physical RAM address; **Stop on this event** uses the trace's
exact address. These stops apply in either transfer direction.

The **BIOS sector read through DMA2** walkthrough follows the first boot-sector
read, stopping after byte 256, at terminal count, in IRQ6 and at the INT 13h
return. Event checkpoints use their declared condition; the displayed ROM
reference is only an explanation and browsing location. Their execution budget
and cancellation rules are the same as other temporary debugger requests.
The result is returned by **RETF 2**, preserving the BIOS's carry result while
discarding the saved FLAGS. The IRQ6 handler separately uses **IRET**.

The [laboratory checks](../../../tests/site/xt-dma.test.ts) require the first
256 RAM bytes and pending controller state at the halfway snapshot, then replay
the remaining 256 grants, IRQ6, result reads and BIOS return with identical
trace events, CPU, RAM, devices, display phase and oscillator time. Tracing,
inspection and stopping must not change the completed machine state. The test
uses a small original test disk and the separately supplied, unmodified BIOS;
the browser walkthrough also accepts the local DOS disk.

The [sector-history checks](../../../tests/site/xt-disk-activity.test.ts) cover
multi-sector grouping, DMA address wrap, incomplete observations and protected
writes. The [DOS acceptance](../../../tests/site/xt-disk-activity-dos.test.ts)
boots the supplied DOS 3.30 disk, then uses the original FAT12 data fixture.
`TYPE README.TXT` must produce its known text and move its first data sector
(image offset `$01800`, C0/H1/R4) into the displayed RAM range. A checkpoint after
byte 256 must reproduce the remaining sector spans, result, IRQ6 and complete
machine state, also matching execution without the observer. Attempting
`ECHO HELLO>SAVE.TXT` on the read-only disk must reach DOS's write-protect error,
with zero write DMA bytes, decoded ST1 write protection and unchanged media.

### Files, allocation chains and RAM

**DMA / diskette → Files** connects the mounted disk's root directory to its
allocation and recorded transfers. Pause the XT and choose a root entry. The
view shows its attributes, length, cluster chain, directory-entry location,
packed entries in each FAT copy and allocated data ranges. Clicking a range
filters Activity; clicking a recorded transfer selects its command. The RAM
links navigate to the observed source or destination, clipped to the actual
file bytes. **Show all activity** removes the filter without losing history.

The BPB describes the reserved sectors, FAT copies, fixed root directory and
cluster size. FAT12 packs two cluster links into three bytes; a link can cross
a sector boundary. Data clusters begin at 2. Directory entries name their first
cluster and byte length, so unused space at the end of an allocated cluster is
*slack*, not file content. A zero-length file can have no allocated clusters.
The decoder follows Microsoft's [FAT on-disk format specification, version
1.03](https://www.pcjs.org/documents/papers/microsoft/MS_FAT_OVERVIEW_103-2000-12-06.pdf),
particularly the BPB, FAT12 entry and short directory-entry descriptions.

This first inspector accepts whole 360 KiB FAT12 images with a DOS BPB, 512-byte
sectors and one or two FAT copies. It lists short root names, including hidden
and system files, volume labels and subdirectory allocations. It does not walk
subdirectories, recover deleted entries or decode long names. Non-ASCII name
bytes remain visible as hexadecimal escapes. Unsupported images produce an
explanation; inspection does not prevent their use by the emulated controller.
Invalid chains stop at free, reserved, bad, out-of-range or repeated clusters.
Size mismatches, shared clusters and disagreeing FAT copies are reported;
when copies disagree, displayed chains use FAT 1 explicitly.

Allocation is read from a stable image while paused. The board exposes its
existing immutable media snapshot; later guest writes use a private copy.
This neither reads a controller port nor changes emulated time. Parsing is
cached until that image changes; Run holds the previous inspection, and
**Refresh files** re-reads it while paused. Media exchange, reset and checkpoint
restore invalidate the view. No filesystem editing is performed by this tool.

A file's current allocation can overlap an older transfer without having owned
those sectors then. RAM can also have changed since a transfer, and DOS can
satisfy a read from its own buffers without disk activity. The view therefore
labels these as recorded overlaps, not current RAM contents or proven historical
file ownership. Metadata links include the neighbouring bits in each packed FAT
entry's two-byte range. A paused mid-write image may show incomplete directory
or FAT updates; these are diagnostic observations, not a repaired filesystem.

The [decoder checks](../../../tests/site/xt-fat12.test.ts) include fragmented
chains, FAT-sector crossings, corrupt images and exact RAM overlap clipping.
The [DOS acceptance](../../../tests/site/xt-disk-activity-dos.test.ts) also
requires `TYPE README.TXT` to link its 58 file bytes to the observed DMA buffer.
On a writable copy, `ECHO HELLO>SAVE.TXT` creates a seven-byte file in the next
free cluster, 4. The inspector must identify the directory write, both FAT
updates and data at image offset `$02000`. After export and a fresh XT/DOS boot,
`TYPE SAVE.TXT` must print `HELLO`, with the same allocation and seven matching
bytes at the newly observed RAM destination.

### Port trace and interrupt inspection

**Port trace**, a tab beside Disassembly, retains up to 1,024 captured events.
Enable **Record** before stepping or running. Each IN/OUT byte retains its
16-bit port, value, originating CS:IP and instruction bytes. Word transfers
retain both bytes in their original order, including a port-number wrap.
The trace also records the CPU's acknowledged vector, completed interrupt entry
and IRET destination. INTA is the model's single atomic acknowledgement record;
it does not claim to show the hardware's two separate bus cycles.

Newest events appear first. Sequence numbers preserve transfer order within
a boundary; times are oscillator ticks at the end of that complete CPU/board
boundary, including DMA and device advancement. They are not per-access bus
timestamps. **Ports**, **Interrupts** and **DMA2** filter the retained view without
changing recording. Address links browse the captured logical CS:IP, using
the fetched bytes for the trace's instruction description even if RAM changes.
**Live** controls repainting independently of **Record**. Clear, CPU reset,
power-on, restore and successful ROM replacement discard inspector history;
recording preferences remain in effect. Failed boundaries may leave partial
device effects that are outside this completed-boundary trace.

**8259A PIC**, beside Registers and Call stack, shows live input levels, IRR
pending requests, IMR masks, ISR in-service bits, vector base and initialization
phase. Its selected row comes from the controller's own priority resolver.
The accompanying CPU flags and recognition delays explain why an asserted INT
need not be accepted at the next boundary. Board sample delay identifies an
IRQ raised by the CPU's own bus transfer. NMI and an owed trap are shown
separately; neither passes through this PIC. The compact `interruptState()`
view takes a detached controller snapshot without reading ports, acknowledging
requests, copying disk media or advancing the clock.

The chapter's **A keypress through IRQ1** walkthrough follows a lowercase `a`
from the acknowledged vector `09` to the BIOS handler. The handler reads scan
code `1E` at port `60`, clears the receiver with port `61` bit 7, translates the
key into `1E61` in the BIOS keyboard ring, writes EOI `20` to port `20`, then
executes IRET. Clearing the receiver, completing PIC service and restoring CPU
state are three distinct actions. A release produces scan code `9E` and may
queue another request. The guide's labels below describe these checked ROM
addresses and this machine's port and IRQ wiring.

The [inspection checks](../../../tests/site/xt-io.test.ts) cover bounded history,
word I/O, software/NMI/trap records, prefixed IRET and detached PIC observation
with a masked or pending key. With the three XT firmware paths set, they boot
the original BIOS/BASIC, follow all five IRQ1 checkpoints, check the scan code,
PIC transitions and BIOS buffer, then compare the entire resulting machine
with ordinary execution and a replay from a checkpoint taken during the handler.

### Stopping on I/O and interrupt events

The Debugger's **I/O, DMA and interrupt stops** match captured events independently
of Port trace recording or Live updates. Choose **Port read** or **Port write**,
enter a 16-bit hexadecimal port, and optionally match a byte value. Word I/O
checks both transfers in their original order, including `FFFF` wrapping to
`0000`. The whole instruction completes before execution pauses; the reported
caller is the instruction that performed the transfer, while current CS:IP
identifies the next boundary.

**Interrupt entry** accepts an optional source and vector. For the BIOS's
initialized PIC, INTR vector `09` follows keyboard IRQ1 and vector `08` follows
timer IRQ0. These conditions match accepted entry, not a pending request or
an assertion of the PIC output. CPU masking and recognition delays still apply.
Software interrupts, NMI, owed traps and divide errors retain their distinct
sources. **IRET** stops after any completed return from interrupt; it does not
select a particular caller or handler.

Each trace row offers **Stop on this event**. A port row creates an exact
port/direction/value condition; an entry creates an exact source/vector condition.
INTA selects the corresponding completed INTR entry, and IRET selects any IRET.
Adding an existing condition enables it again. The action opens Debugger for
review; it neither resumes execution nor retroactively matches the retained row.
Clear the optional value or vector when adding a broader condition manually.

These conditions use the shared stopping policy during Run, Step, Step over,
Step out and Run to address. The first matching event in transfer order stops
after the complete CPU/board boundary. An ordinary address breakpoint still
stops before execution; a RAM write watch takes precedence if both kinds match
within the same boundary. Continue starts with the following boundary, so it
does not report the old event again. A failed boundary reports its execution
error, not a successful event stop, even if some bus effects already occurred.

Up to 64 distinct conditions can be enabled, disabled or removed. They are
browser preferences, shared by the CGA and EGA laboratories, and survive CPU
reset, power-on and checkpoint restoration. A restore discards the old stop,
trace and call history while retaining the conditions for the restored hardware.
Restoring a checkpoint does not restore an earlier set of debugger preferences.

To follow a key without knowing its handler address, add INTR vector `09`, run
from BASIC's prompt and press `a`. Then follow `IN 0060 = 1E`, `OUT 0020 = 20`
and IRET. For the timer, use INTR vector `08`, observe the BIOS tick count at
`0046C`, then follow EOI and IRET. The [event checks](../../../tests/site/xt-debugger.test.ts)
include a halted CPU waking through the PIT, complete word transfers,
continuation and stop precedence. The original-firmware inspection checks also
follow both BIOS handlers and reproduce their exact state and event hits after
restoring checkpoints inside them, with trace recording disabled.

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
  "dos": {
    "services": [
      {"function": "09", "name": "Print string", "description": "Write a dollar-terminated message to standard output, which may be redirected.", "arguments": [], "result": {"kind": "none", "description": "No documented return value; CF is not a success indicator."}, "buffer": {"label": "Message", "direction": "input", "length": "24"}, "handles": {"action": "use", "source": 1}},
      {"function": "3C", "name": "Create file", "description": "Create or truncate a named file.", "arguments": [{"register": "CX", "label": "File attributes"}], "result": {"kind": "handle", "description": "CF clear: AX is the new handle. CF set: AX is an error."}, "buffer": {"label": "Filename", "direction": "input", "length": "00"}, "handles": {"action": "open"}},
      {"function": "3D", "name": "Open file", "description": "Open an existing file.", "arguments": [{"register": "AL", "label": "Access/sharing mode: low three bits 0=read, 1=write, 2=read/write"}], "result": {"kind": "handle", "description": "CF clear: AX is the handle. CF set: AX is an error."}, "buffer": {"label": "Filename", "direction": "input", "length": "00"}, "handles": {"action": "open"}},
      {"function": "3E", "name": "Close handle", "description": "Close the handle and flush pending file updates.", "arguments": [{"register": "BX", "label": "Handle"}], "result": {"kind": "status", "description": "CF clear indicates success; CF set returns an error in AX."}, "handles": {"action": "close", "source": "BX"}},
      {"function": "3F", "name": "Read handle", "description": "Read into the destination buffer.", "arguments": [{"register": "BX", "label": "Handle"}, {"register": "CX", "label": "Maximum bytes to read"}], "result": {"kind": "count", "description": "CF clear: AX is bytes read, possibly fewer than CX. Zero means no bytes read. CF set: AX is an error."}, "buffer": {"label": "Destination", "direction": "output", "length": "CX"}, "handles": {"action": "use", "source": "BX"}},
      {"function": "40", "name": "Write handle", "description": "Write from the source buffer. CX=0 changes a disk file’s length at its current position.", "arguments": [{"register": "BX", "label": "Handle"}, {"register": "CX", "label": "Bytes to write"}], "result": {"kind": "count", "description": "CF clear: AX is bytes written; a short write is possible. CF set: AX is an error."}, "buffer": {"label": "Source", "direction": "input", "length": "CX"}, "handles": {"action": "use", "source": "BX"}},
      {"function": "42", "name": "Seek file", "description": "Move the file pointer relative to the beginning, current position, or end of the file. Seeking does not transfer bytes or change the file length.", "arguments": [{"register": "AL", "label": "Origin: 0=beginning, 1=current position, 2=end"}, {"register": "BX", "label": "Handle"}, {"register": "CX", "label": "Displacement high word"}, {"register": "DX", "label": "Displacement low word"}], "result": {"kind": "position", "description": "CF clear: DX:AX is the new absolute byte position. CF set: AX is an error; DX is not a position."}, "handles": {"action": "seek", "source": "BX"}},
      {"function": "45", "name": "Duplicate handle", "description": "Create another handle for the same open file, sharing its file position. Closing one alias leaves the other open.", "arguments": [{"register": "BX", "label": "Source handle"}], "result": {"kind": "handle", "description": "CF clear: AX is the new handle. CF set: AX is an error."}, "handles": {"action": "duplicate", "source": "BX"}},
      {"function": "46", "name": "Redirect handle", "description": "Make the target handle refer to the source file, closing its previous file if necessary. Both handles share the file position.", "arguments": [{"register": "BX", "label": "Source handle"}, {"register": "CX", "label": "Target handle"}], "result": {"kind": "status", "description": "CF clear indicates success; CF set returns an error in AX."}, "handles": {"action": "redirect", "source": "BX", "target": "CX"}},
      {"function": "4C", "name": "Terminate process", "description": "Exit to the parent process.", "arguments": [{"register": "AL", "label": "Requested exit status"}], "result": {"kind": "terminate", "description": "This call does not return to its caller."}},
      {"function": "4D", "name": "Child exit status", "description": "Read the child process’s exit information.", "arguments": [], "result": {"kind": "exit-status", "description": "AH: 00 normal, 01 Ctrl-C, 02 critical-error abort, 03 stayed resident. AL: exit status. CF is not a success indicator."}}
    ],
    "errors": {"0001": "Invalid function", "0002": "File not found", "0003": "Path not found", "0004": "Too many open files", "0005": "Access denied", "0006": "Invalid handle", "000C": "Invalid access mode"},
    "forgetHandles": {"interrupts": ["20", "27"], "functions": ["00", "26", "31", "4B", "4C", "50", "55", "5A", "5B", "67", "6C"]},
    "handleTable": {"name": "MS-DOS 3.30 local handle table", "entry": "1460", "guards": [{"offset": "1460", "bytes": "2E 3A 26 FF 0D 77 DC 80 FC 51 74 A1"}, {"offset": "140D", "bytes": "2E 8B 1E DE 02 CF"}], "currentPsp": "02DE", "count": "0032", "pointer": "0034", "systemFiles": {"pointer": "002A", "entrySize": "0035", "information": "0005", "position": "0015"}}
  },
  "sha256": "2798f8a9a7dcab651ede40373d35269ad573b75acf811115c263e034ef80a1f2",
  "io": {
    "ports": [
      {"address": "0004", "input": "8237A · channel 2 current address", "output": "8237A · channel 2 base/current address"},
      {"address": "0005", "input": "8237A · channel 2 current count", "output": "8237A · channel 2 base/current count"},
      {"address": "0008", "input": "8237A · status (clears terminal counts)", "output": "8237A · command"},
      {"address": "000A", "output": "8237A · single-channel mask"},
      {"address": "000B", "output": "8237A · mode"},
      {"address": "000C", "output": "8237A · clear byte selector"},
      {"address": "0020", "input": "8259A · selected IRR/ISR", "output": "8259A · command / EOI"},
      {"address": "0021", "input": "8259A · interrupt mask", "output": "8259A · initialization / mask"},
      {"address": "0040", "input": "8253 · channel 0 count", "output": "8253 · channel 0 reload"},
      {"address": "0041", "input": "8253 · channel 1 count", "output": "8253 · channel 1 reload"},
      {"address": "0042", "input": "8253 · channel 2 count", "output": "8253 · channel 2 reload"},
      {"address": "0043", "output": "8253 · control"},
      {"address": "0060", "input": "8255A · keyboard data"},
      {"address": "0061", "input": "8255A · port B", "output": "8255A · keyboard / speaker control"},
      {"address": "0062", "input": "8255A · port C"},
      {"address": "0063", "output": "8255A · control"},
      {"address": "0081", "output": "DMA channel 2 · address page"},
      {"address": "00A0", "output": "XT · NMI mask"},
      {"address": "03F2", "output": "Diskette · motor / reset / DMA and IRQ enable"},
      {"address": "03F4", "input": "Diskette · main status"},
      {"address": "03F5", "input": "Diskette · result byte", "output": "Diskette · command / parameter byte"}
    ],
    "irqs": ["PIT channel 0", "XT keyboard", "Expansion", "Expansion", "Expansion", "Expansion", "Diskette", "Expansion"]
  },
  "regions": [
    {"start": "FE000", "end": "FFFFF", "name": "IBM XT BIOS · 11/08/82"}
  ],
  "routines": [
    {"address": "FEC59", "name": "DISKETTE_IO", "description": "BIOS INT 13h entry. Program DMA and the controller, wait for IRQ6, collect results and return AH/CF. RETF 2 discards the saved FLAGS while preserving the result flags."},
    {"address": "FEF57", "name": "DISKETTE_IRQ", "description": "BIOS IRQ6 entry. Set bit 7 of 0040:003E, send PIC EOI and IRET to the waiting diskette routine."},
    {"address": "FFFF0", "name": "RESET_VECTOR", "description": "Hardware entry at FFFF:0000. Its far jump selects the BIOS code segment and RESET offset."},
    {"address": "FE05B", "name": "RESET", "description": "Start of the 8088 flag, branch, and register tests. Maskable interrupts are disabled first."},
    {"address": "FE08C", "name": "C8", "description": "Pass the current AX pattern through DS, BX, ES, CX, SS, DX, SP, BP, SI, and DI."},
    {"address": "FE0AD", "name": "ERR01", "description": "HLT on an early processor or BIOS-checksum failure."},
    {"address": "FE0AE", "name": "C10", "description": "Disable NMI and video, initialize board ports, and prepare the BIOS checksum."},
    {"address": "FF8F2", "name": "ROS_CHECKSUM", "description": "Add the 8,192 bytes starting at DS:BX into AL. OR AL,AL sets ZF from the checksum before RET."},
    {"address": "FE0D7", "name": "C11", "description": "Check the BIOS checksum result and continue to DMA/timer initialization when ZF is set."},
    {"address": "FE987", "name": "KEYBOARD_IRQ", "description": "Our label for the BIOS IRQ1 entry. Read the scan code, clear the receiver, translate the key, send EOI and return through IRET."}
  ],
  "labels": [
    {"address": "0043E", "name": "SEEK_STATUS", "scope": "workspace", "description": "Bit 7 records the BIOS IRQ6 completion flag; low bits record recalibrated drives."},
    {"address": "00441", "name": "DISKETTE_STATUS", "scope": "workspace", "description": "BIOS diskette status returned in AH."},
    {"address": "00442", "name": "NEC_STATUS", "scope": "workspace", "description": "Seven controller result bytes copied by the BIOS: ST0, ST1, ST2, C, H, R and N."},
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
    {"address": "FE718", "bytes": "CD 13", "text": "Boot requests one sector with AX=0201, CX=0001, DX=0000 and ES:BX=0000:7C00. The BIOS programs DMA channel 2; the CPU does not copy the sector."},
    {"address": "FEE68", "bytes": "EE", "text": "Send AL to the controller data port in DX. For Read Data, the first byte is E6; the BIOS then supplies eight parameters."},
    {"address": "FEF3A", "bytes": "F6 06 3E 00 80", "text": "Poll the BIOS completion flag in 0040:003E. DMA moves bytes while this loop waits; IRQ6 sets bit 7."},
    {"address": "FEF57", "bytes": "FB", "text": "Begin the diskette IRQ handler by enabling interrupts. The BIOS will set the completion flag and send EOI."},
    {"address": "FEF68", "bytes": "CF", "text": "Return from IRQ6 to the diskette wait. This is not the return from INT 13h: the BIOS must still read the controller results."},
    {"address": "FEC82", "bytes": "CA 02 00", "text": "Return from INT 13h using RETF 2, discarding saved FLAGS so the caller sees the carry result computed by the BIOS."},
    {"address": "FE71A", "bytes": "59", "text": "INT 13h has returned to the bootstrap caller. On success AH=00 and CF=0; restore CX before testing carry and jumping to the loaded sector."},
    {"address": "FE721", "bytes": "EA 00 7C 00 00", "text": "Transfer execution to the sector at physical 07C00. Firmware has loaded these 512 bytes through DMA channel 2."},
    {"address": "FE994", "bytes": "E4 60", "text": "Read the keyboard scan byte at port 60. A read alone does not clear the receiver or the PIC in-service bit."},
    {"address": "FE99D", "bytes": "E6 61", "text": "Set port B bit 7 to clear the keyboard receiver and lower its IRQ1 line. The PIC remains in service until EOI."},
    {"address": "FEA5C", "bytes": "E6 20", "text": "Send non-specific EOI (AL=20) to the PIC. This clears its highest-priority in-service bit; it does not return from the handler."},
    {"address": "FEA66", "bytes": "CF", "text": "IRET restores IP, CS and FLAGS from the interrupt frame. The PIC has already received EOI."},
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
  }, {
    "id": "keyboard-irq", "title": "A keypress through IRQ1",
    "setup": "Quick boot to BASIC’s Ok prompt, then Pause. Open Port trace and enable Record. Open 8259A PIC and Call stack. Select the first checkpoint, choose Run to checkpoint, click the screen and press a lowercase a. Key release is a separate scan byte and may produce another IRQ1 later.",
    "steps": [
      {"title": "IRQ1 entered", "address": "FE987", "execution": "F000:E987", "routine": "KEYBOARD_IRQ",
       "prepare": "With Record enabled, run to this checkpoint and press a in the screen. Ignore earlier timer events in the trace.",
       "observe": "INTA supplies vector 09, followed by INTR entry at F000:E987. IRQ1 is in service; its original pending request has been acknowledged. IF is clear. Call stack records the interrupted CS:IP and return pair."},
      {"title": "Read the scan code", "address": "FE994", "execution": "F000:E994", "routine": "KEYBOARD_IRQ",
       "prepare": "Run through the handler prologue and its near call. Step the IN instruction at this checkpoint.",
       "observe": "Port trace records IN 0060 with value 1E for the a make code (9E is its release). AL holds the captured byte. IRQ1 remains in service and reading the port has not cleared the keyboard receiver."},
      {"title": "Clear the receiver", "address": "FE99D", "execution": "F000:E99D", "routine": "KEYBOARD_IRQ",
       "prepare": "Run through the read of port 61 and the setting of bit 7, then Step this OUT.",
       "observe": "OUT 0061 raises bit 7 and lowers the receiver’s IRQ1 level. The PIC’s in-service bit stays set. The next OUT restores port B. A separately queued release may later raise the line again."},
      {"title": "Tell the PIC service is complete", "address": "FEA5C", "execution": "F000:EA5C", "routine": "KEYBOARD_IRQ",
       "prepare": "Run through scan-code translation. For an unshifted a, the BIOS has stored the word 1E61 in its keyboard ring and advanced BUFFER_TAIL. Step the OUT at this checkpoint.",
       "observe": "OUT 0020 writes 20, clearing the IRQ1 in-service bit. This is EOI, not a CPU return. The observed interrupt frame remains in Call stack."},
      {"title": "Return to the interrupted code", "address": "FEA66", "execution": "F000:EA66", "routine": "KEYBOARD_IRQ",
       "prepare": "Run through the register restoration, then Step IRET.",
       "observe": "The IRET trace links to the restored CS:IP. The observed interrupt frame disappears from Call stack and FLAGS are restored. Continue running to let BASIC consume and echo the key."}
    ]
  }, {
    "id": "bios-sector-read",
    "title": "BIOS sector read through DMA2",
    "setup": "Use the CGA XT and a bootable 360 KiB disk, such as MS-DOS 3.30. This walkthrough follows the first bootstrap read without changing BIOS code or RAM. Event stops and address stops share the debugger; unrelated breakpoints can interrupt the walkthrough.",
    "steps": [
      {"title": "Request the boot sector", "address": "FE718", "execution": "F000:E718", "routine": "DISKETTE_IO",
       "memory": "07C00",
       "prepare": "Insert a bootable 360 KiB disk. In Debugger, add breakpoint F000:E718, then choose Quick boot. It pauses at this call; disable the breakpoint before continuing the walkthrough. Disable unrelated stops.",
       "observe": "AX=0201 requests one sector. CX=0001 selects C0/H0/R1, DL=00 selects drive A and ES:BX=0000:7C00 selects the buffer. Enable Record in Port trace now."},
      {"title": "Send Read Data", "address": "FEE68", "execution": "F000:EE68", "routine": "DISKETTE_IO",
       "memory": "07C00", "event": {"kind": "output", "port": 1013, "value": 230},
       "prepare": "Run to the completed OUT of E6 to port 03F5.",
       "observe": "The BIOS has programmed DMA2 address 7C00, count 01FF, page 00 and mode 46 (stored mode 44 without channel bits). Eight controller parameters follow."},
      {"title": "Half a sector in RAM", "address": "FEF3A", "execution": "F000:EF3A", "routine": "DISKETTE_IO",
       "memory": "07C00", "event": {"kind": "dma", "address": 31999},
       "prepare": "Run to the DMA2 transfer at physical 07CFF. Save snapshot here to replay the remaining half.",
       "observe": "256 bytes occupy 07C00–07CFF. The next address is 7D00, count 00FF and controller byte offset 256. The mounted image and its transfer delay are part of the checkpoint."},
      {"title": "Terminal count raises IRQ6", "address": "FEF57", "execution": "F000:EF57", "routine": "DISKETTE_IRQ",
       "memory": "07C00", "event": {"kind": "dma", "address": 32255},
       "prepare": "Continue to the last byte at 07DFF.",
       "observe": "512 bytes have arrived. Address is 7E00 and count has wrapped to FFFF; channel 2 is masked and terminal count is set. The controller offers seven result bytes and raises IRQ6. INTA and entry may already share this boundary."},
      {"title": "Enter the IRQ6 handler", "address": "FEF57", "execution": "F000:EF57", "routine": "DISKETTE_IRQ",
       "memory": "07C00",
       "prepare": "Run to the IRQ6 entry; it may already be the current PC.",
       "observe": "The PIC has acknowledged vector 0E and set IRQ6 in service. The CPU saved its wait-loop return address; the handler has not yet set the BIOS completion flag."},
      {"title": "Return from IRQ6", "address": "FEF68", "execution": "F000:EF68", "routine": "DISKETTE_IRQ",
       "memory": "07C00",
       "prepare": "Run through setting the completion flag and sending EOI. Step IRET if you want to inspect its destination.",
       "observe": "The PIC in-service bit is clear. IRET returns to the wait loop; the controller result is still waiting to be drained. This is distinct from the INT 13h return."},
      {"title": "Return to the boot caller", "address": "FE71A", "execution": "F000:E71A", "routine": "DISKETTE_IO",
       "memory": "07C00",
       "prepare": "Run through the seven result reads and the BIOS return.",
       "observe": "AH=00 and CF=0 indicate success. The complete sector is in 07C00–07DFF, the controller is idle, and IRQ6 is clear. INT 13h returned with RETF 2, preserving its result flags. Restore the halfway snapshot and repeat to obtain the same bytes and boundary."},
      {"title": "Hand execution to the sector", "address": "FE721", "execution": "F000:E721", "routine": "DISKETTE_IO",
       "memory": "07C00",
       "prepare": "Run to the far jump, then Step.",
       "observe": "CS:IP becomes 0000:7C00. The disk code now runs from the buffer you inspected."}
    ]
  }, {
    "id": "hello-com",
    "title": "HELLO.COM: from disk to execution",
    "setup": "Use the CGA XT, the audited MS-DOS 3.30 system disk, and the original DROMAIOS data disk. Boot DOS, accept date/time, and wait for A>. These addresses describe that clean DOS configuration, not an arbitrary DOS version or EGA layout. Code/register guards reject mismatching state; unrelated debugger stops can interrupt the tour. This guide follows actual CPU and DMA execution without modifying guest RAM.",
    "steps": [
      {"title": "HELLO.COM sector in DOS’s buffer", "address": "FEF3A", "execution": "F000:EF3A",
       "memory": "0B3D0",
       "file": "HELLO.COM",
       "expect": {"bytes": {"address": "0B3D0", "value": "BA 0C 01 B4 09 CD 21 B8 00 4C CD 21"}},
       "event": {"kind": "dma", "address": 46543},
       "prepare": "At the DOS A> prompt, wait for the motor to stop, insert the DROMAIOS data disk, select this stop and choose Run to checkpoint. Click the screen and type HELLO.COM then Enter. Keep disk activity Record enabled.",
       "observe": "DMA2 has delivered sector 14 (C0/H1/R6), image +$01C00–01DFF, to $0B3D0–0B5CF. Files links the 47 HELLO.COM bytes at +$01C00 to RAM $0B3D0. The other 465 bytes are sector slack. DOS has not yet copied these bytes to the program’s execution address."},
      {"title": "DOS copies the file into the program area", "address": "07539", "execution": "022F:5249",
       "memory": "0C6B0",
       "file": "HELLO.COM",
       "expect": {"bytes": {"address": "07539", "value": "A4 F3 A5"}, "registers": {"ds": "0B3C", "es": "0C6B", "cx": "0017"}},
       "prepare": "Continue through the BIOS result and the return to DOS. Browse code and open Instruction.",
       "observe": "MOVSB copies the first byte from DS:SI = 0B3C:0010 to ES:DI = 0C6B:0000, physical $0C6B0. REP MOVSW at the next instruction copies 23 words. Together they copy all 47 file bytes. This CPU copy is distinct from the preceding DMA transfer."},
      {"title": "DOS hands control to HELLO.COM", "address": "085E4", "execution": "022F:62F4",
       "memory": "0C6B0",
       "file": "HELLO.COM",
       "expect": {"bytes": {"address": "0C6B0", "value": "BA 0C 01 B4 09 CD 21 B8 00 4C CD 21"}, "registers": {"ds": "0C5B", "es": "0C5B", "ss": "0C5B", "sp": "FFFA"}},
       "prepare": "Run past the copy and the loader’s register setup. Inspect the loaded code, then Step the RETF to enter the program.",
       "observe": "DOS’s RETF pops IP=0100 and CS=0C5B from SS:SP = 0C5B:FFFA. The 47 bytes now occupy $0C6B0–0C6DE. The first 256 bytes of segment 0C5B form the Program Segment Prefix (PSP); the file begins after it. RETF enters the program: it is not returning from HELLO.COM."},
      {"title": "First program instruction", "address": "0C6B0", "execution": "0C5B:0100",
       "memory": "0C6B0",
       "file": "HELLO.COM",
       "expect": {"bytes": {"address": "0C6B0", "value": "BA 0C 01 B4 09 CD 21 B8 00 4C CD 21"}, "registers": {"ds": "0C5B", "es": "0C5B", "ss": "0C5B", "sp": "FFFE"}},
       "prepare": "Run to the entry, or select it immediately after stepping the loader’s RETF. This stop does not execute the first instruction.",
       "observe": "CS=DS=ES=SS=0C5B and SP=FFFE. MOV DX,010C selects the message immediately after the twelve code bytes. Browse code to see the five instructions; the bytes following them are text, not more instructions."},
      {"title": "Ask DOS to print the message", "address": "0C6B5", "execution": "0C5B:0105",
       "memory": "0C6BC",
       "file": "HELLO.COM",
       "expect": {"bytes": {"address": "0C6B0", "value": "BA 0C 01 B4 09 CD 21 B8 00 4C CD 21"}, "registers": {"ax": "0900", "ds": "0C5B", "dx": "010C"}},
       "prepare": "Run through MOV DX,010C and MOV AH,09. Inspect the message in Memory and the INT 21 instruction before stepping into DOS.",
       "observe": "AX=0900 and DS:DX=0C5B:010C identify DOS service 09 and the dollar-terminated string at physical $0C6BC. The final $24 byte is the dollar delimiter. DOS prints through its console driver; the program does not write CGA RAM directly."},
      {"title": "The print call has returned", "address": "0C6B7", "execution": "0C5B:0107",
       "memory": "0C6BC",
       "file": "HELLO.COM",
       "expect": {"bytes": {"address": "0C6B0", "value": "BA 0C 01 B4 09 CD 21 B8 00 4C CD 21"}},
       "prepare": "Continue through DOS and BIOS screen output. The selected address is the instruction after INT 21.",
       "observe": "The screen contains Hello from HELLO.COM on drive A. followed by a line break. The dollar delimiter was not printed. DOS has returned to the program; MOV AX,4C00 is next."},
      {"title": "Return control to DOS", "address": "0C6BA", "execution": "0C5B:010A",
       "memory": "0C6B0",
       "file": "HELLO.COM",
       "expect": {"bytes": {"address": "0C6B0", "value": "BA 0C 01 B4 09 CD 21 B8 00 4C CD 21"}, "registers": {"ax": "4C00"}},
       "prepare": "Run through MOV AX,4C00, then inspect or Step the second INT 21.",
       "observe": "AX=4C00 requests process termination with status zero. This service returns control to the parent command interpreter; it does not return to offset 010C in the terminated program."},
      {"title": "Back at the DOS prompt", "address": "070F3", "execution": "022F:4E03",
       "memory": "0C6B0",
       "file": "HELLO.COM",
       "expect": {"bytes": {"address": "0C6B0", "value": "BA 0C 01 B4 09 CD 21 B8 00 4C CD 21"}, "screen": {"contains": "Hello from HELLO.COM on drive A.", "lastLine": "A>"}},
       "prepare": "Continue through process termination and the command interpreter. The stop requires the message and the new A> prompt to be visible.",
       "observe": "DOS is polling for another command. The last nonblank screen line is A>, beneath the HELLO.COM message. The old program bytes may still be in RAM, but that does not mean the program is still running. Type another command or restore a saved transfer checkpoint and repeat the walkthrough."}
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
RAM and devices. **Fresh power-on** starts a new machine with the loaded ROMs
and any disk in drive A.

[intel]: https://www.ardent-tool.com/CPU/docs/Intel/808x/manuals/9800722-03_alt.pdf
[ibm]: https://minuszerodegrees.net/manuals/IBM_5160_Technical_Reference_APR83.pdf
[rom-layout]: https://www.pcjs.org/machines/pcx86/ibm/5160/rom/
[font-image]: https://www.pcjs.org/machines/pcx86/ibm/video/cga/
