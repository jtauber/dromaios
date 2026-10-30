# XT timers and explicit machine time

The [keyboard example](xt-keyboard.md) introduced the PIC, PPI, and native
interrupt acceptance. This example adds the [8253](../../components/devices/specifications/i8253-counter.md)
and an integer oscillator clock. The CPU programs a one-shot timer, halts,
and receives IRQ0 after the host supplies a known interval. Its handler
increments a RAM byte and sends EOI. No host code increments a BIOS tick or
replaces an interrupt handler.

This is **device-clock acceptance**, not complete 8088 timing or successful
POST. `stepXtCpu()` still executes an untimed boundary. In particular, a busy
polling loop does not advance time automatically. The optional original-ROM
check runs the real IRQ0 handler with a prepared fixture; it is not a boot test.

## Oscillator and event ordering

[IBM's Technical Reference][ibm], pages 1-3–1-4, derives CPU CLK by dividing
the system oscillator by three, and the PIT clock by twelve. The current
model uses the nominal oscillator frequency **14,318,180 Hz** exactly; crystal
tolerance, electrical phase relationships, and propagation delays are omitted.
All three timer channels receive a complete pulse at ticks 12, 24, 36, … .
The initial phase is a deterministic fresh-session choice, not a claim about
physical power-on state.

The board’s `advanceOscillatorTicks(n)` supplies an explicit unsigned 32-bit
interval. It visits **every** PIT boundary, even inside a large batch. An OUT
pulse cannot disappear just because the output returns to its initial level
before the batch ends. PIC request state follows the edges; CPU acknowledgement
happens only at a subsequent CPU boundary. Advancing devices never executes a
CPU instruction or accepts an interrupt on its behalf.

At each boundary, the board first supplies elapsed whole microseconds to the
keyboard reset detector, clocks all three counters, then settles the gate,
PPI status, and PIC connections. The final partial interval also advances the
keyboard. Converting time carries the fractional phase across calls rather than
rounding each batch; the keyboard detector retains its declared microsecond
resolution. Equal total intervals with the same intervening I/O/input events
produce identical state regardless of partitioning. Inputs and I/O occur at
the current boundary, after any interval the caller has already advanced.

The [clock](pc-xt/clock.ts) saves total oscillator ticks as an exact safe integer.
PIT phase and fractional microseconds derive from that value; they cannot be
restored inconsistently. Conversion reduces the value modulo the oscillator
frequency before multiplication, keeping integer arithmetic exact even after
long sessions. Invalid intervals or accumulated-time overflow are rejected
before any clock or device changes. Zero advances do nothing.

## Board connections

| Channel | Ports | Gate | Output |
| --- | --- | --- | --- |
| 0 | `40`, control at `43` | Tied high | PIC IR0 |
| 1 | `41`, control at `43` | Tied high | Exposed `refreshOutput`; DMA refresh logic remains to be implemented |
| 2 | `42`, control at `43` | PPI PB0 | PPI PC5 and speaker control |

PB1 enables the modeled speaker signal: `speakerLevel` is PB1 AND OUT2.
It exposes the control waveform, not audible output or the electrical speaker
voltage. Port 43 is write-only; the machine's port map chooses the undriven-read
response. Register addresses are canonical; aliases remain outside this slice.
IRQ0 and IRQ1 belong to the timer and keyboard, so the host cannot override
them through `setInterruptLine`. Other PIC inputs remain available.

The complete port-address decoding is handwritten [board wiring](pc-xt/io.ts).
The three counter state machines are generated from the same executable
definition. Neither needs a BIOS-address special case, a browser timer, or an
extension to the device language.

## A native one-shot interrupt

This synthetic machine uses flat RAM to isolate timer and interrupt behavior;
it does not declare the XT's physical firmware/video map. Counts are supplied
by CPU I/O, while elapsed time is supplied separately by the test.

```machine
components {
    ram = ram 100000
    io = xt-io
}

cpu 8088 {
    AX = 0000  BX = 0000  CX = 0000  DX = 0000
    SP = 8000  BP = 0000  SI = 0000  DI = 0000
    CS = 0000  DS = 0000  SS = 0000  ES = 0000  IP = 0100
    halted = false waiting = false interruptDeferred = false recognitionDeferred = false trapPending = false
    flags { CF = 0  PF = 0  AF = 0  ZF = 0  SF = 0  TF = 0  IF = 0  DF = 0  OF = 0 }
}


memory = ram
ports {
    in 20 = io 20
    out 20 = io 20
    in 21 = io 21
    out 21 = io 21
    in 40 = io 40
    in 41 = io 41
    in 42 = io 42
    out 40 = io 40
    out 41 = io 41
    out 42 = io 42
    out 43 = io 43
    in 60 = io 60
    in 61 = io 61
    in 62 = io 62
    out 60 = io 60
    out 61 = io 61
    out 62 = io 62
    out 63 = io 63
}
reset { cpu io }

image ram 0100 {
    FA                   // CLI
    C7 06 20 00 00 02    // IRQ0 -> 0000:0200
    C7 06 22 00 00 00
    B0 13  E6 20         // Single edge-triggered PIC
    B0 08  E6 21
    B0 09  E6 21
    B0 FE  E6 21         // Unmask IRQ0
    B0 10  E6 43         // Channel 0, low byte, mode 0, binary
    B0 04  E6 40         // Count four
    FB                   // STI
    F4                   // HLT
    EB FD                // Return to HLT after the interrupt
}

image ram 0200 {
    50                   // Preserve AX
    FE 06 00 03          // INC byte [0300]
    B0 20  E6 20         // EOI
    58
    CF                   // IRET
}

```

After the CPU halts, 59 oscillator ticks leave IRQ0 deasserted: the first of
four timer pulses loads the count, and three more decrement it to 1. Tick 60
supplies the fifth pulse, reaches zero, and asserts IRQ0. The next
`stepXtCpu()` accepts vector 8, pushes the frame, and runs the native handler
on subsequent steps. The RAM result becomes 1. Continued counting after EOI
does not request another interrupt because mode 0 holds OUT high.

A CPU-only reset preserves clock and devices. This example's whole-machine
reset resets CPU, I/O devices, and elapsed time while preserving RAM; fresh
construction restores the program and zeroed result. Snapshots preserve every
counter, gate, unread count latch, partial divisor write, PIC request/service
bit, keyboard reset duration, and clock phase. Inspection uses snapshots and
pure views; a guest counter read intentionally advances its read-byte position.

[Tests](../../../tests/machines/8088/xt-timer.test.ts) exercise the native
program, halted progress, EOI, pure inspection, and saved continuation.
[Board clock tests](../../../tests/machines/8088/pc-xt/clock.test.ts) compare
single advances with fragmented intervals, including pending latches and a
partially completed keyboard reset. With `XT_BIOS_ROM` set to the externally
supplied image identified in the [target](../../../docs/machines/pc-xt.md),
the [ROM test](../../../tests/machines/8088/pc-xt/rom-timer.test.ts) verifies
that the original handler updates the BIOS time-of-day word and acknowledges
the PIC. The fixture explicitly supplies IVT/BDA state and device clocks.

## CPU timing boundary still to implement

The next layer must assign checked elapsed clocks to actual execution before
this board can run timed POST. Use the 8088 chapter as the owner of those
rules: instruction form and effective-address cost, taken versus untaken
branches, word transfers over the byte bus, prefixes, each recorded REP
iteration, interrupt entry, and idle HLT/WAIT periods all matter. CPU CLK
periods translate to three oscillator ticks; an instruction count is not an
elapsed-clock count.

The first intended fidelity is documented instruction-level timing, with
prefetch-queue overlap, bus contention, wait states, and electrical bus phases
explicitly omitted. Device transfers need an explicit ordering within that
model. Unsupported timing must fail explicitly rather than silently using a
constant fallback. A halted CPU must allow the clock to reach the next device
event, then offer the resulting interrupt through the same CPU acceptance path
used during stepping. Input schedules and idle progress must be saved too.

These are requirements for the next CPU-timing implementation, not behavior
provided by `stepXtCpu()` today. The clock and PIT tests establish a reusable
foundation; native POST still requires that timing work, DMA/refresh, CGA,
board glue, and the empty diskette-controller path.

[ibm]: https://minuszerodegrees.net/manuals/IBM_5160_Technical_Reference_APR83.pdf
