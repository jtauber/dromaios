# Altair lesson: typing to the computer

This follows [Bytes can be letters](../../site/templates/bytes-as-characters.html)
and reuses the [polling lesson's machine and program](altair-polling.md#machine-and-program)
unchanged. The input view prepares one printable ASCII character instead of
eight switches; the output view retains text from actual output-device writes.
This is a teaching terminal, without historical serial or display hardware.

[Lesson](../../site/templates/typing-to-the-computer.html) ·
[Session and output retention](../../site/interactive/terminal-lesson.ts) ·
[Input view](../../site/interactive/character-input-view.ts) ·
[Output view](../../site/interactive/terminal-output-view.ts) ·
[Session tests](../../tests/site/terminal-lesson.test.ts) ·
[Pacing tests](../../tests/site/execution-controller.test.ts)

## Input and output

The input field starts at A (65 decimal). It accepts exactly one ASCII character
from 32 through 126, with no trimming or truncation. Invalid input remains
visible, explains the error, and disables Send character. Pasting several
characters or a non-ASCII character cannot silently offer a different byte.
The byte parser is shared with the ASCII lesson's mapping module.

Send character, or Enter in the field outside IME composition, offers the
prepared byte. Send line feed independently offers 10, even when the field has
an invalid draft. Both offers fail without replacement when the device is full;
both buttons are disabled while full. A successful send focuses and selects the
field for preparing another character. The field remains editable during RUN
and while a byte waits, and rendering never rewrites its draft or selection.
Sending never starts execution. There is no host input queue or local echo.

`createTerminalLesson` observes actual byte-output writes through
`createAltairProgram`'s optional callback, alongside the existing write count.
Construction, input, status reads, IN data, snapshots, and panel memory edits
cannot append output. Equal consecutive writes remain distinct. Output is
independent of the CPU's twelve-record history and of the last-byte latch.

The host retains the latest 256 output bytes. Its snapshot interprets graphic
ASCII as text, 32 as space, and 10 as a new line. The LF convention belongs to
this display; the device still only receives bytes. Other controls and Delete
use visible labels such as ⟨NUL⟩ and ⟨DEL⟩. Values 128–255 use hexadecimal
labels such as ⟨FF hex⟩, distinct from the Form feed label ⟨FF⟩. These are presentation labels, not additional output bytes or control
actions. Text is assigned through `textContent`, never HTML.

The screen preserves spaces and line breaks, wraps long lines to fit, and
scrolls within a fixed height. A visual output marker is not part of the stored
text. The empty placeholder disappears on the first write, including space or
LF. New writes scroll to the latest output, even when trimming leaves identical
text; unrelated renders preserve the reader's scroll position. The lifetime
write count remains visible as older bytes leave the retained window.

## Controls and acceptance

The [polling controls and ownership contract](altair-polling.md#interaction-and-ownership)
still applies. STOP preserves the devices, A, and output. Restart cancels queued
execution, constructs a fresh machine and output buffer, prepares A, clears
counts/history, and stays stopped at 0100. Pace and guide preferences survive.
The text display has no separate clear or edit control. Live announcements
remain suppressed during RUN; the received-text region is keyboard-scrollable.

- Initial pending input and output are empty; editing or offering A leaves the
  text empty. Four steps check and receive A; the fifth appends it through OUT.
- Offering B before that OUT leaves A in the CPU and B in the device. The
  output becomes A, then AB after the next trip. Repeating B gives ABB.
- Space, LF, repeated letters, and punctuation retain their order. Unsupported
  controls are labelled without performing their actions; zero is not digit 0.
- Idle polling and repeated snapshots produce no text or extra write count.
  Snapshot strings remain unchanged after later writes.
- More than 256 writes retain exactly the latest 256 bytes and the full count.
  Fresh sessions leave previous sessions' pending input and output alone.
- STOP before OUT preserves a received byte for resume. Restart before status,
  input, or output invalidates old callbacks, including after a new RUN.

Browser checks cover sending versus preparing, full-device rejection via Enter,
invalid/Unicode/multiple-character drafts, line feed, repeat output, STOP and
restart, safe punctuation rendering, keyboard controls, narrow layouts, and the
earlier byte-input, polling, and ASCII lessons.
