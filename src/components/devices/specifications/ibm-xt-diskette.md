# IBM XT diskette adapter and 360 KiB drive

The XT's diskette adapter combines a NEC µPD765 controller with a separate
output latch. Software selects the drive and motor at `3F2`, polls the main
status register at `3F4`, and sends command bytes or receives results at `3F5`.
The adapter gates the controller's interrupt onto IRQ6 and its DMA request
onto channel 2. These are separate from the PIC's interrupt acknowledgement.

Drive 0 accepts a write-protected, 40-cylinder, double-sided MFM disk with
nine 512-byte sectors per track. It starts empty.
It supports Specify, Sense Drive Status, Recalibrate, Seek, Sense Interrupt
Status, Read Data, and Read ID. Commands naming other logical drives, parallel
seeks, non-DMA operation, and other defined transfer commands are explicitly
outside this profile and rejected. Unknown controller commands return `80`.
Read Data supplies one byte per DMA acknowledgement. The board owns the media
bytes and memory bus. The controller owns the sector address and result phase.

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

Phases are idle (0), command parameters (1), results (2), waiting for media
(3), and transferring sector data (4). A seek runs independently of those phases. Its busy bit remains set
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
  array RESULTS: 8[8]
  register RESULT_INDEX: 8
  register RESULT_LEFT: 8
  latch MEDIA
  register BYTE_OFFSET: 16
  register BYTE_US: 8
  register INTERRUPT_STATUS: 8
  register RESET_US: 16
  register STEP_US: 16
  register STEPS_LEFT: 8
  latch SEEK_BUSY
  latch RECALIBRATING
  latch INWARD
  latch INTERRUPT
}

source motorOn "Drive A motor enable on DOR bit 4" : flag {
  dor = register DOR
  return bit(dor, 4)
}

source driveSelected "The DOR selects the connected drive only with its motor enabled" : flag {
  dor = register DOR
  motor = source motorOn()
  return and(zero(and(dor, u8(3))), motor)
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
  RESULTS[] <- u8(0)
  RESULT_INDEX <- u8(0)
  BYTE_OFFSET <- u16(0)
  BYTE_US <- u8(0)
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
  transfer = select(lessThan(u8(2), phase, unsigned), u8($10), select(equal(phase, u8(2)), u8($D0), select(equal(phase, u8(1)), u8($90), u8($80))))
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
  delay = register BYTE_US
  when not(zero(delay)) {
    due: flag = not(lessThan(elapsed, extend(delay, 32), unsigned))
    BYTE_US <- select(due, u8(0), subtract(delay, truncate(elapsed, 8)))
  }
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
Without a disk the read commands enter a stable no-index wait, with RQM clear.
Reset can abandon a partial command, a seek, unread results, or that wait.

```device
action beginResult "Expose one or two result bytes in order" (statusByte: 8, count: 8) {
  pcn = register PCN
  RESULTS[u8(0)] <- statusByte
  RESULTS[u8(1)] <- pcn
  RESULT_INDEX <- u8(0)
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

```

## Reading a sector

Read Data names a physical head and the four ID bytes to find on its track
(cylinder, head, sector, size code). A flat image represents intact, numbered
sectors with ordinary data marks. The first sector on a track is numbered one.
A failed ID comparison returns No Data. A mismatch on the cylinder also sets
Wrong Cylinder. Read ID reports sector one as the first ID encountered. This
profile omits rotational search time, CRC errors and deleted data marks.

The modeled drive offers the first byte after 32 microseconds, the byte time
at 250 kbit/s. Each acknowledgement starts the next interval. Requests wait
for service, so this timing omits lost-data overruns and inter-sector gaps.
A masked channel or closed DMA gate cannot advance the byte position.
As a sector-image convention, loss of the selected disk during transfer ends
the command with No Data. The next disk cannot supply the tail of that sector.

At terminal count the controller reports the next sector ID. At the command’s
end of track (EOT), that becomes sector one. With multi-track (MT) enabled,
the head switches and the cylinder advances after side one. With MT disabled,
the head stays selected and the cylinder advances. These result bytes describe
the ID sequence. They do not step the physical head. [NEC command description, table 6][nec-commands]

```device
action finishRead "Publish ST0, ST1, ST2 and the four ID bytes and raise the controller interrupt" (st1: 8, st2: 8) {
  selectByte = array PARAMETERS[u8(0)]
  c = array PARAMETERS[u8(1)]
  h = array PARAMETERS[u8(2)]
  r = array PARAMETERS[u8(3)]
  n = array PARAMETERS[u8(4)]
  abnormal = select(zero(or(st1, st2)), u8(0), u8($40))
  RESULTS[u8(0)] <- or(abnormal, and(selectByte, u8(4)))
  RESULTS[u8(1)] <- st1
  RESULTS[u8(2)] <- st2
  RESULTS[u8(3)] <- c
  RESULTS[u8(4)] <- h
  RESULTS[u8(5)] <- r
  RESULTS[u8(6)] <- n
  RESULT_INDEX <- u8(0)
  RESULT_LEFT <- u8(7)
  PHASE <- u8(2)
  BYTE_US <- u8(0)
  BYTE_OFFSET <- u16(0)
  INTERRUPT <- 1
}

source sectorMatches "Compare the requested ID with the selected track on a 360 KiB disk" : flag {
  command = register COMMAND
  selectByte = array PARAMETERS[u8(0)]
  cylinder = register CYLINDER
  c = array PARAMETERS[u8(1)]
  h = array PARAMETERS[u8(2)]
  r = array PARAMETERS[u8(3)]
  n = array PARAMETERS[u8(4)]
  side = select(bit(selectByte, 2), u8(1), u8(0))
  id: flag = and(equal(c, cylinder), and(equal(h, side), equal(n, u8(2))))
  return and(bit(command, 6), and(id, and(not(zero(r)), lessThan(r, u8(10), unsigned))))
}

action findSector "Resolve a waiting read when a disk is under the selected head" {
  phase = register PHASE
  media = latch MEDIA
  selected = source driveSelected()
  when and(equal(phase, u8(3)), and(media, selected)) {
    command = register COMMAND
    cylinder = register CYLINDER
    selectByte = array PARAMETERS[u8(0)]
    readId: flag = equal(and(command, u8($1F)), u8($0A))
    when readId {
      PARAMETERS[u8(1)] <- cylinder
      PARAMETERS[u8(2)] <- select(bit(selectByte, 2), u8(1), u8(0))
      PARAMETERS[u8(3)] <- u8(1)
      PARAMETERS[u8(4)] <- u8(2)
    }
    matches = source sectorMatches()
    when not(matches) {
      c = array PARAMETERS[u8(1)]
      perform finishRead(u8(4), select(equal(c, cylinder), u8(0), u8($10)))
    }
    when and(matches, readId) {
      perform finishRead(u8(0), u8(0))
    }
    when and(matches, not(readId)) {
      PHASE <- u8(4)
      BYTE_US <- u8(32)
      BYTE_OFFSET <- u16(0)
    }
  }
}

source dreq "Gate the byte request onto channel 2 when the adapter enables DMA" : flag {
  dor = register DOR
  phase = register PHASE
  delay = register BYTE_US
  return and(equal(phase, u8(4)), and(zero(delay), bit(dor, 3)))
}

source mediaOffset "Locate the pending byte in cylinder, head, sector order" : 32 {
  c = register CYLINDER
  h = array PARAMETERS[u8(2)]
  r = array PARAMETERS[u8(3)]
  byte = register BYTE_OFFSET
  track = add(multiply(c, u8(2)), extend(h, 16))
  sector = add(multiply(track, u16(9)), extend(subtract(r, u8(1)), 32))
  return add(shiftBits(sector, left, 9), extend(byte, 32))
}

action acknowledgeByte "Consume one DACK2 and sample terminal count on this transfer" (terminal: flag) {
  request = source dreq()
  when request {
    byte = register BYTE_OFFSET
    sectorDone: flag = or(terminal, equal(byte, u16(511)))
    when not(sectorDone) {
      BYTE_OFFSET <- add(byte, u16(1))
      BYTE_US <- u8(32)
    }
    when sectorDone {
      command = register COMMAND
      c = array PARAMETERS[u8(1)]
      h = array PARAMETERS[u8(2)]
      r = array PARAMETERS[u8(3)]
      eot = array PARAMETERS[u8(5)]
      last: flag = equal(r, eot)
      switchHead: flag = and(last, bit(command, 7))
      endCylinder: flag = and(last, or(not(bit(command, 7)), not(zero(h))))
      PARAMETERS[u8(1)] <- select(endCylinder, add(c, u8(1)), c)
      PARAMETERS[u8(2)] <- select(switchHead, xor(h, u8(1)), h)
      PARAMETERS[u8(3)] <- select(last, u8(1), add(r, u8(1)))
      when switchHead {
        selectByte = array PARAMETERS[u8(0)]
        PARAMETERS[u8(0)] <- xor(selectByte, u8(4))
      }
      commandDone: flag = or(terminal, endCylinder)
      when commandDone {
        perform finishRead(select(terminal, u8(0), u8($80)), u8(0))
      }
      when not(commandDone) {
        PHASE <- u8(3)
        perform findSector()
      }
    }
  }
}

action sampleDrive "Retry an ID search when selection or media changes" {
  phase = register PHASE
  selected = source driveSelected()
  media = latch MEDIA
  when and(equal(phase, u8(4)), not(and(selected, media))) {
    perform finishRead(u8(4), u8(0))
  }
  perform findSector()
}

action setMedia "Sample the presence of a write-protected disk" (present: flag) {
  MEDIA <- present
  perform sampleDrive()
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
  perform sampleDrive()
  return 1
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
    media = latch MEDIA
    selected = source driveSelected()
    // WP/2SIDE share the drive signal on this adapter; READY is tied high.
    statusByte = or(and(first, u8(4)), select(atZero, u8($30), u8($20)))
    perform beginResult(or(statusByte, select(and(media, selected), u8($48), u8(0))), u8(1))
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
    perform findSector()
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
      index = register RESULT_INDEX
      result = array RESULTS[and(index, u8(7))]
      left = register RESULT_LEFT
      RESULT_INDEX <- add(index, u8(1))
      INTERRUPT <- 0
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
  phaseValid: flag = not(lessThan(u8(4), phase, unsigned))
  parametersValid: flag = and(not(lessThan(expected, received, unsigned)), not(lessThan(u8(8), expected, unsigned)))
  length = source commandLength(command)
  commandValid: flag = and(equal(expected, length), or(not(equal(phase, u8(1))), lessThan(received, expected, unsigned)))
  index = register RESULT_INDEX
  resultRange: flag = and(not(lessThan(u8(7), index, unsigned)), not(lessThan(subtract(u8(7), index), resultLeft, unsigned)))
  resultValid: flag = and(resultRange, not(xor(equal(phase, u8(2)), not(zero(resultLeft)))))
  headValid: flag = not(lessThan(u8(39), cylinder, unsigned))
  seekValid: flag = and(not(xor(zero(step), zero(steps))), and(not(lessThan(interval, step, unsigned)), and(or(busy, zero(steps)), or(not(busy), not(xor(zero(steps), pending))))))
  resetIdle: flag = and(zero(phase), and(not(busy), not(pending)))
  resetRange: flag = and(not(lessThan(u16(2048), reset, unsigned)), or(bit(dor, 2), zero(reset)))
  resetValid: flag = and(resetRange, or(and(bit(dor, 2), zero(reset)), resetIdle))
  reading: flag = or(equal(and(command, u8($1F)), u8(6)), equal(and(command, u8($BF)), u8($0A)))
  byte = register BYTE_OFFSET
  delay = register BYTE_US
  media = latch MEDIA
  selected = source driveSelected()
  waiting: flag = and(not(and(media, selected)), and(reading, equal(received, expected)))
  readValid: flag = or(not(equal(phase, u8(3))), and(waiting, not(pending)))
  matches = source sectorMatches()
  dataCommand: flag = and(equal(and(command, u8($1F)), u8(6)), equal(received, u8(8)))
  active: flag = and(and(media, selected), and(dataCommand, and(matches, not(pending))))
  position: flag = and(lessThan(byte, u16(512), unsigned), not(lessThan(u8(32), delay, unsigned)))
  transferring: flag = equal(phase, u8(4))
  transferValid: flag = or(and(transferring, and(active, position)), and(not(transferring), and(zero(byte), zero(delay))))
  hlt = register HLT
  recalibrating = latch RECALIBRATING
  inward = latch INWARD
  modeValid: flag = and(not(bit(hlt, 0)), not(and(recalibrating, inward)))
  return and(and(and(phaseValid, parametersValid), and(commandValid, resultValid)), and(and(headValid, seekValid), and(and(resetValid, readValid), and(modeValid, transferValid))))
}

interface IbmXtDiskette {
  size 4
  initialize resetAdapter
  reset resetAdapter
  validate validState
  input advanceMicroseconds
  input setMedia
  input acknowledgeByte
  view motorOn
  view dreq
  view mediaOffset
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
empty reads, mounted-media IDs, byte requests, terminal count, and restored continuation. The
[XT chapter](../../../machines/8088/pc-xt.md) owns board wiring and firmware
acceptance.

[ibm]: https://minuszerodegrees.net/manuals/IBM_5160_Technical_Reference_APR83.pdf
[nec]: https://hxc2001.com/download/datasheet/floppy/thirdparty/FDC/NEC/UPD765_Datasheet_OCRed.pdf
[nec-commands]: https://hxc2001.com/download/datasheet/floppy/thirdparty/FDC/NEC/upd765A.pdf
