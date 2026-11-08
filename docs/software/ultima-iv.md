# Ultima IV on the Apple II Plus

The [Apple II Plus](../../src/machines/6502/apple2.md) can cold-boot the selected
*Ultima IV* Boot disk, exchange it for Britannia, move the saved party on the
world map, and save and resume through an exported disk. This acceptance follows
**Journey onward** with the existing party; it does not create a character or
establish a complete playthrough.

## Start in the laboratory

1. Load the 20 KiB `apple2p.rom` container in **ROM**. It supplies the motherboard
   firmware and slot-6 bootstrap; the machine chapter owns their verified identities.
2. In **Disk**, select **Fresh boot**, then **Insert read-only…** and choose
   `ultima_iv_boot.dsk`. Select **Unlimited** and **Run**. For loading, turn off
   **Record changes** and the inspectors' **Live** switches. The CPU still executes
   every instruction and disk wait. The copyright screen can remain visible while
   the game loads; it is not an input prompt.
3. Once the animated title appears, press Space on the screen with **Inspect** off.
   The menu includes `JOURNEY ONWARD`. Press `J` without Return.
4. Wait for `PLEASE PLACE THE BRITANNIA DISK INTO DRIVE 1 AND PRESS [ESC]`.
   Pause, select **Swap disk**, then **Insert read-only…** and choose
   `ultima_iv_br.dsk`. Choose **Run**, click the screen, and press Escape.
5. The world map appears with Mariah's existing eight-member party. Right Arrow
   moves east: the party's coordinates change from `(233,233)` to `(234,233)`.
   Left, Up, and Down Arrow also deliver the game's movement keys; this acceptance
   checks one eastward step.

The disk mode matters: **Fresh boot** restarts the machine; **Swap disk** preserves
the running program, RAM, clocks, and queued input. Swapping pauses execution until
Run. A laboratory saved state includes the replacement disk, so restoring a world
map checkpoint also restores Britannia. Export an edited writable disk before
replacing it. The opening can use read-only media; saving needs a writable copy.

## Follow the disk exchange

The Boot disk loads the title, menu, game code, and graphics. Its DOS catalogue
uses nonprinting characters in several filenames; the catalogue inspector displays
these as dots. The Britannia disk supplies the saved party and world data. Its
`PRTY` binary file loads 32 bytes at `$0000`; the first two bytes are the party's
world X and Y coordinates, initially `$E9,$E9` in this image.

These manual Disassembly stops belong to this exact build, after the relevant
code has loaded. They are not ROM labels or valid throughout startup.

| Stop | What happens next |
| --- | --- |
| `$6246` | The title checks the keyboard with `BIT $C000`. Space opens the menu. |
| `$6B06` | The menu reads a choice with `LDA $C000`. `J` selects Journey onward. |
| `$18C6` | The disk prompt calls `$0AB5` to wait for a key. It accepts Escape, then loads and checks the inserted disk's identity. |
| `$40C0` | The world map has finished drawing. `JSR $0800` waits for the next player command. |

Use a persistent breakpoint at `$40C0` when loading Britannia: the disk load can
exceed the laboratory's bounded Run-to budget. A byte watch at `$0000` shows X;
`$0001` shows Y. Right Arrow delivers `$15`, and the game increments X and redraws
the scrolling map before returning to `$40C0`.

The low-level keyboard poll at `$150C` is **not** a reliable command boundary.
Rendering also calls it, buffering up to eight keys at `$00B0`–`$00B7`, with a
count at `$00B8`. Stopping on that poll can leave a partly drawn screen or a move
still queued inside the game. The command loop also has an idle timeout; leaving
it running can advance turns without a movement key. Pause at `$40C0` for repeatable
experiments, and save a state there before trying a move.

## Save the party and resume after a cold boot

At the command prompt after the first eastward move, pause and choose **Swap disk**
and **Insert writable copy…** with the original `ultima_iv_br.dsk`. The mounted
copy gains write permission while the running party stays at `(234,233)`.
This replacement is safe for this opening because no game writes have happened
yet. For later sessions, use your most recent exported disk rather than replacing
saved progress with the original image.

Press `Q` on the screen without Return, then Run if paused. The game prints
`Quit & save...` and its move count. Wait until drive 1 reports **motor off**
and the next command prompt appears, then pause and **Export disk image**.
Despite the command's name, this build returns to its command loop after saving;
it does not stop the CPU. A breakpoint at `$40C0` stops it before idle turns resume.

Choose **Fresh boot** and insert `ultima_iv_boot.dsk` read-only. Pass through the
title and select Journey onward again. At the Britannia request, **Swap disk**
to the exported `ultima_iv_br-saved.dsk`, also read-only, and press Escape.
The party resumes at `(234,233)`. Right Arrow moves it to `(235,233)`.
This is a real boot from the saved disk bytes, with no restored laboratory state.

The world is redrawn around the restored party. The scrolling viewport from the
previous session is not itself saved, so the terrain framing can differ from the
screen immediately after the original eastward move.

## Follow the saved bytes

The command handler at `$58E7` prints the save message. After checking that the
party is on the world map and selecting Britannia, `$590E` calls `$081B` to issue
three DOS commands. Each starts with Ctrl-D and ends with Return:

```text
BSAVE LIST,A$EE00,L$100
BSAVE ROST,A$EC00,L$200
BSAVE PRTY,A$0,L$20
```

`LIST` and `ROST` live in the Language Card's common upper RAM, not motherboard
ROM. `ROST` contains the character records, including Mariah's name. `PRTY`
holds the 32-byte party block in zero page. These files already exist, so DOS
reuses their sectors and rewrites the unchanged catalogue entry after each save.
Track and sector numbers below are decimal; byte offsets are hexadecimal.

| File | Declared payload | DOS data sectors, in order | Payload offsets in the export |
| --- | --- | --- | --- |
| `LIST` | `$EE00`–`$EEFF`, 256 bytes | T20 S7, T20 S6 | `$14704`–`$147FF`, `$14600`–`$14603` |
| `ROST` | `$EC00`–`$EDFF`, 512 bytes | T20 S4, T20 S3, T20 S2 | `$14404`–`$144FF`, `$14300`–`$143FF`, `$14200`–`$14203` |
| `PRTY` | `$0000`–`$001F`, 32 bytes | T20 S0 | `$14004`–`$14023` |

Each file's first four bytes hold its load address and length, low byte first.
The coordinate bytes are at exported offsets `$14004` and `$14005`: `$EA,$E9`
after the move. Catalogue sector T17 S13 is written after each file, giving nine
accepted sector writes in total. The track/sector lists and allocation map are
unchanged.

This disk's DOS save loop copies **one extra byte** after each declared payload.
The source read at `$ACC7` precedes the count check at `$B1AD`; when the count is
already zero, the byte has still been copied. The extra bytes come from `$EF00`,
`$EE00`, and `$0020`, and occupy padding at `$14604`, `$14204`, and `$14024`.
All three are zero in this run. The first replaces an existing `01`; the other
two were already zero. Dromaios preserves this guest behavior. The acceptance
compares all 803 source bytes and the entire exported disk, including the padding,
rather than assuming only the declared 800 payload bytes can change.

Pause at these additional manual Disassembly stops to inspect the save and reload:

| Stop | What to inspect |
| --- | --- |
| `$590E` | All three source blocks before the DOS commands. |
| `$ACC7` | DOS reads the next source byte with `LDA ($42),Y`. This serves other DOS transfers too. |
| `$5959` | All three BSAVEs have returned; the file writes are complete. |
| `$4047` | On a fresh Journey onward, BLOAD has restored all 32 `PRTY` bytes. |
| `$408D` | `LIST` and `ROST` have also been restored, before game initialization modifies the loaded state. |
| `$40C0` | The restored world is ready for another command. |

## Acceptance and independent comparison

The [native session check](../../tests/site/apple2-ultima-iv.test.ts) consumes this
record. It runs the original ROM and disk code from reset through each stop,
exchanges disks without resetting hardware, checks the world coordinates and
graphics, and repeats the move from a serialized checkpoint with identical final
hardware and input state. It then checks the complete disk changes from saving,
cold-boots the export, verifies all three reloaded blocks before game initialization,
and takes another eastward step. No game bytes are patched or injected into RAM.
Numbers in the record are decimal; addresses in the prose are hexadecimal.

The selected images came from the maintainer's local dromaios-apple2 media
collection. They are DOS-order sector images, not captures of protected tracks.
The repository contains neither the images nor extracted game files.

```json
{
  "boot": { "bytes": 143360, "sha256": "b40522822a84e8ff58f70a44fba7c5a2b100eb3464c37d5ed4b8449214dded98" },
  "britannia": { "bytes": 143360, "sha256": "90b1a65ce90356d8b8adb34d8d37e65e5c2fdda72cb7b5e603c3930ff9a33653" },
  "stops": {
    "title": { "address": 25158, "bytes": [44, 0, 192, 48, 11] },
    "menu": { "address": 27398, "bytes": [173, 0, 192, 16, 233] },
    "exchange": { "address": 6342, "bytes": [32, 181, 10, 201, 155, 208, 249] },
    "command": { "address": 16576, "bytes": [32, 0, 8, 201, 0, 208, 3] }
  },
  "terrain": { "x": 7, "y": 8, "width": 154, "height": 80 },
  "scenes": [
    { "name": "Britannia", "x": 233, "y": 233,
      "terrainSha256": "f9479accce36fc03a1e8d77997dc1cefc8041765f9700e13ad7054b3eba7d46c" },
    { "name": "East", "x": 234, "y": 233,
      "terrainSha256": "3b2cca708c7915b3f9a0ecff1df34db5f181db09c88e80f462151eebdcd474ef" }
  ],
  "save": {
    "start": { "address": 22798, "bytes": [32, 27, 8] },
    "returned": { "address": 22873, "bytes": [169, 1, 32, 32, 3] },
    "partyLoaded": { "address": 16455, "bytes": [165, 15, 208, 24] },
    "rosterLoaded": { "address": 16525, "bytes": [169, 0, 133, 13] },
    "files": [
      { "name": "LIST", "address": 60928, "bytes": 256, "track": 20, "sectors": [7, 6] },
      { "name": "ROST", "address": 60416, "bytes": 512, "track": 20, "sectors": [4, 3, 2] },
      { "name": "PRTY", "address": 0, "bytes": 32, "track": 20, "sectors": [0] }
    ]
  },
  "resumed": { "name": "Resumed Britannia", "x": 234, "y": 233,
    "terrainSha256": "499eca180bbe8dfaf17b1e792c91595cd65e2d1b703974b91b7ca47eed59c423" },
  "continuation": { "name": "East after resuming", "x": 235, "y": 233,
    "terrainSha256": "b4c5f13b9e31ab1896e96a1d6802caf96cbb74439a424cf8dd419af1b3402925" }
}
```

The terrain digests were obtained by independently executing both disks with
the older emulator, then decoding its high-resolution RAM using the Apple II
address equations. They describe row-major bytes of `0` or `1` in the stated
rectangle. This region checks the scrolling landscape while excluding the
animated party tile and status values affected by idle timing. The native
renderer must display those same dots. The native checkpoint replay compares
the entire machine, including all screen RAM, rather than just this rectangle.

The reference audit used the external-drive backup's unmodified `cpu.js`,
`apple2.js`, `disk.js`, and `nibble.js` with a DOM-free runner. It invoked the
reference's controller reset and frame-based motor updates. The backup has no
Git metadata, so it is identified by these source digests rather than assigned
the commit recorded in the earlier general machine audit:

| Reference file | SHA-256 |
| --- | --- |
| `cpu.js` | `ff1fca74e0a2cc23ee8e9b80b688c4f260cb9b5b6f6abc880b439d6e50169702` |
| `apple2.js` | `6e42471c08821f664e0c1fb7c7495292b60421968f1f2b88a63f098925578b5c` |
| `disk.js` | `668fa3fa41182d63af8cce297d1480f84fae23ed08d9ab2004dc216bf5b7c581` |
| `nibble.js` | `6d3e677498238a3d597567b6a381f5410d64efcb098da5ac7b636708c4b46308` |

Both implementations reached the same disk request and coordinates and drew the
same checked terrain before and after moving. The reference advances disk bytes
on reads; Dromaios uses elapsed CPU clocks. This comparison establishes the
software path and graphics, not equal boot timings or physical-drive accuracy.

The exported disk was also independently cold-booted with
[dromaios-apple2 v0.2.0](https://github.com/jtauber/dromaios-apple2/tree/569baf98006f61e80ed93c36aa4f8d9ae23011d3).
Its original Boot disk loaded the new Britannia bytes, resumed at `(234,233)`,
and moved east to `(235,233)`. The two resumed-scene digests come from that run.
This pinned reference does not persist Disk II writes, so it checks the exported
disk's readability and resumed execution; it is not the oracle for saving.
The save check instead follows the original DOS instructions, source reads,
binary headers, sector writes, and the exact exported bytes.

To run the optional local-media check after a current build:

```sh
APPLE2_ROM=media/apple2/apple2p.rom \
APPLE2_ULTIMA_IV_BOOT=media/apple2/reference/ultima_iv_boot.dsk \
APPLE2_ULTIMA_IV_BRITANNIA=media/apple2/reference/ultima_iv_br.dsk \
node --test dist/tests/site/apple2-ultima-iv.test.js
```

Set `APPLE2_ULTIMA_IV_CHECKPOINTS` to an ignored local directory to retain the
verified checkpoints and `ultima_iv_br-saved.dsk` for browser experiments. These
contain private media bytes and must not be published.

## Still to establish

This pass covers the Boot/Britannia exchange, movement with the supplied party,
and saving and resuming it after a cold boot. Character creation, town and
dungeon entry, further exchanges, sound expansion hardware, and a complete
playthrough remain unverified. The local Town and Underworld images are inventoried
but not accepted here. In particular, the generic DOS catalogue reader encounters
an out-of-range sector pointer on the Town image; this alone does not establish
whether the game's own loader can use it. The machine chapter's disk, timing,
display, and audio limitations continue to apply.
