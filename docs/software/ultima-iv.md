# Ultima IV on the Apple II Plus

The [Apple II Plus](../../src/machines/6502/apple2.md) can cold-boot the selected
*Ultima IV* Boot disk, exchange it for Britannia, move the saved party on the
world map, visit Skara Brae, and save and resume through an exported disk. This acceptance follows
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
   checks an eastward step; the town round trip below also exercises the other directions.

The disk mode matters: **Fresh boot** restarts the machine; **Swap disk** preserves
the running program, RAM, clocks, and queued input. Swapping pauses execution until
Run. A laboratory saved state includes the replacement disk, so restoring a world
map checkpoint also restores its disk set, including the mounted Britannia disk.
Swapped-out disks retain their edits in the set. Export to keep individual disk
files outside the laboratory; a saved state keeps the whole set across reloads.
The opening can use read-only media; saving needs a writable copy.

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

## Visit Skara Brae and return

Start at the command boundary after resuming and taking the extra eastward step
above: `(235,233)`. In **Disk set**, select Britannia, choose **Make writable
copy**, then **Insert selected** with **Swap disk** active. Use **Add disks…**
to add `ultima_iv_town.dsk` without changing drive 1. Boot and any other inserted
disks already remain in the set. The supplied party has a prepared Gate spell
and Mariah can cast it. No character editing or injected game code is needed.

1. Press `C`, `1`, `G`, `7` at the successive prompts: Cast, player 1, Gate,
   phase 7. Do not press Return. The party arrives at `(23,126)`.
2. Move Left to `(22,126)`, then Down to `(22,128)`. Forest movement can print
   `Slow progress!` without moving; repeat the direction until the coordinate
   changes. Pause at `$40C0` between commands to avoid idle turns.
3. Press `E`. The game announces `SKARA BRAE` and asks for the **Towne disk**.
   Entry has already saved `TLST` onto the writable Britannia copy. Leave that
   copy in the set; it is the one to bring back on departure.
4. Select `ultima_iv_town.dsk` in **Disk set**, then **Insert selected**, Run,
   and press Escape. The town appears at local coordinates `(1,15)`, with
   location ID `$0B` at `$000A`. A saved state here retains both the Town disk
   and the unmounted Britannia copy with its temporary save.
5. Move Right along the central path to `(11,15)`. Press `T`, then Right Arrow.
   The game loads its conversation program and says `YOU MEET A SILVER ANKH.`
   At `Your interest:`, type `NAME` and Return. It identifies itself as the
   `ANKH OF SPIRITUALTY` (the spelling in this disk). Type `BYE` and Return.
6. Walk Left to `(0,15)`, then Left once more to leave. At the Britannia request,
   select the **same writable Britannia copy** in the set, **Insert selected**,
   Run, and press Escape. The party reappears at world coordinates `(22,128)`,
   location ID zero. No export or file re-import is needed for either swap.
7. Press `Q`, wait for the next command boundary with the motor off, and export
   again, for example as `ultima_iv_br-town-saved.dsk`. Fresh-boot the original
   Boot disk, select Journey onward, and supply this latest Britannia export.
   It resumes outside Skara Brae at `(22,128)`; Right moves to `(23,128)`.

The town visit retains all eight party members. Turns consume food, casting uses
spell resources, and character statistics can change through normal game rules;
“party retained” does not mean every roster byte stays frozen. The save/reload
check compares the complete saved party, roster, and object blocks before the
new game session starts modifying them.

### What the town exchange loads

`E` remembers the world position in `$0008,$0009`. Before requesting Town it
issues `BSAVE TLST,A$EE00,L$100` on Britannia. The 256-byte outdoor object list
occupies T20 S10 and S9, followed by a write to catalogue sector T17 S13.
On departure, `BLOAD TLST` restores that list and the remembered coordinates
replace the town coordinates. Reusing the original Britannia image would discard
this temporary save, even though the disk's identity check would still accept it.

Town supplies `MAPK`: six data sectors, T22 S6 through S1, containing a four-byte
binary header and a 1,280-byte payload. `BLOAD MAPK,A$8B00` overrides the header's
`$1000` load address. The game copies 1,024 map bytes into `$E800`–`$EBFF` and
256 object bytes into `$EE00`–`$EEFF`. These are Language Card RAM. Talking loads
`TALK,A$8800`: a 1,584-byte program from T33 S14 through S8. The acceptance checks
both complete payloads before executing them, then checks the conversation text
at the game's character-output routine.

| Stop | What to inspect |
| --- | --- |
| `$52AC` | `MAPK` has loaded at `$8B00`; the copy into Language Card RAM is next. |
| `$52CF` | Both the map and town objects have been copied. |
| `$5BC3` | `TALK` has loaded at `$8800`; the conversation program is next. |
| `$0AB5` | A game input routine, useful **after** entering a known command or conversation. It also serves other prompts. |
| `$467C` | On leaving town, `TLST` has been restored before the world position is reinstated. |

The Town catalogue itself is readable: it contains 46 files. The inspector's
`T134 S219` warning belongs specifically to `MIX`'s track/sector list at T34 S15,
where unused slots from offset `$60` contain nonzero data. Its first three pairs
correctly point to T34 S14, S13, and S12. The binary header declares `$0230` bytes
(560), so the game's loader finishes before reaching those invalid entries.
The acceptance additionally presses `M` in town, checks all 560 loaded bytes at
`$8800`, then cancels with Escape without mixing reagents. The generic inspector
continues reporting the malformed list rather than silently treating arbitrary
bad pointers as valid. This establishes this file's bounded load, not a claim
that every sector on Town is well formed.

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
and takes another eastward step. With Town supplied, it continues through Gate,
entry, movement, conversation, departure, and a second save and cold boot. It
checks the town's loaded bytes, temporary outdoor list, printed responses,
coordinates, and retained party. While in town it serializes and restores the
complete disk set, checks Britannia's unmounted edits, and reinserts that retained
medium for departure. Town scenes include animated objects, so their
acceptance uses these contracts rather than a whole-landscape digest.
No game bytes are patched or injected into RAM.
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
    "terrainSha256": "b4c5f13b9e31ab1896e96a1d6802caf96cbb74439a424cf8dd419af1b3402925" },
  "town": {
    "image": { "bytes": 143360, "sha256": "4533e08c1d3d8ad4fbd4f4f746838f3b2555bf629568695fdce93c14a1884801" },
    "stops": {
      "cast": { "address": 18562, "bytes": [32, 33, 8] },
      "input": { "address": 2741, "bytes": [169, 128, 141, 219, 10] },
      "mapLoaded": { "address": 21164, "bytes": [162, 0] },
      "mapCopied": { "address": 21199, "bytes": [169, 2] },
      "mix": { "address": 22341, "bytes": [32, 11, 99] },
      "mixLoaded": { "address": 22388, "bytes": [32, 0, 136] },
      "talk": { "address": 23275, "bytes": [32, 33, 8] },
      "talkLoaded": { "address": 23491, "bytes": [32, 0, 136] },
      "listLoaded": { "address": 18044, "bytes": [165, 8] },
      "print": { "address": 4009, "bytes": [201, 141, 240] }
    },
    "gate": { "name": "Phase 7 gate", "x": 23, "y": 126 },
    "outside": { "name": "Outside Skara Brae", "x": 22, "y": 128 },
    "entrance": { "name": "Skara Brae entrance", "x": 1, "y": 15 },
    "conversation": { "name": "Beside the silver ankh", "x": 11, "y": 15 },
    "location": 11,
    "greeting": "YOU MEET\rA SILVER ANKH.",
    "answer": "IT SAYS: I AM\rTHE ANKH OF\rSPIRITUALTY",
    "farewell": "IT SAYS: BYE.",
    "resumed": { "name": "Resumed outside Skara Brae", "x": 22, "y": 128 },
    "continuation": { "name": "East after the town round trip", "x": 23, "y": 128 }
  }
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

The pinned reference also executes the Gate route, Skara Brae entry, the silver
ankh conversation, and the return to the same world coordinates. Its disk model
cannot persist the temporary `TLST` write, so the native acceptance owns that
round-trip check. The final native Britannia export is independently loaded by
the reference: it resumes at `(22,128)` and moves east to `(23,128)`.

The browser check starts from the verified `(235,233)` checkpoint and uses the
laboratory's keyboard, disk-set selection, writable-copy, checkpoint, and export
controls. It restores the set while Town is mounted and reinserts the retained
Britannia copy on departure. The final browser download matches every byte of
the native export. The native test then supplies
that disk to a new machine, booted from reset, and verifies the saved blocks and
another move.

To run the optional local-media check after a current build:

```sh
APPLE2_ROM=media/apple2/apple2p.rom \
APPLE2_ULTIMA_IV_BOOT=media/apple2/reference/ultima_iv_boot.dsk \
APPLE2_ULTIMA_IV_BRITANNIA=media/apple2/reference/ultima_iv_br.dsk \
APPLE2_ULTIMA_IV_TOWN=media/apple2/reference/ultima_iv_town.dsk \
node --test dist/tests/site/apple2-ultima-iv.test.js
```

Set `APPLE2_ULTIMA_IV_CHECKPOINTS` to an ignored local directory to retain the
verified checkpoints and the initial, town-entry, and final Britannia exports for
browser experiments. Omit `APPLE2_ULTIMA_IV_TOWN` to run only the earlier
Boot/Britannia save path. These artifacts
contain private media bytes and must not be published.

## Still to establish

This pass covers Boot/Britannia/Town exchange, Skara Brae's entrance and one
conversation, the return to Britannia, and saving and resuming the supplied party.
Character creation, other towns and conversations, dungeon entry and Underworld,
sound expansion hardware, and a complete playthrough remain unverified. The
machine chapter's disk, timing, display, and audio limitations continue to apply.
