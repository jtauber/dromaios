# Mystery House on the Apple II Plus

The [Apple II Plus](../../src/machines/6502/apple2.md) can cold-boot the selected
*Mystery House* disk, display its opening rooms, and save and restore a game
through the original game, ROM, and DOS code. This guide follows the journey
from the front yard to the entry hall, saves there, and resumes from an exported
disk after a fresh boot. It establishes this opening session and save path,
not a complete playthrough or compatibility with every release.

## Select the disk

Use a 143,360-byte DOS-order image matching the digest in the acceptance record
below. The audited `mystery-house.dsk` came from the local `mystery-house-book`
project. That project's disk audit traces this copy to CARC's mirror of
`images/games/adventure/mystery_house.dsk` on Asimov. Names alone do not identify
the version: the same project also has a different, damaged compilation build.

The selected disk's own `MYSTERY.HELLO` notice credits Ken and Roberta Williams,
dates the original game to 1980, and describes Sierra's 1987 public-domain
release. Its startup includes The Public Domain Exchange splash screen.
These observations identify this copy; it is not an original protected disk.
The repository does not include the disk, firmware, or extracted game files.

This session uses the existing machine: a 6502, RAM, Applesoft/Autostart ROM,
keyboard, page-one high-resolution graphics with four text rows, and slot-6
Disk II with one drive. DOS reads the game, messages, and pictures
from ordinary sectors. The first session needs neither another peripheral nor
a software-specific execution shortcut. The machine's declared disk and video
limitations still apply.

## Start in the laboratory

1. Load the 20 KiB `apple2p.rom` container in **ROM**. It supplies both the
   motherboard firmware and the slot-6 bootstrap; the machine chapter owns
   their [verified identities](../../src/machines/6502/apple2.md#firmware-supplied-by-the-caller).
2. In **Disk**, select **Fresh boot**, choose **Insert writable copy…**, and select `mystery-house.dsk`.
   Insertion prepares a fresh, paused machine. Choose **Unlimited**, then **Run**.
   The writable copy is held in the laboratory; the source file is untouched.
   **Insert read-only…** also works if you only want to explore the opening.
3. Wait for the full notice ending in `PLAYED IT.`. The initial splash and
   BASIC delay loops are part of this disk's startup. Click the screen with
   **Inspect** off, then press Space. The graphical title asks
   `ENTER G FOR GAME OR I FOR INSTRUCTIONS`.
4. Type `G` and press Return. Let DOS load the game and its first picture.
   The front yard appears above `ENTER COMMAND?`.
5. Enter `GO STAIRS`, `OPEN DOOR`, and `GO DOOR`, pressing Return after each
   and waiting for the next command prompt. The porch's closed door opens;
   entering it draws the hall and its seven people. The text reports that the
   door has been closed and locked.

The first move is `GO STAIRS`, not `GO PORCH`: the game's rules distinguish
these words even though the destination is the porch. Empty Return toggles
the game's text/graphics view; use it to read text that has scrolled out of the
four-row mixed display. **Monochrome** makes the line drawings easier to inspect.

For loading, you can pause **Record changes** in Changes and the inspectors'
**Live** updates. Unlimited still runs through every instruction and disk wait;
recording millions of polling-loop changes adds host work. Turn recording back
on when following a routine. Pausing the CPU refreshes the inspectors even when
their Live switches are off.

## From disk files to execution

| Stage | Guest behavior | Where to look |
| --- | --- | --- |
| `HELLO` | DOS starts an Applesoft program that animates the distributor's splash, then issues `RUN MYSTERY.HELLO`. | Disk's catalogue and Applesoft Listing. |
| `MYSTERY.HELLO` | `BLOAD AUTO LOAD OBJ` fills `$0FFD`–`$3FFF`. After the notice's keypress, `CALL 4096-3` enters `$0FFD`. | Disassembly at `$0FFD`; Memory at `$2000` contains the title picture. |
| Title menu | Machine code selects mixed high-resolution graphics and calls ROM `GETLN1` at `$FD6F`. `G` selects `PLAY` at `$1B7B`, which issues `BRUN ADVENTURE`. | At `$1046`, `JSR $FD6F` is about to read the menu choice. |
| `ADVENTURE` | DOS loads 29,952 bytes at `$0800`–`$7CFF`, then enters `$0800`. Initialization opens `MESSAGES` and loads `STARTUP`. | The entry resets SP, then jumps to `$5E00`; initialization begins at `$6100`. |
| First room | The game loads picture blocks into its cache, draws the yard, and reads its description through DOS. | `SHOWROOM` at `$7900`; `CURONO` at `$0852` is `01`. |
| Command input | `TURN` at `$6300` prints the prompt; `$63DF` calls ROM `GETLN` at `$FD6A`. | Add byte watches for `$0852` (room), `$0839` (picture), and a word watch for `$0853` (turn, low byte first). |

These addresses belong to this game build. They are useful manual Disassembly
stops after the relevant file has loaded, not globally valid ROM annotations.
For example, `$0800` is also used by disk boot code before `ADVENTURE` arrives.
The acceptance check verifies the entire loaded title and game binaries before
treating either entry address as a software checkpoint.

## Repeat an experiment

Pause at the first yard prompt and save a state named **Mystery House — yard**.
Resume and enter `GO STAIRS`: room changes from `01` to `02`, turn from `0001`
to `0002`, and picture from `03` to `01`. Restore the saved state and repeat
the command. It should reproduce the porch and its text.

The checkpoint includes the CPU, physical RAM banks, keyboard queue, video,
speaker, CPU clock, and the mounted disk with its rotational phase and write
permission. It is a laboratory checkpoint, distinct from the game's `SAVE GAME`
command below. Later puzzles, winning, and alternate disk versions remain
outside this acceptance pass.

## Save a game and resume after a fresh boot

At the hall prompt, enter `SAVE GAME` and wait for the next `ENTER COMMAND?`.
Pause, then use **Export disk image** in Disk to download the edited image. Insert
that exported image with **Fresh boot** and **Insert read-only…**: insertion starts a new machine,
so wait through the notice and title again and enter `G`.

The game starts in the front yard as usual. Enter `RESTORE GAME`. The hall and
its seven people return, with room `03`, picture `35`, and turn `0005` in the
hexadecimal memory display. Enter `EAST`: the library appears, room becomes
`0E`, picture `06`, and turn `0006`. Restoring and this next move require no
writes, so the exported disk can remain read-only. To save again, insert it as
a writable copy before booting.

Saving captures turn `0004`. Both finishing `SAVE GAME` and finishing
`RESTORE GAME` advance the game to the next prompt, at turn `0005`. Restoration
does not resume an entire machine: DOS loads the saved game workspace into an
already running game, which then clears its picture cache and redraws the room.

## Follow the saved bytes

The save action at `$66B2` prints a DOS command with a leading Ctrl-D:
`BSAVE SAVED GAME,A$830,L$8CF`. DOS saves 2,255 bytes from `$0830`–`$10FE`,
including the current room, turn, switches, objects, and room data. Its binary
file has a four-byte header, `30 08 CF 08`: load address and length, each with
its low byte first. Saving replaces the existing unlocked `SAVED GAME` file.

In Disk's catalogue, select `SAVED GAME`. Its entry is at track 17, sector 12,
offset `$51`; it points to the track/sector list at track 7, sector 14. Nine
data sectors follow. Track and sector numbers here are decimal DOS-order
indices; `.dsk` offsets and RAM addresses are hexadecimal.

| File sector | Disk sector | Payload in exported `.dsk` | Game RAM |
| --- | --- | --- | --- |
| 0 | T7 S13 | `$7D04`–`$7DFF` (after the header) | `$0830`–`$092B` |
| 1 | T7 S12 | `$7C00`–`$7CFF` | `$092C`–`$0A2B` |
| 2 | T7 S11 | `$7B00`–`$7BFF` | `$0A2C`–`$0B2B` |
| 3 | T7 S10 | `$7A00`–`$7AFF` | `$0B2C`–`$0C2B` |
| 4 | T7 S9 | `$7900`–`$79FF` | `$0C2C`–`$0D2B` |
| 5 | T7 S8 | `$7800`–`$78FF` | `$0D2C`–`$0E2B` |
| 6 | T7 S7 | `$7700`–`$77FF` | `$0E2C`–`$0F2B` |
| 7 | T7 S6 | `$7600`–`$76FF` | `$0F2C`–`$102B` |
| 8 | T7 S5 | `$7500`–`$75D2` | `$102C`–`$10FE` |

During this save, DOS reads every payload byte at `$ACCF`, writes these nine
sectors in order, and rewrites the catalogue sector. The catalogue bytes are
unchanged because the existing file keeps its location, type, and length.
All bytes outside the saved payload, including the last sector's unused tail,
remain unchanged in the export.

The restore action at `$66D9` issues `BLOAD SAVED GAME,A$830`. This disk's DOS
load path searches the catalogue and track/sector list twice before reading
the payload. The first sector goes to a DOS buffer at `$9853`; the store at
`$BEEA` copies its 252 payload bytes into `$0830`–`$092B`. The seven complete
middle sectors go directly to their game RAM destinations through RWTS, whose
store at `$B8D4` writes the decoded bytes. The final sector goes to `$9853`
again, and `$BF4E` copies its first 211 bytes into `$102C`–`$10FE`.

Use these manual stops in Disassembly, with Memory following the destination:

| Stop | What it shows |
| --- | --- |
| `$66B2` | The full save block before `BSAVE`. Its digest is recorded below. |
| `$ACCF` | The next byte DOS reads from the save block. Step to inspect the access. |
| `$66D4` | `BSAVE` has returned; the sector writes are complete. |
| `$BEEA` / `$B8D4` / `$BF4E` | The partial-sector copies and direct sector writes during `BLOAD`. These routines also serve other disk loads. |
| `$66FF` | `BLOAD` has returned. All 2,255 bytes equal the saved block, before the game updates its workspace. |

At `$66FF`, the game still has work to do. It clears the cache table, adjusts
its action workspace, and advances the turn before displaying the prompt.
The original restore routine also contains a duplicate `STA $0890` at `$6713`
where its action-pointer high byte would belong. The checked path does not
use that damaged pointer: its restored action count is one and immediately
decrements to zero. Dromaios executes those original bytes unchanged; the
byte-for-byte comparison is made before that routine resumes.

## Acceptance record

The following data is consumed by
[the native session test](../../tests/site/apple2-mystery-house.test.ts).
Addresses elsewhere in this guide are hexadecimal; room, turn, and picture
numbers below are decimal. Each command includes its Return as `\n`.
The initial Space acknowledges the notice without queuing an extra Return.

```json
{
  "disk": {
    "bytes": 143360,
    "sha256": "5e94463cf131fd16db831dc360adcb02aaada491e8d8325d2b447051b1ea4771"
  },
  "title": {
    "bytes": 12291,
    "sha256": "3bf04b068378b7965b07bf3d5b0587fb400e2739b5b6c9a65eb3374bdb85f952",
    "dotsSha256": "7c3828a192278a29039d3b48fad489b486355f2d9b123956c1870cf0b611d241"
  },
  "adventure": {
    "bytes": 29952,
    "sha256": "2e3258aabbf2ee97a67f520d011bb3b235cfd245b4373690404f922f92143196"
  },
  "scenes": [
    {
      "name": "Front yard", "command": "G\n", "room": 1, "turn": 1, "picture": 3,
      "text": "YOU ARE IN THE FRONT YARD OF A LARGE",
      "dotsSha256": "88fe649fa11fb0537fc9ce974f0111b013d8513c7f1c6aef59760cc5381952d9"
    },
    {
      "name": "Closed porch", "command": "GO STAIRS\n", "room": 2, "turn": 2, "picture": 1,
      "text": "YOU ARE ON THE PORCH.  STONE STEPS LEAD",
      "dotsSha256": "848a009d12db4211a077c6bf3305eb0e97a8f69ab8ae2a60307d258560187178"
    },
    {
      "name": "Open porch", "command": "OPEN DOOR\n", "room": 2, "turn": 3, "picture": 2,
      "text": "YOU ARE ON THE PORCH.  STONE STEPS LEAD",
      "dotsSha256": "1a395fa19f8f3f1fb3d23ee22581b8779e55532282a568573fc317a8130d5df5"
    },
    {
      "name": "Entry hall", "command": "GO DOOR\n", "room": 3, "turn": 4, "picture": 53,
      "text": "YOU ARE IN AN ENTRY HALL.  DOORWAYS GO",
      "dotsSha256": "05dc5417e534c59dca85aa71bfdbd0a42695202c3680d0cfc8fa325964855f62"
    }
  ],
  "savedGame": {
    "address": 2096, "bytes": 2255,
    "sha256": "b2ae064c0f89fb259ce0fa620d7509512b8a4cca359d9139dd4ae637955d95bd",
    "track": 7, "sectors": [13, 12, 11, 10, 9, 8, 7, 6, 5]
  },
  "continuation": {
    "name": "Library after restore", "command": "EAST\n", "room": 14, "turn": 6, "picture": 6,
    "text": "YOU ARE IN THE OLD, DUSTY LIBRARY",
    "dotsSha256": "34bcab80c8fcc72895ce9ae800ee508806a92391e676f48c5d315dcac337d62f"
  }
}
```

The scene and saved-payload digests were obtained independently with
`tools/play.py` in the local `mystery-house-book` checkout at
`4e8cea174a321437476a45def3b5615ba10a7003`.
That Python 6502 runner executes the game's drawing and rules while supplying
ROM input/output and DOS file services. Dromaios instead boots and executes the
real ROM and DOS. The reference is therefore evidence for the pictures and
game state, not an independent check of Disk II timing. The title digest was
also checked directly against the corresponding bytes of `AUTO LOAD OBJ`.
For the save check, the reference runs `GO STAIRS`, `OPEN DOOR`, `GO DOOR`,
and `SAVE GAME`. A new reference game receives that saved block, executes
`RESTORE GAME`, then `EAST`. Its library picture supplies the continuation
digest. The reference disassembly also identifies the original restore bug.

For each visible graphics row `y = 0…159`, read 40 bytes from
`$2000 + (y % 8) × $400 + floor(y / 8) % 8 × $80 + floor(y / 64) × $28`.
Expand each byte's bits 0–6, left to right, into bytes `00` or `01`. Hash those
44,800 bytes in row order. This excludes the four text rows, unused screen holes,
palette bits, and browser effects. The test also checks the laboratory's
monochrome frame against this independently decoded raster.

After building with Node 24, run the optional media acceptance with:

```sh
APPLE2_ROM=/path/to/apple2p.rom \
APPLE2_MYSTERY_HOUSE_DISK=/path/to/mystery-house.dsk \
node --test dist/tests/site/apple2-mystery-house.test.js
```

Without those local files the session test is explicitly skipped. With them it
checks media identity, cold boot, both binary loads, the opening scenes, and
exact session replay after encoding and restoring the yard checkpoint. It then
traces every saved byte and the sector writes, checks the exported file and
unchanged surrounding disk bytes, cold-boots that export, and follows all
restored bytes back into RAM. The restored hall, subsequent library picture,
and unchanged read-only export complete the check. Instruction bounds catch
a stalled boot; they are not promises about host performance or original drive
speed.

## Laboratory performance workload

[The browser benchmark](../../scripts/benchmark-apple2-laboratory.ts) exercises
the real laboratory controls, scheduling, observers and rendering. It restores
two checkpoints from the acceptance run:

| Start | Input and stop | Guest work |
| --- | --- | --- |
| Title menu | `G` + Return; Run to `$0800` | The first 2,000,000 instructions of loading, ending at the debugger's instruction limit. This is a loading sample, not the entire load. |
| Front yard | `GO STAIRS` + Return; Run to `$63DF` | 224,100 instructions through the porch redraw to the next command prompt. |

Each sample starts in a fresh page with the default docking layout, Unlimited
speed, sound off and a 1800 × 1013 viewport. Three configurations distinguish
rendering from recording: all Live switches on; all Live switches off; then
Live off with Changes, Disk transfer and Applesoft event recording off.
Debugger checks, watchpoints and the other observers remain active in every
configuration. Hidden tools continue collecting history but only render when
revealed; Pause and Step refresh visible tools even with Live off.

To prepare exact checkpoints, add an output directory to the optional acceptance
command above (after building):

```sh
APPLE2_ROM=media/apple2/apple2p.rom \
APPLE2_MYSTERY_HOUSE_DISK=media/apple2/disks/mystery-house.dsk \
APPLE2_MYSTERY_HOUSE_CHECKPOINTS=media/benchmarks/mystery-house \
node --test dist/tests/site/apple2-mystery-house.test.js
```

This writes `title.json` and `yard.json` under the ignored `media/` directory.
They contain RAM and mounted media, so keep them local. Build the site, serve
`site/output` locally, and start a separate Chrome process with remote debugging.
For example, in separate terminals on macOS:

```sh
python3 -m http.server 8771 --bind 127.0.0.1 --directory site/output
```

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --remote-debugging-port=9227 --user-data-dir="$(mktemp -d)"
```

Then run three samples per configuration:

```sh
APPLE2_ROM=media/apple2/apple2p.rom \
node scripts/benchmark-apple2-laboratory.ts \
  http://127.0.0.1:8771 http://127.0.0.1:9227 media/benchmarks/mystery-house 3 \
  > media/benchmarks/mystery-house/results.json
```

The benchmark creates and disposes its own browser context. It checks instruction
counts and hashes the complete hardware and input state after every sample;
observer configurations must produce identical hashes. Compare those hashes
across revisions too. The JSON report contains timings and hashes, not media.
Use unprofiled runs on an otherwise idle host for timing; collect CPU profiles
separately to find costs. Guest clocks must agree even when host timings vary.

The November 2026 pass compared `682f779` with the first laboratory optimizations
on an Apple M5 Max, headless Chrome 156.0.8078.80. Medians of three runs:

| Workload | Inspector configuration | Before | After | Less elapsed time |
| --- | --- | --- | --- | --- |
| Loading sample | Live and recording on | 14.84 s | 9.71 s | 35% |
| Loading sample | Live off | 11.30 s | 8.00 s | 29% |
| Loading sample | Live and recording controls off | 8.62 s | 6.37 s | 26% |
| `GO STAIRS` | Live and recording on | 1.78 s | 1.25 s | 30% |
| `GO STAIRS` | Live off | 1.39 s | 1.00 s | 28% |
| `GO STAIRS` | Live and recording controls off | 1.06 s | 0.82 s | 23% |

All 36 final-state hashes matched their corresponding native workload. The changes
avoid hidden inspector rendering, reuse the completed instruction's PC, query
Language Card mapping directly, and prepare change-log field descriptions once.
They do not skip guest instructions, disk waits or recorded changes. These
figures describe these two samples, not cold-boot time or other machines.
