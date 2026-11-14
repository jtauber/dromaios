# TRS-80 Color Computer with 64 KiB RAM

This configuration adds physical RAM to the [CoCo](coco.md) and keeps the
same CPU, ROMs, PIAs, SAM, VDG, and optional [disk cartridge](coco-disk.md).
The existing 32 KiB factories retain their memory capacity and restrictions.
No startup code is injected: the ROM initializes the board normally.

## RAM selection

The [Motorola SAM datasheet][sam], figures 14–17, distinguishes the CPU's
logical address from the physical address presented to DRAM. With M=10
(64K dynamic RAM), TY=0 keeps the ROM map and P1 selects which physical
32 KiB half appears at CPU addresses $0000–$7FFF. Independently of M, TY=1
ignores P1 and maps $0000–$FEFF to physical RAM at the same address. Upper RAM writes require
that RAM map; normal-ROM writes do not secretly update hidden RAM.

The entire $FF00–$FFFF page retains its original decoding in both maps.
PIAs, disk registers, and SAM switches remain accessible; $FFE0–$FFFF still
aliases the Color BASIC ROM tail. Physical RAM in that page can be reached
through the lower CPU window with P1=1, but cannot replace CPU vectors.
Video addresses physical RAM independently of P1 and TY and retain bit 15.

M=00 and M=01 keep the earlier logical-RAM startup approximation. Their DRAM
row/column aliases are not simulated. M=11 and fast CPU-clock modes remain
unsupported; neither changing a latch nor restoring a checkpoint invents
additional hardware. The machine snapshot's RAM length identifies capacity.

## Executable composition

The explicit windows share the SAM chapter's selectors. This introduces no
machine-inheritance language or hidden remapping in the CPU implementation.

```machine
components {
    ram = ram 10000
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
    0000 = window 8000 {
        read = ram offset 8000 when sam.upperPage
        read = ram
        write = ram offset 8000 when sam.upperPage
        write = ram
    }
    8000 = window 2000 {
        read = ram offset 8000 when sam.allRam
        read = extended
        write = ram offset 8000 when sam.allRam
        write = discard
    }
    A000 = window 2000 {
        read = ram offset A000 when sam.allRam
        read = firmware
        write = ram offset A000 when sam.allRam
        write = discard
    }
    C000 = window 2000 {
        read = ram offset C000 when sam.allRam
        read = cartridge when cartridge.inserted
        read = dos
        write = ram offset C000 when sam.allRam
        write = discard
    }
    E000 = window 1F00 {
        read = ram offset E000 when sam.allRam
        read = cartridge offset 2000 when cartridge.inserted
        read = dos
        write = ram offset E000 when sam.allRam
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

[sam]: https://www.onasticksoftware.co.uk/dragon/sn74ls783.pdf
