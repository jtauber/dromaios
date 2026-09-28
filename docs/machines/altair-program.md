# Altair lesson: entering your first program

This follows [switches, lights, and memory](altair-memory.md). The learner
deposits the familiar [add-one program](../cpus/8080/examples/add-one.md), reads
it back, executes it, and changes its operand. The entered bytes live in the
same RAM that the CPU fetches; the reference card never loads the program.

[Machine definition](../../src/machines/8080/altair-program-lesson.machine) ·
[Session model](../../site/interactive/altair-program.ts) ·
[Controller](../../site/interactive/altair-program-explorer.ts) ·
[Lesson](../../site/templates/altair-program.html) ·
[Tests](../../tests/site/altair-program.test.ts)

## Initial state and execution boundary

The machine supplies an 8080 with zeroed registers, clear flags, disabled
interrupts, no deferred interrupt enable, and no halt. Its 64 KiB of RAM is zero
except address 0003, which holds 29 hexadecimal (41 decimal). PC and the panel
switches start at zero. Addresses 0100–0107 initially contain no program.
These deterministic choices are lesson setup, not hardware power-up behavior.

| Address (hex) | Reference bytes (hex) | Instruction |
| --- | --- | --- |
| 0100 | 3A 03 00 | LDA 0003H |
| 0103 | C6 01 | ADI 1 |
| 0105 | 32 04 00 | STA 0004H |

The step control requires these fixed bytes, except that the operand at 0104
may be any byte. It also requires PC at 0100, 0103, or 0105. A rejected step
has no CPU or RAM effects. The guard is a teaching aid, not an Altair constraint.
0108 is an exercise boundary; there is no halt instruction. The UI describes
PC's position without assuming that reaching it through EXAMINE executed code.

## Connecting the panel to the processor

The MITS [Altair 8800 Theory of Operation](https://altairclone.com/downloads/manuals/Altair%208800%20Theory%20of%20Operation.pdf#page=5),
pp. 5–6, explains that EXAMINE injects a jump and the switch address into the
8080, while EXAMINE NEXT advances PC by injecting a NOP. DEPOSIT NEXT advances
before writing. SINGLE STEP advances a machine cycle.

We preserve the address relationship at instruction boundaries, without modeling
bus-cycle injection. The shared [panel model](../../site/interactive/altair-panel.ts)
accepts address storage backed by PC. Assigning an address reconstructs the CPU
from its public snapshot with only PC changed, reusing the same RAM. It preserves
registers, flags, and interrupt state; it is neither a CPU reset nor a guest
instruction and adds no execution record. This adaptation is local to the lesson.
The earlier memory-only lesson still owns an independent selected address.

EXAMINE and both NEXT operations therefore change PC. DEPOSIT only writes the
selected byte; moving switches changes neither PC nor RAM. The lights show
PC and RAM at PC between actions, including after a CPU instruction. They do
not reproduce every physical bus address or data transfer. RUN, STOP, timing,
status lamps, protection, and hardware RESET remain outside the model.

The added **Step one instruction** control invokes the actual 8080 model. Its
snapshots supply A and PC; shared RAM supplies the two data readouts. Captured
records supply execution explanations, fetched bytes, flags, and accesses.
Panel actions and later memory edits preserve the last CPU explanation and trace.
The table always shows live RAM, distinguishing fixed-byte mismatches from a
custom operand. A matching zero does not claim the learner deposited it.

Start again creates a fresh machine and panel, empties the program area,
restores the initial source byte, and clears both operation records. It keeps
the guide-visibility preference. EXAMINE 0100 instead reruns the entered program
without clearing registers, flags, RAM, or records.

## Acceptance

1. Enter all eight reference bytes using EXAMINE, DEPOSIT, and DEPOSIT NEXT.
   Only PC changes during address selection; A remains zero. Read the bytes back
   with EXAMINE and EXAMINE NEXT, without changing RAM.
2. EXAMINE 0100. Three steps fetch the deposited bytes, load 41 into A, add one
   to produce 42, and store 42 at address 4. PC visits 0103, 0105, and 0108.
   The final data lights show RAM[0108], not the stored result at address 4.
3. EXAMINE 0004 to see 42 on the lights. A and flags remain unchanged.
4. DEPOSIT 02 at 0104, EXAMINE 0100, and repeat. The CPU fetches the new operand
   and stores 43 at address 4. The previously retained trace still describes
   its original instruction until another instruction runs.
5. Mistyped fixed bytes and non-instruction PCs disable stepping with a repair
   explanation. Editing the source data and using any operand byte remain valid.
6. Both NEXT operations wrap FFFF to 0000 while preserving other CPU state.
   Restart restores the initial state and leaves previously captured records intact.

Automated tests check complete initial and final RAM images, independently
transcribed instruction bytes and exact memory-access records, state preservation,
entry guards, operand changes, carry behavior, wrapping, and fresh-session isolation.
Browser checks cover manual entry and repair, readback, three steps, rerunning after
an operand edit, retained traces, restart, guide visibility, keyboard operation,
and narrow layouts. Earlier memory-only lessons must not load CPU modules.
