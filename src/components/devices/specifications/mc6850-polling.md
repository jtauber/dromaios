# Motorola MC6850: a polling serial profile

The MITS 88-2SIO connects up to two Motorola MC6850 asynchronous communications
interface adapters to the Altair's I/O bus. Each ACIA converts between the CPU's
parallel bytes and serial characters. The board selects the base address and
clock; the chip provides control, status, receive, and transmit registers.
The [MITS manual][manual], theory-of-operation pages 4–8, is the hardware
reference. This chapter defines a **character-level polling profile** for the
[Altair/BASIC target](../../../../docs/machines/altair-basic.md).

## Model boundary

This profile supports eight data bits, no parity, one or two stop bits, and
clock division by 1, 16, or 64. RTS is asserted, interrupts are disabled, and
CTS and DCD are held asserted. It does not model serial bit timing, modem
transitions, break, framing/parity errors, or receive overrun. Other operating
modes are rejected before changing state. This is not a complete MC6850 model.

The host offers a complete character only when the receive register is empty.
A rejected offer stays with the host; it is **not** a character already received
on a physical wire. A tape reader or terminal queue belongs to the host, not to
the ACIA. This flow control deliberately avoids hardware overrun. Output is
completed synchronously when accepted, so the next instruction sees the
transmitter ready. There is no emulated baud-rate delay.

The existing CPU language supplies typed state reads, expressions, and ordered
effects. These `device` fences generate the class and its behavior; there is
no handwritten MC6850 implementation.

```device
device "mc6850-polling"

state {
  register CONTROL: 8
  register RX: 8
  register TX: 8
  latch FULL
}
```

## Control and reset

Control bits 1:0 select the clock divider; both set request master reset.
Bits 4:2 select the character format. Values 100 and 101 mean eight bits without
parity, with two and one stop bits respectively. Bits 7:5 remain clear in this
profile. The published [4K BASIC 3.2 loader][loader] writes 03 followed by 15
(hexadecimal); 11 selects the two-stop-bit alternative.

```device
source resetSelected "Master-reset control bits" (control: 8): flag {
  return equal(and(control, u8($03)), u8($03))
}

source supportedControl "Polling configuration or master reset" (control: 8): flag {
  reset = source resetSelected(control)
  mode: 8 = and(control, u8($FC))
  return or(reset, or(equal(mode, u8($10)), equal(mode, u8($14))))
}
```

Construction and the host `reset()` operation choose a deterministic reset
state: control 03, empty receive latch, and zeroed retained data. This describes
emulator initialization, not uninitialized power-on silicon. The physical chip
is reset through its control register. Any control byte whose low two bits are
11 applies the same reset here, normalizing CONTROL to 03. An ordinary supported
configuration write preserves received data and the last transmitted byte.

```device
action masterReset "Enter the deterministic reset state" {
  CONTROL <- u8($03)
  RX <- u8($00)
  TX <- u8($00)
  FULL <- 0
}

source configure "Accept a supported control byte" (control: 8): flag {
  accepted = source supportedControl(control)
  when accepted {
    reset = source resetSelected(control)
    when reset {
      perform masterReset()
    }
    when not(reset) {
      CONTROL <- control
    }
  }
  return accepted
}

source validState "Check a restored polling-profile snapshot" : flag {
  control = register CONTROL
  full = latch FULL
  supported = source supportedControl(control)
  reset = source resetSelected(control)
  return and(supported, not(and(reset, full)))
}
```

## Status and received data

Local address 0 reads status and writes control. Local address 1 reads received
data and writes transmitted data. In status, bit 0 is receive-data-register
full (RDRF) and bit 1 is transmit-data-register empty (TDRE). The other status
bits are zero under this profile's fixed signals and excluded error modes.
While held in reset, both ready bits are zero.

```device
source status "Read readiness without consuming a character" : 8 {
  control = register CONTROL
  full = latch FULL
  reset = source resetSelected(control)
  return pack<8>(0, 0, 0, 0, 0, 0, not(reset), full)
}

source receive "Accept one offered host character" (byte: 8): flag {
  control = register CONTROL
  full = latch FULL
  reset = source resetSelected(control)
  accepted: flag = and(not(reset), not(full))
  when accepted {
    RX <- byte
    FULL <- 1
  }
  return accepted
}

source readData "Read the receive register and clear readiness" : 8 {
  byte = register RX
  FULL <- 0
  return byte
}
```

All 256 byte values, including zero, are data. Status reads and `snapshot()`
do not consume them. A data read clears FULL but retains RX: an empty read
returns the previous byte, or zero after reset. Software must check RDRF to know
whether that byte is current. Repeated host offers while full preserve RX.

## Transmitted data

An accepted write retains TX before notifying the host. Each write produces
one notification, including repeated equal values. A callback may inspect the
committed snapshot. If it throws, the write remains committed and the exception
propagates; the device does not retry the notification. The host owns the output
stream. Writing data while held in reset is rejected by this profile.

```device
source transmit "Accept and complete one output character" (byte: 8): flag {
  control = register CONTROL
  reset = source resetSelected(control)
  when not(reset) {
    TX <- byte
  }
  return not(reset)
}
```

## Public interface and board wiring

The generated `Mc6850Polling` takes an output callback and an optional snapshot.
Snapshot fields are `control`, `rx`, `tx`, and `full`. Restore validates widths,
Boolean state, and the profile invariant before use. Snapshots are detached.
Addresses and host bytes are validated rather than wrapped; unsupported control
or data writes throw `RangeError` before effects or notification.

```device
interface Mc6850Polling {
  size 2
  initialize masterReset
  reset masterReset
  validate validState
  offer receive
  read 0 status
  read 1 readData
  write 0 configure
  write 1 transmit notify
}
```

The [executable serial example](../../../machines/8080/altair-serial.md) owns
board wiring: the first channel's status/control register is at port 10 and its
data register at port 11. The chip itself has no Altair port addresses.

## Acceptance

[Device tests](../../../../tests/components/devices/mc6850-polling.test.ts)
independently check the control-byte table, every received/transmitted byte,
readiness without consumption, reset, rejected offers and writes, snapshot
restoration, and output callback ordering. The machine test exercises actual
8080 IN and OUT instructions through the declared ports.

[manual]: https://altairclone.com/downloads/manuals/Altair%202SIO%20Serial%20I-O.pdf
[loader]: https://altairclone.com/downloads/basic/Paper%20Tape%20and%20Cassette/2SIO%20Loaders/Ldr4k32.asm
