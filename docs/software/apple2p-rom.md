# Following the Apple II Plus ROM

## ROM walkthrough

For repeatable experiments, use the laboratory's
[Saved states](../../src/machines/6502/apple2.md#saving-and-comparing-an-experiment)
panel at any paused boundary. Save before a routine, step through it, and
Compare to see net changes; Restore lets you try the same starting point again.

The laboratory's **Move the cursor by editing RAM** walkthrough changes `CH`
at `$0024`, follows the ROM's indirect screen store, and repeats the experiment
after restoring the original cursor position. **EDIT** in Memory, Zero page, or
Stack enables paused byte editing; turn it off to resume click-to-watch behavior.
The laboratory’s **Move the cursor by editing RAM** walkthrough uses these tools
to change `CH` at `$0024`, follow the ROM’s indirect screen store, and repeat
the experiment after restoring the original cursor position. **EDIT** in Memory,
Zero page, or Stack enables paused byte editing; turn it off to resume the usual
click-to-watch behavior.

The Apple II can reach its Applesoft prompt without a disk. Follow that path in
the [browser machine](../../src/machines/6502/apple2.md#using-the-browser-machine), then watch one
keypress travel from the keyboard latch to the screen. In the classroom, open
**Explore the ROM** under the keyboard and keep it open while stepping. In the
laboratory, load firmware in **ROM**, use **Disassembly** for run-to controls, and keep
**Execution history** visible while stepping with the **Execution** panel.
Both show the latest twelve executed instructions; select a laboratory history
entry to inspect that step's changes and memory accesses.
Instructions appear newest first; each instruction's accesses retain execution
order. All numbers in that view are hexadecimal; flags are `0` or `1`.

Choose your verified ROM. If a disk is selected, eject it, then use **Fresh
power-on**. This walkthrough starts with fresh RAM and no disk controller ROM.
**Reset CPU** preserves RAM and devices, so it can take a different firmware path.

### Start at reset

The current PC is `$FA62`, the ROM's `RESET` entry. The CPU has obtained that
address from its reset vector; no ordinary instruction has run yet. **Step**
executes `CLD`, which clears decimal mode. Read the first trace entry: it shows
the byte actually fetched and the next PC. An unchanged flag does not appear
in the change list.

Choose **HOME** in the routine selector and **Run to routine**. The machine
executes normally until it is about to enter that routine. It pauses before
executing the instruction at `$FC58`. Step to begin following its work, or use
the next stop to pass over the clearing loop.

### From memory to characters

Choose **COUT** and run to it. This is an output entry, used for control characters
as well as printable ones. Inspect A, then **Step**: `JMP ($0036)` reads the
two-byte output hook. The trace records both bytes read and the destination PC.
The program can change this hook; it is not a fixed call baked into the CPU.

Choose **KEYIN2** and run to it. With this fresh ROM-only machine, the screen now
contains the Apple banner and `]`. Execution has reached the keyboard polling
instruction at `$FD21`. The prompt is drawn by ROM code writing screen memory;
the browser only renders the resulting video state.

### Follow the letter A

At **KEYIN2**, type `A` into the Apple II keyboard without pressing Enter
(in the laboratory, click the screen to give it keyboard focus first).
The host queues the character while execution is paused. **Step** offers it
to the keyboard latch and executes `BIT $C000`. The recorded read is `$C1`:
the seven-bit code for `A`, with the keyboard's ready bit set. N becomes `1`.
Step once more to see `BPL` fall through instead of returning to the polling
loop. Its printed operand is the branch destination, even when it is not taken.

Choose **Acknowledge key** and run to it. By this boundary A holds `$C1`, but the
keyboard strobe is still set. **Step** executes `BIT $C010`. The read appears in
the trace and the inspection line now says the strobe is clear. Merely opening
the explorer does not acknowledge a key.

Choose **STORADV** and run to it. **Step** loads the cursor column into Y;
step again to execute the indirect store. That store reads the
screen pointer, then writes `$C1` into text memory. Read its destination in the
trace. Finally run to **KEYIN2** again: the display shows `]A`, and the firmware
is waiting for another character. This was line editing and echo; Applesoft has
not executed a command because no Enter has arrived.

### Inspect the cell that received A

In the laboratory, turn on **Inspect** beside the screen's display options, then
select the `A` just echoed. The strip below the screen shows row `2`, column `1`,
page `1`, address `$0501`, byte `$C1`, and **normal**. Rows and columns count from
zero. The generated video specification supplies the address and character
interpretation; the inspector reads physical RAM, without a guest bus access.
Arrow keys move the selection. **Escape** or turning Inspect off returns the
screen to typing. While Inspect is on, keys and paste do not enter the machine.

The address opens Memory at that byte. **Watch writes** opens Watches and enables
its **W** stop, preserving any existing label or other stop choices. Subsequent
Run stops *after* an instruction writes that address, even if the byte stays the
same. Disable W when continuing a walkthrough that would otherwise stop there.

**Last write** identifies the last completed CPU instruction observed writing
this physical byte, with its instruction number, captured assembly, memory
mapping, and before/after values. Immediately after the echo, `$FBF2` is
`STA ($28),Y`: `STORADV` loaded column `CH` from `$24` into Y; `BASL/BASH`
(`$28/$29`) held `$0500`; adding Y selected `$0501`. Clicking the writer address
browses Disassembly's current bytes if the recorded bank is still visible.
The captured instruction remains evidence even if RAM code has since changed.

This is the last *store*, not necessarily the instruction that introduced the
character. Cursor animation can overwrite a cell repeatedly. Scrolling later
copies characters with a different instruction. A store of the same value still
becomes the last writer. Read-modify-write instructions retain their final store.

The observer keeps one writer per byte of both text pages, independently of the
Changes log's recording switch, Clear button, or retention limit. Reset, fresh
power-on, successful media replacement, register editing, and execution errors
clear this history. A cell with no captured store says so; it does not attribute
initial RAM to an instruction. If an external change differs from the captured
value, the strip marks that difference. Selecting a coordinate follows the
currently displayed page, while each page retains its own writers. Graphics
pixels have no text-cell interpretation; mixed mode still exposes its four text
rows. The observer does not retain a complete history of a cell.

### Carriage return is cursor work

For this part, use **Fresh power-on**, then run to **KEYIN2** again. Leave Inspect
off to type. Press Enter on the empty prompt and run to **COUT**. A contains
`$8D`, the carriage-return code with its high bit set. Run to **CR** (`$FC62`).
Two steps execute `LDA #$00` and `STA $24`, setting `CH` to zero. The next
instruction, at **LF** (`$FC66`), increments `CV` at `$25` from `2` to `3`.

These are cursor-variable writes, not screen-character writes. The ROM compares
the new row with `WNDBTM` at `$23`; below that boundary it calculates the new
screen base. Follow `$24`, `$25`, and `$28/$29` in Zero page or Watches. Screen
rows are interleaved in RAM: the first eight begin `$0400`, `$0480`, `$0500`, and
so on, but row 8 begins `$0428`. The base cannot advance by a constant forty
bytes at every row boundary.

Run to **KEYIN2** to reach the next prompt. Its row is now `4`, because the
Applesoft path back to the prompt emitted another newline after the echoed
carriage return. A ROM routine's local effect and the whole command-input path
are different observations.

### Scrolling is a sequence of ordinary stores

Starting at that fresh empty prompt on row `4`, repeat Enter, **Step** once to leave the
current polling address, then **Run to KEYIN2**, nine times. The prompt reaches row `22`. Press Enter once
more, then run to **SCROLL** (`$FC70`). The ROM has reached the bottom of the
window: `WNDTOP` (`$22`) is `0`, `WNDWDTH` (`$21`) is `40` (`$28` in hex),
`WNDBTM` (`$23`) is `24` (`$18`), and `CV` is held at `23`.

Run to address `$FC8E`. The preceding `LDA ($28),Y` has read from the next row;
`STA ($2A),Y` will write into the preceding row. On this first iteration Y is
`39`, the source is `$04A7` (row 1, column 39), and the destination is `$0427`
(row 0, column 39). Select that destination in Inspect and Step. Its last writer
now names `$FC8E`, even if both bytes were spaces.

Run to address `$FC95` to finish the copy loops. Rows 0–22 now contain the old
rows 1–23; each copied cell's writer is `$FC8E`. Run to `$FCA0` and Step to see
`STA ($28),Y` begin clearing the bottom row with normal spaces (`$A0`), starting
at `$07D0`. This store belongs to `CLEOLZ`, not `STORADV`. Finally run to
**KEYIN2**: the prompt is on the bottom row and the machine is waiting again.

There is no browser scroll command in this path. The CPU executes the ROM's
loads and stores, RAM changes, and the display renders those bytes. Screen
inspection connects each visible result to that execution.

### Explore beyond the walkthrough

**Run to address** accepts one to four hexadecimal digits, optionally preceded
by `$`. It sets a one-shot address breakpoint, checking PC before each instruction.
If already at that address, it stops immediately; Step first to leave it.
Routine stops also require motherboard ROM to be mapped there. An address stop
can instead target RAM, including code loaded by DOS, without assigning it a ROM
label. Every run-to request pauses after at most two million instructions if
its destination is not reached. It does not claim the program finished.

Pause cancels a pending run-to request. Step and ordinary Run also clear it.
Reset, fresh power-on, media selection, and leaving the page cancel it too.
The trace describes completed instructions, not a speculative listing of the
next bytes. Its ordered memory accesses include instruction fetches as well as
data reads and writes; the fetched bytes also appear beside the assembly.
Recorded ROM labels retain the bank mapping at execution time. The explorer
does not read through the guest bus or inspect disk bytes. Captured history
uses execution records; the separate Instruction panel previews a copied CPU
against safe storage observations. The machine's
[model limitations](../../src/machines/6502/apple2.md#components-and-address-decoding) still apply.

### Breakpoints and subroutine stepping

In the laboratory, the circle beside each Disassembly row toggles an instruction
breakpoint. A filled circle is enabled; an empty circle is inactive. **Breakpoints**
below the listing also accepts addresses directly, with individual enable and
remove controls. Choose **ROM only** for motherboard firmware or **Any mapping**
for an address regardless of its current bank. Row markers in mapped motherboard
ROM default to ROM-only stops. Up to 64 breakpoints are remembered in this browser;
reset, fresh power-on, and loading media retain them. These are address preferences,
not saved machine state or proof that the same software still occupies RAM.

Breakpoints stop before the instruction and before offering queued keyboard input.
After a breakpoint stops execution, **Run** crosses that boundary once, then stops
again on the next visit. Run stops immediately at a newly added breakpoint at PC.
The stepping controls cross the current boundary once; **Step** always executes
exactly one instruction, even at an enabled breakpoint.

The Execution panel adds **Step over** and **Step out**. Step over a `JSR` follows
execution until that particular call returns, including nested calls and tail
jumps; on another instruction it executes one step. Step out finishes the most
recent observed call (or interrupt frame). It is unavailable until a caller has
been observed. Neither control changes PC or reconstructs callers from arbitrary
stack bytes. Reset, fresh power-on, media replacement, register editing, and
execution errors clear the observed history.

Calls are recognized from the CPU specification's PC/SP writes and ordered stack
accesses. The tracker checks the returning PC and stack pointer against the
observed call, handles nested `BRK`/`RTI` frames, and retains at most 128 frames.
If software replaces SP or returns somewhere unexpected, a pending subroutine
step stops and reports that caller tracking was lost. This matters for software
that uses the stack for dispatch or edits return addresses. Hardware interrupt
entry is not automatically polled by this machine.

**Call stack**, initially a tab beside Stack, shows the active observed calls,
innermost first. Each entry names the call target, call site, continuation address,
and SP before the call. `BRK` frames are distinguished from `JSR` calls. ROM labels
come from this guide. Click an address to browse Disassembly without running it.
Call-site and entry mappings are captured when the instruction executes; their
links are disabled if a different bank is now mapped. Continuation links browse
current memory: a program may overwrite the saved return address. A lost-history
notice remains visible even if later calls establish a new partial stack. Reset,
power-on, media replacement, or a register edit starts a new observation history.
The view does not reconstruct calls that were not observed.

A watchpoint stops after the matching instruction, before the next instruction
breakpoint or completed step/run-to request is checked. Instruction breakpoints
then take precedence over a completed step or run-to request. A breakpoint,
Pause, or leaving the page cancels the temporary request; Step out can be selected
again using the retained call history. Run-to, Step over, and Step out have a
two-million-instruction limit so a polling loop cannot run indefinitely as a step.
The Execution and Disassembly panels distinguish breakpoint stops, completed
steps, reached addresses, manual pauses, instruction limits, lost callers, and
execution errors. Ordinary Run continues until paused, stopped at a breakpoint or watchpoint,
or an execution error occurs.

### Live disassembly

The laboratory's **Disassembly** panel shows a sixteen-row listing. Its
**PC / MEM** header toggle chooses the source. **PC** places the last three
executed instructions above the processor's next instruction, followed by a
live listing of current memory. Stepping moves the view with it. **MEM** starts
at Memory's selected address: enter a hexadecimal address in Memory's header
and press Enter, or scroll its contents.

**Navigate or run to an address** exposes explicit navigation and execution
controls. Enter an address and choose **Browse** to select MEM and move Memory
there. **Next 16** continues after the last displayed instruction; **Back**
returns to the previous view. Browsing never executes or changes the processor's
PC. **Run to address** instead executes until PC reaches that address.

The dimmed rows marked `·` show actual execution in chronological order, including
repeated visits to an address. A solid horizontal line appears below an
unconditional transfer (`JMP`, `JSR`, `RTS`, `RTI`, or `BRK`); a dotted line
appears below a conditional branch, whether taken or not. These markers apply
to both executed and upcoming instructions, even when the target happens to
be the following address. The `→` arrow marks only the next instruction, even if
its address also appears in the history. Before three instructions have run,
there are fewer history rows. Address browsing turns off this history prefix.

Select an instruction's address to run to it. This uses the same bounded,
one-shot address stop described above, pausing before execution in any bank.
An address button is available only when all its instruction bytes are visible
and firmware is installed. Use **Step** to execute the stopped instruction.
The arrow marks PC when that address appears in the listing. Known routine
names on live rows appear only while motherboard ROM is mapped at those
addresses; Language Card RAM does not inherit ROM labels. Executed rows retain
their recorded ROM mapping.

The **Routine** column, before **Address**, names a documented ROM entry at
that instruction's exact address. The **Operand** column on the right labels
the encoded address: a `JSR`, direct `JMP`, or branch destination, but also a
load, store, comparison, `BIT`, or other memory operand. Control destinations
keep their arrow (`→ SETNORM`); data references use their symbolic operand
notation (`INVFLG`, `FMT1,X`, or `(BASL),Y`). Immediate values are not addresses.
Branch labels describe the possible target whether taken or not.

Indexed labels name the encoded base, not the address after adding X or Y.
Indirect labels name the pointer, not its contents or destination. The listing
never reads that pointer or a device to resolve a label. Incomplete instructions
do not receive operand labels. Both columns open the corresponding reference.

The guide owns selected `labels` alongside its routine stops. Each label declares
its scope: `rom` data requires the identified ROM to be mapped; `workspace`
names apply only to instructions in that ROM, since other software can reuse
RAM; `hardware` addresses remain identifiable regardless of ROM banking.
History uses the fetched bytes and mapping captured before execution. Hardware
names describe addresses, not a claim that every peripheral is emulated; the
machine chapter owns device behavior and limitations.

The CPU chapter supplies instruction names, lengths, and control-flow behavior. Decoding proceeds
forward from the selected address, without following jumps or reading data
operands. Data can look like valid instructions, and starting partway through
an instruction produces a different listing. An unsupported opcode appears as
`.byte $XX` and advances one byte. Unavailable storage appears as `--`; missing
operands appear as question marks. Neither offers a run-to button. `BRK`
includes its fetched padding byte. Operand bytes wrap at FFFF as on the CPU,
but the listing itself stops at the end of the address space.

Rows from PC onwards show memory now. The history rows preserve the bytes
actually fetched, as does the longer **Execution history** panel;
self-modifying code can make those views differ. Both observations leave the machine untouched. The live listing reads
RAM, mapped ROM, and the installed slot ROM directly, never a keyboard, disk,
or Language Card switch through the guest bus. Those device addresses remain
unavailable even when the machine can read them during execution.

## Exploring the ROM reference

The laboratory's **ROM** panel connects reference material to the existing
inspectors. Search by name, hexadecimal address (with or without `$`), or words
in the description. Selecting an entry holds its description. **Browse code**
opens Disassembly at that entry; **View memory** opens Memory there in Fixed mode.
Neither action executes instructions or changes PC. A named label in Disassembly
opens its ROM reference in the other direction. Execution remains in the
**Execution** panel and Disassembly's explicit run-to controls.

**Follow PC** locates the processor's current address. **Follow Memory** uses
Memory's selected address, including when that view is held by its Live
control. ROM's own Live control governs automatic reference
updates during Run. Search and selection remain available while held. Following
shows the nearest documented entry at or before the address *within the same
ROM region*, with an explicit offset; proximity does not prove that execution
is inside that routine. Search also includes the guide's workspace, hardware, and ROM data labels.
Selecting one shows its exact address and description; these labels do not
become routine stops or inferred routine boundaries. The reference is not an
exhaustive symbol table.

The reference can be browsed without loading firmware. PC and Memory following
only associate addresses with ROM when the verified image is installed and
mapped. When Language Card RAM covers ROM, the panel says so; selecting a
reference still explains the ROM, while Disassembly and Memory show the storage that
is actually mapped. The Monitor uses scratch addresses such as `$28–$29` and
`$3A–$3B`; these are software variables, distinct from CPU registers. Other
software can reuse them.

## Guided exploration in the laboratory

**Walkthrough**, initially a tab beside ROM, brings five paths into the workspace:
reset and echo, carriage return, scrolling, cursor editing, and output-hook redirection. Choose a walkthrough and a
checkpoint in any order. Previous and Next change only the selected explanation;
they never execute, queue keys, reset hardware, or claim a step is complete.
Each checkpoint describes its preparation and the observations to compare.

**Run to checkpoint** uses the existing ROM-only run-to request, with its
instruction limit and normal breakpoint/watchpoint handling. It stops before
the target instruction. If already there, it stops without executing; Step once
when you want to leave a polling address before returning to it. Other stops
remain visible, and selecting another checkpoint during execution does not
retarget the pending run. Matching PC and ROM mapping means only that the
address has been reached, not that the described setup or result has been verified.
Reset and media changes retain the selected reading position, without preserving
any claim about previous execution.

**Browse code** opens the checkpoint in Disassembly without running it.
**Routine reference** opens its documented routine. The reference gives inputs,
effects, workspace-address links, and related routines for COUT, STORADV, CR,
and SCROLL. These describe this ROM's conventions, not additional CPU registers
or inferred routine boundaries. They remain readable without installing firmware.

Disassembly's **Notes** toggle shows a separate **ROM comment** column beside
the operands. Its comments explain selected instructions in their software
context. They appear only for complete instructions in the identified ROM,
with bytes matching the guide. Executed rows use the bytes and mapping captured
at execution time; Language Card RAM at the same address never inherits a ROM
comment. The CPU specification still owns instruction decoding and general
instruction explanations.

## Watching the hardware

**System** separates the live memory map's read and write destinations. At
power-on, ROM supplies `$D000–FFFF` reads while Language Card RAM accepts
writes. The lower window identifies bank 1 or bank 2; the upper window uses
shared RAM. Protection, bank selection, and absent hardware are visible without
performing guest reads. These are routing destinations: individual device
bindings may ignore a transfer. Unanswered reads supply `$00` in this model,
not a simulated floating-bus value.

Below the map, Keyboard, Display switches, and Language Card show their retained
state. Amber marks a change since the previous displayed sample; hover for the
previous value. During Run this can span multiple instructions, so an unchanged
field does not prove there was no intervening activity. Live controls sampling;
pausing or stepping refreshes it. Each device links to its executable description.

**Device activity**, initially beside System, shows actual CPU transfers in
`$C000–CFFF`, newest first. Follow the keypress above: `BIT $C000` at `$FD21`
observes `$C1`, then `BIT $C010` at `$FD2B` acknowledges it. Entries retain the
instruction bytes and mapping, accessed address, direction, and transferred
value. Slot-ROM fetches are distinguished from data reads. Click the instruction
to browse Disassembly, or the accessed address to open Memory. Disassembly
navigation refuses an instruction whose observed bank is no longer mapped;
it displays current code, which may differ from the captured bytes.

The device filter selects Keyboard, Display, Language Card, Disk II, or unmapped
accesses. Descriptions come from the declared bindings and link to the
specification. They explain the operation; the byte beside it is the actual
recorded transfer. Host key delivery has no responsible instruction and is not
invented as a CPU event. Failed instructions are excluded; their partial effects
remain available in Changes.

The latest 128 groups are retained even while the panel is hidden or Live is
off. Successive identical device accesses from the same instruction coalesce,
retaining their count and first/last instruction numbers; ordinary instructions
between polls do not split a group. Different instruction bytes, mappings,
addresses, directions, or values do. The status reports discarded older accesses.
Clear restarts counts without restarting instruction numbering. Reset, fresh
power-on, replacement media, restore, and register/RAM edits start a new history.

## Experimenting with the Monitor workspace

In the laboratory, **Zero page → NAMES** shows the Monitor's named bytes and
little-endian words. For example, **BASL/BASH** combines `$28–$29` into the text
row pointer, and **CSWL/CSWH** combines the output hook. The guide explicitly
declares each word with `bytes: 2`; neighbouring names alone do not imply a word.
The hexadecimal view remains available. Values reflect RAM, and other programs
may use the same addresses differently. Click an address to inspect its bytes in
Memory. In NAMES, **FIX / CHG** keeps the scroll position fixed or follows the
latest changed named value, including either byte of a word. CHG remembers
changes between display refreshes; Live still controls whether the running
inspector refreshes. The position preference is saved.

Memory, Zero Page, and Stack also mark the next instruction's accesses: dotted
underline for instruction fetches, cyan underline for data reads (including
pointers), and a violet outline for writes. A byte can carry more than one mark;
amber still means it changed in the previous instruction. A paired workspace
word carries marks for either byte, with exact addresses in its tooltip. Stack
entries also show pending accesses below SP, so a push is visible before it
executes. Writes are predicted bus requests, not claims that ROM or a device
will store the byte. A blocked device read ends the prediction at that address.

The **TXT** toggle beside **8 / 16** adds an Apple II character column to a byte
view. It uses the video specification's uppercase character decoding: inverse
characters have a light background, flashing characters are amber without
animation, and unavailable storage is a dot. Hover for the attribute and byte.
This is a text interpretation of memory, not a claim that all bytes are text.
Each inspector saves its choice. Reformatting a held view retains its displayed
bytes and access marks; it does not sample newer machine state.

**Watches**, initially a tab beside Memory, keeps a saved list of byte
addresses and optional labels. Values show hex and decimal. A highlight means
the value changed since the previous displayed sample, which can span many
instructions during Run. Language Card values follow the currently mapped bank;
a bank switch may therefore change a displayed value without a write. Hardware
addresses show unavailable storage rather than reading a device.

Each watch also has independent **R / W / Δ** stop toggles, saved with its address
and label. R matches recorded data reads, including pointer and stack reads, but
excludes instruction and operand fetches. W matches bus writes, including unchanged
stores and requests ignored by ROM or protected memory. Δ matches actual changed
RAM bytes, including either Language Card bank and upper RAM hidden behind ROM.
It observes individual writes, not differences between displayed samples; merely
switching banks is not a RAM change. With all three toggles off, the watch only
displays values. Earlier saved watches keep that behavior.

Outside Edit mode, click a hexadecimal byte in Memory, Zero page, or Stack to
add it to Watches, then choose its stop toggles. **Watch** beside a NAMES entry
uses the guide's declared width, including both bytes of a word. A regular byte
click preserves an existing watch's width, label, and stop choices.

Watches has a compact **BYTE / WORD** choice for new and existing entries.
Words combine two consecutive bytes, low byte first; both must be available.
They do not wrap at `$FFFF`, so the last possible word starts at `$FFFE`.
The same consecutive-byte rule crosses `$00FF` into `$0100`; this is a storage
view, not the 6502's indirect-addressing wrap behavior. Changing width starts a
new displayed-value comparison. Widths are saved with labels and stop choices;
older saved watches remain byte-sized. At most 64 starting addresses are saved.

Click a word's displayed value in Watches or NAMES to browse it **as an address**
in Memory. The source-address link still opens the bytes holding the word.
This uses the displayed value, including a held value, without reading through
the pointer or changing a bank. Not every word is a pointer: the random-number
workspace can also be interpreted this way, but is still just a number.

A word's R / W / Δ stops cover either source byte and report the actual accessed
address and byte value. Overlapping byte and word watches combine their enabled
stops; their order in the list cannot hide a match.

Stops happen after the complete instruction, even with Watches hidden, Live off,
or change-log recording paused. The first matching access in instruction order
wins; when W and Δ both match a write, the stop is reported as W. Execution and
Disassembly identify the responsible instruction, watched address, captured value,
and physical RAM bank and before/after values when a changed write provides them.
Read and unchanged/ignored-write stops do not invent earlier values or reread
memory. A stop cancels temporary stepping or run-to requests while retaining
observed callers. Run resumes at the next boundary, where a separate instruction
breakpoint may still stop it. Manual Step can trigger another watchpoint. Failed
instructions remain execution errors; partial effects stay in the change log.

Click A, X, Y, SP, or PC in **MOS 6502** while paused to edit a hexadecimal value.
Enter applies it; Escape or leaving the field cancels. An edit clears execution
history and run-to stops, preserving RAM, peripherals, media, and queued input.
For example, setting PC to a routine entry chooses where the next instruction
runs; it does not perform a JSR or construct a return address on the stack.

The **Instruction** panel shows observed operand reads/writes and address
calculations, including zero-page indexing and wrapped indirect pointers.
Address links open Memory. Assignments remain visible even when a register or
flag retains its value: CLD can show `D 0 → 0`. **How this instruction works**
contains prose and symbolic calculations extracted from the executable CPU
specification. The values in the preview still come from executing the generated
CPU against a private copy; the explanation does not implement another ALU.
Device reads stop prediction without operating a switch. Disassembly's encoded
operand addresses also link to Memory; its routine and operand labels continue
to open the ROM reference.

## Redirecting character output

The laboratory's **Redirect the ROM's character output** walkthrough replaces
the output hook with a tiny RAM routine. Start at the fresh ROM-only keyboard
prompt, save the machine, then enter these bytes with **Memory → EDIT**:

```text
0300: 8D 10 03 60
0036: 00 03
```

The first four bytes encode `STA $0310` followed by `RTS`. The two bytes at
`$0036–$0037` are the output hook, low byte first: `$0300`. Install the handler
before changing the hook, and stay paused until both bytes of the hook are set.
This address choice is for the fresh ROM-only experiment; it is not a general
claim that other software leaves these RAM locations unused.

Type `A` and stop at **COUT** (`$FDED`). Its `JMP ($0036)` reads the new pointer
and transfers to `$0300`. Step the store and return. `$0310` receives `$C1`,
and `RTS` consumes the caller's existing return address, continuing at `$FD4A`.
The indirect jump itself did not make another stack frame. Back in **KEYIN2**,
the line editor has accepted the character but the handler did not advance CH
or echo it to the screen. No Enter is needed.

This illustrates a software hook: ROM code chooses its destination through a
RAM word. The custom routine captures the character; it does not reproduce the
normal handler's control-character processing or screen effects. Restore the
saved state to remove both the hook change and the RAM routine, then repeat the
keypress to see the original output path. The walkthrough's automated check
executes both paths with the identified ROM.

## ROM identity and stops

This record supplies the browser's searchable reference, routine selector, trace,
and live-code annotations. Optional routine `details` provide inputs, outputs,
workspace names, and related routine names. Instruction `notes` bind prose to
an exact ROM address and instruction bytes. `walkthroughs` own selectable
checkpoints with preparation and observation text; they contain no executable
setup scripts. The build validates their cross-references and instruction lengths.
The region bounds describe ROM areas, not routine ends.
Routine entries and software labels describe the motherboard image identified
below; hardware labels describe machine addresses. The build checks the image
identity against the machine's firmware declaration and validates each label's
address and scope, including the bounds of declared workspace words. These selected
entry points are not a full symbol table. “Acknowledge key” names an instruction
within KEYIN, rather than a separate subroutine.

```json
{
  "sha256": "378ba00c86a64cca49cedaca7de8d5d351983ebc295d9d11e0752febfc346249",
  "regions": [
    {"start": "D000", "end": "F7FF", "name": "Applesoft ROM"},
    {"start": "F800", "end": "FFFF", "name": "Monitor ROM"}
  ],
  "routines": [
    {"address": "FA62", "name": "RESET", "description": "Begin the autostart firmware's reset path."},
    {"address": "FC58", "name": "HOME", "description": "Clear the text window and move its cursor home."},
    {
      "address": "FDED",
      "name": "COUT",
      "description": "Send A through the output hook at $0036–$0037.",
      "details": {
        "inputs": "A contains the character or control code to send. CSWL/CSWH selects the output handler.",
        "outputs": "Jumps through the output hook without interpreting the character itself. Register preservation and output effects belong to the selected handler; the normal screen hook is COUT1.",
        "workspace": [
          "CSWL"
        ],
        "related": [
          "COUT1",
          "STORADV",
          "CR"
        ]
      }
    },
    {"address": "FD0C", "name": "RDKEY", "description": "Prepare the cursor and enter the input hook at $0038–$0039."},
    {"address": "FD1B", "name": "KEYIN", "description": "Wait for a key while updating the random-number seed."},
    {"address": "FD21", "name": "KEYIN2", "description": "Test the keyboard ready bit with BIT $C000."},
    {"address": "FD2B", "name": "Acknowledge key", "description": "Read $C010 to clear the keyboard strobe."},
    {
      "address": "FBF0",
      "name": "STORADV",
      "description": "Store A at the text cursor, then advance it.",
      "details": {
        "inputs": "A is the screen byte to store. CH is the column within the text window; BASL/BASH points to the current row at its left edge.",
        "outputs": "Loads CH into Y, stores A through (BASL),Y, and increments CH. Reaching WNDWDTH takes the carriage-return path; that can advance the row or scroll the window.",
        "workspace": [
          "CH",
          "BASL",
          "WNDWDTH",
          "CV"
        ],
        "related": [
          "COUT1",
          "CR",
          "SCROLL"
        ]
      }
    },
    {"address": "F800", "name": "PLOT", "description": "Draw a low-resolution pixel using row A and column Y."},
    {"address": "F847", "name": "GBASCALC", "description": "Convert a graphics row into its screen-memory base address."},
    {"address": "F864", "name": "SETCOL", "description": "Expand the colour in A into both halves of COLOR ($30)."},
    {"address": "F871", "name": "SCRN", "description": "Return the colour at row A, column Y."},
    {"address": "F882", "name": "INSDS1", "description": "Decode an instruction at the Monitor pointer $003A–$003B."},
    {"address": "FB2F", "name": "INIT", "description": "Initialize the text window and cursor."},
    {"address": "FBC1", "name": "BASCALC", "description": "Compute a text row address in BASL/BASH ($28–$29)."},
    {"address": "FC22", "name": "VTAB", "description": "Recompute the text pointer from CV and WNDLFT."},
    {
      "address": "FC70",
      "name": "SCROLL",
      "description": "Move the text window upward by one row.",
      "details": {
        "inputs": "WNDTOP, WNDBTM, WNDLFT, and WNDWDTH define the text window. The normal LF path enters with CV at the last row.",
        "outputs": "Copies each following row into the preceding row, then clears the bottom row to normal spaces ($A0). BASL/BASH and BAS2L/BAS2H serve as source and destination pointers during copying; these are ordinary CPU loads and stores.",
        "workspace": [
          "WNDTOP",
          "WNDBTM",
          "WNDLFT",
          "WNDWDTH",
          "CV",
          "BASL",
          "BAS2L"
        ],
        "related": [
          "CR",
          "LF",
          "VTAB",
          "CLREOL"
        ]
      }
    },
    {"address": "FC9C", "name": "CLREOL", "description": "Fill the remainder of the current text row with spaces."},
    {"address": "FD6A", "name": "GETLN", "description": "Print the prompt and collect an edited line at $0200."},
    {"address": "FD8E", "name": "CROUT", "description": "Send a carriage return through COUT."},
    {"address": "FDF0", "name": "COUT1", "description": "Apply INVFLG and route a character to the screen handler."},
    {"address": "FE80", "name": "SETINV", "description": "Set INVFLG ($32) to $3F for inverse characters."},
    {"address": "FE84", "name": "SETNORM", "description": "Set INVFLG ($32) to $FF for normal characters."},
    {"address": "FE89", "name": "SETKBD", "description": "Point the input hook at KEYIN."},
    {"address": "FE93", "name": "SETVID", "description": "Point the output hook at COUT1."},
    {"address": "F819", "name": "HLINE", "description": "Draw a horizontal low-resolution line, ending at H2."},
    {"address": "F828", "name": "VLINE", "description": "Draw a vertical low-resolution line, ending at V2."},
    {"address": "F832", "name": "CLRSCR", "description": "Clear the low-resolution graphics screen."},
    {"address": "F836", "name": "CLRTOP", "description": "Clear the graphics area above the mixed-mode text window."},
    {"address": "F8D0", "name": "INSTDSP", "description": "Print the decoded instruction."},
    {"address": "F941", "name": "PRNTAX", "description": "Print A and X as a hexadecimal word."},
    {"address": "F948", "name": "PRBLNK", "description": "Print three spaces."},
    {"address": "FAA6", "name": "PWRUP", "description": "Continue initialization after detecting a cold start."},
    {"address": "FB1E", "name": "PREAD", "description": "Measure a paddle timer."},
    {"address": "FB39", "name": "SETTXT", "description": "Select text display and a full-height text window."},
    {"address": "FB40", "name": "SETGR", "description": "Select mixed graphics and its bottom text window."},
    {"address": "FB4B", "name": "SETWND", "description": "Set window top from A and initialize its other bounds."},
    {"address": "FB60", "name": "APPLEII", "description": "Clear the screen and display the startup title."},
    {"address": "FC42", "name": "CLREOP", "description": "Clear from the cursor through the text window."},
    {
      "address": "FC62",
      "name": "CR",
      "description": "Return the cursor to the left edge, then advance its row.",
      "details": {
        "inputs": "The text window and cursor variables describe the current output position.",
        "outputs": "Sets CH to zero and falls through to LF, which increments CV. Below WNDBTM the ROM recalculates the row pointer; at the bottom it restores CV to the last row and enters SCROLL. No carriage-return byte is stored on screen.",
        "workspace": [
          "CH",
          "CV",
          "WNDBTM",
          "WNDLFT",
          "BASL"
        ],
        "related": [
          "LF",
          "VTAB",
          "SCROLL"
        ]
      }
    },
    {"address": "FC66", "name": "LF", "description": "Advance the cursor row, scrolling when necessary."},
    {"address": "FCA8", "name": "WAIT", "description": "Delay according to A."},
    {"address": "FDDA", "name": "PRBYTE", "description": "Print A as two hexadecimal digits."},
    {"address": "FDE3", "name": "PRHEX", "description": "Print the low nibble of A as a hexadecimal digit."},
    {"address": "FE2C", "name": "MOVE", "description": "Copy the Monitor-selected memory range."},
    {"address": "FE36", "name": "VFY", "description": "Compare the Monitor-selected memory ranges."},
    {"address": "FE5E", "name": "LIST", "description": "Disassemble instructions at the Monitor pointer."},
    {"address": "FF3A", "name": "BELL", "description": "Request the bell sound."},
    {"address": "FF65", "name": "MON", "description": "Enter the Monitor command prompt."}
  ],
  "labels": [
    {"address": "0020", "name": "WNDLFT", "description": "window left edge", "scope": "workspace"},
    {"address": "0021", "name": "WNDWDTH", "description": "window width", "scope": "workspace"},
    {"address": "0022", "name": "WNDTOP", "description": "window top", "scope": "workspace"},
    {"address": "0023", "name": "WNDBTM", "description": "window bottom", "scope": "workspace"},
    {"address": "0024", "name": "CH", "description": "cursor horizontal position", "scope": "workspace"},
    {"address": "0025", "name": "CV", "description": "cursor vertical position", "scope": "workspace"},
    {"address": "0026", "name": "GBASL", "description": "graphics base address low", "scope": "workspace", "bytes": 2},
    {"address": "0027", "name": "GBASH", "description": "graphics base address high", "scope": "workspace"},
    {"address": "0028", "name": "BASL", "description": "text base address low", "scope": "workspace", "bytes": 2},
    {"address": "0029", "name": "BASH", "description": "text base address high", "scope": "workspace"},
    {"address": "002A", "name": "BAS2L", "description": "secondary text base low", "scope": "workspace", "bytes": 2},
    {"address": "002B", "name": "BAS2H", "description": "secondary text base high", "scope": "workspace"},
    {"address": "002C", "name": "H2 / LMNEM", "description": "Line endpoint or left mnemonic byte; shared scratch storage.", "scope": "workspace"},
    {"address": "002D", "name": "V2 / RMNEM", "description": "Line endpoint or right mnemonic byte; shared scratch storage.", "scope": "workspace"},
    {"address": "002E", "name": "MASK / FORMAT / CHKSUM", "description": "Graphics mask, instruction format, or tape checksum.", "scope": "workspace"},
    {"address": "002F", "name": "LENGTH / LASTIN", "description": "Decoded instruction length or previous input byte.", "scope": "workspace"},
    {"address": "0030", "name": "COLOR", "description": "lo-res colour / HMASK (hi-res bit mask)", "scope": "workspace"},
    {"address": "0031", "name": "MODE", "description": "monitor mode", "scope": "workspace"},
    {"address": "0032", "name": "INVFLG", "description": "inverse flag ($FF=normal, $7F=flash, $3F=inverse)", "scope": "workspace"},
    {"address": "0033", "name": "PROMPT", "description": "prompt character", "scope": "workspace"},
    {"address": "0034", "name": "YSAV", "description": "Y register save", "scope": "workspace"},
    {"address": "0035", "name": "YSAV1", "description": "Y register save (secondary)", "scope": "workspace"},
    {"address": "0036", "name": "CSWL", "description": "character output hook low", "scope": "workspace", "bytes": 2},
    {"address": "0037", "name": "CSWH", "description": "character output hook high", "scope": "workspace"},
    {"address": "0038", "name": "KSWL", "description": "character input hook low", "scope": "workspace", "bytes": 2},
    {"address": "0039", "name": "KSWH", "description": "character input hook high", "scope": "workspace"},
    {"address": "003A", "name": "PCL", "description": "program counter low", "scope": "workspace", "bytes": 2},
    {"address": "003B", "name": "PCH", "description": "program counter high", "scope": "workspace"},
    {"address": "003C", "name": "A1L", "description": "general purpose address 1 low", "scope": "workspace", "bytes": 2},
    {"address": "003D", "name": "A1H", "description": "general purpose address 1 high", "scope": "workspace"},
    {"address": "003E", "name": "A2L", "description": "general purpose address 2 low", "scope": "workspace", "bytes": 2},
    {"address": "003F", "name": "A2H", "description": "general purpose address 2 high", "scope": "workspace"},
    {"address": "0040", "name": "A3L", "description": "general purpose address 3 low", "scope": "workspace", "bytes": 2},
    {"address": "0041", "name": "A3H", "description": "general purpose address 3 high", "scope": "workspace"},
    {"address": "0042", "name": "A4L", "description": "general purpose address 4 low", "scope": "workspace", "bytes": 2},
    {"address": "0043", "name": "A4H", "description": "general purpose address 4 high", "scope": "workspace"},
    {"address": "0044", "name": "A5L", "description": "general purpose address 5; its high byte also saves the accumulator", "scope": "workspace", "bytes": 2},
    {"address": "0045", "name": "A5H / ACC", "description": "address 5 high / accumulator save (overlap)", "scope": "workspace"},
    {"address": "0046", "name": "XREG", "description": "X register save", "scope": "workspace"},
    {"address": "0047", "name": "YREG", "description": "Y register save", "scope": "workspace"},
    {"address": "0048", "name": "STATUS", "description": "processor status save", "scope": "workspace"},
    {"address": "0049", "name": "SPNT", "description": "stack pointer save", "scope": "workspace"},
    {"address": "004E", "name": "RNDL", "description": "random number low", "scope": "workspace", "bytes": 2},
    {"address": "004F", "name": "RNDH", "description": "random number high", "scope": "workspace"},
    {"address": "0200", "name": "INPUT_BUFFER", "description": "Input buffer (256 bytes)", "scope": "workspace"},
    {"address": "03F0", "name": "BRKV", "description": "BRK vector (2 bytes)", "scope": "workspace", "bytes": 2},
    {"address": "03F2", "name": "SOFTEV", "description": "Soft entry (warm start) vector (2 bytes)", "scope": "workspace", "bytes": 2},
    {"address": "03F4", "name": "PWREDUP", "description": "Power-up check byte (must = EOR #$A5 of SOFTEV+1)", "scope": "workspace"},
    {"address": "03F8", "name": "USRADR", "description": "USR() jump address (3 bytes)", "scope": "workspace"},
    {"address": "03FB", "name": "NMI", "description": "NMI vector on page 3 (3 bytes)", "scope": "workspace"},
    {"address": "03FE", "name": "IRQLOC", "description": "IRQ location vector (2 bytes)", "scope": "workspace", "bytes": 2},
    {"address": "C000", "name": "KBD", "description": "R: last key pressed + 128", "scope": "hardware"},
    {"address": "C010", "name": "KBDSTRB", "description": "RW: keyboard strobe (clear)", "scope": "hardware"},
    {"address": "C020", "name": "TAPEOUT", "description": "RW: toggle cassette tape output", "scope": "hardware"},
    {"address": "C030", "name": "SPKR", "description": "RW: toggle speaker", "scope": "hardware"},
    {"address": "C050", "name": "TXTCLR", "description": "RW: display graphics", "scope": "hardware"},
    {"address": "C051", "name": "TXTSET", "description": "RW: display text", "scope": "hardware"},
    {"address": "C052", "name": "MIXCLR", "description": "RW: display full screen", "scope": "hardware"},
    {"address": "C053", "name": "MIXSET", "description": "RW: display split screen", "scope": "hardware"},
    {"address": "C054", "name": "TXTPAGE1", "description": "RW: display page 1", "scope": "hardware"},
    {"address": "C055", "name": "TXTPAGE2", "description": "RW: display page 2", "scope": "hardware"},
    {"address": "C056", "name": "LORES", "description": "RW: display lo-res graphics", "scope": "hardware"},
    {"address": "C057", "name": "HIRES", "description": "RW: display hi-res graphics", "scope": "hardware"},
    {"address": "C058", "name": "SETAN0", "description": "RW: annunciator 0 off (TTL high)", "scope": "hardware"},
    {"address": "C059", "name": "CLRAN0", "description": "RW: annunciator 0 on (TTL low)", "scope": "hardware"},
    {"address": "C05A", "name": "SETAN1", "description": "RW: annunciator 1 off (TTL high)", "scope": "hardware"},
    {"address": "C05B", "name": "CLRAN1", "description": "RW: annunciator 1 on (TTL low)", "scope": "hardware"},
    {"address": "C05C", "name": "SETAN2", "description": "RW: annunciator 2 off (TTL high)", "scope": "hardware"},
    {"address": "C05D", "name": "CLRAN2", "description": "RW: annunciator 2 on (TTL low)", "scope": "hardware"},
    {"address": "C05E", "name": "SETAN3", "description": "RW: annunciator 3 off (TTL high)", "scope": "hardware"},
    {"address": "C05F", "name": "CLRAN3", "description": "RW: annunciator 3 on (TTL low)", "scope": "hardware"},
    {"address": "C060", "name": "TAPEIN", "description": "R: cassette input", "scope": "hardware"},
    {"address": "C064", "name": "PADDL0", "description": "R: analog input 0", "scope": "hardware"},
    {"address": "C065", "name": "PADDL1", "description": "R: analog input 1", "scope": "hardware"},
    {"address": "C066", "name": "PADDL2", "description": "R: analog input 2", "scope": "hardware"},
    {"address": "C067", "name": "PADDL3", "description": "R: analog input 3", "scope": "hardware"},
    {"address": "C070", "name": "PTRIG", "description": "RW: analog input reset (trigger)", "scope": "hardware"},
    {"address": "CFFF", "name": "CLRROM", "description": "Disable slot C8 ROM", "scope": "hardware"},
    {"address": "F962", "name": "FMT1", "description": "Instruction format table 1", "scope": "rom"},
    {"address": "F9A6", "name": "FMT2", "description": "Instruction format table 2", "scope": "rom"},
    {"address": "F9B4", "name": "CHAR1", "description": "Addressing mode character table 1", "scope": "rom"},
    {"address": "F9BA", "name": "CHAR2", "description": "Addressing mode character table 2", "scope": "rom"},
    {"address": "F9C0", "name": "MNEML", "description": "Mnemonic table (left bytes)", "scope": "rom"},
    {"address": "FA00", "name": "MNEMR", "description": "Mnemonic table (right bytes)", "scope": "rom"},
    {"address": "F80E", "name": "PLOT1", "description": "Continue plotting with the prepared screen pointer.", "scope": "rom"},
    {"address": "F81C", "name": "HLINE1", "description": "Continue the horizontal line loop.", "scope": "rom"},
    {"address": "FA9B", "name": "FIXSEV", "description": "Repair the warm-start vector.", "scope": "rom"},
    {"address": "FAA3", "name": "NOFIX", "description": "Continue with an existing warm-start vector.", "scope": "rom"},
    {"address": "FAA9", "name": "SETPG3", "description": "Initialize page-three vectors.", "scope": "rom"},
    {"address": "FABA", "name": "SLOOP", "description": "Search slot ROMs.", "scope": "rom"},
    {"address": "FAC7", "name": "NXTBYT", "description": "Check the next slot-ROM signature byte.", "scope": "rom"},
    {"address": "FB5B", "name": "TABV", "description": "Set CV from A, then recompute its screen pointer.", "scope": "rom"},
    {"address": "FBD0", "name": "BASCLC2", "description": "Complete text-row address calculation.", "scope": "rom"},
    {"address": "FBF4", "name": "ADVANCE", "description": "Advance the cursor after a character.", "scope": "rom"},
    {"address": "FBFD", "name": "VIDOUT", "description": "Dispatch the screen character handler.", "scope": "rom"},
    {"address": "FC10", "name": "BS", "description": "Move the cursor left.", "scope": "rom"},
    {"address": "FC1A", "name": "UP", "description": "Move the cursor up.", "scope": "rom"},
    {"address": "FC24", "name": "VTABZ", "description": "Continue vertical positioning.", "scope": "rom"},
    {"address": "FC76", "name": "SCRL1", "description": "Copy the next scrolling row.", "scope": "rom"},
    {"address": "FC9E", "name": "CLEOLZ", "description": "Clear the line starting at column Y.", "scope": "rom"},
    {"address": "FD35", "name": "RDCHAR", "description": "Process the input character.", "scope": "rom"},
    {"address": "FD67", "name": "GETLNZ", "description": "Read a line without first printing the prompt.", "scope": "rom"},
    {"address": "FD6F", "name": "GETLN1", "description": "Continue the line-input loop.", "scope": "rom"},
    {"address": "FD71", "name": "BCKSPC", "description": "Handle backspace during line input.", "scope": "rom"},
    {"address": "FD75", "name": "NXTCHAR", "description": "Read the next line-input character.", "scope": "rom"},
    {"address": "FD84", "name": "ADDINP", "description": "Store the line-input character.", "scope": "rom"},
    {"address": "FDF6", "name": "COUTZ", "description": "Continue the screen output handler.", "scope": "rom"},
    {"address": "FE75", "name": "A1PC", "description": "Copy the Monitor address into its execution pointer.", "scope": "rom"},
    {"address": "FF69", "name": "MONZ", "description": "Read and dispatch a Monitor command.", "scope": "rom"}
  ],
  "notes": [
    {"address": "FDED", "bytes": "6C 36 00", "text": "Dispatch through CSWL/CSWH; the hook chooses where output goes."},
    {"address": "FDF4", "bytes": "25 32", "text": "Apply INVFLG to printable output before the screen handler."},
    {"address": "FBF0", "bytes": "A4 24", "text": "Load the column within the text window into Y."},
    {"address": "FBF2", "bytes": "91 28", "text": "Store the character at the row pointer plus the cursor column."},
    {"address": "FBF4", "bytes": "E6 24", "text": "Advance the cursor one column after storing the character."},
    {"address": "FBF8", "bytes": "C5 21", "text": "Compare the new column with the text-window width."},
    {"address": "FBFA", "bytes": "B0 66", "text": "At the right edge, take the carriage-return path."},
    {"address": "FC62", "bytes": "A9 00", "text": "Prepare column zero: the left edge of the text window."},
    {"address": "FC64", "bytes": "85 24", "text": "Return the cursor column to zero; no screen byte is written."},
    {"address": "FC66", "bytes": "E6 25", "text": "Advance the cursor row."},
    {"address": "FC6A", "bytes": "C5 23", "text": "Compare the new row with the exclusive bottom boundary."},
    {"address": "FC6C", "bytes": "90 B6", "text": "Below the bottom boundary, recalculate the row pointer."},
    {"address": "FC6E", "bytes": "C6 25", "text": "Keep CV on the last row before scrolling the window."},
    {"address": "FC70", "bytes": "A5 22", "text": "Start scrolling at the top row of the text window."},
    {"address": "FC78", "bytes": "85 2A", "text": "Save the destination row pointer low byte in BAS2L."},
    {"address": "FC7C", "bytes": "85 2B", "text": "Save the destination row pointer high byte in BAS2H."},
    {"address": "FC7E", "bytes": "A4 21", "text": "Start at the window width; DEY selects its last column."},
    {"address": "FC89", "bytes": "20 24 FC", "text": "Calculate the next row pointer to use as the copy source."},
    {"address": "FC8C", "bytes": "B1 28", "text": "Read a character from the following screen row."},
    {"address": "FC8E", "bytes": "91 2A", "text": "Copy that character into the preceding screen row."},
    {"address": "FC90", "bytes": "88", "text": "Move left to the preceding column."},
    {"address": "FC91", "bytes": "10 F9", "text": "Keep copying columns while Y is non-negative."},
    {"address": "FC95", "bytes": "A0 00", "text": "Begin clearing the bottom row at its first column."},
    {"address": "FC9E", "bytes": "A9 A0", "text": "Use a normal space as the clearing byte."},
    {"address": "FCA0", "bytes": "91 28", "text": "Clear a cell through the current row pointer."}
  ],
  "walkthroughs": [
    {
      "id": "echo",
      "title": "From reset to an echoed A",
      "setup": "Load the verified ROM, eject any disk, and use Fresh power-on. Disable instruction breakpoints and watchpoint stops that would interrupt these checkpoints. Leave Screen Inspect off when typing.",
      "steps": [
        {
          "title": "The reset vector",
          "address": "FA62",
          "prepare": "Fresh power-on pauses here before any ordinary instruction.",
          "observe": "Step executes CLD, clearing decimal mode. The CPU read the reset vector to obtain this address.",
          "routine": "RESET"
        },
        {
          "title": "Clear the text window",
          "address": "FC58",
          "prepare": "Run to this checkpoint from reset.",
          "observe": "HOME will clear the text window and position its cursor. The screen changes because the ROM writes RAM.",
          "routine": "HOME"
        },
        {
          "title": "The output hook",
          "address": "FDED",
          "prepare": "Run to this checkpoint to stop before the first output dispatch.",
          "observe": "Step follows JMP ($0036). The output hook is a RAM word, not a destination hard-coded in the CPU.",
          "routine": "COUT"
        },
        {
          "title": "Ready for a key",
          "address": "FD21",
          "prepare": "Run to this checkpoint. The screen should show the Apple banner and an empty prompt.",
          "observe": "Type A without Enter, then Step twice: BIT $C000 sees $C1 and sets N; BPL falls through. Typing only queues input until execution resumes.",
          "routine": "KEYIN2"
        },
        {
          "title": "Acknowledge the key",
          "address": "FD2B",
          "prepare": "After those two steps, run to this checkpoint.",
          "observe": "A holds $C1. Step executes BIT $C010, clearing the keyboard strobe.",
          "routine": "Acknowledge key"
        },
        {
          "title": "Store the echoed character",
          "address": "FBF2",
          "prepare": "Run to this checkpoint. STORADV has loaded CH into Y.",
          "observe": "For this fresh prompt, CH is 1 and BASL/BASH is $0500. Step writes $C1 to $0501. Turn on Screen Inspect and select row 2, column 1 to see this instruction as its writer.",
          "routine": "STORADV"
        },
        {
          "title": "Wait for another key",
          "address": "FD21",
          "prepare": "Run to this checkpoint after the store.",
          "observe": "The display shows ]A. This is line editing and echo; no command has been submitted.",
          "routine": "KEYIN2"
        }
      ]
    },
    {
      "id": "carriage-return",
      "title": "Carriage return and cursor movement",
      "setup": "Start again with Fresh power-on, no disk, and no enabled breakpoint/watchpoint stops. This experiment uses an empty prompt; do not submit the A from the echo walkthrough.",
      "steps": [
        {
          "title": "An empty prompt",
          "address": "FD21",
          "prepare": "Run to this checkpoint from fresh power-on.",
          "observe": "The cursor is on row 2. With Inspect off, press Enter, then select the next checkpoint.",
          "routine": "KEYIN2"
        },
        {
          "title": "Dispatch a control character",
          "address": "FDED",
          "prepare": "After queuing Enter, run to this checkpoint.",
          "observe": "A is $8D. COUT sends control characters through the same output hook as printable characters.",
          "routine": "COUT"
        },
        {
          "title": "Return to the left edge",
          "address": "FC62",
          "prepare": "Run to this checkpoint.",
          "observe": "Two steps execute LDA #$00 and STA $24. CH becomes zero without writing a screen character.",
          "routine": "CR"
        },
        {
          "title": "Advance the row",
          "address": "FC66",
          "prepare": "After those two steps, this is the current address.",
          "observe": "Step increments CV from 2 to 3. The following comparison decides whether the ROM must scroll.",
          "routine": "LF"
        },
        {
          "title": "Back at the prompt",
          "address": "FD21",
          "prepare": "Run to this checkpoint.",
          "observe": "CV is now 4: the Applesoft path back to the prompt emitted another newline after the echoed carriage return. A routine’s effect differs from the whole input path.",
          "routine": "KEYIN2"
        }
      ]
    },
    {
      "id": "scroll",
      "title": "How the ROM scrolls the screen",
      "setup": "Start at the fresh empty prompt on row 4 at the end of the carriage-return walkthrough. With Inspect off, repeat Enter, Step once, then Run to the first checkpoint nine times to reach row 22. Disable breakpoint/watchpoint stops for an uninterrupted walkthrough.",
      "steps": [
        {
          "title": "Prepare the bottom of the window",
          "address": "FD21",
          "prepare": "At each prompt, Step once after Enter before running here again; run-to stops immediately if already at its target. After nine empty lines from row 4, queue Enter once more and select the next checkpoint.",
          "observe": "CH is 1 and CV is 22 before that final Enter. WNDTOP is 0, WNDWDTH is $28 (40), and WNDBTM is $18 (24).",
          "routine": "KEYIN2"
        },
        {
          "title": "Enter the scroll routine",
          "address": "FC70",
          "prepare": "With the final Enter queued, run to this checkpoint.",
          "observe": "CV is held at 23. The ROM will copy the next row over each preceding row within the window.",
          "routine": "SCROLL"
        },
        {
          "title": "Copy one character",
          "address": "FC8E",
          "prepare": "Run to this checkpoint. The preceding load fetched a character from the next row.",
          "observe": "Y is 39; the source is $04A7 and destination $0427. Inspect row 0, column 39, then Step. The last writer becomes $FC8E even when a space replaces a space.",
          "routine": "SCROLL"
        },
        {
          "title": "Rows have moved",
          "address": "FC95",
          "prepare": "Run to this checkpoint to finish the copy loops.",
          "observe": "Rows 0–22 now contain the old rows 1–23. Their last writer is the copy instruction at $FC8E.",
          "routine": "SCROLL"
        },
        {
          "title": "Clear the last row",
          "address": "FCA0",
          "prepare": "Run to this checkpoint.",
          "observe": "A is $A0, a normal space, and Y is zero. Step begins clearing the bottom row at $07D0. The same store is also used for other clearing operations.",
          "routine": "CLREOL"
        },
        {
          "title": "The prompt at the bottom",
          "address": "FD21",
          "prepare": "Run to this checkpoint.",
          "observe": "The machine is waiting on row 23. Scrolling came from ordinary ROM loads and stores; the browser rendered the resulting RAM.",
          "routine": "KEYIN2"
        }
      ]
    },
    {
      "id": "cursor-edit",
      "title": "Move the cursor by editing RAM",
      "setup": "Use the laboratory. Load the verified ROM, eject any disk, use Fresh power-on, and disable breakpoint/watchpoint stops. Leave Screen Inspect off for typing. This experiment edits one Monitor workspace byte, then restores a saved state.",
      "steps": [
        {
          "title": "Save the empty prompt",
          "address": "FD21",
          "prepare": "Run to this checkpoint from fresh power-on. In Saved states, save a state named Cursor before move, without typing a key.",
          "observe": "Zero page → Names shows CH = $01, CV = $02, and BASL/BASH = $0500. The saved state includes RAM, CPU, devices, and the empty keyboard queue.",
          "routine": "KEYIN2"
        },
        {
          "title": "Change the cursor column",
          "address": "FD21",
          "prepare": "Stay paused here. In Zero page, turn EDIT on. In the CH row, select the byte beside Bytes, enter 08, and Apply. Turn EDIT off. In Saved states, Compare with Cursor before move.",
          "observe": "Only RAM $0024 differs: $01 → $08. No instruction ran and Y is still $01. Changes labels the action User RAM edit; earlier execution history has been cleared. Columns count from zero.",
          "routine": "KEYIN2"
        },
        {
          "title": "Reload the changed column",
          "address": "FBF0",
          "prepare": "Click the screen and type A without Enter. Run to this checkpoint.",
          "observe": "STORADV starts with LDY $24. Step loads the edited CH into Y, making it $08. The keyboard loop restored its old cursor cell before reaching this routine.",
          "routine": "STORADV"
        },
        {
          "title": "Store at column eight",
          "address": "FBF2",
          "prepare": "After that step, this is the current address. Step once to execute STA ($28),Y.",
          "observe": "The ROM writes $C1 to $0508: row base $0500 plus column $08. The A appears at row 2, column 8. Compare again to see the accumulated effects; this comparison is a net difference, not an instruction trace.",
          "routine": "STORADV"
        },
        {
          "title": "Restore and repeat",
          "address": "FD21",
          "prepare": "In Saved states, Restore Cursor before move. Stay paused: Restore itself returns here. Compare again, then type A and repeat the last two checkpoints without editing CH.",
          "observe": "After Restore, Compare shows no differences and CH is $01 again. Repeating the echo writes $C1 to $0501. The same ROM code uses the workspace supplied to it; the emulator did not special-case the character or cursor.",
          "routine": "KEYIN2"
        }
      ]
    },
    {
      "id": "output-hook",
      "title": "Redirect the ROM's character output",
      "setup": "Use the laboratory with the verified ROM, no disk, and Fresh power-on. Disable breakpoint/watchpoint stops and leave Screen Inspect off for typing. Save before editing: this experiment replaces a ROM output hook with a four-byte RAM routine.",
      "steps": [
        {
          "title": "Save the original output hook",
          "address": "FD21",
          "prepare": "Run to this checkpoint from fresh power-on. Save a state named Output hook original. In Zero page → Names, Watch CSWL/CSWH and BASL/BASH.",
          "observe": "Watches uses the guide's two-byte definitions: CSWL/CSWH = $FDF0 and BASL/BASH = $0500. Click a word's value to browse that address in Memory; its source-address link still opens the word itself. Browsing does not run the machine.",
          "routine": "KEYIN2"
        },
        {
          "title": "Install a small output handler",
          "address": "FD21",
          "prepare": "Stay paused. Use Memory EDIT to write $0300: 8D 10 03 60 (four separate bytes). This is STA $0310 followed by RTS. Then set $0036: 00 03 (low byte, then high byte). Turn EDIT off after applying all six bytes.",
          "observe": "CSWL/CSWH now reads $0300. Follow that word to Memory and select MEM in Disassembly to see STA $0310 and RTS. Add a byte watch at $0310, with all stops off. The handler will capture A in RAM rather than send it to the screen. No ROM bytes have changed.",
          "routine": "KEYIN2"
        },
        {
          "title": "Follow the indirect output jump",
          "address": "FDED",
          "prepare": "Click the screen and type A without Enter. Run to this checkpoint, then Step once.",
          "observe": "COUT executes JMP ($0036): it reads $00 and $03 and reaches $0300. A holds $C1. The jump does not push a new return address; SP is unchanged. With Disassembly following PC, the next instruction is the RAM handler's STA $0310.",
          "routine": "COUT"
        },
        {
          "title": "Capture the character and return",
          "address": "FD21",
          "prepare": "From $0300, Step once to store A at $0310, then Step once for RTS. Inspect those two history records before running to this checkpoint.",
          "observe": "The watch at $0310 shows $C1. RTS uses the existing caller's stack return and continues at $FD4A; SP increases by two. Back at the keyboard loop, CH is still $01 and no A has been echoed, although the line editor accepted it. Compare with the saved state to inspect the accumulated changes; do not press Enter.",
          "routine": "KEYIN2"
        },
        {
          "title": "Restore normal screen output",
          "address": "FDED",
          "prepare": "Restore Output hook original, then Compare: there should be no differences. Type A without Enter and run to this checkpoint. Step once, then run to the first checkpoint to finish the echo.",
          "observe": "The restored CSWL/CSWH is $FDF0. The same JMP ($0036) now enters COUT1, and the prompt becomes ]A. Restore also removed the RAM handler and captured byte. Watch preferences remain part of the workspace, independent of the saved machine.",
          "routine": "COUT"
        }
      ]
    }
  ]
}
```

The labels were checked against the Apple II Reference Manual's autostart
listing, available as a [searchable disassembly][monitor], and the pinned
[dromaios-apple2 ROM annotations][reference]. The walkthrough's register,
keyboard, screen, and stopping behavior is tested by executing the selected
ROM; no firmware image is distributed with this guide. The
[6502 specification](../../src/components/cpus/specifications/6502.md) supplies
the instruction names and addressing notation used in the explorer.

[monitor]: https://6502disassembly.com/a2-rom/AutoF8ROM.html
[reference]: https://github.com/jtauber/dromaios-apple2/blob/569baf98006f61e80ed93c36aa4f8d9ae23011d3/data/apple2p-rom.json
