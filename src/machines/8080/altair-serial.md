# An 8080 talking to the 88-2SIO serial interface

This composition proves the first channel's historical port wiring and polling
behavior on the way to [Altair BASIC](../../../docs/machines/altair-basic.md).
It is an echo program with 64 KiB of RAM, not yet the four-kilobyte BASIC machine.
The [serial profile](../../components/devices/specifications/mc6850-polling.md)
owns the chip's modeled behavior and timing limitations.

## Components and connections

The [MITS manual][manual], theory-of-operation page 4, assigns the low address
bit to register selection and the next bit to channel selection. The BASIC
loader uses the first channel at hexadecimal 10/11. This example connects only
that channel. No other ports, panel sense switches, or second channel are present.

```machine
components {
    ram = ram 10000
    serial = mc6850-polling
}

cpu 8080 {
    A = 00  B = 00  C = 00  D = 00  E = 00  H = 00  L = 00
    PC = 0100  SP = 0000
    flags { S = 0  Z = 0  AC = 0  P = 0  CY = 0 }
    interruptEnabled = false  interruptDeferred = false  halted = false
}

memory = ram
ports {
    in 10 = serial 0
    out 10 = serial 0
    in 11 = serial 1
    out 11 = serial 1
}
reset { cpu serial }
```

## Initialization and echo

The first four instructions reset and configure the ACIA for 8N1, just as the
BASIC loader does. The receive loop masks status bit 0, leaving the byte pending
until IN 11 consumes it. The program saves that byte in B while checking
transmit-ready status bit 1. It then restores A and sends the byte with OUT 11.
These port addresses are independent of RAM addresses 0010 and 0011.

```machine
image ram 0100 {
    3E 03              // 0100: MVI A,03 — master reset.
    D3 10              // 0102: OUT 10 — write control.
    3E 15              // 0104: MVI A,15 — divide by 16, 8N1, polling.
    D3 10              // 0106: OUT 10 — configure.
    DB 10              // 0108: IN 10 — read status.
    E6 01              // 010A: ANI 01 — receive register full?
    CA 08 01           // 010C: JZ 0108 — wait for a character.
    DB 11              // 010F: IN 11 — receive the byte.
    47                 // 0111: MOV B,A — preserve it during status polling.
    DB 10              // 0112: IN 10 — read status.
    E6 02              // 0114: ANI 02 — transmitter ready?
    CA 12 01           // 0116: JZ 0112 — wait for room to transmit.
    78                 // 0119: MOV A,B — restore the received byte.
    D3 11              // 011A: OUT 11 — transmit.
    C3 08 01           // 011C: JMP 0108 — wait for the next character.
}
```

There is no halt or completion address. RAM is zero outside the 31-byte image;
the program never writes RAM. Construction leaves the serial device in reset
and starts PC at 0100. Machine reset resets CPU and serial state while preserving
RAM, so PC becomes 0000. Reconstruct the factory to restart this example at 0100.
The host retains queued input when `serial.offer(byte)` returns false.

## Acceptance

The [machine tests](../../../tests/machines/8080/altair-serial.test.ts) check
all RAM bytes, initialization output transfers, empty polling, every possible
received byte, exact I/O ordering, independent instances, and reset. The
transmit-status check executes even though this profile completes output
synchronously. Loading the BASIC tape and running a terminal remain subsequent
integration work.

[manual]: https://altairclone.com/downloads/manuals/Altair%202SIO%20Serial%20I-O.pdf
