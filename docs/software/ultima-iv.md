# Ultima IV on the Apple II Plus

The [Apple II Plus](../../src/machines/6502/apple2.md) can cold-boot the selected
*Ultima IV* Boot disk, exchange it for Britannia, move the saved party on the
world map, visit Skara Brae and the first level of Covetous, and save and resume
through an exported disk. A separate **Initiate new game** route creates a mage,
enters Britannia, and verifies the new character's first save and resumption.
That mage then wins a bridge-troll encounter and retains the resulting health,
experience, and party state through another save, export, and fresh boot.
These routes do not establish a complete playthrough.

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

## Laboratory walkthroughs

In the laboratory's **Walkthrough** panel, choose **Ultima IV · party and saving**
or **Ultima IV · bridge combat**. Each named stop has preparation instructions,
**Run to checkpoint**, **Browse code**, and memory links for its relevant state.
The tours become runnable once the selected build's main game code is present;
they also work after a saved-state restore or with an edited Britannia disk.
They check the instruction bytes and game mode at each destination, without
requiring the DOS read trace or recording to be enabled.

Pause to queue each key with screen **Inspect** off, then choose **Run to
checkpoint**. Selecting a stop or browsing memory does not execute instructions.
Running to the current stop advances through another turn, so the world and
combat command stops can be reused for successive moves. Other breakpoints
and watchpoints still take precedence. A bounded run can stop early; read the
Execution status before treating it as arrival.

The party links expose zero-page position and mode, the first character's
record, health and experience, virtues, and saved objects. Combat links expose
the battlefield, enemy positions, binary health and active slots, and party
positions. Memory follows the current mapping: upper Language Card links are
disabled while ROM is mapped, and inspecting never flips a guest soft switch.
The detailed routes below explain the initial media and the expected results.
These are guided observations; the acceptance tests separately prove complete
loads, combat outcomes, and disk persistence.

## Create a new character

Start again from the original Boot disk. Keep this experiment's Britannia copy
separate from the supplied party and the town and dungeon exports below.

1. At the title, press Space, then `I` for **Initiate new game**.
2. Enter `DROMAIOS`, press Return, and choose `M`. Wait for the illustrated story
   to load. Use Space to advance its pages and the introductions between questions.
3. Answer `A` to each of the seven A/B questions. Advance the two final story
   pages with Space. This route creates a male mage with Good status and 200 HP.
4. At the Britannia request, pause and use **Swap disk** and **Insert writable
   copy…** with the original `ultima_iv_br.dsk`. Run and press Escape. The new
   one-member party starts at `(231,136)`, near Moonglow.
5. Press Down. In the repeatable route, the first attempt reports
   `SLOW PROGRESS!`; the second moves south to `(231,137)`. Use the `$40C0`
   breakpoint described below to stop between attempts and avoid idle turns.
6. Press `Q`, wait for the save to finish, and export the mounted disk as
   `ultima_iv_br-new-game-saved.dsk`.
7. Fresh-boot the original Boot disk, select **Journey onward**, and insert that
   export at the Britannia request. DROMAIOS resumes at `(231,137)`; Down moves
   the party to `(231,138)`.

The old party is still on the Britannia disk when the new character first arrives.
Creation keeps its result in RAM. At `$402C`, a nonzero party count at `$000F`
bypasses loading the old `PRTY`, `ROST`, and `LIST` files. The first `Q` save
replaces their contents with the new party. Before that save, both original disk
images are unchanged.

### How creation builds the party

The Boot disk's `N·EWGAME` binary has a `$0800` file header, but `BRUN` explicitly
loads its 13,141 payload bytes at `$6400`. The catalogue inspector's middle dot
represents the nonprinting character in its name. After the questions, it loads
three templates from the same Boot disk: `N·PRT` supplies 32 bytes at `$0000`,
`N·LST` supplies 256 bytes at `$EE00`, and `N·RST` supplies 384 bytes at `$EC00`.
It moves the selected class into the first roster slot, inserts the name, sex,
and attributes, records the virtues, sets the party count to one, and chooses
the class's starting coordinates. It then loads the main game.

| Stop | What happens next |
| --- | --- |
| `$6F6C` | Read the next character of the name. Return leads to the sex prompt. |
| `$6400` | Enter the newly loaded character-creation program. |
| `$0AB5` | Wait for a story-page key. From the first story stop, 24 Space advances reach the first card introduction; one more reaches the first question. |
| `$66A7` | Read an A/B answer. `$6694` waits between questions; Space presents the next question. |
| `$671C` | All seven answers are complete. Space reaches the final page at `$672C`; another Space loads the templates. |
| `$6771` | All three unmodified templates are in RAM, before character-specific changes. |
| `$67E3` | The new party is complete; transfer to the main game loader. |
| `$402C` | Preserve the new party rather than reading the old Britannia save. |

The selected virtues are Compassion, Sacrifice, Valor, Honesty, Honesty,
Compassion, and Honesty. Honesty wins the tournament, selecting class 0, Mage.
The attribute tables at `$680C`, `$6814`, and `$681C` add 4 strength, 7 dexterity,
and 9 intelligence to the initial 15, producing **19, 22, and 24**. These are
stored as packed decimal `$19,$22,$24`; the initial `$0F` values are normalized
by the first decimal additions. Virtue scores begin at decimal 50 and gain 5
for each selection, producing 65 Honesty, 60 Compassion, 55 Valor, 55 Sacrifice,
and 50 for each other virtue. The code brackets these additions with `SED` and
`CLD` at `$66CA` and `$66EE`.

The reference emulator agrees on the name, class, question pairs, starting
position, and checked landscape. Its `adc` implementation ignores decimal mode,
so it produces different attribute and virtue bytes. Those expectations instead
come from the game's tables and decimal additions above. The reference can still
independently load Dromaios's exported save: it restores the new mage and correct
attribute bytes at `(231,137)` and moves south to `(231,138)`.

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

## Enter Covetous and return

Continue from the town round trip's fresh boot and eastward step at `(23,128)`.
Make a writable copy of the resumed Britannia disk in **Disk set** and insert it
with **Swap disk**. Add `ultima_iv_under.dsk` read-only. Keep the writable
Britannia copy in the set throughout this trip.

This is a route for the **supplied party and its prepared spells**. Mariah and
Iolo can cast; several other members are disabled in this saved game. The route
uses Gate and two Blinks to cross the mountains and water around Covetous.
Use the `$40C0` command breakpoint between commands to avoid extra idle turns.
At each spell prompt, enter the following keys separately, without Return:

1. `C`, `1`, `G`, `5`: Mariah casts Gate to phase 5, arriving at `(166,19)`.
2. `C`, `1`, `B`, Left Arrow: Mariah blinks west to `(154,19)`.
3. Right Arrow twice moves to `(156,19)`.
4. `C`, `5`, `B`, Down Arrow: Iolo blinks south to Covetous at `(156,27)`.
   Mariah has spent most of her magic points; use Iolo for this second Blink.
5. `E` announces `COVETOUS` and requests the **Underworld disk**. This has
   already saved the outdoor object list onto Britannia. Select Underworld,
   **Insert selected**, Run, and press Escape. The dungeon appears at `(1,1)`
   on level 1, facing east.
6. Up Arrow moves **forward**, to `(2,1)`. Save a laboratory state here if desired.
   Right Arrow turns south in place; another Right turns west. Up Arrow then
   moves back to the entrance ladder at `(1,1)`. These controls are relative to
   the facing direction, unlike world-map movement.
7. Press `K` to climb the ladder. At the Britannia request, reinsert the same
   writable Britannia copy, Run, and press Escape. The party returns to `(156,27)`.
8. `Q` saves the party. At the next `$40C0` stop with the motor off, export the
   disk as `ultima_iv_br-dungeon-saved.dsk`. Fresh-boot Boot, choose Journey
   onward, and supply that export. The party resumes outside Covetous.
9. `C`, `5`, `B`, Up Arrow makes Iolo blink north to `(156,16)`, demonstrating
   continued play from the exported save.

### What the dungeon exchange loads

As with town entry, the game first saves `TLST,A$EE00,L$100` on Britannia.
The Underworld disk then supplies two binary files:

| File | Header address | Actual destination | Payload | Data sectors, in order |
| --- | --- | --- | --- | --- |
| `DNGD` | `$5000` | `$8C00` | 3,360 bytes | T21 S9 through S0, then T22 S15 through S12 |
| `DNG4` | `$8000` | `$E800` | 512 bytes | T19 S12 through S10 |

The explicit `A$` addresses in the game's BLOAD commands override each file's
header. `DNGD` is the shared dungeon display program. `DNG4` holds Covetous's
eight 8-by-8 levels in Language Card RAM: 64 bytes per level. After loading,
the game clears its dungeon object list at `$EE00` before drawing the view.

| Stop | What to inspect |
| --- | --- |
| `$50E6` | `DNGD` has loaded at `$8C00`; the map loader is next. |
| `$5124` | All 512 `DNG4` bytes are at `$E800`; the object-list clear is next. |
| `$40C0` | Dungeon view complete and ready for a command. `$0000,$0001` are local X,Y; `$000A=$15` identifies Covetous, `$000B=3` selects dungeon mode, and `$000C=0` means level 1. |
| `$18C6` | On climbing out, the game is waiting for Britannia. |
| `$467C` | The retained Britannia disk has restored `TLST`, before returning to the world coordinates in `$0008,$0009`. |

Facing is `$0010`: north `0`, east `1`, south `2`, west `3`. The acceptance
checks the rendered view as well as these values. Turning changes facing without
moving or consuming a movement turn in this route. Returning to the ladder and
climbing out also proves that the saved outdoor list survives time spent on a
different disk and a laboratory checkpoint restore.

This is an entrance-and-exit acceptance, not a cleared dungeon. Deeper levels,
room combat, traps, treasure, and the Abyss sequence remain separate work.

## Win a bridge-troll encounter

Use the **new mage's first export**, `ultima_iv_br-new-game-saved.dsk`, from
the character-creation route. Fresh-boot the original Boot disk, choose Journey
onward, and supply that export at the Britannia request. Stop at `$40C0`, at
`(231,137)`, before taking the extra southward step described earlier. In **Disk
set**, make a writable copy of this Britannia disk and insert it with **Swap disk**.
This encounter needs neither Town nor Underworld.

Keep a breakpoint at `$40C0` between world commands; idle turns change the route.
Press Up seven times and Left four times, running to the breakpoint after each
keypress. Two attempts report slow progress without moving. The party arrives
at the bridge at `(228,131)`. Press Space four times, again stopping after each
wait. Before the fifth Space, replace the breakpoint with `$6FB0`: bridge trolls
attack. Continue to `$708B` to inspect their loaded battlefield, then `$71D7`
for the first combat command. DROMAIOS starts at combat coordinates `(3,5)`,
with two trolls at `(6,4)` and `(9,2)`.

Combat uses local coordinates, while `$0000,$0001` retain the world position.
An attack takes two keys: `A`, then Right Arrow for east. For repeatable inspection,
stop at `$7A7E` after `A`, continue to `$0AB5`, then enter the direction and run to
`$71D7`. `$0AB5` also reads ordinary commands; stopping there immediately after
queuing `A` can catch the earlier prompt before it has consumed that key.

| Turns | Keys and result |
| --- | --- |
| 1–2 | Right twice, moving to `(5,5)`. |
| 3–5 | Attack east three times. The first troll loses 27, 8, and 31 HP and is killed. The mage takes 12 damage and earns 7 experience. |
| 6–7 | Right twice, moving to `(7,5)`. The mage takes another 3 damage. |
| 8–12 | Attack east five times: 12, 20, and 28 damage, a miss, then 32 damage. The remaining troll retreats with 21 HP. |
| 13–14 | Right twice. The troll flees; the game prints `VICTORY!` and returns to the world at `(228,131)`. Use `$40C0` for the final stop. |

This completes the encounter: one troll is killed and one flees. DROMAIOS has
**185 HP and 132 experience**, from 200 and 125. Magic points rise from 38 to 48
during the turns; Valor rises from 55 to 56. The character remains a male mage
with Good status, and keeps his name, attributes, maximum HP, and equipment.
No game code or character values are patched to produce the outcome.

Press `Q`, wait for `$40C0` with the drive motor off, and export the disk as
`ultima_iv_br-combat-saved.dsk`. Fresh-boot the original Boot disk and choose
Journey onward again. Insert this export read-only at the Britannia request.
The mage resumes at `(228,131)` with **185 HP and 132 experience**. Left moves
to `(227,131)` with those statistics retained. The acceptance compares every
saved party, roster, and object byte before game initialization, including food
and virtue changes; it does not just check the displayed character statistics.

### Battlefield data and combat arithmetic

The encounter loads `CONR` from Britannia with `BLOAD CONR,A$240`. Its binary
header specifies `$0840`, but the explicit address loads all 192 bytes at `$0240`.
Its track/sector list is T19 S13 and its data is in T19 S12. The first 32 bytes
supply 16 enemy X and Y positions; the next 16 supply eight party X and Y
positions. The 11-by-11 terrain occupies `$0280`–`$02F8`. This is battlefield
data; the combat program is already resident in the main game.

| Address | Meaning |
| --- | --- |
| `$EF00` / `$EF10` + enemy slot | Enemy X / Y; the two initial troll slots are 0 and 9. |
| `$EF40` + enemy slot | Enemy health, a binary byte; initially 60 and 113. |
| `$EF50` + enemy slot | Creature code `$A4` for these trolls, zero when removed. |
| `$EF80` / `$EF90` + party index | Party member's combat X / Y. |
| `$EC16` | First character's magic points, packed decimal. |
| `$EC18`–`$EC19` | Current health, packed decimal, most significant byte first. |
| `$EC1C`–`$EC1D` | Experience, in the same format. |
| `$ED02` | Valor, packed decimal. |

The pinned reference emulator agrees on the approach, loaded battlefield,
initial enemies, and first two movement turns, including the rendered viewport.
It diverges on the first attack: its `ADC` and `SBC` ignore decimal mode.
The game's conversion routine at `$8540` uses decimal subtraction to convert
dexterity 22 and strength 19 to binary for hit and damage calculations. Ignoring
that mode changes the combat rolls as well as later health and experience.
Consequently the reference is not an oracle for the complete combat transcript.

The native acceptance instead checks those conversions, the staff's damage range
of strength 19 plus 16, binary enemy-health subtraction, and the game's decimal
health and experience updates against ordinary arithmetic. `$85BE` subtracts
damage from the hero; `$8658` adds experience. Health becomes `200 - 12 - 3 = 185`
and experience becomes `125 + 7 = 132`. Replaying the first attack from a serialized
checkpoint must reproduce all hardware and input state. The unmodified reference
also independently cold-boots the final exported disk: it restores 185 HP and
132 experience at `(228,131)` and accepts the westward step to `(227,131)`.

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
With Underworld also supplied, it continues from the town resumption through
Covetous entry, forward movement, turning, checkpoint replay, departure, and a
third save and cold boot. It checks all `DNGD` and `DNG4` bytes after loading,
five independently rendered dungeon views, the temporary outdoor list, and the
full saved party, roster, and object blocks. The replay repeats one move from a
serialized checkpoint and compares every hardware and input byte.
A separate [character-creation check](../../tests/site/apple2-ultima-iv-new-game.test.ts)
cold-boots the original images, enters the name and answers, checks every loaded
creation-program and template byte, and replays the fourth answer from a serialized
checkpoint. It checks the party, decimal attributes and virtues, the initial
Britannia load's bypass of the old save, and the southward move. Its first save
gets the same exact source-read, sector-write, and whole-export checks as the
existing-party route. A fresh boot verifies all three reloaded blocks, the new
character, and another move. These checks start independently; creation does
not replace the supplied party used by the town and dungeon routes.
The [combat check](../../tests/site/apple2-ultima-iv-combat.test.ts) cold-boots
the verified new-character export, loads the bridge battlefield, checks all 14
combat turns and the victory transcript, then applies the same source-read,
sector-write, whole-export, and fresh-boot checks to the resulting party.
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
  },
  "dungeon": {
    "image": { "bytes": 143360, "sha256": "bf8eab41b7b742bb48b962a506404beeb0cd86c1a207d19c0a856d77a05946a9" },
    "stops": {
      "codeLoaded": { "address": 20710, "bytes": [32, 5, 81] },
      "mapLoaded": { "address": 20772, "bytes": [162, 0, 138, 157, 0, 238] }
    },
    "gate": { "name": "Phase 5 gate", "x": 166, "y": 19 },
    "blink": { "name": "West after Blink", "x": 154, "y": 19 },
    "outside": { "name": "Outside Covetous", "x": 156, "y": 27 },
    "location": 21,
    "viewport": { "x": 7, "y": 8, "width": 154, "height": 160 },
    "scenes": [
      { "name": "Covetous entrance, east", "x": 1, "y": 1, "direction": 1,
        "viewSha256": "bbc10a41a704ae9a1d4d0623276c64d120b9f9e976910a472afff9ed6286cafe" },
      { "name": "Forward, east", "x": 2, "y": 1, "direction": 1,
        "viewSha256": "7bee8d702680ded45195b69825a6e2c7b8886be5603872b9889ec102dd884e4a" },
      { "name": "Facing south", "x": 2, "y": 1, "direction": 2,
        "viewSha256": "23ac9cd63d626d295e3fbf526ef8ac9365be6be2b2d7267a52870dec9ced792e" },
      { "name": "Facing west", "x": 2, "y": 1, "direction": 3,
        "viewSha256": "f7497ba39d1730ac58212d468df792b4039f8d7b70b29719321e169b533680b9" },
      { "name": "Entrance ladder, west", "x": 1, "y": 1, "direction": 3,
        "viewSha256": "ddef6bdf0f091f2b8064a1c591334743dfcca4483be4b61ab052f56f539d4841" }
    ],
    "resumed": { "name": "Resumed outside Covetous", "x": 156, "y": 27 },
    "continuation": { "name": "North after dungeon resumption", "x": 156, "y": 16 }
  },
  "newGame": {
    "name": "DROMAIOS",
    "sexKey": "M",
    "sex": 92,
    "class": 0,
    "roster": [196, 210, 207, 205, 193, 201, 207, 211, 0, 0, 0, 0, 0, 0, 0, 0, 92, 0, 199, 25, 34, 36, 32, 128, 2, 0, 2, 0, 1, 37, 1, 1],
    "attributes": [25, 34, 36],
    "virtues": [101, 96, 85, 80, 85, 80, 80, 80],
    "storyAdvances": 24,
    "pairs": [[1, 5], [4, 7], [2, 6], [0, 3], [0, 2], [1, 4], [0, 1]],
    "stops": {
      "name": { "address": 28524, "bytes": [173, 0, 192, 16, 242] },
      "codeLoaded": { "address": 25600, "bytes": [44, 139, 192, 44, 139, 192] },
      "story": { "address": 2741, "bytes": [169, 128, 141, 219, 10] },
      "question": { "address": 26279, "bytes": [32, 41, 100, 201, 193] },
      "cards": { "address": 26260, "bytes": [32, 41, 100, 32, 241, 104] },
      "chosen": { "address": 26396, "bytes": [32, 41, 100, 32, 241, 104] },
      "lastStory": { "address": 26412, "bytes": [32, 41, 100, 169, 0] },
      "templates": { "address": 26481, "bytes": [165, 11, 133, 232, 169, 0, 133, 11] },
      "created": { "address": 26595, "bytes": [76, 9, 100] },
      "newParty": { "address": 16428, "bytes": [165, 15, 240, 3] }
    },
    "arrival": { "x": 231, "y": 136,
      "terrainSha256": "4c82ce563a55e2bbaae96ce5b09fa340b948886ccced89bcbaee341caff66e75" },
    "slow": { "x": 231, "y": 136,
      "terrainSha256": "50bcd3e96900d3e884419e8ea0b52d0a2a0f8773ae8319a8cf688209671fc8a2" },
    "moved": { "x": 231, "y": 137,
      "terrainSha256": "edfa03cd38ec47ef0c31b71edd4577d78f6ac0145a040c0a665ac7476caeee7d" },
    "resumed": { "x": 231, "y": 137,
      "terrainSha256": "eefecaa4fd72538054cdb3a7f8d0411cd1d0e865a8c619a263ac1782d362e317" },
    "continuation": { "x": 231, "y": 138,
      "terrainSha256": "cd917ed3250b5882d04d4a792ca0a22393291a0fb658c307a50c1d9e72566493" }
  },
  "combat": {
    "image": {"bytes": 143360, "sha256": "4ab490553539328f92a65ce56fd43c30b9740c3a4c99ed5ceaecb330ecce90fe"},
    "arrival": {"x": 231, "y": 137, "terrainSha256": "eefecaa4fd72538054cdb3a7f8d0411cd1d0e865a8c619a263ac1782d362e317"},
    "approach": [[11, 231, 136], [11, 231, 135], [11, 231, 134], [11, 231, 133], [11, 231, 132], [11, 231, 132], [11, 231, 131], [8, 231, 131], [8, 230, 131], [8, 229, 131], [8, 228, 131]],
    "waits": 5,
    "stops": {
      "entry": { "address": 28592, "bytes": [32, 33, 8] },
      "mapLoaded": { "address": 28811, "bytes": [165, 11, 201, 130] },
      "command": { "address": 29143, "bytes": [32, 0, 8, 208, 3] },
      "attack": { "address": 31358, "bytes": [169, 0, 141, 112, 125] },
      "direction": { "address": 2741, "bytes": [169, 128, 141, 219, 10] }
    },
    "initial": {"health": 200, "experience": 125, "magic": 38, "position": [3, 5], "enemies": [[0, 6, 4, 60], [9, 9, 2, 113]]},
    "viewport": {"x": 7, "y": 8, "width": 154, "height": 160},
    "views": ["d5fb18a50c952bf19997e41d58ec0ed68ff1dd7c5e164b7aec2e804b02985eaa", "f83b57a51cc70d36b4a8ac9ff8ba563845df703303b3136b00b82824709adb00", "ae7cd7ae451bf3c0ee70a17b2b094896e90660687d15fce00ea1fbdf65bda63e"],
    "turns": [
      { "action": "east", "position": [4, 5], "health": 200, "experience": 125, "magic": 39, "enemies": [[0, 6, 5, 60], [9, 9, 2, 113]], "damage": 0, "reward": 0 },
      { "action": "east", "position": [5, 5], "health": 200, "experience": 125, "magic": 40, "enemies": [[0, 6, 5, 60], [9, 9, 3, 113]], "damage": 0, "reward": 0 },
      { "action": "attack-east", "position": [5, 5], "health": 188, "experience": 125, "magic": 41, "enemies": [[0, 6, 5, 33], [9, 9, 4, 113]], "damage": 12, "reward": 0 },
      { "action": "attack-east", "position": [5, 5], "health": 188, "experience": 125, "magic": 42, "enemies": [[0, 6, 5, 25], [9, 9, 4, 113]], "damage": 0, "reward": 0 },
      { "action": "attack-east", "position": [5, 5], "health": 188, "experience": 132, "magic": 43, "enemies": [[9, 9, 5, 113]], "damage": 0, "reward": 7 },
      { "action": "east", "position": [6, 5], "health": 185, "experience": 132, "magic": 44, "enemies": [[9, 9, 5, 113]], "damage": 3, "reward": 0 },
      { "action": "east", "position": [7, 5], "health": 185, "experience": 132, "magic": 45, "enemies": [[9, 8, 5, 113]], "damage": 0, "reward": 0 },
      { "action": "attack-east", "position": [7, 5], "health": 185, "experience": 132, "magic": 46, "enemies": [[9, 8, 5, 101]], "damage": 0, "reward": 0 },
      { "action": "attack-east", "position": [7, 5], "health": 185, "experience": 132, "magic": 47, "enemies": [[9, 8, 5, 81]], "damage": 0, "reward": 0 },
      { "action": "attack-east", "position": [7, 5], "health": 185, "experience": 132, "magic": 48, "enemies": [[9, 8, 5, 53]], "damage": 0, "reward": 0 },
      { "action": "attack-east", "position": [7, 5], "health": 185, "experience": 132, "magic": 48, "enemies": [[9, 8, 5, 53]], "damage": 0, "reward": 0 },
      { "action": "attack-east", "position": [7, 5], "health": 185, "experience": 132, "magic": 48, "enemies": [[9, 9, 5, 21]], "damage": 0, "reward": 0 },
      { "action": "east", "position": [8, 5], "health": 185, "experience": 132, "magic": 48, "enemies": [[9, 10, 5, 21]], "damage": 0, "reward": 0 },
      { "action": "east", "position": [9, 5], "health": 185, "experience": 132, "magic": 48, "enemies": [], "damage": 0, "reward": 0 }
    ],
    "resumed": {"x": 228, "y": 131, "terrainSha256": "4e79906eb07800da43bac5b10fbb7e52cf45b9c3ff3326354d19c902f7713210"},
    "continuation": {"x": 227, "y": 131, "terrainSha256": "590e79b3139af8624e258f505720fbc51f9c38834b673c1e967b97e6cfdecf17"}
  },
  "walkthroughs": [
    {
      "id": "ultima4-party", "title": "Ultima IV · party and saving",
      "setup": "Boot the selected Ultima IV Boot disk, press Space at the title, then J. At the Britannia request, swap to the chosen Britannia disk and press Escape. This tour becomes available when the main game code has loaded. Use a writable copy for Q. Screen Inspect must be off when typing; no Return follows game commands. Clear unrelated breakpoints. Memory links never change the Language Card mapping; upper-RAM links are disabled while ROM is visible.",
      "requires": ["stops.command", "save.start", "combat.stops.attack"],
      "steps": [
        {
          "title": "World command ready", "stop": "stops.command",
          "prepare": "Run here after supplying Britannia. For each later move, pause, queue an arrow key on the screen, then choose Run to checkpoint again. Repeating this checkpoint advances past the current command boundary.",
          "observe": "The world is drawn and the game is about to wait for a command. $0000/$0001 are X/Y; $000A is the location and $000B is the mode (01 outdoors). The party count is at $000F. A character record is 32 bytes. First-character HP at $EC18 and experience at $EC1C are two-byte packed decimal, most significant byte first.",
          "when": [{"address": 11, "bytes": [1]}], "limit": 40000000,
          "inspect": [
            {"label": "Party position and mode", "address": 0, "space": "ram"},
            {"label": "Character record", "address": 60416, "space": "lc-upper"},
            {"label": "HP and experience", "address": 60440, "space": "lc-upper"}
          ]
        },
        {
          "title": "Save source blocks", "stop": "save.start",
          "prepare": "At the world command, make and insert a writable copy of the current Britannia disk. Queue Q, then run to this stop.",
          "observe": "Before the three BSAVE commands, PRTY has 32 bytes at $0000, ROST has 512 bytes at $EC00, and LIST has 256 bytes at $EE00. These links show the live sources DOS will copy.",
          "when": [{"address": 11, "bytes": [1]}], "limit": 5000000,
          "inspect": [
            {"label": "PRTY source", "address": 0, "space": "ram"},
            {"label": "ROST source", "address": 60416, "space": "lc-upper"},
            {"label": "LIST source", "address": 60928, "space": "lc-upper"}
          ]
        },
        {
          "title": "Save commands returned", "stop": "save.returned",
          "prepare": "Continue from Save source blocks without another key.",
          "observe": "All three BSAVE commands have returned. Check that no disk error was printed. Select World command ready and run there, then export the mounted disk with its motor off. This stop alone does not verify the exported bytes.",
          "when": [{"address": 11, "bytes": [1]}], "limit": 50000000,
          "inspect": [
            {"label": "Party position and mode", "address": 0, "space": "ram"},
            {"label": "Character record", "address": 60416, "space": "lc-upper"},
            {"label": "HP and experience", "address": 60440, "space": "lc-upper"}
          ]
        },
        {
          "title": "Party block reloaded", "stop": "save.partyLoaded",
          "prepare": "Export the completed save, fresh-boot the original Boot disk, choose J, and swap to the export at the Britannia request. Queue Escape and run to this stop.",
          "observe": "BLOAD has restored all 32 PRTY bytes before the game continues loading the other saved blocks. The first two bytes are the saved world coordinates.",
          "when": [{"address": 11, "bytes": [1]}], "limit": 40000000,
          "inspect": [
            {"label": "Reloaded PRTY", "address": 0, "space": "ram"}
          ]
        },
        {
          "title": "Roster and objects reloaded", "stop": "save.rosterLoaded",
          "prepare": "Continue without another key.",
          "observe": "ROST and LIST are restored, before initialization modifies the loaded state. Compare the character, health, experience, virtues and world objects with the save sources.",
          "when": [{"address": 11, "bytes": [1]}], "limit": 20000000,
          "inspect": [
            {"label": "Reloaded character", "address": 60416, "space": "lc-upper"},
            {"label": "HP and experience", "address": 60440, "space": "lc-upper"},
            {"label": "Virtues", "address": 60672, "space": "lc-upper"},
            {"label": "Reloaded objects", "address": 60928, "space": "lc-upper"}
          ]
        },
        {
          "title": "Resumed world command", "stop": "stops.command",
          "prepare": "Continue without another key. Once stopped, queue one arrow and run to this same checkpoint to take another turn.",
          "observe": "The world is ready for play again. After the verified bridge encounter, the export resumes at (228,131) with 185 HP and 132 experience; Left moves to (227,131). Other saves retain their own party state.",
          "when": [{"address": 11, "bytes": [1]}], "limit": 5000000,
          "inspect": [
            {"label": "Party position and mode", "address": 0, "space": "ram"},
            {"label": "Character record", "address": 60416, "space": "lc-upper"},
            {"label": "HP and experience", "address": 60440, "space": "lc-upper"}
          ]
        }
      ]
    },
    {
      "id": "ultima4-combat", "title": "Ultima IV · bridge combat",
      "setup": "Start from the new-character export at (231,137), before its extra southward step. Use World command ready in the party tour between Up seven times, Left four times, and Space four times. These include two slow-progress attempts. At (228,131), select the first stop below before the fifth Space. Keep the Britannia disk mounted. All coordinates in this route are decimal; memory addresses are hexadecimal.",
      "requires": ["stops.command", "save.start", "combat.stops.attack"],
      "steps": [
        {
          "title": "Bridge trolls attack", "stop": "combat.stops.entry",
          "prepare": "After the four waits on the bridge, queue one more Space and run here.",
          "observe": "$00C0 holds the creature code A4; $00C1/$00C2 hold the world position and $00C3 the bridge tile 17. The game is about to load the combat map.",
          "when": [{"address": 11, "bytes": [1]}], "limit": 5000000,
          "inspect": [
            {"label": "Encounter and terrain", "address": 192, "space": "ram"},
            {"label": "Party position and mode", "address": 0, "space": "ram"}
          ]
        },
        {
          "title": "Battlefield loaded", "stop": "combat.stops.mapLoaded",
          "prepare": "Continue without another key.",
          "observe": "BLOAD CONR,A$240 has loaded 192 bytes at $0240. The first 32 bytes supply enemy X/Y positions, the next 16 party positions; $0280–$02F8 contains the 11×11 terrain. Combat code is already resident.",
          "when": [{"address": 11, "bytes": [1]}], "limit": 5000000,
          "inspect": [
            {"label": "Starting positions", "address": 576, "space": "ram"},
            {"label": "Battlefield terrain", "address": 640, "space": "ram"}
          ]
        },
        {
          "title": "Combat command ready", "stop": "combat.stops.command",
          "prepare": "Continue without another key. For a movement turn, queue an arrow and run to this same checkpoint. In the verified route, begin with Right twice.",
          "observe": "Mode $000B is 80. DROMAIOS begins at (3,5), with trolls in slots 0 and 9. Enemy health at $EF40+slot is binary; character health is packed decimal. Enemy X/Y arrays are $EF00/$EF10; party X/Y arrays are $EF80/$EF90.",
          "when": [{"address": 11, "bytes": [128]}], "limit": 5000000,
          "inspect": [
            {"label": "Enemy positions", "address": 61184, "space": "lc-upper"},
            {"label": "Enemy HP and active slots", "address": 61248, "space": "lc-upper"},
            {"label": "Party combat positions", "address": 61312, "space": "lc-upper"},
            {"label": "HP and experience", "address": 60440, "space": "lc-upper"}
          ]
        },
        {
          "title": "Attack command accepted", "stop": "combat.stops.attack",
          "prepare": "At Combat command ready, queue A and run here. Then select Combat turn complete, queue Right Arrow for east, and run. Do not queue the direction before A has been consumed.",
          "observe": "The game has accepted Attack but has not read its direction. The verified route uses a staff. Inspect the target positions and current health before the hit and enemy response.",
          "when": [{"address": 11, "bytes": [128]}], "limit": 5000000,
          "inspect": [
            {"label": "Enemy positions", "address": 61184, "space": "lc-upper"},
            {"label": "Enemy HP and active slots", "address": 61248, "space": "lc-upper"},
            {"label": "Party combat positions", "address": 61312, "space": "lc-upper"},
            {"label": "HP and experience", "address": 60440, "space": "lc-upper"}
          ]
        },
        {
          "title": "Combat turn complete", "stop": "combat.stops.command",
          "prepare": "After Attack command accepted, queue Right Arrow and run here. Use the same stop for a movement turn. Repeat the bridge route in the guide: Right twice; attack east three times; Right twice; attack east five times; Right twice. For the final Right, choose Return to the world map instead.",
          "observe": "A complete player turn and enemy response have finished. Compare enemy slots and health with the previous turn. One troll is killed for 7 experience; the other eventually flees. Reuse Attack command accepted for each A before sending its direction.",
          "when": [{"address": 11, "bytes": [128]}], "limit": 5000000,
          "inspect": [
            {"label": "Enemy positions", "address": 61184, "space": "lc-upper"},
            {"label": "Enemy HP and active slots", "address": 61248, "space": "lc-upper"},
            {"label": "Party combat positions", "address": 61312, "space": "lc-upper"},
            {"label": "HP and experience", "address": 60440, "space": "lc-upper"}
          ]
        },
        {
          "title": "Return to the world map", "stop": "stops.command",
          "prepare": "In the verified route, select this before the final Right that sends the surviving troll off the battlefield. Queue the key and run.",
          "observe": "Mode is back to 01. Confirm VICTORY! on the screen; this boundary also serves ordinary world commands. The verified mage is at (228,131), with HP 0185, experience 0132 and Valor 56 in packed decimal. Use the party/save tour to persist and reload these changes.",
          "when": [{"address": 11, "bytes": [1]}], "limit": 5000000,
          "inspect": [
            {"label": "Party position and mode", "address": 0, "space": "ram"},
            {"label": "Character record", "address": 60416, "space": "lc-upper"},
            {"label": "HP and experience", "address": 60440, "space": "lc-upper"},
            {"label": "Valor", "address": 60674, "space": "lc-upper"}
          ]
        }
      ]
    }
  ]
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

The Covetous route also runs independently in the pinned reference. The five
`viewSha256` values cover the 154-by-160 monochrome dungeon viewport, using the
same independent pixel-address equations. Each matches the native renderer.
The reference cold-boots the native dungeon export at `(156,27)` and Iolo's
northward Blink continues to `(156,16)`. As with town entry, the native check
owns the temporary write and restore; the reference cannot persist that write.

The browser check starts from the verified `(235,233)` checkpoint and uses the
laboratory's keyboard, disk-set selection, writable-copy, checkpoint, and export
controls. It restores the set while Town is mounted and reinserts the retained
Britannia copy on departure. The final browser download matches every byte of
the native export. The native test then supplies
that disk to a new machine, booted from reset, and verifies the saved blocks and
another move.

A second browser check starts at `(23,128)` and follows the Covetous route,
including restoring a checkpoint after the first forward move. Its complete
hardware and input state matches the native run at the Underworld request,
dungeon entry, forward move, entrance ladder, and return to Britannia. The
browser's exported disk again matches every byte of the native export.

The new-character browser check starts from the verified opening-menu checkpoint
and enters the name, sex, story keys, and seven answers through the laboratory's
keyboard controls. Its complete hardware and input state matches the native run
at the first question, completed creation, Britannia arrival, southward move, and
finished save. It uses **Insert writable copy…** at the Britannia request, and its
download matches every byte of the native new-character export.

The combat browser check restores the verified new-character checkpoint at
`(231,137)`, makes and inserts a writable copy, then follows the bridge route
and all 14 combat turns. Its full hardware and input state matches a native
replay from that checkpoint at battle entry, after the first attack, after
victory, and after saving. The downloaded disk matches the native cold-boot
acceptance's export byte for byte. The checkpoint-based browser route and the
native test's independent cold boot have different elapsed clock counts; both
produce the same party and exported disk.

The laboratory's named tours also reproduce the bridge route, all combat turns,
and saving, with matching hardware, input, and exported bytes. Their reload
stops were exercised from the verified cold-boot disk-request checkpoint through
restoring the party and another westward move. Each party and combat memory link
was checked against its destination, with unchanged hardware and input state.

To run the optional local-media check after a current build:

```sh
APPLE2_ROM=media/apple2/apple2p.rom \
APPLE2_ULTIMA_IV_BOOT=media/apple2/reference/ultima_iv_boot.dsk \
APPLE2_ULTIMA_IV_BRITANNIA=media/apple2/reference/ultima_iv_br.dsk \
APPLE2_ULTIMA_IV_TOWN=media/apple2/reference/ultima_iv_town.dsk \
APPLE2_ULTIMA_IV_UNDERWORLD=media/apple2/reference/ultima_iv_under.dsk \
node --test dist/tests/site/apple2-ultima-iv.test.js
```

Run the independent new-character route with the same original images:

```sh
APPLE2_ROM=media/apple2/apple2p.rom \
APPLE2_ULTIMA_IV_BOOT=media/apple2/reference/ultima_iv_boot.dsk \
APPLE2_ULTIMA_IV_BRITANNIA=media/apple2/reference/ultima_iv_br.dsk \
node --test dist/tests/site/apple2-ultima-iv-new-game.test.js
```

Run the combat route with the new-character export produced by that check:

```sh
APPLE2_ROM=media/apple2/apple2p.rom \
APPLE2_ULTIMA_IV_BOOT=media/apple2/reference/ultima_iv_boot.dsk \
APPLE2_ULTIMA_IV_NEW_GAME=media/apple2/exports/ultima_iv_br-new-game-saved.dsk \
node --test dist/tests/site/apple2-ultima-iv-combat.test.js
```

The combat record verifies the starting export's digest, so it cannot silently
run against a different party or a save made after extra turns.

Set `APPLE2_ULTIMA_IV_CHECKPOINTS` to an ignored local directory to retain the
verified checkpoints and Britannia exports for
browser experiments. Omit `APPLE2_ULTIMA_IV_TOWN` to run only the earlier
Boot/Britannia save path. The dungeon check needs both Town and Underworld; omit
`APPLE2_ULTIMA_IV_UNDERWORLD` to stop after the town round trip. These artifacts
contain private media bytes and must not be published.

## Still to establish

This pass covers all four disks, Skara Brae's entrance and one conversation,
Covetous's first corridor and entrance ladder, both returns to Britannia, and
saving and resuming the supplied party. It also covers one character-creation
path, that character's first save, and a complete bridge-troll encounter followed
by saving and resuming the resulting party. Other classes and answer
sequences, other towns and conversations, other enemies and combat options,
deeper dungeon exploration and room combat,
sound expansion hardware,
and a complete playthrough remain unverified. The
machine chapter's disk, timing, display, and audio limitations continue to apply.
