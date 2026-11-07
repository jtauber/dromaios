# Mystery House on the Apple II Plus

The [Apple II Plus](../../src/machines/6502/apple2.md) can cold-boot the selected
*Mystery House* disk, display its title and first scene, and execute the first
three commands through the original game, ROM, and DOS code. This guide follows
the journey from the front yard to the entry hall. It establishes that opening
session, not a complete playthrough or compatibility with every release.

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
Disk II with one read-only drive. DOS reads the game, messages, and pictures
from ordinary sectors. The first session needs neither another peripheral nor
a software-specific execution shortcut. The machine's declared disk and video
limitations still apply.

## Start in the laboratory

1. Load the 20 KiB `apple2p.rom` container in **ROM**. It supplies both the
   motherboard firmware and the slot-6 bootstrap; the machine chapter owns
   their [verified identities](../../src/machines/6502/apple2.md#firmware-supplied-by-the-caller).
2. In **Disk**, choose **Insert read-only…** and select `mystery-house.dsk`.
   Insertion prepares a fresh, paused machine. Choose **Unlimited**, then **Run**.
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
speaker, CPU clock, and the mounted disk with its rotational phase and read-only
permission. It is a laboratory checkpoint, distinct from the game's `SAVE GAME`
command. Guest saving and restoring, later puzzles, winning, and alternate disk
versions remain outside this acceptance pass.

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
  ]
}
```

The scene digests were obtained independently with `tools/play.py` in the local
`mystery-house-book` checkout at `4e8cea174a321437476a45def3b5615ba10a7003`.
That Python 6502 runner executes the game's drawing and rules while supplying
ROM input/output and DOS file services. Dromaios instead boots and executes the
real ROM and DOS. The reference is therefore evidence for the pictures and
game state, not an independent check of Disk II timing. The title digest was
also checked directly against the corresponding bytes of `AUTO LOAD OBJ`.

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
checks media identity, cold boot, both binary loads, all four scenes, unchanged
read-only media, and exact session replay after encoding and restoring the yard
checkpoint. Instruction bounds catch a stalled boot; they are not promises about
host performance or original drive speed.
