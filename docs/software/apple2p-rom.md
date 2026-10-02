# Following the Apple II Plus ROM

## ROM walkthrough

The Apple II can reach its Applesoft prompt without a disk. Follow that path in
the [browser machine](../../src/machines/6502/apple2.md#using-the-browser-machine), then watch one
keypress travel from the keyboard latch to the screen. Open **Explore the ROM**
under the keyboard. Keep it open while stepping; the latest twelve instructions
show their fetched bytes, assembly, register and flag changes, and memory accesses.
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

At **KEYIN2**, type `A` into the Apple II keyboard without pressing Enter.
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
does not read through the guest bus, inspect disk bytes, or replay instructions
to produce explanations. The machine's
[model limitations](../../src/machines/6502/apple2.md#components-and-address-decoding) still apply.

## ROM identity and stops

This record supplies the browser's routine selector and trace annotations.
Addresses and labels apply only to the motherboard image identified below;
the build checks it against the machine's firmware declaration. These selected
entry points are not a full symbol table. “Acknowledge key” names an instruction
within KEYIN, rather than a separate subroutine.

```json
{
  "sha256": "378ba00c86a64cca49cedaca7de8d5d351983ebc295d9d11e0752febfc346249",
  "routines": [
    { "address": "FA62", "name": "RESET", "description": "Begin the autostart firmware's reset path." },
    { "address": "FC58", "name": "HOME", "description": "Clear the text window and move its cursor home." },
    { "address": "FDED", "name": "COUT", "description": "Send A through the output hook at $0036–$0037." },
    { "address": "FD0C", "name": "RDKEY", "description": "Prepare the cursor and enter the input hook at $0038–$0039." },
    { "address": "FD1B", "name": "KEYIN", "description": "Wait for a key while updating the random-number seed." },
    { "address": "FD21", "name": "KEYIN2", "description": "Test the keyboard ready bit with BIT $C000." },
    { "address": "FD2B", "name": "Acknowledge key", "description": "Read $C010 to clear the keyboard strobe." },
    { "address": "FBF0", "name": "STORADV", "description": "Store A at the text cursor, then advance it." }
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
