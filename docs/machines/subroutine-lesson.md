# Altair lesson: remembering where to return

This introduces CALL, RET, and SP using the familiar
[zero-terminated printing loop](terminated-message-lesson.md). Two sequential
calls execute one routine, saving different continuations in the same RAM.
Nested calls and register saving are later lessons.

[Machine definition](../../src/machines/8080/altair-subroutine-lesson.machine) ·
[Machine tests](../../tests/machines/8080/altair-subroutine-lesson.test.ts) ·
[Lesson](../../site/templates/remembering-where-to-return.html) ·
[Session tests](../../tests/site/subroutine-lesson.test.ts) ·
[Pacing tests](../../tests/site/execution-controller.test.ts)

## Machine and program

An 8080 starts with PC, SP, data registers, and arithmetic flags zero;
interrupt enable, deferred enable, and halted are false. It connects to 64 KiB
of RAM and the teaching byte-output device at port 1, initially empty. There
is no input device or caller completion address. Only the following program
and the message are initially nonzero. All addresses and bytes below are hex.

| Address | Bytes | Instruction | Purpose |
| --- | --- | --- | --- |
| 0000 | 31 00 02 | LXI SP,0200H | Select an empty stack starting point. |
| 0003 | CD 0A 00 | CALL 000AH | Save return address 0006, then enter the routine. |
| 0006 | CD 0A 00 | CALL 000AH | Save return address 0009, then enter the same routine. |
| 0009 | 76 | HLT | Finish in the caller, with PC at 000A. |
| 000A | 21 00 01 | LXI H,0100H | Start each visit at the first message byte. |
| 000D | 7E | MOV A,M | Read through HL. |
| 000E | FE 00 | CPI 0 | Test for NUL. |
| 0010 | CA 19 00 | JZ 0019H | Return on NUL without sending it. |
| 0013 | D3 01 | OUT 01H | Send one byte. |
| 0015 | 23 | INX H | Advance HL. |
| 0016 | C3 0D 00 | JMP 000DH | Read the next message byte. |
| 0019 | C9 | RET | Resume at the address read from the stack. |

The twenty-six program bytes occupy `0000`–`0019`. Message bytes at
`0100`–`0106` are `48 45 4C 4C 4F 0A 00`: HELLO, LF, NUL. The two stack
locations used by normal execution are `01FE`–`01FF`, initially zero.

LXI SP selects `0200` without accessing stack RAM. Each CALL fetches its
three instruction bytes before writing the return address: high byte `00`
to `01FF`, then low byte `06` or `09` to `01FE`. It leaves SP at `01FE` and
PC at `000A`, without fetching the routine's first instruction. CALL does
not print or alter A, HL, or flags. Both writes are recorded even when the
high byte was already zero.

RET fetches `C9` at `0019`, then reads low at `01FE` and high at `01FF`.
It restores SP to `0200` and sets PC to the combined value, preserving data
registers, flags, output, and RAM. The saved bytes remain after return.
The second CALL overwrites them; RET reads the live bytes, not a remembered
host continuation. The CPU has no stack-depth field or protection based on
the displayed window. Manual jumps can bypass initialization or matching calls.

## Observable sequence

| Completed instructions | Next PC | SP | Stack bytes at 01FE, 01FF | Output writes |
| --- | --- | --- | --- | --- |
| 0 | 0000 | 0000 | 00 00 | 0 |
| 1 | 0003 | 0200 | 00 00 | 0 |
| 2 | 000A | 01FE | 06 00 | 0 |
| 42 | 0019 | 01FE | 06 00 | 6 |
| 43 | 0006 | 0200 | 06 00 | 6 |
| 44 | 000A | 01FE | 09 00 | 6 |
| 84 | 0019 | 01FE | 09 00 | 12 |
| 85 | 0009 | 0200 | 09 00 | 12 |
| 86 | 000A, halted | 0200 | 09 00 | 12 |

The display contains `HELLO\nHELLO\n`. Final A is zero, HL is `0106`, and
S/Z/AC/P/CY are 0/1/1/1/0. B, C, D, E, and interrupt state are unchanged.
Program and message bytes are unchanged. Only the two stack locations are
written, twice each. Further CPU steps while halted fetch nothing, despite
PC pointing to a valid routine entry.

For a shortened message with n nonzero bytes before NUL, each visit still
returns and the program takes `14 + 12n` instructions. An empty message takes
14 instructions and sends no output. Editing message RAM between calls changes
the second output; it is read again rather than replayed by the host.

## Views, editing, and restart

The `subroutine` session reuses terminal output and the RAM-window renderer.
Readouts show A, PC, HL, SP, Z, and halted. Separate windows follow HL over
the message and SP over the two stack locations. Stack rows use fixed low/high
byte roles instead of ASCII. An SP outside this window is reported as outside,
not interpreted as a general proof of an empty stack. Inspection reads concrete
RAM only and neither changes the CPU nor creates instruction records.

Descriptions and traces retain captured CALL/RET records, including SP changes
and ordered RAM transfers. Overwriting saved bytes or executing another call
cannot rewrite the earlier explanation. All program bytes and twelve instruction
starts are guarded; message and stack data remain editable while stopped.
Changing the first saved address from `0006` to `0009` makes RET select HLT,
skipping the second call. A return to an unknown instruction address completes
normally, then the lesson guard prevents the following step. This guard is a
teaching constraint, not a CPU check on return addresses.

STOP preserves registers, stack RAM, output, and captured history. Restart
cancels queued callbacks and creates fresh components, restoring program and
message, zero stack RAM and CPU state, empty output, and zero counts/history.
Pace and guide preferences survive. Machine reset instead clears the output
latch and CPU control state, sets PC to zero, and releases HALT while preserving
SP, data registers, arithmetic flags, RAM, and host output history.

## Acceptance

- Independently check the entire initial image, component isolation, and every
  state and access in the 86-instruction run.
- Verify high-then-low CALL writes, low-then-high RET reads, preserved registers
  and flags, reused stack bytes, no output from CALL/RET, and halted no-ops.
- Test message lengths 0–6 with sentinels around the two stack bytes.
- Edit saved addresses, including a destination outside the lesson's instruction
  starts, and preserve the original captured descriptions and traces.
- Show that the second call reads current message RAM.
- Check STOP/resume around CALL and RET, and restart before setup, calls,
  message reads/output, returns, and HLT; old callbacks cannot affect either run.
- In the browser, follow both calls and returns, inspect both RAM markers,
  test the stack-edit experiment, restart, keyboard controls, narrow layouts,
  and the preceding message/buffer views.
