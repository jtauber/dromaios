# Altair lesson: printing a message

This follows [A different reply](reply-lesson.md), using the existing
[8080 port-output example](../cpus/8080/examples/output.md) unchanged. That
specification owns the machine image, initial state, exact execution, reset,
and failure behavior. Its independent tests already check all 33 instruction
records and device transfers. This lesson makes the example explorable in the
shared panel and terminal views.

[Lesson](../../site/templates/printing-a-message.html) ·
[Session tests](../../tests/site/message-lesson.test.ts) ·
[Pacing tests](../../tests/site/execution-controller.test.ts) ·
[RAM window](../../site/interactive/ram-window-view.ts) ·
[Program descriptions](../../site/interactive/altair-program.ts)

## Learning path and state

The program at `0000` sets HL to `0100` and B to 6. Its loop reads the byte
at HL into A, sends A through OUT, increments HL, decrements B, and branches
while B is nonzero. The six message bytes spell HELLO followed by LF. The
last branch falls through to HLT at `000D`; final PC is `000E`.

The lesson starts with the first pointer assignment, then follows one byte
through MOV and OUT before introducing repetition. It distinguishes PC from
HL, an address from its contents, and the two byte registers H/L from their
combined sixteen-bit address. The count is explicit: LF and zero have no
special meaning to the guest loop. Only DCR B updates the count, after OUT
and INX, so intermediate states must not infer remaining bytes from writes.

The browser shows A and B in decimal, PC and HL in hexadecimal, Z, and the
CPU's halted state. Recorded traces additionally show B or HL when it changes
and mark an executed HLT. Instruction descriptions use the captured record;
later memory edits cannot rewrite a completed load or output.

## RAM window and output

The reusable RAM window takes a concrete RAM component, rows with absolute
addresses, and a named pointer supplied from the CPU snapshot. It displays
the current bytes at `0100`–`0105` as hexadecimal and ASCII labels. The row
at HL has both a visible arrow and `aria-current`; the status identifies an
out-of-window pointer without clamping it to the nearest displayed row.
Initially HL is `0000`, and after the last INX it is `0106`; neither selects
a row. Inspecting these RAM locations changes no CPU or device state and
creates no execution records. This view is not a general device inspector.

The existing [terminal output conventions](terminal-lesson.md#input-and-output)
apply, including LF as a new line, labelled control and non-ASCII bytes,
literal text rendering, and the latest 256-byte window. There is no input
device or character field on this page. Pointer movement, RAM edits, and
MOV do not add output; only actual device writes do.

## Execution controls and editing

The shared program view derives the start address from its instruction list,
so the reference card, fixed-image guard, and panel hints use `0000` here.
All fourteen instruction bytes must match. Message bytes remain editable via
the stopped panel; changing them does not change the guard or byte count.
Only the eight program instruction starts are permitted for stepping.
EXAMINE changes PC while preserving the other registers, flags, and halted
state. Choosing a later start manually can bypass setup or loop checks.

HLT returns a completed instruction record with outcome `halted`. It is
recorded once and ends paced execution normally. An already halted CPU is
blocked before stepping, so no empty halted records enter history. RUN and
Step stay unavailable after HLT, including if EXAMINE changes PC. The lesson
does not offer interrupts or a CPU-only reset control.

STOP is a host pause and can be resumed. Starting again cancels queued work
and constructs a fresh example: original program and HELLO bytes, zeroed
registers/flags, PC `0000`, not halted, empty output, and cleared counts and
history. Pace and guide preferences survive. This is distinct from the
machine's reset contract, which preserves RAM and data registers.

## Acceptance

- Match the unchanged example image and register/flag transitions. Verify
  that LXI/MVI produce no output, MOV reads through HL, OUT preserves HL/B,
  INX preserves A, and DCR controls the following JNZ.
- Retain both L outputs and the final LF, with 33 instructions and six writes.
  Check final A = 10, B = 0, HL = `0106`, PC = `000E`, Z = 1, and halted.
- Edit H to J before reading to produce JELLO with the same path and count.
  Edit after MOV and restore PC to OUT: it must still send the captured H,
  while RAM displays J and the earlier record still reports the original read.
- Include zero, early LF, and bytes outside ASCII in the six-byte message;
  all six must be sent, with no RAM writes or terminator-based stopping.
- Reject corrupted instructions and operand PCs without executing. Allow
  message data edits. EXAMINE after HLT must not release the halted state.
- STOP before OUT must preserve the loaded byte. Restart before a read,
  output, or HLT must invalidate callbacks for both old and new sessions.
- In the browser, check pointer highlighting, captured reads, both equal L
  writes, the out-of-window pointer, automatic stop at HLT, restart, message
  editing, keyboard controls, narrow layouts, and the earlier terminal lessons.
