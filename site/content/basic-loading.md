## Continue your session, or load BASIC

If the terminal below already shows your earlier BASIC session, press the
browser's **RUN** button to continue it. You do not need to load the tape again.
This tab keeps the machine, program, terminal, and pending input as you move
between BASIC lessons, visit All lessons, or refresh. Returning always pauses
execution first. Other tabs work independently; a newly opened or duplicated
tab may begin with a copy of this tab's saved session.

Begin a lesson's commands at **OK**. If your previous program is still asking
a question at `?`, finish that conversation first; the ticket loop finishes
when you answer **0**. The lesson's setup explains which stored lines to keep
or replace. Typing `NEW` at OK clears the stored program and variables without
reloading BASIC.

If this is a fresh machine, follow the loading steps below.

This is the original 4K BASIC 3.2 interpreter running on our Altair. An
**interpreter** is a program that reads your commands and carries them out.
Before it can understand `PRINT`, the Altair must load that interpreter into memory.

1. Get the selected paper-tape file from the
   [machine guide (opens in a new tab)](../../src/machines/8080/altair-basic.md#media-and-host-delivery){:target="_blank" rel="noopener"}.
   Return here and choose it in **Paper tape** below. The file stays on your computer.
2. Raise only switches **A11** and **A10**. Leave PC at 0000: **do not press EXAMINE**.
   You may then close the front panel to bring the terminal closer.
3. Press the browser's **RUN** button. Click **Terminal keyboard** and answer
   each question when it appears:

| When you see | Enter |
| --- | --- |
| `MEMORY SIZE?` | Just Enter, to let BASIC find the available memory. |
| `TERMINAL WIDTH?` | Just Enter, to keep the default. |
| `WANT SIN?` | `Y` then Enter. We will not need this math function today. |

When **727 BYTES FREE** and **OK** appear, BASIC is ready. Leave the processor
running for the lesson. Switching tabs pauses it; press the browser's RUN
button when you return.

If you need to start loading again, use **Start fresh**, raise A11 and A10 again,
then RUN. This discards the current BASIC program and uses the tape you already
selected. **Reset CPU + serial** does not reload BASIC.

The saved session stays in this browser tab's temporary storage. It is not
sent to the site. Copy your numbered lines somewhere to keep them beyond the
browser session. If the browser cannot save or restore a session, a message
beside the machine explains that; you can still use the current page.
