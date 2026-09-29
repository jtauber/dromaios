# Altair lesson: where does a message end?

This follows [Printing a message](message-lesson.md). Instead of a count in B,
the guest program compares each byte with zero before sending it. The lesson
distinguishes a terminator chosen by a program from a memory boundary, the
ASCII character “0”, and the display's line-feed behavior.

[Machine definition](../../src/machines/8080/altair-terminated-message-lesson.machine) ·
[Machine tests](../../tests/machines/8080/altair-terminated-message-lesson.test.ts) ·
[Lesson](../../site/templates/where-does-a-message-end.html) ·
[Session tests](../../tests/site/terminated-message-lesson.test.ts) ·
[Pacing tests](../../tests/site/execution-controller.test.ts)

## Machine and program

The machine has an 8080, 64 KiB of RAM, and a byte-output device at output
port 1, with no input device or caller completion address. Every data register,
PC, SP, and flag starts at zero; interrupt enable, deferred enable, and halted
are false. The output latch starts empty. RAM outside the two images below is
zero. Addresses and bytes in this table are hexadecimal.

| Address | Bytes | Instruction | Purpose |
| --- | --- | --- | --- |
| 0000 | 21 00 01 | LXI H,0100H | Set the message pointer. |
| 0003 | 7E | MOV A,M | Read through HL into A. |
| 0004 | FE 00 | CPI 0 | Test the loaded byte for zero, preserving A. |
| 0006 | CA 0F 00 | JZ 000FH | If equal, skip output and jump to HLT. |
| 0009 | D3 01 | OUT 01H | Send the nonzero byte. |
| 000B | 23 | INX H | Advance HL, preserving A and flags. |
| 000C | C3 03 00 | JMP 0003H | Return to the read. |
| 000F | 76 | HLT | Halt with PC at 0010. |

Data at `0100`–`0106` is `48 45 4C 4C 4F 0A 00`: HELLO, LF, NUL.
One setup instruction, six trips of six instructions, and a final
MOV/CPI/JZ/HLT path give 41 completed instructions. Output is exactly six
writes: HELLO and LF. Final A is 0; H/L are `01`/`06`, HL is `0106`, PC is
`0010`, and the CPU is halted. Flags S/Z/AC/P/CY are 0/1/1/1/0. B, C, D, E,
SP, and interrupt state are unchanged. There are no RAM writes or input reads.

MOV preserves flags, so loading zero does not itself set Z. CPI sets Z from
A, not from a second read of RAM. JZ uses that captured comparison. The
terminating path does not fetch OUT, INX, or JMP; HL stays on the terminator.
Every nonzero byte takes the output path, including LF, “0” (`30`), and values
outside ASCII. B has no role in this program.

## Views and controls

The shared terminal session selects `terminated-message`. The
[RAM window and execution controls](message-lesson.md#ram-window-and-output)
apply. This window includes the seventh NUL row; the processor view shows
A, PC, HL, Z, and halted, omitting B. Z is labelled as the most recent
comparison's answer. Display conventions remain owned by the
[terminal lesson](terminal-lesson.md#input-and-output).

All sixteen instruction bytes must match, and only the eight instruction
starts in the table are allowed for stepping. Message bytes are editable
while stopped. EXAMINE changes only PC; selecting an instruction manually
can bypass the program's checks. The host does not scan for zero, truncate
output at NUL, or enforce a message length. Only executed guest instructions
choose whether to reach OUT or HLT.

Putting zero at `0100 + n`, for n = 0 through 6, sends only the n preceding
bytes, reads no later data, and halts in `6n + 5` instructions. The remaining
RAM is unchanged. Putting zero at `0100` therefore sends nothing. Replacing
the original terminator with a nonzero byte sends it and continues beyond
the displayed range. With otherwise original RAM, it finds zero at `0107`
and halts after 47 instructions and seven writes. The window reports HL
outside its range; it is not an execution boundary. Without a reachable zero,
the program keeps looping, with 16-bit pointer wrapping. Paced execution
continues to yield between instructions and remains stoppable.

Edits after MOV cannot replace A; edits after CPI cannot replace its flag
result. Captured explanations retain the original read and comparison.
STOP preserves this state. HLT ends pacing normally, is recorded once, and
blocks subsequent stepping even after EXAMINE, as in the counted lesson.

Starting the lesson again cancels pending callbacks and constructs fresh
components, restoring both images, all initial state, an empty output latch
and display, and zero execution counts/history. Pace and guide preferences
survive. Machine reset is different: it resets the CPU and output latch,
releasing HALT and setting PC to zero, but preserves data registers, arithmetic
flags, RAM, and host output history. Reset itself sends no output.

## Acceptance

- Check the entire image and initial state independently of the factory;
  check exact states and ordered accesses for all 41 default instructions.
- Exercise every byte as the first character. Only zero may skip OUT;
  nonzero bytes must be sent once before the next zero terminates the loop.
- Place the terminator at every displayed position. Check the byte count,
  pointer, absence of later reads, and five-instruction empty-message path.
- Distinguish NUL, “0”, LF, non-ASCII bytes, and literal markup characters in
  the existing text view. Keep both L outputs and the final LF.
- Replace the final zero and observe execution beyond the RAM window.
- Change RAM after MOV and CPI for both branch outcomes. Preserve A, Z,
  captured explanations, and the resulting output or halt.
- Corrupt every program byte and choose operand PCs: refuse execution
  without effects. Permit message edits independently of the guard.
- STOP after comparison; resume the same decision. Restart before reads,
  comparisons, branches, output, or HLT; reject callbacks from the old run.
- In the browser, check the seventh RAM row, unused-counter omission,
  terminator highlighting, empty output, comparison timing, edited messages,
  keyboard use, narrow layouts, and the preceding counted-message lesson.
