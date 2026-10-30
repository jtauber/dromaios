# IBM XT keyboard: byte delivery and receiver acknowledgement

The XT's 8048-based keyboard sends make and break scan codes. Board logic
receives a byte and asserts IRQ1; software reads it through the 8255's port A
and clears the receiver with port B bit 7. Reading the byte, clearing that
latch, and acknowledging the PIC are different operations. IBM's
[Technical Reference][manual], pages 1-65–1-69, shows the keyboard and receiver.
The BIOS reset routine on A-76–A-77 holds the keyboard clock low for 20 ms,
releases it, and expects the self-test result `AA`.

This is a **byte-boundary functional profile**, not an 8048 or serial-bit
emulator. A host offers scan-code bytes and retains rejected offers. It does
not inject characters into BIOS RAM. Matrix scanning, debounce, typematic,
the physical keyboard's 16-byte buffer, serial clocks, and self-test execution
delay are not modeled. The successful self-test response is queued on release
of a qualifying reset pulse and delivered when the receiver is enabled.
The 20 ms qualification follows the BIOS's documented reset pulse; it is not
a measurement of the physical keyboard's minimum detection threshold.

## Stored receiver and reset state

PB6 high releases the keyboard clock; low holds it low. PB7 high clears the
receiver and disables its data outputs; low enables reception. Both controls
are initially high here, matching the board's released PPI inputs. A cleared
receiver stores zero. Disabled data outputs are observed as `FF`, the board's
declared undriven-input convention.

```device
device "ibm-xt-keyboard"

state {
  register CODE: 8
  register LOW_US: 16
  latch FULL
  latch CLOCK_HIGH
  latch CLEAR
  latch SELF_TEST_PENDING
}

action resetReceiver "Clear receiver and pending self-test without moving board pins" {
  CODE <- u8(0)
  LOW_US <- u16(0)
  FULL <- 0
  SELF_TEST_PENDING <- 0
}

action initialize "Start with the receiver cleared and clock released" {
  perform resetReceiver()
  CLOCK_HIGH <- 1
  CLEAR <- 1
}

source receiverReady "The keyboard may complete another byte transfer" : flag {
  clock = latch CLOCK_HIGH
  clear = latch CLEAR
  full = latch FULL
  return and(clock, not(or(clear, full)))
}

action deliverSelfTest "Give a pending reset response priority over host bytes" {
  pending = latch SELF_TEST_PENDING
  ready = source receiverReady()
  when and(pending, ready) {
    CODE <- u8($AA)
    FULL <- 1
    SELF_TEST_PENDING <- 0
  }
}

action setControl "Apply settled PPI clock and receiver-clear outputs" (clockHigh: flag, clear: flag) {
  oldClock = latch CLOCK_HIGH
  duration = register LOW_US
  when and(and(not(oldClock), clockHigh), equal(duration, u16(20000))) {
    SELF_TEST_PENDING <- 1
  }
  CLOCK_HIGH <- clockHigh
  CLEAR <- clear
  when clockHigh {
    LOW_US <- u16(0)
  }
  when clear {
    CODE <- u8(0)
    FULL <- 0
  }
  perform deliverSelfTest()
}

action advanceMicroseconds "Accumulate only an explicitly supplied clock-low interval" (elapsed: 32) {
  clock = latch CLOCK_HIGH
  duration = register LOW_US
  when not(clock) {
    remaining = subtract(u16(20000), duration)
    // Saturate before adding, including a very large host interval.
    enough: flag = not(lessThan(elapsed, extend(remaining, 32), unsigned))
    LOW_US <- select(enough, u16(20000), add(duration, truncate(elapsed, 16)))
  }
}

source offerCode "Accept exactly one byte without overwriting pending input" (byte: 8): flag {
  ready = source receiverReady()
  pending = latch SELF_TEST_PENDING
  accepted: flag = and(ready, not(pending))
  when accepted {
    CODE <- byte
    FULL <- 1
  }
  return accepted
}

source data "Observe data without clearing the receiver" : 8 {
  code = register CODE
  clear = latch CLEAR
  return select(clear, u8($FF), code)
}

source irq "The completed byte asserts IRQ1 until receiver clear" : flag {
  full = latch FULL
  return full
}

source validState "Reject contradictory receiver state and unsaturated reset durations" : flag {
  code = register CODE
  duration = register LOW_US
  full = latch FULL
  clear = latch CLEAR
  clock = latch CLOCK_HIGH
  pending = latch SELF_TEST_PENDING
  available = source receiverReady()
  validDuration: flag = and(not(lessThan(u16(20000), duration, unsigned)), or(not(clock), zero(duration)))
  validClear: flag = or(not(clear), and(not(full), zero(code)))
  validCode: flag = or(full, zero(code))
  validPending: flag = not(and(pending, available))
  return and(and(validDuration, validClear), and(validCode, validPending))
}

interface IbmXtKeyboard {
  size 1
  initialize initialize
  reset resetReceiver
  validate validState
  input setControl
  input advanceMicroseconds
  offer offerCode
  view data
  view irq
  read 0 data
}
```

The model's `reset()` represents a fresh receiver/keyboard session, not a CPU
reset or the unused keyboard-connector reset pin. CPU reset leaves it alone.
Snapshots preserve a partial clock-low interval and any queued self-test byte.
No time passes through reads, inspection, or CPU instruction counts. The
[XT board clock](../../../machines/8088/xt-timer.md) supplies elapsed microseconds with saved fractional phase from explicit oscillator intervals;
component tests can still supply whole microseconds directly. CPU execution
remains untimed. This profile does not establish serial keyboard fidelity or
successful BIOS POST.

[Tests](../../../../tests/components/devices/ibm-xt-keyboard.test.ts) check all
byte values, make/break pairs, rejection, separate read/clear operations,
short versus qualifying reset pulses, and continuation from saved state.

[manual]: https://minuszerodegrees.net/manuals/IBM_5160_Technical_Reference_APR83.pdf
