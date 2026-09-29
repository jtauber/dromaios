# Keeping a value across a call

This lesson follows [nested calls](nested-call-lesson.md). A printing routine
preserves the caller's message pointer with PUSH H and POP H. It sends bytes
directly with OUT, keeping the stack view to one saved register pair and one
return address.

## Machine and program

[`altair-save-registers-lesson.machine`](../../src/machines/8080/altair-save-registers-lesson.machine)
defines an 8080 with all registers, flags, and control state initially zero/false,
64 KiB of RAM, and a teaching byte-output device at port 1. There is no input
device or completion address. Uninitialized RAM is zero. Addresses and bytes
below are hexadecimal.

| Address | Bytes | Instruction | Purpose |
| --- | --- | --- | --- |
| 0000 | 31 00 02 | LXI SP,0200H | Choose the stack starting point. |
| 0003 | 21 00 01 | LXI H,0100H | Choose the message once. |
| 0006 | CD 0D 00 | CALL 000DH | Save return address 0009. |
| 0009 | CD 0D 00 | CALL 000DH | Save return address 000C. |
| 000C | 76 | HLT | Finish in the caller. |
| 000D | E5 | PUSH H | Save the caller's H and L. |
| 000E | 7E | MOV A,M | Read a message byte through HL. |
| 000F | FE 00 | CPI 0 | Test for NUL. |
| 0011 | CA 1A 00 | JZ 001AH | Select POP for NUL. |
| 0014 | D3 01 | OUT 01H | Send A. |
| 0016 | 23 | INX H | Advance the pointer. |
| 0017 | C3 0E 00 | JMP 000EH | Read the next byte. |
| 001A | E1 | POP H | Restore L and H from the stack. |
| 001B | C9 | RET | Read the next pair into PC. |

The twenty-eight program bytes occupy `0000`–`001B`. The message at
`0100`–`0106` is `48 45 4C 4C 4F 0A 00`: HELLO, LF, NUL.
CALL writes high `00` at `01FF`, then low `09` or `0C` at `01FE`.
PUSH H writes H (`01`) at `01FD`, then L (`00`) at `01FC`, leaving HL
unchanged and SP at `01FC`. Repeated writes are retained in execution records.

The loop advances HL through the message. POP H reads L at `01FC`, then H
at `01FD`, restoring HL to `0100` and advancing SP to `01FE`. PC advances
to `001B`. RET then reads the low/high return address from `01FE`/`01FF`,
sets PC from it, and advances SP to `0200`. Neither operation erases RAM.
Only OUT changes host output. The routine preserves HL, but leaves A and flags
as set by reading and testing NUL. No CPU or viewer convention restores them.

## Observable sequence

| Completed instructions | Next PC | HL | SP | Bytes at 01FC–01FF | Output writes |
| --- | --- | --- | --- | --- | --- |
| 0 | 0000 | 0000 | 0000 | 00 00 00 00 | 0 |
| 2 | 0006 | 0100 | 0200 | 00 00 00 00 | 0 |
| 3 | 000D | 0100 | 01FE | 00 00 09 00 | 0 |
| 4 | 000E | 0100 | 01FC | 00 01 09 00 | 0 |
| 43 | 001A | 0106 | 01FC | 00 01 09 00 | 6 |
| 44 | 001B | 0100 | 01FE | 00 01 09 00 | 6 |
| 45 | 0009 | 0100 | 0200 | 00 01 09 00 | 6 |
| 46 | 000D | 0100 | 01FE | 00 01 0C 00 | 6 |
| 47 | 000E | 0100 | 01FC | 00 01 0C 00 | 6 |
| 87 | 001B | 0100 | 01FE | 00 01 0C 00 | 12 |
| 88 | 000C | 0100 | 0200 | 00 01 0C 00 | 12 |
| 89 | 000D, halted | 0100 | 0200 | 00 01 0C 00 | 12 |

The display contains `HELLO\nHELLO\n`. Final A is zero and S/Z/AC/P/CY are
0/1/1/1/0. B, C, D, E, and interrupt state are unchanged. Message and program
RAM are unchanged. Each stack byte is written twice. Halted steps do nothing.
A message with n nonzero bytes takes `17 + 12n` instructions and sends `2n`
bytes. Even an empty message saves/restores HL and returns twice.

## Views, editing, and restart

The `save-registers` session reuses the terminal and RAM-window renderer.
Readouts show A, PC, HL, SP, Z, and halted. Independent markers follow HL
through the seven-byte message window and SP through four stack locations.
Fixed saved-L, saved-H, and return-low/high labels describe this program's
use of those locations. The viewer infers no stack depth or CPU stack limit.
PUSH/POP descriptions and traces retain captured transfers and state, even
after later edits or reuse. Inspection changes no CPU, memory, or history.

All twenty-eight program bytes and fourteen instruction starts are guarded.
Message and stack data remain editable while stopped. These experiments use
the panel; EXAMINE changes PC while preserving HL, SP, and the rest of the state:

- After instruction 4, change saved L at `01FC` to `01`, then restore PC to
  `000E`. HL remains `0100` while the first call prints HELLO. POP restores
  `0101`; the second call therefore prints ELLO. The run takes 83 instructions,
  sends eleven bytes, and finishes with HL `0101`. The original PUSH record
  still describes saving `0100`.
- After instruction 43, EXAMINE `001B` to skip POP. RET reads the saved pointer
  as a return address, selecting PC `0100`. HL remains `0106`, SP advances to
  `01FE`, and the six output bytes remain. The lesson blocks the next step at
  the unknown instruction address; RET itself executed normally. The CPU does
  not identify a mismatched saved value or consult a hidden continuation.

STOP preserves all state and history. Restart cancels queued work and creates
fresh components: zero CPU/stack state, restored program/message, empty output,
and zero counts/history. Pace and guide preferences survive. Machine reset
instead clears CPU control state and the output latch, sets PC to zero, and
releases HALT, preserving SP, data registers, arithmetic flags, RAM, and host
output history.

## Acceptance

- Independently check the complete initial image and all 89 instruction records,
  including CALL/PUSH write order and POP/RET read order, register and flag
  preservation, output transfers, and halted no-ops.
- Test message lengths 0–6 with sentinels around the four stack bytes.
- Check saved-data edits, including both bytes of HL; POP reads live RAM while
  captured descriptions and traces remain unchanged. Verify the skip-POP path.
- Guard every program byte and instruction start without a hidden stack model.
- Check STOP/resume and restart around PUSH, POP, RET, output, and HLT; stale
  callbacks cannot change either run.
- In the browser, follow pointer preservation and both experiments, independent
  RAM markers, keyboard controls, restart, and narrow layouts. Check the
  preceding nested-call view still shows its two return addresses.
