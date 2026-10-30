# Intel 8253: a counter driven by clock pulses

The 8253 contains three independent 16-bit down counters. The XT feeds all
three from the system oscillator divided by twelve: channel 0 requests IRQ0,
channel 1 drives refresh logic, and channel 2 connects to the speaker and PPI.
A control word selects the channel, byte order, operating mode, and binary or
BCD arithmetic. The chip has no instruction counter or knowledge of the BIOS.
[Intel's datasheet][intel], printed pages 3-54–3-58, defines the programming
sequence and waveforms. [IBM's listing][ibm], A-7 and A-13, uses binary modes
2, 0, and 3 during startup.

This executable definition describes **one counter**, shared by all three
channels in the [8253 package](../i8253.ts). It implements the XT's binary
modes **0, 2, and 3**, including their alternate mode encodings 6 and 7.
BCD and modes 1, 4, and 5 are rejected before changing state. The 8254's
read-back command is not an 8253 operation. Periodic divisors must be at least
two; writing one is rejected. Binary zero encodes 65,536 in every mode.

## Count registers and byte sequences

RELOAD is the complete programmed value; COUNT is the counting element.
They are different registers: a new periodic divisor takes effect at a reload
boundary. A complete write first schedules a load; the next `clock()` call
loads the counting element without also decrementing it. Each call represents
one complete input pulse, with inputs settled before its rising edge and the
count/output changes observed after its falling edge. Electrical setup/hold
violations and changes between those edges are outside this model.

RW is zero before configuration, 1 for low byte, 2 for high byte, or 3 for
low then high. Reads and writes have separate byte positions. Intel requires a
two-byte read to finish before a loading write to the same counter; this model
rejects such writes rather than guessing an undefined result. Before a valid
load, COUNT is deterministically zero here; the physical chip leaves initial
count, mode, and output undefined.

```device
device "i8253-counter"

state {
  register MODE: 3
  register RW: 3
  register RELOAD: 16
  register COUNT: 16
  register SAVED_COUNT: 16
  register WRITE_LOW: 8
  latch GATE
  latch OUT
  latch ACTIVE
  latch LOAD_PENDING
  latch READ_HIGH
  latch WRITE_HIGH
  latch COUNT_LATCHED
}

action resetCounter "Return to unconfigured state without changing the external gate" {
  MODE <- u3(0)
  RW <- u3(0)
  RELOAD <- u16(0)
  COUNT <- u16(0)
  SAVED_COUNT <- u16(0)
  WRITE_LOW <- u8(0)
  OUT <- 0
  ACTIVE <- 0
  LOAD_PENDING <- 0
  READ_HIGH <- 0
  WRITE_HIGH <- 0
  COUNT_LATCHED <- 0
}

action initialize "Start with an unconfigured counter and a low gate" {
  perform resetCounter()
  GATE <- 0
}

source periodic "Modes 2 and 3 reload automatically" : flag {
  mode = register MODE
  return not(zero(mode))
}

source output "Observe the settled OUT pin" : flag {
  high = latch OUT
  return high
}

source count "Observe the counting element without consuming a latched byte" : 16 {
  value = register COUNT
  return value
}

source control "Latch a count or configure the counter's low six control bits" (byte: 8): flag {
  access = and(bits(byte, 6, 4), u3(3))
  rawMode = bits(byte, 3, 1)
  mode = select(bit(rawMode, 1), and(rawMode, u3(3)), rawMode)
  oldAccess = register RW
  held = latch COUNT_LATCHED
  halfRead = latch READ_HIGH
  latchCommand: flag = zero(access)
  supportedMode: flag = or(zero(mode), or(equal(mode, u3(2)), equal(mode, u3(3))))
  accepted: flag = or(and(latchCommand, not(zero(oldAccess))), and(not(latchCommand), and(not(halfRead), and(not(bit(byte, 0)), supportedMode))))
  when accepted {
    when and(latchCommand, not(held)) {
      value = register COUNT
      SAVED_COUNT <- value
      COUNT_LATCHED <- 1
    }
    when not(latchCommand) {
      perform resetCounter()
      MODE <- mode
      RW <- access
      OUT <- not(zero(mode))
    }
  }
  return accepted
}

source writeCount "Assemble a complete new divisor before changing its reload register" (byte: 8): flag {
  access = register RW
  high = latch WRITE_HIGH
  halfRead = latch READ_HIGH
  low = register WRITE_LOW
  repeating = source periodic()
  complete: flag = or(not(equal(access, u3(3))), high)
  value = select(equal(access, u3(1)), extend(byte, 16), concat(byte, select(equal(access, u3(2)), u8(0), low)))
  validDivisor: flag = not(and(and(complete, repeating), equal(value, u16(1))))
  accepted: flag = and(not(zero(access)), and(not(halfRead), validDivisor))
  when accepted {
    when not(complete) {
      WRITE_LOW <- byte
      WRITE_HIGH <- 1
      when not(repeating) {
        ACTIVE <- 0
        LOAD_PENDING <- 0
        OUT <- 0
      }
    }
    when complete {
      running = latch ACTIVE
      RELOAD <- value
      WRITE_HIGH <- 0
      when or(not(repeating), not(running)) {
        LOAD_PENDING <- 1
      }
      when not(repeating) {
        OUT <- 0
      }
    }
  }
  return accepted
}

source readCount "Consume one byte of the saved count or current counting element" : 8 {
  access = register RW
  high = latch READ_HIGH
  held = latch COUNT_LATCHED
  saved = register SAVED_COUNT
  current = register COUNT
  value = select(held, saved, current)
  upper: flag = or(equal(access, u3(2)), high)
  byte = select(upper, bits(value, 15, 8), bits(value, 7, 0))
  another: flag = and(equal(access, u3(3)), not(high))
  READ_HIGH <- another
  when not(another) {
    COUNT_LATCHED <- 0
  }
  return byte
}
```

A latch command captures COUNT without stopping the clock or changing the
mode. A pending latch is preserved until its programmed bytes have been read;
repeated latch commands do not replace it. Mode commands clear byte positions
and old latches. Unlatched reads observe the current count at each transfer;
software must inhibit counting if it needs a stable two-byte value. Inspection
uses `count()`, `output()`, or the detached snapshot, never guest `read()`.

## Gate and clock behavior

In mode 0, GATE low pauses decrementing; raising it resumes the remaining
count. OUT rises at zero and stays high even as the 16-bit counter wraps and
continues counting. The first byte of a two-byte rewrite stops the old count.

In modes 2 and 3, GATE low immediately forces OUT high and inhibits counting.
A rising gate schedules a fresh load on the next pulse. Mode 2 decrements by
one, holds OUT low for count 1, then reloads and raises OUT. Mode 3 decrements
by two: an odd count first decrements by one during the high half, or by three
during the low half. This is the original **8253** count sequence, not the
8254's revised odd-count readback. The high half lasts `(N+1)/2` pulses and the
low half `(N-1)/2` for odd N; even halves last `N/2` each. A replacement divisor
is used at the next reload, which in mode 3 is a half-period boundary.

```device
action setGate "Apply the gate level and remember a periodic restart" (high: flag) {
  old = latch GATE
  repeating = source periodic()
  loaded = latch ACTIVE
  pending = latch LOAD_PENDING
  GATE <- high
  when repeating {
    when not(high) {
      OUT <- 1
    }
    when and(and(high, not(old)), or(loaded, pending)) {
      LOAD_PENDING <- 1
    }
  }
}

action clock "Load or count once at a complete input-clock boundary" {
  pending = latch LOAD_PENDING
  running = latch ACTIVE
  gate = latch GATE
  repeating = source periodic()
  reload = register RELOAD
  mode = register MODE
  current = register COUNT
  high = latch OUT
  when pending {
    COUNT <- reload
    LOAD_PENDING <- 0
    ACTIVE <- 1
    OUT <- repeating
  }
  when and(not(pending), and(running, gate)) {
    when zero(mode) {
      COUNT <- subtract(current, u16(1))
      when equal(current, u16(1)) {
        OUT <- 1
      }
    }
    when equal(mode, u3(2)) {
      terminal: flag = equal(current, u16(1))
      COUNT <- select(terminal, reload, subtract(current, u16(1)))
      OUT <- not(equal(current, u16(2)))
    }
    when equal(mode, u3(3)) {
      decrement = select(bit(current, 0), select(high, u16(1), u16(3)), u16(2))
      terminal: flag = equal(current, decrement)
      COUNT <- select(terminal, reload, subtract(current, decrement))
      OUT <- xor(terminal, high)
    }
  }
}

source validState "Reject unsupported modes, byte positions, and periodic divisors" : flag {
  mode = register MODE
  access = register RW
  reload = register RELOAD
  highRead = latch READ_HIGH
  highWrite = latch WRITE_HIGH
  pending = latch LOAD_PENDING
  running = latch ACTIVE
  held = latch COUNT_LATCHED
  validMode: flag = or(zero(mode), or(equal(mode, u3(2)), equal(mode, u3(3))))
  validAccess: flag = lessThan(access, u3(4), unsigned)
  positions: flag = or(equal(access, u3(3)), not(or(highRead, highWrite)))
  configured: flag = or(not(zero(access)), not(or(or(pending, running), held)))
  divisor: flag = or(zero(mode), not(equal(reload, u16(1))))
  return and(and(validMode, validAccess), and(positions, and(configured, divisor)))
}

interface I8253Counter {
  size 2
  initialize initialize
  reset resetCounter
  validate validState
  input setGate
  input clock
  view count
  view output
  read 0 readCount
  write 0 writeCount
  write 1 control
}
```

Snapshots include a pending load, partially written count, unread latched
bytes, gate, and output; restoration performs no clock or register access.
`reset()` is a host lifecycle operation, not a physical reset pin, and retains
the external gate. CPU reset alone does not reset this device.

The [counter and package tests](../../../../tests/components/devices/i8253.test.ts)
check independent pulse-by-pulse waveforms, zero-as-65,536, odd mode-3 readback,
gating, divisor changes, byte sequencing, rejection, and snapshot continuation.
The [XT timing chapter](../../../machines/8088/xt-timer.md) owns the board clock
and connections; the device itself does not infer elapsed time from CPU steps.

[intel]: https://www.meditronik.com.pl/doc/plus/m8253.pdf
[ibm]: https://minuszerodegrees.net/manuals/IBM_5160_Technical_Reference_APR83.pdf
