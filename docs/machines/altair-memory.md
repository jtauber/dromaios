# Altair lesson: switches, lights, and memory

This first historical-machine lesson follows the
[8080 comparison lesson](../cpus/8080/examples/comparison.md). It connects the
existing bit and memory concepts to four Altair 8800 front-panel operations.

[RAM definition](../../src/machines/lessons/altair-memory.machine) ·
[Panel model](../../site/interactive/altair-panel.ts) ·
[Controller](../../site/interactive/altair-explorer.ts) ·
[Lesson](../../site/templates/altair-memory.html) ·
[Instrument](../../site/templates/instruments/altair-panel.html) ·
[Tests](../../tests/site/altair-panel.test.ts)

## Hardware reference and model boundary

The primary reference is the MITS
[Altair 8800 Operator's Manual](https://altairclone.com/downloads/manuals/Altair%208800%20Operator%27s%20Manual.pdf#page=29),
Part 3, sections A (switches and LEDs) and B (loading a sample program).
Sixteen switches supply an address; switches 7–0 also supply a data byte.
Up denotes 1 and down denotes 0. Address and data lights show the selected
location and its contents. The lesson presents the paired momentary controls
as four buttons and rearranges the lamps and switches for narrow screens.
Digits, number guides, operation previews, and explanatory records are teaching
aids added by the site.

This is a memory-controls model, not yet a complete Altair emulator. The generated
component-only factory supplies 64 KiB of RAM; the browser panel owns its switch
word and selected address. There is no CPU, program counter, bus-cycle injection,
timing, status-lamp simulation, memory protection, RUN, STOP, or hardware RESET.
The panel accesses RAM directly. Later CPU integration must account for the
hardware's coupling between the front panel, CPU, and bus rather than treating
this selected address as an independently emulated hardware register.

All addresses are backed by RAM here. The actual machine's installed memory
boards determined its capacity. Initial zero-filled RAM, selected address zero,
and all switches down are deterministic lesson choices, not hardware power-up
guarantees.

## State and operations

Switches form a sixteen-bit word. Moving any switch changes only that word;
it cannot select an address or write RAM. The data lights read RAM at the
selected address. The last-operation explanation remains unchanged when
switches or number-guide visibility change.

| Operation | Selected address afterward | RAM effect |
| --- | --- | --- |
| EXAMINE | Full switch word | Read the selected byte; no write. |
| EXAMINE NEXT | Previous address + 1, wrapping to 16 bits | Read the next byte; no write. |
| DEPOSIT | Unchanged | Write the low eight switch bits at the selected address. |
| DEPOSIT NEXT | Previous address + 1, wrapping to 16 bits | Write the low eight switch bits at the next address. |

All four operations preserve the switch positions. NEXT ignores the switches
when choosing its address; DEPOSIT NEXT uses their low byte only for data.
Its increment happens before writing. The view does not record these host
actions as CPU instructions.

Start again constructs fresh RAM and panel state and clears the last-operation
explanation. It preserves the reader's number-guide preference. It is explicitly
different from the Altair's RESET control, which does not erase RAM.

## Learning sequence and acceptance

1. Raise switches 1 and 0, preparing 3 while address lights remain zero.
2. EXAMINE selects address 3 and displays its initial zero byte.
3. Prepare 41 with switches 5, 3, and 0. The lights remain at address 3, data 0.
4. DEPOSIT stores 41 at address 3. Address 41 remains untouched.
5. Prepare 42 with switches 5, 3, and 1. DEPOSIT NEXT selects 4 and stores 42.
6. Prepare 3, EXAMINE, then EXAMINE NEXT. Read 41 and 42 without changing either.

An optional experiment selects FFFF with all switches up. EXAMINE NEXT reads
address 0; DEPOSIT NEXT writes there. A repeated NEXT operation advances again,
without changing the switches. Number guides can be hidden to practice reading
bits; the light digits remain visible, so color is never the sole signal.

Tests independently check the full initial RAM image, the learning sequence,
unchanged surrounding memory, all byte values with high address switches set,
both NEXT operations and wrapping, live RAM inspection, switch validation,
and fresh-machine isolation. Browser checks cover those controls, their lights,
operation explanations, hidden guides, restart, keyboard operation, mobile
layout, and preceding lessons. Without JavaScript, controls are disabled and
the teaching text remains available.
