# Altair lesson: remembering what you type

This combines [character input](terminal-lesson.md) with the
[zero-terminated message loop](terminated-message-lesson.md). The new idea is
writing through HL with MOV M,A: receiving, storing, and printing remain
separate instructions and observable effects.

[Machine definition](../../src/machines/8080/altair-buffer-lesson.machine) ·
[Machine tests](../../tests/machines/8080/altair-buffer-lesson.test.ts) ·
[Lesson](../../site/templates/remembering-what-you-type.html) ·
[Session tests](../../tests/site/buffer-lesson.test.ts) ·
[Pacing tests](../../tests/site/execution-controller.test.ts)

## Machine and program

An 8080 starts at PC `0000`, with all data registers, SP, and arithmetic flags
zero and interrupt enable, deferred enable, and halted false. It connects to
64 KiB of RAM, input readiness at port 0, consuming input at port 1, and a
separate output device at port 1. Both device latches start empty. There is no
caller completion address. RAM outside the forty-four program bytes is zero,
including the nine buffer bytes at `0100`–`0108`.

The buffer has eight character slots at `0100`–`0107` and room for a terminator
at `0108`. During normal collection HL is the next write address and B is the
remaining capacity. The following addresses and machine bytes are hexadecimal.

| Address | Bytes | Instruction | Purpose |
| --- | --- | --- | --- |
| 0000 | 21 00 01 | LXI H,0100H | Initialize the write pointer. |
| 0003 | 06 08 | MVI B,08H | Initialize eight character slots. |
| 0005 | DB 00 | IN 00H | Sample input readiness. |
| 0007 | FE 00 | CPI 0 | Is the input latch empty? |
| 0009 | CA 05 00 | JZ 0005H | Poll again if empty. |
| 000C | DB 01 | IN 01H | Consume the waiting byte into A. |
| 000E | FE 0A | CPI 10 | Compare A with LF, decimal 10. |
| 0010 | CA 19 00 | JZ 0019H | Finish on LF without storing it. |
| 0013 | 77 | MOV M,A | Store A through HL. |
| 0014 | 23 | INX H | Advance the write pointer. |
| 0015 | 05 | DCR B | Count the occupied slot. |
| 0016 | C2 05 00 | JNZ 0005H | Receive again only while capacity remains. |
| 0019 | 3E 00 | MVI A,00H | Prepare NUL. |
| 001B | 77 | MOV M,A | Explicitly append the terminator. |
| 001C | 21 00 01 | LXI H,0100H | Rewind HL for reading. |
| 001F | 7E | MOV A,M | Read a stored byte. |
| 0020 | FE 00 | CPI 0 | Is it NUL? |
| 0022 | CA 2B 00 | JZ 002BH | Finish without sending NUL. |
| 0025 | D3 01 | OUT 01H | Print a stored nonzero byte. |
| 0027 | 23 | INX H | Advance the read pointer. |
| 0028 | C3 1F 00 | JMP 001FH | Read the next byte. |
| 002B | 76 | HLT | Halt at PC 002C. |

Polling, IN, and comparisons write no RAM. MOV M,A records an opcode fetch and
one byte write; it preserves A, HL, B, and flags. INX and DCR follow separately,
so the pointer and capacity temporarily lag the store. Z successively records
readiness comparisons, LF comparisons, capacity decrements, and NUL comparisons.
The viewer must not label Z as only one of these questions.

LF ends collection without consuming capacity. At capacity, JNZ falls through
instead of consuming a ninth byte. Both paths explicitly store NUL through HL,
then rewind and print. There are no output transfers before readback, and no
input reads after collection ends. For n printable characters followed by LF,
where n is 0–7, execution takes `15 + 16n` instructions with input already ready
at each readiness check. A full eight-character buffer takes 137 instructions,
without LF. Every empty readiness poll adds three instructions.

Normal writes are exactly n character stores followed by a NUL store at
`0100 + n`; none extends past `0108`. Readback sends the n stored characters,
without LF or NUL. Final A is zero, B is `8 - n`, HL points at the terminator,
PC is `002C`, and halted is true. S/Z/AC/P/CY are 0/1/1/1/0. Other data registers,
SP, and interrupt state are unchanged. An empty line writes NUL at `0100` and
executes no OUT. This bound assumes normal execution from the start; manually
selecting later instructions can bypass setup or capacity checks.

## Input, views, and restart

The session uses `buffer` with the existing character input, RAM window, and
terminal views. H is initially prepared but unsent. The CPU readouts show A,
PC, HL, B as slots left, Z, and halted. The window shows all nine bytes, marking
HL during both collection and playback. B is capacity, not an input-latch count
or an instantaneous count derived from RAM writes. Looking at either device or
the RAM window consumes no input and creates no execution records.

The [terminal input and display conventions](terminal-lesson.md#input-and-output)
apply. Enter sends the prepared character; the separate LF button ends this
program's collection. The host never copies field text to RAM, enforces the
eight-byte capacity, appends NUL, or replays a stored host string. The CPU does
all of that through instructions. The device can still accept a later byte
after collection finishes; it stays pending through playback and HALT until
restart, and a full device rejects another offer without replacement.

The raw byte interface accepts every byte. Only LF ends collection; other
values, including NUL, are stored and counted. A stored NUL ends readback early.
Printable ASCII from the lesson's field cannot introduce that case. Other raw
control or non-ASCII bytes follow the existing display conventions.

All forty-four program bytes and the twenty-two instruction starts are guarded.
Buffer bytes remain editable while stopped. Captured store descriptions use
the recorded write, not the current RAM contents. Editing a stored byte before
readback changes output; editing after MOV A,M does not change the value in A.
STOP preserves all state and pending input. HLT ends pacing once and prevents
further steps, including after EXAMINE changes PC.

Starting again cancels callbacks and constructs fresh components, restoring
the program, zero RAM, all initial CPU state, empty devices and output history,
zero counts, and the prepared H. Pace and guide preferences survive. Machine
reset instead clears the input/output latches and CPU control state, releasing
HALT and setting PC to zero while preserving data registers, arithmetic flags,
RAM, and host output history. Neither reset sends output.

## Acceptance

- Independently check the complete image and initial state, empty polling,
  and every state/access in H followed by LF and playback.
- Test all lengths 0–8, with nonzero bytes around and within the buffer to
  prove the explicit terminator write and unchanged memory beyond capacity.
- Keep a later byte pending after collection, especially a ninth character
  after a full buffer; no readback instruction may consume or store it.
- Test all 256 raw bytes, distinguishing LF collection from NUL readback.
- Show no output while collecting; preserve spaces, repeated letters, the
  digit zero, and literal punctuation during playback.
- Edit RAM after a store; retain its captured explanation and output the
  edited byte only when the readback instruction actually reads it.
- STOP before a store with LF pending. Resume the same store once. Restart
  before polling, stores, rewinding, reading, output, and HLT; reject stale
  callbacks for both old and new sessions.
- In the browser, check the first-character walkthrough, HI then LF, an
  empty line, eight characters without LF, extra pending input, restart,
  captured writes, narrow layouts, keyboard controls, and preceding lessons.
