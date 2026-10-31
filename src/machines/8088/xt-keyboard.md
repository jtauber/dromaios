# An 8088 receiving XT keyboard interrupts

This executable example connects the native 8088 to the XT's
[8259A PIC](../../components/devices/specifications/i8259a.md),
[8255A PPI](../../components/devices/specifications/i8255a.md), and
[keyboard receiver](../../components/devices/specifications/ibm-xt-keyboard.md).
It is the first board example toward the [PC/XT target](../../../docs/machines/pc-xt.md),
not a complete PC or an original-BIOS boot. It needs no external ROM or disk.

## Board connections

The concrete [XT I/O wiring](pc-xt/io.ts) owns the connections between the
chips and receiver. Device specifications own register behavior.
No port or interrupt has a host BIOS shortcut.

| Port | Connection |
| --- | --- |
| `20/21` | PIC command/status and initialization/mask |
| `60` | PPI A: received scan code, or diagnostic output when configured as output |
| `61` | PPI B: board controls |
| `62` | PPI C: equipment-switch nibble and status |
| `63` | PPI control writes; reads are unanswered |

PB6 releases the keyboard clock when high. PB7 clears/disables the keyboard
receiver when high. PB3 selects the high switch nibble when high and low nibble
otherwise. PB0/PB1 expose timer-2 gate and speaker data. PC5 receives timer 2
OUT; spare PC4 is low, and both error inputs remain inactive in this example.
The [timer chapter](xt-timer.md) owns PIT wiring and explicit board time.
The [refresh chapter](xt-refresh.md) owns DMA grants; the
[full board chapter](pc-xt.md#board-ports-checks-and-interrupts) owns check/NMI
controls. Those ports are omitted from this keyboard-only example. Extra
hardware port aliases remain unmodeled.
These are the original XT connections in [IBM's manual][manual], pages 1-10
and 1-67, not the AT's 8042 interface.

The default switch byte `2D` selects 256 KiB planar RAM, no 8087, 80-column
colour, one floppy drive, and no repeating POST diagnostic. This synthetic
example allocates 1 MiB flat RAM to isolate I/O behavior; it does not yet apply
the XT's physical RAM/ROM/video map.

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
    in 60 = io 60
    out 60 = io 60
    in 61 = io 61
    out 61 = io 61
    in 62 = io 62
    out 62 = io 62
    out 63 = io 63
}
reset { cpu io }
```

## Initialization and handler

The program writes its own IRQ1 vector at `0000:0024`, initializes the PIC with
the original XT BIOS's ICWs, masks every line except IRQ1, and selects the PPI's
normal mode `99`. Port B=`4C` releases the clock and enables reception. STI's
interrupt shadow lets HLT execute before an already pending key wakes the CPU.

```machine
image ram 0100 {
    FA                   // CLI
    C7 06 24 00 00 02    // MOV word [0024],0200: IRQ1 handler offset
    C7 06 26 00 00 00    // MOV word [0026],0000: handler segment
    B0 13  E6 20         // ICW1: edge, single controller, ICW4 follows
    B0 08  E6 21         // ICW2: vectors 08–0F
    B0 09  E6 21         // ICW4: buffered 8086 mode; there is no ICW3
    B0 FD  E6 21         // Unmask IRQ1 only
    B0 99  E6 63         // PPI: A/C inputs, B outputs
    B0 4C  E6 61         // Release keyboard clock, enable receiver
    BB 00 03             // BX points to the scan-code buffer at 0300
    FB                   // STI
    F4                   // 0129: HLT until an interrupt
    EB FD                // JMP 0129
}

image ram 0200 {
    50                   // PUSH AX
    E4 60                // IN AL,60: read without clearing the receiver
    88 07                // MOV [BX],AL: retain the scan code
    43                   // INC BX
    E4 61                // IN AL,61: preserve unrelated board controls
    8A E0                // MOV AH,AL
    0C 80  E6 61         // Set PB7: clear receiver and IRQ1
    8A C4  E6 61         // Restore PB7 low: allow the next transfer
    B0 20  E6 20         // Non-specific EOI clears the PIC's in-service bit
    58                   // POP AX
    CF                   // IRET: restore the saved IP, CS, and FLAGS
}
```

The host calls `io.offerScanCode(byte)`. False leaves that byte with the caller
for a later offer; a true result asserts the receiver's IRQ1 immediately. Make
`1E` and break `9E` represent the A key. They are separate transfers, not ASCII.
An accepted second byte after receiver clear may wait behind the first handler
until its EOI; it must not be lost. Reading port 60 alone does not make room.

Use [`stepXtCpu`](pc-xt/interrupts.ts) for both manual steps and batches. It
samples PIC INT at each boundary and acknowledges only from the CPU's accepted
INTR callback. IF, the STI/MOV SS shadow, and trap priority belong to the CPU.
When the CPU defers entry, the same pending PIC request remains available.
An interrupt record is its own boundary, including the stack/vector accesses.

## Inspection, reset, and saved sessions

`snapshot()`, `keyboardData`, `keyboardPending`, timer/speaker views, and status
reads do not consume input, change interrupt state, or advance time. Snapshots
include CPU, RAM, switch configuration, and every board component, including
DMA/refresh and check/NMI state used by the later examples.
Restoration checks that stored PPI inputs, timer gates, and PIC IRQ0/IRQ1 agree
with their connected devices; inconsistent wiring is rejected, not repaired.

CPU-only reset preserves the board. Machine `reset()` resets CPU and all board
components while retaining RAM, switches, and external
IRQ2–IRQ7 levels. CPU reset enters `FFFF:0000`, not this example's `0000:0100`;
construct a fresh example to restart its program. Fresh construction resets
all external levels and reloads the authored RAM image. Host input queues are
caller-owned and must accompany a session snapshot if used.

The board’s `advanceOscillatorTicks()` input advances the PIT and keyboard
reset-pulse detector from saved integer clock phase. This example never infers
time from a CPU step. No CPU timing or automatic self-test delay is claimed.
It is not called once per instruction. Timing and original-ROM POST remain
separate acceptance work.

## Acceptance

The [tests](../../../tests/machines/8088/xt-keyboard.test.ts) execute this program
with ordered port transfers and native interrupt records. They require make
and break bytes at `0300/0301`, restored SP and AX, receiver clear, and completed
EOI. Additional cases cover pending/masked input, interrupt shadows, a second
byte during the first handler, observational purity, independent instances,
and snapshot continuation while an interrupt is in service. Component tests
independently check PIC commands, PPI directions/switch wiring, and keyboard
acknowledgement and reset pulses.

An optional [original-ROM handler test](../../../tests/machines/8088/pc-xt/rom-keyboard.test.ts)
also passes with the pinned 11/08/82 BIOS. It enters the real IRQ1 handler at
`F000:E987`, delivers A make/break and Shift+A, and verifies `61 1E 41 1E` in
the BIOS keyboard buffer, modifier flags, exact I/O transfers, and restored CPU
registers. The fixture initializes the PIC/PPI, vector, and empty BIOS buffer
explicitly; it verifies the handler, **not POST or a complete BIOS boot**.
Set `XT_BIOS_ROM` to the verified raw 8 KiB image when running `npm test` to
include this check. No ROM bytes are tracked.

[manual]: https://minuszerodegrees.net/manuals/IBM_5160_Technical_Reference_APR83.pdf
