# Following the Apple II Plus ROM

## ROM walkthrough

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

Breakpoints take precedence over a completed step or run-to request. A breakpoint,
Pause, or leaving the page cancels the temporary request; Step out can be selected
again using the retained call history. Run-to, Step over, and Step out have a
two-million-instruction limit so a polling loop cannot run indefinitely as a step.
The Execution and Disassembly panels distinguish breakpoint stops, completed
steps, reached addresses, manual pauses, instruction limits, lost callers, and
execution errors. Ordinary Run continues until paused, stopped at a breakpoint,
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
instructions during Run. These watches do not stop execution, and do not observe
every intermediate write. Language Card addresses follow the currently mapped
bank; a bank switch may therefore change a displayed value without a write.
Hardware addresses show unavailable storage rather than reading a device.

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

## ROM identity and stops

This record supplies the browser's searchable reference, routine selector, trace,
and live-code annotations. The region bounds describe ROM areas, not routine ends.
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
    {"address": "FDED", "name": "COUT", "description": "Send A through the output hook at $0036–$0037."},
    {"address": "FD0C", "name": "RDKEY", "description": "Prepare the cursor and enter the input hook at $0038–$0039."},
    {"address": "FD1B", "name": "KEYIN", "description": "Wait for a key while updating the random-number seed."},
    {"address": "FD21", "name": "KEYIN2", "description": "Test the keyboard ready bit with BIT $C000."},
    {"address": "FD2B", "name": "Acknowledge key", "description": "Read $C010 to clear the keyboard strobe."},
    {"address": "FBF0", "name": "STORADV", "description": "Store A at the text cursor, then advance it."},
    {"address": "F800", "name": "PLOT", "description": "Draw a low-resolution pixel using row A and column Y."},
    {"address": "F847", "name": "GBASCALC", "description": "Convert a graphics row into its screen-memory base address."},
    {"address": "F864", "name": "SETCOL", "description": "Expand the colour in A into both halves of COLOR ($30)."},
    {"address": "F871", "name": "SCRN", "description": "Return the colour at row A, column Y."},
    {"address": "F882", "name": "INSDS1", "description": "Decode an instruction at the Monitor pointer $003A–$003B."},
    {"address": "FB2F", "name": "INIT", "description": "Initialize the text window and cursor."},
    {"address": "FBC1", "name": "BASCALC", "description": "Compute a text row address in BASL/BASH ($28–$29)."},
    {"address": "FC22", "name": "VTAB", "description": "Recompute the text pointer from CV and WNDLFT."},
    {"address": "FC70", "name": "SCROLL", "description": "Move the text window upward by one row."},
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
    {"address": "FC62", "name": "CR", "description": "Return the cursor to the left edge, then advance its row."},
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
  ]
}
```

The labels were checked against the Apple II Reference Manual's autostart
listing, available as a [searchable disassembly][monitor], and the pinned
[dromaios-apple2 ROM annotations][reference]. The walkthrough's register,
keyboard, screen, and stopping behavior is tested by executing the selected
ROM; no firmware bytes are distributed with this guide. The
[6502 specification](../../src/components/cpus/specifications/6502.md) supplies
the instruction names and addressing notation used in the explorer.

[monitor]: https://6502disassembly.com/a2-rom/AutoF8ROM.html
[reference]: https://github.com/jtauber/dromaios-apple2/blob/569baf98006f61e80ed93c36aa4f8d9ae23011d3/data/apple2p-rom.json
