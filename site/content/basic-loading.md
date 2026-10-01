## First, give the computer BASIC

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

If you need to start loading again, use **Reload tape**, raise A11 and A10 again,
then RUN. Reload discards the current BASIC program. **Reset CPU + serial** does
not reload BASIC. Each lesson page has its own fresh machine; you need to load
the tape again when moving to the next lesson.
