# Altair front-panel sense switches

The upper eight address switches on the Altair panel, A15 through A8, also
supply an input byte. A15 supplies bit 7 and A8 bit 0; up means one. An IN FF
instruction samples their positions. Reading them does not clear or consume
anything. The [MITS BASIC manual][manual], Appendix B, uses this input for
startup options and then makes it available to BASIC programs as INP(255).

This device models those eight physical positions, not the full front panel.
Port decoding belongs to the [machine chapter](../../../machines/8080/altair-basic.md).
Address selection, memory examination/deposit, RUN/STOP, and display timing
remain host controls. Switch bounce and electrical timing are not modeled.

```device
device "altair-sense-switches"

state {
  register SWITCHES: 8
}

action initialize "Begin with all eight switches down" {
  SWITCHES <- u8($00)
}

action reset "Reset does not move physical switches" {
}

source validState "Every switch combination is valid" : flag {
  return 1
}
```

The host offers a complete set of positions as one byte. Every valid offer is
accepted immediately, replacing the old positions. Unlike serial input, there
is no queue or full flag: holding a switch up can be observed indefinitely.
Construction starts with all switches down; reset preserves their positions.
An optional snapshot restores the positions instead of initializing them.

```device
source setSwitches "Set the physical switch positions" (value: 8): flag {
  SWITCHES <- value
  return 1
}

source readSwitches "Sample the current positions" : 8 {
  value = register SWITCHES
  return value
}

interface AltairSenseSwitches {
  size 1
  initialize initialize
  reset reset
  validate validState
  offer setSwitches
  read 0 readSwitches
}
```

The generated API exposes `offer(byte)`, `read(0)`, `snapshot()`, and `reset()`.
The snapshot has one field, `switches`. There is no guest write operation:
the CPU cannot move the panel switches. Invalid host bytes/addresses throw;
a valid write to local address zero reports `bus-error` without changing state.

[Tests](../../../../tests/components/devices/altair-sense-switches.test.ts)
check all positions, repeated reads, replacement, reset, restoration, and host
validation. The machine test also checks the values returned by actual IN FF.

[manual]: https://altairclone.com/downloads/manuals/BASIC%20Manual%2075.pdf
