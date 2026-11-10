# Ultima IV on the Apple II Plus

The [Apple II Plus](../../src/machines/6502/apple2.md) can cold-boot the selected
*Ultima IV* Boot disk, exchange it for Britannia, move the saved party on the
world map, visit Skara Brae and the first level of Covetous, and save and resume
through an exported disk. A separate **Initiate new game** route creates a mage,
enters Britannia, and verifies the new character's first save and resumption.
That mage then wins a bridge-troll encounter and retains the resulting health,
experience, and party state through another save, export, and fresh boot.
The next route buys reagents, mixes Heal, and persists both the healed character
and the remaining inventory. A further route recruits Iolo, completes an orc
encounter with both characters, and verifies targeted healing and both saved records.
A prepared expedition save also completes Covetous’s first room encounter and
returns both characters to Britannia for another save and fresh boot.
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
or **Ultima IV · bridge combat**. **Ultima IV · mixing and healing** follows the
mage's reagent purchase and return to Britannia described below.
**Ultima IV · companions and targeting** follows recruitment, separate combat
turns, and a Heal cast by Iolo on the mage.
**Ultima IV · dungeon room** follows the raw room read, battle, and separate
character exits before returning to Britannia.
Each named stop has preparation instructions,
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

This first route checks the entrance and exit. The later
[room encounter](#fight-a-dungeon-room-and-bring-both-characters-back) extends it
to combat, triggers and re-entry; deeper levels, traps, treasure and the Abyss
sequence remain separate work.

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

## Buy reagents, mix Heal, and save the healed mage

Start with `ultima_iv_br-combat-saved.dsk`, the export from the encounter above.
Fresh-boot the original Boot disk, choose Journey onward, and insert the combat
export read-only. Stop at `$40C0`, before the extra Left move: the mage is at
`(228,131)`, with **185/200 HP, 132 experience, and 48 MP**. Make a writable
Britannia copy in **Disk set** and insert it with **Swap disk**. Keep the original
combat export intact.

The mage owns three ginseng and four garlic, but no spider silk or prepared
spells. Heal needs **ginseng and spider silk**, as described in the original
[Book of Mystic Wisdom, p. 25][spellbook]. Obtain the missing ingredient through
the game:

1. With `$40C0` stopping each completed move, press Right three times, Down four
   times, then Right once. The party reaches Moonglow at `(232,135)`.
2. Press `E`. At the Towne request, insert the original `ultima_iv_town.dsk`
   read-only and press Escape. Retain the writable Britannia disk in the set;
   entering town has saved the outdoor object list onto it.
3. From `(1,15)`, walk Right twelve times, Down twelve, and Left eight, reaching
   `(5,27)` below the herb counter. Right twice then lines the mage up at `(7,27)`
   with Margot at `(7,25)` in this repeatable route. Her position can differ if
   extra turns pass; look for her across the counter before talking.
4. Press `T`, then Up. Margot welcomes you to **MAGICAL HERBS**. Answer `Y`, then
   choose `D` for spider silk. Choose quantity `3`, then enter `9` and Return for
   payment. Answer `N` to anything else. Three silk cost **9 gold**: the purse
   changes from **200 to 191**. Answer each prompt in turn.
5. Walk Right six times, Up twelve, and Left thirteen to `(0,15)`. One more Left
   leaves town. At the Britannia request, reinsert the **same writable copy** and
   press Escape. Stop at `$40C0`, back at `(232,135)`.

Now choose the **Ultima IV · mixing and healing** laboratory tour. It has stops
for the prompts, the mixture count, the resource charge, and the health changes.
Its first three stops check the `MIX` overlay as well as their instruction bytes,
so a different program loaded at `$8800` cannot masquerade as the mixing screen.

1. Queue `M` and run to **Choose a mixture**. The game loads `MIX` from Britannia.
2. Queue `H` and run to **Choose a reagent**. Queue `B` for ginseng and run to
   that same stop, then `D` for spider silk and run there again.
3. Queue Return and run to **Heal mixture stored**: `SUCCESS!` appears and the
   prepared Heal count becomes one. Continue to **Choose a mixture**, then repeat
   `H`, `B`, `D`, Return for a second mixture. Continue to the choice prompt,
   queue Escape, and use the world-command stop to leave Mix.
4. At `$40C0`, queue `C` and `1`, then run to **Choose a spell to cast**. Queue
   `H` and run to **Heal resources charged**. One mixture and **10 MP** have been
   spent, before the game asks whom to heal. Continue to **Choose whom to heal**.
5. Queue `1`, then run to **Healing amount** and **Healing applied**. Continue to
   **World ready after healing**. `DONE.` has printed and HP is **200**. The mage
   retains one ginseng, four garlic, one spider silk, and one prepared Heal spell.

Do not paste the whole sequence while a disk load runs: the game's keyboard
buffer is bounded. Pausing at each named prompt makes the experiment repeatable.

### What the mixing and healing code does

Reagents A–H occupy `$ED38`–`$ED3F`; prepared spells A–Z occupy `$ED40`–`$ED59`.
Each is a packed-decimal count. Selecting a reagent immediately subtracts one;
`MIX` accumulates its bit at `$890B`. Ginseng contributes `$40`, spider silk `$10`,
and Heal's recipe at `$8A12` requires exactly `$50`. Return compares the recipe
and adds one to `$ED47`. The two successful mixtures leave counts `01,04,01` for
ginseng, garlic, and silk, and `02` for Heal.

Casting subtracts one mixture, then the packed-decimal cost `$10` in the spell
table at `$4973`. At `$4C1F`, MP is **38**, HP is still **185**, and one mixture
remains. The Heal routine selects a binary amount from 75–99, converts it to
packed decimal, and calls `$85F8`. This route selects **87**: the addition makes
HP **272**, then the maximum check caps it at **200**. Completing the turn
regenerates one MP, leaving **39**. The test checks the intermediate addition and
cap independently, using the selected amount; it does not merely compare the
final number with a captured screenshot.

Use the party/save tour for `Q`, wait for the next command with the motor off,
and export as `ultima_iv_br-magic-saved.dsk`. Fresh-boot the original Boot disk,
choose Journey onward, and insert this export read-only. The reload restores all
800 declared bytes of `PRTY`, `ROST`, and `LIST`, including **200 HP, 132 experience,
191 gold, the remaining reagents, and one Heal mixture**. MP remains at the saved
39 when the first world prompt appears. Left moves to `(231,135)` and regenerates
one MP, to 40, while retaining the inventory and health.

[spellbook]: https://c64sets.com/ultima4/Ultima%20IV%20Quest%20of%20the%20Avatar%20-%20The%20Book%20of%20Mystik%20Wisdom.pdf

## Recruit Iolo and distinguish caster from recipient

Continue from `ultima_iv_br-magic-saved.dsk`, the exported mixing/healing result,
using a **fresh Boot / Journey onward load**. This starts the mage at `(232,135)`
with 200 HP, 132 XP, 39 MP, and one prepared Heal. Make a writable Britannia copy
and keep that same copy across the Town disk exchange. These coordinates and
statistics are decimal; addresses below are hexadecimal.

### Reach Britain and recruit its bard

Use **Ultima IV · companions and targeting** alongside the party/save tour.
The route is deliberately prompt-by-prompt. Idle time advances the moons and
extra turns move monsters, so simply pasting the directions is not equivalent.

1. From Moonglow, Up twice, Left twice, Up, Left, Up, Left three times, Down
   twice, Left. This reaches `(225,133)`, just east of Moonglow's moongate.
2. Choose **Moongate leads to Britain** and run **without a key**. The game's
   input loop advances Trammel to phase 0 / Felucca to phase 1. Queue Left,
   then use **World command ready** in the party tour. Stepping onto `(224,133)`
   takes the mage to Britain's gate at `(96,102)`. Passing a turn with Space
   instead lets a nearby orc attack before the gate is ready.
3. Walk Left to `(84,102)`, repeating after slow progress; Down twice; Left to
   `(83,104)`, again repeating after slow progress; Down, Left, Down. The mage
   reaches Britain at `(82,106)`. The acceptance record below includes every
   slow-progress attempt for this exact starting save and input timing.
4. Press `E`, wait for the Town disk request, insert `ultima_iv_town.dsk`
   read-only, and press Escape. Use **Britain command ready** for each town move.
   From `(1,15)`, Right 18 times, Down eight,
   Right seven, Down six, Right once: `(27,29)`, next to Iolo at `(28,29)`.
5. Queue `T`, Right and run to **Iolo conversation**. Type `JOIN`, Return and
   use **Recruitment checks**, then **Iolo added to the party**. Continue to
   **Britain command ready**. The screen says `I AM HONORED TO JOIN THEE!` and lists Iolo.
6. Return Left once, Up six, Left seven, Up eight, Left 19 times to `(0,15)`.
   One more Left requests Britannia. Reinsert the retained writable copy,
   press Escape, and reach the world prompt at `(82,106)`.

The executable `TALK` overlay checks conversation 1, Britain's class, Compassion,
and party capacity. Our Avatar is a mage, has Compassion 60 (at least 40), and
has maximum HP 200: level 2, enough to grow a one-member party. The game increments
`$000F` to two and swaps the companion into the new last 32-byte record. Iolo is
already second, at `$EC20`, so all 32 swaps exchange a byte with itself. His town
object, slot 31, is cleared. These are existing roster records becoming active;
recruitment does not construct a new character from scratch.

| Stop | Meaning |
| --- | --- |
| `$1813` with `$12=0,$13=1` | Moon phases select Moonglow's entrance and Britain's destination. |
| `$8882` with `TALK` loaded | Conversation prompt. |
| `$8AFF` | `JOIN` begins its eligibility checks. |
| `$8C02` | Party count is two; the record swap and removal of Iolo's town object are complete. |
| `$71D7` with `$D4=1` or `2` | The same combat command reader serves different characters. |

### Win one encounter with both characters

From Britain, Right 13 times, Up, Right, Up, Right, Up, Right twice, Up, Right
twice reaches the bridge at `(101,102)`. Pass 15 turns with Space, stopping at
each world prompt; the last reaches combat against three orcs. The bridge arena
comes from `CONR`. The initial enemies occupy slots 0, 5 and 15, with **binary**
health 107, 109 and 45. DROMAIOS starts at combat `(3,5)` and Iolo at `(2,4)`.

Both characters have an independent command turn. Use the two named combat
stops to distinguish them; `$D4` is the one-based character number. `A, Right`
means Attack followed by Right. Queue each action while paused, then run to the
next character's command. After the last attack use **Two-character victory**.

| Round | DROMAIOS (staff) | Iolo (sling) | Mage HP after round | Iolo XP after round |
| --- | --- | --- | --- | --- |
| 1 | Right | Right | 200 | 240 |
| 2 | Right | A, Right | 200 | 240 |
| 3 | A, Up | A, Right | 200 | 240 |
| 4 | A, Up | A, Right | 200 | 246 |
| 5 | A, Right | Right | 188 | 246 |
| 6 | A, Right | Right | 188 | 246 |
| 7 | A, Right | Right | 188 | 246 |
| 8 | A, Right | A, Down | 188 | 246 |
| 9 | A, Right | A, Down | 171 | 246 |
| 10 | A, Down | A, Down | 171 | 246 |
| 11 | A, Down | A, Down | 171 | 246 |
| 12 | Down | Right | 171 | 246 |
| 13 | Right | A, Down | 171 | 252 |
| 14 | Right | A, Down | 171 | 258 |

The mage attacks and takes 29 damage, finishing at 171 HP and 132 XP. Iolo takes
no damage and kills all three orcs, gaining six XP each: 240 → 258. His HP remains
300. Combat preserves the remaining six inactive records, equipment, attributes,
and the prepared Heal mixture. The test checks the turn owner, both positions,
every enemy's position and HP, and both character records after each action;
it also checks decimal damage and experience arithmetic against ordinary integer
subtraction and addition as those routines execute.

### Have Iolo heal the mage, then save both

At the world prompt, queue `C`, `2` and run to **Iolo chooses Heal**. Choose `H`
and stop at **Iolo pays for Heal**: the shared mixture count changes from 1 to 0,
and **Iolo's** MP changes from 13 to 3. The mage's HP and MP are still unchanged.
Continue to **Select Heal recipient**, choose `1`, and run to **Mage healed by
Iolo**. `$D4` now selects the mage's record. The observed roll is 82, converted
from binary to packed decimal; 171 + 82 = 253 is capped to maximum HP 200.
Iolo remains at 300 HP. Continuing to the world prompt regenerates his MP to 4;
the mage stays at his 48-MP cap. Caster and recipient are separate selections.

Use `Q` and the party/save tour, then export after the command prompt returns
and the disk motor stops. Retain `ultima_iv_br-companion-saved.dsk`. A new machine
boots the original Boot disk, chooses Journey onward, and loads this export:

| Character | Record | HP / maximum | XP | MP |
| --- | --- | --- | --- | --- |
| DROMAIOS | `$EC00` | 200 / 200 | 132 | 48 |
| Iolo | `$EC20` | 300 / 300 | 258 | 4 |

The party count is two and the world position is `(101,102)`. The Heal mixture
remains consumed. A Left moves both as one party to `(100,102)` and regenerates
Iolo's MP to 5. The acceptance compares **every saved byte** in `PRTY`, `ROST`
and `LIST` before game initialization, then checks both characters at the first
prompt and after that move. It starts both boots from a new machine, without
restoring a checkpoint or copying RAM into the fresh session.

## Fight a dungeon room and bring both characters back

**Ultima IV · dungeon room** starts from `ultima_iv_br-room-ready.dsk`, a
prepared expedition save outside Covetous at `(156,27)`. It continues the
DROMAIOS/Iolo party through ordinary game commands: buy and ready a second sling
in Britain, buy reagents in Paws, mix spells, return to Britain's moongate, and
travel to Minoc when the moons are phase 1 / phase 4. Blink west reaches `(154,19)`;
walk east to `(156,19)`, repeating after slow progress, then Blink south to Covetous.
No party, map or executable bytes were patched. The inventory and statistics
reflect that supply trip, including two road encounters. The room acceptance
starts with the separately identified prepared export; it does not replay the
preparation or verify the preceding purchase and mixing sequence.

Load the original Boot disk, choose Journey onward, and swap in the room-ready
export at the Britannia request. Make a writable copy and retain it throughout
the Underworld exchange. The selected starting state is:

| Character | HP / maximum | XP | MP | Weapon |
| --- | --- | --- | --- | --- |
| DROMAIOS | 200 / 200 | 138 | 23 | Sling |
| Iolo | 299 / 300 | 282 | 13 | Sling |

There are two prepared Heal and two Light mixtures, no Blink remaining, and no
gold. These details identify this particular expedition; arbitrary parties can
visit the room, but their combat outcomes and timing will differ.

### From the dungeon map to a raw room sector

1. Use **Outside Covetous**, press `E`, and wait for the Underworld request.
   Swap in `ultima_iv_under.dsk` read-only, queue Escape, and run to
   **Covetous entrance**. The party starts at `(1,1)` on level 1, facing east.
2. Cast `C`, `1`, `L` and return to the dungeon command prompt. Light consumes
   one mixture. Underground, Up advances, Down retreats, and Left/Right turn;
   they no longer represent absolute directions.
3. Up, Up, Left, Up, Right, Up, Up, Right reaches `(5,0)`, facing south. Use
   **Dungeon command ready** after each action. This repeatable stop also
   handles the Light cast; **Covetous entrance** matches only the entrance.
4. Queue Up and run to **Read room zero**. The square entered, `(5,1)`, is `$D0`
   in `DNG4` at `$E80D`. Continue through **Room sector in RAM** and
   **Room actors placed**, then **DROMAIOS room turn**.

The selected build calls its raw disk reader at `$6EB2`, with `$E0`–`$E3` equal
to `04 00 01 02`: track 4, sector 0, one sector, destination page `$02`.
The track is Covetous's location number minus `$11`; the room square's low
nibble selects the sector. Unlike `DNG4`, this room is not a DOS file. In the
DOS-order `.dsk`, it is the 256 bytes at `$4000`–`$40FF`.

| RAM after the read | Contents |
| --- | --- |
| `$0200`–`$020F` | Four four-byte map triggers. |
| `$0210`–`$023F` | Sixteen enemy types, then their X and Y coordinates. |
| `$0240`–`$027F` | Four entrance formations, each eight X and eight Y coordinates. |
| `$0280`–`$02F8` | The 11×11 battlefield, row by row. |
| `$02F9`–`$02FF` | Seven remaining sector bytes. |

At `$6EB5` the entire sector is present. Placement copies the triggers to
`$0310`–`$031F` before screen output reuses the sector's first half. Facing south
means entering from the north: `(facing XOR 2) × 16` selects formation zero.
DROMAIOS starts at `(3,2)` and Iolo at `(2,2)`. Enemy slots 3, 4 and 5 are
skeletons; slots 6, 10, 11 and 13 are ghosts. Their starting binary HP are
57, 31, 61, 47, 111, 44 and 56. Character HP and XP remain packed decimal.

The game sets mode `$81` for this dungeon room, compared with `$80` for the
outdoor encounters already checked. The named combat stops distinguish the
mode and the current character at `$D4`, although they use the same `$71D7`
command reader. Memory links expose the room, retained triggers, enemy arrays,
party positions, active tiles, and both character records. The combat and direct
return route preserves the trigger data. The separate
[trigger inspection](#test-the-triggers-exit-rule-and-re-entry) below activates it.

### Clear the room's seven enemies

Queue one action at a time, then use the **other character's room turn** stop.
After the final attack use **Iolo room turn**. `A, Right` means Attack followed
by Right; an arrow by itself moves that character within the battlefield.

| Round | DROMAIOS | Iolo |
| --- | --- | --- |
| 1 | A, Right | Down |
| 2 | A, Right | Right |
| 3 | A, Right | A, Right |
| 4 | A, Down | A, Right |
| 5 | A, Down | A, Down |
| 6 | A, Down | A, Down |
| 7 | A, Right | A, Down |
| 8 | A, Right | A, Down |
| 9 | A, Right | A, Down |
| 10 | A, Right | A, Down |
| 11 | A, Down | A, Down |
| 12 | A, Down | A, Down |
| 13 | A, Right | A, Right |
| 14 | A, Right | A, Right |
| 15 | A, Right | A, Right |
| 16 | A, Right | Right |
| 17 | A, Right | A, Up |
| 18 | Right | A, Up |
| 19 | A, Up | — (room cleared) |

After 37 actions, three skeletons and three ghosts have been killed; the fourth
ghost has fled. All seven enemy slots are inactive. DROMAIOS
loses 17 HP and earns 16 XP, ending at 183 HP / 154 XP. Iolo loses 20 HP and earns
14 XP, ending at 279 HP / 296 XP. The test checks each turn's actor, positions,
remaining enemies and statistics, as well as independently adding experience
and subtracting damage as the guest's decimal routines execute. The unused
characters, equipment and inventory remain unchanged.

There is **no outdoor victory transition** when the last enemy dies. The room
continues to take turns, and both surviving characters must leave it.

### Leave together, then save outside

Iolo is at `(4,3)`, DROMAIOS at `(4,2)`. Starting with Iolo:

1. Iolo Left; DROMAIOS Up; Iolo Up; DROMAIOS Up; Iolo Up.
2. Queue DROMAIOS Up and use **Mage has left north**. His X and Y become `$80`
   and his active tile becomes zero. Iolo remains at `(3,1)`. The first departure
   records north as `$00,$FF` at `$7A7C`–`$7A7D`; subsequent departures must use
   the same side.
3. Iolo Up reaches `(3,0)`. Queue another Up and use **Both characters leave**.
   Both active slots are now zero. Continue to **Back in the corridor**:
   mode 3, `(5,0)`, facing north.
4. Left, Up, Up, Left, Up, Right, Up, Up returns to the entrance ladder at
   `(1,1)`, facing west. Use **Dungeon command ready** for the intermediate commands.
   Press `K`, wait for Britannia, swap back to the **same writable copy**, and
   queue Escape for **Back in Britannia**.
5. Use the party/save tour's `Q` stops, then export `ultima_iv_br-room-saved.dsk`
   after the prompt returns and the motor stops. Start a new machine with the
   original Boot disk and choose Journey onward using this export.

The fresh load restores all 800 declared bytes of `PRTY`, `ROST` and `LIST`
before game initialization. Both character records retain their final HP and
XP, both slings, two unused Heal mixtures and one remaining Light mixture.
At `(156,27)`, DROMAIOS has regenerated to 48 MP and Iolo remains at 13 MP.
Space takes another ordinary turn, increasing the saved move count without
changing their statistics. No checkpoint or copied RAM supplies the new machine.

This proves one room encounter and its return path. The following inspection
checks what happens when the party enters that same room again.

### Test the triggers, exit rule and re-entry

Save a laboratory checkpoint immediately after the 37-action battle, with Iolo's
turn pending. Select **Ultima IV · room triggers and exits**. This is a branch
from the cleared room: it ends in a new encounter. Restore that checkpoint to
take the original save-and-return route above.

1. Iolo Right; DROMAIOS Up; Iolo Up; DROMAIOS Up; Iolo Right; DROMAIOS Up.
   Use the original room tour for the alternating turns, then **North exit
   committed** for the final move. DROMAIOS has left; Iolo is at `(6,2)`.
   North is recorded as `00 FF` at `$7A7C`–`$7A7D`.
2. Use **Iolo room command** after each of two Right movements to `(8,2)`.
   Queue Down for **Upper trigger reached**, then continue without a key to
   **Upper trigger applied**. Four tiles change, opening a passage to the east.
3. Continue to **Iolo room command** without a key to finish the turn. Up,
   Left twice, Down three times, Right four times reaches `(10,5)`.
   Queue Right for **Different exit rejected**. The attempted coordinate is
   `(11,5)`, but Iolo stays at `(10,5)` with his active slot unchanged.
   Continue to **Iolo room command** to see `ALL MUST USE THE SAME EXIT!`.
4. Left three times, Down twice reaches `(7,7)`. Queue Right for **Lower
   trigger reached**, then continue to **Lower trigger reapplied**. It performs
   the same four stores. The values are already present, so the battlefield
   does not change this time; the descriptors have not been consumed.
5. Finish the turn at **Iolo room command**. Left twice, Up five times, Left
   twice, Up twice reaches `(4,0)`. Queue Up for **Both characters leave north**.
   Both active slots are now zero. Continue to **Corridor after the trigger**:
   `(5,0)`, facing north, in dungeon mode 3.
6. Use the original tour's **Dungeon command ready** for Right twice to turn
   south. Queue Up for **Read the room again**. Continue through **Original
   map reloaded**, **Room state reset**, and **New room encounter ready**.

The trigger scan begins at `$797E`. Each four-byte descriptor contains a tile,
a trigger coordinate, and two destination coordinates. Coordinates pack X in the
high nibble and Y in the low nibble: `$83` means `(8,3)`. The four descriptors
retained at `$0310` are:

```text
16 83 95 A5    floor at (9,5) and (10,5) when entering (8,3)
7F 83 A4 A6    wall at (10,4) and (10,6) when entering (8,3)
16 87 95 A5    the same floor changes when entering (8,7)
7F 87 A4 A6    the same wall changes when entering (8,7)
```

At `$79C1` the scan is complete. The acceptance decodes these packed coordinates
independently, checks all four executed stores, and compares every battlefield
byte. Destinations use `$0280 + 11 × Y + X`:

| Square | RAM | Original tile | Trigger writes | Instruction |
| --- | --- | --- | --- | --- |
| `(9,5)` | `$02C0` | `$7F` wall | `$16` floor | `$79A4` |
| `(10,5)` | `$02C1` | `$7E` rock | `$16` floor | `$79B2` |
| `(10,4)` | `$02B6` | `$7E` rock | `$7F` wall | `$79A4` |
| `(10,6)` | `$02CC` | `$7E` rock | `$7F` wall | `$79B2` |

Opening the east passage does not override the shared-exit rule. The first
character's departure fixes the direction for this encounter. At `$7A12` the
game takes the refusal path for Iolo's eastward attempt. His position and active
slot, the battlefield, and the north restriction survive the refusal. It still
uses a turn.

Re-entry reconstructs the encounter in two stages:

| State | Observed behavior |
| --- | --- |
| Battlefield | Remains modified after leaving. The raw read at `$6EB5` restores all 256 original sector bytes, closing the east passage. |
| Exit restriction | Still north after the read; room setup clears it to `00 00` before `$6FAD`. |
| Enemies | All seven return in their original slots and positions. HP is freshly generated: 63, 27, 57, 110, 42, 111 and 44 on this route. |
| Party placement | North-entry positions return: DROMAIOS `(3,2)`, Iolo `(2,2)`. DROMAIOS has the first turn. |
| Trigger descriptors | Copied from the original sector again; both triggers remain available. |
| Dungeon map | Terrain and room `$D0` at `$E80D` persist; there is no cleared-room marker here. Wandering monsters move in corridor tiles' low nibbles as dungeon turns pass. The raw room read and setup preserve the entire current 512-byte dungeon map. |
| Character progress | DROMAIOS retains 183 HP / 154 XP; Iolo retains 279 HP / 296 XP. Equipment and mixtures persist. |
| Ongoing time | DROMAIOS regenerates from 44 to 48 MP, and food accounting advances. The roster comparison permits only those two changed bytes, `$EC16` and `$ED12`. |

The original Underworld disk remains byte-for-byte unchanged. This verifies the
two triggers and re-entry behavior of Covetous room zero, with a north departure
and an eastward refusal. It does not establish every room's triggers or every
exit direction; deeper levels, altar rooms and completing the dungeon remain
separate work.

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
The [dungeon-room check](../../tests/site/apple2-ultima-iv-room.test.ts) cold-boots
the prepared expedition export, compares the complete raw room sector and both
loaded dungeon files, replays entry from a checkpoint with identical hardware
and input, checks all 37 combat actions and eight exit actions, then verifies
the return, full disk export and another cold boot.
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
  "magic": {
    "image": {"bytes": 143360, "sha256": "de9f8ced228881c7f9ac91fe45f21572874f83b1cb3f8786033e174ff1f9429e"},
    "approach": [[21, 3], [10, 4], [21, 1]],
    "townApproach": [[21, 12], [10, 12], [8, 8], [21, 2]],
    "townReturn": [[21, 6], [11, 12], [8, 13]],
    "shop": {"x": 7, "y": 27, "keeperX": 7, "keeperY": 25, "quantity": 3, "price": 3, "goldBefore": 200, "goldAfter": 191},
    "stops": {
      "shopPrompt": {"address": 34934, "bytes": [32, 142, 139]},
      "mixLoaded": {"address": 34816, "bytes": [76, 23, 136]},
      "mixChoice": {"address": 34853, "bytes": [32, 20, 137]},
      "reagent": {"address": 34920, "bytes": [32, 20, 137]},
      "mixtureStored": {"address": 35076, "bytes": [216, 32, 34]},
      "spellChoice": {"address": 18622, "bytes": [32, 154, 132]},
      "charged": {"address": 19487, "bytes": [32, 33, 8]},
      "healTarget": {"address": 19495, "bytes": [32, 93, 8]},
      "healAmount": {"address": 19522, "bytes": [32, 248, 133]},
      "healed": {"address": 19525, "bytes": [76, 230, 65]}
    },
    "initial": {"health": 185, "maximumHealth": 200, "experience": 132, "magic": 48, "reagents": [0, 3, 4, 0, 0, 0, 0, 0], "healMixtures": 0},
    "mixed": {"reagents": [0, 1, 4, 1, 0, 0, 0, 0], "healMixtures": 2},
    "healed": {"health": 200, "experience": 132, "magic": 39, "healMixtures": 1},
    "resumed": {"x": 232, "y": 135},
    "continuation": {"x": 231, "y": 135}
  },
  "companions": {
    "image": {"bytes": 143360, "sha256": "327c821b4613085070faa3e5bc3a5a8c99b54e30496192d951327f10d8fbf7e6"},
    "gateApproach": [[11, 232, 134], [11, 232, 133], [8, 231, 133], [8, 230, 133], [11, 230, 132], [8, 229, 132], [11, 229, 131], [8, 228, 131], [8, 227, 131], [8, 226, 131], [10, 226, 132], [10, 226, 133], [8, 225, 133]],
    "britainApproach": [[8, 95, 102], [8, 94, 102], [8, 93, 102], [8, 92, 102], [8, 92, 102], [8, 91, 102], [8, 90, 102], [8, 89, 102], [8, 88, 102], [8, 87, 102], [8, 86, 102], [8, 85, 102], [8, 85, 102], [8, 84, 102], [10, 84, 103], [10, 84, 104], [8, 84, 104], [8, 84, 104], [8, 83, 104], [10, 83, 105], [8, 82, 105], [10, 82, 106]],
    "townApproach": [[21, 18], [10, 8], [21, 7], [10, 6], [21, 1]],
    "townReturn": [[8, 1], [11, 6], [8, 7], [11, 8], [8, 19]],
    "encounterApproach": [[21, 83, 106], [21, 84, 106], [21, 85, 106], [21, 86, 106], [21, 87, 106], [21, 88, 106], [21, 89, 106], [21, 90, 106], [21, 91, 106], [21, 92, 106], [21, 93, 106], [21, 94, 106], [21, 95, 106], [11, 95, 105], [21, 96, 105], [11, 96, 104], [21, 97, 104], [11, 97, 103], [21, 98, 103], [21, 99, 103], [11, 99, 102], [21, 100, 102], [21, 101, 102]],
    "waits": 15,
    "stops": {
      "moonDestination": {"address": 6163, "bytes": [173, 86, 24, 41]},
      "talkLoaded": {"address": 34816, "bytes": [162, 3, 189, 240]},
      "conversation": {"address": 34946, "bytes": [32, 33, 8, 141]},
      "joinCheck": {"address": 35583, "bytes": [165, 225, 208, 47]},
      "memberAdded": {"address": 35842, "bytes": [32, 105, 8, 32]},
      "firstTurn": {"address": 29143, "bytes": [32, 0, 8, 208, 3]}
    },
    "turns": [
      {"actor": 1, "keys": [21], "members": [{"health": 200, "experience": 132, "magic": 48, "position": [4, 5]}, {"health": 300, "experience": 240, "magic": 13, "position": [2, 4]}], "enemies": [[0, 6, 4, 107], [5, 7, 6, 109], [15, 9, 8, 45]], "next": 2},
      {"actor": 2, "keys": [21], "members": [{"health": 200, "experience": 132, "magic": 48, "position": [4, 5]}, {"health": 300, "experience": 240, "magic": 13, "position": [3, 4]}], "enemies": [[0, 5, 4, 107], [5, 7, 5, 109], [15, 8, 8, 45]], "next": 1},
      {"actor": 1, "keys": [21], "members": [{"health": 200, "experience": 132, "magic": 48, "position": [5, 5]}, {"health": 300, "experience": 240, "magic": 13, "position": [3, 4]}], "enemies": [[0, 5, 4, 107], [5, 7, 5, 109], [15, 8, 8, 45]], "next": 2},
      {"actor": 2, "keys": [65, 21], "members": [{"health": 200, "experience": 132, "magic": 48, "position": [5, 5]}, {"health": 300, "experience": 240, "magic": 13, "position": [3, 4]}], "enemies": [[0, 5, 4, 67], [5, 6, 5, 109], [15, 8, 7, 45]], "next": 1},
      {"actor": 1, "keys": [65, 11], "members": [{"health": 200, "experience": 132, "magic": 48, "position": [5, 5]}, {"health": 300, "experience": 240, "magic": 13, "position": [3, 4]}], "enemies": [[0, 5, 4, 47], [5, 6, 5, 109], [15, 8, 7, 45]], "next": 2},
      {"actor": 2, "keys": [65, 21], "members": [{"health": 200, "experience": 132, "magic": 48, "position": [5, 5]}, {"health": 300, "experience": 240, "magic": 13, "position": [3, 4]}], "enemies": [[0, 5, 4, 27], [5, 6, 5, 109], [15, 7, 7, 45]], "next": 1},
      {"actor": 1, "keys": [65, 11], "members": [{"health": 200, "experience": 132, "magic": 48, "position": [5, 5]}, {"health": 300, "experience": 240, "magic": 13, "position": [3, 4]}], "enemies": [[0, 5, 4, 27], [5, 6, 5, 109], [15, 7, 7, 45]], "next": 2},
      {"actor": 2, "keys": [65, 21], "members": [{"health": 200, "experience": 132, "magic": 48, "position": [5, 5]}, {"health": 300, "experience": 246, "magic": 13, "position": [3, 4]}], "enemies": [[5, 6, 5, 109], [15, 7, 6, 45]], "next": 1},
      {"actor": 1, "keys": [65, 21], "members": [{"health": 200, "experience": 132, "magic": 48, "position": [5, 5]}, {"health": 300, "experience": 246, "magic": 13, "position": [3, 4]}], "enemies": [[5, 6, 5, 85], [15, 7, 6, 45]], "next": 2},
      {"actor": 2, "keys": [21], "members": [{"health": 188, "experience": 132, "magic": 48, "position": [5, 5]}, {"health": 300, "experience": 246, "magic": 13, "position": [4, 4]}], "enemies": [[5, 6, 5, 85], [15, 7, 5, 45]], "next": 1},
      {"actor": 1, "keys": [65, 21], "members": [{"health": 188, "experience": 132, "magic": 48, "position": [5, 5]}, {"health": 300, "experience": 246, "magic": 13, "position": [4, 4]}], "enemies": [[5, 6, 5, 85], [15, 7, 5, 45]], "next": 2},
      {"actor": 2, "keys": [21], "members": [{"health": 188, "experience": 132, "magic": 48, "position": [5, 5]}, {"health": 300, "experience": 246, "magic": 13, "position": [5, 4]}], "enemies": [[5, 6, 5, 85], [15, 7, 6, 45]], "next": 1},
      {"actor": 1, "keys": [65, 21], "members": [{"health": 188, "experience": 132, "magic": 48, "position": [5, 5]}, {"health": 300, "experience": 246, "magic": 13, "position": [5, 4]}], "enemies": [[5, 6, 5, 57], [15, 7, 6, 45]], "next": 2},
      {"actor": 2, "keys": [21], "members": [{"health": 188, "experience": 132, "magic": 48, "position": [5, 5]}, {"health": 300, "experience": 246, "magic": 13, "position": [6, 4]}], "enemies": [[5, 6, 5, 57], [15, 6, 6, 45]], "next": 1},
      {"actor": 1, "keys": [65, 21], "members": [{"health": 188, "experience": 132, "magic": 48, "position": [5, 5]}, {"health": 300, "experience": 246, "magic": 13, "position": [6, 4]}], "enemies": [[5, 6, 5, 57], [15, 6, 6, 45]], "next": 2},
      {"actor": 2, "keys": [65, 10], "members": [{"health": 188, "experience": 132, "magic": 48, "position": [5, 5]}, {"health": 300, "experience": 246, "magic": 13, "position": [6, 4]}], "enemies": [[5, 6, 5, 57], [15, 5, 6, 45]], "next": 1},
      {"actor": 1, "keys": [65, 21], "members": [{"health": 188, "experience": 132, "magic": 48, "position": [5, 5]}, {"health": 300, "experience": 246, "magic": 13, "position": [6, 4]}], "enemies": [[5, 6, 5, 57], [15, 5, 6, 45]], "next": 2},
      {"actor": 2, "keys": [65, 10], "members": [{"health": 171, "experience": 132, "magic": 48, "position": [5, 5]}, {"health": 300, "experience": 246, "magic": 13, "position": [6, 4]}], "enemies": [[5, 6, 6, 23], [15, 5, 6, 45]], "next": 1},
      {"actor": 1, "keys": [65, 10], "members": [{"health": 171, "experience": 132, "magic": 48, "position": [5, 5]}, {"health": 300, "experience": 246, "magic": 13, "position": [6, 4]}], "enemies": [[5, 6, 6, 23], [15, 5, 6, 38]], "next": 2},
      {"actor": 2, "keys": [65, 10], "members": [{"health": 171, "experience": 132, "magic": 48, "position": [5, 5]}, {"health": 300, "experience": 246, "magic": 13, "position": [6, 4]}], "enemies": [[5, 6, 7, 7], [15, 5, 6, 38]], "next": 1},
      {"actor": 1, "keys": [65, 10], "members": [{"health": 171, "experience": 132, "magic": 48, "position": [5, 5]}, {"health": 300, "experience": 246, "magic": 13, "position": [6, 4]}], "enemies": [[5, 6, 7, 7], [15, 5, 6, 4]], "next": 2},
      {"actor": 2, "keys": [65, 10], "members": [{"health": 171, "experience": 132, "magic": 48, "position": [5, 5]}, {"health": 300, "experience": 246, "magic": 13, "position": [6, 4]}], "enemies": [[5, 7, 7, 2], [15, 5, 7, 4]], "next": 1},
      {"actor": 1, "keys": [10], "members": [{"health": 171, "experience": 132, "magic": 48, "position": [5, 6]}, {"health": 300, "experience": 246, "magic": 13, "position": [6, 4]}], "enemies": [[5, 7, 7, 2], [15, 5, 7, 4]], "next": 2},
      {"actor": 2, "keys": [21], "members": [{"health": 171, "experience": 132, "magic": 48, "position": [5, 6]}, {"health": 300, "experience": 246, "magic": 13, "position": [7, 4]}], "enemies": [[5, 7, 6, 2], [15, 6, 7, 4]], "next": 1},
      {"actor": 1, "keys": [21], "members": [{"health": 171, "experience": 132, "magic": 48, "position": [6, 6]}, {"health": 300, "experience": 246, "magic": 13, "position": [7, 4]}], "enemies": [[5, 7, 6, 2], [15, 6, 7, 4]], "next": 2},
      {"actor": 2, "keys": [65, 10], "members": [{"health": 171, "experience": 132, "magic": 48, "position": [6, 6]}, {"health": 300, "experience": 252, "magic": 13, "position": [7, 4]}], "enemies": [[15, 7, 7, 4]], "next": 1},
      {"actor": 1, "keys": [21], "members": [{"health": 171, "experience": 132, "magic": 48, "position": [7, 6]}, {"health": 300, "experience": 252, "magic": 13, "position": [7, 4]}], "enemies": [[15, 7, 7, 4]], "next": 2},
      {"actor": 2, "keys": [65, 10], "members": [{"health": 171, "experience": 132, "magic": 48, "position": [7, 6]}, {"health": 300, "experience": 258, "magic": 13, "position": [7, 4]}], "enemies": [], "next": 0}
    ],
    "healed": [{"health": 200, "experience": 132, "magic": 48}, {"health": 300, "experience": 258, "magic": 4}],
    "resumed": [101, 102],
    "continuation": [100, 102]
  },
  "rooms": {
    "image": {"bytes": 143360, "sha256": "90c63285ac0631ba1ebce2b0e98ba5d5e81f50ffc52529ececec0e2a51b38b6b"},
    "initial": [[200, 138, 23], [299, 282, 13]],
    "stops": {"read": {"address": 28338, "bytes": [32, 81, 8]}, "loaded": {"address": 28341, "bytes": [165, 11, 133]}, "placed": {"address": 28589, "bytes": [76, 125, 113]}, "leaving": {"address": 30320, "bytes": [32, 33, 8]}, "trigger": {"address": 31102, "bytes": [189, 16, 3]}, "triggered": {"address": 31169, "bytes": [76, 45, 114]}, "exitRejected": {"address": 31250, "bytes": [104, 104, 32]}},
    "approach": [11, 11, 8, 11, 21, 11, 11, 21],
    "enemies": [[3, 6, 7, 57, 196], [4, 6, 5, 31, 196], [5, 6, 2, 61, 196], [6, 5, 6, 47, 156], [10, 8, 6, 111, 156], [11, 8, 4, 44, 156], [13, 7, 3, 56, 156]],
    "turns": [
      {"actor": 1, "keys": [65, 21], "enemies": [[3, 6, 7, 57, 196], [4, 6, 5, 31, 196], [5, 6, 2, 28, 196], [6, 5, 6, 47, 156], [10, 8, 6, 111, 156], [11, 8, 4, 44, 156], [13, 7, 3, 56, 156]], "next": 2, "members": [[200, 138, 26, 3, 2], [299, 282, 13, 2, 2]]},
      {"actor": 2, "keys": [10], "enemies": [[3, 5, 7, 57, 196], [4, 6, 4, 31, 196], [5, 5, 2, 28, 196], [6, 5, 5, 47, 156], [10, 8, 5, 111, 156], [11, 7, 4, 44, 156], [13, 6, 3, 56, 156]], "next": 1, "members": [[200, 138, 27, 3, 2], [299, 282, 13, 2, 3]]},
      {"actor": 1, "keys": [65, 21], "enemies": [[3, 5, 7, 57, 196], [4, 6, 4, 31, 196], [5, 5, 2, 28, 196], [6, 5, 5, 47, 156], [10, 8, 5, 111, 156], [11, 7, 4, 44, 156], [13, 6, 3, 56, 156]], "next": 2, "members": [[200, 138, 27, 3, 2], [299, 282, 13, 2, 3]]},
      {"actor": 2, "keys": [21], "enemies": [[3, 4, 7, 57, 196], [4, 5, 4, 31, 196], [5, 4, 2, 28, 196], [6, 4, 5, 47, 156], [10, 7, 5, 111, 156], [11, 7, 3, 44, 156], [13, 5, 3, 56, 156]], "next": 1, "members": [[200, 138, 28, 3, 2], [299, 282, 13, 3, 3]]},
      {"actor": 1, "keys": [65, 21], "enemies": [[3, 4, 7, 57, 196], [4, 5, 4, 31, 196], [6, 4, 5, 47, 156], [10, 7, 5, 111, 156], [11, 7, 3, 44, 156], [13, 5, 3, 56, 156]], "next": 2, "members": [[200, 142, 28, 3, 2], [299, 282, 13, 3, 3]]},
      {"actor": 2, "keys": [65, 21], "enemies": [[3, 3, 7, 57, 196], [4, 4, 4, 31, 196], [6, 3, 5, 47, 156], [10, 7, 4, 111, 156], [11, 6, 3, 44, 156], [13, 4, 3, 56, 156]], "next": 1, "members": [[200, 142, 29, 3, 2], [299, 282, 13, 3, 3]]},
      {"actor": 1, "keys": [65, 10], "enemies": [[3, 3, 7, 57, 196], [4, 4, 4, 31, 196], [6, 3, 5, 6, 156], [10, 7, 4, 111, 156], [11, 6, 3, 44, 156], [13, 4, 3, 56, 156]], "next": 2, "members": [[200, 142, 29, 3, 2], [299, 282, 13, 3, 3]]},
      {"actor": 2, "keys": [65, 21], "enemies": [[3, 2, 7, 57, 196], [4, 3, 4, 31, 196], [6, 3, 6, 6, 156], [10, 7, 3, 111, 156], [11, 5, 3, 44, 156], [13, 4, 3, 56, 156]], "next": 1, "members": [[200, 142, 30, 3, 2], [286, 282, 13, 3, 3]]},
      {"actor": 1, "keys": [65, 10], "enemies": [[3, 2, 7, 57, 196], [4, 3, 4, 31, 196], [6, 3, 6, 6, 156], [10, 7, 3, 111, 156], [11, 5, 3, 44, 156], [13, 4, 3, 56, 156]], "next": 2, "members": [[200, 142, 30, 3, 2], [286, 282, 13, 3, 3]]},
      {"actor": 2, "keys": [65, 10], "enemies": [[3, 2, 6, 57, 196], [4, 3, 4, 30, 196], [6, 3, 7, 6, 156], [10, 6, 3, 111, 156], [11, 5, 2, 44, 156], [13, 4, 3, 56, 156]], "next": 1, "members": [[200, 142, 31, 3, 2], [286, 282, 13, 3, 3]]},
      {"actor": 1, "keys": [65, 10], "enemies": [[3, 2, 6, 57, 196], [4, 3, 4, 30, 196], [6, 3, 7, 6, 156], [10, 6, 3, 111, 156], [11, 5, 2, 44, 156], [13, 4, 3, 56, 156]], "next": 2, "members": [[200, 142, 31, 3, 2], [286, 282, 13, 3, 3]]},
      {"actor": 2, "keys": [65, 10], "enemies": [[3, 3, 6, 57, 196], [4, 3, 4, 30, 196], [6, 3, 8, 6, 156], [10, 5, 3, 111, 156], [11, 4, 2, 44, 156], [13, 4, 3, 56, 156]], "next": 1, "members": [[200, 142, 32, 3, 2], [286, 282, 13, 3, 3]]},
      {"actor": 1, "keys": [65, 21], "enemies": [[3, 3, 6, 57, 196], [4, 3, 4, 30, 196], [6, 3, 8, 6, 156], [10, 5, 3, 111, 156], [11, 4, 2, 44, 156], [13, 4, 3, 56, 156]], "next": 2, "members": [[200, 142, 32, 3, 2], [286, 282, 13, 3, 3]]},
      {"actor": 2, "keys": [65, 10], "enemies": [[3, 3, 5, 57, 196], [4, 3, 4, 30, 196], [6, 3, 9, 6, 156], [10, 5, 2, 111, 156], [11, 4, 2, 44, 156], [13, 4, 3, 56, 156]], "next": 1, "members": [[183, 142, 33, 3, 2], [286, 282, 13, 3, 3]]},
      {"actor": 1, "keys": [65, 21], "enemies": [[3, 3, 5, 57, 196], [4, 3, 4, 30, 196], [6, 3, 9, 6, 156], [10, 5, 2, 111, 156], [11, 4, 2, 44, 156], [13, 4, 3, 56, 156]], "next": 2, "members": [[183, 142, 33, 3, 2], [286, 282, 13, 3, 3]]},
      {"actor": 2, "keys": [65, 10], "enemies": [[3, 4, 5, 57, 196], [4, 3, 4, 30, 196], [6, 3, 10, 6, 156], [10, 6, 2, 111, 156], [11, 4, 2, 44, 156], [13, 4, 3, 56, 156]], "next": 1, "members": [[183, 142, 34, 3, 2], [285, 282, 13, 3, 3]]},
      {"actor": 1, "keys": [65, 21], "enemies": [[3, 4, 5, 57, 196], [4, 3, 4, 30, 196], [6, 3, 10, 6, 156], [10, 6, 2, 111, 156], [11, 4, 2, 8, 156], [13, 4, 3, 56, 156]], "next": 2, "members": [[183, 142, 34, 3, 2], [285, 282, 13, 3, 3]]},
      {"actor": 2, "keys": [65, 10], "enemies": [[3, 4, 4, 57, 196], [4, 3, 4, 27, 196], [10, 6, 3, 111, 156], [11, 4, 2, 8, 156], [13, 4, 3, 56, 156]], "next": 1, "members": [[183, 142, 35, 3, 2], [285, 282, 13, 3, 3]]},
      {"actor": 1, "keys": [65, 21], "enemies": [[3, 4, 4, 57, 196], [4, 3, 4, 27, 196], [10, 6, 3, 111, 156], [13, 4, 3, 56, 156]], "next": 2, "members": [[183, 148, 35, 3, 2], [285, 282, 13, 3, 3]]},
      {"actor": 2, "keys": [65, 10], "enemies": [[3, 4, 4, 57, 196], [4, 3, 4, 27, 196], [10, 5, 3, 111, 156], [13, 4, 3, 56, 156]], "next": 1, "members": [[183, 148, 36, 3, 2], [285, 282, 13, 3, 3]]},
      {"actor": 1, "keys": [65, 10], "enemies": [[3, 4, 4, 57, 196], [4, 3, 4, 3, 196], [10, 5, 3, 111, 156], [13, 4, 3, 56, 156]], "next": 2, "members": [[183, 148, 36, 3, 2], [285, 282, 13, 3, 3]]},
      {"actor": 2, "keys": [65, 10], "enemies": [[3, 3, 4, 57, 196], [10, 5, 2, 111, 156], [13, 4, 3, 56, 156]], "next": 1, "members": [[183, 148, 37, 3, 2], [285, 286, 13, 3, 3]]},
      {"actor": 1, "keys": [65, 10], "enemies": [[3, 3, 4, 8, 196], [10, 5, 2, 111, 156], [13, 4, 3, 56, 156]], "next": 2, "members": [[183, 148, 37, 3, 2], [285, 286, 13, 3, 3]]},
      {"actor": 2, "keys": [65, 10], "enemies": [[10, 4, 2, 111, 156], [13, 4, 3, 56, 156]], "next": 1, "members": [[183, 148, 38, 3, 2], [285, 290, 13, 3, 3]]},
      {"actor": 1, "keys": [65, 21], "enemies": [[10, 4, 2, 111, 156], [13, 4, 3, 56, 156]], "next": 2, "members": [[183, 148, 38, 3, 2], [285, 290, 13, 3, 3]]},
      {"actor": 2, "keys": [65, 21], "enemies": [[10, 4, 2, 111, 156], [13, 4, 3, 34, 156]], "next": 1, "members": [[183, 148, 39, 3, 2], [285, 290, 13, 3, 3]]},
      {"actor": 1, "keys": [65, 21], "enemies": [[10, 4, 2, 111, 156], [13, 4, 3, 34, 156]], "next": 2, "members": [[183, 148, 39, 3, 2], [285, 290, 13, 3, 3]]},
      {"actor": 2, "keys": [65, 21], "enemies": [[10, 4, 2, 111, 156], [13, 4, 3, 34, 156]], "next": 1, "members": [[183, 148, 40, 3, 2], [285, 290, 13, 3, 3]]},
      {"actor": 1, "keys": [65, 21], "enemies": [[10, 4, 2, 111, 156], [13, 4, 3, 34, 156]], "next": 2, "members": [[183, 148, 40, 3, 2], [285, 290, 13, 3, 3]]},
      {"actor": 2, "keys": [65, 21], "enemies": [[10, 4, 2, 111, 156]], "next": 1, "members": [[183, 148, 41, 3, 2], [285, 296, 13, 3, 3]]},
      {"actor": 1, "keys": [65, 21], "enemies": [[10, 4, 2, 73, 156]], "next": 2, "members": [[183, 148, 41, 3, 2], [285, 296, 13, 3, 3]]},
      {"actor": 2, "keys": [21], "enemies": [[10, 4, 2, 73, 156]], "next": 1, "members": [[183, 148, 42, 3, 2], [279, 296, 13, 4, 3]]},
      {"actor": 1, "keys": [65, 21], "enemies": [[10, 4, 2, 35, 156]], "next": 2, "members": [[183, 148, 42, 3, 2], [279, 296, 13, 4, 3]]},
      {"actor": 2, "keys": [65, 11], "enemies": [[10, 4, 1, 13, 156]], "next": 1, "members": [[183, 148, 43, 3, 2], [279, 296, 13, 4, 3]]},
      {"actor": 1, "keys": [21], "enemies": [[10, 4, 1, 13, 156]], "next": 2, "members": [[183, 148, 43, 4, 2], [279, 296, 13, 4, 3]]},
      {"actor": 2, "keys": [65, 11], "enemies": [[10, 4, 0, 13, 156]], "next": 1, "members": [[183, 148, 44, 4, 2], [279, 296, 13, 4, 3]]},
      {"actor": 1, "keys": [65, 11], "enemies": [], "next": 2, "members": [[183, 154, 44, 4, 2], [279, 296, 13, 4, 3]]}
    ],
    "exits": [
      {"actor": 2, "key": 8, "next": 1, "positions": [4, 3, 2, 3], "active": [32, 34], "exit": [0, 0], "pc": 29143},
      {"actor": 1, "key": 11, "next": 2, "positions": [4, 3, 1, 3], "active": [32, 34], "exit": [0, 0], "pc": 29143},
      {"actor": 2, "key": 11, "next": 1, "positions": [4, 3, 1, 2], "active": [32, 34], "exit": [0, 0], "pc": 29143},
      {"actor": 1, "key": 11, "next": 2, "positions": [4, 3, 0, 2], "active": [32, 34], "exit": [0, 0], "pc": 29143},
      {"actor": 2, "key": 11, "next": 1, "positions": [4, 3, 0, 1], "active": [32, 34], "exit": [0, 0], "pc": 29143},
      {"actor": 1, "key": 11, "next": 2, "positions": [128, 3, 128, 1], "active": [0, 34], "exit": [0, 255], "pc": 29143},
      {"actor": 2, "key": 11, "next": 2, "positions": [128, 3, 128, 0], "active": [0, 34], "exit": [0, 255], "pc": 29143},
      {"actor": 2, "key": 11, "next": 2, "positions": [128, 128, 128, 128], "active": [0, 0], "exit": [0, 255], "pc": 30320}
    ],
    "return": [8, 11, 11, 8, 11, 21, 11, 11],
    "final": [[183, 154, 48], [279, 296, 13]],
    "rules": {
      "approach": [21, 11, 11, 11, 21, 11, 21, 21],
      "east": [11, 8, 8, 10, 10, 10, 21, 21, 21, 21],
      "lower": [8, 8, 8, 10, 10],
      "north": [8, 8, 11, 11, 11, 11, 11, 8, 8, 11, 11],
      "changes": [[9, 5, 127, 22], [10, 5, 126, 22], [10, 4, 126, 127], [10, 6, 126, 127]],
      "reenteredEnemies": [[3, 6, 7, 63, 196], [4, 6, 5, 27, 196], [5, 6, 2, 57, 196], [6, 5, 6, 110, 156], [10, 8, 6, 42, 156], [11, 8, 4, 111, 156], [13, 7, 3, 44, 156]]
    }
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
    },
    {
      "id": "ultima4-magic", "title": "Ultima IV · mixing and healing",
      "setup": "Follow the guide’s Moonglow shopping trip from the combat save, retaining a writable Britannia copy. Return to the world with three ginseng and three spider silk. Pause to queue each key with screen Inspect off, then run to its next checkpoint. Type one prompt at a time; the game’s keyboard buffer is bounded. No Return follows Cast choices. Use the party/save tour after healing.",
      "requires": ["stops.command", "magic.stops.spellChoice", "magic.stops.healed"],
      "steps": [
        {
          "title": "Choose a mixture", "stop": "magic.stops.mixChoice",
          "prepare": "At the world command prompt, queue M and run. After finishing a mixture with Return, reuse this stop to choose another.",
          "observe": "The MIX overlay has loaded at $8800. The mage’s initial reagents are ginseng 03, garlic 04, and purchased spider silk 03. Choose H for Heal.",
          "when": [{"address": 34816, "bytes": [76, 23, 136]}], "limit": 30000000,
          "inspect": [
            {"label": "Reagents A–H", "address": 60728, "space": "lc-upper"},
            {"label": "Prepared Heal spells", "address": 60743, "space": "lc-upper"},
            {"label": "Mage MP and HP", "address": 60438, "space": "lc-upper"}
          ]
        },
        {
          "title": "Choose a reagent", "stop": "magic.stops.reagent",
          "prepare": "From Choose a mixture, queue H. Reuse this stop after B for ginseng, then D for spider silk.",
          "observe": "Each reagent is consumed immediately. $890B accumulates its recipe bit: ginseng 40, spider silk 10, together 50. Heal’s recipe is $8A12=50. Return completes the mixture.",
          "when": [{"address": 34816, "bytes": [76, 23, 136]}], "limit": 2000000,
          "inspect": [
            {"label": "Reagents A–H", "address": 60728, "space": "lc-upper"},
            {"label": "Prepared Heal spells", "address": 60743, "space": "lc-upper"},
            {"label": "Mage MP and HP", "address": 60438, "space": "lc-upper"}
          ]
        },
        {
          "title": "Heal mixture stored", "stop": "magic.stops.mixtureStored",
          "prepare": "After B and D have returned to Choose a reagent, queue Return and run here.",
          "observe": "SUCCESS! has printed and $ED47 has increased by one in decimal. The first mixture leaves two ginseng and two silk; the second leaves one of each. Continue to Choose a mixture. After two mixtures, queue Escape and use the world-command stop to leave Mix.",
          "when": [{"address": 34816, "bytes": [76, 23, 136]}, {"address": 35337, "bytes": [7]}], "limit": 2000000,
          "inspect": [
            {"label": "Reagents A–H", "address": 60728, "space": "lc-upper"},
            {"label": "Prepared Heal spells", "address": 60743, "space": "lc-upper"},
            {"label": "Mage MP and HP", "address": 60438, "space": "lc-upper"}
          ]
        },
        {
          "title": "Choose a spell to cast", "stop": "magic.stops.spellChoice",
          "prepare": "At the world command prompt, queue C and 1, then run here.",
          "observe": "The mage’s two Heal mixtures appear as H-02. MP is 48 and HP 0185. Queue H and select the next stop.",
          "when": [], "limit": 2000000,
          "inspect": [
            {"label": "Reagents A–H", "address": 60728, "space": "lc-upper"},
            {"label": "Prepared Heal spells", "address": 60743, "space": "lc-upper"},
            {"label": "Mage MP and HP", "address": 60438, "space": "lc-upper"}
          ]
        },
        {
          "title": "Heal resources charged", "stop": "magic.stops.charged",
          "prepare": "From Choose a spell to cast, queue H and run.",
          "observe": "One mixture has been consumed and MP has fallen from 48 to 38. HP is still 0185. Continue to Choose whom to heal.",
          "when": [], "limit": 2000000,
          "inspect": [
            {"label": "Reagents A–H", "address": 60728, "space": "lc-upper"},
            {"label": "Prepared Heal spells", "address": 60743, "space": "lc-upper"},
            {"label": "Mage MP and HP", "address": 60438, "space": "lc-upper"}
          ]
        },
        {
          "title": "Choose whom to heal", "stop": "magic.stops.healTarget",
          "prepare": "Continue after the resource charge, then queue 1 for the mage before running to Healing amount.",
          "observe": "WHO- asks for the recipient. The mixture and MP have already been spent.",
          "when": [], "limit": 2000000,
          "inspect": [
            {"label": "Reagents A–H", "address": 60728, "space": "lc-upper"},
            {"label": "Prepared Heal spells", "address": 60743, "space": "lc-upper"},
            {"label": "Mage MP and HP", "address": 60438, "space": "lc-upper"}
          ]
        },
        {
          "title": "Healing amount", "stop": "magic.stops.healAmount",
          "prepare": "From Choose whom to heal, queue 1 and run.",
          "observe": "A holds the packed-decimal healing roll, 75–99. The repeatable route gives 87. HP is still 0185; the next call adds the roll and caps it at the character’s maximum.",
          "when": [], "limit": 2000000,
          "inspect": [
            {"label": "Reagents A–H", "address": 60728, "space": "lc-upper"},
            {"label": "Prepared Heal spells", "address": 60743, "space": "lc-upper"},
            {"label": "Mage MP and HP", "address": 60438, "space": "lc-upper"}
          ]
        },
        {
          "title": "Healing applied", "stop": "magic.stops.healed",
          "prepare": "Continue from Healing amount.",
          "observe": "The mage is at HP 0200. The addition first produces 0272, then the maximum-HP check caps it at 0200. MP remains 38 until the turn finishes.",
          "when": [], "limit": 2000000,
          "inspect": [
            {"label": "Reagents A–H", "address": 60728, "space": "lc-upper"},
            {"label": "Prepared Heal spells", "address": 60743, "space": "lc-upper"},
            {"label": "Mage MP and HP", "address": 60438, "space": "lc-upper"}
          ]
        },
        {
          "title": "World ready after healing", "stop": "stops.command",
          "prepare": "Continue after Healing applied. Use the party/save tour to save, export and reload the disk.",
          "observe": "DONE. has printed. HP is 0200, experience 0132, gold 0191, and one Heal mixture remains. The completed turn restores one MP, from 38 to 39.",
          "when": [{"address": 11, "bytes": [1]}], "limit": 2000000,
          "inspect": [
            {"label": "Reagents A–H", "address": 60728, "space": "lc-upper"},
            {"label": "Prepared Heal spells", "address": 60743, "space": "lc-upper"},
            {"label": "Mage MP and HP", "address": 60438, "space": "lc-upper"}
          ]
        }
      ]
    },
    {
      "id": "ultima4-companions",
      "title": "Ultima IV · companions and targeting",
      "setup": "Start from ultima_iv_br-magic-saved.dsk after a fresh Boot / Journey onward load. Follow the guide’s Moonglow–Britain route, retain a writable Britannia copy across the Town exchange, and recruit Iolo. Queue keys only while paused, with screen Inspect off. Each walkthrough stop checks code and context; arbitrary additional turns may change encounters.",
      "requires": ["stops.command", "magic.stops.healed"],
      "steps": [
        {
          "title": "Moongate leads to Britain",
          "stop": "companions.stops.moonDestination",
          "prepare": "Follow the guide from the magic export to (225,133). Run here without a key; let the moons advance in the input loop. At the stop, queue Left and use World command ready in the party tour.",
          "observe": "Trammel is phase 0, opening the Moonglow gate at (224,133). Felucca is phase 1, choosing Britain at (96,102). Stepping left traverses it. Space would pass a turn and move nearby monsters.",
          "when": [{"address": 11, "bytes": [1]}, {"address": 18, "bytes": [0, 1]}],
          "inspect": [{"label": "Moon phases", "address": 18, "space": "ram"}, {"label": "Moon clock", "address": 6229, "space": "ram"}, {"label": "World position", "address": 0, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Iolo conversation",
          "stop": "companions.stops.conversation",
          "prepare": "In Britain, reach (27,29), queue T then Right, and run. Wait here before typing JOIN and Return.",
          "observe": "TALK has loaded from Town. Iolo is object 31 at (28,29); his conversation is number 1. The keyword reader is about to ask Your interest.",
          "when": [{"address": 11, "bytes": [2]}, {"address": 10, "bytes": [6]}, {"address": 34816, "bytes": [162, 3]}],
          "inspect": [{"label": "Party size", "address": 15, "space": "ram"}, {"label": "DROMAIOS record", "address": 60416, "space": "lc-upper"}, {"label": "Iolo record", "address": 60448, "space": "lc-upper"}, {"label": "Selected character", "address": 212, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Recruitment checks",
          "stop": "companions.stops.joinCheck",
          "prepare": "At Iolo conversation, queue JOIN and Return, then run.",
          "observe": "JOIN checks conversation 1, the town and class, Compassion (60, at least 40), and level (2, greater than the one-member party). The mage has a different class from Iolo.",
          "when": [{"address": 11, "bytes": [2]}, {"address": 10, "bytes": [6]}, {"address": 34816, "bytes": [162, 3]}],
          "inspect": [{"label": "Party size", "address": 15, "space": "ram"}, {"label": "DROMAIOS record", "address": 60416, "space": "lc-upper"}, {"label": "Iolo record", "address": 60448, "space": "lc-upper"}, {"label": "Compassion", "address": 60673, "space": "lc-upper"}],
          "limit": 30000000
        },
        {
          "title": "Iolo added to the party",
          "stop": "companions.stops.memberAdded",
          "prepare": "Continue from Recruitment checks.",
          "observe": "The party count has increased to two. The game has swapped 32 bytes into the new last record; Iolo was already second, so this is a swap with itself. His town object has been cleared. Continue to a town command before moving.",
          "when": [{"address": 11, "bytes": [2]}, {"address": 15, "bytes": [2]}, {"address": 34816, "bytes": [162, 3]}],
          "inspect": [{"label": "Party size", "address": 15, "space": "ram"}, {"label": "DROMAIOS record", "address": 60416, "space": "lc-upper"}, {"label": "Iolo record", "address": 60448, "space": "lc-upper"}, {"label": "Selected character", "address": 212, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Britain command ready",
          "stop": "stops.command",
          "prepare": "Run here after inserting Town, after Iolo joins, or after queuing each town movement. For the final step out of town, use the disk-request stop or wait for its prompt.",
          "observe": "The shared command loop is waiting in Britain (location 6, mode 2). The party count changes from one to two after recruitment. Iolo starts at (28,29) and disappears from the town when he joins.",
          "when": [{"address": 10, "bytes": [6, 2]}],
          "inspect": [{"label": "Town position and mode", "address": 0, "space": "ram"}, {"label": "Party size", "address": 15, "space": "ram"}, {"label": "Iolo record", "address": 60448, "space": "lc-upper"}],
          "limit": 30000000
        },
        {
          "title": "DROMAIOS combat turn",
          "stop": "companions.stops.firstTurn",
          "prepare": "Follow the guide back to Britannia and into the orc encounter. Queue the next action from its table, or continue to this character’s next turn.",
          "observe": "$D4 is 1: the command belongs to DROMAIOS. Each character moves and attacks from a separate position. Enemy turns follow Iolo’s turn; experience from a kill belongs to its attacker.",
          "when": [{"address": 11, "bytes": [128]}, {"address": 15, "bytes": [2]}, {"address": 212, "bytes": [1]}],
          "inspect": [{"label": "DROMAIOS HP / XP", "address": 60440, "space": "lc-upper"}, {"label": "Iolo HP / XP", "address": 60472, "space": "lc-upper"}, {"label": "Combat positions", "address": 61312, "space": "lc-upper"}, {"label": "Enemy HP", "address": 61248, "space": "lc-upper"}],
          "limit": 30000000
        },
        {
          "title": "Iolo combat turn",
          "stop": "companions.stops.firstTurn",
          "prepare": "Follow the guide back to Britannia and into the orc encounter. Queue the next action from its table, or continue to this character’s next turn.",
          "observe": "$D4 is 2: the command belongs to Iolo. Each character moves and attacks from a separate position. Enemy turns follow Iolo’s turn; experience from a kill belongs to its attacker.",
          "when": [{"address": 11, "bytes": [128]}, {"address": 15, "bytes": [2]}, {"address": 212, "bytes": [2]}],
          "inspect": [{"label": "DROMAIOS HP / XP", "address": 60440, "space": "lc-upper"}, {"label": "Iolo HP / XP", "address": 60472, "space": "lc-upper"}, {"label": "Combat positions", "address": 61312, "space": "lc-upper"}, {"label": "Enemy HP", "address": 61248, "space": "lc-upper"}],
          "limit": 30000000
        },
        {
          "title": "Two-character victory",
          "stop": "stops.command",
          "prepare": "Finish the recorded encounter. Run here after the final Iolo attack.",
          "observe": "The verified result is DROMAIOS at 171 HP / 132 XP and Iolo at 300 HP / 258 XP. Three orcs were killed, all by Iolo. Both characters remain active, and the prepared Heal mixture remains available.",
          "when": [{"address": 11, "bytes": [1]}, {"address": 15, "bytes": [2]}],
          "inspect": [{"label": "Party size", "address": 15, "space": "ram"}, {"label": "DROMAIOS record", "address": 60416, "space": "lc-upper"}, {"label": "Iolo record", "address": 60448, "space": "lc-upper"}, {"label": "Selected character", "address": 212, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Iolo chooses Heal",
          "stop": "magic.stops.spellChoice",
          "prepare": "At the world prompt, queue C then 2. Run here before choosing H.",
          "observe": "The caster selection is 2, Iolo. He has 13 MP in this route. The mage’s 48 MP belongs to a separate record.",
          "when": [{"address": 11, "bytes": [1]}, {"address": 15, "bytes": [2]}, {"address": 212, "bytes": [2]}],
          "inspect": [{"label": "Caster: Iolo MP", "address": 60470, "space": "lc-upper"}, {"label": "Recipient: mage HP", "address": 60440, "space": "lc-upper"}, {"label": "Heal mixtures", "address": 60743, "space": "lc-upper"}, {"label": "Selected character", "address": 212, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Iolo pays for Heal",
          "stop": "magic.stops.charged",
          "prepare": "Queue H and run.",
          "observe": "The shared Heal count has fallen from 1 to 0. Iolo paid 10 MP (13 to 3). Neither character’s HP has changed, and the mage still has 48 MP.",
          "when": [{"address": 11, "bytes": [1]}, {"address": 15, "bytes": [2]}, {"address": 212, "bytes": [2]}],
          "inspect": [{"label": "Caster: Iolo MP", "address": 60470, "space": "lc-upper"}, {"label": "Recipient: mage HP", "address": 60440, "space": "lc-upper"}, {"label": "Heal mixtures", "address": 60743, "space": "lc-upper"}, {"label": "Selected character", "address": 212, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Select Heal recipient",
          "stop": "magic.stops.healTarget",
          "prepare": "Continue from Iolo pays for Heal. Queue 1 only after reaching this prompt.",
          "observe": "The game asks which character to heal independently of the caster. Choose 1 for the wounded mage, while 2 identifies Iolo.",
          "when": [{"address": 11, "bytes": [1]}, {"address": 15, "bytes": [2]}],
          "inspect": [{"label": "Caster: Iolo MP", "address": 60470, "space": "lc-upper"}, {"label": "Recipient: mage HP", "address": 60440, "space": "lc-upper"}, {"label": "Heal mixtures", "address": 60743, "space": "lc-upper"}, {"label": "Selected character", "address": 212, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Mage healed by Iolo",
          "stop": "magic.stops.healed",
          "prepare": "Queue 1 and run.",
          "observe": "The selected record is now the mage. Heal adds a binary roll of 75–99 converted to packed decimal, then caps HP at 200. Iolo remains at 300 HP and 3 MP; the next ordinary world turn regenerates his MP to 4.",
          "when": [{"address": 11, "bytes": [1]}, {"address": 15, "bytes": [2]}, {"address": 212, "bytes": [1]}],
          "inspect": [{"label": "Caster: Iolo MP", "address": 60470, "space": "lc-upper"}, {"label": "Recipient: mage HP", "address": 60440, "space": "lc-upper"}, {"label": "Heal mixtures", "address": 60743, "space": "lc-upper"}, {"label": "Selected character", "address": 212, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Both characters ready to save",
          "stop": "stops.command",
          "prepare": "Continue after Mage healed by Iolo. Use the party/save tour for Q, export, and the subsequent Boot disk / Journey onward exchange.",
          "observe": "DROMAIOS has 200 HP, 132 XP and 48 MP; Iolo has 300 HP, 258 XP and 4 MP. Both 32-byte records are part of ROST, and PRTY holds the party count of two. The fresh export resumes at (101,102).",
          "when": [{"address": 11, "bytes": [1]}, {"address": 15, "bytes": [2]}],
          "inspect": [{"label": "Party size", "address": 15, "space": "ram"}, {"label": "DROMAIOS record", "address": 60416, "space": "lc-upper"}, {"label": "Iolo record", "address": 60448, "space": "lc-upper"}, {"label": "Selected character", "address": 212, "space": "ram"}],
          "limit": 30000000
        }
      ]
    },
    {
      "id": "ultima4-rooms",
      "title": "Ultima IV · dungeon room",
      "setup": "Start from ultima_iv_br-room-ready.dsk, the prepared DROMAIOS/Iolo expedition save, with the original Boot and Underworld disks. The guide gives the room’s command sequence; queue one action at a time. Return to the same writable Britannia copy and export after Q.",
      "requires": ["stops.command", "save.start"],
      "steps": [
        {
          "title": "Outside Covetous",
          "stop": "stops.command",
          "prepare": "Boot the verified room-ready Britannia export using Journey onward. Use a writable copy and retain it for the return.",
          "observe": "DROMAIOS and Iolo stand at (156,27), with slings, two Heal mixtures and two Light mixtures.",
          "when": [{"address": 0, "bytes": [156, 27]}, {"address": 11, "bytes": [1]}, {"address": 15, "bytes": [2]}],
          "inspect": [{"label": "Both characters", "address": 60416, "space": "lc-upper"}, {"label": "Party and dungeon position", "address": 0, "space": "ram"}, {"label": "Light and Heal mixtures", "address": 60743, "space": "lc-upper"}],
          "limit": 30000000
        },
        {
          "title": "Covetous entrance",
          "stop": "stops.command",
          "prepare": "Press E, wait for the Underworld request, swap in ultima_iv_under.dsk read-only, then queue Escape.",
          "observe": "Mode 3: level 1 at (1,1), facing east. Cast C,1,L to light the dungeon before approaching the room.",
          "when": [{"address": 0, "bytes": [1, 1]}, {"address": 10, "bytes": [21, 3, 0]}],
          "inspect": [{"label": "Both characters", "address": 60416, "space": "lc-upper"}, {"label": "Party and dungeon position", "address": 0, "space": "ram"}, {"label": "Light and Heal mixtures", "address": 60743, "space": "lc-upper"}, {"label": "Eight dungeon levels", "address": 59392, "space": "lc-upper"}],
          "limit": 30000000
        },
        {
          "title": "Dungeon command ready",
          "stop": "stops.command",
          "prepare": "Queue one dungeon move or spell, then run here. Use this repeatable stop for Light and the approach or return route.",
          "observe": "The party is exploring Covetous in mode 3. Up advances and Left/Right turn. This stop does not match the room combat loop.",
          "when": [{"address": 10, "bytes": [21, 3]}, {"address": 15, "bytes": [2]}],
          "inspect": [{"label": "Position, level and facing", "address": 0, "space": "ram"}, {"label": "Dungeon map", "address": 59392, "space": "lc-upper"}],
          "limit": 30000000
        },
        {
          "title": "Read room zero",
          "stop": "rooms.stops.read",
          "prepare": "After Light returns to the prompt: Up, Up, Left, Up, Right, Up, Up, Right, stopping at each command. Queue one final Up for this stop.",
          "observe": "The D0 square at (5,1) requests raw Underworld track 4, sector 0, one sector into page $02.",
          "when": [{"address": 0, "bytes": [5, 1]}, {"address": 10, "bytes": [21, 3]}, {"address": 224, "bytes": [4, 0, 1, 2]}],
          "inspect": [{"label": "Raw disk parameters", "address": 224, "space": "ram"}, {"label": "Room square", "address": 59405, "space": "lc-upper"}, {"label": "Destination buffer", "address": 512, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Room sector in RAM",
          "stop": "rooms.stops.loaded",
          "prepare": "Continue without a key after the sector-read request.",
          "observe": "All 256 bytes occupy $0200–$02FF: triggers, enemies, four entrance formations, and the 11 × 11 map at $0280.",
          "when": [{"address": 0, "bytes": [5, 1]}, {"address": 10, "bytes": [21, 3]}, {"address": 224, "bytes": [4, 0, 1, 2]}],
          "inspect": [{"label": "Raw room sector", "address": 512, "space": "ram"}, {"label": "Enemy templates", "address": 528, "space": "ram"}, {"label": "Entrance formations", "address": 576, "space": "ram"}, {"label": "Battlefield", "address": 640, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Room actors placed",
          "stop": "rooms.stops.placed",
          "prepare": "Continue without a key.",
          "observe": "Mode $81 is a dungeon room. The north formation places the mage at (3,2) and Iolo at (2,2); seven enemies have binary HP. Triggers are copied before text overwrites the sector header.",
          "when": [{"address": 0, "bytes": [5, 1]}, {"address": 10, "bytes": [21, 129]}, {"address": 15, "bytes": [2]}],
          "inspect": [{"label": "Retained triggers", "address": 784, "space": "ram"}, {"label": "11 × 11 battlefield", "address": 640, "space": "ram"}, {"label": "Enemy positions", "address": 61184, "space": "lc-upper"}, {"label": "Enemy HP and active slots", "address": 61248, "space": "lc-upper"}, {"label": "Party positions and active slots", "address": 61312, "space": "lc-upper"}, {"label": "Both character records", "address": 60416, "space": "lc-upper"}],
          "limit": 30000000
        },
        {
          "title": "DROMAIOS room turn",
          "stop": "companions.stops.firstTurn",
          "prepare": "Continue to the first turn, or queue the current character’s next action from the guide before running.",
          "observe": "Actor $D4 selects this character. Killing the last enemy keeps room mode active; both characters must walk out.",
          "when": [{"address": 0, "bytes": [5, 1]}, {"address": 10, "bytes": [21, 129]}, {"address": 15, "bytes": [2]}, {"address": 212, "bytes": [1]}],
          "inspect": [{"label": "11 × 11 battlefield", "address": 640, "space": "ram"}, {"label": "Enemy positions", "address": 61184, "space": "lc-upper"}, {"label": "Enemy HP and active slots", "address": 61248, "space": "lc-upper"}, {"label": "Party positions and active slots", "address": 61312, "space": "lc-upper"}, {"label": "Both character records", "address": 60416, "space": "lc-upper"}, {"label": "Current actor", "address": 212, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Iolo room turn",
          "stop": "companions.stops.firstTurn",
          "prepare": "Continue to the first turn, or queue the current character’s next action from the guide before running.",
          "observe": "Actor $D4 selects this character. Killing the last enemy keeps room mode active; both characters must walk out.",
          "when": [{"address": 0, "bytes": [5, 1]}, {"address": 10, "bytes": [21, 129]}, {"address": 15, "bytes": [2]}, {"address": 212, "bytes": [2]}],
          "inspect": [{"label": "11 × 11 battlefield", "address": 640, "space": "ram"}, {"label": "Enemy positions", "address": 61184, "space": "lc-upper"}, {"label": "Enemy HP and active slots", "address": 61248, "space": "lc-upper"}, {"label": "Party positions and active slots", "address": 61312, "space": "lc-upper"}, {"label": "Both character records", "address": 60416, "space": "lc-upper"}, {"label": "Current actor", "address": 212, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Mage has left north",
          "stop": "companions.stops.firstTurn",
          "prepare": "After the last enemy: Iolo Left; mage Up; Iolo Up; mage Up; Iolo Up; then queue mage Up for this stop.",
          "observe": "Only Iolo remains active. The mage’s position is $80,$80 and the recorded exit is north ($00,$FF). Iolo must use the same exit.",
          "when": [{"address": 0, "bytes": [5, 1]}, {"address": 10, "bytes": [21, 129]}, {"address": 15, "bytes": [2]}, {"address": 212, "bytes": [2]}, {"address": 31356, "bytes": [0, 255]}],
          "inspect": [{"label": "Exit direction", "address": 31356, "space": "ram"}, {"label": "Party positions and active slots", "address": 61312, "space": "lc-upper"}],
          "limit": 30000000
        },
        {
          "title": "Both characters leave",
          "stop": "rooms.stops.leaving",
          "prepare": "Iolo Up reaches row 0. Queue another Up for this stop.",
          "observe": "Both active tiles are zero and both positions are $80,$80. The room now returns to dungeon exploration.",
          "when": [{"address": 0, "bytes": [5, 1]}, {"address": 10, "bytes": [21, 129]}, {"address": 15, "bytes": [2]}, {"address": 31356, "bytes": [0, 255]}],
          "inspect": [{"label": "Exit direction", "address": 31356, "space": "ram"}, {"label": "Party positions and active slots", "address": 61312, "space": "lc-upper"}, {"label": "Both character records", "address": 60416, "space": "lc-upper"}],
          "limit": 30000000
        },
        {
          "title": "Back in the corridor",
          "stop": "stops.command",
          "prepare": "Continue without a key.",
          "observe": "Mode 3, (5,0), facing north. The dungeon room square remains D0; clearing the room is not a persistent cleared-room flag.",
          "when": [{"address": 0, "bytes": [5, 0]}, {"address": 10, "bytes": [21, 3, 0]}, {"address": 16, "bytes": [0]}],
          "inspect": [{"label": "Position and mode", "address": 0, "space": "ram"}, {"label": "Dungeon map and room square", "address": 59392, "space": "lc-upper"}, {"label": "Both character records", "address": 60416, "space": "lc-upper"}],
          "limit": 30000000
        },
        {
          "title": "Back in Britannia",
          "stop": "stops.command",
          "prepare": "Left, Up, Up, Left, Up, Right, Up, Up returns to the ladder. Press K; at the request swap back to the retained writable Britannia disk, then queue Escape.",
          "observe": "DROMAIOS has 183 HP and 154 XP; Iolo has 279 HP and 296 XP. Use the party/save tour for Q, export and the fresh Journey onward load.",
          "when": [{"address": 0, "bytes": [156, 27]}, {"address": 11, "bytes": [1]}, {"address": 15, "bytes": [2]}],
          "inspect": [{"label": "Both characters", "address": 60416, "space": "lc-upper"}, {"label": "Party and dungeon position", "address": 0, "space": "ram"}, {"label": "Light and Heal mixtures", "address": 60743, "space": "lc-upper"}],
          "limit": 30000000
        }
      ]
    },
    {
      "id": "ultima4-room-rules",
      "title": "Ultima IV · room triggers and exits",
      "setup": "Continue immediately after the verified 37-action room battle, with Iolo’s turn pending. Keep a cleared-room laboratory checkpoint: this inspection route re-enters a populated room, while the original room tour provides the save-and-return route.",
      "requires": ["stops.command", "save.start"],
      "steps": [
        {
          "title": "North exit committed",
          "stop": "companions.stops.firstTurn",
          "prepare": "Start immediately after the first room battle. Iolo Right; mage Up; Iolo Up; mage Up; Iolo Right; mage Up. Use the original room tour for alternating turns, with this stop for the last move.",
          "observe": "DROMAIOS has left north. Iolo remains at (6,2); the recorded exit is $00,$FF. Save a laboratory checkpoint here if desired.",
          "when": [{"address": 0, "bytes": [5, 1]}, {"address": 10, "bytes": [21, 129]}, {"address": 15, "bytes": [2]}, {"address": 212, "bytes": [2]}, {"address": 31356, "bytes": [0, 255]}],
          "inspect": [{"label": "Party positions and active slots", "address": 61312, "space": "lc-upper"}, {"label": "Recorded exit direction", "address": 31356, "space": "ram"}, {"label": "Current actor", "address": 212, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Iolo room command",
          "stop": "companions.stops.firstTurn",
          "prepare": "Queue one of Iolo’s movements from the guide, then run here. Use this repeatable stop while he is the only character still in the room.",
          "observe": "Mode $81 remains active and $D4 selects Iolo. This also finishes a trigger or rejected-exit operation without another key.",
          "when": [{"address": 0, "bytes": [5, 1]}, {"address": 10, "bytes": [21, 129]}, {"address": 15, "bytes": [2]}, {"address": 212, "bytes": [2]}, {"address": 31356, "bytes": [0, 255]}],
          "inspect": [{"label": "Party positions and active slots", "address": 61312, "space": "lc-upper"}, {"label": "Recorded exit direction", "address": 31356, "space": "ram"}, {"label": "Current actor", "address": 212, "space": "ram"}, {"label": "Trigger descriptors", "address": 784, "space": "ram"}, {"label": "Battlefield", "address": 640, "space": "ram"}, {"label": "New east passage", "address": 704, "space": "ram"}, {"label": "Flanking wall tiles", "address": 694, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Upper trigger reached",
          "stop": "rooms.stops.trigger",
          "prepare": "From (6,2), Iolo Right twice reaches (8,2). Queue Down for this stop.",
          "observe": "Iolo now occupies (8,3), before the trigger scan. Each descriptor holds a tile, a packed trigger coordinate, and two packed destinations.",
          "when": [{"address": 0, "bytes": [5, 1]}, {"address": 10, "bytes": [21, 129]}, {"address": 15, "bytes": [2]}, {"address": 212, "bytes": [2]}, {"address": 31356, "bytes": [0, 255]}, {"address": 6, "bytes": [8, 3]}, {"address": 216, "bytes": [0]}],
          "inspect": [{"label": "Trigger descriptors", "address": 784, "space": "ram"}, {"label": "Battlefield", "address": 640, "space": "ram"}, {"label": "New east passage", "address": 704, "space": "ram"}, {"label": "Flanking wall tiles", "address": 694, "space": "ram"}, {"label": "Moved-to square", "address": 6, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Upper trigger applied",
          "stop": "rooms.stops.triggered",
          "prepare": "Continue without a key.",
          "observe": "Four writes open the east passage: (9,5) and (10,5) become floor $16; (10,4) and (10,6) become wall $7F. Every other battlefield byte is unchanged.",
          "when": [{"address": 0, "bytes": [5, 1]}, {"address": 10, "bytes": [21, 129]}, {"address": 15, "bytes": [2]}, {"address": 212, "bytes": [2]}, {"address": 31356, "bytes": [0, 255]}, {"address": 6, "bytes": [8, 3]}, {"address": 216, "bytes": [16]}],
          "inspect": [{"label": "Trigger descriptors", "address": 784, "space": "ram"}, {"label": "Battlefield", "address": 640, "space": "ram"}, {"label": "New east passage", "address": 704, "space": "ram"}, {"label": "Flanking wall tiles", "address": 694, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Different exit rejected",
          "stop": "rooms.stops.exitRejected",
          "prepare": "Finish Iolo’s turn. Up, Left, Left, Down, Down, Down, Right, Right, Right, Right reaches (10,5). Queue Right for this stop.",
          "observe": "The attempted coordinate is (11,5), but Iolo remains at (10,5). Continue to Iolo room command to see ALL MUST USE THE SAME EXIT. The north restriction and active slot are unchanged.",
          "when": [{"address": 0, "bytes": [5, 1]}, {"address": 10, "bytes": [21, 129]}, {"address": 15, "bytes": [2]}, {"address": 212, "bytes": [2]}, {"address": 31356, "bytes": [0, 255]}, {"address": 6, "bytes": [11, 5]}],
          "inspect": [{"label": "Party positions and active slots", "address": 61312, "space": "lc-upper"}, {"label": "Recorded exit direction", "address": 31356, "space": "ram"}, {"label": "Current actor", "address": 212, "space": "ram"}, {"label": "Attempted coordinate", "address": 6, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Lower trigger reached",
          "stop": "rooms.stops.trigger",
          "prepare": "After the refusal, Left three times, Down twice reaches (7,7). Queue Right for this stop.",
          "observe": "The scan will find the two descriptors for (8,7). They target the same four tiles as the upper trigger.",
          "when": [{"address": 0, "bytes": [5, 1]}, {"address": 10, "bytes": [21, 129]}, {"address": 15, "bytes": [2]}, {"address": 212, "bytes": [2]}, {"address": 31356, "bytes": [0, 255]}, {"address": 6, "bytes": [8, 7]}, {"address": 216, "bytes": [0]}],
          "inspect": [{"label": "Trigger descriptors", "address": 784, "space": "ram"}, {"label": "Battlefield", "address": 640, "space": "ram"}, {"label": "New east passage", "address": 704, "space": "ram"}, {"label": "Flanking wall tiles", "address": 694, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Lower trigger reapplied",
          "stop": "rooms.stops.triggered",
          "prepare": "Continue without a key.",
          "observe": "The same four stores execute again. Their values are already present, so the complete battlefield stays identical; descriptors are not consumed.",
          "when": [{"address": 0, "bytes": [5, 1]}, {"address": 10, "bytes": [21, 129]}, {"address": 15, "bytes": [2]}, {"address": 212, "bytes": [2]}, {"address": 31356, "bytes": [0, 255]}, {"address": 6, "bytes": [8, 7]}, {"address": 216, "bytes": [16]}],
          "inspect": [{"label": "Trigger descriptors", "address": 784, "space": "ram"}, {"label": "Battlefield", "address": 640, "space": "ram"}, {"label": "New east passage", "address": 704, "space": "ram"}, {"label": "Flanking wall tiles", "address": 694, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Both characters leave north",
          "stop": "rooms.stops.leaving",
          "prepare": "Finish Iolo’s turn. Left twice, Up five times, Left twice, Up twice reaches (4,0). Queue Up.",
          "observe": "Both active party slots are now zero. The modified battlefield still exists in RAM, and north remains recorded until the next room setup.",
          "when": [{"address": 0, "bytes": [5, 1]}, {"address": 10, "bytes": [21, 129]}, {"address": 15, "bytes": [2]}, {"address": 31356, "bytes": [0, 255]}],
          "inspect": [{"label": "Party positions and active slots", "address": 61312, "space": "lc-upper"}, {"label": "Recorded exit direction", "address": 31356, "space": "ram"}, {"label": "Current actor", "address": 212, "space": "ram"}, {"label": "Trigger descriptors", "address": 784, "space": "ram"}, {"label": "Battlefield", "address": 640, "space": "ram"}, {"label": "New east passage", "address": 704, "space": "ram"}, {"label": "Flanking wall tiles", "address": 694, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Corridor after the trigger",
          "stop": "stops.command",
          "prepare": "Continue without a key.",
          "observe": "Mode 3 at (5,0), facing north. The dungeon square remains D0. The old battlefield buffer has not yet been replaced.",
          "when": [{"address": 0, "bytes": [5, 0]}, {"address": 10, "bytes": [21, 3, 0]}, {"address": 16, "bytes": [0]}],
          "inspect": [{"label": "Dungeon position", "address": 0, "space": "ram"}, {"label": "Room square", "address": 59405, "space": "lc-upper"}, {"label": "Trigger descriptors", "address": 784, "space": "ram"}, {"label": "Battlefield", "address": 640, "space": "ram"}, {"label": "New east passage", "address": 704, "space": "ram"}, {"label": "Flanking wall tiles", "address": 694, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Read the room again",
          "stop": "rooms.stops.read",
          "prepare": "Use Dungeon command ready in the original room tour for Right twice, turning south. Queue Up for this stop.",
          "observe": "The game requests the same raw track 4, sector 0. The party is entering D0 again, with its accumulated HP and XP.",
          "when": [{"address": 0, "bytes": [5, 1]}, {"address": 10, "bytes": [21, 3]}, {"address": 224, "bytes": [4, 0, 1, 2]}],
          "inspect": [{"label": "Raw disk parameters", "address": 224, "space": "ram"}, {"label": "Character records", "address": 60416, "space": "lc-upper"}, {"label": "Trigger descriptors", "address": 784, "space": "ram"}, {"label": "Battlefield", "address": 640, "space": "ram"}, {"label": "New east passage", "address": 704, "space": "ram"}, {"label": "Flanking wall tiles", "address": 694, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Original map reloaded",
          "stop": "rooms.stops.loaded",
          "prepare": "Continue without a key.",
          "observe": "The full sector has replaced $0200–$02FF, closing the trigger’s east passage. Exit direction is still north at this intermediate boundary; actors have not yet been placed.",
          "when": [{"address": 0, "bytes": [5, 1]}, {"address": 10, "bytes": [21, 3]}, {"address": 224, "bytes": [4, 0, 1, 2]}],
          "inspect": [{"label": "Reloaded room sector", "address": 512, "space": "ram"}, {"label": "Restored passage tiles", "address": 704, "space": "ram"}, {"label": "Exit direction before setup", "address": 31356, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "Room state reset",
          "stop": "rooms.stops.placed",
          "prepare": "Continue without a key.",
          "observe": "All seven enemies and both north-entry positions return. Enemy HP is freshly rolled and the exit restriction becomes $00,$00. Party HP and XP persist; MP, food and elapsed turns continue to evolve.",
          "when": [{"address": 0, "bytes": [5, 1]}, {"address": 10, "bytes": [21, 129]}, {"address": 15, "bytes": [2]}, {"address": 31356, "bytes": [0, 0]}],
          "inspect": [{"label": "Enemy positions", "address": 61184, "space": "lc-upper"}, {"label": "New enemy HP and active slots", "address": 61248, "space": "lc-upper"}, {"label": "Party positions", "address": 61312, "space": "lc-upper"}, {"label": "Exit restriction cleared", "address": 31356, "space": "ram"}, {"label": "Persistent character records", "address": 60416, "space": "lc-upper"}, {"label": "Retained trigger descriptors", "address": 784, "space": "ram"}],
          "limit": 30000000
        },
        {
          "title": "New room encounter ready",
          "stop": "companions.stops.firstTurn",
          "prepare": "Continue without a key. Stop here to inspect the new encounter, or restore your earlier cleared-room checkpoint to follow the original save route.",
          "observe": "DROMAIOS has the first turn again. His HP/XP remain 183/154, Iolo’s 279/296. The previous battle is not restored; a new room encounter has been constructed.",
          "when": [{"address": 0, "bytes": [5, 1]}, {"address": 10, "bytes": [21, 129]}, {"address": 15, "bytes": [2]}, {"address": 212, "bytes": [1]}, {"address": 31356, "bytes": [0, 0]}],
          "inspect": [{"label": "Both character records", "address": 60416, "space": "lc-upper"}, {"label": "New enemy encounter", "address": 61184, "space": "lc-upper"}, {"label": "Room battlefield", "address": 640, "space": "ram"}],
          "limit": 30000000
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

The browser magic check starts from the verified post-shopping world checkpoint
and follows all nine named mixing and healing stops, then the save tour. Its
complete hardware and input state matches the native route after mixing, healing,
and saving, and its downloaded disk matches the native export byte for byte.
Reloading that download from the verified cold-boot disk-request checkpoint
restores all three saved blocks and permits the next westward move. The separate
native acceptance below performs both full boots. All three magic memory links
were checked without changing guest state; existing ROM and DOS tours remain
available.

The companion browser check uses verified checkpoints near Iolo, beside the
moongate, and at the encounter's first turn. It exercises all thirteen named
stops, then compares full hardware/input state with native execution after
recruitment, gate travel, all combat actions, healing, and saving. The four
caster/recipient memory links leave guest state unchanged. Its downloaded disk
matches the native export byte for byte; loading that download from the verified
cold-boot disk-request checkpoint restores the full party, roster and object
blocks and reproduces the native next move. The companion acceptance performs
the two full cold boots separately.

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

Run the [mixing and healing acceptance](../../tests/site/apple2-ultima-iv-magic.test.ts)
with that combat export and the original Town disk:

```sh
APPLE2_ROM=media/apple2/apple2p.rom \
APPLE2_ULTIMA_IV_BOOT=media/apple2/reference/ultima_iv_boot.dsk \
APPLE2_ULTIMA_IV_COMBAT=media/apple2/exports/ultima_iv_br-combat-saved.dsk \
APPLE2_ULTIMA_IV_TOWN=media/apple2/reference/ultima_iv_town.dsk \
node --test dist/tests/site/apple2-ultima-iv-magic.test.js
```

This independently cold-boots the wounded mage, walks to and buys from Margot,
returns to the retained Britannia disk, and checks the loaded `MIX` bytes, recipe,
each reagent subtraction, mixture counts, spell cost, healing addition, and HP
cap. A serialized pre-cast checkpoint replays with identical hardware and input
state. Saving checks all 803 DOS source reads, nine sector writes, and every
exported byte against the three saved payloads. A second new machine boots from
the original Boot disk, loads the export, compares every saved byte before
initialization, and takes another step. Original Boot, combat, and Town images
remain unchanged. The Town visit's earlier `TLST` write is retained in the export;
the final `Q` check starts from that edited Britannia image.

Run the [companion acceptance](../../tests/site/apple2-ultima-iv-companions.test.ts)
with the magic export and original Town disk:

```sh
APPLE2_ROM=media/apple2/apple2p.rom \
APPLE2_ULTIMA_IV_BOOT=media/apple2/reference/ultima_iv_boot.dsk \
APPLE2_ULTIMA_IV_MAGIC=media/apple2/exports/ultima_iv_br-magic-saved.dsk \
APPLE2_ULTIMA_IV_TOWN=media/apple2/reference/ultima_iv_town.dsk \
node --test dist/tests/site/apple2-ultima-iv-companions.test.js
```

It verifies natural moongate travel, recruitment checks and the 32-byte swap,
both characters' combat turns, targeted healing, full-state checkpoint replay,
all 803 DOS save-source reads and nine sector writes, the complete exported image,
and a second cold boot. Original media stay read-only. The test writes the
companion export and checkpoints when the output directory below is set.

Run the dungeon-room acceptance with the prepared expedition export:

```sh
APPLE2_ROM=media/apple2/apple2p.rom \
APPLE2_ULTIMA_IV_BOOT=media/apple2/reference/ultima_iv_boot.dsk \
APPLE2_ULTIMA_IV_ROOM=media/apple2/exports/ultima_iv_br-room-ready.dsk \
APPLE2_ULTIMA_IV_UNDERWORLD=media/apple2/reference/ultima_iv_under.dsk \
node --test dist/tests/site/apple2-ultima-iv-room.test.js
```

Its media identity is recorded separately from the earlier companion save.
The supply trip is provenance for this fixture; the automated acceptance starts
from its cold boot. After combat it branches from a full cleared-room checkpoint
to test both triggers, the refused east exit, the north exit and re-entry. It
then restores and compares the complete checkpoint before continuing the original
save route. With checkpoint output enabled, the test also retains
`ultima_iv_br-room-saved.dsk` for manual resumption. The browser check follows
all twelve named room stops, compares complete machine/input state with the
native route, and checks the memory links without advancing the game. Its
download matches all 143,360 bytes of the native export. Reloading that download
from a verified Boot disk-request checkpoint restores all saved bytes and
reproduces the next turn; the native acceptance performs both complete cold boots.
The separate trigger tour has thirteen named stops and 62 memory links. Its
browser run starts from the verified cleared-room checkpoint, reproduces the
native machine/input state through the new encounter, and checks every link
without advancing the game.

Set `APPLE2_ULTIMA_IV_CHECKPOINTS` to an ignored local directory to retain the
verified checkpoints and Britannia exports for
browser experiments. Omit `APPLE2_ULTIMA_IV_TOWN` to run only the earlier
Boot/Britannia save path. That combined town/dungeon round trip needs Town and
Underworld; omit
`APPLE2_ULTIMA_IV_UNDERWORLD` to stop after the town round trip. These artifacts
contain private media bytes and must not be published.

## Laboratory performance workload

The [browser benchmark](../../scripts/benchmark-apple2-laboratory.ts) also has an
`ultima-iv` workload: the first **2,000,000 instructions** after a fresh power-on
with the original Boot disk inserted, with no keyboard input. Run to `$0800`
reaches the debugger's instruction limit before that address. This samples
startup; it does not measure the entire boot to the title screen.

The combat acceptance above writes `ultima-iv-boot.json` when
`APPLE2_ULTIMA_IV_CHECKPOINTS` is set. For example, retain its checkpoints in
`media/benchmarks/ultima-iv`, then use the local site and separate Chrome setup
described in the [Mystery House benchmark](mystery-house.md#laboratory-performance-workload):

```sh
APPLE2_ROM=media/apple2/apple2p.rom \
node scripts/benchmark-apple2-laboratory.ts \
  http://127.0.0.1:8771 http://127.0.0.1:9227 media/benchmarks/ultima-iv 3 ultima-iv \
  > media/benchmarks/ultima-iv/results.json
```

Each sample uses a fresh page, the default docking layout, Unlimited speed,
sound off, and a 1800 × 1013 viewport. The three configurations keep Live and
recording on, turn all Live switches off, then also turn Changes, Disk transfer
and Applesoft event recording off. Breakpoint checks and the other observers
still run. The report includes elapsed time, PC, guest clocks, and the hash of
the complete hardware and input state. Compare hashes across revisions as well
as between configurations; faster host execution must not alter the guest.

The November 2026 pass compared `acef786` with the shared state-copying
improvement on an Apple M5 Max with Node 24 and headless Chrome 156.0.8078.80.
Medians of three unprofiled runs on an otherwise idle host:

| Execution | Before | After | Less elapsed time |
| --- | --- | --- | --- |
| Native session, without laboratory observers | 1.76 s | 1.46 s | 17% |
| Browser, Live and recording on | 9.28 s | 7.81 s | 16% |
| Browser, Live off | 7.37 s | 6.25 s | 15% |
| Browser, Live and recording controls off | 5.88 s | 4.98 s | 15% |

All 18 browser samples and all six native samples ended at `$BA9E`, with
**5,295,842 guest clocks**, and the same full-state SHA-256:
`e7ca5f9467a54ecdeb5437c6a2f051fbb9b622a433c2921ea2d9719038d96b91`.
The native samples restore the same power-on state and call the session's usual
`step()` method exactly 2,000,000 times, including normal instruction records
and disk activity.

Separate browser profiles identified state copying as the largest execution
cost. The shared copier now prepares the immutable field layout once and avoids
diagnostic-path construction and validation dispatch for known-valid scalar
values. Groups and arrays remain independent copies; external state still gets
full validation. Raw, mutable field maps are read afresh. There is no change to
CPU clocks, instruction execution, disk waits, Run scheduling, or debugger
recording. Browser scheduling and inspection still account for a substantial
gap from native execution; these measurements do not establish a full-boot time.

## Still to establish

This pass covers all four disks, Skara Brae's entrance and one conversation,
Covetous's first corridor and entrance ladder, both returns to Britannia, and
saving and resuming the supplied party. It also covers one character-creation
path, that character's first save, and a complete bridge-troll encounter followed
by saving and resuming the resulting party. The subsequent shopping and magic route
covers one reagent purchase, two Heal mixtures, one capped healing result, and
persistence of the remaining inventory. The companion route adds Iolo through
normal conversation, completes combat with two characters, and separates Heal’s
caster from its recipient before saving and reloading the entire roster. The
room route clears Covetous room zero, checks both triggers and the shared-exit
rule, verifies the room's reconstruction on re-entry, and separately returns
both characters to Britannia to save and reload their progress.
Other companions, larger parties, other spells, failed recipes, insufficient
resources, other classes and answer sequences, other towns and conversations,
other enemies and combat options, deeper dungeon exploration and other rooms,
sound expansion hardware, and a complete playthrough remain unverified. The
machine chapter's disk, timing, display, and audio limitations continue to apply.
