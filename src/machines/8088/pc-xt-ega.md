# IBM PC/XT with the Enhanced Graphics Adapter

This configuration fits the [same XT motherboard and drive A](pc-xt.md) with
one IBM EGA, 256 KiB of display memory and an Enhanced Color Display. The
motherboard switch byte is `0D`: the system BIOS leaves display initialization
to an expansion ROM. The card switches are off/on/on/off for a primary EGA
driving the 350-line monitor.

## Two buses into the card

The CPU sees the adapter through its memory aperture at `A0000–BFFFF` and
programs its registers through I/O ports. The separate 16 KiB firmware socket
begins at `C0000`. The XT BIOS checks the option ROM signature, length and
checksum before calling `C000:0003`. The IBM ROM installs INT 10h and takes
over display services, including the teletype output that DOS uses.

```machine
components {
    ram = ram A0000
    ega = ibm-ega
    option = rom 4000
    bios = rom 2000
    basic = rom 8000
    io = xt-ega-io
}

map 100000 {
    00000 = ram
    A0000 = ega
    C0000 = option
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
image option external sha256 bf1583dd387d6e078ab3f5039bcb3f7020a66a63d5f0e57039883c5081dbbf9c
```

## Power-on

The adapter BIOS tests more than video RAM. In its POD14 diagnostic it
counts 350 display-enable pulses between vertical retraces and measures the
frame interval against the system timer. It fills text cells with bright
blocks, selects three pairs of colour pins in the attribute controller,
and polls status bits 4 and 5 to see each pair turn on and off. Input status
and the monitor sample the same text pixels. Reading a status port advances
the attribute controller’s protocol but leaves the beam where it is.
[IBM EGA Technical Reference, input status registers and POD14 listing](https://www.minuszerodegrees.net/oa/OA%20-%20IBM%20Enhanced%20Graphics%20Adapter.pdf).

```machine
cpu 8088 {
    AX = 0000  BX = 0000  CX = 0000  DX = 0000
    SP = 0000  BP = 0000  SI = 0000  DI = 0000
    CS = 0000  DS = 0000  SS = 0000  ES = 0000  IP = 0000
    halted = false waiting = false interruptDeferred = false recognitionDeferred = false trapPending = false
    flags { CF = 0  PF = 0  AF = 0  ZF = 0  SF = 0  TF = 0  IF = 0  DF = 0  OF = 0 }
}
reset { cpu io ega }
```

## Display ports

The Miscellaneous Output register selects colour or monochrome CRTC ports.
Reading input status 1 resets the attribute index/data flip-flop. Writing the
sequencer and graphics controller changes which planes receive CPU stores.
In text mode, successive bytes at `B8000` select characters in plane 0 and
attributes in plane 1. To load its font, the BIOS temporarily switches the
window to `A0000` and enables plane 2 alone.

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
    out 3B4 = ega 3B4
    in 3B5 = ega 3B5
    out 3B5 = ega 3B5
    in 3BA = ega 3BA
    out 3C0 = ega 3C0
    out 3C1 = ega 3C1
    in 3C2 = ega 3C2
    out 3C2 = ega 3C2
    out 3C4 = ega 3C4
    out 3C5 = ega 3C5
    out 3CE = ega 3CE
    out 3CF = ega 3CF
    out 3D4 = ega 3D4
    in 3D5 = ega 3D5
    out 3D5 = ega 3D5
    in 3DA = ega 3DA
    out 3F2 = io F2
    in 3F4 = io F4
    in 3F5 = io F5
    out 3F5 = io F5
    unmapped = FF
}
```

## DOS text display

Mode 03h gives 80×25 cells, each eight dots across and fourteen scan lines tall.
The adapter BIOS copies its font from ROM offset `2230` into plane 2, reserving
32 bytes for each character. The CRTC supplies the start address, stride and
cursor position. A character and attribute select glyph dots and palette
entries. Six colour wires carry the resulting red, green and blue levels to
the Enhanced Color Display.

## Sixteen-colour graphics

In mode `0Dh`, each of the four planes contributes one bit to the colour of a
dot. Take pixel (0, 0): bit 7 of byte zero in planes 0 through 3 supplies its
four-bit palette index. The next dot uses bit 6 of the same four bytes. Forty
bytes span a 320-dot row. The CRTC supplies the display start and row stride,
so the CPU can draw at `A000:8000` while page zero is on screen. Reading video
RAM fills four latches at once. A masked store can keep some of those bits and
replace others. Reading the Memory panel leaves the latches alone.

The palette entry drives six wires on the card. In 200-line mode the 5154
monitor takes primary red, green and blue plus the secondary green wire for
intensity. Palette value `06h` consequently appears brown. The monitor selects
this wiring from the polarity of vertical sync. The same six wires give
independent two-bit RGB components in 350-line mode.
[IBM Enhanced Color Display technical reference, pages 3–6](https://minuszerodegrees.net/oa/OA%20-%20IBM%20Enhanced%20Color%20Display%20%285154%29.pdf).

### Try the colour bars

Build a bootable 360 KiB disk from the selected [DOS system disk](../../../docs/machines/pc-xt.md#firmware-and-media-identity):

```sh
node scripts/make-xt-ega-bars.ts "/path/to/DISK01.IMG" "/path/to/EGA-BARS.IMG"
```

In the EGA laboratory, insert this image and choose **Quick boot**.
`BARS.COM` asks INT 10h for the adapter type and memory size, sets mode
`0Dh`, loads a reversed palette, and selects page zero. It sets Graphics
Controller write mode 2 and fills the screen with pixel indices 0 through 15.
In this write mode each low-order bit of the CPU byte supplies a whole byte
of dots to its corresponding plane. The program alternates 12-row and 13-row
bands to cover all 200 rows. The first band appears white and the last black.
Click the screen and press a key to return to DOS in text mode.

The same BIOS calls let [Ultima V select its EGA driver and draw the title menu](../../../docs/machines/pc-xt-ultima-v.md#native-ega-title-menu).
In [Journey Onward](../../../docs/machines/pc-xt-ultima-v.md#one-ega-step-in-iolos-hut),
watch the game update its Y coordinate and see the sixteen-colour map scroll
when the party walks south.

## Model limits

The model rounds each scan line to an XT oscillator tick. Graphics scanout
covers the 320×200 planar configuration programmed by the IBM ROM, with a
single full-screen page and CRTC-controlled start and stride. Other graphics
modes, split screens, alternate monitors, light-pen capture, feature cards
and vertical-retrace interrupts are outside this profile. The Changes panel
observes conventional RAM.
