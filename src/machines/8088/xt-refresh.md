# XT DMA refresh: timer request, bus grant, and reload

The 8253 does not refresh RAM by itself. On the XT, OUT1 clocks a 74LS74
flip-flop whose D input is tied high. A rising edge records a request on DMA
channel 0; active-low DACK0 clears that latch. Repeated timer edges while a
request is pending coalesce into one request, not a queue. The board schematic
in [IBM's Technical Reference][ibm], D-9 (sheet 8), shows this connection;
D-5 (sheet 4) connects it to the [8237A](../../components/devices/specifications/i8237a.md).

## A refresh transaction

The BIOS selects single read, increment, automatic initialization (`58`),
starts channel 0 at address `0000` with count `FFFF`, and programs timer 1 for
mode 2 with divisor 18. Each refresh increments the DMA address and decrements
its count. After 65,536 transfers, both reload. The nominal request interval
is 216 oscillator ticks, about 15.1 microseconds. Programming a periodic PIT
mode also raises OUT; this can create the initial request before counting starts.

IBM specifies **four CPU clocks** for a refresh transfer (1-3–1-4), compared
with five for ordinary peripheral DMA. The board's `serviceRefresh()` grants
one pending channel-0 read and advances devices by **12 oscillator ticks**.
DACK0 clears the request latch and holds it clear throughout that interval.
A high OUT1 level after release is not a new edge. Masking the channel or
disabling the DMA controller preserves the pending request until service.
Other transfer configurations cannot silently succeed as refresh.

A refresh record contains the 8237A's 16-bit `address` and the charged
`oscillatorTicks`. The physical board uses refresh strobes to restore DRAM
rows; the emulator's RAM has no charge-decay model. It therefore records the
address without performing a CPU memory read or changing RAM data. Page
registers, peripheral data transfers, and RAM decay remain outside this slice.
This is a timed refresh transaction, not an electrical DRAM simulation.

`stepTimedXtCpu()` grants at most one pending refresh **before** offering a
PIC interrupt or executing the next instruction. Its result has the ordinary
CPU `record`, an optional `refresh` record, and total `oscillatorTicks` covering
both. The CPU's own `clocks` exclude DMA. After a single grant the CPU gets a
turn, matching the single-transfer mode's bus-release rule at instruction
resolution. Requests raised during an instruction wait for the next boundary.
Untimed `stepXtCpu()` neither grants DMA nor advances time; callers using
explicit device clocks may call `serviceRefresh()` themselves.

The counter update and acknowledgement occur at the grant boundary, then the
12-tick interval elapses. No partially completed DMA cycle is externally
observable. Snapshots taken between calls preserve current/base registers,
byte-selector phase, terminal flags, masks, the refresh-request latch, PIT
output/count/phase, and total oscillator time. Restoring while OUT1 is high
does not synthesize a rising edge. Master-clearing the DMA controller preserves
the board's request latch; whole-board reset clears the model's latch and
clock. Its deterministic cleared latch is not a claim about power-on silicon.

Instruction-level arbitration omits HOLD/HLDA propagation, prefetch overlap,
instruction-interior bus steals, READY waits, and pin setup/hold races. The
[timed CPU contract](xt-timer.md#instruction-driven-machine-time) still applies.
If an instruction lacks timing after an already granted refresh, that refresh
remains completed; no CPU operand effects or CPU interval are added.

## Native acceptance program

This short RAM program uses a four-transfer window starting at `00FE`, so an
address-byte carry and automatic reload are visible without 65,536 refreshes.
It programs the real ports, then halts. The timed execution path continues
refreshing while halted; no host loop writes DMA registers or supplies time.

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
    out 00 = io 00
    out 01 = io 01
    in 08 = io 08
    out 08 = io 08
    out 0A = io 0A
    out 0B = io 0B
    out 0C = io 0C
    out 0D = io 0D
    out 41 = io 41
    out 43 = io 43
}
reset { cpu io }

image ram 0100 {
    FA                   // CLI
    B0 00  E6 0D         // Master clear: masks all channels, selects low byte
    B0 FE  E6 00         // Channel 0 address 00FE
    B0 00  E6 00
    B0 03  E6 01         // Count 0003: four transfers
    B0 00  E6 01
    B0 58  E6 0B         // Single read, increment, automatic reload, channel 0
    B0 00  E6 0A         // Unmask channel 0
    B0 54  E6 43         // Timer 1, low byte, mode 2, binary
    B0 12  E6 41         // Divisor 18
    F4                   // HLT: device time and refresh continue
}

image ram 0400 { A5 5A }
```

[Tests](../../../tests/machines/8088/xt-refresh.test.ts) require the repeating
address sequence `00FE, 00FF, 0100, 0101`, an unchanged RAM image, terminal
status, halted device progress, and identical continuation after saved-state
restoration at different batch boundaries. [Board tests](../../../tests/machines/8088/pc-xt/refresh.test.ts)
exercise edge capture, mask/disable retention, acknowledgement, elapsed clocks,
and inconsistent-state rejection separately from the CPU.

The optional [original-ROM timing tests](../../../tests/machines/8088/pc-xt/rom-timing.test.ts)
enter at `F000:E0E1` after earlier CPU/RAM checks, then execute the original
counter test, all eight DMA register tests with `FF` and `00`, refresh setup,
and the pending-request check through `F000:E165`. The fixture supplies RAM,
stack, registers, and the external BIOS image identified in the
[XT target](../../../docs/machines/pc-xt.md#firmware-and-media-identity).
There are no ROM patches or host BIOS services. This establishes the isolated
POST stage, not reset-to-POST completion or ROM BASIC startup.

[ibm]: https://minuszerodegrees.net/manuals/IBM_5160_Technical_Reference_APR83.pdf
