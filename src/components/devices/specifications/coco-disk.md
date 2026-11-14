# CoCo FD-502 disk controller: a WD1773 sector profile

The disk cartridge adds an operating system ROM and a controller to the CoCo's
cartridge connector. Disk Extended Color BASIC extends the resident interpreter;
it does not boot DOS from a system disk. The 6809 itself copies each sector byte
from the WD1773 data register into RAM. DRQ releases the cartridge's HALT signal
when a byte is available, and INTRQ drives NMI when the command finishes.

This chapter models the [Tandy FD-502, 26-3133 schematic][schematic], sheet
12-2, and the [Western Digital WD1773 description][wd], printed pages 1-6–1-19.
The schematic uses an 8 MHz crystal, connects READY high during reads, and
routes the drive latch through separate HALT and NMI gates. The older
WD1793 cartridge is not the selected circuit. [MAME's CoCo controller][mame]
provides an independent cross-check for the latch and signal connections.

## Selected drive and timing fidelity

There is one connected, 40-track drive, numbered 0, with a
35-track, single-sided disk: 18 ascending sectors per track, 256 bytes each.
The host supplies a headerless 161,280-byte image. File allocation, directories,
and BASIC tokens are opaque to this device. Mounted images start write-protected;
the host may explicitly enable a writable copy. Track register and physical head
position are separate, so writing TRACK never moves the head.

Restore, Seek, Step, Step In, Step Out, single-sector Read and Write, and Force Interrupt
(`D0` and `D8`) are implemented. Write Sector reports write protection on protected
media. Deleted data marks, multi-sector commands, track/address commands, conditional
Force Interrupt, FM, other drives, and side 1 are outside this profile. Unsupported
commands are rejected before changing state. Normal busy commands are ignored;
Force Interrupt can terminate an active transfer. Changing TRACK, SECTOR,
or drive/motor/density selection during a command is outside this profile and
rejects atomically; the ROM may still rewrite HALT enable during a transfer.
DATA writes are accepted during a write request and acknowledge DRQ. Premature
or duplicate DATA writes during a command reject without changing the transfer.

On reads each MFM data byte arrives after **32 microseconds**, whether the host reads it
or not. An unread byte overwritten at the next byte deadline sets Lost Data;
transfer continues. Completion follows the final byte and two CRC byte times.
The image has implicit normal data marks and valid CRCs. Type I step intervals
are 6/12/20/30 ms, and requested verification or Type II settling adds 30 ms.
The first search takes a fixed 32 microseconds in this functional profile;
rotational placement, index pulses, flux, gaps, spin-up and analogue errors are
not simulated. A missing ID on spinning media takes four nominal revolutions
(800 ms); an empty/stopped drive has no index pulses and remains busy until
software aborts it. This distinguishes missing media from a bad sector number.

## Stored state and cartridge lines

Phases are idle (0), stepping (1), searching (2), reading (3), final CRC or
failed-search delay (4), verifying (5), first write request (6), and writing (7).
TIMER is the time until the next
controller event. Zero means there is no scheduled event, including a search
without rotating media. LEFT counts remaining step pulses; BYTE_INDEX counts
data bytes presented to the CPU on reads, or committed to media on writes. TYPE_ONE retains the status-register layout
even when Force Interrupt replaces the command during an active transfer.

```device
device "coco-disk"

state {
  register CONTROL: 8
  register COMMAND: 8
  register TRACK: 8
  register SECTOR: 8
  register DATA: 8
  register CYLINDER: 8
  register PHASE: 8
  register TIMER: 32
  register LEFT: 16
  register BYTE_INDEX: 16
  register ERROR: 8
  latch TYPE_ONE
  latch INWARD
  latch MEDIA
  latch WRITABLE
  latch DRQ
  latch INTRQ
  latch IMMEDIATE
  latch NMI_LEVEL
  latch NMI_PENDING
}

source selected "Only drive 0, side 0 is connected" : flag {
  control = register CONTROL
  return equal(and(control, u8($47)), u8(1))
}

source spinning "Selected media produces data only with the motor on" : flag {
  selected = source selected()
  control = register CONTROL
  media = latch MEDIA
  return and(and(selected, media), bit(control, 3))
}

source halted "HALT enable holds the CPU while DRQ is low" : flag {
  control = register CONTROL
  drq = latch DRQ
  return and(bit(control, 7), not(drq))
}

source nmiPending "An assertion edge awaits one CPU boundary" : flag {
  pending = latch NMI_PENDING
  return pending
}

action sampleLines "INTRQ clears HALT enable; latch only a new NMI assertion" {
  intrq = latch INTRQ
  control = register CONTROL
  CONTROL <- select(intrq, and(control, u8($7F)), control)
  level: flag = and(intrq, bit(control, 5))
  previous = latch NMI_LEVEL
  when and(level, not(previous)) {
    NMI_PENDING <- 1
  }
  NMI_LEVEL <- level
}

action consumeNmi "Consume the edge even when the CPU has not armed NMI" {
  NMI_PENDING <- 0
}

action finish "Complete a command and release the waiting processor" {
  PHASE <- u8(0)
  TIMER <- u32(0)
  LEFT <- u16(0)
  DRQ <- 0
  INTRQ <- 1
  perform sampleLines()
}

source stepInterval "WD1773 at 8 MHz: 6, 12, 20, or 30 ms per step" : 32 {
  command = register COMMAND
  rate = and(command, u8(3))
  return select(equal(rate, u8(0)), u32(6000), select(equal(rate, u8(1)), u32(12000), select(equal(rate, u8(2)), u32(20000), u32(30000))))
}

source status "Type I exposes track zero/protection; Type II exposes DRQ/lost data" : 8 {
  phase = register PHASE
  cylinder = register CYLINDER
  selected = source selected()
  media = latch MEDIA
  drq = latch DRQ
  error = register ERROR
  typeOne = latch TYPE_ONE
  trackZero = select(and(selected, zero(cylinder)), u8(4), u8(0))
  writable = latch WRITABLE
  protected = select(and(and(selected, media), not(writable)), u8($40), u8(0))
  flags = select(typeOne, or(trackZero, protected), select(drq, u8(2), u8(0)))
  return or(or(error, flags), select(zero(phase), u8(0), u8(1)))
}

source remainingMicroseconds "Time until the next scheduled controller event" : 32 {
  timer = register TIMER
  return timer
}

source needsByte "The next event transfers one image byte into DATA" : flag {
  phase = register PHASE
  index = register BYTE_INDEX
  return and(equal(phase, u8(3)), lessThan(index, u16(256), unsigned))
}

source writesByte "The next event commits a byte to media, even after an underrun" : flag {
  phase = register PHASE
  return equal(phase, u8(7))
}

source writeByte "An unserviced request writes zero instead of stale DATA" : 8 {
  drq = latch DRQ
  data = register DATA
  return select(drq, u8(0), data)
}

source mediaOffset "Physical cylinder, ascending sector, then byte within sector" : 32 {
  cylinder = register CYLINDER
  sector = register SECTOR
  index = register BYTE_INDEX
  trackStart = multiply(extend(cylinder, 16), u16(4608))
  sectorOffset = multiply(extend(subtract(sector, u8(1)), 16), u16(256))
  return add(add(trackStart, sectorOffset), extend(index, 32))
}

source sectorPresent "The requested ID exists under the physical head" : flag {
  cylinder = register CYLINDER
  track = register TRACK
  sector = register SECTOR
  onTrack: flag = and(equal(cylinder, track), lessThan(cylinder, u8(35), unsigned))
  inRange: flag = and(not(zero(sector)), not(lessThan(u8(18), sector, unsigned)))
  return and(onTrack, inRange)
}
```

CONTROL is the write-only latch at FF40–FF47. Bits 0/1/2/6 select drives;
bit 3 enables motors, bit 4 controls write precompensation, bit 5 enables
double density and gates NMI, and bit 7 enables HALT. INTRQ clears bit 7 in
hardware. An NMI edge already observed by the board remains pending even if a
later status read deasserts the line. Neither observation nor checkpointing
acknowledges DRQ, INTRQ, or the captured edge.

## Commands and timed events

```device
action endSeek "Finish movement, optionally checking the ID after head settling" {
  command = register COMMAND
  selected = source selected()
  cylinder = register CYLINDER
  failedRestore: flag = and(zero(and(command, u8($F0))), not(and(selected, zero(cylinder))))
  when failedRestore {
    ERROR <- u8($10)
    perform finish()
  }
  when and(not(failedRestore), bit(command, 2)) {
    PHASE <- u8(5)
    spinning = source spinning()
    TIMER <- select(spinning, u32(30000), u32(0))
  }
  when and(not(failedRestore), not(bit(command, 2))) {
    perform finish()
  }
}

action forceInterrupt "Abort without a new completion edge; D8 stays asserted until D0 then acknowledgement" (command: 8) {
  phase = register PHASE
  when zero(phase) {
    TYPE_ONE <- 1
    ERROR <- u8(0)
  }
  COMMAND <- command
  PHASE <- u8(0)
  TIMER <- u32(0)
  LEFT <- u16(0)
  DRQ <- 0
  immediate = latch IMMEDIATE
  intrq = latch INTRQ
  INTRQ <- or(bit(command, 3), and(immediate, intrq))
  IMMEDIATE <- bit(command, 3)
  perform sampleLines()
}

action beginCommand "Dispatch accepted commands, keeping head position separate from TRACK" (command: 8) {
  COMMAND <- command
  TYPE_ONE <- not(bit(command, 7))
  ERROR <- u8(0)
  BYTE_INDEX <- u16(0)
  DRQ <- 0
  INTRQ <- 0
  perform sampleLines()
  when not(bit(command, 7)) {
    group = and(command, u8($F0))
    track = register TRACK
    data = register DATA
    cylinder = register CYLINDER
    selected = source selected()
    when zero(group) {
      INWARD <- 0
      LEFT <- select(selected, extend(cylinder, 16), u16(255))
      TRACK <- select(and(selected, zero(cylinder)), u8(0), track)
    }
    when not(zero(group)) {
      when equal(group, u8($10)) {
        inward: flag = lessThan(track, data, unsigned)
        INWARD <- inward
        LEFT <- extend(select(inward, subtract(data, track), subtract(track, data)), 16)
      }
      when not(equal(group, u8($10))) {
        when equal(and(command, u8($E0)), u8($40)) {
          INWARD <- 1
        }
        when equal(and(command, u8($E0)), u8($60)) {
          INWARD <- 0
        }
        LEFT <- u16(1)
      }
    }
    PHASE <- u8(1)
    left = register LEFT
    interval = source stepInterval()
    TIMER <- select(zero(left), u32(24), interval)
  }
  when bit(command, 7) {
    selected = source selected()
    media = latch MEDIA
    writable = latch WRITABLE
    protected: flag = and(equal(and(command, u8($E0)), u8($A0)), and(and(selected, media), not(writable)))
    when protected {
      ERROR <- u8($40)
      perform finish()
    }
    when not(protected) {
      PHASE <- u8(2)
      spinning = source spinning()
      TIMER <- select(spinning, select(bit(command, 2), u32(30032), u32(32)), u32(0))
    }
  }
}

action event "Retire one due event; the board supplies only the raw image byte" (byte: 8) {
  phase = register PHASE
  command = register COMMAND
  when equal(phase, u8(1)) {
    left = register LEFT
    when not(zero(left)) {
      inward = latch INWARD
      selected = source selected()
      cylinder = register CYLINDER
      when selected {
        CYLINDER <- select(inward, select(lessThan(cylinder, u8(39), unsigned), add(cylinder, u8(1)), cylinder), select(zero(cylinder), cylinder, subtract(cylinder, u8(1))))
      }
      track = register TRACK
      restore: flag = zero(and(command, u8($F0)))
      when or(bit(command, 4), restore) {
        TRACK <- select(inward, add(track, u8(1)), subtract(track, u8(1)))
      }
      head = register CYLINDER
      atZero: flag = and(restore, and(selected, zero(head)))
      when atZero {
        TRACK <- u8(0)
      }
      LEFT <- select(atZero, u16(0), subtract(left, u16(1)))
    }
    remaining = register LEFT
    when zero(remaining) {
      perform endSeek()
    }
    when not(zero(remaining)) {
      interval = source stepInterval()
      TIMER <- interval
    }
  }
  when equal(phase, u8(5)) {
    spinning = source spinning()
    cylinder = register CYLINDER
    track = register TRACK
    verified: flag = and(spinning, and(equal(cylinder, track), lessThan(cylinder, u8(35), unsigned)))
    when verified {
      perform finish()
    }
    when not(verified) {
      ERROR <- u8($10)
      PHASE <- u8(4)
      TIMER <- u32(1000000)
    }
  }
  when equal(phase, u8(2)) {
    idMatches = source sectorPresent()
    sideMatches: flag = not(and(bit(command, 1), bit(command, 3)))
    when and(idMatches, sideMatches) {
      writing: flag = bit(command, 5)
      PHASE <- select(writing, u8(6), u8(3))
      DRQ <- writing
      TIMER <- select(writing, u32(288), u32(32))
    }
    when not(and(idMatches, sideMatches)) {
      ERROR <- u8($10)
      PHASE <- u8(4)
      TIMER <- u32(800000)
    }
  }
  when equal(phase, u8(3)) {
    drq = latch DRQ
    error = register ERROR
    when drq {
      ERROR <- or(error, u8(4))
    }
    index = register BYTE_INDEX
    when lessThan(index, u16(256), unsigned) {
      DATA <- byte
      DRQ <- 1
      BYTE_INDEX <- add(index, u16(1))
      TIMER <- u32(32)
    }
    when not(lessThan(index, u16(256), unsigned)) {
      DRQ <- 0
      PHASE <- u8(4)
      TIMER <- u32(32)
    }
  }
  when equal(phase, u8(4)) {
    perform finish()
  }
  when equal(phase, u8(6)) {
    drq = latch DRQ
    when drq {
      ERROR <- u8(4)
      perform finish()
    }
    when not(drq) {
      PHASE <- u8(7)
      TIMER <- u32(32)
    }
  }
  when equal(phase, u8(7)) {
    drq = latch DRQ
    error = register ERROR
    ERROR <- or(error, select(drq, u8(4), u8(0)))
    index = register BYTE_INDEX
    last: flag = equal(index, u16(255))
    BYTE_INDEX <- add(index, u16(1))
    DRQ <- not(last)
    PHASE <- select(last, u8(4), u8(7))
    TIMER <- select(last, u32(88), u32(32))
  }
}

action elapse "Consume at most the current event delay; board dispatches the event" (microseconds: 32) {
  timer = register TIMER
  when not(zero(timer)) {
    TIMER <- subtract(timer, microseconds)
  }
}

action setMedia "The board changes media or write protection only while idle" (present: flag, writable: flag) {
  MEDIA <- present
  WRITABLE <- and(present, writable)
}
```

The board splits elapsed time at each deadline and passes `event` the byte at
`mediaOffset` only when `needsByte` is true. It must not advance beyond TIMER in
one `elapse` call. These host inputs are wiring operations, not guest registers.
Media exchange is rejected during an active command, preserving that transfer.
For writes it observes `writesByte`, `mediaOffset`, and `writeByte` before the
event, then commits that byte at the same deadline. Writing DATA only fills the
controller's latch; it does not immediately alter the image. Thus a checkpoint
can retain a supplied byte that has not reached the media yet. Force Interrupt
or reset retains earlier committed bytes and discards the pending byte.

The [write sequence][wd-write], printed pages 1-9–1-13, distinguishes the first
request from later underruns. Here a matching ID immediately raises the first
DRQ, with the flowchart's nine MFM byte times (288 µs) to service it. Missing
that deadline aborts with Lost Data and leaves media unchanged. A supplied byte
starts a sequence of 32 µs media deadlines; subsequent misses write zero, set
Lost Data, and continue. The final byte is followed by 64 µs for CRC and 24 µs
before INTRQ. This functional profile collapses the write preamble and address
mark rather than simulating gap bytes or the serial shift register. Deleted
marks and incomplete CRCs cannot be represented in a raw sector image; an
aborted write retains the completed byte prefix, without claiming to model its
on-disk CRC damage. Media exchange is permitted only while idle.

## Register accesses, validation, and reset

```device
source readStatus "Guest status reads acknowledge ordinary INTRQ" : 8 {
  value = source status()
  immediate = latch IMMEDIATE
  when not(immediate) {
    INTRQ <- 0
  }
  perform sampleLines()
  return value
}

source readTrack "The controller's track estimate" : 8 {
  value = register TRACK
  return value
}

source readSector "The requested sector number" : 8 {
  value = register SECTOR
  return value
}

source readData "A data read acknowledges DRQ without advancing time" : 8 {
  value = register DATA
  DRQ <- 0
  return value
}

source writeRegister "Reject unmodeled commands before any effects" (address: 8, value: 8): flag {
  command: flag = equal(address, u8(0))
  force: flag = equal(and(value, u8($F0)), u8($D0))
  phase = register PHASE
  available: flag = or(force, zero(phase))
  group = and(value, u8($F0))
  sectorCommand: flag = or(equal(group, u8($80)), equal(and(value, u8($F1)), u8($A0)))
  interruptCommand: flag = or(equal(value, u8($D0)), equal(value, u8($D8)))
  supported: flag = or(not(bit(value, 7)), or(sectorCommand, interruptCommand))
  control = register CONTROL
  transfer: flag = equal(and(value, u8($C0)), u8($80))
  densityOk: flag = or(not(transfer), bit(control, 5))
  immediate = latch IMMEDIATE
  immediateOk: flag = or(not(immediate), force)
  drq = latch DRQ
  writeRequest: flag = and(drq, or(equal(phase, u8(6)), equal(phase, u8(7))))
  registersWritable: flag = or(or(command, zero(phase)), and(equal(address, u8(3)), writeRequest))
  accepted: flag = and(registersWritable, or(not(and(command, available)), and(supported, and(densityOk, immediateOk))))
  when and(command, and(available, accepted)) {
    when force {
      perform forceInterrupt(value)
    }
    when not(force) {
      perform beginCommand(value)
    }
  }
  when and(accepted, equal(address, u8(1))) {
    TRACK <- value
  }
  when and(accepted, equal(address, u8(2))) {
    SECTOR <- value
  }
  when and(accepted, equal(address, u8(3))) {
    DATA <- value
    DRQ <- 0
  }
  return accepted
}

action setControl "Latch drive, motor, density and HALT controls, then resolve lines" (value: 8) {
  CONTROL <- value
  perform sampleLines()
}

source validState "Bound phases, physical head, byte counter, and event ownership" : flag {
  phase = register PHASE
  timer = register TIMER
  cylinder = register CYLINDER
  index = register BYTE_INDEX
  left = register LEFT
  drq = latch DRQ
  intrq = latch INTRQ
  level = latch NMI_LEVEL
  control = register CONTROL
  immediate = latch IMMEDIATE
  typeOne = latch TYPE_ONE
  phaseAndHead: flag = and(not(lessThan(u8(7), phase, unsigned)), lessThan(cylinder, u8(40), unsigned))
  counters: flag = and(not(lessThan(u16(256), index, unsigned)), not(lessThan(u16(255), left, unsigned)))
  ranges: flag = and(phaseAndHead, counters)
  lines: flag = and(not(xor(level, and(intrq, bit(control, 5)))), not(and(intrq, bit(control, 7))))
  idle: flag = or(not(zero(phase)), and(zero(timer), and(zero(left), not(drq))))
  timed: flag = or(or(zero(phase), or(equal(phase, u8(2)), equal(phase, u8(5)))), not(zero(timer)))
  timers: flag = and(timed, not(lessThan(u32(1000000), timer, unsigned)))
  writing: flag = or(equal(phase, u8(6)), equal(phase, u8(7)))
  request: flag = or(not(drq), or(writing, and(equal(phase, u8(3)), not(zero(index)))))
  reading: flag = equal(phase, u8(3))
  spinning = source spinning()
  searching: flag = or(equal(phase, u8(2)), equal(phase, u8(5)))
  searchClock: flag = or(not(searching), not(xor(spinning, not(zero(timer)))))
  validId = source sectorPresent()
  command = register COMMAND
  readMode: flag = and(equal(and(command, u8($F0)), u8($80)), and(not(typeOne), bit(control, 5)))
  readState: flag = or(not(reading), and(and(spinning, validId), readMode))
  writable = latch WRITABLE
  media = latch MEDIA
  writeMode: flag = and(equal(and(command, u8($F1)), u8($A0)), and(not(typeOne), bit(control, 5)))
  writeState: flag = or(not(writing), and(and(spinning, validId), and(writeMode, and(writable, lessThan(index, u16(256), unsigned)))))
  firstByte: flag = or(not(equal(phase, u8(6))), and(zero(index), not(lessThan(u32(288), timer, unsigned))))
  writeClock: flag = or(not(equal(phase, u8(7))), and(not(lessThan(u32(32), timer, unsigned)), or(not(zero(index)), not(drq))))
  permission: flag = or(not(writable), media)
  pending: flag = and(or(not(intrq), zero(phase)), or(not(immediate), and(intrq, zero(phase))))
  return and(and(and(ranges, lines), and(idle, timers)), and(and(request, readState), and(and(pending, searchClock), and(and(writeState, firstByte), and(writeClock, permission)))))
}

action initialize "Deterministic power-on convention: empty drive, track zero, no command" {
  TYPE_ONE <- 1
  SECTOR <- u8(1)
}

action resetController "Reset command electronics, preserving media and physical head" {
  CONTROL <- u8(0)
  COMMAND <- u8(0)
  TYPE_ONE <- 1
  TRACK <- u8(0)
  SECTOR <- u8(1)
  DATA <- u8(0)
  PHASE <- u8(0)
  TIMER <- u32(0)
  LEFT <- u16(0)
  BYTE_INDEX <- u16(0)
  ERROR <- u8(0)
  DRQ <- 0
  INTRQ <- 0
  IMMEDIATE <- 0
  NMI_LEVEL <- 0
  NMI_PENDING <- 0
  INWARD <- 0
}

interface CocoDiskCircuit {
  size 4
  initialize initialize
  reset resetController
  validate validState
  view selected
  view spinning
  view halted
  view nmiPending
  view status
  view remainingMicroseconds
  view needsByte
  view writesByte
  view writeByte
  view mediaOffset
  input consumeNmi
  input setControl
  input setMedia
  input elapse
  input event
  read 0 readStatus
  read 1 readTrack
  read 2 readSector
  read 3 readData
  write * writeRegister
}
```

Status reads clear ordinary INTRQ; immediate Force Interrupt remains asserted
until `D0` followed by acknowledgement. Data reads clear DRQ without waiting
for another byte. Index and head-loaded status are zero in this profile. READY is wired high, so an empty
drive does not fabricate a Not Ready bit. The ROM's timeout handles it.
Reset here is an explicit controller reset, not the CoCo's CPU-only reset.

[schematic]: https://colorcomputerarchive.com/repo/Documents/Manuals/Hardware/Color%20Computer%20Disk%20Cart%20FD502%2026-3133%20Schematic%20%28Tandy%29.pdf
[wd]: https://www.tiffe.de/Robotron/misc/Winchester-HD/Western_Digital/western_Digital.pdf
[wd-write]: https://www.hxc2001.com/download/datasheet/floppy/thirdparty/FDC/WesternDigital/WD%201773%20Floppy%20Disk%20Controller.pdf
[mame]: https://github.com/mamedev/mame/blob/master/src/devices/bus/coco/coco_fdc.cpp
