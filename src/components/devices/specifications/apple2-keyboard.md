# Apple II keyboard latch

The Apple II keyboard encoder presents seven character bits and a strobe.
Reading C000 samples the character with the strobe in bit 7; it does not
consume the character. A read or write at C010 clears the strobe while
retaining the last character. Apple's [Reference Manual][manual], pages 5–6,
describes that protocol; its I/O decoding gives sixteen aliases for each
function. These are Apple II/II Plus addresses, not the later IIe's switches.

This chapter models the latch and a paced host input connection, not the
keyboard matrix, debounce, repeat circuit, or electrical timing. The
[machine chapter](../../../machines/6502/apple2.md) places it at C000.

```device
device "apple2-keyboard"

state {
  register KEY: 8
  latch STROBE
}

action initialize "Begin with no offered key" {
  KEY <- u8($00)
  STROBE <- 0
}

action reset "CPU reset does not press a key or acknowledge it" {
}

source validState "The retained character has seven bits" : flag {
  key = register KEY
  return not(bit(key, 7))
}
```

## Host delivery and guest acknowledgement

An accepted host offer sets the character and strobe together. Offers are
rejected while the strobe is set or if bit 7 is supplied; rejected bytes stay
with the caller. This pacing deliberately avoids overwriting an unread key,
which physical typing can do. It is host flow control, not a hardware FIFO.
The caller handles uppercase translation, control keys, and any input queue.
Zero is a valid character.

```device
source offerKey "Latch an offered seven-bit character when ready" (byte: 8): flag {
  pending = latch STROBE
  accepted: flag = and(not(pending), not(bit(byte, 7)))
  when accepted {
    KEY <- byte
    STROBE <- 1
  }
  return accepted
}

source readKey "Sample the character and strobe without consuming either" : 8 {
  key = register KEY
  pending = latch STROBE
  return or(key, select(pending, u8($80), u8($00)))
}

source acknowledgeRead "Clear the strobe on a guest read" : 8 {
  STROBE <- 0
  return u8($00)
}

source acknowledgeWrite "Clear the strobe on a guest write" (byte: 8): flag {
  STROBE <- 0
  return 1
}
```

The data read at an acknowledgement address is not a keyboard character.
This profile returns 00 there, a declared undriven-bus approximation; it does
not model the video scanner's floating bus. Writes at data addresses have
no effect and report an unanswered transfer, which the machine bus discards.

## Public interface

Local addresses 00–0F read the same latch. Local addresses 10–1F all acknowledge
it on reads and writes: low address bits do not select separate registers.
Bindings below use decimal addresses, as in the device language.

```device
interface Apple2Keyboard {
  size 32
  initialize initialize
  reset reset
  validate validState
  offer offerKey
  read 0 readKey
  read 1 readKey
  read 2 readKey
  read 3 readKey
  read 4 readKey
  read 5 readKey
  read 6 readKey
  read 7 readKey
  read 8 readKey
  read 9 readKey
  read 10 readKey
  read 11 readKey
  read 12 readKey
  read 13 readKey
  read 14 readKey
  read 15 readKey
  read 16 acknowledgeRead
  read 17 acknowledgeRead
  read 18 acknowledgeRead
  read 19 acknowledgeRead
  read 20 acknowledgeRead
  read 21 acknowledgeRead
  read 22 acknowledgeRead
  read 23 acknowledgeRead
  read 24 acknowledgeRead
  read 25 acknowledgeRead
  read 26 acknowledgeRead
  read 27 acknowledgeRead
  read 28 acknowledgeRead
  read 29 acknowledgeRead
  read 30 acknowledgeRead
  read 31 acknowledgeRead
  write 16 acknowledgeWrite
  write 17 acknowledgeWrite
  write 18 acknowledgeWrite
  write 19 acknowledgeWrite
  write 20 acknowledgeWrite
  write 21 acknowledgeWrite
  write 22 acknowledgeWrite
  write 23 acknowledgeWrite
  write 24 acknowledgeWrite
  write 25 acknowledgeWrite
  write 26 acknowledgeWrite
  write 27 acknowledgeWrite
  write 28 acknowledgeWrite
  write 29 acknowledgeWrite
  write 30 acknowledgeWrite
  write 31 acknowledgeWrite
}
```

Construction initializes KEY to 00 and STROBE clear. Reset preserves both:
the physical RESET key signals the processor, and firmware may subsequently
acknowledge the keyboard through C010. A fresh construction is a deterministic
power-on choice, not a promise about uninitialized hardware.

Snapshots contain `key` and `strobe`, are detached, and restore without
initialization, acknowledgement, or host input. Inspection uses snapshots,
never guest reads at C010. Invalid host addresses and non-byte values throw
before changing state; restored KEY values with bit 7 set are rejected.

[Device tests](../../../../tests/components/devices/apple2-keyboard.test.ts)
check every seven-bit character, all aliases, rejected offers, acknowledgement
in both directions, reset, and independent restoration.

[manual]: https://www.applelogic.org/files/AIIREF.pdf

