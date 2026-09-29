# A routine inside a routine

This browser lesson follows [Remembering where to return](subroutine-lesson.md).
It makes two pending continuations visible by moving the printing loop's OUT
into a character routine. Register saving is a later lesson.

## Machine and program

[`altair-nested-call-lesson.machine`](../../src/machines/8080/altair-nested-call-lesson.machine)
defines an 8080 with all registers, flags, and control state initially zero/false,
64 KiB of RAM, and a teaching byte-output device at port 1. There is no input
device or completion address. Uninitialized RAM is zero. All addresses and
bytes below are hexadecimal.

| Address | Bytes | Instruction | Purpose |
| --- | --- | --- | --- |
| 0000 | 31 00 02 | LXI SP,0200H | Choose the stack starting point. |
| 0003 | CD 0A 00 | CALL 000AH | Save outer continuation 0006. |
| 0006 | CD 0A 00 | CALL 000AH | Save outer continuation 0009. |
| 0009 | 76 | HLT | Finish in the main program. |
| 000A | 21 00 01 | LXI H,0100H | Start each printing visit at the message. |
| 000D | 7E | MOV A,M | Read a character through HL. |
| 000E | FE 00 | CPI 0 | Test for NUL. |
| 0010 | CA 1A 00 | JZ 001AH | Select the outer RET for NUL. |
| 0013 | CD 1B 00 | CALL 001BH | Save inner continuation 0016. |
| 0016 | 23 | INX H | Advance after the inner return. |
| 0017 | C3 0D 00 | JMP 000DH | Read the next character. |
| 001A | C9 | RET | Return from the printing routine. |
| 001B | D3 01 | OUT 01H | Send A from the character routine. |
| 001D | C9 | RET | Return to the printing loop. |

The thirty program bytes occupy `0000`–`001D`. Message bytes at `0100`–`0106`
are `48 45 4C 4C 4F 0A 00`: HELLO, LF, NUL. Normal outer calls use
`01FE`–`01FF`; inner calls use `01FC`–`01FD`.

The outer CALL writes high `00` at `01FF`, then low `06` or `09` at `01FE`.
The inner CALL writes high `00` at `01FD`, then low `16` at `01FC`, leaving
the outer pair unchanged. Each CALL fetches its three instruction bytes before
these writes and leaves PC at the destination without fetching its first byte.
Both writes are recorded even when they repeat existing values.

The inner RET reads low at `01FC`, then high at `01FD`, sets PC to `0016`,
and advances SP to `01FE`. The outer RET reads low at `01FE`, then high at
`01FF`, and advances SP to `0200`. Neither erases RAM or restores registers
and flags. Each RET uses current RAM, not a host continuation or call-depth
field. Only OUT writes to the display.

## Observable sequence

| Completed instructions | Next PC | SP | Bytes at 01FC–01FF | Output writes |
| --- | --- | --- | --- | --- |
| 0 | 0000 | 0000 | 00 00 00 00 | 0 |
| 1 | 0003 | 0200 | 00 00 00 00 | 0 |
| 2 | 000A | 01FE | 00 00 06 00 | 0 |
| 7 | 001B | 01FC | 16 00 06 00 | 0 |
| 8 | 001D | 01FC | 16 00 06 00 | 1 |
| 9 | 0016 | 01FE | 16 00 06 00 | 1 |
| 54 | 001A | 01FE | 16 00 06 00 | 6 |
| 55 | 0006 | 0200 | 16 00 06 00 | 6 |
| 56 | 000A | 01FE | 16 00 09 00 | 6 |
| 109 | 0009 | 0200 | 16 00 09 00 | 12 |
| 110 | 000A, halted | 0200 | 16 00 09 00 | 12 |

The display contains `HELLO\nHELLO\n`. Final A is zero, HL is `0106`, and
S/Z/AC/P/CY are 0/1/1/1/0. B, C, D, E, and interrupt state are unchanged.
Program and message RAM are unchanged. Each outer stack byte is written twice;
each inner stack byte is written twelve times. Further halted steps do nothing.

A message with n nonzero bytes before NUL takes `14 + 16n` instructions and
sends `2n` bytes. An empty message takes 14 instructions, returns twice, and
never calls the character routine or accesses the inner pair.

## Views, editing, and restart

The `nested-call` session reuses the shared CALL/RET descriptions, terminal,
and RAM-window renderer. Readouts show A, PC, HL, SP, Z, and halted. Independent
markers follow HL across seven message bytes and SP across four stack bytes.
Fixed inner/outer low/high labels describe this program's use of these
locations, including after return. An outside-window SP is reported literally;
the viewer does not infer stack depth or impose a CPU stack limit.

All thirty program bytes and fourteen instruction starts are guarded. Stack
and message RAM remain editable while stopped. Captured descriptions and traces
do not change when their underlying RAM is later edited or reused. A RET to an
unknown instruction address completes before the lesson blocks the next step.

The page's experiment changes the outer low byte at `01FE` from `06` to `09`
after instruction 7, then restores PC to `001B`. The inner RET still selects
`0016`; printing completes normally. The outer RET selects HLT and skips the
second call. This path takes 56 instructions and sends one HELLO line.
Editing the inner address instead can change the printing loop's continuation
without changing the outer pair; neither destination is chosen by the viewer.

STOP preserves registers, both pairs, output, and captured history. Restart
cancels queued work and creates fresh components: zero CPU and stack state,
restored program/message, empty output, and zero counts/history. Pace and guide
preferences survive. Machine reset instead clears the output latch and CPU
control state, sets PC to zero, and releases HALT, preserving SP, data registers,
arithmetic flags, RAM, and host output history.

## Acceptance

- Independently check the whole initial image and all 110 instruction records,
  including ordered stack accesses, preserved state, and output transfers.
- Check message lengths 0–6 with sentinels around the four stack bytes;
  an empty message leaves the inner pair untouched.
- Distinguish inner and outer returns, retained bytes, and repeated pair reuse.
- Change either saved continuation while both calls are active, including an
  unknown destination; retain the original captured descriptions and traces.
- Check program guards, STOP/resume with two pending returns, and restart
  around calls, output, returns, and HLT. Stale callbacks affect neither run.
- In the browser, inspect both RAM markers, follow nested and outer returns,
  run the stack-edit experiment, restart, and check keyboard controls and narrow
  layouts. The preceding subroutine lesson must retain its two-byte stack view.
