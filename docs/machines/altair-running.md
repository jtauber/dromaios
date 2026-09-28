# Altair lesson: letting the computer run

This follows [manual program entry](altair-program.md), using the existing
[countdown program](../cpus/8080/examples/countdown.md) with its bytes already
loaded. That specification owns the initial machine state, instruction behavior,
and expected results. This lesson adds paced execution and stopping to the
same CPU, RAM, panel, reference card, and captured-record views.

[Lesson](../../site/templates/altair-running.html) ·
[Session](../../site/interactive/altair-program.ts) ·
[Shared panel controller](../../site/interactive/altair-program-explorer.ts) ·
[Execution controller](../../site/interactive/execution-controller.ts) ·
[Tests](../../tests/site/execution-controller.test.ts)

## Controls and state

RUN begins at the current PC. It neither reloads RAM nor resets CPU state.
The first instruction waits for the selected delay, as do later instructions.
The controller schedules one instruction per callback and returns control to
the browser between instructions. Delayed callbacks do not trigger catch-up
bursts. Teaching paces are 1, 4, and 20 instructions per second; they express
reading pace, not emulated clock timing or instruction durations.

STOP cancels pending work and preserves PC, registers, flags, RAM, and history.
A callback already dispatched before cancellation is also rejected, including
after a new RUN. STEP executes once while stopped. Repeated RUN does not create
additional execution loops, and STEP is disabled while running. Changing pace
cancels the old pending callback and schedules one at the new delay.

EXAMINE, EXAMINE NEXT, DEPOSIT, and DEPOSIT NEXT are disabled while running.
The shared controller also checks this condition in their handlers. Switches
remain movable, affecting only the prepared value. While stopped, the panel–PC
relationship follows the [previous lesson's contract](altair-program.md#connecting-the-panel-to-the-processor).
EXAMINE changes PC; reading the CPU/RAM readouts and captured trace does not.

Before each instruction the session checks all eleven reference bytes and
requires PC at a known instruction start. Source data remains editable. A bad
program byte or PC prevents stepping and explains how to recover. Reaching
010B disables RUN and STEP as a lesson boundary; it does not set the CPU's halt
latch. The status describes PC's position, including when the learner selects
the endpoint with EXAMINE instead of executing the program.

Restart cancels old work before replacing the machine, restores the loaded
program and initial data, clears records and the count, and remains stopped.
It preserves the chosen teaching pace and number-guide preference. Hiding the
document or leaving the page stops execution; returning does not resume it.

## Records, failures, and ownership

The DOM-free execution controller accepts step/readiness callbacks, a scheduler
that returns cancellation functions, and a change notification. It has no CPU,
RAM, browser, or rendering dependency. The panel controller supplies actual
CPU execution and browser timers. The synchronous simulation runner remains
unchanged; this controller supplies pacing rather than modeled machine time.

The execution controller retains the twelve most recent original step results
and a total successful-step count. The panel supplies captured CPU records with
their descriptions and formatted traces. Each description is captured when the
instruction executes, so later memory edits cannot rewrite earlier explanations.
History is bounded even for the 769-instruction zero-start countdown. STOP and
EXAMINE do not add instructions to the count or history.

A thrown step stops execution, preserves any partial machine effects and prior
records, reports the failure, and requires a lesson restart before more steps.
It never retries or invents a successful record. Instruction execution and
display updates remain separate. Continuous running updates are not announced
as live screen-reader messages; stopped state is announced. At automatic
completion, focus moves from the now-disabled STOP control to the status only
if STOP still had focus.

These controls use whole instruction boundaries. Bus cycles, hardware timing,
status lamps, and the physical RUN/STOP circuitry remain outside this teaching
model; the hardware references and panel approximation are documented in the
previous lesson. The absence of a halt instruction is stated in the UI.

## Acceptance

- Default RUN executes ten instructions, storing 2, 1, and 0, and reaches 010B
  with A = 0, Z = 1, and the halt latch clear. No fetch occurs at the endpoint.
- STOP after the first store preserves A = 2, RAM[4] = 2, and PC = 0108. STEP
  takes the jump; RUN then finishes. Its full records and final RAM match an
  uninterrupted manual run.
- STOP before the first tick executes nothing. Cancelled callbacks remain
  harmless after STOP, pace changes, restart, and a subsequent RUN.
- Invalid program bytes and instruction addresses prevent execution. Selecting
  010B directly leaves the execution count at zero.
- Starting from zero completes in 769 steps, yielding after each and retaining
  only twelve records. Pausing does not change their order or the total count.
- A failed step preserves partial effects, cancels continuation, retains prior
  records, and stays blocked until restart.

Automated tests use an injected scheduler and actual 8080 sessions; they do not
depend on wall-clock sleeps. Browser checks cover pacing, RUN/STOP/STEP, restart
during execution, editing locks, endpoint status, retained traces and history,
page hiding, keyboard focus, narrow screens, and both earlier Altair lessons.
