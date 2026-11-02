# Ultima V on the IBM PC/XT

DOS can load *Ultima V: Warriors of Destiny* from a 360 KiB floppy on the
[native XT](pc-xt.md). The first obstacle is in the game's startup code, before
it probes the display. On the pinned [dromaios-pc reference][reference], the
same executable reaches the title and main menu. The two runs give us separate
checks for loading the program and drawing its first interactive screen.

## Media

Use the 1988 DOS edition for the IBM PC, from the top-level game directory. The
audited archive also contains a later upgrade and a launcher that offers both
versions. These SHA-256 digests identify the selection independently of names.

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| Reference `disks/ultima5.img`, bootable NEC MS-DOS 3.30 repack | 1,474,560 | `347b8938749c077da59e80767936011287629721ad8eb3e41711b0b87ab5c6e9` |
| `ULTIMA.EXE` | 36,592 | `c75c1c6f37bf8ec45405df6d3bac0e626c780a706d48a88f92edb324ca1f3b3b` |
| `EGA.DRV` | 11,654 | `93f9c50d836d7abfb62ea14c51bbf9d86b9e4173ae31dd0ea585a742f4802604` |

The audit uses two locally prepared 360 KiB images. Choose one of these
procedures in the [XT laboratory](../../src/machines/8088/pc-xt.md#using-the-laboratory).

- **Start automatically with `ULTIMA-BOOT.IMG`.** In **Drive A**, choose
  **Insert…**, select this image, then choose **Quick boot** under **Execution**.
  DOS displays `Starting Ultima V...` and runs the game from `AUTOEXEC.BAT`.
  The native XT currently [stops during startup](#native-launch).
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
we can observe the native machine's automatic choice. The audited 360 KiB
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

The native run resumed a DOS prompt reached through the original XT BIOS,
exchanged disks in drive A, and typed the command through IRQ1. DOS executed
`A:\ULTIMA.EXE` and the game opened `DATA.OVL`. Both `ULTIMA` and `ULTIMA E`
stopped at `0C6B:01B4` (physical `0C864` in this session). The bytes there
are `83 E4 FE`, or `AND SP,FFFEh`, which aligns the stack to an even address.

An independent cold boot with the same disk exchange reached the same address
and bytes. On a cold boot of `ULTIMA-BOOT.IMG`, DOS ran `ULTIMA.EXE`
automatically and the game opened `DATA.OVL`. The executable loaded four
paragraphs higher and reached the same instruction at `0C6F:01B4`.
Timed execution reports that instruction timing is unavailable, and ordinary
single-step reports the instruction as unsupported. The underlying
issue is the [8088 immediate-group definition][immediate]: it rejects the
`83 /4` selector, following Intel's 1979 encoding table. The pinned
[hardware fixtures][and-fixtures] include 138 unprefixed `83 E4 ib` cases.
Their resulting SP values all match an AND with the sign-extended immediate.
Cover that behavior in ordinary and timed execution, then rerun the same disk
exchange to locate the game's display probe.

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
2. **Set mode 0Dh through INT 10h.** From DOS, exercise the EGA information
   query and the three traced driver calls. Check the BIOS data area's current
   mode at `0040:0049`, the selected page, and the palette programmed by the
   option ROM. These checks exercise firmware work that the reference performs
   in host code or skips. [IBM EGA technical reference][ega].
3. **Draw from guest memory.** Check Sequencer map masks, Graphics Controller
   data rotation and bit masks, and preservation of unmasked bits through the
   read latches. Exercise off-screen writes at offset `8000` independently of
   visible page zero. Then launch with automatic detection, press Space, and
   compare the two menu strips above. Party movement and a save followed by a
   fresh boot belong to the [playable-session milestone](pc-xt.md#5-ultima-v-on-the-xt).

[reference]: https://github.com/jtauber/dromaios-pc/tree/a6fb9d10f4274dbd8ba40400e0b6761aec1d4b54
[origin]: https://www.mocagh.org/origin/u5-refcard-ibm.pdf
[listings]: https://forum.winworldpc.com/discussion/8311/ibm-pc-tandy-1000-game-installation-file-listing-screenshot/p62#Comment_163559
[immediate]: ../../src/components/cpus/specifications/8088.md#immediate-operation-groups
[and-fixtures]: https://github.com/SingleStepTests/8088/blob/aea84484abc79d09639d855b7b0ab32bc9e4dbeb/v2/83.4.json.gz
[switches]: https://www.minuszerodegrees.net/ibm_ega/IBM%20EGA%20-%20Installation%20Instructions.pdf
[rom]: https://www.pcjs.org/machines/pcx86/ibm/video/ega/1984-09-13/IBM-EGA.json5
[ega]: https://minuszerodegrees.net/oa/OA%20-%20IBM%20Enhanced%20Graphics%20Adapter.pdf
