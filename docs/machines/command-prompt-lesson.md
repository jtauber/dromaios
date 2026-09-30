# A tiny command prompt

This capstone follows [register preservation](save-registers-lesson.md). It
combines printing, bounded input, comparisons, calls, and a RAM stack into a
repeating command interpreter. It is a teaching program, not historical Altair
software. The learner-facing page is
[`a-tiny-command-prompt.html`](../../site/templates/a-tiny-command-prompt.html).

## Machine and image

[`altair-command-prompt-lesson.machine`](../../src/machines/8080/altair-command-prompt-lesson.machine)
authors an 8080 with all registers, flags, and control state initially zero/false,
64 KiB of RAM, input readiness at port 0, input data at port 1, and a separate
output device at port 1. Input holds one pending byte. No CPU instruction runs
during construction. There is no `end` address or HLT. Uninitialized RAM is zero.
All addresses and byte values below are hexadecimal unless stated otherwise.

| Region | Purpose |
| --- | --- |
| 0000–0073 | 116 fixed program bytes, comprising 52 instruction starts. |
| 0100–0107 | Up to eight received characters. |
| 0108 | Extra space for NUL when all character slots are used. |
| 0120–0122 | `3E 20 00`: prompt `> ` and NUL. |
| 0130–0136 | `HELLO`, LF, NUL. |
| 0140–014F | `H=HELLO ?=HELP`, LF, NUL. |
| 0160–0168 | `UNKNOWN`, LF, NUL. |
| 01FC–01FD | Saved L/H while printing. |
| 01FE–01FF | Low/high return address for either routine. |

The source image comments give every instruction's address, bytes, and mnemonic.
The main loop at 0003 selects the prompt, calls print at 0065, sets HL to 0100,
and puts eight in B. Collection at 000E calls receive at 005B, compares A with
LF, and either ends the line or stores and echoes the byte. INX H advances the
pointer; DCR B counts down. When B reaches zero, the drain loop at 001E calls
receive and discards bytes until LF.

Line ending at 0026 writes NUL through HL and outputs LF. MOV A,B at 002D
copies the remaining count for comparison. B = 8 means empty; B = 7 means
exactly one character; all other values select UNKNOWN. The one-character path
sets HL to 0100 and reads its command from RAM at 003B. It compares with H (48),
then ? (3F), choosing the greeting at 004C or help at 0052. Unknown lines select
the message at 0046. The shared reply path at 0055 calls print and jumps to 0003.

## Input and output contract

Commands are exact, case-sensitive lines terminated by LF (0A):

| Input line | Reply after the echoed line and LF |
| --- | --- |
| `H` | `HELLO` and LF. |
| `?` | `H=HELLO ?=HELP` and LF. |
| Empty | No reply; print the next prompt. |
| Any other line | `UNKNOWN` and LF. |

The first eight non-LF bytes are stored and echoed. Excess bytes are consumed
but neither stored nor echoed. A full buffer still waits for LF; discarded
characters cannot become subsequent commands. The guest appends NUL exactly
once per line at `0100 + min(length, 8)`, with no write beyond 0108. Returning
to the prompt resets HL and B without clearing RAM. Each later line overwrites
its data and writes a new terminator; old suffix bytes can remain visible.

Only LF delimits input, including through the raw device API. NUL is stored
and echoed like any other non-LF byte. Dispatch checks the length in B before
reading the command, so an embedded NUL cannot make a longer line match H or ?.
The character field offers printable ASCII; its Enter key sends the prepared
character. A separate button sends LF. There is no host line editor, input
queue, local echo, or command dispatcher. A byte offered while printing may
wait in the device until the next receive; a second offer cannot overwrite it.

Every displayed byte comes from an executed OUT, including prompts, input echo,
line endings, and replies. The shared teaching display interprets LF as a new
line, labels other controls, and retains the most recent 256 output bytes.
The total write count remains cumulative. The host never completes the run at
a new prompt; RUN continues until STOP, page hiding, restart, or a lesson guard.

## Calls, state, and observation

The receive routine polls port 0 without consuming input, then reads port 1
into A and returns. It preserves B and HL. The print routine PUSHes H, follows
HL to NUL with MOV/CPI/JZ/OUT/INX/JMP, POPs H, and returns. It preserves B and HL,
leaving A = 0 and comparison flags from the final NUL. Each RET restores SP to
0200. Waiting inside receive uses SP 01FE; printing uses at most four stack
bytes down to 01FC. Polling does not keep making new calls.

After the first 24 instructions, output is `> `, PC is 005B, HL is 0100,
B is 8, SP is 01FE, and RAM at 01FE–01FF holds return address 0011. Empty
polling repeats 005B → 005D → 005F → 005B, consuming no data, writing no RAM,
and producing no output. Normal execution changes only A, B, HL, PC, SP,
arithmetic flags, the buffer, stack, and the two devices; C/D/E and interrupt
state remain unchanged.

The `command-prompt` session reuses character input, output, instruction history,
and RAM-window rendering. Readouts expose A, PC, HL, SP, B, Z, and halted state.
HL and SP markers are independent. Stack labels describe this program's use of
those RAM locations, not hidden CPU metadata. Inspection has no side effects;
instruction descriptions and traces use captured records.

All 116 instruction bytes and all 52 instruction starts are guarded. Data
remains editable while stopped. Editing 0100 before MOV at 003B changes the
command; editing it afterward does not replace the captured byte in A.
Editing the greeting at 0130 changes the response without changing recognition.
The learner experiment pauses after 24 instructions, deposits 4A at 0130, then
EXAMINEs 005B to restore PC: H followed by LF now prints JELLO. Panel edits
preserve the other CPU state; arbitrary entry into a routine can bypass setup.

STOP preserves all state, input, output, and history. Restart cancels pending
callbacks and constructs fresh components: restored images, zero CPU and RAM
outside the images, empty devices/output/history, and PC 0000. Pace and guide
preferences survive. Machine reset instead clears CPU control state and device
latches, sets PC to zero, and preserves RAM, SP, data registers, arithmetic
flags, and already delivered host output. The next run initializes SP itself.

## Acceptance

- Independently check the complete image, initial state, fresh devices, and
  startup's print/call/stack access ordering and 24-instruction boundary.
- Check all 256 possible one-byte inputs, exact matching, empty input, lowercase,
  spaces, embedded NUL, multiple commands, and repeated prompt cycles.
- Exercise lengths below, at, and beyond eight, including a command character
  in the discarded suffix. Check every buffer write, sentinels, LF draining,
  the next command, and a shorter line after a longer one.
- Verify repeated calls balance SP, preserve code/message RAM, and never write
  outside the buffer and four stack bytes during normal execution.
- Check separate offer, receive, store, and echo boundaries; live RAM dispatch,
  captured-record stability, message editing, and bounded display retention.
- Check guards, reset versus restart, STOP/resume, and stale callbacks during
  stores, dispatch, printing, and stack restoration.
- In the browser, execute H, ?, unknown, empty, and overflowing lines; follow
  buffer/stack markers, keyboard controls, restart, and narrow layouts. Check
  the preceding register-preservation lesson still runs and links here.
