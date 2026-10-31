# IBM PC/XT: native firmware startup

This executable chapter assembles the selected IBM 5160 board around the
[8088](../../components/cpus/specifications/8088.md). The first acceptance target
is **reset through early POST to video initialization**, using the original
11/08/82 BIOS. The CPU tests itself, tests DMA and the first 16 KiB of RAM,
discovers 640 KiB, initializes its interrupt vectors, and resets the XT keyboard.
No BIOS service is replaced by host code and no BIOS data area is preloaded.
This is not yet a complete POST or ROM BASIC boot: CGA control/status/display
and the empty-drive diskette-controller path are the next hardware slices.

## Physical storage and firmware

The board has 640 KiB of conventional RAM, separate 16 KiB CGA backing storage,
and externally supplied BIOS and BASIC images. The CGA storage aliases at
`B8000` and `BC000`; display behavior is not implemented yet. Missing memory
reads as `FF`, and writes to missing memory or ROM are ignored. This fixed
unanswered-bus value is a model convention, not an electrical floating-bus model.

The original XT's decoder repeats the first 8 KiB of BASIC at `F0000`, `F2000`,
and `F4000`; BASIC's full image occupies `F6000–FDFFF`, and BIOS occupies
`FE000–FFFFF`. Windows below express those aliases without copying ROM bytes.
[IBM's Technical Reference][ibm] and the [ROM layout notes][rom-layout] describe
the selected board and sockets. The [target audit](../../../docs/machines/pc-xt.md)
records the pinned reference emulator and later acceptance milestones.

```machine
components {
    ram = ram A0000
    video = ram 4000
    bios = rom 2000
    basic = rom 8000
    io = xt-io
}

map 100000 {
    00000 = ram
    B8000 = video
    BC000 = video
    F0000 = window 2000 {
        read = basic
        write = discard
    }
    F2000 = window 2000 {
        read = basic
        write = discard
    }
    F4000 = window 2000 {
        read = basic
        write = discard
    }
    F6000 = basic
    FE000 = bios
    unmapped = FF
}

image bios external sha256 2798f8a9a7dcab651ede40373d35269ad573b75acf811115c263e034ef80a1f2
image basic external sha256 3033d1a54c99d7e2aa1fc7c8c2e51a56ae1b61bf4e70e8aa580f43c43e37a63e
```

The generated `create8088PcXt({ bios, basic })` accepts independently verified
`RomImage` bindings or explicit `null` for absent firmware. Installation does
not reset or execute the machine. Snapshots store ROM identities, not ROM bytes;
restoration requires the same bindings. The optional ROM-backed test uses
`XT_BIOS_ROM` and `XT_BASIC_ROM`; firmware stays external to the repository.

## Power-on and reset

Construction allocates zeroed RAM and deterministic inactive CPU/device state.
Call `reset()` to reset CPU and board, then `stepTimedXtCpu()` to execute from
`FFFF:0000` (physical `FFFF0`). The BIOS far jump enters `F000:E05B`.
RAM and installed ROMs survive reset. `cpu.reset()` alone preserves the board;
fresh construction supplies fresh RAM and device state. Hardware leaves some
register/RAM power-on values unspecified; this model chooses zero explicitly.

```machine
cpu 8088 {
    AX = 0000  BX = 0000  CX = 0000  DX = 0000
    SP = 0000  BP = 0000  SI = 0000  DI = 0000
    CS = 0000  DS = 0000  SS = 0000  ES = 0000  IP = 0000
    halted = false waiting = false interruptDeferred = false recognitionDeferred = false trapPending = false
    flags { CF = 0  PF = 0  AF = 0  ZF = 0  SF = 0  TF = 0  IF = 0  DF = 0  OF = 0 }
}
reset { cpu io }
```

## Board ports, checks, and interrupts

The port map connects DMA, PIC, PIT, PPI, and the write-only NMI-enable latch.
Unpopulated ports return `FF` and ignore output, including the absent expansion
box at `0213`. Canonical register addresses are declared; extra hardware port
aliases are not yet decoded. The selected switch byte is `2D`: 256 KiB planar
RAM, no 8087, 80-column colour, one drive, and no manufacturing loop.

```machine
ports {
    in 00 = io 00
    out 00 = io 00
    in 01 = io 01
    out 01 = io 01
    in 02 = io 02
    out 02 = io 02
    in 03 = io 03
    out 03 = io 03
    in 04 = io 04
    out 04 = io 04
    in 05 = io 05
    out 05 = io 05
    in 06 = io 06
    out 06 = io 06
    in 07 = io 07
    out 07 = io 07
    in 08 = io 08
    out 08 = io 08
    out 09 = io 09
    out 0A = io 0A
    out 0B = io 0B
    out 0C = io 0C
    in 0D = io 0D
    out 0D = io 0D
    out 0E = io 0E
    out 0F = io 0F
    in 20 = io 20
    out 20 = io 20
    in 21 = io 21
    out 21 = io 21
    in 40 = io 40
    out 40 = io 40
    in 41 = io 41
    out 41 = io 41
    in 42 = io 42
    out 42 = io 42
    out 43 = io 43
    in 60 = io 60
    out 60 = io 60
    in 61 = io 61
    out 61 = io 61
    in 62 = io 62
    out 62 = io 62
    out 63 = io 63
    out A0 = io A0
    unmapped = FF
}
```

The [system-control specification](../../components/devices/specifications/ibm-xt-system-control.md)
owns NMI enable and parity/channel-check latch behavior. PPI PB4/PB5 clear and
disable the corresponding checks; PC7/PC6 report them. Normal RAM has no parity
storage, so inputs remain inactive unless diagnostics explicitly call
`io.setCheckErrors(parity, channel)`. A pending NMI is offered before INTR and
consumed after successful CPU entry; a held error does not retrigger it. CPU
recognition delays remain CPU decisions. Port `A0` writes use only bit 7 and
have no guest readback.

The [timer](xt-timer.md) and [refresh](xt-refresh.md) chapters own oscillator,
device ordering, and DMA grants. The same execution helper services this board
and the small examples. It grants refresh, offers interrupts, executes one CPU
boundary, and advances devices using declared instruction clocks. Repeated
strings use the CPU chapter's explicitly bounded **one-element re-entry timing**;
this does not reproduce an uninterrupted hardware REP's throughput.

## Acceptance boundary

The [machine tests](../../../tests/machines/8088/pc-xt/machine.test.ts) check
storage bounds, ROM identities/aliases, protection, unanswered ports, reset,
and detached restoration. Synthetic firmware tests exercise the same map and
CPU path without distributing historical ROM bytes.

With the selected external ROMs, the [startup test](../../../tests/machines/8088/pc-xt/startup.test.ts)
begins at reset and reaches `F000:E242`, immediately before video initialization.
It requires 640 KiB in the BIOS data area, the selected equipment switches,
firmware-owned interrupt vectors, successful DMA refresh, and the keyboard's
native `AA` self-test response through IRQ1. It rejects unsupported execution,
failure halts, and unexpected diagnostics. A saved continuation must reach the
same boundary with identical CPU, RAM, devices, and oscillator time.
The test never patches firmware, seeds RAM, or shortcuts a BIOS routine.

[ibm]: https://minuszerodegrees.net/manuals/IBM_5160_Technical_Reference_APR83.pdf
[rom-layout]: https://www.pcjs.org/machines/pcx86/ibm/5160/rom/
