# TRS-80 Color Computer with Disk Extended Color BASIC

This profile adds the Tandy FD-502 disk cartridge to the
[32 KiB NTSC CoCo](coco.md). It shares that chapter's CPU, RAM, keyboard, PIA,
SAM, VDG, sound, cassette, joystick, and clock contracts. The executable map
below makes the cartridge's two additions explicit: Disk BASIC at C000 and
the controller at FF40. The [controller chapter](../../components/devices/specifications/coco-disk.md)
owns the WD1773 command state, byte deadlines, and HALT/NMI wiring.

## Reference audit and acceptance

The earlier [dromaios-coco audit](../../../docs/machines/coco.md#reference-audit)
found no working disk controller. The FD-502 schematic, Western Digital
register/timing manual, and the ROM's actual bus transactions are the primary
evidence here. The selected ROM is **Disk Extended Color BASIC 1.1**, verified
against [MAME's CRC32 and SHA-1][mame]: `0b9c5415` and
`10bdc5aa2d7d7f205f67b47b19003a4bd89defd1`. Its SHA-256 is declared below.
The image is supplied locally; no ROM or third-party disk bytes are published.

The [original-ROM acceptance](../../../tests/machines/6809/coco/disk-rom.test.ts)
cold-boots all three images and types these commands through the keyboard matrix:

```text
DIR
LOAD "ANSWER"
LIST
RUN
```

The independently authored disk has a single ASCII BASIC file:
`10 PRINT 42` and `20 END`. Its directory is on track 17, sector 3; the
allocation table on track 17, sector 2 points to granule 0, whose first sector
is track 0, sector 1. `DIR` lists `ANSWER.BAS`, `LIST` reproduces both lines,
and `RUN` prints `42`. The controller knows none of this filesystem layout.
Every sector byte passes through the ROM's `LDB $FF4B` at D881 and its following
store to RAM. The test checks all 256 bytes before completion NMI, including
the final byte that a short BASIC program could otherwise leave untested.

A checkpoint after 128 reads must reproduce the remaining transfers, final
RAM, CPU, controller, host keyboard queue, and clocks. `SAVE "DENIED"` must
report `?WP ERROR` without changing the disk. An empty drive must let the ROM
time out, issue Force Interrupt, and return `?IO ERROR` to the BASIC prompt.
These checks are enabled with `COCO_ROM`, `COCO_EXTENDED_ROM`, and `COCO_DISK_ROM`.

The always-on [controller tests](../../../tests/components/devices/coco-disk.test.ts)
and [board tests](../../../tests/machines/6809/coco/disk.test.ts) also cover
lost-data deadlines, missing sectors, physical versus logical tracks, step
rates, write protection, NMI edges, clock partitioning, and observation without
acknowledgement. No external images are needed for those checks.

## One expansion socket

The laboratory can replace the disk cartridge with an ordinary **ROM Program
Pak**, also available on the [64 KiB board](coco64.md). A raw 2, 4, 8, or
16 KiB image occupies C000–FEFF, repeating when its ROM does not decode the
upper address lines. The FF00 page still belongs to the board. Bank-switched
cartridges, extra cartridge RAM, custom peripheral hardware, and a Multi-Pak
Interface are outside this slot model.

A ROM Pak disconnects the disk ROM, FF40–FF5F registers, HALT, and NMI. The
mounted disk remains in host storage for later use, but its controller does
not advance while disconnected. The map below expresses undriven reads with
`read = unmapped`; these return the board's FF value without storage or side
effects. Writes to either ROM or a disconnected controller are discarded.

Ordinary auto-start Paks connect CART to the CPU's Q clock. CART reaches PIA 1
CB1 and its FIRQ request, as shown in the [Tandy technical reference][technical].
This model supplies both Q edges at each completed CPU/idle boundary. That
preserves the PIA's selected-edge latch and acknowledgment behavior at our
instruction-boundary resolution; it does not model intra-instruction E/Q
transitions. Color BASIC detects that signal and enters the Pak itself. Insertion
does not synthesize vectors or change the reset address to C000. Color BASIC
is still required even when a Pak uses little of its firmware.

Insertion and removal in the laboratory perform fresh power-on. The immutable
cartridge image and its name belong to the native snapshot; a browser checkpoint
contains the bytes, and can restore the Pak after removal. On the 64 KiB board,
TY can hide cartridge ROM behind RAM without disconnecting its CART signal.
The [slot tests](../../../tests/site/coco-cartridge.test.ts) check mirroring,
write protection, disk disconnection, CART acknowledgment, and packed restoration.
The [software examples](coco.md#rom-cartridges) exercise original Program Paks.

## Machine composition

The base and disk profiles deliberately declare their concrete maps separately;
they share all implementation components. There is no new machine-inheritance
language for two configurations. The ROM repeats every 8 KiB through FEFF;
the BASIC vector alias at FFE0 remains the base Color BASIC image.

```machine
components {
    ram = ram 8000
    firmware = rom 2000
    extended = rom 2000
    dos = rom 2000
    pias = coco-pias
    sam = mc6883
    vdg = mc6847
    disk = coco-disk-controller
    cartridge = coco-cartridge
}

map 10000 {
    0000 = ram
    8000 = extended
    A000 = firmware
    C000 = window 2000 {
        read = cartridge when cartridge.inserted
        read = dos
        write = discard
    }
    E000 = window 1F00 {
        read = cartridge offset 2000 when cartridge.inserted
        read = dos
        write = discard
    }
    FF00 = pias
    FF40 = window 20 {
        read = disk when cartridge.empty
        read = unmapped
        write = disk when cartridge.empty
        write = discard
    }
    FFC0 = sam
    FFE0 = window 20 {
        read = firmware offset 1FE0
        write = discard
    }
    unmapped = FF
}

image firmware external sha256 5375b1caef9df815b781d9cd6df81ecdaddd2642b06a01adac521e40f1329751
image extended external sha256 a18f270d3495d82b9f515de049f46253a623a2d9b1bb226c9ad338508344c5ee
image dos external sha256 1c40c5a74e72edaeecc2511fee1aab347eae2c3d5fc6778cb622e3df14d63157

cpu 6809 {
    A = 00  B = 00  DP = 00
    X = 0000  Y = 0000  S = 0000  U = 0000  PC = 0000
    waitMode = none  nmiArmed = false
    flags { E = 0  F = 1  H = 0  I = 1  N = 0  Z = 0  V = 0  C = 0 }
}

reset { cpu }
clock cpu 894886.25 Hz
```

`create6809CocoDisk` accepts three independently verified ROM bindings. Booting
Disk BASIC requires all three. Construction, inspection, and empty sockets work
without firmware, as on the base machine. The ROM discovers the cartridge;
the host does not patch startup vectors or jump into DOS. `disk.mount(bytes)`
accepts only a headerless, single-sided, 35×18×256 image. `disk.mount(null)`
ejects it. Both require an idle controller. Mounting starts write-protected;
`disk.writableCopy()` explicitly enables guest writes while idle. Native callers
may also pass `{ writable: true }` to `mount`. `disk.exportImage()` returns a
detached raw image, including any completed prefix of an unfinished write.
Neither operation knows about BASIC files or allocation tables.

Use the shared `stepCoco(machine)` for execution. Once HALT is released, it
consumes a pending NMI assertion before the PIA interrupt levels. HALT
returns a waiting boundary with no instruction, accesses, or CPU state change;
time advances to the next controller or video-sync event. CPU SYNC/CWAI also
keep the controller clock running. No browser frame or status read advances
the disk. The board converts the exact CPU rate to integral microseconds and
retains the fractional remainder. Events are observed at instruction boundaries;
bus-cycle timing and rotational media encoding remain outside this profile.

[Motorola's HALT timing][6809-timing], figure 8, requires assertion before the
last cycle to stop the current instruction. The board treats controller bus
accesses as last-cycle accesses: a new HALT assertion caused by one takes
effect after the following instruction. In the ROM loop this lets `STB ,X+`
store the byte just read, including the sector's final byte, before waiting.
The one-instruction deferral is explicit saved board state. This is a boundary
timing convention for the selected ROM's accesses, not a cycle-accurate claim
for arbitrary read-modify-write or multi-byte accesses to controller registers.

Snapshots retain the image, physical head, logical registers, in-flight byte,
DRQ/INTRQ, pending NMI edge, HALT deferral, write permission, pending DATA,
event delay, and clock fraction. The immutable
image is shared between native snapshots; a deserialized image is validated
and copied. A later guest write copies shared bytes before modifying them, so
held checkpoints remain unchanged. CPU reset preserves these fields. A fresh factory starts with an
empty controller; the caller may mount the same image for a fresh boot.
The [browser laboratory](coco.md#disk-basic-in-the-laboratory) selects this
profile with an optional Disk BASIC ROM and Drive 0 controls. Its fresh power-on
retains mounted media and write permission; checkpoints restore the image and
in-flight read or write. The [SAVE acceptance](../../../tests/site/coco-disk-write.test.ts)
creates a BASIC file through the ROM, replays a write checkpoint, exports the
raw disk, and loads and runs that file after fresh power-on.

[mame]: https://github.com/mamedev/mame/blob/master/src/devices/bus/coco/coco_fdc.cpp
[6809-timing]: https://colorcomputerarchive.com/repo/Documents/Datasheets/MC6809%20HMOS%208%20Bit%20Microprocessor%20%28Motorola%29.pdf

[technical]: https://colorcomputerarchive.com/repo/Documents/Manuals/Hardware/Color%20Computer%20Technical%20Reference%20Manual%20%28Tandy%29.pdf
