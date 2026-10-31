# IBM XT diskette adapter: one empty drive

The XT's diskette adapter combines a NEC µPD765 controller with a separate
output latch. Software selects the drive and motor at `3F2`, polls the main
status register at `3F4`, and sends command bytes or receives results at `3F5`.
The adapter gates the controller's interrupt onto IRQ6 and its DMA request
onto channel 2. These are separate from the PIC's interrupt acknowledgement.

This executable profile connects one empty, 40-cylinder drive as drive 0.
It supports Specify, Sense Drive Status, Recalibrate, Seek, Sense Interrupt
Status, Read Data, and Read ID. Commands naming other logical drives, parallel
seeks, non-DMA operation, and other defined transfer commands are explicitly
outside this profile and rejected. Unknown controller commands return `80`.
There is no mounted-media API, sector transfer, DMA request, or host INT 13h
service. A disk image and the channel-2 data path are a later extension.

The [IBM schematic][ibm], D-46–D-47, is especially important: **READY is tied
high**, and the controller's unit-select outputs are unconnected. The output
latch, not a command's unit bits, selects the physical drive. With no disk,
there are no index or data pulses. A read therefore stays in execution until
reset; it does not invent an immediate not-ready result. The missing-address
timeout in the [NEC register description][nec] counts index pulses. Software
must impose its own timeout when those pulses never arrive.

## Controller, drive, and command state

`CYLINDER` is the physical head position; `PCN` is the controller's estimate.
Seek updates PCN even when no drive is selected. A selected drive moves one
cylinder per step, bounded by its physical end stops. Recalibrate instead
steps outward until track zero is sensed, or reports equipment check after
77 pulses. No disk is needed for the track-zero switch to work.

Phases are idle (0), command parameters (1), results (2), and waiting for media
(3). A seek runs independently of those phases. Its busy bit remains set
until Sense Interrupt Status consumes the completion. This initial profile
requires that completion to be consumed before starting another operation.

```device
device "ibm-xt-diskette"

state {
  register DOR: 8
  register SRT_HUT: 8
  register HLT: 8
  register CYLINDER: 8
  register PCN: 8
  register PHASE: 8
  register COMMAND: 8
  register RECEIVED: 8
  register EXPECTED: 8
  array PARAMETERS: 8[8]
  register RESULT: 8
  register RESULT_PCN: 8
  register RESULT_LEFT: 8
  register INTERRUPT_STATUS: 8
  register RESET_US: 16
  register STEP_US: 16
  register STEPS_LEFT: 8
  latch SEEK_BUSY
  latch RECALIBRATING
  latch INWARD
  latch INTERRUPT
}

source driveSelected "The DOR selects the connected drive only with its motor enabled" : flag {
  dor = register DOR
  return and(zero(and(dor, u8(3))), bit(dor, 4))
}

source trackZero "Only the selected physical drive can assert track zero" : flag {
  selected = source driveSelected()
  cylinder = register CYLINDER
  return and(selected, zero(cylinder))
}

source stepInterval "The 4 MHz controller uses 2–32 ms between steps" : 16 {
  specify = register SRT_HUT
  rate = subtract(u8(16), shiftBits(specify, right, 4))
  return truncate(multiply(extend(rate, 16), u16(2000)), 16)
}

action clearController "Reset the command engine without moving the head or changing Specify" {
  PCN <- u8(0)
  PHASE <- u8(0)
  COMMAND <- u8(0)
  RECEIVED <- u8(0)
  EXPECTED <- u8(0)
  PARAMETERS[] <- u8(0)
  RESULT <- u8(0)
  RESULT_PCN <- u8(0)
  RESULT_LEFT <- u8(0)
  INTERRUPT_STATUS <- u8(0)
  RESET_US <- u16(0)
  STEP_US <- u16(0)
  STEPS_LEFT <- u8(0)
  SEEK_BUSY <- 0
  RECALIBRATING <- 0
  INWARD <- 0
  INTERRUPT <- 0
}

action resetAdapter "Assert board reset, preserving the mechanical head position" {
  DOR <- u8(0)
  perform clearController()
}

source writeControl "Apply motor, selection, interrupt gate, and active-low controller reset" (byte: 8): flag {
  old = register DOR
  DOR <- byte
  when not(bit(byte, 2)) {
    perform clearController()
  }
  when and(not(bit(old, 2)), bit(byte, 2)) {
    RESET_US <- u16(2048)
  }
  return 1
}

source irq "The board gates the pending controller interrupt onto IRQ6" : flag {
  dor = register DOR
  pending = latch INTERRUPT
  return and(pending, and(bit(dor, 2), bit(dor, 3)))
}

source status "Main status exposes direction, command phase, and unacknowledged seek" : 8 {
  dor = register DOR
  phase = register PHASE
  reset = register RESET_US
  busy = latch SEEK_BUSY
  ready: flag = and(bit(dor, 2), zero(reset))
  transfer = select(equal(phase, u8(3)), u8($10), select(equal(phase, u8(2)), u8($D0), select(equal(phase, u8(1)), u8($90), u8($80))))
  return select(ready, or(transfer, select(busy, u8(1), u8(0))), u8(0))
}

action finishSeek "Latch a seek completion until Sense Interrupt Status" (failed: flag) {
  head = array PARAMETERS[u8(0)]
  INTERRUPT_STATUS <- or(and(head, u8(4)), select(failed, u8($70), u8($20)))
  INTERRUPT <- 1
  STEPS_LEFT <- u8(0)
  STEP_US <- u16(0)
}

action stepHead "Advance one controller step and sample the selected drive's track-zero switch" {
  recalibrating = latch RECALIBRATING
  atZero = source trackZero()
  when and(recalibrating, atZero) {
    PCN <- u8(0)
    perform finishSeek(0)
  }
  when not(and(recalibrating, atZero)) {
    inward = latch INWARD
    pcn = register PCN
    cylinder = register CYLINDER
    selected = source driveSelected()
    steps = register STEPS_LEFT
    when not(recalibrating) {
      PCN <- select(inward, add(pcn, u8(1)), subtract(pcn, u8(1)))
    }
    when selected {
      CYLINDER <- select(inward, select(lessThan(cylinder, u8(39), unsigned), add(cylinder, u8(1)), cylinder), select(zero(cylinder), cylinder, subtract(cylinder, u8(1))))
    }
    STEPS_LEFT <- subtract(steps, u8(1))
    reachedZero = source trackZero()
    when and(recalibrating, reachedZero) {
      PCN <- u8(0)
    }
    when or(equal(steps, u8(1)), and(recalibrating, reachedZero)) {
      perform finishSeek(and(recalibrating, not(reachedZero)))
    }
  }
}

action advanceMicroseconds "Advance only explicit device time, preserving partial reset and step intervals" (elapsed: 32) {
  reset = register RESET_US
  when not(zero(reset)) {
    done: flag = not(lessThan(elapsed, extend(reset, 32), unsigned))
    RESET_US <- select(done, u16(0), subtract(reset, truncate(elapsed, 16)))
    when done {
      INTERRUPT_STATUS <- u8($C0)
      INTERRUPT <- 1
    }
  }
  remaining = register STEP_US
  when not(zero(remaining)) {
    enough: flag = not(lessThan(elapsed, extend(remaining, 32), unsigned))
    when not(enough) {
      STEP_US <- subtract(remaining, truncate(elapsed, 16))
    }
    when enough {
      steps = register STEPS_LEFT
      interval = source stepInterval()
      iterate(steps) {
        budget: 32 = elapsed
        step {
          left = register STEPS_LEFT
          untilStep = register STEP_US
          due: flag = and(not(zero(left)), not(lessThan(budget, extend(untilStep, 32), unsigned)))
          when due {
            perform stepHead()
            after = register STEPS_LEFT
            STEP_US <- select(zero(after), u16(0), interval)
          }
          next budget = select(due, subtract(budget, extend(untilStep, 32)), budget)
        }
      }
      left = register STEPS_LEFT
      untilStep = register STEP_US
      when not(zero(left)) {
        STEP_US <- subtract(untilStep, truncate(budget, 16))
      }
    }
  }
}
```

The adapter has its own 4 MHz clock. Whole microseconds supplied by the board
are sufficient for these command and step boundaries; reads do not advance
time. Reset completion is scheduled at a deterministic 2.048 ms bound, twice
the NEC 8 MHz reset polling bound. This one-logical-drive profile reports one
ready-change completion (`C0`). Multi-drive ready polling is not implemented.
Command-byte processing delays, motor spin-up, head load/unload mechanics,
and step-pulse widths are not modeled. A zero-distance seek completes when
accepted; an already-home recalibrate completes after one step interval.
Specify timing bytes survive controller and adapter resets. Fresh construction
chooses zero timing bytes and a head already at cylinder zero. Reset clears
the controller's cylinder estimate; it never teleports the physical head.

## Commands and results

The maximum command is nine bytes including its opcode. The parameter buffer
is saved even during a partial command. Specify's low bit selects non-DMA
operation; that mode is rejected here before changing its timing registers.
The supported read commands enter a stable no-index wait, with RQM clear.
Reset can abandon a partial command, a seek, unread results, or that wait.

```device
action beginResult "Expose one or two result bytes in order" (statusByte: 8, count: 8) {
  pcn = register PCN
  RESULT <- statusByte
  RESULT_PCN <- pcn
  RESULT_LEFT <- count
  PHASE <- u8(2)
}

action senseInterrupt "Consume a pending controller completion, independently of the PIC" {
  pending = latch INTERRUPT
  statusByte = register INTERRUPT_STATUS
  perform beginResult(select(pending, statusByte, u8($80)), select(pending, u8(2), u8(1)))
  when pending {
    INTERRUPT <- 0
    SEEK_BUSY <- 0
  }
}

action executeCommand "Execute a complete supported command" {
  command = register COMMAND
  first = array PARAMETERS[u8(0)]
  second = array PARAMETERS[u8(1)]
  PHASE <- u8(0)
  when equal(command, u8(3)) {
    SRT_HUT <- first
    HLT <- second
  }
  when equal(command, u8(4)) {
    atZero = source trackZero()
    // Empty drive: write-protect/2SIDE input is low; READY is wired high.
    perform beginResult(or(and(first, u8(4)), select(atZero, u8($30), u8($20))), u8(1))
  }
  when or(equal(command, u8(7)), equal(command, u8(15))) {
    pcn = register PCN
    recalibrating: flag = equal(command, u8(7))
    inward: flag = lessThan(pcn, second, unsigned)
    distance = select(inward, subtract(second, pcn), subtract(pcn, second))
    count = select(recalibrating, u8(77), distance)
    interval = source stepInterval()
    SEEK_BUSY <- 1
    RECALIBRATING <- recalibrating
    INWARD <- and(not(recalibrating), inward)
    STEPS_LEFT <- count
    STEP_US <- select(zero(count), u16(0), interval)
    when zero(count) {
      perform finishSeek(0)
    }
  }
  when or(equal(and(command, u8($1F)), u8(6)), equal(and(command, u8($BF)), u8($0A))) {
    PHASE <- u8(3)
  }
}

source commandLength "Count parameters; distinguish unsupported hardware operations from invalid opcodes" (byte: 8): 8 {
  code = and(byte, u8($1F))
  two: flag = or(equal(byte, u8(3)), equal(byte, u8(15)))
  one: flag = or(or(equal(byte, u8(4)), equal(byte, u8(7))), equal(and(byte, u8($BF)), u8($0A)))
  read: flag = equal(code, u8(6))
  readTrack: flag = equal(and(byte, u8($9F)), u8(2))
  write: flag = or(equal(and(byte, u8($3F)), u8(5)), equal(and(byte, u8($3F)), u8(9)))
  format: flag = equal(and(byte, u8($BF)), u8($0D))
  scan: flag = or(equal(code, u8($11)), or(equal(code, u8($19)), equal(code, u8($1D))))
  unsupported: flag = or(or(readTrack, write), or(or(format, scan), equal(code, u8($0C))))
  return select(two, u8(2), select(one, u8(1), select(read, u8(8), select(unsupported, u8($FF), u8(0)))))
}

source writeData "Accept a command byte only in the advertised host-to-controller phase" (byte: 8): flag {
  statusByte = source status()
  phase = register PHASE
  accepted = choose equal(and(statusByte, u8($C0)), u8($80)): flag {
    then {
      result = choose zero(phase): flag {
        then {
          length = source commandLength(byte)
          busy = latch SEEK_BUSY
          pending = latch INTERRUPT
          allowed: flag = and(not(equal(length, u8($FF))), or(equal(byte, u8(8)), and(not(busy), not(pending))))
          when allowed {
            when equal(byte, u8(8)) {
              perform senseInterrupt()
            }
            when not(equal(byte, u8(8))) {
              COMMAND <- byte
              RECEIVED <- u8(0)
              EXPECTED <- length
              when zero(length) {
                perform beginResult(u8($80), u8(1))
              }
              when not(zero(length)) {
                PHASE <- u8(1)
              }
            }
          }
          return allowed
        }
        else {
          command = register COMMAND
          received = register RECEIVED
          expected = register EXPECTED
          unitValid: flag = or(equal(command, u8(3)), or(not(zero(received)), zero(and(byte, u8(3)))))
          dmaValid: flag = not(and(and(equal(command, u8(3)), equal(received, u8(1))), bit(byte, 0)))
          allowed: flag = and(unitValid, dmaValid)
          when allowed {
            PARAMETERS[and(received, u8(7))] <- byte
            RECEIVED <- add(received, u8(1))
            when equal(add(received, u8(1)), expected) {
              perform executeCommand()
            }
          }
          return allowed
        }
      }
      return result
    }
    else {
      return 0
    }
  }
  return accepted
}

source readData "Drain only result bytes; an out-of-phase read returns the undriven FF convention" : 8 {
  phase = register PHASE
  byte = choose equal(phase, u8(2)): 8 {
    then {
      result = register RESULT
      next = register RESULT_PCN
      left = register RESULT_LEFT
      RESULT <- next
      RESULT_LEFT <- subtract(left, u8(1))
      when equal(left, u8(1)) {
        PHASE <- u8(0)
      }
      return result
    }
    else {
      return u8($FF)
    }
  }
  return byte
}

source validState "Reject impossible phases, timers, head positions, and interrupted seeks" : flag {
  phase = register PHASE
  command = register COMMAND
  received = register RECEIVED
  expected = register EXPECTED
  resultLeft = register RESULT_LEFT
  cylinder = register CYLINDER
  dor = register DOR
  reset = register RESET_US
  step = register STEP_US
  steps = register STEPS_LEFT
  busy = latch SEEK_BUSY
  pending = latch INTERRUPT
  interval = source stepInterval()
  phaseValid: flag = not(lessThan(u8(3), phase, unsigned))
  parametersValid: flag = and(not(lessThan(expected, received, unsigned)), not(lessThan(u8(8), expected, unsigned)))
  length = source commandLength(command)
  commandValid: flag = and(equal(expected, length), or(not(equal(phase, u8(1))), lessThan(received, expected, unsigned)))
  resultValid: flag = and(not(xor(equal(phase, u8(2)), not(zero(resultLeft)))), not(lessThan(u8(2), resultLeft, unsigned)))
  headValid: flag = not(lessThan(u8(39), cylinder, unsigned))
  seekValid: flag = and(not(xor(zero(step), zero(steps))), and(not(lessThan(interval, step, unsigned)), and(or(busy, zero(steps)), or(not(busy), not(xor(zero(steps), pending))))))
  resetIdle: flag = and(zero(phase), and(not(busy), not(pending)))
  resetRange: flag = and(not(lessThan(u16(2048), reset, unsigned)), or(bit(dor, 2), zero(reset)))
  resetValid: flag = and(resetRange, or(and(bit(dor, 2), zero(reset)), resetIdle))
  reading: flag = or(equal(and(command, u8($1F)), u8(6)), equal(and(command, u8($BF)), u8($0A)))
  readValid: flag = or(not(equal(phase, u8(3))), and(reading, equal(received, expected)))
  hlt = register HLT
  recalibrating = latch RECALIBRATING
  inward = latch INWARD
  modeValid: flag = and(not(bit(hlt, 0)), not(and(recalibrating, inward)))
  return and(and(and(phaseValid, parametersValid), and(commandValid, resultValid)), and(and(headValid, seekValid), and(and(resetValid, readValid), modeValid)))
}

interface IbmXtDiskette {
  size 4
  initialize resetAdapter
  reset resetAdapter
  validate validState
  input advanceMicroseconds
  view irq
  view status
  read 2 status
  read 3 readData
  write 0 writeControl
  write 3 writeData
}
```

The local offsets 0, 2, and 3 correspond to XT ports `3F2`, `3F4`, and `3F5`.
The DOR is write-only. Unsupported writes throw without changing state; reads
outside the result phase return `FF` without consuming anything. Snapshots
preserve partial parameter/result transfers, mechanical position, controller
estimate, pending interrupts, and remaining time. CPU reset alone changes none
of these. Board reset clears DOR and the controller while retaining the head.

[Component tests](../../../../tests/components/devices/ibm-xt-diskette.test.ts)
check command phases, IRQ gating, seeks without media, reset cancellation,
timeout-free empty reads, validation, and restored continuation. The
[XT chapter](../../../machines/8088/pc-xt.md) owns board wiring and firmware
acceptance.

[ibm]: https://minuszerodegrees.net/manuals/IBM_5160_Technical_Reference_APR83.pdf
[nec]: https://hxc2001.com/download/datasheet/floppy/thirdparty/FDC/NEC/UPD765_Datasheet_OCRed.pdf
