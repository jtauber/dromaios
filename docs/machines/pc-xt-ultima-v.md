# Ultima V on the IBM PC/XT

DOS can load *Ultima V: Warriors of Destiny* from a 360 KiB floppy on the
[native XT](pc-xt.md). On the CGA board, the game selects the four-colour driver. On the EGA board,
it selects the sixteen-colour driver. Both draw the title menu at 320 × 200. With a writable Player disk, **Journey Onward** resumes the party in
Iolo’s hut on both adapters. The EGA check follows its first south step.
The CGA session continues onto the outdoor map and saves the game. The pinned [dromaios-pc reference][reference] runs the same executable with EGA.

## Media

Use the 1988 DOS edition for the IBM PC, from the top-level game directory. The
audited archive also contains a later upgrade and a launcher that offers both
versions. These SHA-256 digests identify the selection independently of names.

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| Reference `disks/ultima5.img`, bootable NEC MS-DOS 3.30 repack | 1,474,560 | `347b8938749c077da59e80767936011287629721ad8eb3e41711b0b87ab5c6e9` |
| `ULTIMA.EXE` | 36,592 | `c75c1c6f37bf8ec45405df6d3bac0e626c780a706d48a88f92edb324ca1f3b3b` |
| `EGA.DRV` | 11,654 | `93f9c50d836d7abfb62ea14c51bbf9d86b9e4173ae31dd0ea585a742f4802604` |

For play, prepare the [Program and Player disks](#journey-onward). The two
earlier title-only images exercise these launch paths in the
[XT laboratory](../../src/machines/8088/pc-xt.md#using-the-laboratory).

- **Start automatically with `ULTIMA-BOOT.IMG`.** In **Drive A**, choose
  **Insert…**, select this image, then choose **Quick boot** under **Execution**.
  DOS displays `Starting Ultima V...` and runs the game from `AUTOEXEC.BAT`.
  Press Space during the Origin Systems logo to see the four-colour title
  menu in the Screen panel. The [native launch](#native-launch) traces the opening.
- **Start from DOS with `ULTIMA-LAUNCH.IMG`.** Boot the
  [Microsoft MS-DOS 3.30 system disk](pc-xt.md#firmware-and-media-identity)
  first. At `A>`, wait for the motor to stop, insert `ULTIMA-LAUNCH.IMG`,
  then type `ULTIMA` and press Enter. Booting this data disk directly
  transfers control to ROM BASIC.

The data disk contains these eleven files from a local installation in its
root directory. They total 138,222 bytes.

```text
ULTIMA.EXE   DATA.OVL    INTRO.OVL    EGA.DRV     CGA.DRV
IBM.CH       RUNES.CH    TITLE.BIT    BRITISH.BIT BRITISH.PTH
ULTIMA.16
```

All eleven matched the corresponding files on the reference image byte for
byte. The EGA run uses ten of them. The disk also includes the CGA driver so
the same executable can select a driver for the native XT. The audited 360 KiB
image has SHA-256 `ac357004a7a45c2c711229d43cd13253c5f010a3d16feaf95001b5adbe17592f`.
Directory order, timestamps and formatting can give another copy a different
image digest while retaining the same files.

The bootable image uses the Microsoft system disk's boot sector, `IO.SYS`,
`MSDOS.SYS`, and `COMMAND.COM`. It adds the same game files, the CGA title
asset `ULTIMA.4`, and the startup batch file. Its SHA-256 is
`163a8c08520cebcf4c10fc9e43ee0f3275dd49b74fb2429804081acddfc4e3cc`.

The October 19, 1988 retail listings distinguish two editions. The four-disk
360 KiB set places all eleven launch filenames on Disk 1 and `SAVED.GAM` on
Disk 2. Our `ULTIMA.EXE` and `DATA.OVL` sizes (36,592 and 48,464 bytes)
match the 3½-inch listing. The 5¼-inch listing gives 48,496 bytes for
`DATA.OVL`. Original disk images would be needed to establish byte identity.
[Retail directory listings][listings].

Origin's instructions call for the Program Disk to start and a writable copy
of Disk 2, the Player Disk, for play. Record those exchanges when testing a
saved game. [Origin's IBM reference card][origin].

## Reference launch

Boot the pinned `ultima5.img`, accept the DOS date and time defaults, and enter
`ULTIMA`. The audit supplied XT keyboard make/break codes and PIT ticks.
DOS handled INT 21h. The reference supplied the BIOS services in JavaScript.
Tracing at the software interrupt, port, and video-memory boundaries gave this
sequence. Starting again with `ULTIMA E`, Origin's explicit EGA selection,
also reached the menu.

| Guest action | Observed result |
| --- | --- |
| DOS executes `ULTIMA.EXE` | The game opens `DATA.OVL` and `INTRO.OVL`. |
| INT 10h, AH=`12`, BL=`10` | The reference reports a colour adapter with 256 KiB (BH=`00`, BL=`03`). The game opens `EGA.DRV` and queries the current mode with AH=`0F`. |
| INT 10h, AX=`000D`, then `1002` and `0500` | The driver requests 320 × 200 in 16 colours, loads the palette, and selects display page zero. The reference stubs the palette call. |
| Direct EGA programming | The driver sets Graphics Controller index 3 to `00`, Sequencer index 2 to `0F`, and Graphics Controller index 8 to `FF`. Its first video write clears a byte at `A000:8000`. |
| Opening animation | The game opens `IBM.CH`, `RUNES.CH`, `TITLE.BIT`, `BRITISH.BIT`, and `BRITISH.PTH`. It changes plane and bit masks and reads video memory as well as writing it. |
| Press Space during the opening | The game opens `ULTIMA.16` and draws a menu with **Journey Onward** selected. |

The animated flame and selection marker change between frames. To check a
native rendering, reconstruct one byte per pixel (plane 0 supplies bit 0),
left to right across each 320-pixel row, before palette lookup or scaling.
These two strips matched in nine consecutive samples of each launch. Rebuilding
the reference boot image with just the eleven listed game files also reproduced
both strips.

| Rows, inclusive | Visible content | SHA-256 of pixel indices |
| --- | --- | --- |
| 0–59 | Ultima V lettering | `3e6dbb8fe42ae4ba58f51c1d5c126bfb01b112032080aa5e81597a173668e324` |
| 128–199 | Menu choices and copyright | `dec3a7d5b6cee8381ccf5b37c0edbfeca79b1264e376afd92d3e2003e85c7ebc` |

## Native launch

Booting `ULTIMA-BOOT.IMG` through the original XT BIOS starts the game from
DOS. The instruction `83 E4 FE` at `0C6F:01B4` aligns the stack and advances
IP to `01B7`. The [8088 immediate group][immediate] handles this encoding for
all word registers and memory destinations.

| Checkpoint | What ran on the native XT |
| --- | --- |
| Driver selection | After opening `DATA.OVL` and `INTRO.OVL`, the game probes INT 10h with AH=`12`, BL=`10`, queries the video mode, and opens `CGA.DRV`. |
| Graphics setup | At `9E03:058F` the driver requests mode `04h`. It calls the BIOS palette service twice and selects page zero. The mode byte at physical `00449` reads `04`. |
| Opening assets | The game opens `IBM.CH`, `RUNES.CH`, `TITLE.BIT`, `BRITISH.BIT`, and `BRITISH.PTH`. |
| Driver XOR | At `9E03:12B0`, `2E 83 36 BC 0F 01` toggles the word at `CS:0FBC` from `0001` to `0000`. Execution continues at `9E03:12B6` after 33 modeled clocks. |
| First visible pixels | At `9E03:10BD`, STOSW writes `55h` at physical `BABB6`. The opening draws the Origin Systems logo followed by the animated “a Lord British production” signature. |
| Title menu | Press Space during the Origin logo to skip the opening. The game loads `ULTIMA.4` and draws **Ultima V: Warriors of Destiny** with **Journey Onward** highlighted. |

To check the CGA picture independently of the laboratory's graphics renderer,
read row `y` at `B8000 + (y % 2) × 2000h + floor(y / 2) × 80` (80 bytes
per row). Each byte holds four two-bit pixel indices, most significant pair first. For
this menu the display starts at offset zero and port `3D9` holds `20h`,
selecting black, cyan, magenta, and light grey. Hash one byte per pixel
before palette lookup. Both strips matched across cold boot and Quick boot.
Mapping the browser canvas's RGB colours back to these four indices reproduced
both hashes, including after saving and restoring the laboratory checkpoint.

| CGA menu rows, inclusive | SHA-256 of pixel indices |
| --- | --- |
| 0–59, title lettering | `b71e239084ae529a1a03e0579b596157b9f7c6fcf7939630a39e4e515283956d` |
| 128–199, choices and copyright | `3bbffd83042b0d0062a60f57bab4baddae4846a47689967b824b1264ed148550` |

Letting the opening play exercises more files than skipping to the menu.
On the audited boot disk, DOS returns file-not-found (carry set, AX=`0002`)
for `WD.BIT`. Adding that file from the original game directory to a separate
copy lets the driver draw the animated *Warriors of Destiny* subtitle. The
next missing file on that path is `FONT.OVL`.

Typing `ULTIMA E` forces a different path on the same XT. The game opens
`EGA.DRV` and issues INT 10h with AX=`000D`, `1002`, and `0500`, matching
the reference calls. The CGA board has no EGA planes at `A0000` to receive
the driver's drawing.

## Native EGA title menu

Build the EGA-capable Program disk with Node 24. Supply the same Microsoft
system disk and game directory used for the CGA disks, and a new output directory:

```sh
node scripts/make-ultima-v-disks.ts "/path/to/DISK01.IMG" "/path/to/ultima5" "./ultima-v-ega" --ega
```

`ULTIMA-EGA-PROGRAM.IMG` contains both drivers and both sets of Program
graphics. Its SHA-256 is `96c2f57494a8e552251ac16b85ea15c043f29ca4b4deb15b3e39ac1dee923b35`.
The builder also produces the [same Player disk](#journey-onward).

1. In **Firmware**, choose **EGA**. Load the XT BIOS, BASIC and IBM EGA option ROM.
2. Insert `ULTIMA-EGA-PROGRAM.IMG` in **Drive A**, choose **Fresh power-on**,
   then **Run**. DOS starts `ULTIMA` without a video override.
3. Click the screen and press Space during the Origin logo. The title menu
   appears with **Journey Onward** highlighted.

The game’s INT 10h query returned `BH=00`, `BL=03` (colour, 256 KiB).
It opened `EGA.DRV`, set mode `0Dh`, loaded the palette and selected page
zero. After the opening it read `ULTIMA.16`. Rows 0–59 and 128–199 of the
menu matched both [reference hashes](#reference-launch), including the
lettering, menu choices and copyright. The selector and flame animate
between those strips. Continue with the [disk exchange](#disk-exchange-in-the-laboratory)
to enter Iolo’s hut.

## Journey Onward

The [disk builder](../../scripts/make-ultima-v-disks.ts) takes the audited
MS-DOS 3.30 system disk and the extracted original game directory. Choose the
directory containing `ULTIMA.EXE`, `CGA.DRV` and `SAVED.GAM`. Run the
builder from the repository root with Node 24 and give it a new output directory.

```sh
node scripts/make-ultima-v-disks.ts "/path/to/DISK01.IMG" "/path/to/ultima5" "./ultima-v-disks"
```

| Local image | Contents | SHA-256 |
| --- | --- | --- |
| `ULTIMA-PROGRAM.IMG` | Bootable MS-DOS, startup batch file and 21 CGA Program files, including `FONT.OVL`, `WD.BIT` and `TILES.4` | `5ebb13692c5b41e71a4ee5006050d2cf4994e98c2b90e7a6711cde82eac800ce` |
| `ULTIMA-PLAYER.IMG` | The 41 filenames from the 360 KiB Disk 2 listing, including the local archive's existing Elwood save. 1 KiB free. | `135c06d4193b1f01062b27d0f884e2045d0ea0dec667e88b281f0ef466bc9b7a` |

These are FAT12 repacks. The [retail directory listing][listings] establishes
the disk split. The local installation supplies the game files. Origin's
[reference card][origin] calls for a writable copy of the Player disk.

### Disk exchange in the laboratory

1. Insert `ULTIMA-EGA-PROGRAM.IMG` in the EGA laboratory or `ULTIMA-PROGRAM.IMG`
   in the CGA laboratory. Choose **Quick boot**, press Space during the Origin
   logo, and pause at the title menu with **Journey Onward** highlighted.
2. In the **Debugger** tab, add a breakpoint at `0C6F:7249`. Choose **Run**,
   click the screen, and press Enter. For these images the breakpoint stops
   the game when DOS returns from its first failed open of `SAVED.GAM`. The
   return has carry set and `AX=0002` (file not found). This is the time to
   exchange disks. The empty playfield can appear while DOS is still reading
   the tiles from the Program disk.
3. Use **Insert writable copy…** for `ULTIMA-PLAYER.IMG` and remove the
   disk-exchange breakpoint. For the EGA check, set the [keyboard poll
   breakpoint](#one-ega-step-in-iolos-hut) before choosing **Run**. The
   game retries the open on drive A until DOS recognizes the Player disk.

### What the guest loads

| Player action | Observed DOS file activity |
| --- | --- |
| Select Journey Onward | The game reads all 30,414 bytes of `TILES.16` on EGA, or all 19,347 bytes of `TILES.4` on CGA, from the Program disk. DOS returns error 2 for `SAVED.GAM` until it recognizes the Player disk. |
| Resume the party | DOS reads 4,192 bytes from `SAVED.GAM` and 512 from `SAVED.OOL`. The game recreates `BRIT.OOL` and `UNDER.OOL`, writing 256 bytes to each. |
| Enter Iolo's hut | The game reads `TOWN.OVL` and the hut's 1,024-byte map from `DWELLING.DAT`. Elwood, Shamino and Iolo appear in the party panel. The first Down key on EGA loads all 4,912 bytes of `NPC.OVL` from the Player disk. |
| Open the south door | The O command loads `SJOG.OVL`. Down selects the door, and the next Down walks through it. |
| Leave for Britannia | The game opens `BRIT.DAT`, `OUTSUBS.OVL`, `BRIT.OOL` and `MAINOUT.OVL`, then reads the outdoor map from `BRIT.DAT`. |

### One EGA step in Iolo’s hut

1. Use `0C6F:1D6C` as the execution breakpoint after exchanging disks.
   When the game reaches this keyboard poll, the hut is drawn and the party
   panel shows Elwood, Shamino and Iolo. DOS read `SAVED.GAM` into
   `1BD3:55A6`. The live X and Y bytes at physical `215C6` and `215C7`
   both read `0F` (15).
2. Remove the execution breakpoint. Add a **RAM write watchpoint** at
   `215C7`, click the screen, press Down once, and run. The instruction at
   `0C6F:89EA` changes Y from `0F` to `10`. X stays `0F` and the location
   byte stays `0D` (Iolo’s hut).
3. Remove the watchpoint, add the `0C6F:1D6C` breakpoint again and choose **Run**. The command area reads **South**. The party is at (15,16)
   and the room has scrolled up one tile. On the 320×200 browser canvas,
   the 16×16 table tile at (112,88) appears at (112,72) after the step.

The [ROM-backed EGA test](../../tests/machines/8088/pc-xt/rom-ega.test.ts)
follows the Program disk’s tile reads, the failed save-file open, the Player
disk’s party record and the redrawn tile. Set `XT_BIOS_ROM`, `XT_BASIC_ROM`,
`XT_EGA_ROM`, `XT_ULTIMA_EGA_PROGRAM` and `XT_ULTIMA_PLAYER` to the audited
images. After building, run `node --test dist/tests/machines/8088/pc-xt/rom-ega.test.js`.

### From the hut to Britannia on CGA

The location, X and Y fields are at offsets `2EDh`, `2F0h` and `2F1h` of
the party record. In the CGA laboratory, Down and Up moved from (15,15) to
(15,16) and back. From (15,18), open the door to the south and
walk to the bottom edge. Take one more south step and answer Y to leave.
The game switches to location 0 at (45,62). From that state, Right moved to
(46,62) and redrew the map with **East** in the command area. The same run
without input kept (45,62). [Save record layout][save-format].

### Save, export, and resume

1. At (46,62) outdoors, click the Screen panel and press **Q**. Answer **Y** to
   the **Save game?** prompt. The game displays **Saving...** followed by **Done.**
2. Wait for **Motor off** in Drive A, then choose **Export disk image**.
   The laboratory downloads `ULTIMA-PLAYER-saved.img`. The original
   `ULTIMA-PLAYER.IMG` still starts in Iolo's hut.
3. Pause, insert `ULTIMA-PROGRAM.IMG`, choose **Fresh power-on**, then **Run**.
   Repeat the [disk exchange](#disk-exchange-in-the-laboratory) using a writable
   copy of the **exported** Player image. Journey Onward resumes Elwood, Shamino
   and Iolo on the outdoor map at (46,62). Left moves the party to (45,62).

During the save, DOS read 256 bytes each from `UNDER.OOL` and `BRIT.OOL`.
It recreated `SAVED.GAM` and `SAVED.OOL`, writing 4,192 and 512 bytes
respectively. Reading the FAT12 files from the download showed location 0,
X=46 and Y=62 in Elwood's party record. The object list contained `BRIT.OOL`
followed by `UNDER.OOL`. [Origin's Q command][origin].

The optional [cold-boot test](../../tests/machines/8088/pc-xt/rom-ultima-v.test.ts)
compares the full party record written by DOS with the one read on a second,
fresh XT. It checks the resumed coordinates and the next step. Set `XT_BIOS_ROM`,
`XT_BASIC_ROM`, `XT_ULTIMA_PROGRAM` and `XT_ULTIMA_PLAYER` to the local images.
After building, run `node --test dist/tests/machines/8088/pc-xt/rom-ultima-v.test.js`.

## Native EGA acceptance

1. **Start the adapter firmware.** Retain the XT board, 640 KiB RAM and 360 KiB
   drive. Fit one IBM EGA with 256 KiB display memory and an IBM Enhanced Color
   Display. Set XT system-board switches 5 and 6 on and adapter switches 1–4
   off/on/on/off. Bind the IBM 6277356 ROM dated 09/13/84 at `C0000–C3FFF`.
   Its 16,384 bytes start `55 AA 20`, sum to zero modulo 256, and have SHA-256
   `bf1583dd387d6e078ab3f5039bcb3f7020a66a63d5f0e57039883c5081dbbf9c`.
   Observe the original XT POST call `C000:0003`. The adapter code first reads
   ports `3DA` and `3BA`, writes `00` to `3C0`, and installs `C000:0CD7`
   as the INT 10h vector at physical `00040`. The acceptance run must then
   reach the DOS text prompt through that adapter. [IBM installation instructions][switches] · [PCjs ROM dump][rom].

   The [ROM-backed cold-boot test](../../tests/machines/8088/pc-xt/rom-ega.test.ts)
   reaches IBM’s successful raster diagnostic exit at `C000:0466` and the DOS
   boot sector at `0000:7C00`. After two Enters the screen reads `A>` in mode
   03h. The test compares both glyphs, dot for dot, against the option ROM’s
   8×14 table and runs `VER`. Set `XT_BIOS_ROM`, `XT_BASIC_ROM`, `XT_EGA_ROM`
   and `XT_DOS_DISK` to the selected images to repeat the check.

2. **Set mode 0Dh through INT 10h.** The [DOS colour-bar program](../../src/machines/8088/pc-xt-ega.md#try-the-colour-bars) and the game exercise the EGA
   information query and the three traced driver calls. The tests check the current
   mode in the BIOS data area at `0040:0049`, the selected page, and the palette programmed by the
   option ROM. These checks exercise firmware work that the reference performs
   in host code or skips. [IBM EGA technical reference][ega].
3. **Draw from guest memory.** [Device tests](../../tests/components/devices/ibm-ega.test.ts)
   exercise Sequencer map masks, rotation, masked writes through the read
   latches, and off-screen storage at offset `8000`. The [native game test](../../tests/machines/8088/pc-xt/rom-ega.test.ts)
   cold-boots with `XT_ULTIMA_EGA_PROGRAM` and the three firmware paths. It
   checks automatic driver selection and both title-menu strips. Party movement and a save followed by a
   fresh boot belong to the [playable-session milestone](pc-xt.md#5-ultima-v-on-the-xt).

[reference]: https://github.com/jtauber/dromaios-pc/tree/a6fb9d10f4274dbd8ba40400e0b6761aec1d4b54
[origin]: https://www.mocagh.org/origin/u5-refcard-ibm.pdf
[listings]: https://forum.winworldpc.com/discussion/8311/ibm-pc-tandy-1000-game-installation-file-listing-screenshot/p62#Comment_163559
[save-format]: https://wiki.ultimacodex.com/wiki/Ultima_V_internal_formats
[immediate]: ../../src/components/cpus/specifications/8088.md#immediate-operation-groups
[switches]: https://www.minuszerodegrees.net/ibm_ega/IBM%20EGA%20-%20Installation%20Instructions.pdf
[rom]: https://www.pcjs.org/machines/pcx86/ibm/video/ega/1984-09-13/IBM-EGA.json5
[ega]: https://minuszerodegrees.net/oa/OA%20-%20IBM%20Enhanced%20Graphics%20Adapter.pdf
