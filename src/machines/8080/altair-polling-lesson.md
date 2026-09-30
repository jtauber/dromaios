# Waiting for a byte

This executable chapter defines the machine for the Altair
[waiting-for-a-byte lesson](../../../docs/machines/altair-polling.md).
The program checks whether a byte has arrived, receives and echoes it, then
checks again. Waiting means running instructions in a loop, not halting the CPU.

This is a teaching composition with simple byte devices and 64 KiB of RAM.
It does not model the historical 88-2SIO serial board. That board belongs to the
[Altair with BASIC](../../../docs/machines/altair-basic.md) milestone.

## Components and initial state

RAM stores the program. The [input device](../../../docs/devices/byte-input.md)
holds at most one pending byte; the [output device](../../../docs/devices/byte-output.md)
retains the last byte written to the lamps. Both devices start empty.
All numbers inside `machine` fences are hexadecimal.

```machine
components {
    ram = ram 10000
    input = byte-input
    output = byte-output
}
```

The 8080 begins at address 0100. Its other registers, flags, and control latches
start cleared. These are the lesson's initial conditions; CPU reset has its own
behavior, described below.

```machine
cpu 8080 {
    A = 00  B = 00  C = 00  D = 00  E = 00  H = 00  L = 00
    PC = 0100  SP = 0000
    flags { S = 0  Z = 0  AC = 0  P = 0  CY = 0 }
    interruptEnabled = false  interruptDeferred = false  halted = false
}
```

## Connections

The CPU accesses the entire RAM directly. Input port 00 reports readiness:
00 means empty, 01 means a byte is pending. Repeated status reads preserve the
pending byte. Input port 01 consumes that byte, or returns 00 when empty.
Output port 01 writes to the separate lamp device. RAM address 0001 and the
input and output ports are independent addresses in different spaces.
All other ports are unconnected and reject access.

```machine
memory = ram
ports {
    in 00 = input 0
    in 01 = input 1
    out 01 = output 0
}
```

## The polling loop

The status read answers “has a byte arrived?” separately from the value of
that byte. This lets the program receive 00 as data without mistaking it for
an empty device. `CPI 00` compares the status with zero; `JZ` repeats the check
when the device is empty. Otherwise, `IN 01` receives the byte, `OUT 01` echoes
it, and `JMP` returns to the check.

```machine
image ram 0100 {
    DB 00              // 0100: IN 00 — read readiness, without consuming data.
    FE 00              // 0102: CPI 00 — is the device empty?
    CA 00 01           // 0104: JZ 0100 — if empty, check again.
    DB 01              // 0107: IN 01 — receive the pending byte into A.
    D3 01              // 0109: OUT 01 — echo A to the lamp device.
    C3 00 01           // 010B: JMP 0100 — return to checking readiness.
}
```

Only these fourteen RAM bytes are initialized; the rest remain zero. No
instruction writes RAM. An empty trip executes three instructions and performs
no output transfer. A ready trip executes six and outputs exactly one byte.
There is no completion address or halt instruction: the program keeps polling.

`IN` leaves flags unchanged. Even after receiving data byte 00, Z remains clear
from comparing readiness 01 with zero. A later status read replaces A while
the output device retains the last echoed byte.

Input arriving after an empty status read cannot change the result already
captured in A; the next trip detects it. After a data read, another byte can wait
in the input device while the CPU echoes the previous byte from A.

## Reset and restart

Machine reset resets the CPU and clears both devices while preserving RAM.
The [8080 reset contract](../../components/cpus/specifications/8080.md#reset)
sets PC to 0000; it does not restore the lesson's starting PC of 0100.
The lesson's Restart control instead creates a fresh machine with the initial
state and image above. Its controls and execution scheduling are described in
the [lesson interaction contract](../../../docs/machines/altair-polling.md#interaction-and-ownership).

```machine
reset { cpu input output }
```

## Acceptance

The [machine tests](../../../tests/machines/8080/altair-polling-lesson.test.ts)
independently check the initial state, every RAM byte, and all port connections.
They also check complete instruction records for:

- Repeated empty polling: `IN`/`CPI`/taken `JZ`, with no consumption or output.
- All 256 data values: readiness remains 01 until the data read, each byte is
  echoed once, and PC returns to 0100 with the expected flags and unchanged RAM.
- Another byte arriving after the data read: it remains pending while A is echoed.

The [session tests](../../../tests/site/altair-program.test.ts) check arrivals
between instructions, repeated equal outputs, and stopped/restarted execution.
